from __future__ import annotations

import json
import asyncio
import shutil
import sys
import zipfile
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path

import nibabel as nib
import numpy as np
import pytest
from flask import Flask

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from services.live_room_store import (
    MEASUREMENT_TOOLS,
    LiveRoomStore,
    RoomExpired,
    RoomNotFound,
    RoomUnauthorized,
)
from live_rooms_ws import LiveRoomWebSocketService
import api.live_rooms as live_rooms_api
import services.live_room_store as live_room_store_module
from websockets.asyncio.client import connect
from websockets.asyncio.server import serve


class Clock:
    def __init__(self) -> None:
        self.value = datetime(2026, 7, 12, 12, 0, tzinfo=timezone.utc)

    def __call__(self) -> datetime:
        return self.value


@pytest.fixture
def room_store(tmp_path: Path):
    pants = tmp_path / "pants"
    case = "PanTS_00000035"
    image_dir = pants / "image_only" / case
    mask_dir = pants / "mask_only" / case
    image_dir.mkdir(parents=True)
    mask_dir.mkdir(parents=True)
    affine = np.diag([1.5, 1.5, 2.0, 1.0])
    nib.save(nib.Nifti1Image(np.zeros((4, 4, 2), dtype=np.int16), affine), image_dir / "ct.nii.gz")
    nib.save(nib.Nifti1Image(np.zeros((4, 4, 2), dtype=np.uint8), affine), mask_dir / "combined_labels.nii.gz")
    clock = Clock()
    store = LiveRoomStore(tmp_path / "sessions", pants, now=clock)
    return store, clock


def create(room_store):
    store, _ = room_store
    metadata, key = store.create_room("35", "low")
    return store, metadata, key


def test_fast_room_keeps_full_resolution_mask(room_store):
    store, _ = room_store
    case = "PanTS_00000035"
    image_dir = store.pants_path / "image_only" / case
    mask_dir = store.pants_path / "mask_only" / case
    low_affine = np.diag([3.0, 3.0, 4.0, 1.0])
    nib.save(nib.Nifti1Image(np.zeros((2, 2, 1), dtype=np.int16), low_affine), image_dir / "ct_lowres.nii.gz")
    nib.save(nib.Nifti1Image(np.zeros((2, 2, 1), dtype=np.uint8), low_affine), mask_dir / "combined_labels_lowres.nii.gz")

    metadata, _ = store.create_room("35", "low")
    stored = json.loads((store.root / metadata["room_id"] / "metadata.json").read_text())

    assert stored["base_ct_path"].endswith("ct_lowres.nii.gz")
    assert stored["base_mask_path"].endswith("combined_labels.nii.gz")
    assert metadata["dimensions"] == [4, 4, 2]


def commit_chat(store: LiveRoomStore, room_id: str, key: str, index: int):
    return store.commit_event(
        room_id,
        key,
        event_id=f"event-{index}",
        event_type="chat.add",
        participant_id="participant-1",
        name="Reviewer",
        payload={"message": {"id": f"message-{index}", "author": "Reviewer", "text": f"message {index}"}},
    )


def test_server_owns_chat_and_note_author_names(room_store):
    store, metadata, key = create(room_store)
    chat, _ = store.commit_event(
        metadata["room_id"], key, event_id="spoof-chat", event_type="chat.add",
        participant_id="participant-1", name="Reviewer",
        payload={"message": {"id": "message-1", "author": "Someone else", "text": "hello"}},
    )
    note, _ = store.commit_event(
        metadata["room_id"], key, event_id="spoof-note", event_type="note.upsert",
        participant_id="participant-1", name="Reviewer",
        payload={"note": {
            "id": "note-1", "author": "Someone else", "text": "finding",
            "world": [1, 2, 3], "plane": "axial",
        }},
    )
    assert chat["payload"]["message"]["author"] == "Reviewer"
    assert note["payload"]["note"]["author"] == "Reviewer"


def test_current_metadata_does_not_rescan_complete_event_log(room_store, monkeypatch):
    store, metadata, key = create(room_store)
    commit_chat(store, metadata["room_id"], key, 1)

    def fail_if_scanned(_room_dir):
        raise AssertionError("normal metadata load scanned complete event log")

    monkeypatch.setattr(store, "_iter_events", fail_if_scanned)
    assert store.get_metadata(metadata["room_id"], key)["latest_seq"] == 1
    commit_chat(store, metadata["room_id"], key, 2)


