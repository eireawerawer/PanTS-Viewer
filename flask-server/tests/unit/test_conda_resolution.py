"""Unit tests for conda discovery in the inference runners.

Background: every model was failing on the server with

    Inference failed: Could not find conda. Set CONDA_ACTIVATE_PATH or ensure
    `conda` is on PATH.

gunicorn runs without a login shell, so it never picks up the PATH that conda's
shell init exports and shutil.which("conda") comes back empty. Some runners
already had a hardcoded fallback and some raised, which is why the failure hit
ePAI, Atlas-Net and LesionSegmenter but not OpenVAE or MedFormer.

These cover the shared resolver and, more usefully, assert that no runner goes
back to calling shutil.which directly.
"""

import os
import re

import pytest

from services import auto_segmentor
from services.auto_segmentor import _resolve_conda_exe

MODULE_SRC = os.path.join(os.path.dirname(auto_segmentor.__file__), "auto_segmentor.py")


def test_explicit_env_var_wins(monkeypatch, tmp_path):
    fake = tmp_path / "conda"
    fake.write_text("#!/bin/sh\n")
    monkeypatch.setenv("CONDA_EXE_PATH", str(fake))
    monkeypatch.setattr(auto_segmentor.shutil, "which", lambda _: "/somewhere/else/conda")
    assert _resolve_conda_exe() == str(fake)


def test_ignores_env_var_pointing_at_nothing(monkeypatch):
    """A stale CONDA_EXE_PATH must not shadow a perfectly good PATH lookup."""
    monkeypatch.setenv("CONDA_EXE_PATH", "/does/not/exist/conda")
    monkeypatch.setattr(auto_segmentor.shutil, "which", lambda _: "/usr/bin/conda")
    assert _resolve_conda_exe() == "/usr/bin/conda"


def test_falls_back_to_path(monkeypatch):
    monkeypatch.delenv("CONDA_EXE_PATH", raising=False)
    monkeypatch.setattr(auto_segmentor.shutil, "which", lambda _: "/usr/bin/conda")
    assert _resolve_conda_exe() == "/usr/bin/conda"


def test_falls_back_to_known_install_when_path_is_empty(monkeypatch, tmp_path):
    """The actual server case: conda installed, just not on gunicorn's PATH."""
    monkeypatch.delenv("CONDA_EXE_PATH", raising=False)
    monkeypatch.setattr(auto_segmentor.shutil, "which", lambda _: None)
    real = "/home/apps/anaconda3/condabin/conda"
    monkeypatch.setattr(auto_segmentor.os.path, "exists", lambda p: p == real)
    assert _resolve_conda_exe() == real


def test_returns_empty_when_conda_genuinely_absent(monkeypatch):
    monkeypatch.delenv("CONDA_EXE_PATH", raising=False)
    monkeypatch.setattr(auto_segmentor.shutil, "which", lambda _: None)
    monkeypatch.setattr(auto_segmentor.os.path, "exists", lambda _: False)
    assert _resolve_conda_exe() == ""


def test_resolver_does_not_recurse(monkeypatch):
    """Regression guard.

    A search-and-replace that swaps shutil.which for the resolver will happily
    rewrite the call inside the resolver itself, producing infinite recursion
    that only shows up at request time. Calling it is enough to catch that.
    """
    monkeypatch.delenv("CONDA_EXE_PATH", raising=False)
    monkeypatch.setattr(auto_segmentor.shutil, "which", lambda _: None)
    monkeypatch.setattr(auto_segmentor.os.path, "exists", lambda _: False)
    assert _resolve_conda_exe() == ""      # RecursionError if it self-calls


def test_no_runner_calls_shutil_which_directly():
    """Every runner must go through the resolver.

    This is the bug itself: a runner using shutil.which raises on the server
    while its neighbours, which had a fallback, keep working.
    """
    with open(MODULE_SRC, encoding="utf-8") as fh:
        lines = fh.readlines()

    inside_resolver = False
    offenders = []
    for i, line in enumerate(lines, 1):
        if line.startswith("def _resolve_conda_exe"):
            inside_resolver = True
        elif line.startswith("def ") and inside_resolver:
            inside_resolver = False
        if inside_resolver:
            continue          # the one legitimate call lives here
        if re.search(r'shutil\.which\(\s*["\']conda["\']\s*\)', line):
            offenders.append(i)

    assert not offenders, (
        f"lines {offenders} call shutil.which('conda') directly; "
        f"use _resolve_conda_exe() so the server fallback applies"
    )
