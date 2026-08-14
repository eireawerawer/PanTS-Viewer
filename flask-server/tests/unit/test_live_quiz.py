from __future__ import annotations

import json
import asyncio
import sys
import zipfile
from datetime import datetime, timedelta, timezone
from pathlib import Path

import nibabel as nib
import numpy as np
import pytest
from flask import Flask
from websockets.asyncio.client import connect
from websockets.asyncio.server import serve

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

import api.live_rooms as live_rooms_api
from services.live_quiz import QUIZ_PACK_ID, consistency_for
from services.live_room_store import LiveRoomError, LiveRoomStore, RoomUnauthorized
from live_rooms_ws import LiveRoomWebSocketService


class Clock:
    def __init__(self) -> None:
        self.value = datetime(2026, 8, 6, 12, 0, tzinfo=timezone.utc)

    def __call__(self) -> datetime:
        return self.value


@pytest.fixture
def quiz_store(tmp_path: Path):
    pants = tmp_path / "pants"
    image_dir = pants / "image_only" / "PanTS_00000035"
    mask_dir = pants / "mask_only" / "PanTS_00000035"
    image_dir.mkdir(parents=True)
    mask_dir.mkdir(parents=True)
    affine = np.eye(4)
    ct = np.zeros((32, 20, 3), dtype=np.int16)
    mask = np.zeros_like(ct, dtype=np.uint8)
    mask[3:27, 8:10, 1] = 28
    nib.save(nib.Nifti1Image(ct, affine), image_dir / "ct.nii.gz")
    nib.save(nib.Nifti1Image(mask, affine), mask_dir / "combined_labels.nii.gz")
    clock = Clock()
    return LiveRoomStore(tmp_path / "sessions", pants, now=clock), clock


def create_quiz(quiz_store, timer=30):
    store, _ = quiz_store
    metadata, room_key, host_secret = store.create_quiz_room(
        "35",
        "low",
        quiz_pack_id=QUIZ_PACK_ID,
        quiz_timer_seconds=timer,
    )
    store.connect_quiz_host(metadata["room_id"], room_key, host_secret, "host")
    return store, metadata, room_key, host_secret


def roster(*participants: str):
    return [{"participant_id": item, "name": item.upper()} for item in participants]


def answer(store, metadata, key, participant, choice, connected):
    return store.answer_quiz(
        metadata["room_id"], key, participant, participant.upper(), choice, set(connected)
    )


def test_quiz_creation_hashes_separate_host_secret_and_keeps_review_default(quiz_store):
    store, _ = quiz_store
    review, _ = store.create_room("35", "low")
    assert review["mode"] == "review"

    metadata, room_key, host_secret = store.create_quiz_room("35", "low")
    room_dir = store.root / metadata["room_id"]
    stored = json.loads((room_dir / "metadata.json").read_text())
    assert metadata["mode"] == "quiz"
    assert metadata["quiz_pack_id"] == QUIZ_PACK_ID
    assert room_key not in stored and host_secret not in stored
    assert len(stored["key_hash"]) == len(stored["quiz_host_secret_hash"]) == 64
    assert (room_dir / "quiz_answers.json").stat().st_mode & 0o777 == 0o600

    with pytest.raises(LiveRoomError, match="does not match"):
        store.create_quiz_room("34", "low")
    with pytest.raises(LiveRoomError, match="timer"):
        store.create_quiz_room("35", "low", quiz_timer_seconds=45)


