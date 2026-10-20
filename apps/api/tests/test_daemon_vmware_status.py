"""VMware labs are read with ``vmrun list``, and a hung child must not outlive its timeout."""

from __future__ import annotations

import subprocess
import sys
import time

import pytest
from labforge_agent import daemon


def _machine(ws, name, vmx):
    d = ws / ".vagrant" / "machines" / name / "vmware_desktop"
    d.mkdir(parents=True)
    (d / "id").write_text(str(vmx), encoding="utf-8")


def _fake_vmrun(monkeypatch, listing):
    monkeypatch.setattr(daemon, "_find_vmrun", lambda: "vmrun")
    monkeypatch.setattr(
        daemon, "_run_killtree",
        lambda argv, **kw: subprocess.CompletedProcess(argv, 0, listing, ""),
    )


def test_running_and_stopped_vms_from_vmrun(monkeypatch, tmp_path):
    up, down = tmp_path / "up" / "a.vmx", tmp_path / "down" / "b.vmx"
    _machine(tmp_path, "web", up)
    _machine(tmp_path, "db", down)
    _fake_vmrun(monkeypatch, f"Total running VMs: 1\n{up}\n")
    status, vms = daemon._vagrant_status(tmp_path)
    assert status == "partial"
    assert {v["hostname"]: v["state"] for v in vms} == {"web": "running", "db": "poweroff"}


def test_nothing_running_is_stopped(monkeypatch, tmp_path):
    _machine(tmp_path, "victim", tmp_path / "v.vmx")
    _fake_vmrun(monkeypatch, "Total running VMs: 0\n")
    assert daemon._vagrant_status(tmp_path) == (
        "stopped", [{"hostname": "victim", "state": "poweroff", "provider": "vmware_desktop"}]
    )


def test_vmss_file_marks_a_vm_suspended(monkeypatch, tmp_path):
    vmx = tmp_path / "vm" / "v.vmx"
    vmx.parent.mkdir()
    (vmx.parent / "v.vmss").write_bytes(b"")
    _machine(tmp_path, "victim", vmx)
    _fake_vmrun(monkeypatch, "Total running VMs: 0\n")
    _status, vms = daemon._vagrant_status(tmp_path)
    assert vms[0]["state"] == "suspended"


def test_non_vmware_workspace_falls_back_to_vagrant(monkeypatch, tmp_path):
    assert daemon._vmware_status(tmp_path) is None


def test_timeout_raises_and_returns_promptly():
    start = time.monotonic()
    with pytest.raises(subprocess.TimeoutExpired):
        daemon._run_killtree([sys.executable, "-c", "import time; time.sleep(30)"], cwd=None, timeout=1)
    assert time.monotonic() - start < 10
