"""Auth + account endpoints. Deliberately kept out of api_blueprint (which pulls
in the heavy nibabel/scipy stack) so the auth surface stays light and testable.

Routes (registered under <BASE_PATH>/api):
  POST   /auth/register   {email, password, name?}  -> creates account, logs in
  POST   /auth/login      {email, password}         -> logs in
  POST   /auth/logout                               -> revokes session
  GET    /auth/me                                   -> current user + roles (401 if none)
  PATCH  /auth/me         {name?, account_type?}    -> update name / account type
  POST   /me/plan         {plan}                    -> change plan (no payment)
  GET    /me/usage                                  -> plan limits + usage so far
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
from services import auth_store, job_store, plan_store, role_store

auth_blueprint = Blueprint("auth", __name__)


def _json():
    return request.get_json(silent=True) or {}


def _with_roles(user: dict) -> dict:
    """The user body the client gets, plus the roles it holds.

    Attached here rather than in ``User.to_public_dict`` so the roles query is
    paid on the handful of endpoints that return a user, not on everything that
    resolves a session.
    """
    return {**user, "roles": role_store.roles_for(user["id"])}


def _logged_in_response(user: dict, status: int = 200):
    """JSON user body + a fresh session cookie."""
    raw = auth_store.create_session(user["id"])
    resp = make_response(jsonify({"user": _with_roles(user)}), status)
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
    return jsonify({"user": _with_roles(current_user())}), 200


@auth_blueprint.route("/auth/me", methods=["PATCH"])
@require_auth
def update_me():
    """Update the display name and/or the self-reported account type. Either
    may be sent alone. An empty name clears it and the client falls back to
    deriving one from the email; an empty account_type clears it to "not set"."""
    data = _json()
    if "name" not in data and "account_type" not in data:
        return jsonify({"error": "Nothing to update"}), 400

    user_id = current_user()["id"]
    user = None

    if "name" in data:
        name = data.get("name")
        if name is not None and not isinstance(name, str):
            return jsonify({"error": "Name must be text"}), 400
        user = auth_store.update_name(user_id, name)

    if "account_type" in data:
        account_type = data.get("account_type")
        if account_type is not None and not isinstance(account_type, str):
            return jsonify({"error": "Account type must be text"}), 400
        try:
            user = auth_store.update_account_type(user_id, account_type)
        except ValueError:
            return jsonify({"error": "Unknown account type"}), 400

    if user is None:
        return jsonify({"error": "Account not found"}), 404
    return jsonify({"user": _with_roles(user)}), 200


@auth_blueprint.route("/me/plan", methods=["POST"])
@require_auth
def set_my_plan():
    """Move to another plan.

    No payment step: pricing hasn't been set, so this is a column write. The
    limits attached to the plan are enforced for real from the next request on.
    """
    plan = (_json().get("plan") or "").strip()
    try:
        user = plan_store.set_plan(current_user()["id"], plan)
    except ValueError:
        return jsonify({"error": "Unknown plan"}), 400
    if user is None:
        return jsonify({"error": "Account not found"}), 404
    return jsonify({"user": _with_roles(user)}), 200


@auth_blueprint.route("/me/usage", methods=["GET"])
@require_auth
def my_usage():
    """Plan, its limits, and what's been used of them in the current window."""
    return jsonify(plan_store.usage_summary(current_user()["id"])), 200


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
