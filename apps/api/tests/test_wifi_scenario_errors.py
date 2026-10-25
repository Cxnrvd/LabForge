"""apply_wifi_scenario must say why a switch failed instead of a generic 'unknown error'."""

from __future__ import annotations

import subprocess

from labforge_core.services import build_runner as br


def _run(monkeypatch, tmp_path, *, rc, stdout="", stderr=""):
    monkeypatch.setattr(br, "vagrant_available", lambda: True)
    monkeypatch.setattr(
        br, "guest_exec",
        lambda *a, **k: subprocess.CompletedProcess(a, rc, stdout, stderr),
    )
    return br.apply_wifi_scenario(tmp_path, "ap-target", False, "wep")


def test_unreachable_vm_reports_the_transport_error(monkeypatch, tmp_path):
    ok, msg = _run(monkeypatch, tmp_path, rc=1, stderr="A VM must be running to SSH.\n")
    assert not ok
    assert "could not reach ap-target" in msg
    assert "A VM must be running" in msg


def test_active_hostapd_is_success(monkeypatch, tmp_path):
    ok, msg = _run(monkeypatch, tmp_path, rc=0, stdout="active\nhostapd[1]: wlan0: AP-ENABLED")
    assert ok
    assert "'wep'" in msg


def test_failed_hostapd_still_reports_its_own_log_line(monkeypatch, tmp_path):
    ok, msg = _run(monkeypatch, tmp_path, rc=0, stdout="failed\nhostapd[9]: invalid WEP key")
    assert not ok
    assert "invalid WEP key" in msg


def test_no_interface_sentinel_is_unchanged(monkeypatch, tmp_path):
    ok, msg = _run(monkeypatch, tmp_path, rc=0, stdout="__NO_IFACE__")
    assert not ok
    assert "no interface found" in msg
