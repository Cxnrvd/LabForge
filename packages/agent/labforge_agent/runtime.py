"""Thin wrapper around Vagrant subprocess calls."""

from __future__ import annotations

import shutil
import subprocess
from pathlib import Path
from typing import Iterable, Optional


class VagrantNotFound(RuntimeError):
    def __init__(self) -> None:
        super().__init__("vagrant binary not found on PATH; install it to provision labs")


def vagrant_version() -> Optional[str]:
    """Return the vagrant version string (e.g. ``2.4.9``) or ``None``."""
    if shutil.which("vagrant") is None:
        return None
    try:
        out = subprocess.run(
            ["vagrant", "--version"],
            capture_output=True,
            text=True, encoding="utf-8", errors="replace",
            timeout=5,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired):
        return None
    text = (out.stdout or "").strip()
    if not text:
        return None
    # Output is "Vagrant 2.4.9"
    parts = text.split()
    return parts[-1] if parts else None


def assert_vagrant_available() -> None:
    """Raise ``VagrantNotFound`` unless vagrant is on PATH AND `--version` runs.

    The two-step check guards against the case where vagrant disappears
    or its environment is broken between ``shutil.which`` and the next
    subprocess call — users get a single clean error instead of a
    surprise ``FileNotFoundError`` from a later command.
    """
    if vagrant_version() is None:
        raise VagrantNotFound()


def vagrant_plugins() -> list[str]:
    """List installed Vagrant plugin names, or an empty list on failure."""
    if shutil.which("vagrant") is None:
        return []
    try:
        out = subprocess.run(
            ["vagrant", "plugin", "list"],
            capture_output=True,
            text=True, encoding="utf-8", errors="replace",
            timeout=10,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired):
        return []
    plugins: list[str] = []
    for line in (out.stdout or "").splitlines():
        line = line.strip()
        if not line:
            continue
        plugins.append(line.split()[0])
    return plugins


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
        text=True, encoding="utf-8", errors="replace",
    )
    return out.stdout
