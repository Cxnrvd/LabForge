"""Generator behavioural + snapshot tests."""

from __future__ import annotations

import io
import json
import zipfile

import pytest

from labforge_core.services.generator import generate_zip


def test_generate_minimal_zip_contains_expected_files(minimal_topology):
    data = generate_zip(minimal_topology)
    with zipfile.ZipFile(io.BytesIO(data)) as zf:
        names = set(zf.namelist())
    assert "Vagrantfile" in names
    assert "topology.json" in names
    assert "manifest.json" in names
    assert any(n.startswith("provision/") for n in names)


def test_generate_includes_manifest_with_topology_hash(minimal_topology):
    data = generate_zip(minimal_topology)
    with zipfile.ZipFile(io.BytesIO(data)) as zf:
        manifest = json.loads(zf.read("manifest.json"))
    assert manifest["manifest_version"] == 1
    assert manifest["topology"]["node_count"] == 1
    assert len(manifest["topology"]["sha256"]) == 64
    file_names = {entry["name"] for entry in manifest["files"]}
    assert "Vagrantfile" in file_names
    assert "topology.json" in file_names


def test_manifest_is_stable_across_runs(minimal_topology):
    """Topology hash must be identical regardless of generation timing."""
    data1 = generate_zip(minimal_topology)
    data2 = generate_zip(minimal_topology)
    with zipfile.ZipFile(io.BytesIO(data1)) as zf:
        m1 = json.loads(zf.read("manifest.json"))
    with zipfile.ZipFile(io.BytesIO(data2)) as zf:
        m2 = json.loads(zf.read("manifest.json"))
    assert m1["topology"]["sha256"] == m2["topology"]["sha256"]


def test_compose_target_emits_compose_yaml(two_node_topology):
    data = generate_zip(two_node_topology, target="docker-compose")
    with zipfile.ZipFile(io.BytesIO(data)) as zf:
        names = set(zf.namelist())
        compose_yaml = zf.read("docker-compose.yml").decode()
    assert "docker-compose.yml" in names
    assert "topology.json" in names
    assert "manifest.json" in names
    assert "labforge-srv" in compose_yaml or "srv" in compose_yaml


def test_compose_manifest_records_target(two_node_topology):
    data = generate_zip(two_node_topology, target="docker-compose")
    with zipfile.ZipFile(io.BytesIO(data)) as zf:
        manifest = json.loads(zf.read("manifest.json"))
    assert manifest["generator"]["target"] == "docker-compose"


def test_unknown_target_raises(minimal_topology):
    with pytest.raises(ValueError):
        generate_zip(minimal_topology, target="nonsense")


def test_each_template_generates(all_template_paths, load_template):
    """Every shipped template must render a valid Vagrant bundle."""
    assert all_template_paths, "no templates discovered"
    for path in all_template_paths:
        topology = load_template(path)
        docker = topology.provider.value == "docker"
        data = generate_zip(topology, target="docker-compose" if docker else "vagrant")
        with zipfile.ZipFile(io.BytesIO(data)) as zf:
            names = set(zf.namelist())
        if docker:
            assert "docker-compose.yml" in names, f"{path.name} missing compose file"
            assert ".labforge-project" in names
            continue
        assert "Vagrantfile" in names, f"{path.name} missing Vagrantfile"
        assert "manifest.json" in names, f"{path.name} missing manifest"


def test_coverage_warnings_flag_an_unmatched_role_and_a_notes_only_cve():
    """generate_artifacts().warnings is what the Launch/README/build-log fix for the
    splunk-enterprise and pfsense-emulator bugs relies on — prove it actually fires."""
    from labforge_schema import (
        Credentials,
        LabConfig,
        NodeConfig,
        NodeType,
        OsType,
        Position,
        TopologyNode,
    )

    from labforge_core.services.generator import generate_artifacts

    node = TopologyNode(
        id="srv",
        type=NodeType.SERVER,
        label="srv",
        position=Position(x=0, y=0),
        config=NodeConfig(
            os=OsType.UBUNTU_2204,
            ip="192.168.56.10",
            hostname="srv",
            roles=["not-a-real-role"],
            cves=["CVE-2020-1472"],  # Zerologon: known but notes-only
            credentials=Credentials(username="vagrant", password="vagrant"),
        ),
    )
    topology = LabConfig(name="warn-test", network_cidr="192.168.56.0/24", nodes=[node])
    artifacts = generate_artifacts(topology)
    assert any("not-a-real-role" in w and "no curated installer" in w for w in artifacts.warnings)
    assert any("CVE-2020-1472" in w and "notes only" in w for w in artifacts.warnings)
    assert "## Warnings" in artifacts.readme
    assert "not-a-real-role" in artifacts.readme or "CVE-2020-1472" in artifacts.readme


