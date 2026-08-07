"""Guards viewerLabels.json (../../PanTS-Demo/src/helpers/viewerLabels.json) and its
backend consumers against drifting apart. See services/viewer_labels.py's module
docstring for the history -- before that module existed, ids 1-35 were hand-copied
into three separate places and silently fell out of sync whenever one was extended
(mesh generation and organ stats went on quietly ignoring every media-agentic-ai
organ added elsewhere until someone happened to notice).

The JSON-only checks below need nothing beyond the standard library and
services.viewer_labels (itself dependency-light -- json/os only), so they run in
every CI environment including the lightweight backend-security job (see ci.yml).
test_mesh_generation_labels_* additionally needs nibabel/scikit-image/trimesh
(mesh_generation.py's real deps, not installed by that job on purpose) and skips
itself via importorskip when they're unavailable -- run the full requirements.txt
locally to exercise it.
"""
import json
import os

import pytest

import services.auto_segmentor as auto_segmentor
import services.viewer_labels as viewer_labels

_JSON_PATH = os.path.join(
    os.path.dirname(viewer_labels.__file__), "..", "..", "PanTS-Demo", "src", "helpers", "viewerLabels.json"
)


def _load_raw_json():
    with open(_JSON_PATH) as f:
        return json.load(f)


def test_viewer_labels_json_ids_are_contiguous_from_one():
    raw = _load_raw_json()
    ids = sorted(int(k) for k in raw)
    assert ids == list(range(1, len(ids) + 1)), (
        "viewerLabels.json ids must be contiguous starting at 1 with no gaps -- "
        "constants.ts's segmentation_categories (array, id = index + 1) and "
        "mesh_generation.py's marching-cubes label indexing both assume this."
    )


def test_viewer_labels_json_names_are_unique():
    raw = _load_raw_json()
    names = list(raw.values())
    dupes = {n for n in names if names.count(n) > 1}
    assert not dupes, f"duplicate organ name(s) in viewerLabels.json: {dupes}"


def test_viewer_labels_module_matches_json_exactly():
    """services/viewer_labels.py loads this file verbatim -- this mostly guards
    against someone reverting it back to a hand-copied dict literal."""
    raw = _load_raw_json()
    expected = {int(k): v for k, v in raw.items()}
    assert viewer_labels.VIEWER_LABEL_NAMES == expected


def test_media_agentic_aliases_all_point_to_real_organs():
    """Every alias target in auto_segmentor.py's _MEDIA_AGENTIC_NAME_ALIASES must be
    a real name in viewerLabels.json -- a typo'd target silently drops that organ to
    background instead of erroring (see _media_agentic_label_map's .get() lookup)."""
    bad = {
        raw_name: target
        for raw_name, target in auto_segmentor._MEDIA_AGENTIC_NAME_ALIASES.items()
        if target not in viewer_labels.VIEWER_LABELS
    }
    assert not bad, f"aliases pointing at unknown organ names: {bad}"


def test_auto_segmentor_uses_the_shared_viewer_labels():
    assert auto_segmentor._VIEWER_LABELS == viewer_labels.VIEWER_LABELS


def test_mesh_generation_labels_cover_every_viewer_label():
    mesh_generation = pytest.importorskip(
        "services.mesh_generation",
        reason="needs nibabel/scikit-image/trimesh; not installed in the lightweight CI job",
    )
    assert set(mesh_generation.LABELS.keys()) == set(viewer_labels.VIEWER_LABEL_NAMES.keys())
    for organ_id, meta in mesh_generation.LABELS.items():
        assert meta["key"] == viewer_labels.VIEWER_LABEL_NAMES[organ_id], (
            f"mesh_generation.LABELS[{organ_id}]['key'] = {meta['key']!r}, "
            f"expected {viewer_labels.VIEWER_LABEL_NAMES[organ_id]!r}"
        )
