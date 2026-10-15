"""Plain-words readiness checks for running Docker labs on this computer.

Every check returns ``{id, status, title, detail, fix}``. ``status`` is ``ok``, ``warn`` (the
lab will probably run but something is tight) or ``fail`` (a build would fail). ``fix`` is the
exact thing to do, so the UI can show it before the user presses Build.
"""

from __future__ import annotations

import shutil
import subprocess
import time
from pathlib import Path
from typing import Any

import psutil

from labforge_core.services import docker_runtime, hostenv, workspace
from labforge_core.services.compose_generator import host_port_free

GB = 1024**3
# Windows guests: the installer ISO plus a sparse system disk that grows as the guest is used.
WINDOWS_DISK_GB = 40
LAB_DISK_GB = 8
# Lowest Docker memory at which the bundled Elastic lab (about 3 GB of limits plus Docker itself) runs.
MIN_DOCKER_MB = 4096
DEFAULT_PORTS = {9200: "Elasticsearch", 5601: "Kibana", 8006: "Windows guest web console", 3389: "Windows guest RDP"}

_KVM_TTL = 300.0
_kvm_cache: tuple[float, bool | None] | None = None


def docker_memory_mb() -> int | None:
    """Memory the Docker engine can hand to containers (the Docker Desktop VM limit)."""
    if not docker_runtime.docker_available():
        return None
    try:
        proc = docker_runtime._run(["docker", "info", "--format", "{{.MemTotal}}"], timeout=10)
    except (OSError, subprocess.TimeoutExpired):
        return None
    if proc.returncode != 0:
        return None
    try:
        return int(proc.stdout.strip()) // (1024 * 1024)
    except ValueError:
        return None


def kvm_in_docker() -> bool | None:
    """True when a container can open /dev/kvm, False when it cannot, None if unknown."""
    global _kvm_cache
    now = time.monotonic()
    if _kvm_cache is not None and now - _kvm_cache[0] < _KVM_TTL:
        return _kvm_cache[1]
    result: bool | None = None
    if docker_runtime.docker_available():
        try:
            image = "alpine:3"
            have = docker_runtime._run(["docker", "image", "inspect", image], timeout=10)
            if have.returncode != 0:
                docker_runtime._run(["docker", "pull", "-q", image], timeout=120)
            proc = docker_runtime._run(
                ["docker", "run", "--rm", "--device", "/dev/kvm", image, "true"], timeout=60
            )
            if proc.returncode == 0:
                result = True
            elif "no such file" in (proc.stderr or "").lower() or "/dev/kvm" in (proc.stderr or ""):
                result = False
        except (OSError, subprocess.TimeoutExpired):
            result = None
    _kvm_cache = (now, result)
    return result


def _labforge_published_ports() -> set[int]:
    """Host ports already published by running LabForge labs (not a conflict for the next check)."""
    if not docker_runtime.docker_available():
        return set()
    try:
        proc = docker_runtime._run(
            ["docker", "ps", "--filter", "label=labforge.managed=true", "--format", "{{.Ports}}"], timeout=10
        )
    except (OSError, subprocess.TimeoutExpired):
        return set()
    found: set[int] = set()
    for chunk in proc.stdout.replace("\n", ",").split(","):
        # 127.0.0.1:9200->9200/tcp
        if "->" in chunk and ":" in chunk.split("->")[0]:
            tail = chunk.split("->")[0].rsplit(":", 1)[-1].strip()
            if tail.isdigit():
                found.add(int(tail))
    return found