def test_chat_state_is_bounded_but_export_keeps_full_history(room_store, monkeypatch):
    store, metadata, key = create(room_store)
    monkeypatch.setattr(live_room_store_module, "MAX_CHAT_MESSAGES", 3)
    for index in range(5):
        commit_chat(store, metadata["room_id"], key, index)
    snapshot = store.get_snapshot(metadata["room_id"], key)
    assert [item["text"] for item in snapshot["state"]["chat"]] == ["message 2", "message 3", "message 4"]
    with zipfile.ZipFile(store.build_export(metadata["room_id"], key)) as archive:
        exported = json.loads(archive.read("chat.json"))
    assert [item["text"] for item in exported] == [f"message {index}" for index in range(5)]


def test_new_mask_writer_map_uses_uint32(room_store):
    store, metadata, key = create(room_store)
    store.commit_event(
        metadata["room_id"], key, event_id="mask-size", event_type="mask.patch",
        participant_id="participant-1", name="Reviewer",
        payload={
            "operation_id": "mask-size", "geometry_hash": metadata["geometry_hash"],
            "resolution": "low", "segment_label": 1,
            "ranges": [{"start": 0, "length": 1, "before": 0, "after": 1}],
        },
    )
    writer_path = store.root / metadata["room_id"] / "mask_writers.bin"
    assert writer_path.stat().st_size == int(np.prod(metadata["dimensions"])) * np.dtype(np.uint32).itemsize


def test_mask_patch_rejects_excessive_range_fragmentation(room_store, monkeypatch):
    store, metadata, key = create(room_store)
    monkeypatch.setattr(live_room_store_module, "MAX_MASK_RANGES_PER_EVENT", 2)
    with pytest.raises(live_room_store_module.LiveRoomError, match="too many ranges"):
        store.commit_event(
            metadata["room_id"], key, event_id="fragmented-mask", event_type="mask.patch",
            participant_id="participant-1", name="Reviewer",
            payload={
                "operation_id": "fragmented-mask", "geometry_hash": metadata["geometry_hash"],
                "resolution": "low", "segment_label": 1,
                "ranges": [
                    {"start": 0, "length": 1, "before": 0, "after": 1},
                    {"start": 2, "length": 1, "before": 0, "after": 1},
                    {"start": 4, "length": 1, "before": 0, "after": 1},
                ],
            },
        )


def test_capability_hash_and_path_rejection(room_store):
    store, metadata, key = create(room_store)
    room_dir = store.root / metadata["room_id"]
    stored = json.loads((room_dir / "metadata.json").read_text())
    assert key not in stored
    assert len(stored["key_hash"]) == 64
    with pytest.raises(RoomUnauthorized):
        store.get_metadata(metadata["room_id"], "wrong")
    with pytest.raises(RoomNotFound):
        store.get_metadata("../../etc/passwd", key)


def test_atomic_sequences_and_event_id_idempotency(room_store):
    store, metadata, key = create(room_store)
    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(lambda index: commit_chat(store, metadata["room_id"], key, index), range(24)))
    sequences = sorted(event["seq"] for event, _ in results)
    assert sequences == list(range(1, 25))
    first, duplicate = commit_chat(store, metadata["room_id"], key, 3)
    assert duplicate is True
    assert first["seq"] == 4
    assert store.get_metadata(metadata["room_id"], key)["latest_seq"] == 24


@pytest.mark.parametrize("tool", sorted(MEASUREMENT_TOOLS))
def test_measurement_round_trip_for_allowlisted_tools(room_store, tool):
    store, metadata, key = create(room_store)
    event, duplicate = store.commit_event(
        metadata["room_id"],
        key,
        event_id=f"measurement-{tool}",
        event_type="measurement.upsert",
        participant_id="participant-1",
        name="Reviewer",
        payload={
            "measurement": {
                "id": f"annotation-{tool}",
                "tool": tool,
                "points": [[1, 2, 3], [4, 5, 6]],
                "polyline": [],
                "text": "plain text",
                "label": "finding",
                "frame_of_reference": "frame-1",
            }
        },
    )
    snapshot = store.get_snapshot(metadata["room_id"], key)
    assert duplicate is False
    assert event["payload"]["measurement"]["tool"] == tool
    assert snapshot["state"]["measurements"][f"annotation-{tool}"]["points"] == [[1.0, 2.0, 3.0], [4.0, 5.0, 6.0]]


