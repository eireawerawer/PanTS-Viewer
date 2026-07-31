"""Server-owned education challenges, attempts, and deterministic scoring."""

from __future__ import annotations

import hashlib
import hmac
import json
import math
import os
import secrets
import shutil
import tempfile
import threading
import uuid
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable, Iterator

import nibabel as nib
import numpy as np
from scipy.spatial import ConvexHull, distance

from services.advanced_analysis import lps_to_ijk
from services.ollama_client import DEFAULT_OLLAMA_MODEL, chat_json

try:
    import fcntl
except ImportError:  # pragma: no cover
    fcntl = None


CHALLENGE_ID = "pancreas-case-35"
CASE_ID = "35"
LESION_LABEL = 22
TIME_LIMIT_SECONDS = 300
SUBMISSION_GRACE_SECONDS = 15
ATTEMPT_RETENTION = timedelta(hours=24)
MAX_IMPRESSION_LENGTH = 2_000
MAX_TUTOR_MESSAGE_LENGTH = 1_000

FINDING_CHOICES = [
    {"id": "no_focal_lesion", "label": "No focal pancreatic lesion"},
    {"id": "focal_pancreatic_lesion", "label": "Focal pancreatic lesion"},
    {"id": "diffuse_pancreatic_abnormality", "label": "Diffuse pancreatic abnormality"},
    {"id": "extra_pancreatic_abnormality", "label": "Abnormality centered outside the pancreas"},
]

PUBLIC_CHALLENGE = {
    "challenge_id": CHALLENGE_ID,
    "case_id": CASE_ID,
    "title": "Pancreatic lesion time trial",
    "eyebrow": "BodyMaps Solo Challenge 01",
    "prompt": "Review the abdominal CT, identify the most important focal finding, and submit a concise radiology impression.",
    "time_limit_seconds": TIME_LIMIT_SECONDS,
    "finding_choices": FINDING_CHOICES,
    "requirements": [
        "Choose the best imaging finding",
        "Place the crosshair on the lesion",
        "Measure its maximum axial diameter",
        "Write a concise impression",
    ],
    "scoring": {
        "localization": 35,
        "measurement": 15,
        "finding": 10,
        "impression": 40,
        "time": "tie_break",
    },
}


class EducationError(RuntimeError):
    status_code = 400
    code = "invalid_request"


class ChallengeNotFound(EducationError):
    status_code = 404
    code = "challenge_not_found"


class AttemptNotFound(EducationError):
    status_code = 404
    code = "attempt_not_found"


class AttemptUnauthorized(EducationError):
    status_code = 401
    code = "invalid_attempt_key"


class AttemptAlreadySubmitted(EducationError):
    status_code = 409
    code = "attempt_already_submitted"


class AttemptExpired(EducationError):
    status_code = 410
    code = "attempt_expired"


class AttemptDeadlinePassed(EducationError):
    status_code = 409
    code = "attempt_deadline_passed"


