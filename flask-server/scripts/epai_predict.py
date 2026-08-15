#!/usr/bin/env python3
"""Optimized ePAI inference: GPU-resident export + the fork's own findings CSV.

Drop-in for the bare `nnUNetv2_predict_from_modelfolder` call in
services/auto_segmentor.py, wired in via the EPAI_SCRIPT_PATH hook (which invokes:
`bash <script> session_dir case_id input_dir save_dir input_csv output_csv ckpt_path`).
Runs inside the `epai` conda env, where `import nnunetv2` resolves to qchen76's fork.

Why it exists: profiling showed ePAI's export/convert stage is ~158s of CPU
resampling of the 26-channel logits back to native resolution -- as expensive as
inference. Moving that resample to the GPU cuts it to ~0.3s (measured ~50-60x,
99.99% voxel agreement -- boundary jitter only, no lesion-level change). It reuses
the fork's own `export_prediction_from_logits`, which does BOTH the segmentation
export AND the tumor-findings CSV (PDAC/cyst/PNET stats), so the findings report is
produced identically -- only the resample runs on GPU.

Two fork-specific fixes vs the standard-nnU-Net LesionSegmenter wrapper:
  1. determine_do_sep_z_and_axis in the fork returns the anisotropy axis as a bare
     scalar on the separate-z path, so resample_torch's `assert len(axis)==1` crashes
     (standard nnU-Net returns a 1-element list). Coerce scalar -> [int(axis)].
  2. Patch ConfigurationManager.resampling_fn_probabilities -> the GPU resampler.
"""
import os
import sys
from functools import partial

import numpy as np
import torch
from nnunetv2.inference.predict_from_raw_data import nnUNetPredictor
from nnunetv2.preprocessing.preprocessors.default_preprocessor import DefaultPreprocessor
from nnunetv2.inference.export_prediction import export_prediction_from_logits
from nnunetv2.preprocessing.resampling.resample_torch import resample_torch_fornnunet
import nnunetv2.preprocessing.resampling.resample_torch as _rt
import nnunetv2.utilities.plans_handling.plans_handler as _ph


def _apply_fork_fixes():
    # (1) coerce the anisotropy axis back to a list so `assert len(axis)==1` holds
    _orig_determine = _rt.determine_do_sep_z_and_axis

    def _fixed_determine(*a, **k):
        do_sep, axis = _orig_determine(*a, **k)
        if do_sep and np.isscalar(axis):
            axis = [int(axis)]
        return do_sep, axis

    _rt.determine_do_sep_z_and_axis = _fixed_determine

    # (2) GPU-resident probabilities resampling (the ~158s -> ~0.3s export lever)
    _ph.ConfigurationManager.resampling_fn_probabilities = property(
        lambda self: partial(resample_torch_fornnunet, device=torch.device("cuda"), is_seg=False)
    )


def main():
    # Positional contract from services/auto_segmentor.py's EPAI_SCRIPT_PATH hook.
    if len(sys.argv) < 8:
        print("usage: epai_predict.py session_dir case_id input_dir save_dir "
              "input_csv output_csv ckpt_path", file=sys.stderr)
        sys.exit(2)
    _session_dir, case_id, input_dir, save_dir, _input_csv, output_csv, ckpt_path = sys.argv[1:8]

    if not torch.cuda.is_available():
        print("ERROR: CUDA not available", file=sys.stderr)
        sys.exit(1)

    _apply_fork_fixes()

    predictor = nnUNetPredictor(
        tile_step_size=float(os.getenv("EPAI_STEP_SIZE", "0.5")),
        use_mirroring=os.getenv("EPAI_DISABLE_TTA", "0").strip().lower() not in {"1", "true", "yes", "on"},
        perform_everything_on_device=True,
        device=torch.device("cuda"),
        allow_tqdm=False,
        verbose=False,
    )
    predictor.initialize_from_trained_model_folder(
        ckpt_path, use_folds=("all",),
        checkpoint_name=os.getenv("EPAI_CHECKPOINT_NAME", "checkpoint_final.pth"),
    )

    pp = DefaultPreprocessor(verbose=False)
    pm, cm = predictor.plans_manager, predictor.configuration_manager
    # Must match the writer export_prediction_from_logits uses internally
    # (also pm.image_reader_writer_class() - this model's plans specify
    # NibabelIOWithReorient, not SimpleITKIO). Reading with the wrong class
    # produces a properties dict missing 'nibabel_stuff', which the nibabel
    # writer needs for the reoriented affine -> KeyError deep inside write_seg.
    # Confirmed by direct smoke test before this was wired into EPAI_SCRIPT_PATH.
    rw = pm.image_reader_writer_class()

    ct = os.path.join(input_dir, f"{case_id}_0000.nii.gz")
    if not os.path.exists(ct):
        print(f"ERROR: input not found: {ct}", file=sys.stderr)
        sys.exit(1)

    data, props = rw.read_images([ct])
    dpp, _, pprops = pp.run_case_npy(data, None, props, pm, cm, predictor.dataset_json)
    logits = predictor.predict_logits_from_preprocessed_data(torch.from_numpy(dpp))

    # The fork's own export: converts logits -> native-res segmentation (GPU resample,
    # thanks to the patch) AND writes the tumor-findings row into output_csv. Writes the
    # segmentation to <save_dir>/<case_id>.nii.gz.
    #
    # save_probabilities MUST be True here despite the name: in this fork it does not
    # mean "write a probabilities.npz" (that branch is commented out -- "we don't save
    # probabilities as pickles anymore"). It gates the ENTIRE write path -- segmentation
    # write, tumor-stats extraction, and the output-CSV update all live inside
    # `if save_probabilities:`; the unconditional segmentation write that used to run
    # regardless is commented out at the bottom of the function (a leftover from
    # whoever refactored this in). Passing False (the "obviously correct" choice,
    # since we don't want a probabilities file) silently produces ZERO output --
    # no exception, exit 0, nothing written. Confirmed by direct smoke test before
    # this was wired into EPAI_SCRIPT_PATH.
    out_trunc = os.path.join(save_dir, case_id)
    export_prediction_from_logits(
        logits, pprops, cm, pm, predictor.dataset_json, out_trunc,
        save_probabilities=True, output_csv_path=output_csv,
    )
    print(f"done {case_id}", flush=True)


if __name__ == "__main__":
    main()
