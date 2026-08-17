"""Unit tests for the AtlasNet-Organs label mapping.

Deliberately dependency-light (no app, DB, GPU or dataset) so they run in CI.

The mapping is the part of a model integration that fails silently: a wrong
entry doesn't crash, it just renders the wrong organ in the wrong colour. These
lock in three things:

  1. every class the checkpoint emits is mapped,
  2. every target exists in the viewer's label scheme,
  3. the Python label indices still agree with the TypeScript
     `segmentation_categories` array, which is a separate file that has to be
     edited in lockstep and currently has nothing enforcing that.
"""

import os
import re

import pytest

from services.auto_segmentor import _ATLASNET_ORGANS_TO_VIEWER, _VIEWER_LABELS


# The 34 classes from AbdomenAtlasNetOrgans' dataset.json
# (Dataset224_AbdomenAtlas1.1), source label -> name. Flat labels, no
# regions_class_order, so these are exactly the values the model writes.
ATLASNET_ORGANS_CLASSES = {
    1: "aorta", 2: "gall_bladder", 3: "kidney_left", 4: "kidney_right",
    5: "postcava", 6: "spleen", 7: "stomach", 8: "adrenal_gland_left",
    9: "adrenal_gland_right", 10: "bladder", 11: "celiac_trunk", 12: "colon",
    13: "duodenum", 14: "esophagus", 15: "femur_left", 16: "femur_right",
    17: "hepatic_vessel", 18: "intestine", 19: "lung_left", 20: "lung_right",
    21: "portal_vein_and_splenic_vein", 22: "prostate", 23: "rectum",
    24: "liver_segment_1", 25: "liver_segment_2", 26: "liver_segment_3",
    27: "liver_segment_4", 28: "liver_segment_5", 29: "liver_segment_6",
    30: "liver_segment_7", 31: "liver_segment_8",
    32: "pancreas_head", 33: "pancreas_body", 34: "pancreas_tail",
}

CONSTANTS_TS = os.path.join(
    os.path.dirname(__file__), "..", "..", "..",
    "PanTS-Demo", "src", "helpers", "constants.ts",
)


def test_every_model_class_is_mapped():
    assert set(_ATLASNET_ORGANS_TO_VIEWER) == set(ATLASNET_ORGANS_CLASSES), (
        "source labels drifted from the checkpoint's dataset.json"
    )


def test_every_target_is_a_real_viewer_label():
    valid = set(_VIEWER_LABELS.values())
    unknown = {src: dst for src, dst in _ATLASNET_ORGANS_TO_VIEWER.items() if dst not in valid}
    assert not unknown, f"targets absent from _VIEWER_LABELS: {unknown}"


def test_viewer_label_slots_are_unique():
    seen = {}
    for name, idx in _VIEWER_LABELS.items():
        assert idx not in seen, f"{name} and {seen[idx]} both claim slot {idx}"
        seen[idx] = name


def test_couinaud_segments_are_eight_distinct_slots():
    slots = {
        _ATLASNET_ORGANS_TO_VIEWER[src]
        for src, name in ATLASNET_ORGANS_CLASSES.items()
        if name.startswith("liver_segment_")
    }
    assert len(slots) == 8, "the eight Couinaud segments must not share slots"


@pytest.mark.parametrize("src,name", sorted(ATLASNET_ORGANS_CLASSES.items()))
def test_mapping_is_semantically_right(src, name):
    """Each class lands on the viewer label of the same anatomy.

    celiac_trunk is the one rename: the viewer calls it celiac_artery.
    """
    expected = "celiac_artery" if name == "celiac_trunk" else name
    assert _ATLASNET_ORGANS_TO_VIEWER[src] == _VIEWER_LABELS[expected], (
        f"model label {src} ({name}) should map to viewer '{expected}'"
    )


def test_python_and_typescript_label_order_agree():
    """_VIEWER_LABELS indices must match the order of segmentation_categories.

    The viewer derives an organ's name from its position in that array, so if
    the two files drift every label past the drift point renders as the wrong
    organ. Nothing else in the repo checks this.
    """
    with open(os.path.normpath(CONSTANTS_TS), encoding="utf-8") as fh:
        source = fh.read()

    block = re.search(
        r"export const segmentation_categories:\s*SegmentationCategories\[\]\s*=\s*\[(.*?)\];",
        source, re.S,
    )
    assert block, "could not find segmentation_categories in constants.ts"
    names = re.findall(r'"([a-z0-9_]+)"', block.group(1))

    ts_labels = {name: i + 1 for i, name in enumerate(names)}
    assert ts_labels == _VIEWER_LABELS, (
        "constants.ts and _VIEWER_LABELS disagree; "
        f"only in TS={set(ts_labels) - set(_VIEWER_LABELS)}, "
        f"only in Python={set(_VIEWER_LABELS) - set(ts_labels)}, "
        f"index mismatches="
        f"{ {k: (ts_labels[k], _VIEWER_LABELS[k]) for k in ts_labels.keys() & _VIEWER_LABELS.keys() if ts_labels[k] != _VIEWER_LABELS[k]} }"
    )