def test_readme_cve_status_distinguishes_real_notes_only_and_unknown():
    from labforge_schema import (
        Credentials,
        LabConfig,
        NodeConfig,
        NodeType,
        OsType,
        Position,
        TopologyNode,
    )

    from labforge_core.services.generator import generate_artifacts

    node = TopologyNode(
        id="srv",
        type=NodeType.SERVER,
        label="srv",
        position=Position(x=0, y=0),
        config=NodeConfig(
            os=OsType.UBUNTU_2204,
            ip="192.168.56.10",
            hostname="srv",
            cves=["CVE-2021-44228", "CVE-2020-1472", "CVE-1999-9999"],
            credentials=Credentials(username="vagrant", password="vagrant"),
        ),
    )
    topology = LabConfig(name="cve-status-test", network_cidr="192.168.56.0/24", nodes=[node])
    readme = generate_artifacts(topology).readme
    assert "CVE-2021-44228` — a real vulnerable target is set up" in readme
    assert "CVE-2020-1472` — notes only, nothing is set up" in readme
    assert "CVE-1999-9999` — no curated provisioner" in readme


def test_role_install_echo_line_shows_the_description_not_just_the_label():
    """Previously 'begin role: X' looked identical whether X installed something real or had no
    curated installer at all. The description must now be inline so a build log doesn't hide it."""
    from labforge_schema import (
        Credentials,
        LabConfig,
        NodeConfig,
        NodeType,
        OsType,
        Position,
        TopologyNode,
    )

    from labforge_core.services.generator import generate_artifacts

    real = TopologyNode(
        id="web",
        type=NodeType.SERVER,
        label="web",
        position=Position(x=0, y=0),
        config=NodeConfig(
            os=OsType.UBUNTU_2204,
            ip="192.168.56.10",
            hostname="web",
            roles=["apache"],
            credentials=Credentials(username="vagrant", password="vagrant"),
        ),
    )
    stub = TopologyNode(
        id="bad",
        type=NodeType.SERVER,
        label="bad",
        position=Position(x=0, y=0),
        config=NodeConfig(
            os=OsType.UBUNTU_2204,
            ip="192.168.56.11",
            hostname="bad",
            roles=["not-a-real-role"],
            credentials=Credentials(username="vagrant", password="vagrant"),
        ),
    )
    topology = LabConfig(name="echo-test", network_cidr="192.168.56.0/24", nodes=[real, stub])
    artifacts = generate_artifacts(topology)
    assert "begin role: apache (" in artifacts.provisioner_scripts["provision_web.sh"]
    assert "begin role: not-a-real-role (no curated installer)" in artifacts.provisioner_scripts["provision_bad.sh"]


def test_dfir_lab_splunk_and_telecom_ad_rts_firewall_now_have_real_installers():
    """Regression test for the two role-name-typo bugs: dfir-lab's splunk01 used
    'splunk-enterprise@9.3.0' and telecom-ad-rts's fw01 used 'pfsense-emulator', neither of which
    matched the registered 'splunk' / 'pfsense' installers, so neither node got anything installed."""
    from labforge_core.services.generator import generate_artifacts
    from labforge_core.services.template_loader import get_template

    dfir = get_template("dfir-lab")
    splunk_node = next(n for n in dfir.nodes if n.config.hostname == "splunk01")
    assert splunk_node.config.roles == ["splunk-enterprise@9.3.0"]
    dfir_artifacts = generate_artifacts(dfir)
    assert dfir_artifacts.warnings == []
    assert "splunkforwarder" in dfir_artifacts.provisioner_scripts["provision_splunk01.sh"]

    telecom = get_template("telecom-ad-rts")
    fw_node = next(n for n in telecom.nodes if n.config.hostname == "fw01")
    assert fw_node.config.roles == ["pfsense-emulator"]
    telecom_artifacts = generate_artifacts(telecom)
    assert telecom_artifacts.warnings == []
    assert "nftables" in telecom_artifacts.provisioner_scripts["provision_fw01.sh"]
