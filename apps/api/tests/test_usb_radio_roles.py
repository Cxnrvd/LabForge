"""Regression for the stale USB-radio role filter.

`ap-target` moved from the `atbm-wifi-driver` role to `rtl8188fu-wifi-driver`
when the chipset swapped from AltoBeam to the Realtek RTL8188FU
(packages/schema/templates/wifi-lab.json), but `_usb_radio_hosts` and
`_release_usb_radios` were left hardcoded to only the old role name — a
suspend of the Realtek-based `ap-target` silently skipped the pre-suspend
cleanup these functions exist to do, leaving hostapd and the dongle live
right up to the suspend and producing a VM that could not be cleanly
resumed. These tests pin both chipset roles so this can't drift silently
again.
"""

from __future__ import annotations

import json
import subprocess
from pathlib import Path

from labforge_core.services import build_runner


def _write_topology(ws: Path, nodes: list[dict]) -> None:
    (ws / "topology.json").write_text(json.dumps({"nodes": nodes}), encoding="utf-8")


def test_usb_radio_hosts_matches_altobeam_and_realtek(tmp_path: Path) -> None:
    _write_topology(
        tmp_path,
        [
            {"config": {"hostname": "ap-target", "roles": ["rtl8188fu-wifi-driver", "hostapd"]}},
            {"config": {"hostname": "ap-second", "roles": ["atbm-wifi-driver", "hostapd-second"]}},
            {"config": {"hostname": "radius", "roles": ["freeradius"]}},
        ],
    )
    assert set(build_runner._usb_radio_hosts(tmp_path)) == {"ap-target", "ap-second"}


def test_release_usb_radios_uses_the_right_module_per_chipset(
    tmp_path: Path, monkeypatch
) -> None:
    _write_topology(
        tmp_path,
        [
            {"config": {"hostname": "ap-target", "roles": ["rtl8188fu-wifi-driver", "hostapd"]}},
            {"config": {"hostname": "ap-second", "roles": ["atbm-wifi-driver", "hostapd-second"]}},
        ],
    )
    calls: list[list[str]] = []

    def fake_killtree(argv, **kw):
        calls.append(argv)
        return subprocess.CompletedProcess(argv, 0, "", "")

    monkeypatch.setattr(build_runner, "_run_killtree", fake_killtree)
    build_runner._release_usb_radios(tmp_path)

    by_host = {argv[2]: argv[4] for argv in calls}
    assert "rmmod rtl8xxxu" in by_host["ap-target"]
    assert "rmmod atbm6012bx" in by_host["ap-second"]


def test_release_usb_radios_only_host_scopes_to_one_machine(
    tmp_path: Path, monkeypatch
) -> None:
    _write_topology(
        tmp_path,
        [
            {"config": {"hostname": "ap-target", "roles": ["rtl8188fu-wifi-driver", "hostapd"]}},
            {"config": {"hostname": "ap-second", "roles": ["atbm-wifi-driver", "hostapd-second"]}},
        ],
    )
    calls: list[list[str]] = []
    monkeypatch.setattr(
        build_runner, "_run_killtree",
        lambda argv, **kw: calls.append(argv) or subprocess.CompletedProcess(argv, 0, "", ""),
    )
    build_runner._release_usb_radios(tmp_path, only_host="ap-second")
    assert len(calls) == 1
    assert calls[0][2] == "ap-second"