def test_host_authorization_answer_privacy_and_immutable_submission(quiz_store):
    store, metadata, key, host_secret = create_quiz(quiz_store)
    room_id = metadata["room_id"]
    blank_mask, _ = store.get_mask_snapshot(room_id, key)
    assert int(np.max(np.asanyarray(nib.load(str(blank_mask)).dataobj))) == 0
    with pytest.raises(LiveRoomError) as locked_reveal:
        store.get_quiz_reveal_segmentation(room_id, key)
    assert locked_reveal.value.code == "quiz_reveal_locked"
    with zipfile.ZipFile(store.build_export(room_id, key)) as archive:
        assert archive.read("edited_labelmap.nii.gz") == blank_mask.read_bytes()

    with pytest.raises(RoomUnauthorized):
        store.start_quiz(room_id, key, "forged", "host", roster("p1"))

    quiz, _ = store.start_quiz(room_id, key, host_secret, "host", roster("p1", "p2"))
    assert quiz["phase"] == "question_open"
    assert quiz["eligible_count"] == 2
    answer(store, metadata, key, "p1", "pancreas", {"p1", "p2"})
    with pytest.raises(LiveRoomError) as duplicate:
        answer(store, metadata, key, "p1", "liver", {"p1", "p2"})
    assert duplicate.value.code == "duplicate_quiz_answer"
    with pytest.raises(LiveRoomError, match="Invalid answer"):
        answer(store, metadata, key, "p2", "forged", {"p1", "p2"})

    snapshot_text = json.dumps(store.get_snapshot(room_id, key))
    event_text = (store.root / room_id / "events.jsonl").read_text()
    forbidden = ("correct_choice_id", "ground_truth", "reveal_mask", "explanation", '"claims"')
    for field in forbidden:
        assert field not in snapshot_text
        assert field not in event_text
    assert "answered_at" not in snapshot_text
    assert "response_ms" not in snapshot_text
    assert "answered_at" not in event_text
    assert store.quiz_context(room_id, key, "p1")["own_submissions"]["organ"]["choice_id"] == "pancreas"
    assert store.quiz_context(room_id, key, "p2")["own_submissions"] == {}
    with zipfile.ZipFile(store.build_export(room_id, key)) as archive:
        assert "quiz_pack.json" not in archive.namelist()
        pre_reveal_text = "\n".join(
            archive.read(name).decode("utf-8", errors="ignore")
            for name in archive.namelist()
            if name.endswith((".json", ".csv", ".html", ".txt"))
        )
        for field in forbidden:
            assert field not in pre_reveal_text


def test_full_round_scores_time_and_consistency_with_late_joiner(quiz_store):
    store, metadata, key, host_secret = create_quiz(quiz_store)
    clock = quiz_store[1]
    room_id = metadata["room_id"]
    store = LiveRoomStore(store.root.parent, store.pants_path, now=clock)
    assert store.quiz_context(room_id, key)["state"]["phase"] == "lobby"
    store.start_quiz(room_id, key, host_secret, "host", roster("p1", "p2"))
    store = LiveRoomStore(store.root.parent, store.pants_path, now=clock)
    assert store.quiz_context(room_id, key)["state"]["phase"] == "question_open"
    choices = [
        {"p1": "pancreas", "p2": "liver"},
        {"p1": "yes", "p2": "yes", "p3": "yes"},
        {"p1": "tail", "p2": "head", "p3": "tail"},
        {"p1": "focal_tail_23mm", "p2": "focal_head_23mm", "p3": "focal_tail_23mm"},
    ]
    participants = ["p1", "p2"]
    for index, selected in enumerate(choices):
        if index == 1:
            participants.append("p3")
        for participant in participants:
            state, _, event = answer(store, metadata, key, participant, selected[participant], participants)
        assert event is not None
        assert state["phase"] == "question_closed"
        store = LiveRoomStore(store.root.parent, store.pants_path, now=clock)
        assert store.quiz_context(room_id, key)["state"]["phase"] == "question_closed"
        revealed, _ = store.reveal_quiz_question(room_id, key, host_secret, "host")
        assert revealed["phase"] == "question_revealed"
        store = LiveRoomStore(store.root.parent, store.pants_path, now=clock)
        assert store.quiz_context(room_id, key)["state"]["phase"] == "question_revealed"
        if index < 3:
            advanced, _ = store.advance_quiz(
                room_id, key, host_secret, "host", roster(*participants, *([] if index else ["p3"]))
            )
            assert advanced["phase"] == "question_open"
            store = LiveRoomStore(store.root.parent, store.pants_path, now=clock)
        else:
            completed, _ = store.advance_quiz(room_id, key, host_secret, "host", roster(*participants))
            assert completed["phase"] == "completed"
            store = LiveRoomStore(store.root.parent, store.pants_path, now=clock)

    final = store.quiz_context(room_id, key, "p1")["state"]
    rows = {item["participant_id"]: item for item in final["leaderboard"]}
    assert rows["p1"]["score"] == 4
    assert rows["p1"]["consistency"]["status"] == "consistent"
    assert rows["p2"]["score"] == 1
    assert rows["p2"]["consistency"]["status"] == "consistent"
    assert rows["p3"]["consistency"]["status"] == "incomplete"
    assert final["reveal"]["viewer_cue"]["show_lesion_overlay"] is True
    assert store.get_quiz_reveal_segmentation(room_id, key)

    blank_mask, _ = store.get_mask_snapshot(room_id, key)
    with zipfile.ZipFile(store.build_export(room_id, key)) as archive:
        summary = json.loads(archive.read("quiz-summary.json"))
        manifest = json.loads(archive.read("manifest.json"))
        assert summary["pack_id"] == QUIZ_PACK_ID
        assert len(summary["revealed_distributions"]) == 4
        assert "quiz_answers.json" not in archive.namelist()
        assert archive.read("edited_labelmap.nii.gz") != blank_mask.read_bytes()
        assert "research and education" in manifest["disclaimer"]


