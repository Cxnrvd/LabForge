"""Node-type plugin spec.

The 11 built-in node types (workstation, server, DC, router, firewall,
attacker, target, database, ICS PLC, ICS HMI, camera, internet) live in
the canonical schema enum and are hardcoded across validator, generator,
and the UI illustration set. Replacing that with a fully runtime plugin
system is a multi-week refactor.

What this module does instead: define the *contract* a future plugin
must satisfy, and pre-register one entry per built-in so the rest of the
system can iterate over a single registry rather than switch statements.
Once every consumer (validator, generator, UI palette) reads from this
registry, custom node types can be added without changing those files —
only the schema enum stays closed.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable, Optional

from labforge_schema import (
    DEFAULT_OS_PER_NODE_TYPE,
    NODE_TYPE_LABELS,
    NodeType,
    OsType,
)


@dataclass(frozen=True)
class NodeTypePlugin:
    """Describes one node type. Read by validator, generator, and UI."""

    node_type: NodeType
    label: str
    default_os: OsType
    accent_color: str = "slate"
    icon_id: str = ""
    # Allowed roles. Empty list = anything goes.
    allowed_roles: list[str] = field(default_factory=list)
    # OS subset this type can run on. Empty = any OS the schema allows.
    allowed_os: list[OsType] = field(default_factory=list)
    # Optional generator hook — called with the topology + node to
    # produce extra provisioner content. Most types return None.
    extra_provisioner: Optional[Callable[..., Optional[str]]] = None


_REGISTRY: dict[NodeType, NodeTypePlugin] = {}


def register(plugin: NodeTypePlugin) -> None:
    _REGISTRY[plugin.node_type] = plugin


def get(node_type: NodeType) -> NodeTypePlugin:
    return _REGISTRY[node_type]


def all_plugins() -> list[NodeTypePlugin]:
    return list(_REGISTRY.values())


# --------------------------------------------------------------- built-ins

_ACCENT: dict[NodeType, str] = {
    NodeType.WORKSTATION: "blue",
    NodeType.SERVER: "slate",
    NodeType.DOMAIN_CONTROLLER: "purple",
    NodeType.ROUTER: "orange",
    NodeType.FIREWALL: "red",
    NodeType.ATTACKER: "rose",
    NodeType.TARGET: "amber",
    NodeType.DATABASE: "green",
    NodeType.ICS_PLC: "yellow",
    NodeType.ICS_HMI: "teal",
    NodeType.CAMERA: "violet",
    NodeType.INTERNET: "sky",
}


def _bootstrap() -> None:
    for nt in NodeType:
        register(
            NodeTypePlugin(
                node_type=nt,
                label=NODE_TYPE_LABELS[nt],
                default_os=DEFAULT_OS_PER_NODE_TYPE[nt],
                accent_color=_ACCENT.get(nt, "slate"),
                icon_id=nt.value,
            )
        )


_bootstrap()
