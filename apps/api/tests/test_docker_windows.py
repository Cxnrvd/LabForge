"""Windows guests in the docker runtime (dockur/windows: a real Windows VM in a container)."""

from __future__ import annotations

import yaml
from labforge_schema import NodeType, Provider

from labforge_core.services.compose_generator import (
    build_bundle,
    has_windows_guests,
    is_windows_guest,
)
from labforge_core.services.template_loader import get_template


def _docker_dfir():
    return get_template("dfir-lab").model_copy(update={"provider": Provider.DOCKER})


def _windows_nodes(topology):
    return [n for n in topology.nodes if n.config.os.value.startswith("windows")]


def test_windows_workstation_becomes_a_kvm_backed_service():
    topology = _docker_dfir()
    files, art = build_bundle(topology, project="lf1-win")
    doc = yaml.safe_load(files["docker-compose.yml"])
    win = _windows_nodes(topology)[0]
    host = win.config.hostname

    svc = doc["services"][host]
    assert svc["image"].startswith("dockurr/windows")
    assert svc["devices"] == ["/dev/kvm"]
    assert "NET_ADMIN" in svc["cap_add"]
    assert not svc.get("privileged")
    assert f"{host}-storage:/storage" in svc["volumes"]
    assert svc["networks"]["labforge"]["ipv4_address"] == win.config.ip
    assert host in art.windows_hosts
    assert f"{host}-storage" in doc["volumes"]

    env = files[f"env/{host}.env"]
    assert "VERSION=10" in env
    assert f"USERNAME={win.config.credentials.username}" in env
    assert "RAM_SIZE=" in env and "DISK_SIZE=64G" in env
    assert f"oem/{host}/install.bat" in files
    assert b"fictional" in files[f"oem/{host}/install.bat"]
    # No bind mount: the first-boot script is injected as a Compose config.
    assert not any("./oem" in str(v) for v in svc["volumes"])
    assert svc["configs"][0]["target"] == "/oem/install.bat"
    assert "fictional" in doc["configs"][f"oem-{host}"]["content"]
    assert f"{host}" not in art.fallback_notes


def test_windows_ports_are_loopback_only():
    topology = _docker_dfir()
    files, art = build_bundle(topology, project="lf1-win")
    doc = yaml.safe_load(files["docker-compose.yml"])
    host = _windows_nodes(topology)[0].config.hostname
    ports = doc["services"][host]["ports"]
    assert all(p.startswith("127.0.0.1:") for p in ports)
    assert {c for _, c in art.published_ports[host]} == {8006, 3389}
    assert "Windows console" in files["README.md"]


def test_small_ram_is_raised_and_warned():
    topology = _docker_dfir()
    win = _windows_nodes(topology)[0]
    win.config.memory_mb = 2048
    files, art = build_bundle(topology, project="lf1-win")
    host = win.config.hostname
    assert "RAM_SIZE=4096M" in files[f"env/{host}.env"]
    assert any("below the 4096 MB" in w for w in art.warnings)


def test_first_boot_and_kvm_warning_present():
    _, art = build_bundle(_docker_dfir(), project="lf1-win")
    assert any("/dev/kvm" in w for w in art.warnings)


def test_domain_controller_and_linux_nodes_unchanged():
    topology = _docker_dfir()
    assert has_windows_guests(topology)
    linux = [n for n in topology.nodes if not n.config.os.value.startswith("windows")]
    files, _ = build_bundle(topology, project="lf1-win")
    doc = yaml.safe_load(files["docker-compose.yml"])
    for node in linux:
        if node.config.hostname in doc["services"]:
            assert "devices" not in doc["services"][node.config.hostname]
    dc = next(n for n in topology.nodes if n.type is NodeType.WORKSTATION)
    dc.type = NodeType.DOMAIN_CONTROLLER
    assert not is_windows_guest(dc)
