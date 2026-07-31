from __future__ import annotations

from datetime import datetime, timedelta, timezone
from pathlib import Path

import nibabel as nib
import numpy as np
import pytest

from services.education_store import (
    AttemptAlreadySubmitted,
    AttemptDeadlinePassed,
    AttemptExpired,
    AttemptUnauthorized,
    CHALLENGE_ID,
    EducationStore,
)


class Clock:
    def __init__(self) -> None:
        self.value = datetime(2026, 7, 31, 12, 0, tzinfo=timezone.utc)

    def __call__(self) -> datetime:
        return self.value


def passing_grader(**_kwargs):
    return {
        "reply": "Good localization and a calibrated focal-lesion impression.",
        "actions": [
            {"criterion": "finding", "score": 10},
            {"criterion": "location", "score": 9},
            {"criterion": "evidence", "score": 8},
            {"criterion": "impression", "score": 9},
        ],
        "intent": "education_rubric",
    }


@pytest.fixture
def education_store(tmp_path: Path):
    pants = tmp_path / "pants"
    mask_dir = pants / "mask_only" / "PanTS_00000035"
    mask_dir.mkdir(parents=True)
    mask = np.zeros((12, 12, 5), dtype=np.uint8)
    mask[4:7, 4:7, 2] = 22
    mask[2:4, 4:7, 2] = 19
    nib.save(nib.Nifti1Image(mask, np.eye(4)), mask_dir / "combined_labels.nii.gz")
    return EducationStore(tmp_path / "sessions", pants, now=Clock(), grader=passing_grader)


def valid_submission():
    return {
        "finding_choice": "focal_pancreatic_lesion",
        "marker_lps": [-5, -5, 2],
        "measurement": {"points": [[-4, -4, 2], [-6, -6, 2]]},
        "impression": "Focal pancreatic lesion near the pancreatic head, measuring approximately 3 mm.",
    }


def test_challenge_hides_ground_truth(education_store):
    challenge = education_store.challenge(CHALLENGE_ID)
    assert challenge["case_id"] == "35"
    assert challenge["time_limit_seconds"] == 300
    assert "correct_finding" not in challenge
    assert "ground_truth" not in challenge


def test_attempt_scores_objective_and_ai_components(education_store):
    attempt, key = education_store.start_attempt(CHALLENGE_ID)
    result = education_store.submit(attempt["attempt_id"], key, valid_submission())

    assert result["status"] == "graded"
    assert result["scores"]["localization"]["points"] == 35
    assert result["scores"]["measurement"]["points"] == 15
    assert result["scores"]["finding"]["points"] == 10
    assert result["ai_grade"]["points"] == 36
    assert result["total_points"] == 96
    assert result["ground_truth"]["correct_finding"] == "focal_pancreatic_lesion"

    with pytest.raises(AttemptAlreadySubmitted):
        education_store.submit(attempt["attempt_id"], key, valid_submission())


def test_attempt_key_is_required(education_store):
    attempt, _ = education_store.start_attempt(CHALLENGE_ID)
    with pytest.raises(AttemptUnauthorized):
        education_store.submit(attempt["attempt_id"], "wrong", valid_submission())


def test_ai_failure_keeps_provisional_objective_score(education_store):
    def failed_grader(**_kwargs):
        raise RuntimeError("offline")

    education_store._grader = failed_grader
    attempt, key = education_store.start_attempt(CHALLENGE_ID)
    result = education_store.submit(attempt["attempt_id"], key, valid_submission())

    assert result["status"] == "provisional"
    assert result["objective_points"] == 60
    assert result["total_points"] is None
    assert result["ai_grade"]["points"] is None
    tutor = education_store.tutor(attempt["attempt_id"], key, "What did I miss?")
    assert tutor["available"] is False


def test_provisional_ai_grade_can_be_retried(education_store):
    education_store._grader = lambda **_kwargs: (_ for _ in ()).throw(RuntimeError("offline"))
    attempt, key = education_store.start_attempt(CHALLENGE_ID)
    result = education_store.submit(attempt["attempt_id"], key, valid_submission())
    assert result["status"] == "provisional"

    education_store._grader = passing_grader
    retried = education_store.retry_grade(attempt["attempt_id"], key)

    assert retried["status"] == "graded"
    assert retried["total_points"] == 96
    assert education_store.result(attempt["attempt_id"], key)["status"] == "graded"


def test_attempt_expires_and_cleanup_removes_it(education_store):
    attempt, key = education_store.start_attempt(CHALLENGE_ID)
    education_store._now.value += timedelta(hours=24, seconds=1)

    with pytest.raises(AttemptExpired):
        education_store.result(attempt["attempt_id"], key)

    assert education_store.cleanup_expired() == [attempt["attempt_id"]]
    assert not (education_store.root / attempt["attempt_id"]).exists()


def test_submission_window_is_server_enforced(education_store):
    attempt, key = education_store.start_attempt(CHALLENGE_ID)
    education_store._now.value += timedelta(minutes=5, seconds=16)

    with pytest.raises(AttemptDeadlinePassed):
        education_store.submit(attempt["attempt_id"], key, valid_submission())
