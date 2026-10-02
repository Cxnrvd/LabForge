"""Read-only host metrics for the dashboard. Nothing here raises."""

from __future__ import annotations

import time
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from labforge_core.settings import get_settings

_ENGINE_TTL_SECONDS = 30.0
_engine_cache: tuple[float, dict[str, Any]] | None = None


def _nearest_existing(path: Path) -> Path:
    current = path
    while not current.exists():
        if current.parent == current:
            break
        current = current.parent
    return current


def _memory() -> dict[str, Any]:
    try:
        import psutil

        vm = psutil.virtual_memory()
        return {
            "total_mb": int(vm.total // (1024 * 1024)),
            "used_mb": int(vm.used // (1024 * 1024)),
            "percent": float(vm.percent),
        }
    except Exception:
        return {"total_mb": None, "used_mb": None, "percent": None}


def _cpu() -> dict[str, Any]:
    try:
        import psutil

        return {
            "percent": float(psutil.cpu_percent(interval=None)),
            "cores": psutil.cpu_count(logical=True),
        }
    except Exception:
        return {"percent": None, "cores": None}


def _disk() -> dict[str, Any]:
    try:
        import psutil

        target = _nearest_existing(Path(get_settings().workspace_root))
        usage = psutil.disk_usage(str(target))
        gb = 1024**3
        return {
            "path": str(target),
            "total_gb": round(usage.total / gb, 2),
            "used_gb": round(usage.used / gb, 2),
            "free_gb": round(usage.free / gb, 2),
        }
    except Exception:
        return {"path": None, "total_gb": None, "used_gb": None, "free_gb": None}


def sample() -> dict[str, Any]:
    return {
        "memory": _memory(),
        "cpu": _cpu(),
        "disk": _disk(),
        "sampled_at": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
    }


def _reset_cache() -> None:
    global _engine_cache
    _engine_cache = None


def _safe(fn: Any) -> Any:
    try:
        return fn()
    except Exception:
        return None


def _probe_engine() -> dict[str, Any]:
    from labforge_core.services import docker_runtime, hostenv, preflight

    status = _safe(docker_runtime.runtime_status) or {}
    return {
        "docker_daemon": bool(status.get("docker_daemon", False)),
        "docker_version": status.get("docker_version"),
        "compose_version": status.get("compose_version"),
        "docker_memory_mb": _safe(preflight.docker_memory_mb),
        "docker_disk": _safe(preflight.docker_disk),
        "vagrant_version": _safe(hostenv.vagrant_version),
        "virtualbox_version": _safe(hostenv.virtualbox_version),
        "hypervisor_present": _safe(hostenv.hypervisor_present),
    }


def engine() -> dict[str, Any]:
    """Container/VM engine versions, cached for 30s because probing shells out."""
    global _engine_cache
    now = time.monotonic()
    cached = _engine_cache
    if cached is not None and now - cached[0] < _ENGINE_TTL_SECONDS:
        return dict(cached[1])
    try:
        result = _probe_engine()
    except Exception:
        result = {
            "docker_daemon": False,
            "docker_version": None,
            "compose_version": None,
            "docker_memory_mb": None,
            "vagrant_version": None,
            "virtualbox_version": None,
            "hypervisor_present": None,
        }
    _engine_cache = (now, result)
    return dict(result)
