#!/usr/bin/env python3
"""
Thin nnU-Net inference wrapper for LesionSegmenter, invoked as a subprocess with a CLI
shape that mirrors nnUNetv2_predict_from_modelfolder (-i/-o/-m/-step_size/--disable_tta),
so it's a near drop-in replacement for the CLI call in services/auto_segmentor.py.

Two execution paths:

1. WARM (fast). If LESIONSEG_WARM_URL is set and that service is healthy, the work is
   handed to the persistent predictor (scripts/lesionseg_warm_server.py), which holds
   the model in GPU memory across requests. This skips the ~19s of interpreter start,
   torch import, checkpoint load and cuDNN autotune that the cold path pays on EVERY
   request. Everything above this line is stdlib-only and the heavy imports live inside
   the cold path -- importing torch here would give back several seconds of the very
   cost this path exists to avoid.

2. COLD (fallback). Exactly the previous behaviour: load the model in-process and run.
   Used when no warm URL is configured, the service is down, or it is running a
   different configuration than the caller asked for. The fallback is deliberate: the
   website must keep working if the warm service dies, just more slowly.

Why this wrapper exists at all instead of the plain CLI: the CLI has no flag for
GPU-accelerated export resampling. Swapping ConfigurationManager.resampling_fn_probabilities
for resample_torch_fornnunet cuts that stage from ~26-42s to ~1-6s with no accuracy cost
(lesion Dice 0.998-1.0 vs the CPU-resample output). The CLI's export step has no hook to
apply this from outside, and patching the vendored nnU-Net install would hit every other
model in this deployment.
"""
import argparse
import json
import os
import sys
import urllib.error
import urllib.request


