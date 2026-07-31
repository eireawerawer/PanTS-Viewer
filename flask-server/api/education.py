"""REST API for BodyMaps education challenges."""

from __future__ import annotations

import threading

from flask import Blueprint, jsonify, request

from constants import Constants
from services.education_store import EducationError, EducationStore


education_blueprint = Blueprint("education", __name__)
_store: EducationStore | None = None
_store_lock = threading.Lock()


def get_education_store() -> EducationStore:
    global _store
    if _store is None:
        with _store_lock:
            if _store is None:
                _store = EducationStore(Constants.SESSIONS_DIR_NAME, Constants.PANTS_PATH)
    return _store


def _attempt_key() -> str:
    return request.headers.get("X-Attempt-Key", "")


@education_blueprint.errorhandler(EducationError)
def handle_education_error(error: EducationError):
    return jsonify({"error": str(error), "code": error.code}), error.status_code


@education_blueprint.after_request
def education_headers(response):
    response.headers["Cache-Control"] = "no-store"
    response.headers["Referrer-Policy"] = "no-referrer"
    return response


@education_blueprint.get("/education/challenges/<challenge_id>")
def get_challenge(challenge_id: str):
    return jsonify(get_education_store().challenge(challenge_id))


@education_blueprint.post("/education/challenges/<challenge_id>/attempts")
def start_attempt(challenge_id: str):
    attempt, key = get_education_store().start_attempt(challenge_id)
    return jsonify({**attempt, "attempt_key": key}), 201


@education_blueprint.post("/education/attempts/<attempt_id>/submit")
def submit_attempt(attempt_id: str):
    body = request.get_json(silent=True) or {}
    return jsonify(get_education_store().submit(attempt_id, _attempt_key(), body))


@education_blueprint.get("/education/attempts/<attempt_id>/result")
def get_attempt_result(attempt_id: str):
    return jsonify(get_education_store().result(attempt_id, _attempt_key()))


@education_blueprint.post("/education/attempts/<attempt_id>/retry-grade")
def retry_attempt_grade(attempt_id: str):
    return jsonify(get_education_store().retry_grade(attempt_id, _attempt_key()))


@education_blueprint.post("/education/attempts/<attempt_id>/tutor")
def tutor(attempt_id: str):
    body = request.get_json(silent=True) or {}
    return jsonify(get_education_store().tutor(attempt_id, _attempt_key(), body.get("message", "")))
