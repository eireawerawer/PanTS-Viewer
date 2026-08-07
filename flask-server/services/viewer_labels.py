"""Canonical viewer label scheme (id <-> name), shared by every backend module that
needs to know "what organ does label id N mean"

The actual data lives in ../../PanTS-Demo/src/helpers/viewerLabels.json.
That file is the single source of truth for both sides:
the frontend imports it directly (see constants.ts, which derives
segmentation_categories + EXTENDED_ORGAN_NAMES from it)

1-35 is the original scheme (PanTS dataset + ePAI/SuPreM/Atlas-Net/MedFormer/R-Super/LesionSegmenter).
36+ are organs the media-agentic-ai teacher models segment that 1-35 has no slot for.
Which ids count as "static" (always shown in the dataset case viewer) vs. 
"extended" (upload/inference session viewer only) is a
frontend-only distinction (at id 35 right now)
"""

import json
import os

_JSON_PATH = os.path.join(
    os.path.dirname(__file__), "..", "..", "PanTS-Demo", "src", "helpers", "viewerLabels.json"
)

with open(_JSON_PATH) as _f:
    # JSON object keys are always strings; the real (int) ids are the whole point.
    VIEWER_LABEL_NAMES: dict[int, str] = {int(k): v for k, v in json.load(_f).items()}

# name -> id, the direction auto_segmentor.py's remap functions actually look up.
VIEWER_LABELS: dict[str, int] = {name: idx for idx, name in VIEWER_LABEL_NAMES.items()}


def display_name(key: str) -> str:
    """snake_case key -> "Title Case" display name. Mirrors the frontend's
    filenameToName() (helpers/utils.name.ts) so mesh/organ-stats labels read the
    same as the checkbox panel's."""
    return " ".join(word.capitalize() for word in key.split("_") if word)
