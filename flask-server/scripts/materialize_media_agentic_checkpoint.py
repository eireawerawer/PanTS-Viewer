#!/usr/bin/env python3
"""Rebuild a standard nnU-Net modelfolder from a media-agentic-ai FP16 checkpoint.

Casting weights back to FP32 and copying the
metadata files so the existing nnUNetv2_predict_from_modelfolder CLI call in
services/auto_segmentor.py works, the same way it already does for
Atlas-Net/ePAI.

Run inside a conda env that has torch installed `conda run -n <env> python ...`
"""
import argparse
import os
import shutil
import sys


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--src-dir", required=True,
                     help="Model folder with checkpoint_final_fp16.pth, dataset.json, plans.json")
    ap.add_argument("--dest-dir", required=True,
                     help="Writable cache dir to materialize the FP32 modelfolder into")
    ap.add_argument("--checkpoint-rel", default="fold_all/checkpoint_final.pth",
                     help="Relative path (from inference_config.yaml's `checkpoint:` field) "
                          "to write the FP32 weights to, e.g. fold_all/checkpoint_final.pth")
    ap.add_argument("--fp16-filename", default="checkpoint_final_fp16.pth")
    args = ap.parse_args()

    src_ckpt = os.path.join(args.src_dir, args.fp16_filename)
    if not os.path.exists(src_ckpt):
        print(
            f"Missing weights: {src_ckpt} not found. This repo ships Git LFS pointers by "
            f"default. Run `git lfs pull` inside {args.src_dir} (or its repo root) to fetch "
            "the real checkpoint before inference can run.",
            file=sys.stderr,
        )
        sys.exit(1)

    dest_ckpt = os.path.join(args.dest_dir, args.checkpoint_rel)
    src_mtime = os.path.getmtime(src_ckpt)
    needs_ckpt = not os.path.exists(dest_ckpt) or os.path.getmtime(dest_ckpt) < src_mtime

    os.makedirs(args.dest_dir, exist_ok=True)
    for meta_file in ("dataset.json", "plans.json"):
        src_meta = os.path.join(args.src_dir, meta_file)
        dest_meta = os.path.join(args.dest_dir, meta_file)
        if os.path.exists(src_meta) and (
            not os.path.exists(dest_meta) or os.path.getmtime(dest_meta) < os.path.getmtime(src_meta)
        ):
            shutil.copy2(src_meta, dest_meta)

    if not needs_ckpt:
        print(f"[materialize] up to date: {dest_ckpt}")
        return

    import torch

    print(f"[materialize] casting {src_ckpt} -> {dest_ckpt}")
    ckpt = torch.load(src_ckpt, map_location="cpu", weights_only=False)
    weights = ckpt.get("network_weights", ckpt)
    ckpt["network_weights"] = {
        k: (v.float() if torch.is_tensor(v) else v) for k, v in weights.items()
    }
    os.makedirs(os.path.dirname(dest_ckpt), exist_ok=True)
    torch.save(ckpt, dest_ckpt)
    print(f"[materialize] wrote {dest_ckpt}")


if __name__ == "__main__":
    main()
