"""Behaviour that matters when LabForge runs on a Windows host.

None of this needs Windows or a hypervisor: the host is simulated by patching
``hostenv`` so the logic can be checked anywhere. The real thing is covered by
``python -m labforge_core.services.hostenv`` run on the actual machine.
"""

from __future__ import annotations

import subprocess
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from labforge_schema import OsType, Provider

from labforge_core.services import boxes, build_runner, compose_generator, hostenv
from labforge_core.services.generator import BOX_MAP
from labforge_core.services.template_loader import get_template

# ------------------------------------------------------------- line endings


def test_write_text_lf_never_emits_cr(tmp_path):
    target = tmp_path / "x.sh"
    hostenv.write_text_lf(target, "#!/bin/bash\r\necho hi\r\nexit 0\r\n")
    assert b"\r" not in target.read_bytes()


def test_powershell_files_get_a_bom(tmp_path):
    target = tmp_path / "provision_win.ps1"
    hostenv.write_guest_file(target, "Write-Host 'caf\u00e9'\n")
    assert target.read_bytes().startswith(b"\xef\xbb\xbf")
    other = tmp_path / "provision_lin.sh"
    hostenv.write_guest_file(other, "echo hi\n")
    assert not other.read_bytes().startswith(b"\xef\xbb\xbf")


def test_binary_files_are_left_alone(tmp_path):
    blob = b"MZ\x00\x00\r\n\r\n\xff"
    target = tmp_path / "tool.exe"
    hostenv.write_guest_file(target, blob, "build/x/tool.exe")
    assert target.read_bytes() == blob


def test_vm_workspace_has_only_lf_scripts(tmp_path):
    topology = get_template("dfir-lab")
    build_runner._write_artifacts(topology, tmp_path)
    for path in [tmp_path / "Vagrantfile", *(tmp_path / "provision").iterdir()]:
        assert b"\r" not in path.read_bytes().replace(b"\xef\xbb\xbf", b""), path.name
    windows = [p for p in (tmp_path / "provision").iterdir() if p.suffix == ".ps1"]
    assert windows and all(p.read_bytes().startswith(b"\xef\xbb\xbf") for p in windows)


def test_crlf_checkout_of_a_role_still_builds_identically(tmp_path, monkeypatch):
    """A Windows checkout with autocrlf must not change the image or its tag."""
    lf_root = tmp_path / "lf" / "fakenet"
    crlf_root = tmp_path / "crlf" / "fakenet"
    for root, eol in ((lf_root, b"\n"), (crlf_root, b"\r\n")):
        root.mkdir(parents=True)
        (root / "Dockerfile").write_bytes(b"FROM python:3.12-slim" + eol + b"COPY run.sh /run.sh" + eol)
        (root / "run.sh").write_bytes(b"#!/bin/sh" + eol + b"echo ok" + eol)

    monkeypatch.setattr(compose_generator, "ROLE_BUILD_ROOT", lf_root.parent)
    lf = compose_generator._read_build_dir("fakenet")
    monkeypatch.setattr(compose_generator, "ROLE_BUILD_ROOT", crlf_root.parent)
    crlf = compose_generator._read_build_dir("fakenet")

    assert lf == crlf
    assert all(b"\r" not in data for data in crlf.values())
    assert compose_generator._content_tag(lf) == compose_generator._content_tag(crlf)


# ------------------------------------------------------------------- boxes


def _topology():
    return get_template("dfir-lab")  # Windows 10 + Kali (Ubuntu box) + Ubuntu


def _cloud(records):
    return lambda name: records.get(name)


def _record(*providers):
    return {"current_version": {"providers": [{"name": p} for p in providers]}}


