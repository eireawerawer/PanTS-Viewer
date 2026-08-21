from __future__ import annotations

import io
import os
from pathlib import Path

from flask import Flask

import api.api_blueprint as api_routes
from api.api_blueprint import api_blueprint
from constants import Constants
from services.inference_job_queue import InferenceJobQueue


def _client():
    app = Flask(__name__)
    app.register_blueprint(api_blueprint, url_prefix="/api")
    return app.test_client()


def test_image_proxy_rejects_confusing_hostnames_without_requesting_them(monkeypatch):
    def fail_request(*_args, **_kwargs):
        raise AssertionError("untrusted URL reached requests.get")

    monkeypatch.setattr(api_routes.requests, "get", fail_request)

    response = _client().get(
        "/api/proxy-image",
        query_string={"url": "https://huggingface.co.evil.example/image.png"},
    )

    assert response.status_code == 403


def test_image_proxy_disables_redirects_and_rebuilds_trusted_origin(monkeypatch):
    recorded = {}

    class FakeResponse:
        ok = True
        status_code = 200
        content = b"image"
        headers = {"Content-Type": "image/png"}

    def fake_get(url, **kwargs):
        recorded["url"] = url
        recorded.update(kwargs)
        return FakeResponse()

    monkeypatch.setattr(api_routes.requests, "get", fake_get)

    response = _client().get(
        "/api/proxy-image",
        query_string={"url": "https://huggingface.co/org/repo/image.png?download=1"},
    )

    assert response.status_code == 200
    assert recorded["url"] == "https://huggingface.co/org/repo/image.png?download=1"
    assert recorded["allow_redirects"] is False
    assert recorded["timeout"] == 10


def test_mesh_filename_validation_is_bounded_before_regex_work():
    response = _client().get(
        "/api/cases/PanTS_00000035/render_only/" + ("a" * 10000) + ".glb"
    )

    assert response.status_code in {400, 414}


def test_uploaded_file_lookup_never_joins_request_path_segments(tmp_path, monkeypatch):
    sessions_root = tmp_path / "sessions"
    ct_path = sessions_root / "inference" / "safe-session" / "BDMAP_00000001" / "ct.nii.gz"
    ct_path.parent.mkdir(parents=True)
    ct_path.write_bytes(b"scan")
    monkeypatch.setattr(Constants, "SESSIONS_DIR_NAME", str(sessions_root))

    assert api_routes._uploaded_file_candidate(
        "safe-session", "BDMAP_00000001/ct.nii.gz"
    ) == str(ct_path)
    assert api_routes._uploaded_file_candidate("../safe-session", "ct.nii.gz") is None
    assert api_routes._uploaded_file_candidate("safe-session", "../ct.nii.gz") is None
    assert api_routes._uploaded_file_candidate("safe-session", str(ct_path)) is None


def test_inference_queue_copies_stream_to_server_minted_path(tmp_path: Path):
    queue = InferenceJobQueue(str(tmp_path / "queue"))

    job = queue.create_job(io.BytesIO(b"scan"), "../../patient.nii.gz", session_id="session")

    input_path = os.path.realpath(job["input_file_path"])
    inputs_root = os.path.realpath(queue.inputs_dir)
    assert os.path.commonpath([inputs_root, input_path]) == inputs_root
    assert input_path.endswith(".nii.gz")
    assert Path(input_path).read_bytes() == b"scan"
    assert queue.get_job("../not-a-job") is None
