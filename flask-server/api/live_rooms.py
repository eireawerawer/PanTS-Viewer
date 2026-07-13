"""REST boundary for capability-key Live Rooms."""

from __future__ import annotations

import threading
import time
from collections import defaultdict, deque

from flask import Blueprint, jsonify, request, send_file

from constants import Constants
from services.live_room_store import LiveRoomError, LiveRoomStore


live_rooms_blueprint = Blueprint("live_rooms", __name__)
_store: LiveRoomStore | None = None
_store_lock = threading.Lock()
_creation_attempts: dict[str, deque[float]] = defaultdict(deque)
_creation_lock = threading.Lock()
CREATION_LIMIT = 10
CREATION_WINDOW_SECONDS = 60 * 60


def get_live_room_store() -> LiveRoomStore:
    global _store
    if _store is None:
        with _store_lock:
            if _store is None:
                _store = LiveRoomStore(Constants.SESSIONS_DIR_NAME, Constants.PANTS_PATH)
    return _store


def _client_ip() -> str:
    forwarded = request.headers.get("X-Forwarded-For", "").split(",", 1)[0].strip()
    return forwarded or request.remote_addr or "unknown"


def _check_creation_rate() -> None:
    now = time.monotonic()
    ip = _client_ip()
    with _creation_lock:
        attempts = _creation_attempts[ip]
        while attempts and now - attempts[0] >= CREATION_WINDOW_SECONDS:
            attempts.popleft()
        if len(attempts) >= CREATION_LIMIT:
            error = LiveRoomError("Too many rooms created; try again later")
            error.status_code = 429
            error.code = "room_creation_rate_limited"
            raise error
        attempts.append(now)


def _room_key() -> str:
    return request.headers.get("X-Room-Key", "")


@live_rooms_blueprint.errorhandler(LiveRoomError)
def handle_live_room_error(error: LiveRoomError):
    return jsonify({"error": str(error), "code": error.code}), error.status_code


@live_rooms_blueprint.after_request
def live_room_headers(response):
    response.headers["Cache-Control"] = "no-store"
    response.headers["Referrer-Policy"] = "no-referrer"
    return response


@live_rooms_blueprint.post("/live-rooms")
def create_live_room():
    _check_creation_rate()
    body = request.get_json(silent=True) or {}
    case_id = str(body.get("case_id", ""))
    resolution = str(body.get("resolution", "low")).lower()
    metadata, room_key = get_live_room_store().create_room(case_id, resolution)
    base = (Constants.BASE_PATH or "").rstrip("/")
    share_url = f"{base}/live/{metadata['room_id']}#{room_key}"
    return jsonify({**metadata, "room_key": room_key, "share_url": share_url}), 201


@live_rooms_blueprint.get("/live-rooms/health")
def live_rooms_health():
    return jsonify({"status": "ok", "service": "live-rooms-rest"})


@live_rooms_blueprint.get("/live-rooms/<room_id>")
def get_live_room(room_id: str):
    metadata = get_live_room_store().get_metadata(room_id, _room_key())
    return jsonify(metadata)


@live_rooms_blueprint.get("/live-rooms/<room_id>/snapshot")
def get_live_room_snapshot(room_id: str):
    store = get_live_room_store()
    if request.args.get("format") == "mask":
        path, sequence = store.get_mask_snapshot(room_id, _room_key())
        response = send_file(
            path,
            mimetype="application/gzip",
            as_attachment=False,
            download_name="live-room-labelmap.nii.gz",
            conditional=False,
        )
        response.headers["X-Live-Room-Sequence"] = str(sequence)
        return response
    return jsonify(store.get_snapshot(room_id, _room_key()))


@live_rooms_blueprint.get("/live-rooms/<room_id>/export.zip")
def export_live_room(room_id: str):
    path = get_live_room_store().build_export(room_id, _room_key())
    return send_file(
        path,
        mimetype="application/zip",
        as_attachment=True,
        download_name=f"bodymaps-live-room-{room_id}.zip",
        conditional=False,
    )


@live_rooms_blueprint.get("/live-rooms/<room_id>/report.pdf")
def live_room_report(room_id: str):
    path = get_live_room_store().get_report(room_id, _room_key())
    return send_file(
        path,
        mimetype="application/pdf",
        as_attachment=True,
        download_name=f"bodymaps-live-room-{room_id}-report.pdf",
        conditional=False,
    )

