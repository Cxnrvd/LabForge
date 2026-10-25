"""Regression for `_ensure_guest_private_network`: a guest's own private-network
NIC coming up `state DOWN` with no address, distinct from (and alongside)
`_ensure_vmware_private_network`'s host-adapter fix.

Reproduced live: `siem`'s eth1 existed but was never brought up/assigned its
static IP after a boot, so nothing on the lab network (other guests, or the
host reaching the Wazuh dashboard) could reach it even though `vmrun`/`vagrant
status` reported the VM "running" and every service on it was healthy.
"""

from __future__ import annotations

import json
import subprocess
from pathlib import Path

from labforge_agent import daemon


def _write_topology(ws: Path, cidr: str = "10.71.0.0/24") -> None:
    (ws / "topology.json").write_text(json.dumps({"network_cidr": cidr, "nodes": []}), encoding="utf-8")


def test_fixes_a_down_interface_and_reports_it(tmp_path, monkeypatch):
    _write_topology(tmp_path)
    monkeypatch.setattr(daemon.shutil, "which", lambda name: "/usr/bin/vagrant")

    calls: list[list[str]] = []

    def fake_killtree(argv, **kw):
        calls.append(argv)
        return subprocess.CompletedProcess(argv, 0, "FIXED:eth1\n", "")

    monkeypatch.setattr(daemon, "_run_killtree", fake_killtree)

    lines = daemon._ensure_guest_private_network(tmp_path, {"siem": "10.71.0.30"})

    assert calls[0][:3] == ["vagrant", "ssh", "siem"]
    assert len(lines) == 1
    assert "siem" in lines[0] and "10.71.0.30/24" in lines[0] and "eth1" in lines[0]


def test_already_configured_interface_is_silent(tmp_path, monkeypatch):
    _write_topology(tmp_path)
    monkeypatch.setattr(daemon.shutil, "which", lambda name: "/usr/bin/vagrant")
    monkeypatch.setattr(
        daemon, "_run_killtree",
        lambda argv, **kw: subprocess.CompletedProcess(argv, 0, "ALREADY_OK\n", ""),
    )
    assert daemon._ensure_guest_private_network(tmp_path, {"ap-target": "10.71.0.20"}) == []


def test_no_spare_interface_is_reported_not_silently_dropped(tmp_path, monkeypatch):
    _write_topology(tmp_path)
    monkeypatch.setattr(daemon.shutil, "which", lambda name: "/usr/bin/vagrant")
    monkeypatch.setattr(
        daemon, "_run_killtree",
        lambda argv, **kw: subprocess.CompletedProcess(argv, 1, "NO_BARE_IFACE\n", ""),
    )
    lines = daemon._ensure_guest_private_network(tmp_path, {"radius": "10.71.0.25"})
    assert len(lines) == 1
    assert "radius" in lines[0]


def test_no_vagrant_on_path_is_a_noop(tmp_path, monkeypatch):
    _write_topology(tmp_path)
    monkeypatch.setattr(daemon.shutil, "which", lambda name: None)

    def _never_called(*a, **kw):
        raise AssertionError("should not shell out when vagrant isn't on PATH")

    monkeypatch.setattr(daemon, "_run_killtree", _never_called)
    assert daemon._ensure_guest_private_network(tmp_path, {"siem": "10.71.0.30"}) == []


def test_missing_topology_is_a_noop(tmp_path, monkeypatch):
    monkeypatch.setattr(daemon.shutil, "which", lambda name: "/usr/bin/vagrant")
    assert daemon._ensure_guest_private_network(tmp_path, {"siem": "10.71.0.30"}) == []