def test_timer_expiry_pause_promotion_and_secret_rotation(quiz_store):
    store, clock = quiz_store
    store, metadata, key, host_secret = create_quiz(quiz_store, timer=15)
    room_id = metadata["room_id"]
    opened, _ = store.start_quiz(room_id, key, host_secret, "host", roster("p1"))
    assert opened["deadline_at"]
    clock.value += timedelta(seconds=5)
    paused, _ = store.disconnect_quiz_host(room_id, "host")
    assert paused["timer_paused"] is True
    assert 9 <= paused["remaining_seconds"] <= 10

    promoted_secret, resumed, _ = store.promote_quiz_host(room_id, "p1")
    assert resumed["timer_paused"] is False
    with pytest.raises(RoomUnauthorized):
        store.close_quiz_question(room_id, key, host_secret, "host")
    clock.value += timedelta(seconds=11)
    due = store.close_quiz_if_due(room_id)
    assert due and due[0]["phase"] == "question_closed"
    store.reveal_quiz_question(room_id, key, promoted_secret, "p1")

    store.disconnect_quiz_host(room_id, "p1")
    second_secret, second_promotion, _ = store.promote_quiz_host(room_id, "p2")
    assert second_promotion["host_connected"] is True
    with pytest.raises(RoomUnauthorized):
        store.advance_quiz(room_id, key, promoted_secret, "p1", roster("p2"))
    store.advance_quiz(room_id, key, second_secret, "p2", roster("p1"))


def test_consistency_flags_contradictions_but_not_coherent_wrong_chain():
    assert consistency_for({
        "organ": "liver",
        "presence": "yes",
        "location": "head",
        "conclusion": "focal_head_23mm",
    })["status"] == "consistent"
    assert consistency_for({
        "organ": "pancreas",
        "presence": "no",
        "location": "tail",
        "conclusion": "focal_tail_23mm",
    })["status"] == "inconsistent"
    assert consistency_for({"organ": "pancreas"})["status"] == "incomplete"


