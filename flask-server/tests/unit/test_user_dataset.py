"""Unit tests for the user-dataset admission gatekeeper (services/user_dataset.py).

Pure-logic gates (quota, dedup, registry, case-id, rejection audit) run always.
The CT/mask-loading gates need nibabel and are guarded with importorskip.
"""
import importlib
import json
import os

import pytest


@pytest.fixture()
def ud(tmp_path, monkeypatch):
    """Fresh module bound to a temp dataset root."""
    monkeypatch.setenv("USER_DATASET_PATH", str(tmp_path / "UserData"))
    # small quotas so the tests can trip them
    monkeypatch.setenv("USER_DATASET_DAILY_PER_USER", "2")
    monkeypatch.setenv("USER_DATASET_DAILY_PER_IP", "3")
    monkeypatch.setenv("USER_DATASET_DAILY_GLOBAL", "5")
    monkeypatch.setenv("USER_DATASET_MIN_ORGAN_VOXELS", "100")
    monkeypatch.setenv("USER_DATASET_MIN_DISTINCT_ORGANS", "2")
    import services.user_dataset as m
    importlib.reload(m)
    return m


# --------------------------- pure logic ---------------------------
def test_quota_per_user_ip_global(ud):
    now = 1000.0
    reg = {"events": []}
    # per-user cap = 2
    reg["events"] = [{"ts": now, "user_id": "u1", "ip": "a"} for _ in range(2)]
    ok, reason = ud.check_quota(reg, "u1", "a", now)
    assert not ok and reason == "user_quota"
    # a different user is fine (but ip cap = 3 not yet hit)
    ok, _ = ud.check_quota(reg, "u2", "b", now)
    assert ok
    # per-ip cap = 3
    reg["events"] = [{"ts": now, "user_id": f"u{i}", "ip": "x"} for i in range(3)]
    ok, reason = ud.check_quota(reg, "u9", "x", now)
    assert not ok and reason == "ip_quota"
    # global cap = 5
    reg["events"] = [{"ts": now, "user_id": f"u{i}", "ip": f"ip{i}"} for i in range(5)]
    ok, reason = ud.check_quota(reg, "new", "new", now)
    assert not ok and reason == "global_quota"


def test_quota_prunes_old_events(ud):
    now = 1_000_000.0
    reg = {"events": [{"ts": now - 48 * 3600, "user_id": "u1", "ip": "a"} for _ in range(9)]}
    ud._prune_events(reg, now)
    assert reg["events"] == []
    ok, _ = ud.check_quota(reg, "u1", "a", now)
    assert ok  # stale events don't count


def test_registry_roundtrip_atomic(ud, tmp_path):
    root = ud._root()
    os.makedirs(root, exist_ok=True)
    reg = ud._load_registry(root)
    assert reg["next_id"] == 1 and reg["sha256"] == {}
    reg["next_id"] = 7
    ud._save_registry(root, reg)
    assert ud._load_registry(root)["next_id"] == 7


def test_evaluate_dedup_and_admit_flow(ud, monkeypatch):
    """Drive the full admit flow with the NIfTI-dependent gates stubbed, so the
    quota/dedup/promotion/registry bookkeeping is exercised without nibabel."""
    monkeypatch.setattr(ud, "validate_ct", lambda p: (True, "ok"))
    monkeypatch.setattr(ud, "segmentation_quality_ok",
                        lambda p: (True, "ok", {"organ_voxels": 999, "distinct_organs": 5}))
    monkeypatch.setattr(ud, "fingerprints", lambda p: ("SHA", "PH"))
    monkeypatch.setattr(ud, "_promote", lambda *a, **k: None)  # skip file copies

    root = ud._root(); os.makedirs(root, exist_ok=True)
    now = 2000.0
    reg = ud._load_registry(root)
    accepted, reason, extra = ud.evaluate("ct", "mask", reg, "u1", "1.2.3.4", now)
    assert accepted and extra["sha256"] == "SHA"
    # simulate the commit
    reg["sha256"]["SHA"] = "USER_00000001"; reg["phash"]["PH"] = "USER_00000001"
    # a re-upload of the same content is now an exact duplicate
    accepted, reason, _ = ud.evaluate("ct", "mask", reg, "u1", "1.2.3.4", now)
    assert not accepted and reason == "duplicate_exact"


# --------------------------- NIfTI-dependent ---------------------------
def _write_nifti(path, arr, affine=None):
    import numpy as np
    import nibabel as nib
    if affine is None:
        affine = np.eye(4)
    nib.save(nib.Nifti1Image(arr, affine), path)


