"""Regression: `_provider_vms_running` must match a VMware `.vmx` path through a
Windows junction the same way whichever side (the recorded Vagrant `id` file, or
`vmrun list`'s own output) happens to report it.

Reproduced live against the real `wifi-lab-3` workspace: `F:\\Workspaces\\wifi-lab-3`
is a junction for `E:\\LABS\\labforge-workspaces\\wifi-lab-3`. Four of five machines'
`.vagrant/machines/*/vmware_desktop/id` files recorded the junction path; `ap-second`
recorded the real, resolved path instead (same VM, just a different string). The old
naive lower-case/backslash `startswith` check only matched the junction-path style,
so `ap-second` was silently never counted as alive — `_provider_vms_running` read 4
when 5 VMs were genuinely running, which kept `read_build_status` reporting
`"partial"` forever regardless of how many times the lab was rebuilt or resumed.
"""

from __future__ import annotations

import os
import subprocess
from pathlib import Path

from labforge_core.services import build_runner

_JUNCTION_ALIAS = r"F:\Workspaces\wifi-lab-3"
_REAL_TARGET = r"E:\LABS\labforge-workspaces\wifi-lab-3"


def _make_machine(machines_dir: Path, name: str, vmx_path: str) -> None:
    d = machines_dir / name / "vmware_desktop"
    d.mkdir(parents=True)
    (d / "id").write_text(vmx_path, encoding="utf-8")


def _fake_realpath_resolving_the_junction(path: str) -> str:
    p = str(path).strip()
    if p.lower().startswith(_JUNCTION_ALIAS.lower()):
        p = _REAL_TARGET + p[len(_JUNCTION_ALIAS):]
    return p


def test_mixed_junction_and_resolved_paths_all_count_as_alive(tmp_path, monkeypatch):
    ws = tmp_path / "ws"
    machines = ws / ".vagrant" / "machines"
    _make_machine(
        machines, "ap-target",
        _JUNCTION_ALIAS + r"\.vagrant\machines\ap-target\vmware_desktop\x\a.vmx",
    )
    # Same VM, but this one's id file recorded the *resolved* path — the exact
    # mismatch found in the real ap-second case.
    _make_machine(
        machines, "ap-second",
        _REAL_TARGET + r"\.vagrant\machines\ap-second\vmware_desktop\y\b.vmx",
    )

    monkeypatch.setattr(os.path, "realpath", _fake_realpath_resolving_the_junction)
    monkeypatch.setattr(build_runner.hostenv, "vmrun_path", lambda: "vmrun")

    # vmrun list reports both machines, both via the resolved path style —
    # exactly what the real `vmrun list` output looked like in the repro.
    vmrun_output = (
        "Total running VMs: 2\n"
        + _REAL_TARGET + r"\.vagrant\machines\ap-target\vmware_desktop\x\a.vmx" + "\n"
        + _REAL_TARGET + r"\.vagrant\machines\ap-second\vmware_desktop\y\b.vmx" + "\n"
    )
    monkeypatch.setattr(
        build_runner.subprocess, "run",
        lambda *a, **k: subprocess.CompletedProcess(a, 0, vmrun_output, ""),
    )

    assert build_runner._provider_vms_running(ws) == 2


def test_a_genuinely_powered_off_machine_is_still_not_counted(tmp_path, monkeypatch):
    ws = tmp_path / "ws"
    machines = ws / ".vagrant" / "machines"
    _make_machine(machines, "up", _JUNCTION_ALIAS + r"\.vagrant\machines\up\vmware_desktop\x\a.vmx")
    _make_machine(machines, "down", _JUNCTION_ALIAS + r"\.vagrant\machines\down\vmware_desktop\y\b.vmx")

    monkeypatch.setattr(os.path, "realpath", _fake_realpath_resolving_the_junction)
    monkeypatch.setattr(build_runner.hostenv, "vmrun_path", lambda: "vmrun")

    vmrun_output = "Total running VMs: 1\n" + _REAL_TARGET + r"\.vagrant\machines\up\vmware_desktop\x\a.vmx" + "\n"
    monkeypatch.setattr(
        build_runner.subprocess, "run",
        lambda *a, **k: subprocess.CompletedProcess(a, 0, vmrun_output, ""),
    )

    assert build_runner._provider_vms_running(ws) == 1
