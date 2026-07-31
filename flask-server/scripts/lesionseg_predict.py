#!/usr/bin/env python3
"""
Thin nnU-Net inference wrapper for LesionSegmenter, invoked as a subprocess with a CLI
shape that mirrors nnUNetv2_predict_from_modelfolder (-i/-o/-m/-step_size/--disable_tta),
so it's a near drop-in replacement for the CLI call in services/auto_segmentor.py.

Why this exists instead of calling the CLI directly: the CLI has no flag for GPU-accelerated
export resampling. Swapping ConfigurationManager.resampling_fn_probabilities for
resample_torch_fornnunet cuts that stage from ~26-42s to ~1-6s with no accuracy cost --
validated end-to-end this session, lesion Dice 0.998-1.0 against the CPU-resample output
across every test case (isolated specifically from every other change, see PR #105/#106
history). The CLI's export step has no hook to apply this from the outside, so a thin
wrapper around nnUNetPredictor directly is the only way to get the win without either (a)
patching the vendored nnU-Net install in each conda env, which every OTHER model here also
depends on and would be a much larger blast radius, or (b) a persistent/warm predictor
service, which is a separate, bigger architecture change (not this).

Still a fresh subprocess per invocation, same cold-start cost as the plain CLI (~19s model
load) -- this does NOT include the warm-predictor optimization.
"""
import argparse
import os
import sys
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


def _patch_gpu_export_resample():
    def _resampling_fn_probabilities(self):
        return partial(resample_torch_fornnunet, device=torch.device("cuda"), is_seg=False)
    plans_handler.ConfigurationManager.resampling_fn_probabilities = property(
        _resampling_fn_probabilities
    )


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("-i", dest="input_dir", required=True, help="Folder of {case}_0000.nii[.gz] files")
    ap.add_argument("-o", dest="output_dir", required=True)
    ap.add_argument("-m", dest="model_dir", required=True, help="nnU-Net model folder (dataset.json/plans.json/fold_*)")
    ap.add_argument("-step_size", type=float, default=0.9)
    ap.add_argument("--disable_tta", action="store_true")
    ap.add_argument("-chk", dest="checkpoint_name", default="checkpoint_final.pth")
    args = ap.parse_args()

    if not torch.cuda.is_available():
        print("ERROR: CUDA not available", file=sys.stderr)
        sys.exit(1)

    os.makedirs(args.output_dir, exist_ok=True)
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


if __name__ == "__main__":
    main()
