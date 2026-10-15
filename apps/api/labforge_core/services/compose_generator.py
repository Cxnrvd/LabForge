"""Docker compose alternative to the Vagrant generator.

For nodes whose role set is "container-native" (web servers, databases,
LLM runtimes, OpenPLC, MediaMTX, Wazuh manager, etc.) we'd much rather
spin up a `docker compose up` stack than wait 15 minutes for full VMs.
This module renders that.

Nodes that need a true OS (Windows DC, Kali GUI, ICS firmware emulation
on a kernel-level network) get a `notes/<hostname>.txt` stub explaining
that they fall back to the Vagrant target.

The compose generator is *additive* — it doesn't replace Vagrant. The
`/generate?target=docker-compose` endpoint hits this path; the default
target stays Vagrant so nothing else breaks.
"""

from __future__ import annotations

from dataclasses import dataclass

import yaml  # provided indirectly by uvicorn[standard] -> pyyaml
from labforge_schema import LabConfig, NodeType, OsType, TopologyNode

# Default container images per role. Conservative — every image listed
# is publicly available on Docker Hub or ghcr. Roles not in this map fall
# through to an `alpine` placeholder with a comment explaining what to do.
_ROLE_IMAGE: dict[str, str] = {
    "apache": "httpd:2.4",
    "nginx": "nginx:1.27",
    "mysql": "mysql:8.0",
    "postgresql": "postgres:16",
    "mongodb": "mongo:7.0",
    "redis": "redis:7.4",
    "openplc": "openplc/openplc_v3:latest",
    "mediamtx": "bluenviron/mediamtx:latest",
    "ollama": "ollama/ollama:latest",
    "elastic": "docker.elastic.co/elasticsearch/elasticsearch:8.15.0",
    "kibana": "docker.elastic.co/kibana/kibana:8.15.0",
    "grafana": "grafana/grafana:11.2.0",
    "prometheus": "prom/prometheus:v2.54.1",
    "keycloak": "quay.io/keycloak/keycloak:25.0",
    "vault": "hashicorp/vault:1.18",
    "mqtt": "eclipse-mosquitto:2",
    "suricata": "jasonish/suricata:latest",
    "wazuh-manager": "wazuh/wazuh-manager:4.9.0",
    "bloodhound": "specterops/bloodhound:latest",
    "metasploit": "metasploitframework/metasploit-framework:latest",
}


_OS_FALLBACK_IMAGE: dict[OsType, str] = {
    OsType.UBUNTU_2204: "ubuntu:22.04",
    OsType.UBUNTU_2404: "ubuntu:24.04",
    OsType.DEBIAN_12: "debian:bookworm",
    OsType.ALPINE_LATEST: "alpine:3.20",
    OsType.KALI_ROLLING: "kalilinux/kali-rolling",
}


# Node types that truly need a full VM — compose can't usefully emulate
# them, so we flag them in a notes file rather than silently pretending.
_VM_ONLY: set[NodeType] = {
    NodeType.DOMAIN_CONTROLLER,
    NodeType.FIREWALL,
    NodeType.ROUTER,
    NodeType.ICS_HMI,
    NodeType.INTERNET,
    NodeType.CAMERA,
}


@dataclass(frozen=True)
class ComposeArtifacts:
    compose_yaml: str
    env_files: dict[str, str]
    fallback_notes: dict[str, str]


def _strip_version(role: str) -> str:
    return role.split("@", 1)[0]


def _image_for(node: TopologyNode) -> str | None:
    """Pick the most specific image we have. Explicit ``compose_image``
    on the node wins; otherwise we match the first role with a known
    image; otherwise we fall back by OS."""
    explicit = node.config.compose_image
    if explicit:
        return explicit
    for role in node.config.roles:
        bare = _strip_version(role)
        if bare in _ROLE_IMAGE:
            return _ROLE_IMAGE[bare]
    return _OS_FALLBACK_IMAGE.get(node.config.os)


def _service_def(node: TopologyNode) -> dict[str, object]:
    image = _image_for(node) or "alpine:3.20"
    svc: dict[str, object] = {
        "image": image,
        "hostname": node.config.hostname,
        "container_name": f"labforge-{node.config.hostname}",
        "networks": {
            "labforge": {"ipv4_address": node.config.ip},
        },
        "restart": "unless-stopped",
        "mem_limit": f"{node.config.memory_mb}m",
    }
    # Best-effort port hints. The compose generator can't know which
    # ports the role binds to without a full registry — we expose the
    # most common ones based on the role list so the user can `curl`
    # immediately.
    role_ports: dict[str, list[str]] = {
        "apache": ["80"],
        "nginx": ["80"],
        "mysql": ["3306"],
        "postgresql": ["5432"],
        "mongodb": ["27017"],
        "redis": ["6379"],
        "openplc": ["8080", "502"],
        "mediamtx": ["8554/tcp", "8889"],
        "ollama": ["11434"],
        "elastic": ["9200"],
        "kibana": ["5601"],
        "grafana": ["3000"],
        "prometheus": ["9090"],
        "keycloak": ["8080"],
        "vault": ["8200"],
        "mqtt": ["1883", "9001"],
    }
    bare_roles = [_strip_version(r) for r in node.config.roles]
    ports: list[str] = []
    for r in bare_roles:
        for p in role_ports.get(r, []):
            if p not in ports:
                ports.append(p)
    if ports:
        svc["ports"] = [f"{p}:{p.split('/')[0]}" if ":" not in p else p for p in ports]
    return svc


def _env_for(node: TopologyNode) -> str:
    """Minimal env file the user can edit. Holds the credentials we'd
    otherwise inline into provisioner scripts."""
    return (
        f"# {node.config.hostname} environment\n"
        f"LABFORGE_HOSTNAME={node.config.hostname}\n"
        f"LABFORGE_USER={node.config.credentials.username}\n"
        f"LABFORGE_PASSWORD={node.config.credentials.password}\n"
        f"# Roles: {', '.join(node.config.roles) or '(none)'}\n"
    )


def render(topology: LabConfig) -> ComposeArtifacts:
    services: dict[str, dict[str, object]] = {}
    env_files: dict[str, str] = {}
    fallback_notes: dict[str, str] = {}

    cidr = topology.network_cidr
    for node in topology.nodes:
        if node.type in _VM_ONLY:
            fallback_notes[node.config.hostname] = (
                f"{node.config.hostname} ({node.type.value}) needs a full VM — "
                "use the Vagrant target. Compose can't usefully emulate this "
                "node type.\n"
            )
            continue
        services[node.config.hostname] = _service_def(node)
        env_files[f"env/{node.config.hostname}.env"] = _env_for(node)

    document = {
        "version": "3.9",
        "services": services,
        "networks": {
            "labforge": {
                "driver": "bridge",
                "ipam": {"config": [{"subnet": cidr}]},
            },
        },
    }
    return ComposeArtifacts(
        compose_yaml=yaml.safe_dump(document, sort_keys=False),
        env_files=env_files,
        fallback_notes=fallback_notes,
    )