def test_overlapping_mask_patch_has_conflict_aware_partial_undo(room_store):
    store, metadata, key = create(room_store)
    first, _ = store.commit_event(
        metadata["room_id"], key,
        event_id="stroke-one", event_type="mask.patch", participant_id="p1", name="One",
        payload={
            "operation_id": "stroke-one", "geometry_hash": metadata["geometry_hash"],
            "resolution": "low", "segment_label": 1,
            "ranges": [{"start": 0, "length": 4, "before": 0, "after": 1}],
        },
    )
    second, _ = store.commit_event(
        metadata["room_id"], key,
        event_id="stroke-two", event_type="mask.patch", participant_id="p2", name="Two",
        payload={
            "operation_id": "stroke-two", "geometry_hash": metadata["geometry_hash"],
            "resolution": "low", "segment_label": 2,
            "ranges": [{"start": 2, "length": 2, "before": 1, "after": 2}],
        },
    )
    assert (first["seq"], second["seq"]) == (1, 2)
    result = store.undo_latest(metadata["room_id"], key, "p1", "One")
    assert result["ok"] is True
    assert result["partial"] is True
    assert (result["reverted"], result["total"]) == (2, 4)
    mask_path, sequence = store.get_mask_snapshot(metadata["room_id"], key)
    flat = np.asarray(nib.load(mask_path).dataobj).reshape(-1, order="F")
    assert sequence == 3
    assert flat[:4].tolist() == [0, 0, 2, 2]


def test_export_contains_required_artifacts(room_store):
    store, metadata, key = create(room_store)
    commit_chat(store, metadata["room_id"], key, 1)
    export = store.build_export(metadata["room_id"], key)
    with zipfile.ZipFile(export) as archive:
        names = set(archive.namelist())
        assert {
            "edited_labelmap.nii.gz", "measurements.csv", "measurements.json",
            "notes.json", "chat.json", "events.json", "report.html", "report.pdf",
            "manifest.json",
        } <= names
        manifest = json.loads(archive.read("manifest.json"))
        assert manifest["case_id"] == "35"
        assert "research use only" in manifest["disclaimer"].lower()


def test_restart_replays_event_after_stale_snapshot_files(room_store):
    _, clock = room_store
    store, metadata, key = create(room_store)
    commit_chat(store, metadata["room_id"], key, 7)
    room_dir = store.root / metadata["room_id"]
    stale_metadata = json.loads((room_dir / "metadata.json").read_text())
    stale_metadata["latest_seq"] = 0
    (room_dir / "metadata.json").write_text(json.dumps(stale_metadata))
    (room_dir / "state.json").write_text(json.dumps({
        "measurements": {}, "notes": {}, "chat": [], "undone_event_ids": [],
    }))
    with (room_dir / "events.jsonl").open("a") as stream:
        stream.write('{"seq":2')
    restarted = LiveRoomStore(store.root.parent, store.pants_path, now=clock)
    snapshot = restarted.get_snapshot(metadata["room_id"], key)
    assert snapshot["latest_seq"] == 1
    assert snapshot["state"]["chat"][0]["text"] == "message 7"


def test_expiry_and_cleanup(room_store):
    store, clock = room_store
    metadata, key = store.create_room("35", "low")
    clock.value += timedelta(hours=24, seconds=1)
    with pytest.raises(RoomExpired):
        store.get_metadata(metadata["room_id"], key)
    assert store.cleanup_expired() == [metadata["room_id"]]
    assert not (store.root / metadata["room_id"]).exists()


