"""Cross-field topology validation (beyond per-field Pydantic checks)."""

from __future__ import annotations

import ipaddress

from labforge_schema import (
    LabConfig,
    NodeType,
    OsType,
    TopologyNode,
    ValidationIssue,
    ValidationResult,
)

_WINDOWS_OS = {
    OsType.WINDOWS_10,
    OsType.WINDOWS_11,
    OsType.WINDOWS_SERVER_2019,
    OsType.WINDOWS_SERVER_2022,
}


def validate_topology(topology: LabConfig) -> ValidationResult:
    issues: list[ValidationIssue] = []

    try:
        network = ipaddress.IPv4Network(topology.network_cidr, strict=False)
    except ValueError as exc:
        issues.append(
            ValidationIssue(
                field="network_cidr",
                message=f"Invalid CIDR: {exc}",
                severity="error",
            )
        )
        return ValidationResult(valid=False, issues=issues)

    issues.extend(_check_unique_ids(topology))
    issues.extend(_check_unique_hostnames(topology))
    issues.extend(_check_ips_in_network(topology, network))
    issues.extend(_check_edges_reference_valid_nodes(topology))
    issues.extend(_check_node_type_os_combo(topology))
    issues.extend(_check_domain_controller_roles(topology))
    issues.extend(_check_gateway_in_network(topology, network))
    issues.extend(_check_internet_perimeter(topology))
    issues.extend(_check_ics_protocol_endpoints(topology))
    issues.extend(_check_zone_geometry(topology))

    has_error = any(i.severity == "error" for i in issues)
    return ValidationResult(valid=not has_error, issues=issues)


def _check_gateway_in_network(
    topology: LabConfig, network: ipaddress.IPv4Network
) -> list[ValidationIssue]:
    """If a node sets a gateway, it must be inside the lab CIDR (otherwise
    Vagrant's `private_network` won't route)."""
    out: list[ValidationIssue] = []
    for node in topology.nodes:
        gw = node.config.gateway
        if gw is None or node.type == NodeType.INTERNET:
            continue
        try:
            addr = ipaddress.IPv4Address(gw)
        except ValueError:
            continue  # already flagged by Pydantic field validator
        if addr not in network:
            out.append(
                ValidationIssue(
                    node_id=node.id,
                    field="config.gateway",
                    message=(
                        f"Gateway {gw} is outside lab network {network}; "
                        "the private_network won't route through it"
                    ),
                    severity="warning",
                )
            )
    return out


def _check_internet_perimeter(topology: LabConfig) -> list[ValidationIssue]:
    """Warn when an internet node connects directly to an internal host
    without a router or firewall in between. Catches the common mistake
    of dragging an `attacker → DC` edge that bypasses the perimeter."""
    out: list[ValidationIssue] = []
    nodes_by_id = {n.id: n for n in topology.nodes}
    perimeter_types = {NodeType.ROUTER, NodeType.FIREWALL}
    for edge in topology.edges:
        src = nodes_by_id.get(edge.source)
        dst = nodes_by_id.get(edge.target)
        if src is None or dst is None:
            continue
        is_external = (
            src.type == NodeType.INTERNET or dst.type == NodeType.INTERNET
        )
        if not is_external:
            continue
        other = dst if src.type == NodeType.INTERNET else src
        if other.type in perimeter_types:
            continue
        out.append(
            ValidationIssue(
                edge_id=edge.id,
                message=(
                    f"Edge '{edge.id}' connects the internet directly to "
                    f"'{other.config.hostname}' ({other.type.value}) without "
                    "a firewall or router in between — your perimeter is open"
                ),
                severity="warning",
            )
        )
    return out


_ICS_PROTOCOL_NODES = {
    NodeType.ICS_PLC,
    NodeType.ICS_HMI,
}


