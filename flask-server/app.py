import sys
import os
from werkzeug.middleware.proxy_fix import ProxyFix
from werkzeug.serving import run_simple
sys.path.append(os.path.dirname(os.path.abspath(__file__)))
from dotenv import load_dotenv

load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), ".env"))
#print("DEBUG_ENV_LOADED:", os.environ.get("SESSIONS_DIR_PATH"))

from flask import Flask
from flask_cors import CORS
from constants import Constants
#print("DEBUG_CONSTANT:", Constants.SESSIONS_DIR_NAME)

from api.admin_blueprint import admin_blueprint
from api.analytics_blueprint import analytics_blueprint, rate_max
from api.api_blueprint import api_blueprint
from api.education import education_blueprint
from api.live_rooms import live_rooms_blueprint
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

    # Behind nginx, the real scheme and host arrive as X-Forwarded-Proto/Host;
    # without this Flask sees the proxy's http://127.0.0.1 hop, and the OAuth
    # redirect_uri (built from request.url_root) comes out http:// and fails to
    # match what's registered with Google/GitHub. Opt-in because these headers
    # are client-spoofable when nothing trusted is in front of the app.
    #
    # x_for is here for the same reason: without it every request appears to come
    # from the proxy, so anything that keys off remote_addr (the rate limit on
    # /analytics/collect) would put all of production in one bucket.
    if os.environ.get("TRUST_PROXY", "false").lower() == "true":
        app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1)
    elif rate_max():
        # Behind a proxy without TRUST_PROXY, every request looks like it came
        # from the proxy and the whole site shares one bucket. Silent from the
        # browser's side (a refused batch is just a dropped batch), so say it here.
        print("[boot] TRUST_PROXY is off — if this server is behind nginx, the "
              "/analytics/collect rate limit applies to all traffic at once.")

    app.register_blueprint(api_blueprint, url_prefix=f'{Constants.BASE_PATH}/api')
    app.register_blueprint(education_blueprint, url_prefix=f'{Constants.BASE_PATH}/api')
    app.register_blueprint(live_rooms_blueprint, url_prefix=f'{Constants.BASE_PATH}/api')
    app.register_blueprint(auth_blueprint, url_prefix=f'{Constants.BASE_PATH}/api')
    app.register_blueprint(oauth_blueprint, url_prefix=f'{Constants.BASE_PATH}/api')
    # /analytics/collect is always live; the dashboard's read endpoints inside
    # this blueprint 404 unless ANALYTICS_DASHBOARD=true, and then need admin.
    app.register_blueprint(analytics_blueprint, url_prefix=f'{Constants.BASE_PATH}/api')
    # Admin-only throughout (role checks are per-route, not on the blueprint).
    app.register_blueprint(admin_blueprint, url_prefix=f'{Constants.BASE_PATH}/api')

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
        from services import analytics_store, auth_store, job_store, role_store
        auth_store.ensure_system_user()
        # ADMIN_EMAILS -> the admin role, so a fresh or wiped database still has
        # someone who can grant roles. Additive: it never takes admin away.
        bootstrapped = role_store.ensure_bootstrap_admins()
        if bootstrapped:
            print(f"[boot] ensured admin for {len(bootstrapped)} account(s) from ADMIN_EMAILS")
        imported = job_store.import_legacy_job_json(Constants.SESSIONS_DIR_NAME)
        if imported:
            print(f"[boot] imported {imported} legacy job.json record(s)")
        reaped = job_store.reap_orphaned_jobs()
        if reaped:
            print(f"[boot] reaped {reaped} orphaned inference job(s)")
        # Accounts whose 30-day grace period elapsed while the server was up (or
        # down) are removed for good here. Boot is the only trigger for now — a
        # long-running server won't purge until its next restart, which is fine:
        # the account is already unusable from the moment it's requested.
        purged = auth_store.purge_expired_deletions()
        if purged:
            print(f"[boot] purged {purged} account(s) past the deletion grace period")
        # Same boot-only trigger, and the same caveat: a server that stays up for
        # months holds its oldest events a little past the window. Acceptable for
        # a retention bound, and it avoids a scheduler this app doesn't have.
        expired = analytics_store.purge_old_events()
        if expired:
            print(f"[boot] purged {expired} analytics event(s) past "
                  f"{analytics_store.retention_days()}-day retention")
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
        o.strip()
        for o in os.environ.get(
            "ALLOWED_ORIGINS",
            "http://localhost:5173,http://127.0.0.1:5173",
        ).split(",")
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
