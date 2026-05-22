"""Shared pytest fixtures."""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from labforge_schema import (
    Credentials,
    LabConfig,
    NodeConfig,
    NodeType,
    OsType,
    Position,
    Protocol,
    TopologyEdge,
    TopologyNode,
)

REPO_ROOT = Path(__file__).resolve().parents[3]
TEMPLATES_DIR = REPO_ROOT / "packages" / "schema" / "templates"


def _minimal_node(
    node_id: str,
    *,
    type_: NodeType = NodeType.SERVER,
    os: OsType = OsType.UBUNTU_2204,
    hostname: str | None = None,
    ip: str = "192.168.56.10",
    x: float = 0,
    y: float = 0,
    roles: list[str] | None = None,
) -> TopologyNode:
    return TopologyNode(
        id=node_id,
        type=type_,
        label=node_id,
        position=Position(x=x, y=y),
        config=NodeConfig(
            os=os,
            ip=ip,
            hostname=hostname or node_id,
            roles=roles or [],
            credentials=Credentials(username="vagrant", password="vagrant"),
        ),
    )


def _minimal_edge(
    edge_id: str,
    source: str,
    target: str,
    *,
    protocol: Protocol = Protocol.TCP,
) -> TopologyEdge:
    return TopologyEdge(id=edge_id, source=source, target=target, protocol=protocol)


@pytest.fixture
def minimal_topology() -> LabConfig:
    """Smallest valid topology — one Ubuntu server."""
    return LabConfig(
        name="minimal",
        network_cidr="192.168.56.0/24",
        nodes=[_minimal_node("srv")],
    )


@pytest.fixture
def two_node_topology() -> LabConfig:
    return LabConfig(
        name="two-node",
        network_cidr="192.168.56.0/24",
        nodes=[
            _minimal_node("srv", ip="192.168.56.10"),
            _minimal_node(
                "kali",
                type_=NodeType.ATTACKER,
                os=OsType.KALI_ROLLING,
                hostname="kali",
                ip="192.168.56.20",
                x=200,
            ),
        ],
        edges=[_minimal_edge("e1", "kali", "srv", protocol=Protocol.SSH)],
    )


@pytest.fixture
def all_template_paths() -> list[Path]:
    return sorted(p for p in TEMPLATES_DIR.glob("*.json") if not p.name.startswith("._"))


@pytest.fixture
def load_template():
    def _load(path: Path) -> LabConfig:
        with path.open() as fh:
            return LabConfig.model_validate(json.load(fh))

    return _load


@pytest.fixture(autouse=True)
def _reset_rate_limits():
    """Rate-limit buckets are process-global; clear them so tests don't
    cross-contaminate."""
    from labforge_core.api.rate_limit import reset_for_tests

    reset_for_tests()
    yield
    reset_for_tests()


@pytest.fixture(autouse=True)
def _isolate_nvd_cache():
    """The TTL caches are module-singletons — clear them between tests."""
    from labforge_core.services.nvd_cache import lookup_cache, search_cache

    search_cache.clear()
    lookup_cache.clear()
    yield
    search_cache.clear()
    lookup_cache.clear()


__all__ = [
    "all_template_paths",
    "load_template",
    "minimal_topology",
    "two_node_topology",
]
