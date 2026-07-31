import sys
import os
from werkzeug.serving import run_simple
sys.path.append(os.path.dirname(os.path.abspath(__file__)))
from dotenv import load_dotenv

load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), ".env"))
#print("DEBUG_ENV_LOADED:", os.environ.get("SESSIONS_DIR_PATH"))

from flask import Flask
from flask_cors import CORS
from constants import Constants
#print("DEBUG_CONSTANT:", Constants.SESSIONS_DIR_NAME)

from api.api_blueprint import api_blueprint
from api.auth_blueprint import auth_blueprint
from api.oauth_blueprint import init_oauth, oauth_blueprint
from models.base import db
from models.combined_labels import CombinedLabels
from models.engine import get_engine

def create_session_dir():
    if not os.path.isdir(Constants.SESSIONS_DIR_NAME):
        os.mkdir(Constants.SESSIONS_DIR_NAME)

import logging

def create_app():
    create_session_dir()
    app = Flask(__name__)
    app.register_blueprint(api_blueprint, url_prefix=f'{Constants.BASE_PATH}/api')
    app.register_blueprint(auth_blueprint, url_prefix=f'{Constants.BASE_PATH}/api')
    app.register_blueprint(oauth_blueprint, url_prefix=f'{Constants.BASE_PATH}/api')

    app.config['MAX_CONTENT_LENGTH'] = 2 * 1024 * 1024 * 1024  # 2 GB, for overcoming size limits in file uploads

    # Signs the Flask session cookie, which Authlib uses to carry the OAuth
    # `state` (CSRF) between the redirect and the callback. In production this
    # MUST be a fixed secret from the environment — a random per-boot value
    # would invalidate every in-flight OAuth login on restart.
    secret = os.environ.get("SECRET_KEY")
    if not secret:
        secret = os.urandom(32).hex()
        print("[boot] SECRET_KEY not set — using an ephemeral key (OAuth logins "
              "in flight will break on restart). Set SECRET_KEY in production.")
    app.config['SECRET_KEY'] = secret

    # Registers only the OAuth providers whose credentials are configured, so
    # the app boots fine without them (buttons stay disabled in the UI).
    init_oauth(app)

    # Point Flask-SQLAlchemy at the same URL as the job store. FSA builds its own
    # engine, but both get identical SQLite PRAGMAs from the process-wide listener
    # in models/engine.py. Schema is managed by Alembic, not create_all.
    app.config['SQLALCHEMY_DATABASE_URI'] = Constants.DATABASE_URL
    app.config['SQLALCHEMY_ENGINE_OPTIONS'] = {}
    db.init_app(app)
    with app.app_context():
        get_engine()  # init at boot, not first request

    # Seed the reserved system user first (legacy-imported jobs are assigned to
    # it, and job.user_id is NOT NULL with an FK), then import any pre-DB
    # job.json, then fail jobs orphaned by the restart.
    try:
        from services import auth_store, job_store
        auth_store.ensure_system_user()
        imported = job_store.import_legacy_job_json(Constants.SESSIONS_DIR_NAME)
        if imported:
            print(f"[boot] imported {imported} legacy job.json record(s)")
        reaped = job_store.reap_orphaned_jobs()
        if reaped:
            print(f"[boot] reaped {reaped} orphaned inference job(s)")
    except Exception as e:
        print(f"[boot] account/job store init skipped: {e}")

    class FilterProgressRequests(logging.Filter):
        def filter(self, record):
            return "/api/progress/" not in record.getMessage()

    logging.getLogger('werkzeug').addFilter(FilterProgressRequests())

    # Pin CORS to an explicit allowlist and allow credentials — required now that
    # auth rides in a cookie (a wildcard origin can't be combined with cookies,
    # and would let any site make authenticated requests as a logged-in user).
    # Set ALLOWED_ORIGINS on the server (comma-separated); defaults to local dev.
    allowed_origins = [
        o.strip() for o in os.environ.get("ALLOWED_ORIGINS", "http://localhost:5173").split(",")
        if o.strip()
    ]
    CORS(app, resources={r"/*": {"origins": allowed_origins}}, supports_credentials=True)

    return app


app = create_app()
print(app.url_map)

# ✅ SharedArrayBuffer Compatibility
# @app.after_request
# def add_security_headers(response):
#     response.headers["Cross-Origin-Opener-Policy"] = "cross-origin"
#     response.headers["Access-Control-Allow-Origin"] = "http://localhost:5173"
#     response.headers["Cross-Origin-Embedder-Policy"] = "require-corp"
#     return response

def find_watch_files():
    watch_dirs = ['api', 'models', 'services']
    base_path = os.path.dirname(__file__)
    all_files = []
    for d in watch_dirs:
        dir_path = os.path.join(base_path, d)
        for root, _, files in os.walk(dir_path):
            for f in files:
                if f.endswith('.py'):
                    all_files.append(os.path.join(root, f))
    return all_files

if __name__ == "__main__":
    use_ssl = os.environ.get("USE_SSL", "false").lower() == "true"
    ssl_context = ("../certs/localhost-cert.pem", "../certs/localhost-key.pem") if use_ssl else None
    run_simple(
        hostname="0.0.0.0",
        port=5001,
        application=app,
        use_debugger=True,
        use_reloader=True,
        extra_files=find_watch_files(),
        ssl_context=ssl_context
    )