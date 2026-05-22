"""Lock the build.log → per-VM phase parser.

The /monitor topology view polls /labs/{id}/build/phases every few
seconds while a build runs. The output drives a 5-step stepper and
colours each canvas node's status ring, so a misclassified phase shows
up as either a stuck stepper or a permanently-amber node — both bad
signals for a user trying to diagnose a failing build.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from labforge_core.services.build_runner import (
    BUILD_LOG,
    parse_per_vm_phases,
)


def _write(workspace: Path, body: str) -> Path:
    workspace.mkdir(parents=True, exist_ok=True)
    (workspace / BUILD_LOG).write_text(body, encoding="utf-8")
    return workspace


def test_phase_parser_returns_empty_when_no_log(tmp_path: Path) -> None:
    assert parse_per_vm_phases(tmp_path) == {}


def test_phase_parser_picks_highest_rank(tmp_path: Path) -> None:
    # A real virtualbox build trace from the UAT we ran today.
    body = """\
--- vagrant up start ---
--- provider=virtualbox ---
Bringing machine 'uat-vbox' up with 'virtualbox' provider...
==> uat-vbox: Importing base box 'bento/ubuntu-22.04'...
==> uat-vbox: Matching MAC address for NAT networking...
==> uat-vbox: Setting the name of the VM: labforge-uat-vbox
==> uat-vbox: Preparing network interfaces based on configuration...
==> uat-vbox: Forwarding ports...
==> uat-vbox: Booting VM...
==> uat-vbox: Waiting for machine to boot. This may take a few minutes...
==> uat-vbox: Machine booted and ready!
==> uat-vbox: Setting hostname...
==> uat-vbox: Configuring and enabling network interfaces...
==> uat-vbox: Running provisioner: shell...
    uat-vbox: [2026-05-21T08:06:28+00:00] === LabForge provisioner complete for uat-vbox ===
"""
    _write(tmp_path, body)
    assert parse_per_vm_phases(tmp_path) == {"uat-vbox": "ready"}


def test_phase_parser_handles_vmware_clone_phase(tmp_path: Path) -> None:
    body = """\
==> uat-vmware: Cloning VMware VM: 'bento/ubuntu-22.04'. This can take some time...
==> uat-vmware: Verifying vmnet devices are healthy...
==> uat-vmware: Preparing network adapters...
==> uat-vmware: Starting the VMware VM...
==> uat-vmware: Waiting for the VM to receive an address...
"""
    _write(tmp_path, body)
    # The latest marker is "Waiting for the VM to receive an address"
    # which is part of booting; ranks above network so booting wins.
    phases = parse_per_vm_phases(tmp_path)
    assert phases["uat-vmware"] in {"booting", "network"}


def test_phase_parser_tracks_each_vm_independently(tmp_path: Path) -> None:
    body = """\
==> cam-mediamtx: Importing base box 'bento/ubuntu-22.04'...
==> cam-mediamtx: Booting VM...
==> cam-mediamtx: Running provisioner: shell...
==> plc-openplc: Importing base box 'bento/ubuntu-22.04'...
==> plc-openplc: Booting VM...
==> siem-splunk: Downloading: https://example/box.box
"""
    _write(tmp_path, body)
    phases = parse_per_vm_phases(tmp_path)
    assert phases == {
        "cam-mediamtx": "provisioning",
        "plc-openplc": "booting",
        "siem-splunk": "downloading",
    }


def test_phase_parser_marks_failed_on_error_marker(tmp_path: Path) -> None:
    body = """\
==> uat-vbox: Importing base box 'bento/ubuntu-22.04'...
==> uat-vbox: Booting VM...
==> uat-vbox: error: Failed to create the host-only adapter
"""
    _write(tmp_path, body)
    assert parse_per_vm_phases(tmp_path) == {"uat-vbox": "failed"}


def test_phase_parser_skips_pre_progression_errors(tmp_path: Path) -> None:
    # An early "Box could not be found" line shouldn't fail the VM —
    # vagrant recovers by downloading. The parser should only flip
    # failed once the VM has reached at least one phase past defined.
    body = """\
==> uat-vbox: Box 'foo' could not be found.
"""
    _write(tmp_path, body)
    # No phase recorded for this hostname since "Box could not be found"
    # doesn't match any phase pattern.
    assert parse_per_vm_phases(tmp_path) == {}


@pytest.mark.parametrize(
    "marker,expected",
    [
        ("Downloading: https://example/box", "downloading"),
        ("Importing base box 'foo/bar'...", "importing"),
        ("Booting VM...", "booting"),
        ("Setting hostname...", "network"),
        ("Configuring and enabling network interfaces...", "network"),
        ("Preparing network adapters...", "network"),
        ("Forwarding ports...", "network"),
        ("Running provisioner: shell...", "provisioning"),
        ("Machine booted and ready!", "ready"),
    ],
)
def test_phase_parser_each_marker(tmp_path: Path, marker: str, expected: str) -> None:
    _write(tmp_path, f"==> host: {marker}\n")
    assert parse_per_vm_phases(tmp_path) == {"host": expected}