def test_rest_quiz_creation_never_puts_host_secret_in_share_url(quiz_store, monkeypatch):
    store, _ = quiz_store
    monkeypatch.setattr(live_rooms_api, "_store", store)
    live_rooms_api._creation_attempts.clear()
    app = Flask(__name__)
    app.register_blueprint(live_rooms_api.live_rooms_blueprint, url_prefix="/api")
    response = app.test_client().post("/api/live-rooms", json={
        "case_id": "35",
        "resolution": "low",
        "mode": "quiz",
        "quiz_pack_id": QUIZ_PACK_ID,
        "quiz_timer_seconds": 30,
    })
    assert response.status_code == 201
    body = response.get_json()
    assert body["quiz_host_secret"]
    assert body["quiz_host_secret"] not in body["share_url"]
    assert body["share_url"].endswith(f"#{body['room_key']}")


def test_websocket_roles_private_answers_and_host_promotion(quiz_store):
    store = quiz_store[0]
    metadata, key, host_secret = store.create_quiz_room("35", "low")

    async def receive_until(websocket, expected_type, limit=20):
        received = []
        for _ in range(limit):
            message = json.loads(await asyncio.wait_for(websocket.recv(), timeout=2))
            received.append(message)
            if message.get("type") == expected_type:
                return message, received
        raise AssertionError(f"Did not receive {expected_type}: {received}")

    async def scenario():
        service = LiveRoomWebSocketService(store)
        async with serve(service.handler, "127.0.0.1", 0, max_size=512 * 1024) as server:
            port = server.sockets[0].getsockname()[1]
            uri = f"ws://127.0.0.1:{port}/ws/live-rooms/{metadata['room_id']}"

            async with connect(uri) as host, connect(uri) as student:
                await student.send(json.dumps({
                    "type": "hello", "protocol": 1, "room_key": key,
                    "participant_id": "00000000-0000-4000-8000-000000000002",
                    "name": "Student", "last_seq": 0,
                }))
                student_ready = json.loads(await student.recv())
                assert student_ready["self"]["role"] == "student"
                assert metadata["room_id"] not in service.promotion_tasks

                await host.send(json.dumps({
                    "type": "hello", "protocol": 1, "room_key": key,
                    "quiz_host_secret": host_secret,
                    "participant_id": "00000000-0000-4000-8000-000000000001",
                    "name": "Host", "last_seq": 0,
                }))
                host_ready = json.loads(await host.recv())
                assert host_ready["self"]["role"] == "host"
                await receive_until(student, "presence.changed")

                await host.send(json.dumps({"type": "quiz.start"}))
                await receive_until(student, "quiz.personal")
                await student.send(json.dumps({"type": "quiz.answer", "choice_id": "pancreas"}))
                accepted, student_frames = await receive_until(student, "quiz.answer.accepted")
                assert accepted["submission"]["choice_id"] == "pancreas"

                closed, host_frames = await receive_until(host, "quiz.state")
                while closed.get("quiz", {}).get("phase") != "question_closed":
                    closed, more = await receive_until(host, "quiz.state")
                    host_frames.extend(more)
                public_frames = json.dumps(host_frames)
                for field in ("correct_choice_id", "ground_truth", "reveal_mask", "explanation", '"claims"'):
                    assert field not in public_frames
                assert "answered_at" not in public_frames
                assert "response_ms" not in public_frames

            # Host socket is gone. Promote the longest-connected student without
            # waiting through the production 15-second grace in this unit test.
            async with connect(uri) as replacement:
                await replacement.send(json.dumps({
                    "type": "hello", "protocol": 1, "room_key": key,
                    "participant_id": "00000000-0000-4000-8000-000000000003",
                    "name": "Replacement", "last_seq": 0,
                }))
                await replacement.recv()
                promotion = service.promotion_tasks.pop(metadata["room_id"], None)
                if promotion:
                    promotion.cancel()
                await service._promotion_worker(metadata["room_id"], 0)
                promoted, _ = await receive_until(replacement, "quiz.host.promoted")
                assert promoted["quiz_host_secret"] != host_secret
                with pytest.raises(RoomUnauthorized):
                    store.connect_quiz_host(
                        metadata["room_id"], key, host_secret,
                        "00000000-0000-4000-8000-000000000003",
                    )

    asyncio.run(scenario())