def test_downloaded_box_wins_without_touching_the_network():
    def boom(_name):  # pragma: no cover - must not be called
        raise AssertionError("network used")

    result = boxes.resolve_boxes(
        _topology(), "virtualbox", BOX_MAP, fetch=boom, verify=True,
        cached=lambda: {("StefanScherer/windows_10", "virtualbox"), ("bento/ubuntu-22.04", "virtualbox")},
    )
    assert not result.warnings
    assert OsType.WINDOWS_10 not in result.overrides  # default box is already local


def test_falls_through_to_the_candidate_that_has_the_provider():
    records = {
        "StefanScherer/windows_10": _record("vmware_desktop"),  # wrong provider
        "gusztavvargadr/windows-10": _record("virtualbox", "vmware_desktop"),
        "bento/ubuntu-22.04": _record("virtualbox"),
    }
    result = boxes.resolve_boxes(
        _topology(), "virtualbox", BOX_MAP, fetch=_cloud(records), cached=set, verify=True
    )
    assert result.overrides[OsType.WINDOWS_10] == "gusztavvargadr/windows-10"


def test_vmware_matches_vagrant_cloud_provider_names():
    records = {
        "StefanScherer/windows_10": _record("vmware_desktop"),
        "bento/ubuntu-22.04": _record("vmware_desktop"),
    }
    result = boxes.resolve_boxes(
        _topology(), "vmware_desktop", BOX_MAP, fetch=_cloud(records), cached=set, verify=True
    )
    assert OsType.WINDOWS_10 not in result.overrides


def test_missing_everywhere_refuses_the_build_with_a_hint():
    with pytest.raises(boxes.BoxUnavailable) as err:
        boxes.resolve_boxes(
            _topology(), "virtualbox", BOX_MAP, fetch=lambda _n: {}, cached=set, verify=True
        )
    assert "LABFORGE_BOX_OVERRIDES" in str(err.value)


def test_offline_warns_instead_of_blocking():
    result = boxes.resolve_boxes(
        _topology(), "virtualbox", BOX_MAP, fetch=lambda _n: None, cached=set, verify=True
    )
    assert result.warnings and "unreachable" in result.warnings[0]
    assert not result.overrides


def test_user_override_is_tried_first(monkeypatch):
    from types import SimpleNamespace

    settings = SimpleNamespace(box_overrides={"windows_10": "me/win10-lab"}, verify_boxes=True)
    monkeypatch.setattr(boxes, "get_settings", lambda: settings)
    assert boxes.candidates_for(OsType.WINDOWS_10, BOX_MAP[OsType.WINDOWS_10])[0] == "me/win10-lab"


# -------------------------------------------------------------- hypervisors

BASE = {
    "vagrant_version": "2.4.1",
    "virtualbox_version": "7.0.18r1",
    "vmware_vmrun": None,
    "vmware_plugin": False,
    "hypervisor_present": False,
}


def test_provider_problems():
    assert hostenv.provider_problem(Provider.VIRTUALBOX, BASE) is None
    assert hostenv.provider_problem(Provider.DOCKER, {}) is None
    assert hostenv.provider_problem(Provider.VIRTUALBOX, {**BASE, "vagrant_version": None})[0] == "vagrant_missing"
    assert hostenv.provider_problem(Provider.VIRTUALBOX, {**BASE, "virtualbox_version": None})[0] == "virtualbox_missing"
    assert hostenv.provider_problem(Provider.VMWARE, BASE)[0] == "vmware_missing"
    assert hostenv.provider_problem(Provider.VMWARE, {**BASE, "vmware_vmrun": "x"})[0] == "vmware_plugin_missing"
    assert hostenv.provider_problem(Provider.VMWARE, {**BASE, "vmware_vmrun": "x", "vmware_plugin": True}) is None


def test_libvirt_is_refused_on_windows(monkeypatch):
    monkeypatch.setattr(hostenv, "is_windows", lambda: True)
    assert hostenv.provider_problem(Provider.LIBVIRT, BASE)[0] == "libvirt_unsupported_host"