class AIGradeUnavailable(EducationError):
    status_code = 503
    code = "ai_grade_unavailable"


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def isoformat(value: datetime) -> str:
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def parse_time(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def _hash_secret(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _clean_text(value: Any, limit: int, *, required: bool = True) -> str:
    if not isinstance(value, str):
        raise EducationError("Text value must be a string")
    cleaned = "".join(ch for ch in value if ch in "\n\t" or ord(ch) >= 32).strip()
    if required and not cleaned:
        raise EducationError("Text value cannot be empty")
    if len(cleaned) > limit:
        raise EducationError(f"Text value exceeds {limit} characters")
    return cleaned


def _point(value: Any, label: str) -> list[float] | None:
    if value is None:
        return None
    if not isinstance(value, list) or len(value) != 3:
        raise EducationError(f"{label} must contain three coordinates")
    result = [float(item) for item in value]
    if not all(math.isfinite(item) for item in result):
        raise EducationError(f"{label} coordinates must be finite")
    return result


def _atomic_json(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            json.dump(value, stream, ensure_ascii=False, separators=(",", ":"))
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    except Exception:
        Path(temporary).unlink(missing_ok=True)
        raise


def _score_localization(mask: np.ndarray, affine: np.ndarray, marker_lps: list[float] | None) -> dict[str, Any]:
    if marker_lps is None:
        return {"points": 0, "max_points": 35, "distance_mm": None, "inside_lesion": False}
    ijk = np.asarray(lps_to_ijk(affine, marker_lps), dtype=int)
    shape = np.asarray(mask.shape[:3], dtype=int)
    if np.all(ijk >= 0) and np.all(ijk < shape) and int(mask[tuple(ijk)]) == LESION_LABEL:
        return {"points": 35, "max_points": 35, "distance_mm": 0.0, "inside_lesion": True}
    lesion_ijk = np.argwhere(mask == LESION_LABEL)
    if lesion_ijk.size == 0:
        return {"points": 0, "max_points": 35, "distance_mm": None, "inside_lesion": False}
    marker_ras = np.asarray([-marker_lps[0], -marker_lps[1], marker_lps[2]], dtype=float)
    lesion_ras = nib.affines.apply_affine(affine, lesion_ijk)
    nearest = float(np.min(np.linalg.norm(lesion_ras - marker_ras, axis=1)))
    points = 20 if nearest <= 10 else 10 if nearest <= 25 else 0
    return {"points": points, "max_points": 35, "distance_mm": round(nearest, 1), "inside_lesion": False}


def _line_intersects_lesion(mask: np.ndarray, affine: np.ndarray, start: list[float], end: list[float]) -> bool:
    for point in np.linspace(np.asarray(start), np.asarray(end), 160):
        ijk = np.asarray(lps_to_ijk(affine, point), dtype=int)
        if np.all(ijk >= 0) and np.all(ijk < np.asarray(mask.shape[:3])) and int(mask[tuple(ijk)]) == LESION_LABEL:
            return True
    return False


def _maximum_axial_diameter(mask: np.ndarray, affine: np.ndarray) -> tuple[float, list[list[float]]]:
    best_distance = 0.0
    best_points: list[list[float]] = []
    for slice_index in np.unique(np.argwhere(mask == LESION_LABEL)[:, 2]):
        points_ijk = np.argwhere(mask[:, :, int(slice_index)] == LESION_LABEL)
        if len(points_ijk) < 2:
            continue
        points_ijk = np.column_stack([points_ijk, np.full(len(points_ijk), int(slice_index))])
        points_ras = nib.affines.apply_affine(affine, points_ijk)
        planar = points_ras[:, :2]
        try:
            hull_indices = ConvexHull(planar).vertices if len(planar) >= 3 else np.arange(len(planar))
        except Exception:
            hull_indices = np.arange(len(planar))
        hull = planar[hull_indices]
        if len(hull) < 2:
            continue
        condensed = distance.pdist(hull)
        pair_index = int(np.argmax(condensed))
        row, column = np.triu_indices(len(hull), 1)
        first = int(hull_indices[row[pair_index]])
        second = int(hull_indices[column[pair_index]])
        diameter = float(condensed[pair_index])
        if diameter <= best_distance:
            continue
        best_distance = diameter
        endpoints_ras = points_ras[[first, second]]
        best_points = [[-float(p[0]), -float(p[1]), float(p[2])] for p in endpoints_ras]
    return best_distance, best_points


def _score_measurement(
    mask: np.ndarray,
    affine: np.ndarray,
    measurement: dict[str, Any] | None,
    reference_mm: float,
) -> dict[str, Any]:
    base = {"points": 0, "max_points": 15, "measured_mm": None, "reference_mm": round(reference_mm, 1), "error_percent": None, "crosses_lesion": False}
    if not isinstance(measurement, dict):
        return base
    points = measurement.get("points")
    if not isinstance(points, list) or len(points) != 2:
        return base
    start = _point(points[0], "measurement start")
    end = _point(points[1], "measurement end")
    if start is None or end is None:
        return base
    measured = float(np.linalg.norm(np.asarray(end) - np.asarray(start)))
    crosses = _line_intersects_lesion(mask, affine, start, end)
    axial = abs(start[2] - end[2]) <= max(2.5, float(nib.affines.voxel_sizes(affine)[2]))
    error = abs(measured - reference_mm) / reference_mm * 100 if reference_mm > 0 else 100.0
    points_awarded = 15 if crosses and axial and error <= 20 else 7.5 if crosses and axial and error <= 40 else 0
    return {
        "points": points_awarded,
        "max_points": 15,
        "measured_mm": round(measured, 1),
        "reference_mm": round(reference_mm, 1),
        "error_percent": round(error, 1),
        "crosses_lesion": crosses,
        "axial": axial,
    }


def _anatomic_location(mask: np.ndarray, affine: np.ndarray) -> str:
    lesion = np.argwhere(mask == LESION_LABEL)
    if lesion.size == 0:
        return "pancreas"
    lesion_center = nib.affines.apply_affine(affine, lesion.mean(axis=0))
    labels = {18: "pancreatic body", 19: "pancreatic head", 20: "pancreatic tail"}
    candidates: list[tuple[float, str]] = []
    for label, name in labels.items():
        points = np.argwhere(mask == label)
        if points.size:
            center = nib.affines.apply_affine(affine, points.mean(axis=0))
            candidates.append((float(np.linalg.norm(center - lesion_center)), name))
    return min(candidates)[1] if candidates else "pancreas"


def _validate_rubric(value: Any) -> tuple[dict[str, int], str] | None:
    if not isinstance(value, dict) or not isinstance(value.get("actions"), list):
        return None
    scores: dict[str, int] = {}
    for item in value["actions"]:
        if not isinstance(item, dict):
            continue
        criterion = str(item.get("criterion", ""))
        if criterion not in {"finding", "location", "evidence", "impression"}:
            continue
        try:
            scores[criterion] = max(0, min(10, int(round(float(item.get("score", 0))))))
        except (TypeError, ValueError):
            continue
    if set(scores) != {"finding", "location", "evidence", "impression"}:
        return None
    reply = _clean_text(value.get("reply", ""), 4_000)
    return scores, reply


class EducationStore:
    def __init__(
        self,
        sessions_dir: str | os.PathLike[str],
        pants_path: str | os.PathLike[str],
        *,
        now: Callable[[], datetime] = utcnow,
        grader: Callable[..., dict[str, Any]] = chat_json,
    ) -> None:
        self.root = Path(sessions_dir).resolve() / "education_attempts"
        self.root.mkdir(parents=True, exist_ok=True)
        self.pants_path = Path(pants_path).resolve()
        self._now = now
        self._grader = grader
        self._locks: dict[str, threading.RLock] = {}
        self._locks_guard = threading.Lock()

    @staticmethod
    def challenge(challenge_id: str) -> dict[str, Any]:
        if challenge_id != CHALLENGE_ID:
            raise ChallengeNotFound("Challenge not found")
        return dict(PUBLIC_CHALLENGE)

    def _mask_path(self) -> Path:
        path = self.pants_path / "mask_only" / "PanTS_00000035" / "combined_labels.nii.gz"
        if not path.is_file():
            raise EducationError("Case 35 ground-truth segmentation is unavailable")
        return path

    @staticmethod
    def _attempt_id(value: str) -> str:
        try:
            parsed = uuid.UUID(str(value))
        except (ValueError, AttributeError) as exc:
            raise AttemptNotFound("Attempt not found") from exc
        return str(parsed)

    def _attempt_dir(self, attempt_id: str) -> Path:
        return self.root / self._attempt_id(attempt_id)

    @contextmanager
    def _locked(self, attempt_id: str) -> Iterator[Path]:
        attempt_id = self._attempt_id(attempt_id)
        with self._locks_guard:
            lock = self._locks.setdefault(attempt_id, threading.RLock())
        with lock:
            directory = self._attempt_dir(attempt_id)
            if not (directory / "attempt.json").is_file():
                raise AttemptNotFound("Attempt not found")
            with (directory / ".lock").open("a+b") as lock_file:
                if fcntl is not None:
                    fcntl.flock(lock_file.fileno(), fcntl.LOCK_EX)
                try:
                    yield directory
                finally:
                    if fcntl is not None:
                        fcntl.flock(lock_file.fileno(), fcntl.LOCK_UN)

    @staticmethod
    def _read(path: Path) -> dict[str, Any]:
        try:
            value = json.loads(path.read_text(encoding="utf-8"))
        except (FileNotFoundError, json.JSONDecodeError) as exc:
            raise AttemptNotFound("Attempt not found") from exc
        if not isinstance(value, dict):
            raise AttemptNotFound("Attempt not found")
        return value

    @staticmethod
    def _public_attempt(attempt: dict[str, Any]) -> dict[str, Any]:
        return {key: attempt[key] for key in ("attempt_id", "challenge_id", "started_at", "deadline_at", "delete_at", "status") if key in attempt}

    def start_attempt(self, challenge_id: str) -> tuple[dict[str, Any], str]:
        self.challenge(challenge_id)
        self._mask_path()
        attempt_id = str(uuid.uuid4())
        key = secrets.token_urlsafe(32)
        started = self._now()
        attempt = {
            "attempt_id": attempt_id,
            "challenge_id": challenge_id,
            "key_hash": _hash_secret(key),
            "started_at": isoformat(started),
            "deadline_at": isoformat(started + timedelta(seconds=TIME_LIMIT_SECONDS)),
            "delete_at": isoformat(started + ATTEMPT_RETENTION),
            "status": "active",
        }
        directory = self.root / attempt_id
        directory.mkdir(mode=0o700)
        _atomic_json(directory / "attempt.json", attempt)
        return self._public_attempt(attempt), key

    def _authorized(self, directory: Path, key: str) -> dict[str, Any]:
        attempt = self._read(directory / "attempt.json")
        if not key or not hmac.compare_digest(_hash_secret(key), attempt.get("key_hash", "")):
            raise AttemptUnauthorized("Invalid attempt key")
        if parse_time(attempt["delete_at"]) <= self._now():
            raise AttemptExpired("Attempt has expired")
        return attempt

    def _ground_truth(self) -> tuple[np.ndarray, np.ndarray, dict[str, Any]]:
        image = nib.load(str(self._mask_path()))
        mask = np.asanyarray(image.dataobj)
        if not np.any(mask == LESION_LABEL):
            raise EducationError("Case 35 lesion ground truth is unavailable")
        reference_mm, endpoints = _maximum_axial_diameter(mask, image.affine)
        location = _anatomic_location(mask, image.affine)
        return mask, image.affine, {
            "correct_finding": "focal_pancreatic_lesion",
            "correct_finding_label": "Focal pancreatic lesion",
            "location": location,
            "reference_diameter_mm": round(reference_mm, 1),
            "reference_measurement_lps": endpoints,
            "teaching_points": [
                f"The hidden annotation identifies a focal lesion centered near the {location}.",
                "Measure the maximum lesion diameter on the axial slice where it appears largest.",
                "A concise impression should identify the focal pancreatic finding, its location, and the main supporting observation without claiming unsupported histology.",
            ],
        }

    def _grade_impression(self, impression: str, ground_truth: dict[str, Any], objective: dict[str, Any]) -> dict[str, Any]:
        system_prompt = """
You are grading a low-stakes medical-student CT interpretation exercise. Grade clinical content, not prose style. Use only the supplied ground truth. Award an integer from 0 to 10 for each criterion: finding, location, evidence, impression. A calibrated impression does not invent histology. Return JSON only as {"reply":"brief specific teaching feedback","actions":[{"criterion":"finding","score":0},{"criterion":"location","score":0},{"criterion":"evidence","score":0},{"criterion":"impression","score":0}],"intent":"education_rubric"}.
""".strip()
        response = self._grader(
            model=DEFAULT_OLLAMA_MODEL,
            system_prompt=system_prompt,
            user_prompt=json.dumps({
                "student_impression": impression,
                "ground_truth": ground_truth,
                "objective_result": objective,
            }, ensure_ascii=False),
            temperature=0.0,
        )
        validated = _validate_rubric(response)
        if validated is None:
            raise EducationError("AI rubric returned an invalid result")
        scores, feedback = validated
        return {
            "status": "graded",
            "model": DEFAULT_OLLAMA_MODEL,
            "rubric_version": 1,
            "criteria": scores,
            "points": sum(scores.values()),
            "max_points": 40,
            "feedback": feedback,
        }

    def submit(self, attempt_id: str, key: str, payload: dict[str, Any]) -> dict[str, Any]:
        with self._locked(attempt_id) as directory:
            attempt = self._authorized(directory, key)
            if attempt.get("status") != "active":
                raise AttemptAlreadySubmitted("Attempt has already been submitted")
            submitted = self._now()
            deadline = parse_time(attempt["deadline_at"]) + timedelta(seconds=SUBMISSION_GRACE_SECONDS)
            if submitted > deadline:
                raise AttemptDeadlinePassed("The submission window has closed")
            finding = _clean_text(payload.get("finding_choice", ""), 80)
            if finding not in {choice["id"] for choice in FINDING_CHOICES}:
                raise EducationError("Choose a valid imaging finding")
            impression = _clean_text(payload.get("impression", ""), MAX_IMPRESSION_LENGTH)
            marker = _point(payload.get("marker_lps"), "marker")
            measurement = payload.get("measurement") if isinstance(payload.get("measurement"), dict) else None
            mask, affine, ground_truth = self._ground_truth()
            localization = _score_localization(mask, affine, marker)
            measurement_score = _score_measurement(mask, affine, measurement, float(ground_truth["reference_diameter_mm"]))
            finding_score = {"points": 10 if finding == ground_truth["correct_finding"] else 0, "max_points": 10, "selected": finding, "correct": ground_truth["correct_finding"]}
            objective = {
                "localization": localization,
                "measurement": measurement_score,
                "finding": finding_score,
            }
            objective_points = float(localization["points"]) + float(measurement_score["points"]) + float(finding_score["points"])
            elapsed = min(TIME_LIMIT_SECONDS, max(0, round((submitted - parse_time(attempt["started_at"])).total_seconds())))
            try:
                ai_grade = self._grade_impression(impression, ground_truth, objective)
                status = "graded"
            except Exception:
                ai_grade = {
                    "status": "provisional",
                    "model": DEFAULT_OLLAMA_MODEL,
                    "rubric_version": 1,
                    "criteria": None,
                    "points": None,
                    "max_points": 40,
                    "feedback": None,
                }
                status = "provisional"
            total = round(objective_points + (float(ai_grade["points"]) if ai_grade["points"] is not None else 0), 1)
            result = {
                "attempt_id": attempt_id,
                "challenge_id": CHALLENGE_ID,
                "status": status,
                "submitted_at": isoformat(submitted),
                "elapsed_seconds": elapsed,
                "objective_points": round(objective_points, 1),
                "total_points": total if status == "graded" else None,
                "max_points": 100,
                "scores": objective,
                "ai_grade": ai_grade,
                "ground_truth": ground_truth,
                "student": {
                    "finding_choice": finding,
                    "marker_lps": marker,
                    "measurement": measurement,
                    "impression": impression,
                },
            }
            attempt["status"] = status
            attempt["result"] = result
            _atomic_json(directory / "attempt.json", attempt)
            return result

    def result(self, attempt_id: str, key: str) -> dict[str, Any]:
        with self._locked(attempt_id) as directory:
            attempt = self._authorized(directory, key)
            result = attempt.get("result")
            if not isinstance(result, dict):
                raise EducationError("Attempt has not been submitted")
            return result

    def retry_grade(self, attempt_id: str, key: str) -> dict[str, Any]:
        with self._locked(attempt_id) as directory:
            attempt = self._authorized(directory, key)
            result = attempt.get("result")
            if not isinstance(result, dict):
                raise EducationError("Submit the challenge before retrying the AI grade")
            if result.get("status") == "graded":
                return result
            try:
                ai_grade = self._grade_impression(
                    result["student"]["impression"],
                    result["ground_truth"],
                    result["scores"],
                )
            except Exception as exc:
                raise AIGradeUnavailable("AI grading remains unavailable; your objective score is preserved") from exc
            result["status"] = "graded"
            result["ai_grade"] = ai_grade
            result["total_points"] = round(float(result["objective_points"]) + float(ai_grade["points"]), 1)
            attempt["status"] = "graded"
            attempt["result"] = result
            _atomic_json(directory / "attempt.json", attempt)
            return result

    def tutor(self, attempt_id: str, key: str, message: str) -> dict[str, Any]:
        with self._locked(attempt_id) as directory:
            attempt = self._authorized(directory, key)
            result = attempt.get("result")
            if not isinstance(result, dict):
                raise EducationError("Submit the challenge before opening the tutor")
            clean_message = _clean_text(message, MAX_TUTOR_MESSAGE_LENGTH)
            if result.get("status") != "graded":
                return {"available": False, "reply": "The AI tutor is unavailable. Use the revealed overlay and teaching points to review this case."}
            try:
                response = self._grader(
                    model=DEFAULT_OLLAMA_MODEL,
                    system_prompt="You are a concise medical-imaging tutor reviewing a completed low-stakes exercise. Use only the supplied attempt and ground truth. Explain reasoning, acknowledge uncertainty, and do not invent pathology or personalized medical advice. Return JSON with reply, empty actions, and intent education_tutor.",
                    user_prompt=json.dumps({"question": clean_message, "completed_attempt": result}, ensure_ascii=False),
                    temperature=0.2,
                )
                reply = _clean_text(response.get("reply", ""), 4_000)
            except Exception:
                return {"available": False, "reply": "The AI tutor is temporarily unavailable. Use the revealed overlay and teaching points to review this case."}
            return {"available": True, "reply": reply, "model": DEFAULT_OLLAMA_MODEL}

    def cleanup_expired(self) -> list[str]:
        removed: list[str] = []
        for child in list(self.root.iterdir()):
            if not child.is_dir():
                continue
            try:
                attempt_id = self._attempt_id(child.name)
                with self._locked(attempt_id) as directory:
                    attempt = self._read(directory / "attempt.json")
                    if parse_time(attempt["delete_at"]) > self._now():
                        continue
                shutil.rmtree(child, ignore_errors=True)
                if not child.exists():
                    removed.append(attempt_id)
            except (EducationError, OSError, ValueError, KeyError):
                continue
        return removed
