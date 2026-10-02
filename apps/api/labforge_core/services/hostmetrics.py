"""Read-only host metrics for the dashboard. Nothing here raises."""

from __future__ import annotations

import logging
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


_LOGGER = logging.getLogger("labforge.hostmetrics")
_logged_paths: set[str] = set()


_root_dir_cache: tuple[float, str | None] | None = None


def _cached_root_dir() -> str | None:
    """``docker info`` is slow enough that the Home page's 5 second poll should not run it."""
    global _root_dir_cache
    from labforge_core.services import preflight

    now = time.monotonic()
    if _root_dir_cache is None or now - _root_dir_cache[0] > 120:
        _root_dir_cache = (now, preflight.docker_root_dir())
    return _root_dir_cache[1]


def storage() -> dict[str, Any]:
    """Every disk that matters for a lab, with the exact path measured and why.

    * ``workspace``: the folder lab bundles are written to (``workspace_root``) and the drive it is on.
    * ``docker``: where Docker keeps images and volumes on this computer, and the drive it is on.
      Image downloads and Windows disks land here, so this is the figure to watch.
    """
    import os

    import psutil

    from labforge_core.services import preflight

    settings = get_settings()
    configured = Path(settings.workspace_root)
    measured = _nearest_existing(configured)
    from_env = "workspace_root" in settings.model_fields_set or "LABFORGE_WORKSPACE_ROOT" in os.environ
    gb = 1024**3
    try:
        usage = psutil.disk_usage(str(measured))
        workspace_disk = {"total_gb": round(usage.total / gb, 2), "free_gb": round(usage.free / gb, 2)}
    except Exception:
        workspace_disk = {"total_gb": None, "free_gb": None}
    workspace = {
        "configured_path": str(configured),
        "source": "LABFORGE_WORKSPACE_ROOT" if from_env else "default",
        "measured_path": str(measured),
        "exists": configured.exists(),
        "drive": measured.anchor or str(measured),
        **workspace_disk,
    }
    docker = dict(preflight.docker_disk())
    docker["drive"] = (Path(docker["path"]).anchor or docker["path"]) if docker.get("path") else None
    docker["root_dir_in_engine"] = _cached_root_dir()
    key = f"{workspace['measured_path']}|{docker.get('path')}"
    if key not in _logged_paths:
        _logged_paths.add(key)
        _LOGGER.info(
            "storage_measured",
            extra={
                "workspace_configured": workspace["configured_path"],
                "workspace_measured": workspace["measured_path"],
                "workspace_source": workspace["source"],
                "docker_data": docker.get("path"),
            },
        )
    return {
        "workspace": workspace,
        "docker": docker,
        "same_drive": bool(workspace["drive"] and workspace["drive"] == docker.get("drive")),
    }


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