def test_hyperv_warning_only_for_virtualbox_on_windows(monkeypatch):
    monkeypatch.setattr(hostenv, "is_windows", lambda: True)
    busy = {**BASE, "hypervisor_present": True}
    assert any("Hyper-V" in w for w in hostenv.provider_warnings(Provider.VIRTUALBOX, busy))
    assert hostenv.provider_warnings(Provider.VMWARE, busy) == []
    assert hostenv.provider_warnings(Provider.VIRTUALBOX, BASE) == []


def test_resource_warning_when_ram_is_short(monkeypatch, tmp_path):
    monkeypatch.setattr(hostenv, "host_memory_mb", lambda: 8192)
    topology = get_template("dfir-lab")  # needs about 10 GB
    warnings = hostenv.resource_warnings(topology, tmp_path)
    assert any("MB of RAM" in w for w in warnings)


def test_host_address_inside_lab_network_is_reported(monkeypatch):
    monkeypatch.setattr(
        hostenv.socket, "getaddrinfo", lambda *a, **k: [(2, 1, 6, "", ("192.168.58.20", 0))]
    )
    assert hostenv.host_ip_conflicts("192.168.58.0/24") == ["192.168.58.20"]
    assert hostenv.host_ip_conflicts("10.9.0.0/24") == []


# -------------------------------------------------------------- stop a build


def test_stop_build_kills_the_whole_tree_on_windows(monkeypatch, tmp_path):
    (tmp_path / build_runner.BUILD_PID).write_text("4242")
    calls: list[list[str]] = []
    alive = iter([True, True, False])

    monkeypatch.setattr(hostenv, "is_windows", lambda: True)
    monkeypatch.setattr(build_runner, "read_build_status", lambda ws: {"phase": "running"})
    monkeypatch.setattr(build_runner, "is_pid_alive", lambda pid: next(alive, False))
    monkeypatch.setattr(subprocess, "call", lambda args, **kw: calls.append(args) or 0)

    out = build_runner.stop_build(tmp_path, kill_timeout_s=2)
    assert calls and calls[0][:2] == ["taskkill", "/T"]
    assert "4242" in calls[0]
    assert out["phase"] in {"aborted", "running"}
    assert (tmp_path / build_runner.BUILD_ABORTED).exists()


# ---------------------------------------------------------------- preflight


def test_preflight_reports_the_provider_problem(monkeypatch):
    from labforge_core.api.main import app

    monkeypatch.setattr(
        hostenv, "vm_runtime_status", lambda: {
            **BASE, "virtualbox_version": None, "host_os": "windows", "host_arch": "AMD64", "memory_mb": 16384,
        },
    )
    body = TestClient(app).get("/api/v1/labs/build/preflight?provider=virtualbox").json()
    assert body["provider_problem"]["code"] == "virtualbox_missing"
    assert body["vagrant_available"] is True
    assert body["host_os"] == "windows"
    assert "docker_available" in body


def test_build_is_refused_with_a_clear_code_when_virtualbox_is_missing(monkeypatch, tmp_path):
    from sqlmodel import Session, SQLModel, create_engine

    monkeypatch.setattr(hostenv, "vm_runtime_status", lambda: {**BASE, "virtualbox_version": None})
    engine = create_engine("sqlite://")
    SQLModel.metadata.create_all(engine)
    try:
        with Session(engine) as session, pytest.raises(build_runner.BuildPrereqError) as err:
            build_runner.start_build(get_template("dfir-lab"), session, tmp_path)
    finally:
        engine.dispose()
    assert err.value.code == "virtualbox_missing"
    assert list(tmp_path.iterdir()) == []


def test_workspace_path_warning_on_windows(monkeypatch):
    monkeypatch.setattr(hostenv, "is_windows", lambda: True)
    long_root = Path("C:/" + "x" * 130)
    assert any("workspace path is long" in w for w in hostenv.resource_warnings(get_template("dfir-lab"), long_root))
