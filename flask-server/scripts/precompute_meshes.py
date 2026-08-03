"""
Precompute 3D organ meshes for one or more PanTS cases so the "3D" viewer tab
renders instantly (and shows up in AI screenshot attachments) without waiting
for on-demand generation.

It writes a manifest.json + one <organ>.glb per organ into the SAME cache the
backend serves from (MESH_CACHE_PATH, default <temp>/bodymaps_mesh_cache), so
the mesh endpoints pick them up with no extra config. The label NIfTI is pulled
from the local dataset if present, otherwise downloaded from the public
HuggingFace mirror (BodyMaps/iPanTSMini).

Run from the flask-server directory:

    python scripts/precompute_meshes.py 17
    python scripts/precompute_meshes.py 17 42 108
    python scripts/precompute_meshes.py --start 1 --end 20

Set MESH_CACHE_PATH in flask-server/.env (and export it in this shell) if you
want the cache in a fixed folder instead of the temp dir.
"""

import argparse
import json
import os
import sys
import tempfile

# Make the flask-server package importable when run as a script.
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import requests  # noqa: E402
from dotenv import load_dotenv  # noqa: E402

load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))

from constants import Constants  # noqa: E402
from services.mesh_generation import (  # noqa: E402
    LABELS,
    generate_mesh_manifest,
    generate_organ_glb_bytes,
)

_HF_BASE = "https://huggingface.co/datasets/BodyMaps/iPanTSMini/resolve/main"
_CACHE_ROOT = (
    os.getenv("MESH_CACHE_PATH")
    or os.path.join(tempfile.gettempdir(), "bodymaps_mesh_cache")
)


def pants_id(index: int) -> str:
    return "PanTS_" + str(int(index)).zfill(8)


def resolve_mask(index: int) -> str | None:
    pid = pants_id(index)

    if Constants.PANTS_PATH:
        local = os.path.join(Constants.PANTS_PATH, "mask_only", pid, "combined_labels.nii.gz")
        if os.path.exists(local):
            return local

    cache_dir = os.path.join(_CACHE_ROOT, pid)
    cached = os.path.join(cache_dir, "combined_labels.nii.gz")
    if os.path.exists(cached):
        return cached

    try:
        os.makedirs(cache_dir, exist_ok=True)
        url = f"{_HF_BASE}/mask_only/{pid}/combined_labels.nii.gz?download=true"
        print(f"  downloading mask for {pid} from HuggingFace...")
        resp = requests.get(url, stream=True, timeout=180)
        resp.raise_for_status()
        tmp = cached + ".part"
        with open(tmp, "wb") as handle:
            for chunk in resp.iter_content(chunk_size=8192):
                handle.write(chunk)
        os.replace(tmp, cached)
        return cached
    except Exception as exc:
        print(f"  [ERROR] mask download failed for {pid}: {exc}")
        return None


def precompute(index: int, force: bool = False) -> None:
    pid = pants_id(index)
    out_dir = os.path.join(_CACHE_ROOT, pid)
    manifest_path = os.path.join(out_dir, "manifest.json")

    if os.path.exists(manifest_path) and not force:
        print(f"[SKIP] {pid} already cached ({out_dir})")
        return

    mask_path = resolve_mask(index)
    if not mask_path:
        print(f"[MISS] {pid}: no label data available")
        return

    print(f"[START] {pid}")
    os.makedirs(out_dir, exist_ok=True)

    manifest = generate_mesh_manifest(pid, mask_path)
    with open(manifest_path, "w", encoding="utf-8") as f:
        json.dump(manifest, f)

    made = 0
    for organ in manifest.get("organs", []):
        key = organ["key"]
        glb_path = os.path.join(out_dir, f"{key}.glb")
        if os.path.exists(glb_path) and not force:
            made += 1
            continue
        try:
            data = generate_organ_glb_bytes(key, mask_path)
            with open(glb_path, "wb") as f:
                f.write(data)
            made += 1
        except Exception as exc:
            print(f"  [WARN] {key}: {exc}")

    print(f"[DONE] {pid}: {made}/{len(manifest.get('organs', []))} organ meshes -> {out_dir}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Precompute PanTS organ meshes into the backend cache.")
    parser.add_argument("cases", type=int, nargs="*", help="Case indices, e.g. 17 42")
    parser.add_argument("--start", type=int, help="Start index (inclusive) for a range")
    parser.add_argument("--end", type=int, help="End index (inclusive) for a range")
    parser.add_argument("--force", action="store_true", help="Regenerate even if cached")
    args = parser.parse_args()

    print(f"Mesh cache: {_CACHE_ROOT}\n")

    targets = list(args.cases)
    if args.start is not None and args.end is not None:
        targets.extend(range(args.start, args.end + 1))

    if not targets:
        raise SystemExit("Give at least one case index, e.g. `python scripts/precompute_meshes.py 17`")

    for index in targets:
        try:
            precompute(index, force=args.force)
        except Exception as exc:
            print(f"[ERROR] PanTS_{index:08d}: {exc}")
