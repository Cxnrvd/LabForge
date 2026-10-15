"""Pluggable registry around the curated role installers.

The original ``role_installers.py`` holds two giant dicts (Linux + Windows
snippets). That's fine for a closed set, but contributors who want to
add a new role currently need to edit the 600-line module by hand and
the import surface gets noisier with every addition.

This module wraps those dicts in a tiny ``Registry`` so external plugins
can call ``register_linux_role()`` / ``register_windows_role()`` to add
their own without touching the upstream file. The existing lookups
``linux_snippet`` / ``windows_snippet`` continue to work — they now
delegate to the registry.

A plugin is just any Python module that imports this registry and calls
``register_*`` on import. Drop the module into ``provisioners/plugins/``
and the loader below auto-discovers it.
"""

from __future__ import annotations

import importlib
import logging
import pkgutil
from dataclasses import dataclass

from labforge_core.provisioners import role_installers as builtin

_LOGGER = logging.getLogger("labforge.role_registry")


@dataclass(frozen=True)
class RoleSpec:
    """Public, plugin-facing description of one role.

    ``RoleSnippet`` from the legacy module remains the wire format — this
    spec is just nicer to consume in plugin tests.
    """

    role_id: str
    description: str
    script: str
    platform: str  # "linux" | "windows"


_LINUX: dict[str, builtin.RoleSnippet] = dict(builtin.LINUX_INSTALLERS)
_WINDOWS: dict[str, builtin.RoleSnippet] = dict(builtin.WINDOWS_INSTALLERS)


def register_linux_role(role_id: str, description: str, script: str) -> None:
    _LINUX[role_id] = builtin.RoleSnippet(
        role_id=role_id, description=description, script=script, platform="linux",
    )
    _LOGGER.info("role_registered", extra={"role_id": role_id, "platform": "linux"})


def register_windows_role(role_id: str, description: str, script: str) -> None:
    _WINDOWS[role_id] = builtin.RoleSnippet(
        role_id=role_id, description=description, script=script, platform="windows",
    )
    _LOGGER.info("role_registered", extra={"role_id": role_id, "platform": "windows"})


def linux_snippet(role_id: str) -> builtin.RoleSnippet | None:
    return _LINUX.get(role_id)


def windows_snippet(role_id: str) -> builtin.RoleSnippet | None:
    return _WINDOWS.get(role_id)


def all_role_specs() -> list[RoleSpec]:
    out: list[RoleSpec] = []
    for snippet in _LINUX.values():
        out.append(
            RoleSpec(
                role_id=snippet.role_id,
                description=snippet.description,
                script=snippet.script,
                platform="linux",
            )
        )
    for snippet in _WINDOWS.values():
        out.append(
            RoleSpec(
                role_id=snippet.role_id,
                description=snippet.description,
                script=snippet.script,
                platform="windows",
            )
        )
    return out


def load_plugins() -> None:
    """Auto-discover any module under ``labforge_core.provisioners.plugins``.

    Each plugin module just imports this registry and calls
    ``register_linux_role`` / ``register_windows_role`` at import time. The
    loader silently ignores plugins that fail to import so a single bad
    plugin can't take the API down.
    """
    try:
        from labforge_core.provisioners import plugins as pkg
    except ImportError:
        return
    for _finder, name, _ispkg in pkgutil.iter_modules(pkg.__path__):
        full = f"{pkg.__name__}.{name}"
        try:
            importlib.import_module(full)
            _LOGGER.info("plugin_loaded", extra={"module": full})
        except Exception as exc:
            _LOGGER.warning("plugin_failed", extra={"module": full, "error": str(exc)})
