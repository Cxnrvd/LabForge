"""Docker compose target tests."""

from __future__ import annotations

import yaml

from labforge_core.services.compose_generator import render


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
