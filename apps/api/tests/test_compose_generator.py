"""Docker compose target tests."""

from __future__ import annotations

import yaml

from labforge_core.services.compose_generator import build_bundle, render


def test_compose_renders_each_service(two_node_topology):
    artifacts = render(two_node_topology)
    document = yaml.safe_load(artifacts.compose_yaml)
    assert "services" in document
    assert "srv" in document["services"]
    # Attacker node should be skipped if Kali isn't an image we ship — but
    # it is in _OS_FALLBACK_IMAGE so it should be present.
    assert "kali" in document["services"]


def test_compose_creates_env_files(two_node_topology):
    artifacts = render(two_node_topology)
    assert "env/srv.env" in artifacts.env_files
    content = artifacts.env_files["env/srv.env"]
    assert "LABFORGE_HOSTNAME=srv" in content


def test_compose_warns_about_vm_only_nodes():
    """A topology containing a DC should emit a fallback note for it."""
    from labforge_schema import (
        Credentials,
        LabConfig,
        NodeConfig,
        NodeType,
        OsType,
        Position,
        TopologyNode,
    )

    dc = TopologyNode(
        id="dc",
        type=NodeType.DOMAIN_CONTROLLER,
        label="dc",
        position=Position(x=0, y=0),
        config=NodeConfig(
            os=OsType.WINDOWS_SERVER_2019,
            ip="192.168.56.10",
            hostname="dc01",
            roles=["AD-Domain-Services"],
            credentials=Credentials(username="vagrant", password="vagrant"),
        ),
    )
    topo = LabConfig(name="dc-only", network_cidr="192.168.56.0/24", nodes=[dc])
    artifacts = render(topo)
    document = yaml.safe_load(artifacts.compose_yaml)
    # Compose target skips VM-only types — the DC must not appear as a service.
    assert "dc01" not in document.get("services", {})
    assert "dc01" in artifacts.fallback_notes


def test_log4shell_template_target_builds_the_real_vulnerable_app():
    """The CVE-2021-44228 template's target must build the real app on the port its edge names,
    not a bare httpd container with nothing listening there (see docker_roles 'log4shell-target')."""
    from labforge_schema import Provider

    from labforge_core.services.template_loader import get_template

    topology = get_template("cve-lab-log4shell")
    assert any(e.port == 8080 and "vuln01" in (e.source, e.target) for e in topology.edges)
    docker_topology = topology.model_copy(update={"provider": Provider.DOCKER})
    files, artifacts = build_bundle(
        docker_topology, project="lf-log4j", include_readme=False, include_hosts_file=False
    )
    compose = yaml.safe_load(files["docker-compose.yml"])
    target = compose["services"]["vuln-app"]
    assert target["build"]["context"] == "./build/log4shell-target"
    assert target["ports"] == ["127.0.0.1:8080:8080"]  # matches the template's "JNDI injection" edge
    assert "build/log4shell-target/Dockerfile" in files
    assert "build/log4shell-target/VulnApp.java" in files
    assert b"log4j-core-2.14.1.jar" in files["build/log4shell-target/Dockerfile"]
    assert not any("has no container preset" in w and "vuln" in w for w in artifacts.warnings)
