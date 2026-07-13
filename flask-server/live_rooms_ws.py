"""Async WebSocket service for BodyMaps Live Rooms.

Run separately from Gunicorn so long-lived room connections never consume Flask
request threads.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import time
import uuid
from collections import defaultdict, deque
from dataclasses import dataclass, field
from typing import Any

from dotenv import load_dotenv
from websockets.asyncio.server import ServerConnection, serve
from websockets.datastructures import Headers
from websockets.exceptions import ConnectionClosed
from websockets.http11 import Response

from constants import Constants
from services.live_room_store import (
    DURABLE_TYPES,
    LiveRoomError,
    LiveRoomStore,
    RoomExpired,
    RoomNotFound,
    isoformat,
    utcnow,
)


load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))
logging.basicConfig(level=os.getenv("LIVE_ROOMS_LOG_LEVEL", "INFO"))
logger = logging.getLogger("bodymaps.live_rooms")

HOST = os.getenv("LIVE_ROOMS_WS_HOST", "127.0.0.1")
PORT = int(os.getenv("LIVE_ROOMS_WS_PORT", "8001"))
MAX_PARTICIPANTS = 8
MAX_FRAME_BYTES = 512 * 1024
MAX_MASK_CHUNKS = 256
MAX_MASK_CHUNK_RANGES = 50_000
MASK_CHUNK_TTL_SECONDS = 60
ROOM_PATH = re.compile(r"^/ws/live-rooms/([0-9a-f-]{36})$")


@dataclass
class Peer:
    websocket: ServerConnection
    room_id: str
    room_key: str
    participant_id: str
    name: str
    color: str
    presence: dict[str, Any] = field(default_factory=dict)
    limits: dict[str, deque[float]] = field(default_factory=lambda: defaultdict(deque))
    mask_chunks: dict[str, dict[int, list[dict[str, int]]]] = field(default_factory=dict)
    mask_chunk_meta: dict[str, dict[str, Any]] = field(default_factory=dict)

    def allow(self, family: str, limit: int, window_seconds: float) -> bool:
        now = time.monotonic()
        attempts = self.limits[family]
        while attempts and now - attempts[0] >= window_seconds:
            attempts.popleft()
        if len(attempts) >= limit:
            return False
        attempts.append(now)
        return True

    def public(self) -> dict[str, Any]:
        return {
            "participant_id": self.participant_id,
            "name": self.name,
            "color": self.color,
            **self.presence,
        }

    def prune_mask_chunks(self) -> None:
        cutoff = time.monotonic() - MASK_CHUNK_TTL_SECONDS
        stale = [
            operation_id
            for operation_id, metadata in self.mask_chunk_meta.items()
            if float(metadata.get("received_at", 0)) < cutoff
        ]
        for operation_id in stale:
            self.mask_chunk_meta.pop(operation_id, None)
            self.mask_chunks.pop(operation_id, None)


class LiveRoomWebSocketService:
    COLORS = ("#22d3ee", "#f59e0b", "#a78bfa", "#34d399", "#fb7185", "#60a5fa", "#f472b6", "#facc15")

    def __init__(self, store: LiveRoomStore) -> None:
        self.store = store
        self.rooms: dict[str, dict[str, Peer]] = defaultdict(dict)
        self.lock = asyncio.Lock()

    @staticmethod
    async def send_json(websocket: ServerConnection, message: dict[str, Any]) -> None:
        await websocket.send(json.dumps(message, ensure_ascii=False, separators=(",", ":")))

    async def error(self, websocket: ServerConnection, error: Exception | str, *, fatal: bool = False) -> None:
        if isinstance(error, LiveRoomError):
            code = error.code
            message = str(error)
        else:
            code = "invalid_message"
            message = str(error)
        try:
            await self.send_json(websocket, {"type": "error", "code": code, "message": message, "fatal": fatal})
        except ConnectionClosed:
            return
        if fatal:
            await websocket.close(code=4003, reason=message[:120])

    async def broadcast(self, room_id: str, message: dict[str, Any], *, exclude: str | None = None) -> None:
        async with self.lock:
            peers = [peer for pid, peer in self.rooms.get(room_id, {}).items() if pid != exclude]
        if not peers:
            return
        encoded = json.dumps(message, ensure_ascii=False, separators=(",", ":"))
        await asyncio.gather(*(peer.websocket.send(encoded) for peer in peers), return_exceptions=True)

    async def join(self, websocket: ServerConnection, room_id: str, hello: dict[str, Any]) -> Peer:
        if hello.get("type") != "hello" or hello.get("protocol") != 1:
            raise LiveRoomError("First frame must be a protocol 1 hello")
        room_key = str(hello.get("room_key", ""))
        participant_id = str(hello.get("participant_id", ""))
        try:
            uuid.UUID(participant_id)
        except (ValueError, AttributeError) as exc:
            raise LiveRoomError("participant_id must be a UUID") from exc
        name = "".join(ch for ch in str(hello.get("name", "Guest")) if ord(ch) >= 32).strip()[:32]
        if not name:
            raise LiveRoomError("Display name is required")
        metadata = await asyncio.to_thread(self.store.verify_key, room_id, room_key)

        existing: Peer | None = None
        async with self.lock:
            existing = self.rooms[room_id].get(participant_id)
            active_count = len(self.rooms[room_id]) - (1 if existing else 0)
            if active_count >= MAX_PARTICIPANTS:
                error = LiveRoomError("Room already has 8 participants")
                error.code = "participant_limit"
                error.status_code = 409
                raise error
            used_colors = {peer.color for peer in self.rooms[room_id].values() if peer.participant_id != participant_id}
            color = next((value for value in self.COLORS if value not in used_colors), self.COLORS[active_count % len(self.COLORS)])
            peer = Peer(websocket, room_id, room_key, participant_id, name, color)
            self.rooms[room_id][participant_id] = peer
            participants = [item.public() for item in self.rooms[room_id].values()]

        # Closing performs a WebSocket handshake and may wait on the old client.
        # Never hold the global room lock during network I/O: otherwise one stale
        # reconnect can delay joins, leaves, and broadcasts in every room.
        if existing:
            await existing.websocket.close(code=4000, reason="Reconnected from another tab")

        last_seq = max(0, int(hello.get("last_seq", 0) or 0))
        events = await asyncio.to_thread(self.store.events_after, room_id, room_key, last_seq)
        ready: dict[str, Any] = {
            "type": "room.ready",
            "room": metadata,
            "latest_seq": metadata["latest_seq"],
            "events": events,
            "participants": participants,
            "self": peer.public(),
        }
        if last_seq == 0:
            ready["snapshot"] = await asyncio.to_thread(self.store.get_snapshot, room_id, room_key)
        await self.send_json(websocket, ready)
        await self.broadcast(
            room_id,
            {"type": "presence.changed", "change": "joined", "participant": peer.public(), "participants": participants},
            exclude=participant_id,
        )
        logger.info("participant joined room=%s participant=%s count=%d", room_id, participant_id, len(participants))
        return peer

    async def leave(self, peer: Peer) -> None:
        async with self.lock:
            current = self.rooms.get(peer.room_id, {}).get(peer.participant_id)
            if current is not peer:
                return
            del self.rooms[peer.room_id][peer.participant_id]
            if not self.rooms[peer.room_id]:
                del self.rooms[peer.room_id]
                participants: list[dict[str, Any]] = []
            else:
                participants = [item.public() for item in self.rooms[peer.room_id].values()]
        await self.broadcast(
            peer.room_id,
            {
                "type": "presence.changed",
                "change": "left",
                "participant_id": peer.participant_id,
                "participants": participants,
            },
        )

    async def commit(self, peer: Peer, message: dict[str, Any]) -> None:
        event_type = str(message.get("type", ""))
        event_id = str(message.get("event_id", ""))
        payload = message.get("payload")
        if not isinstance(payload, dict):
            raise LiveRoomError("payload must be an object")

        if event_type == "mask.patch" and int(payload.get("chunk_count", 1)) > 1:
            if not peer.allow("mask_chunk", 300, 60):
                await self.error(peer.websocket, "Mask chunk rate limit exceeded")
                return
            peer.prune_mask_chunks()
            operation_id = str(payload.get("operation_id", ""))
            chunk_count = int(payload.get("chunk_count", 0))
            chunk_index = int(payload.get("chunk_index", -1))
            if (
                not operation_id
                or event_id != operation_id
                or not (2 <= chunk_count <= MAX_MASK_CHUNKS)
                or not (0 <= chunk_index < chunk_count)
            ):
                raise LiveRoomError("Invalid mask patch chunk metadata")
            ranges = payload.get("ranges")
            if not isinstance(ranges, list):
                raise LiveRoomError("Mask patch chunk ranges are required")
            expected_meta = {
                key: payload.get(key)
                for key in ("geometry_hash", "resolution", "segment_label", "operation_id", "chunk_count")
            }
            existing_meta = peer.mask_chunk_meta.get(operation_id)
            if existing_meta and any(existing_meta.get(key) != value for key, value in expected_meta.items()):
                peer.mask_chunk_meta.pop(operation_id, None)
                peer.mask_chunks.pop(operation_id, None)
                raise LiveRoomError("Mask patch chunks do not share the same metadata")
            chunks = peer.mask_chunks.setdefault(operation_id, {})
            if chunk_index in chunks and chunks[chunk_index] != ranges:
                peer.mask_chunk_meta.pop(operation_id, None)
                peer.mask_chunks.pop(operation_id, None)
                raise LiveRoomError("Mask patch chunk was replaced with different data")
            chunks[chunk_index] = ranges
            peer.mask_chunk_meta.setdefault(operation_id, {**expected_meta, "received_at": time.monotonic()})
            if sum(len(chunk) for chunk in chunks.values()) > MAX_MASK_CHUNK_RANGES:
                peer.mask_chunk_meta.pop(operation_id, None)
                peer.mask_chunks.pop(operation_id, None)
                raise LiveRoomError("Mask patch contains too many ranges")
            if len(peer.mask_chunks[operation_id]) < chunk_count:
                return
            payload = peer.mask_chunk_meta.pop(operation_id)
            chunks = peer.mask_chunks.pop(operation_id)
            payload["ranges"] = [item for index in range(chunk_count) for item in chunks[index]]
            payload.pop("chunk_count", None)
            payload.pop("received_at", None)
            event_id = operation_id

        family = "chat" if event_type == "chat.add" else "durable"
        if not peer.allow(family, 12 if family == "chat" else 180, 60):
            await self.error(peer.websocket, "Event rate limit exceeded")
            return

        event, duplicate = await asyncio.to_thread(
            self.store.commit_event,
            peer.room_id,
            peer.room_key,
            event_id=event_id,
            event_type=event_type,
            participant_id=peer.participant_id,
            name=peer.name,
            payload=payload,
        )
        await self.broadcast(
            peer.room_id,
            {"type": "event.committed", "event": event, "duplicate": duplicate},
        )

    async def handle_message(self, peer: Peer, message: dict[str, Any]) -> None:
        event_type = str(message.get("type", ""))
        if event_type in DURABLE_TYPES:
            await self.commit(peer, message)
            return
        if event_type in {"presence.update", "view.update"}:
            family = "presence" if event_type == "presence.update" else "view"
            if not peer.allow(family, 100, 5):
                return
            raw = message.get("payload") if isinstance(message.get("payload"), dict) else {}
            allowed = {
                key: raw[key]
                for key in ("cursor", "crosshair", "active_tool", "target_organ", "plane", "following", "view")
                if key in raw
            }
            peer.presence.update(allowed)
            await self.broadcast(
                peer.room_id,
                {"type": "presence.changed", "change": "updated", "participant": peer.public()},
                exclude=peer.participant_id,
            )
            return
        if event_type == "undo.request":
            if not peer.allow("undo", 20, 60):
                await self.error(peer.websocket, "Undo rate limit exceeded")
                return
            result = await asyncio.to_thread(
                self.store.undo_latest, peer.room_id, peer.room_key, peer.participant_id, peer.name
            )
            await self.send_json(peer.websocket, {"type": "undo.result", **result})
            if result.get("event"):
                await self.broadcast(peer.room_id, {"type": "event.committed", "event": result["event"]})
            return
        if event_type == "ping":
            await self.send_json(peer.websocket, {"type": "pong", "at": isoformat(utcnow())})
            return
        raise LiveRoomError("Unknown message type")

    async def handler(self, websocket: ServerConnection) -> None:
        path = websocket.request.path if websocket.request else ""
        match = ROOM_PATH.match(path.split("?", 1)[0])
        if not match:
            await websocket.close(code=4004, reason="Room path not found")
            return
        room_id = match.group(1)
        peer: Peer | None = None
        try:
            raw_hello = await asyncio.wait_for(websocket.recv(), timeout=10)
            if not isinstance(raw_hello, str):
                raise LiveRoomError("Binary frames are not supported")
            hello = json.loads(raw_hello)
            if not isinstance(hello, dict):
                raise LiveRoomError("hello must be an object")
            peer = await self.join(websocket, room_id, hello)
            async for raw in websocket:
                if not isinstance(raw, str):
                    await self.error(websocket, "Binary frames are not supported")
                    continue
                try:
                    message = json.loads(raw)
                    if not isinstance(message, dict):
                        raise LiveRoomError("Message must be an object")
                    await self.handle_message(peer, message)
                except (json.JSONDecodeError, LiveRoomError, ValueError, TypeError) as exc:
                    await self.error(websocket, exc)
        except asyncio.TimeoutError:
            await self.error(websocket, "Hello frame timed out", fatal=True)
        except (json.JSONDecodeError, LiveRoomError, ValueError, TypeError) as exc:
            await self.error(websocket, exc, fatal=True)
        except ConnectionClosed:
            pass
        except Exception:
            logger.exception("Unhandled WebSocket error room=%s", room_id)
            await self.error(websocket, "Live Room service error", fatal=True)
        finally:
            if peer:
                await self.leave(peer)

    async def expire_rooms_once(self) -> None:
        async with self.lock:
            active_room_ids = list(self.rooms)
        for room_id in active_room_ids:
            try:
                async with self.lock:
                    peer = next(iter(self.rooms.get(room_id, {}).values()), None)
                if peer:
                    await asyncio.to_thread(self.store.verify_key, room_id, peer.room_key)
            except (RoomExpired, RoomNotFound):
                await self.broadcast(room_id, {"type": "room.expired"})
                async with self.lock:
                    peers = list(self.rooms.get(room_id, {}).values())
                await asyncio.gather(
                    *(item.websocket.close(code=4001, reason="Room expired") for item in peers),
                    return_exceptions=True,
                )
            except LiveRoomError as exc:
                logger.warning("Room expiry check failed room=%s error=%s", room_id, exc)

    async def expire_rooms(self) -> None:
        while True:
            await asyncio.sleep(30)
            await self.expire_rooms_once()


def process_request(_connection: ServerConnection, request) -> Response | None:
    if request.path == "/health":
        body = b'{"status":"ok","service":"live-rooms-websocket"}'
        headers = Headers()
        headers["Content-Type"] = "application/json"
        headers["Content-Length"] = str(len(body))
        return Response(200, "OK", headers, body)
    return None


async def main() -> None:
    store = LiveRoomStore(Constants.SESSIONS_DIR_NAME, Constants.PANTS_PATH)
    service = LiveRoomWebSocketService(store)
    expiry_task = asyncio.create_task(service.expire_rooms())
    try:
        async with serve(
            service.handler,
            HOST,
            PORT,
            max_size=MAX_FRAME_BYTES,
            max_queue=32,
            ping_interval=20,
            ping_timeout=20,
            process_request=process_request,
        ):
            logger.info("Live Room WebSocket service listening on %s:%d", HOST, PORT)
            await asyncio.Future()
    finally:
        expiry_task.cancel()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
