"""Validator behavioural tests."""

from __future__ import annotations

from labforge_schema import (
    AttackTactic,
    AttackTag,
    Credentials,
    LabConfig,
    NodeConfig,
    NodeType,
    OsType,
    Position,
    Protocol,
    Size,
    TopologyEdge,
    TopologyNode,
    Zone,
    ZoneShape,
)

from labforge_core.services.validator import validate_topology


def _node(
    nid: str,
    *,
    typ: NodeType = NodeType.SERVER,
    os: OsType = OsType.UBUNTU_2204,
    ip: str = "192.168.56.10",
    host: str | None = None,
    roles: list[str] | None = None,
    gateway: str | None = None,
) -> TopologyNode:
    return TopologyNode(
        id=nid,
        type=typ,
        label=nid,
        position=Position(x=0, y=0),
        config=NodeConfig(
            os=os,
            ip=ip,
            hostname=host or nid,
            roles=roles or [],
            credentials=Credentials(username="vagrant", password="vagrant"),
            gateway=gateway,
        ),
    )


def _topo(nodes, edges=None, zones=None, cidr="192.168.56.0/24") -> LabConfig:
    return LabConfig(
        name="t",
        network_cidr=cidr,
        nodes=nodes,
        edges=edges or [],
        zones=zones or [],
    )


def test_minimal_topology_validates(minimal_topology):
    result = validate_topology(minimal_topology)
    assert result.valid
    assert result.issues == []


def test_duplicate_hostnames_are_an_error():
    topo = _topo([
        _node("a", host="dup", ip="192.168.56.10"),
        _node("b", host="dup", ip="192.168.56.11"),
    ])
    result = validate_topology(topo)
    assert not result.valid
    assert any("Hostname" in issue.message for issue in result.issues)


def test_ip_outside_cidr_is_a_warning():
    topo = _topo([_node("a", ip="10.0.0.1")])
    result = validate_topology(topo)
    msgs = [i.message for i in result.issues]
    assert any("outside lab network" in m for m in msgs)


def test_dc_must_run_windows_server():
    topo = _topo([
        _node(
            "dc",
            typ=NodeType.DOMAIN_CONTROLLER,
            os=OsType.UBUNTU_2204,
            roles=["AD-Domain-Services"],
        ),
    ])
    result = validate_topology(topo)
    assert not result.valid
    assert any("Domain controllers must run Windows Server" in i.message for i in result.issues)


def test_internet_through_perimeter_is_fine():
    """internet → firewall → server is the expected pattern; no warning."""
    topo = _topo(
        [
            _node("net", typ=NodeType.INTERNET, os=OsType.UBUNTU_2204, ip="8.8.8.8"),
            _node("fw", typ=NodeType.FIREWALL, os=OsType.PFSENSE_2_7, ip="192.168.56.1"),
            _node("srv", ip="192.168.56.10"),
        ],
        [
            TopologyEdge(id="e1", source="net", target="fw", protocol=Protocol.HTTPS),
            TopologyEdge(id="e2", source="fw", target="srv", protocol=Protocol.HTTPS),
        ],
    )
    result = validate_topology(topo)
    perimeter = [i for i in result.issues if "perimeter is open" in i.message]
    assert perimeter == []


def test_direct_internet_to_internal_warns():
    topo = _topo(
        [
            _node("net", typ=NodeType.INTERNET, os=OsType.UBUNTU_2204, ip="8.8.8.8"),
            _node("srv", ip="192.168.56.10"),
        ],
        [TopologyEdge(id="e1", source="net", target="srv", protocol=Protocol.HTTPS)],
    )
    result = validate_topology(topo)
    assert any("perimeter is open" in i.message for i in result.issues)


def test_ics_protocol_without_plc_warns():
    topo = _topo(
        [
            _node("a", ip="192.168.56.10"),
            _node("b", ip="192.168.56.11"),
        ],
        [TopologyEdge(id="e1", source="a", target="b", protocol=Protocol.MODBUS)],
    )
    result = validate_topology(topo)
    assert any("protocol probably mislabelled" in i.message for i in result.issues)


def test_ics_protocol_to_plc_passes():
    topo = _topo(
        [
            _node("hmi", typ=NodeType.ICS_HMI, os=OsType.WINDOWS_10, ip="192.168.56.10"),
            _node(
                "plc",
                typ=NodeType.ICS_PLC,
                os=OsType.SIEMENS_SIMATIC,
                ip="192.168.56.11",
            ),
        ],
        [TopologyEdge(id="e1", source="hmi", target="plc", protocol=Protocol.MODBUS)],
    )
    result = validate_topology(topo)
    assert all("mislabelled" not in i.message for i in result.issues)


def test_gateway_outside_cidr_warns():
    topo = _topo([_node("a", ip="192.168.56.10", gateway="10.0.0.1")])
    result = validate_topology(topo)
    assert any("Gateway" in i.message for i in result.issues)


def test_zone_id_collision_with_node():
    topo = _topo(
        [_node("rack")],
        zones=[
            Zone(
                id="rack",
                shape=ZoneShape.RECTANGLE,
                position=Position(x=0, y=0),
                size=Size(width=200, height=200),
                label="DMZ",
            )
        ],
    )
    result = validate_topology(topo)
    assert not result.valid
    assert any("collides with a node id" in i.message for i in result.issues)


def test_attack_tags_round_trip():
    node = _node("srv")
    node.attack_tags.append(AttackTag(tactic=AttackTactic.INITIAL_ACCESS, technique="T1190"))
    topo = _topo([node])
    result = validate_topology(topo)
    assert result.valid
    # Round-trip through JSON keeps the tags.
    again = LabConfig.model_validate_json(topo.model_dump_json())
    assert again.nodes[0].attack_tags[0].technique == "T1190"
