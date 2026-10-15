"""hostenv.usb_devices() parser and the GET /api/v1/host/usb-devices route.

This is the testable half of the wifi-pentest-env feature: parsing
`VBoxManage list usbhost` output into vendor/product IDs for the Launch
dialog's device picker. The live-device behaviour (does VirtualBox actually
see a real USB wifi adapter, does monitor mode work once passed through)
needs real hardware and can't be verified in CI — see docs/labs for that
note.
"""

from __future__ import annotations

import subprocess
from unittest.mock import patch

from fastapi.testclient import TestClient

from labforge_core.services import hostenv

_SAMPLE_OUTPUT = """UUID:               1234abcd-0000-0000-0000-000000000001
VendorId:           0x0bda (0BDA)
ProductId:          0x8812 (8812)
Revision:           2.0 (0200)
Port:               1
USB version/speed:  2/High
Manufacturer:       Realtek
Product:            802.11n WLAN Adapter
Address:            \\\\?\\usb#vid_0bda&pid_8812
Current State:      Busy

UUID:               1234abcd-0000-0000-0000-000000000002
VendorId:           0x046d (046D)
ProductId:          0xc52b (C52B)
Manufacturer:       Logitech
Product:            USB Receiver
Current State:      Captured

"""


def _proc(stdout: str, returncode: int = 0) -> subprocess.CompletedProcess[str]:
    return subprocess.CompletedProcess(args=[], returncode=returncode, stdout=stdout, stderr="")


def test_parses_multiple_devices_with_zero_padded_ids():
    with patch.object(hostenv, "_run", return_value=_proc(_SAMPLE_OUTPUT)), \
         patch.object(hostenv, "vboxmanage_command", return_value=["VBoxManage"]), \
         patch("shutil.which", return_value="/usr/bin/VBoxManage"):
        devices = hostenv.usb_devices()

    assert devices == [
        {
            "vendor_id": "0bda",
            "product_id": "8812",
            "manufacturer": "Realtek",
            "name": "802.11n WLAN Adapter",
            "state": "Busy",
        },
        {
            "vendor_id": "046d",
            "product_id": "c52b",
            "manufacturer": "Logitech",
            "name": "USB Receiver",
            "state": "Captured",
        },
    ]


def test_empty_when_virtualbox_not_installed():
    with patch("shutil.which", return_value=None), \
         patch.object(hostenv, "is_windows", return_value=False):
        assert hostenv.usb_devices() == []


def test_empty_on_nonzero_exit():
    with patch.object(hostenv, "_run", return_value=_proc("", returncode=1)), \
         patch.object(hostenv, "vboxmanage_command", return_value=["VBoxManage"]), \
         patch("shutil.which", return_value="/usr/bin/VBoxManage"):
        assert hostenv.usb_devices() == []


def test_empty_on_no_output():
    with patch.object(hostenv, "_run", return_value=_proc("")), \
         patch.object(hostenv, "vboxmanage_command", return_value=["VBoxManage"]), \
         patch("shutil.which", return_value="/usr/bin/VBoxManage"):
        assert hostenv.usb_devices() == []


def test_skips_device_block_missing_an_id():
    broken = """UUID:               1234abcd-0000-0000-0000-000000000003
VendorId:           0x0bda (0BDA)
Manufacturer:       Realtek
Product:            Incomplete Entry
Current State:      Available

"""
    with patch.object(hostenv, "_run", return_value=_proc(broken)), \
         patch.object(hostenv, "vboxmanage_command", return_value=["VBoxManage"]), \
         patch("shutil.which", return_value="/usr/bin/VBoxManage"):
        assert hostenv.usb_devices() == []


def test_route_returns_devices_list():
    from labforge_core.api.main import app

    with patch.object(hostenv, "usb_devices", return_value=[{"vendor_id": "0bda", "product_id": "8812"}]):
        client = TestClient(app)
        resp = client.get("/api/v1/host/usb-devices")

    assert resp.status_code == 200
    assert resp.json() == {"devices": [{"vendor_id": "0bda", "product_id": "8812"}]}