def _check_ics_protocol_endpoints(topology: LabConfig) -> list[ValidationIssue]:
    """Modbus / DNP3 / OPC UA edges should terminate on a PLC/HMI (or an
    explicit ICS-flagged attacker for red-team paths). Otherwise the
    edge is most likely mislabelled."""
    from labforge_schema import Protocol  # local import to keep top-level tidy

    out: list[ValidationIssue] = []
    nodes_by_id = {n.id: n for n in topology.nodes}
    ics_protocols = {Protocol.MODBUS, Protocol.DNP3, Protocol.OPCUA}
    for edge in topology.edges:
        if edge.protocol not in ics_protocols:
            continue
        src = nodes_by_id.get(edge.source)
        dst = nodes_by_id.get(edge.target)
        if src is None or dst is None:
            continue
        endpoints_have_ics = (
            src.type in _ICS_PROTOCOL_NODES or dst.type in _ICS_PROTOCOL_NODES
        )
        if endpoints_have_ics or NodeType.ATTACKER in {src.type, dst.type}:
            continue
        out.append(
            ValidationIssue(
                edge_id=edge.id,
                message=(
                    f"Edge '{edge.id}' uses {edge.protocol.value} but neither "
                    "endpoint is a PLC/HMI — protocol probably mislabelled"
                ),
                severity="warning",
            )
        )
    return out


def _check_zone_geometry(topology: LabConfig) -> list[ValidationIssue]:
    """Warn on absurdly small zones (which won't visually contain anything)
    and on zones that share the same id with a node."""
    out: list[ValidationIssue] = []
    node_ids = {n.id for n in topology.nodes}
    for zone in topology.zones:
        if zone.id in node_ids:
            out.append(
                ValidationIssue(
                    field=f"zones[{zone.id}].id",
                    message=f"Zone id '{zone.id}' collides with a node id",
                    severity="error",
                )
            )
        if zone.size.width < 80 or zone.size.height < 80:
            out.append(
                ValidationIssue(
                    field=f"zones[{zone.id}].size",
                    message=(
                        f"Zone '{zone.id}' is smaller than 80x80 — it won't "
                        "visually contain any nodes"
                    ),
                    severity="warning",
                )
            )
    return out


def _check_unique_ids(topology: LabConfig) -> list[ValidationIssue]:
    seen: dict[str, int] = {}
    out: list[ValidationIssue] = []
    for node in topology.nodes:
        seen[node.id] = seen.get(node.id, 0) + 1
    for node_id, count in seen.items():
        if count > 1:
            out.append(
                ValidationIssue(
                    node_id=node_id,
                    field="id",
                    message=f"Duplicate node id: {node_id}",
                    severity="error",
                )
            )
    edge_seen: dict[str, int] = {}
    for edge in topology.edges:
        edge_seen[edge.id] = edge_seen.get(edge.id, 0) + 1
    for edge_id, count in edge_seen.items():
        if count > 1:
            out.append(
                ValidationIssue(
                    edge_id=edge_id,
                    field="id",
                    message=f"Duplicate edge id: {edge_id}",
                    severity="error",
                )
            )
    return out


def _check_unique_hostnames(topology: LabConfig) -> list[ValidationIssue]:
    by_hostname: dict[str, list[str]] = {}
    for node in topology.nodes:
        by_hostname.setdefault(node.config.hostname.lower(), []).append(node.id)
    out: list[ValidationIssue] = []
    for hostname, node_ids in by_hostname.items():
        if len(node_ids) > 1:
            for nid in node_ids:
                out.append(
                    ValidationIssue(
                        node_id=nid,
                        field="config.hostname",
                        message=f"Hostname '{hostname}' is reused across nodes: {node_ids}",
                        severity="error",
                    )
                )
    return out


def _check_ips_in_network(
    topology: LabConfig, network: ipaddress.IPv4Network
) -> list[ValidationIssue]:
    out: list[ValidationIssue] = []
    by_ip: dict[str, list[str]] = {}
    for node in topology.nodes:
        # Internet / cloud placeholders represent the outside world; their
        # IPs are deliberately public ranges and shouldn't be in-CIDR.
        if node.type == NodeType.INTERNET:
            continue
        try:
            addr = ipaddress.IPv4Address(node.config.ip)
        except ValueError:
            out.append(
                ValidationIssue(
                    node_id=node.id,
                    field="config.ip",
                    message=f"Invalid IPv4: {node.config.ip}",
                    severity="error",
                )
            )
            continue
        if addr not in network:
            out.append(
                ValidationIssue(
                    node_id=node.id,
                    field="config.ip",
                    message=f"IP {addr} is outside lab network {network}",
                    severity="warning",
                )
            )
        by_ip.setdefault(str(addr), []).append(node.id)
    for ip, owners in by_ip.items():
        if len(owners) > 1:
            for nid in owners:
                out.append(
                    ValidationIssue(
                        node_id=nid,
                        field="config.ip",
                        message=f"IP {ip} is assigned to multiple nodes: {owners}",
                        severity="error",
                    )
                )
    return out


