"""Thin wrapper around Vagrant subprocess calls."""

from __future__ import annotations

import shutil
import subprocess
from pathlib import Path
from typing import Iterable


class VagrantNotFound(RuntimeError):
    def __init__(self) -> None:
        super().__init__("vagrant binary not found on PATH; install it to provision labs")


def assert_vagrant_available() -> None:
    if shutil.which("vagrant") is None:
        raise VagrantNotFound()


def run_vagrant(args: Iterable[str], *, cwd: Path, check: bool = True) -> int:
    assert_vagrant_available()
    process = subprocess.run(
        ["vagrant", *args],
        cwd=str(cwd),
        check=False,
    )
    if check and process.returncode != 0:
        raise RuntimeError(f"vagrant {' '.join(args)} exited with {process.returncode}")
    return process.returncode


def capture_vagrant(args: Iterable[str], *, cwd: Path) -> str:
    assert_vagrant_available()
    out = subprocess.run(
        ["vagrant", *args],
        cwd=str(cwd),
        check=False,
        capture_output=True,
        text=True,
    )
    return out.stdout