def test_validate_ct_accepts_real_ct_and_rejects_garbage(ud, tmp_path):
    np = pytest.importorskip("numpy")
    pytest.importorskip("nibabel")
    # a plausible CT: air background (-1000) with a tissue/bone blob
    vol = np.full((64, 64, 64), -1000.0, dtype="float32")
    vol[20:40, 20:40, 20:40] = 60.0
    vol[30:34, 30:34, 30:34] = 400.0
    ct = str(tmp_path / "ct.nii.gz"); _write_nifti(ct, vol)
    ok, reason = ud.validate_ct(ct)
    assert ok, reason

    # constant volume -> rejected
    flat = str(tmp_path / "flat.nii.gz"); _write_nifti(flat, np.zeros((64, 64, 64), "float32"))
    ok, reason = ud.validate_ct(flat)
    assert not ok and reason in ("constant_volume", "non_ct_intensity:[0,0]")

    # non-CT intensities (all positive, no air) -> rejected
    pos = np.full((64, 64, 64), 50.0, dtype="float32"); pos[0, 0, 0] = 90.0
    posf = str(tmp_path / "pos.nii.gz"); _write_nifti(posf, pos)
    ok, reason = ud.validate_ct(posf)
    assert not ok

    # 2D image -> rejected
    twod = str(tmp_path / "2d.nii.gz"); _write_nifti(twod, np.zeros((64, 64, 1), "float32"))
    ok, reason = ud.validate_ct(twod)
    assert not ok and reason.startswith("not_3d")


def test_segmentation_quality_gate(ud, tmp_path):
    np = pytest.importorskip("numpy")
    pytest.importorskip("nibabel")
    # a mask with several organs, plenty of voxels
    mask = np.zeros((64, 64, 64), "uint8")
    mask[10:30, 10:30, 10:30] = 14   # liver
    mask[35:45, 35:45, 35:45] = 17   # pancreas
    good = str(tmp_path / "m.nii.gz"); _write_nifti(good, mask)
    ok, reason, stats = ud.segmentation_quality_ok(good)
    assert ok and stats["distinct_organs"] == 2

    empty = str(tmp_path / "e.nii.gz"); _write_nifti(empty, np.zeros((64, 64, 64), "uint8"))
    ok, reason, _ = ud.segmentation_quality_ok(empty)
    assert not ok


def test_fingerprints_deterministic(ud, tmp_path):
    np = pytest.importorskip("numpy")
    pytest.importorskip("nibabel")
    vol = np.random.RandomState(0).uniform(-1000, 500, (48, 48, 48)).astype("float32")
    ct = str(tmp_path / "ct.nii.gz"); _write_nifti(ct, vol)
    a = ud.fingerprints(ct)
    b = ud.fingerprints(ct)
    assert a == b and len(a[0]) == 64


def test_admit_and_store_end_to_end(ud, tmp_path):
    np = pytest.importorskip("numpy")
    pytest.importorskip("nibabel")
    vol = np.full((64, 64, 64), -1000.0, dtype="float32")
    vol[20:40, 20:40, 20:40] = 60.0
    vol[30:34, 30:34, 30:34] = 400.0
    ct = str(tmp_path / "ct.nii.gz"); _write_nifti(ct, vol)

    out = tmp_path / "out"; out.mkdir()
    mask = np.zeros((64, 64, 64), "uint8")
    mask[10:30, 10:30, 10:30] = 14
    mask[35:45, 35:45, 35:45] = 17
    _write_nifti(str(out / "combined_labels.nii.gz"), mask)

    ud._admit_and_store(ct, str(out), "ePAI", "u1", "1.2.3.4", "sess1")

    root = ud._root()
    assert os.path.exists(os.path.join(root, "image_only", "USER_00000001", "ct.nii.gz"))
    md = os.path.join(root, "mask_only", "USER_00000001", "metadata.json")
    assert os.path.exists(md)
    meta = json.load(open(md))
    assert meta["model"] == "ePAI" and "liver" in meta["organs"]
    # per-organ sublabels written
    assert os.path.exists(os.path.join(root, "mask_only", "USER_00000001", "segmentations", "liver.nii.gz"))

    # a second identical scan is rejected as a duplicate (logged, not stored)
    ud._admit_and_store(ct, str(out), "ePAI", "u1", "1.2.3.4", "sess2")
    assert not os.path.exists(os.path.join(root, "image_only", "USER_00000002"))
    rej = os.path.join(root, "rejections.jsonl")
    assert os.path.exists(rej)
    reasons = [json.loads(l)["reason"] for l in open(rej)]
    assert "duplicate_exact" in reasons