def docker_data_dir() -> Path | None:
    """Folder on this computer that holds Docker's images and volumes (None if unknown)."""
    if hostenv.is_windows():
        import json
        import os

        for name in ("settings-store.json", "settings.json"):
            cfg = Path(os.environ.get("APPDATA", "")) / "Docker" / name
            try:
                data = json.loads(cfg.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                continue
            custom = data.get("CustomWslDistroDir") or data.get("customWslDistroDir")
            if custom and Path(custom).exists():
                return Path(custom)
        default = Path(os.environ.get("LOCALAPPDATA", "")) / "Docker" / "wsl"
        return default if default.exists() else None
    # Native Linux Docker: the engine's own DockerRootDir is a real folder on this computer, and it
    # may have been moved off /var/lib/docker to a bigger drive. On macOS it is inside Docker's VM,
    # so it does not exist here and the fallbacks below apply.
    reported = docker_root_dir()
    candidates = ([Path(reported)] if reported else []) + [Path("/var/lib/docker"), Path("/var/lib")]
    for candidate in candidates:
        if candidate.exists():
            return candidate
    return None


def docker_root_dir() -> str | None:
    """Docker's own data root as the engine sees it (a path inside the Docker Desktop VM on Windows)."""
    try:
        proc = docker_runtime._run(["docker", "info", "--format", "{{.DockerRootDir}}"], timeout=10)
    except (OSError, subprocess.TimeoutExpired):
        return None
    return proc.stdout.strip() or None if proc.returncode == 0 else None


def docker_disk() -> dict[str, Any]:
    """Free space where Docker keeps images and volumes. This, not the workspace folder, fills up."""
    target = docker_data_dir()
    if target is None:
        return {"path": None, "free_gb": None, "total_gb": None}
    try:
        usage = shutil.disk_usage(str(target))
    except OSError:
        return {"path": str(target), "free_gb": None, "total_gb": None}
    return {"path": str(target), "free_gb": round(usage.free / GB, 2), "total_gb": round(usage.total / GB, 2)}


def reset_cache() -> None:
    global _kvm_cache
    _kvm_cache = None


def _check(id_: str, status: str, title: str, detail: str, fix: str | None = None) -> dict[str, Any]:
    return {"id": id_, "status": status, "title": title, "detail": detail, "fix": fix}


def run(*, windows_guests: int = 0, memory_needed_mb: int | None = None, ports: list[int] | None = None) -> dict[str, Any]:
    """Run every check. ``windows_guests`` and ``memory_needed_mb`` describe the lab about to be built."""
    checks: list[dict[str, Any]] = []
    status = docker_runtime.runtime_status()

    if not status["docker_available"]:
        checks.append(
            _check(
                "docker",
                "fail",
                "Docker is not installed",
                "The docker command was not found.",
                "Install Docker Desktop (winget install Docker.DockerDesktop), start it, then press Re-check.",
            )
        )
    elif not status["docker_daemon"]:
        checks.append(
            _check(
                "docker",
                "fail",
                "Docker is not running",
                str(status["detail"] or "The Docker engine does not answer."),
                "Start Docker Desktop and wait until it says Engine running, then press Re-check.",
            )
        )
    else:
        checks.append(_check("docker", "ok", "Docker is running", f"Docker {status['docker_version']}"))
        if not status["compose_supported"]:
            checks.append(
                _check(
                    "compose",
                    "fail",
                    "Docker Compose is missing or too old",
                    f"Found {status['compose_version'] or 'none'}, need {'.'.join(map(str, docker_runtime.MIN_COMPOSE))} or newer.",
                    "Update Docker Desktop to the latest version.",
                )
            )
        else:
            checks.append(_check("compose", "ok", "Docker Compose is ready", f"Compose {status['compose_version']}"))

        dmem = docker_memory_mb()
        need = memory_needed_mb or 0
        if dmem is not None:
            host_mb = hostenv.host_memory_mb()
            # Enough for this lab plus 2 GB of headroom, never more than three quarters of the computer.
            wanted_gb = -(-(need + 2048) // 1024) if need else 8
            cap_gb = max(4, int((host_mb or 16384) * 0.75) // 1024)
            suggest = max(8, min(wanted_gb, cap_gb))
            fix = (
                f"Docker Desktop is limited to {dmem // 1024} GB. Create %UserProfile%\\.wslconfig containing "
                f"[wsl2] and memory={suggest}GB, run 'wsl --shutdown', then start Docker Desktop again."
            )
            if dmem < MIN_DOCKER_MB or (need and need > dmem * 0.9):
                checks.append(
                    _check(
                        "docker_memory",
                        "fail",
                        "Docker has too little memory for this lab",
                        f"Docker can use {dmem} MB; the lab asks for {need} MB." if need else f"Docker can use {dmem} MB.",
                        fix,
                    )
                )
            elif need and need > dmem * 0.7:
                checks.append(
                    _check(
                        "docker_memory",
                        "warn",
                        "Docker memory is tight",
                        f"Docker can use {dmem} MB; the lab asks for {need} MB. It may be slow or get killed.",
                        fix,
                    )
                )
            else:
                checks.append(_check("docker_memory", "ok", "Docker has enough memory", f"Docker can use {dmem // 1024} GB"))

        if windows_guests:
            kvm = kvm_in_docker()
            if kvm is False:
                checks.append(
                    _check(
                        "kvm",
                        "fail",
                        "Windows guests cannot start: no /dev/kvm in Docker",
                        "A container could not open /dev/kvm, so Windows would run without hardware acceleration or not at all.",
                        "Turn on virtualization in the BIOS/UEFI, enable the Virtual Machine Platform Windows feature, "
                        "use Docker Desktop with the WSL2 backend, run 'wsl --shutdown' and restart Docker Desktop. "
                        "Labs with Linux machines only (like the ransomware hunt) do not need this.",
                    )
                )
            elif kvm is None:
                checks.append(_check("kvm", "warn", "Could not check /dev/kvm", "The KVM test did not finish.", "Press Re-check."))
            else:
                checks.append(_check("kvm", "ok", "Windows guests can use KVM", "/dev/kvm is available inside Docker"))

    # Memory on the computer itself.
    try:
        vm = psutil.virtual_memory()
        free_mb = int(vm.available / (1024 * 1024))
        need = memory_needed_mb or 0
        if need and free_mb < need + 2048:
            checks.append(
                _check(
                    "host_memory",
                    "warn",
                    "This computer is short on free memory",
                    f"{free_mb} MB free, the lab needs about {need} MB plus room for Windows.",
                    "Close large programs (browsers, IDEs, VMs) before building.",
                )
            )
        else:
            checks.append(_check("host_memory", "ok", "Enough free memory on this computer", f"{free_mb // 1024} GB free"))
    except Exception:
        pass

    ws = workspace.status()
    if ws["state"] != "ok":
        checks.append(_check("workspace", "fail", "The workspace folder is not available", ws["error"] or "",
                             "Choose a folder in Settings, General, Workspace location."))

    # Disk where Docker keeps images and volumes (Windows guests grow a disk image here).
    dd = docker_disk()
    root = workspace.root()
    target = root
    while not target.exists() and target != target.parent:
        target = target.parent
    free_gb = dd["free_gb"] if dd["free_gb"] is not None else shutil.disk_usage(str(target)).free / GB
    where = dd["path"] or str(target)
    need_gb = WINDOWS_DISK_GB if windows_guests else LAB_DISK_GB
    fix = (
        f"Free up space on the drive that holds Docker's data ({Path(where).anchor or where}), or move Docker's disk image to "
        "a bigger drive: Docker Desktop, Settings, Resources, Advanced, Disk image location."
    )
    if free_gb < need_gb:
        checks.append(_check("disk", "fail", "Not enough disk space for Docker", f"{free_gb:.0f} GB free at {where}, the lab needs about {need_gb} GB.", fix))
    elif free_gb < need_gb * 1.5:
        checks.append(_check("disk", "warn", "Disk space is tight", f"{free_gb:.0f} GB free at {where}, the lab needs about {need_gb} GB.", fix))
    else:
        checks.append(_check("disk", "ok", "Enough disk space for Docker", f"{free_gb:.0f} GB free at {where}"))

    workspace_free = shutil.disk_usage(str(target)).free / GB
    if workspace_free < 1:
        checks.append(
            _check(
                "workspace_disk",
                "fail",
                "No room for lab files",
                f"{workspace_free:.1f} GB free where LabForge keeps lab folders ({target}).",
                "Free up space there, or choose a folder on a bigger drive in Settings, General, Workspace location.",
            )
        )

    ours = _labforge_published_ports()
    busy = [p for p in (ports or list(DEFAULT_PORTS)) if p not in ours and not host_port_free(p)]
    if busy:
        checks.append(
            _check(
                "ports",
                "warn",
                "Some ports are already in use",
                ", ".join(f"{p} ({DEFAULT_PORTS.get(p, 'lab service')})" for p in busy)
                + ". LabForge will publish the lab on the next free port instead.",
                "Nothing to do, or stop the program using the port if you need the standard address.",
            )
        )
    else:
        checks.append(_check("ports", "ok", "Lab ports are free", ", ".join(str(p) for p in (ports or DEFAULT_PORTS))))

    rank = {"ok": 0, "warn": 1, "fail": 2}
    worst = max((c["status"] for c in checks), key=lambda s: rank[s], default="ok")
    return {"status": worst, "ready": worst != "fail", "checks": checks}


def blocking_problem(topology: Any) -> tuple[str, str] | None:
    """``(code, message)`` when this particular lab cannot run here, else ``None``.

    Only memory, KVM and disk block a build; ports are moved automatically and the rest warn.
    """
    from labforge_core.services.compose_generator import WINDOWS_MIN_RAM_MB, is_windows_guest

    windows = sum(1 for n in topology.nodes if is_windows_guest(n))
    need = sum(
        max(n.config.memory_mb, WINDOWS_MIN_RAM_MB) if is_windows_guest(n) else n.config.memory_mb
        for n in topology.nodes
    )
    report = run(windows_guests=windows, memory_needed_mb=need, ports=[])
    for check in report["checks"]:
        if check["status"] == "fail" and check["id"] in {"docker_memory", "kvm", "disk", "workspace_disk", "workspace"}:
            return f"preflight_{check['id']}", f"{check['title']}. {check['detail']} {check['fix'] or ''}".strip()
    return None


if __name__ == "__main__":  # python -m labforge_core.services.preflight [--windows]
    import sys

    report = run(windows_guests=1 if "--windows" in sys.argv else 0)
    for c in report["checks"]:
        print(f"[{c['status'].upper():4}] {c['title']}: {c['detail']}")
        if c["fix"] and c["status"] != "ok":
            print(f"       fix: {c['fix']}")
    print("READY" if report["ready"] else "NOT READY")
    raise SystemExit(0 if report["ready"] else 1)
