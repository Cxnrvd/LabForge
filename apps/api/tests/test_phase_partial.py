"""Regression for read_build_status's `partial` promotion.

When the shim writes a non-zero `.build.exit` but at least one of the
workspace's VMs is still alive in the hypervisor, read_build_status
should report ``phase: partial`` rather than ``failed``. We exercise
that by monkey-patching the ``_provider_vms_running`` probe — running
real VBox/VMware in a unit test is out of scope.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from labforge_core.services import build_runner


@pytest.fixture
def workspace(tmp_path: Path) -> Path:
    ws = tmp_path / "ws"
    ws.mkdir()
    return ws


def _write_exit(ws: Path, code: int, ts: int = 1779_000_000) -> None:
    (ws / build_runner.BUILD_EXIT).write_text(f"{code}\n{ts}\n", encoding="utf-8")


def test_failed_when_no_vms_alive(workspace: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(build_runner, "_provider_vms_running", lambda _: 0)
    _write_exit(workspace, code=1)
    snap = build_runner.read_build_status(workspace)
    assert snap["phase"] == "failed"
    assert snap["exit_code"] == 1


def test_partial_when_vms_alive_after_failure(
    workspace: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    # One VM survived even though vagrant exited non-zero — exactly the
    # SSH-timeout-on-last-VM case we hit in real builds.
    monkeypatch.setattr(build_runner, "_provider_vms_running", lambda _: 1)
    _write_exit(workspace, code=1)
    snap = build_runner.read_build_status(workspace)
    assert snap["phase"] == "partial"
    assert snap["exit_code"] == 1


def test_unknown_probe_does_not_promote(
    workspace: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    # -1 means "we can't tell" — caller must NOT promote a failure into
    # partial in that case, because that would hide a real failure.
    monkeypatch.setattr(build_runner, "_provider_vms_running", lambda _: -1)
    _write_exit(workspace, code=1)
    snap = build_runner.read_build_status(workspace)
    assert snap["phase"] == "failed"


def test_aborted_overrides_vm_state(
    workspace: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    # A user-initiated abort should remain `aborted` even if some VMs
    # happened to come up before the stop signal landed.
    monkeypatch.setattr(build_runner, "_provider_vms_running", lambda _: 2)
    _write_exit(workspace, code=-1)
    (workspace / build_runner.BUILD_ABORTED).write_text("2026-01-01T00:00:00", encoding="utf-8")
    snap = build_runner.read_build_status(workspace)
    assert snap["phase"] == "aborted"


def test_succeeded_does_not_consult_probe(
    workspace: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    # Exit code 0 means everything reported clean — the probe shouldn't
    # be able to overrule that. Patch it to a value that would otherwise
    # downgrade (-1) and confirm the result stays succeeded.
    def _never_called(_: Path) -> int:
        raise AssertionError("probe should not be called for a clean build")

    monkeypatch.setattr(build_runner, "_provider_vms_running", _never_called)
    _write_exit(workspace, code=0)
    snap = build_runner.read_build_status(workspace)
    assert snap["phase"] == "succeeded"


def test_no_machines_dir_returns_minus_one(workspace: Path) -> None:
    # Real call (no monkeypatch) — workspace has no .vagrant dir, so
    # the probe should return -1 without raising.
    assert build_runner._provider_vms_running(workspace) == -1