def _check_edges_reference_valid_nodes(topology: LabConfig) -> list[ValidationIssue]:
    node_ids = {n.id for n in topology.nodes}
    out: list[ValidationIssue] = []
    for edge in topology.edges:
        if edge.source not in node_ids:
            out.append(
                ValidationIssue(
                    edge_id=edge.id,
                    field="source",
                    message=f"Edge source '{edge.source}' references unknown node",
                    severity="error",
                )
            )
        if edge.target not in node_ids:
            out.append(
                ValidationIssue(
                    edge_id=edge.id,
                    field="target",
                    message=f"Edge target '{edge.target}' references unknown node",
                    severity="error",
                )
            )
        if edge.source == edge.target:
            out.append(
                ValidationIssue(
                    edge_id=edge.id,
                    message=f"Edge connects a node to itself: {edge.source}",
                    severity="warning",
                )
            )
    return out


_ATTACKER_OS = {
    OsType.KALI_ROLLING,
    OsType.PARROT_SECURITY,
    OsType.BLACKARCH_ROLLING,
    OsType.TAILS_6,
    OsType.WHONIX_17,
    OsType.UBUNTU_2204,
    OsType.UBUNTU_2404,
    OsType.DEBIAN_12,
    OsType.ARCH_ROLLING,
}

_ICS_PLC_OS = {
    OsType.SIEMENS_SIMATIC,
    OsType.SCHNEIDER_MODICON,
    OsType.VXWORKS_7,
    OsType.QNX_NEUTRINO,
    OsType.UBUNTU_2204,
    OsType.DEBIAN_12,
    OsType.RASPBIAN_12,
    OsType.ALPINE_LATEST,
}


def _check_node_type_os_combo(topology: LabConfig) -> list[ValidationIssue]:
    out: list[ValidationIssue] = []
    for node in topology.nodes:
        if node.type == NodeType.DOMAIN_CONTROLLER and node.config.os not in {
            OsType.WINDOWS_SERVER_2019,
            OsType.WINDOWS_SERVER_2022,
        }:
            out.append(
                ValidationIssue(
                    node_id=node.id,
                    field="config.os",
                    message="Domain controllers must run Windows Server 2019 or 2022",
                    severity="error",
                )
            )
        if node.type == NodeType.ATTACKER and node.config.os not in _ATTACKER_OS:
            out.append(
                ValidationIssue(
                    node_id=node.id,
                    field="config.os",
                    message="Attacker nodes should run Kali, Parrot, BlackArch, Tails, Whonix, or a supported Linux distro",
                    severity="warning",
                )
            )
        if node.type == NodeType.ICS_PLC and node.config.os not in _ICS_PLC_OS:
            out.append(
                ValidationIssue(
                    node_id=node.id,
                    field="config.os",
                    message="PLCs should run a vendor ICS firmware or a Linux base for OpenPLC/snap7 emulation",
                    severity="warning",
                )
            )
        if node.type == NodeType.CAMERA and node.config.os not in {
            OsType.IP_CAMERA_FIRMWARE,
            OsType.UBUNTU_2204,
            OsType.DEBIAN_12,
            OsType.RASPBIAN_12,
            OsType.ALPINE_LATEST,
        }:
            out.append(
                ValidationIssue(
                    node_id=node.id,
                    field="config.os",
                    message="Cameras should use the bundled firmware or a Linux base running MediaMTX/motion",
                    severity="warning",
                )
            )
    return out


def _check_domain_controller_roles(topology: LabConfig) -> list[ValidationIssue]:
    out: list[ValidationIssue] = []
    for node in topology.nodes:
        if node.type != NodeType.DOMAIN_CONTROLLER:
            continue
        if "AD-Domain-Services" not in node.config.roles:
            out.append(
                ValidationIssue(
                    node_id=node.id,
                    field="config.roles",
                    message="Domain controller is missing the 'AD-Domain-Services' role",
                    severity="warning",
                )
            )
    return out


def is_windows(node: TopologyNode) -> bool:
    return node.config.os in _WINDOWS_OS
