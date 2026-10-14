"""The WiFi Lab template targets VMware: USB passthrough lands in vmx keys, and
the AltoBeam driver node gets a kernel upgrade + reboot ahead of provisioning."""

from __future__ import annotations

import json
from pathlib import Path

from labforge_schema import LabConfig

from labforge_core.services.generator import generate_artifacts

TEMPLATE = Path(__file__).resolve().parents[3] / "packages" / "schema" / "templates" / "wifi-lab.json"


def _artifacts():
    return generate_artifacts(LabConfig.model_validate(json.loads(TEMPLATE.read_text(encoding="utf-8"))))


def test_wifi_lab_uses_vmware_with_usb_autoconnect():
    vf = _artifacts().vagrantfile
    assert "m.vm.provider :vmware_desktop" in vf
    assert 'v.vmx["usb.autoConnect.device0"] = "0x007a:0x888b"' in vf
    assert 'v.vmx["usb.autoConnect.device0"] = "0x0e8d:0x7610"' in vf
    # VirtualBox-only attributes must not leak into the VMware provider block
    assert "v.memory" not in vf and "usbfilter" not in vf


def test_only_the_ap_node_gets_the_kernel_upgrade_reboot():
    vf = _artifacts().vagrantfile
    assert vf.count('type: "shell", privileged: true, reboot: true') == 1
    ap = vf.split('config.vm.define "ap-target"')[1].split("config.vm.define")[0]
    assert "kernel-upgrade" in ap


def test_ap_provisioner_builds_the_combo_driver():
    script = _artifacts().provisioner_scripts["provision_ap-target.sh"]
    assert "wifi_bt_comb=1" in script
    assert "CONFIG_ATBM_BLE_WIFI_PLATFORM=y" in script
    assert "380838e871c793ff4feb19bd584d9508b162b835" in script


def test_vmware_boxes_pin_amd64_so_current_kali_is_chosen():
    vf = _artifacts().vagrantfile
    assert vf.count('m.vm.box_architecture = "amd64"') == 4


def test_kali_wifi_gets_the_attack_tooling_topup():
    script = _artifacts().provisioner_scripts["provision_kali-wifi.sh"]
    for pkg in ("hcxdumptool", "hcxtools", "mdk4", "eaphammer", "hostapd-wpe"):
        assert pkg in script


def test_vmware_gui_node_gets_both_cursor_fixes():
    vf = _artifacts().vagrantfile
    assert 'v.vmx["mks.enable3d"] = "FALSE"' in vf
    assert 'v.vmx["mks.noHostCursor"] = "TRUE"' in vf
    kali_script = _artifacts().provisioner_scripts["provision_kali-wifi.sh"]
    assert "20-swcursor.conf" in kali_script
    assert 'Option "SWcursor" "true"' in kali_script
