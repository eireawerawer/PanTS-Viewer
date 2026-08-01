"""Auth + account endpoints. Deliberately kept out of api_blueprint (which pulls
in the heavy nibabel/scipy stack) so the auth surface stays light and testable.

Routes (registered under <BASE_PATH>/api):
  POST /auth/register   {email, password}  -> creates account, logs in
  POST /auth/login      {email, password}  -> logs in
  POST /auth/logout                        -> revokes session
  GET  /auth/me                            -> current user (401 if none)
  GET  /me/jobs                            -> the current user's jobs
"""

from flask import Blueprint, jsonify, make_response, request

from api.auth import (
    COOKIE_NAME, clear_session_cookie, current_user, require_auth, set_session_cookie,
)
from services import auth_store, job_store

auth_blueprint = Blueprint("auth", __name__)


def _json():
    return request.get_json(silent=True) or {}


def _logged_in_response(user: dict, status: int = 200):
    """JSON user body + a fresh session cookie."""
    raw = auth_store.create_session(user["id"])
    resp = make_response(jsonify({"user": user}), status)
    return set_session_cookie(resp, raw)


@auth_blueprint.route("/auth/register", methods=["POST"])
def register():
    data = _json()
    email = (data.get("email") or "").strip()
    password = data.get("password") or ""
    if not email or not password:
        return jsonify({"error": "Email and password are required"}), 400
    if len(password) < 8:
        return jsonify({"error": "Password must be at least 8 characters"}), 400
    try:
        user = auth_store.create_user(email, password)
    except auth_store.EmailTakenError:
        return jsonify({"error": "An account with that email already exists"}), 409
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    return _logged_in_response(user, status=201)


@auth_blueprint.route("/auth/login", methods=["POST"])
def login():
    data = _json()
    user = auth_store.authenticate(data.get("email") or "", data.get("password") or "")
    if user is None:
        return jsonify({"error": "Invalid email or password"}), 401
    return _logged_in_response(user)


@auth_blueprint.route("/auth/logout", methods=["POST"])
def logout():
    auth_store.revoke_session(request.cookies.get(COOKIE_NAME))
    resp = make_response(jsonify({"ok": True}), 200)
    return clear_session_cookie(resp)


@auth_blueprint.route("/auth/me", methods=["GET"])
@require_auth
def me():
    return jsonify({"user": current_user()}), 200


@auth_blueprint.route("/me/jobs", methods=["GET"])
@require_auth
def my_jobs():
    jobs = job_store.list_jobs_for_user(current_user()["id"])
    return jsonify({"jobs": jobs}), 200