def test_two_websocket_clients_converge_and_reconnect(room_store):
    store, metadata, key = create(room_store)

    async def scenario():
        service = LiveRoomWebSocketService(store)
        async with serve(service.handler, "127.0.0.1", 0, max_size=512 * 1024) as server:
            port = server.sockets[0].getsockname()[1]
            uri = f"ws://127.0.0.1:{port}/ws/live-rooms/{metadata['room_id']}"
            hello = {
                "type": "hello", "protocol": 1, "room_key": key,
                "participant_id": "00000000-0000-4000-8000-000000000001",
                "name": "One", "last_seq": 0,
            }
            async with connect(uri) as first:
                await first.send(json.dumps(hello))
                ready_one = json.loads(await first.recv())
                assert ready_one["type"] == "room.ready"
                async with connect(uri) as second:
                    await second.send(json.dumps({
                        **hello,
                        "participant_id": "00000000-0000-4000-8000-000000000002",
                        "name": "Two",
                    }))
                    ready_two = json.loads(await second.recv())
                    joined = json.loads(await first.recv())
                    assert ready_two["type"] == "room.ready"
                    assert joined["type"] == "presence.changed"
                    await first.send(json.dumps({
                        "type": "chat.add",
                        "event_id": "socket-event-1",
                        "payload": {"message": {"id": "socket-message-1", "author": "One", "text": "review together"}},
                    }))
                    committed_one = json.loads(await first.recv())
                    committed_two = json.loads(await second.recv())
                    assert committed_one["event"]["seq"] == committed_two["event"]["seq"] == 1
            # Same participant resumes at acknowledged sequence without replay duplicates.
            async with connect(uri) as resumed:
                await resumed.send(json.dumps({**hello, "last_seq": 1}))
                ready = json.loads(await resumed.recv())
                assert ready["type"] == "room.ready"
                assert ready["events"] == []
                assert ready["latest_seq"] == 1

    asyncio.run(scenario())


def test_reconnecting_same_participant_replaces_stale_socket(room_store):
    store, metadata, key = create(room_store)

    async def scenario():
        service = LiveRoomWebSocketService(store)
        async with serve(service.handler, "127.0.0.1", 0, max_size=512 * 1024) as server:
            port = server.sockets[0].getsockname()[1]
            uri = f"ws://127.0.0.1:{port}/ws/live-rooms/{metadata['room_id']}"
            hello = {
                "type": "hello", "protocol": 1, "room_key": key,
                "participant_id": "00000000-0000-4000-8000-000000000001",
                "name": "One", "last_seq": 0,
            }
            async with connect(uri) as first:
                await first.send(json.dumps(hello))
                assert json.loads(await first.recv())["type"] == "room.ready"
                async with connect(uri) as replacement:
                    await replacement.send(json.dumps(hello))
                    ready = json.loads(await asyncio.wait_for(replacement.recv(), timeout=2))
                    assert ready["type"] == "room.ready"
                    await asyncio.wait_for(first.wait_closed(), timeout=2)
                    assert first.close_code == 4000
                    await replacement.send(json.dumps({"type": "ping"}))
                    assert json.loads(await replacement.recv())["type"] == "pong"

    asyncio.run(scenario())


def test_websocket_expiry_check_survives_external_cleanup(room_store):
    store, metadata, key = create(room_store)

    async def scenario():
        service = LiveRoomWebSocketService(store)
        async with serve(service.handler, "127.0.0.1", 0, max_size=512 * 1024) as server:
            port = server.sockets[0].getsockname()[1]
            uri = f"ws://127.0.0.1:{port}/ws/live-rooms/{metadata['room_id']}"
            async with connect(uri) as websocket:
                await websocket.send(json.dumps({
                    "type": "hello", "protocol": 1, "room_key": key,
                    "participant_id": "00000000-0000-4000-8000-000000000001",
                    "name": "One", "last_seq": 0,
                }))
                assert json.loads(await websocket.recv())["type"] == "room.ready"
                shutil.rmtree(store.root / metadata["room_id"])
                await service.expire_rooms_once()
                assert json.loads(await websocket.recv())["type"] == "room.expired"

    asyncio.run(scenario())


def test_rest_creation_and_capability_header(room_store, monkeypatch):
    store, _ = room_store
    monkeypatch.setattr(live_rooms_api, "_store", store)
    live_rooms_api._creation_attempts.clear()
    app = Flask(__name__)
    app.register_blueprint(live_rooms_api.live_rooms_blueprint, url_prefix="/api")
    client = app.test_client()
    created = client.post("/api/live-rooms", json={"case_id": "35", "resolution": "low"})
    assert created.status_code == 201
    body = created.get_json()
    assert body["share_url"] == f"/live/{body['room_id']}#{body['room_key']}"
    assert "key_hash" not in body
    assert client.get(f"/api/live-rooms/{body['room_id']}").status_code == 401
    metadata = client.get(
        f"/api/live-rooms/{body['room_id']}",
        headers={"X-Room-Key": body["room_key"]},
    )
    assert metadata.status_code == 200
    assert metadata.headers["Referrer-Policy"] == "no-referrer"