def _warm_predict(input_dir, output_dir, step_size, disable_tta, url, timeout):
    """Try the persistent predictor. Returns True if it produced the output.

    Any failure returns False so the caller falls back to cold inference -- a warm
    service that is down, busy, or differently configured must degrade to a slow
    correct answer, never to a wrong or missing one.
    """
    base = url.rstrip("/")
    try:
        with urllib.request.urlopen(f"{base}/health", timeout=5) as r:
            health = json.loads(r.read())
    except Exception as e:
        print(f"[warm] health check failed ({e}); using cold path", flush=True)
        return False

    # The server also enforces this and answers 409, but checking here keeps the
    # reason in this process's log where the failure is being handled.
    if abs(float(health.get("step_size", -1)) - float(step_size)) > 1e-9 \
            or bool(health.get("disable_tta")) != bool(disable_tta):
        print(f"[warm] config mismatch (server step={health.get('step_size')} "
              f"disable_tta={health.get('disable_tta')}; requested step={step_size} "
              f"disable_tta={disable_tta}); using cold path", flush=True)
        return False

    body = json.dumps({
        "input_dir": os.path.abspath(input_dir),
        "output_dir": os.path.abspath(output_dir),
        "step_size": float(step_size),
        "disable_tta": bool(disable_tta),
    }).encode()
    req = urllib.request.Request(f"{base}/predict", data=body,
                                 headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            resp = json.loads(r.read())
    except urllib.error.HTTPError as e:
        detail = e.read().decode(errors="replace")[:400]
        print(f"[warm] server returned {e.code}: {detail}; using cold path", flush=True)
        return False
    except Exception as e:
        print(f"[warm] request failed ({e}); using cold path", flush=True)
        return False

    for item in resp.get("results", []):
        out = item.get("output_path")
        if not out or not os.path.exists(out):
            print(f"[warm] server reported success but {out} is missing; using cold path",
                  flush=True)
            return False
        print(f"done with {item.get('case_id')} ({item.get('seconds')}s, warm)", flush=True)
    if not resp.get("results"):
        print("[warm] server returned no results; using cold path", flush=True)
        return False
    print(f"[warm] total {resp.get('total_seconds')}s", flush=True)
    return True


def _cold_predict(args):
    """In-process inference. Heavy imports are local so the warm path never pays them."""
    from functools import partial

    import torch
    from nnunetv2.inference.predict_from_raw_data import nnUNetPredictor
    from nnunetv2.imageio.simpleitk_reader_writer import SimpleITKIO
    from nnunetv2.preprocessing.preprocessors.default_preprocessor import DefaultPreprocessor
    from nnunetv2.inference.export_prediction import (
        convert_predicted_logits_to_segmentation_with_correct_shape as convert_logits,
    )
    import nnunetv2.utilities.plans_handling.plans_handler as plans_handler
    from nnunetv2.preprocessing.resampling.resample_torch import resample_torch_fornnunet

    if not torch.cuda.is_available():
        print("ERROR: CUDA not available", file=sys.stderr)
        sys.exit(1)

    def _patch_gpu_export_resample():
        def _resampling_fn_probabilities(self):
            return partial(resample_torch_fornnunet, device=torch.device("cuda"), is_seg=False)
        plans_handler.ConfigurationManager.resampling_fn_probabilities = property(
            _resampling_fn_probabilities
        )

    _patch_gpu_export_resample()

    predictor = nnUNetPredictor(
        tile_step_size=args.step_size,
        use_mirroring=not args.disable_tta,
        perform_everything_on_device=True,
        device=torch.device("cuda"),
        allow_tqdm=False,
        verbose=False,
    )
    predictor.initialize_from_trained_model_folder(
        args.model_dir, use_folds=("all",), checkpoint_name=args.checkpoint_name
    )

    reader_writer = SimpleITKIO()
    preprocessor = DefaultPreprocessor(verbose=False)

    case_files = sorted(
        f for f in os.listdir(args.input_dir)
        if f.endswith("_0000.nii.gz") or f.endswith("_0000.nii")
    )
    if not case_files:
        print(f"No cases found in {args.input_dir}", file=sys.stderr)
        sys.exit(1)

    for fname in case_files:
        case_id = fname[:-len("_0000.nii.gz")] if fname.endswith(".gz") else fname[:-len("_0000.nii")]
        print(f"Predicting {case_id}:", flush=True)

        data, properties = reader_writer.read_images([os.path.join(args.input_dir, fname)])
        preprocessed, _, preprocessed_props = preprocessor.run_case_npy(
            data, None, properties,
            predictor.plans_manager, predictor.configuration_manager, predictor.dataset_json,
        )
        logits = predictor.predict_logits_from_preprocessed_data(torch.from_numpy(preprocessed))
        segmentation = convert_logits(
            logits, predictor.plans_manager, predictor.configuration_manager,
            predictor.label_manager, preprocessed_props, False,
        )
        reader_writer.write_seg(
            segmentation, os.path.join(args.output_dir, f"{case_id}.nii.gz"), preprocessed_props
        )
        print(f"done with {case_id}", flush=True)


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("-i", dest="input_dir", required=True, help="Folder of {case}_0000.nii[.gz] files")
    ap.add_argument("-o", dest="output_dir", required=True)
    ap.add_argument("-m", dest="model_dir", required=True, help="nnU-Net model folder (dataset.json/plans.json/fold_*)")
    ap.add_argument("-step_size", type=float, default=0.9)
    ap.add_argument("--disable_tta", action="store_true")
    ap.add_argument("-chk", dest="checkpoint_name", default="checkpoint_final.pth")
    args = ap.parse_args()

    os.makedirs(args.output_dir, exist_ok=True)

    warm_url = os.getenv("LESIONSEG_WARM_URL", "").strip()
    if warm_url:
        timeout = int(os.getenv("LESIONSEG_WARM_TIMEOUT", "3600"))
        if _warm_predict(args.input_dir, args.output_dir, args.step_size,
                         args.disable_tta, warm_url, timeout):
            return

    _cold_predict(args)


if __name__ == "__main__":
    main()
