"""Auth + account endpoints. Deliberately kept out of api_blueprint (which pulls
in the heavy nibabel/scipy stack) so the auth surface stays light and testable.

Routes (registered under <BASE_PATH>/api):
  POST   /auth/register   {email, password, name?}  -> creates account, logs in
  POST   /auth/login      {email, password}         -> logs in
  POST   /auth/logout                               -> revokes session
  GET    /auth/me                                   -> current user (401 if none)
  PATCH  /auth/me         {name}                    -> update the display name
  GET    /me/jobs                                   -> the current user's jobs
  GET    /me/export                                 -> everything we hold, as JSON
  DELETE /me/jobs                                   -> delete scan history, keep account
  DELETE /me                                        -> schedule account deletion
"""

import json

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
        user = auth_store.create_user(email, password, data.get("name"))
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


@auth_blueprint.route("/auth/me", methods=["PATCH"])
@require_auth
def update_me():
    """Update the display name. An empty string clears it, and the client falls
    back to deriving one from the email."""
    data = _json()
    if "name" not in data:
        return jsonify({"error": "Nothing to update"}), 400
    name = data.get("name")
    if name is not None and not isinstance(name, str):
        return jsonify({"error": "Name must be text"}), 400
    user = auth_store.update_name(current_user()["id"], name)
    if user is None:
        return jsonify({"error": "Account not found"}), 404
    return jsonify({"user": user}), 200


@auth_blueprint.route("/me/jobs", methods=["GET"])
@require_auth
def my_jobs():
    jobs = job_store.list_jobs_for_user(current_user()["id"])
    return jsonify({"jobs": jobs}), 200


@auth_blueprint.route("/me/export", methods=["GET"])
@require_auth
def export_me():
    """Everything we hold for this account, as a downloadable JSON file.

    Deliberately its own endpoint rather than a step inside deletion — wanting a
    copy of your data is not the same as wanting to leave.
    """
    user = current_user()
    payload = {
        "exported_at": job_store.utcnow().isoformat(),
        "account": auth_store.get_user(user["id"]),
        "jobs": job_store.list_jobs_for_user(user["id"]),
    }
    # send as a file rather than a JSON body so the browser saves it directly
    resp = make_response(json.dumps(payload, indent=2, default=str), 200)
    resp.headers["Content-Type"] = "application/json"
    resp.headers["Content-Disposition"] = (
        f'attachment; filename="bodymaps-export-{user["id"]}.json"'
    )
    return resp


@auth_blueprint.route("/me/jobs", methods=["DELETE"])
@require_auth
def delete_my_jobs():
    """Delete scan history but keep the account."""
    result = job_store.delete_jobs_for_user(current_user()["id"])
    return jsonify({"deleted": result}), 200


@auth_blueprint.route("/me", methods=["DELETE"])
@require_auth
def delete_me():
    """Schedule the account for deletion and sign out everywhere.

    Reversible for auth_store.DELETION_GRACE_DAYS: signing back in during that
    window cancels it. The response carries the deadline so the UI can say when.
    """
    result = auth_store.request_deletion(current_user()["id"])
    if result is None:
        return jsonify({"error": "Account not found"}), 404
    resp = make_response(jsonify(result), 200)
    return clear_session_cookie(resp)
