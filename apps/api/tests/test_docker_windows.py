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
    # The installer ISO fills the page cache; dockurr counts that against the cgroup limit, so it
    # must not run its own free-memory check, and the limit leaves room beyond RAM_SIZE.
    assert "RAM_CHECK=N" in env
    assert int(svc["mem_limit"].rstrip("m")) >= win.config.memory_mb + 2048
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


def test_three_gigabyte_guest_is_written_as_3G():
    topology = _docker_dfir()
    win = _windows_nodes(topology)[0]
    win.config.memory_mb = 3072
    files, _ = build_bundle(topology, project="lf1-win")
    assert "RAM_SIZE=3G" in files[f"env/{win.config.hostname}.env"]


def test_small_ram_is_raised_and_warned():
    topology = _docker_dfir()
    win = _windows_nodes(topology)[0]
    win.config.memory_mb = 1024
    files, art = build_bundle(topology, project="lf1-win")
    host = win.config.hostname
    assert "RAM_SIZE=2G" in files[f"env/{host}.env"]
    assert any("below the 2048 MB" in w for w in art.warnings)


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


def test_ransomware_lab_has_two_windows_guests_with_logging_and_a_linux_fallback():
    from labforge_core.services.template_loader import get_template

    topology = get_template("ransomware-intrusion-lab")
    files, art = build_bundle(topology, project="lf1-rw")
    doc = yaml.safe_load(files["docker-compose.yml"])
    assert art.windows_hosts == ["ws-acc-014", "ws-ops-003"]
    web_ports = {art.published_ports[h][0][0] for h in art.windows_hosts}
    rdp_ports = {art.published_ports[h][1][0] for h in art.windows_hosts}
    assert len(web_ports) == 2 and len(rdp_ports) == 2  # distinct on the host
    for host in art.windows_hosts:
        svc = doc["services"][host]
        assert all(p.startswith("127.0.0.1:") for p in svc["ports"])
        assert svc["depends_on"] == {"elastic": {"condition": "service_healthy"}}
        env = files[f"env/{host}.env"]
        assert "VERSION=10" in env and "RAM_SIZE=3G" in env and "CPU_CORES=1" in env and "DISK_SIZE=64G" in env
        setup = files[f"oem/{host}/setup.ps1"].decode()
        assert "Sysmon64.exe" in setup and "winlogbeat" in setup.lower()
        assert "http://10.250.10.10:9200" in setup
        assert {c["target"] for c in svc["configs"]} == {"/oem/install.bat", "/oem/setup.ps1"}
    assert "kali" in doc["services"]
    linux = get_template("ransomware-intrusion-linux-lab")
    assert not any(n.config.os.value.startswith("windows") for n in linux.nodes)


def test_dollars_in_first_boot_scripts_survive_compose_interpolation():
    from labforge_core.services.template_loader import get_template

    files, _ = build_bundle(get_template("ransomware-intrusion-lab"), project="lf1-rw")
    doc = yaml.safe_load(files["docker-compose.yml"])
    content = doc["configs"]["oem-ws-acc-014-setup"]["content"]
    assert "$$work" in content and "$work" not in content.replace("$$work", "")
