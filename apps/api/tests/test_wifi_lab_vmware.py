"""The WiFi Lab template targets VMware: USB passthrough lands in vmx keys, and
each of its two AP nodes (Realtek ap-target, AltoBeam ap-second) gets its own
chipset-specific kernel upgrade + reboot ahead of provisioning."""

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


def test_each_ap_node_gets_its_own_kernel_upgrade_reboot():
    # Two real APs now, two different chipsets: ap-target (Realtek) needs the
    # backports-kernel path, ap-second (AltoBeam) needs the original
    # kernel-upgrade path — each gets its own reboot block.
    vf = _artifacts().vagrantfile
    assert vf.count('type: "shell", privileged: true, reboot: true') == 2
    ap_target = vf.split('config.vm.define "ap-target"')[1].split("config.vm.define")[0]
    assert "backports-kernel-upgrade" in ap_target
    ap_second = vf.split('config.vm.define "ap-second"')[1].split("config.vm.define")[0]
    assert "kernel-upgrade" in ap_second
    assert "backports-kernel-upgrade" not in ap_second


def test_ap_second_provisioner_builds_the_combo_driver():
    # The AltoBeam combo-driver role lives on ap-second now, not ap-target.
    script = _artifacts().provisioner_scripts["provision_ap-second.sh"]
    assert "wifi_bt_comb=1" in script
    assert "CONFIG_ATBM_BLE_WIFI_PLATFORM=y" in script
    assert "380838e871c793ff4feb19bd584d9508b162b835" in script


def test_ap_target_provisioner_builds_the_realtek_driver():
    script = _artifacts().provisioner_scripts["provision_ap-target.sh"]
    assert "rtl8188fufw.bin" in script
    assert "rtl8xxxu" in script
    assert "kelebek333" in script


def test_vmware_boxes_pin_amd64_so_current_kali_is_chosen():
    # 5 nodes now (ap-second added), all pinned to the amd64 box architecture.
    vf = _artifacts().vagrantfile
    assert vf.count('m.vm.box_architecture = "amd64"') == 5


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
