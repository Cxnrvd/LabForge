"""Docker runtime: run, inspect and tear down a lab as a Compose project.

Everything here shells out to the ``docker`` CLI. Each lab is one Compose
*project* (``lf<id>-<slug>``), recorded in ``<workspace>/.labforge-project``.
Containers, the lab network and named volumes all carry the
``com.docker.compose.project`` label, which is what teardown and verification
use, so destroy keeps working even if the compose file is gone.
"""

from __future__ import annotations

import ipaddress
import json
import re
import shutil
import subprocess
from dataclasses import dataclass, field
from pathlib import Path

PROJECT_FILE = ".labforge-project"
COMPOSE_FILE = "docker-compose.yml"
_LABEL = "com.docker.compose.project"

# Oldest Compose that understands every flag we pass (--wait-timeout,
# --progress). Older versions work for most labs but are not supported.
MIN_COMPOSE = (2, 24)


def docker_available() -> bool:
    return shutil.which("docker") is not None


def _run(args: list[str], *, cwd: Path | None = None, timeout: float = 30) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        args,
        cwd=str(cwd) if cwd else None,
        capture_output=True,
        text=True,
        timeout=timeout,
        check=False,
    )


def _parse_version(text: str) -> tuple[int, ...] | None:
    match = re.search(r"(\d+)\.(\d+)(?:\.(\d+))?", text or "")
    if not match:
        return None
    return tuple(int(part) for part in match.groups(default="0"))


def runtime_status() -> dict[str, object]:
    """Probe the docker CLI, the daemon and Compose. Never raises."""
    info: dict[str, object] = {
        "docker_available": docker_available(),
        "docker_daemon": False,
        "docker_version": None,
        "compose_version": None,
        "compose_supported": False,
        "detail": None,
    }
    if not info["docker_available"]:
        info["detail"] = "docker is not on PATH on the API host"
        return info
    try:
        server = _run(["docker", "version", "--format", "{{.Server.Version}}"], timeout=10)
        if server.returncode == 0 and server.stdout.strip():
            info["docker_daemon"] = True
            info["docker_version"] = server.stdout.strip()
        else:
            info["detail"] = (server.stderr or "docker daemon is not reachable").strip().splitlines()[-1]
        compose = _run(["docker", "compose", "version", "--short"], timeout=10)
        if compose.returncode == 0:
            version = compose.stdout.strip().lstrip("v")
            info["compose_version"] = version
            parsed = _parse_version(version)
            info["compose_supported"] = bool(parsed and parsed[:2] >= MIN_COMPOSE)
        else:
            info["detail"] = info["detail"] or "docker compose v2 plugin is not installed"
    except (OSError, subprocess.TimeoutExpired) as exc:
        info["detail"] = f"docker probe failed: {exc}"
    return info


def prereq_problem() -> tuple[str, str] | None:
    """``(code, message)`` if a build cannot start, else ``None``."""
    status = runtime_status()
    if not status["docker_available"]:
        return "docker_missing", "docker is not on PATH on the API host. Install Docker Desktop or Docker Engine first."
    if not status["docker_daemon"]:
        return "docker_daemon_down", f"The Docker daemon is not reachable ({status['detail']}). Start Docker and retry."
    if status["compose_version"] is None:
        return "docker_compose_missing", "The 'docker compose' v2 plugin is not installed."
    if not status["compose_supported"]:
        return (
            "docker_compose_old",
            f"Docker Compose {status['compose_version']} is too old; "
            f"{'.'.join(map(str, MIN_COMPOSE))} or newer is required.",
        )
    return None


# ------------------------------------------------------------------ project


def read_project(workspace: Path) -> str | None:
    path = workspace / PROJECT_FILE
    if path.exists():
        value = path.read_text(encoding="utf-8").strip()
        if value:
            return value
    return None


def is_docker_workspace(workspace: Path) -> bool:
    return (workspace / COMPOSE_FILE).exists() and not (workspace / "Vagrantfile").exists()


def up_command(project: str, *, wait_timeout: int = 900) -> list[str]:
    return [
        "docker", "compose", "-p", project, "--ansi", "never", "--progress", "plain",
        "up", "-d", "--wait", "--wait-timeout", str(wait_timeout), "--remove-orphans",
    ]


# ------------------------------------------------------------------- status


def _parse_ps_json(text: str) -> list[dict]:
    text = text.strip()
    if not text:
        return []
    if text.startswith("["):
        try:
            return list(json.loads(text))
        except ValueError:
            return []
    rows: list[dict] = []
    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            rows.append(json.loads(line))
        except ValueError:
            continue
    return rows


def ps(workspace: Path, project: str | None = None) -> list[dict]:
    """Per-container state: ``[{service, state, health, name}]``. Empty on failure."""
    project = project or read_project(workspace)
    if not project:
        return []
    try:
        proc = _run(["docker", "compose", "-p", project, "ps", "-a", "--format", "json"], cwd=workspace, timeout=20)
    except (OSError, subprocess.TimeoutExpired):
        return []
    if proc.returncode != 0:
        return []
    out = []
    for row in _parse_ps_json(proc.stdout):
        out.append(
            {
                "service": row.get("Service") or row.get("Name", ""),
                "name": row.get("Name", ""),
                "state": (row.get("State") or "unknown").lower(),
                "health": (row.get("Health") or "").lower(),
                "status": row.get("Status", ""),
            }
        )
    return out


def running_count(workspace: Path) -> int:
    """Number of running containers, or -1 when it cannot be determined."""
    project = read_project(workspace)
    if not project:
        return -1
    try:
        proc = _run(
            ["docker", "ps", "-q", "--filter", f"label={_LABEL}={project}", "--filter", "status=running"],
            timeout=10,
        )
    except (OSError, subprocess.TimeoutExpired):
        return -1
    if proc.returncode != 0:
        return -1
    return len([ln for ln in proc.stdout.splitlines() if ln.strip()])


def logs_tail(workspace: Path, lines: int = 50) -> list[str]:
    project = read_project(workspace)
    if not project:
        return []
    try:
        proc = _run(
            ["docker", "compose", "-p", project, "logs", "--no-color", "--tail", "6"],
            cwd=workspace,
            timeout=15,
        )
    except (OSError, subprocess.TimeoutExpired):
        return []
    text = proc.stdout.strip().splitlines() if proc.returncode == 0 else []
    return text[-lines:]


# ------------------------------------------------------------------ subnets


def subnet_conflicts(cidr: str, *, own_project: str | None = None) -> list[str]:
    """Docker networks whose subnet overlaps ``cidr``, as readable strings."""
    try:
        wanted = ipaddress.ip_network(cidr, strict=False)
    except ValueError:
        return []
    try:
        ids = _run(["docker", "network", "ls", "-q"], timeout=15)
        if ids.returncode != 0 or not ids.stdout.strip():
            return []
        inspect = _run(
            [
                "docker", "network", "inspect", *ids.stdout.split(),
                "--format",
                '{{.Name}}|{{range .IPAM.Config}}{{.Subnet}} {{end}}|{{index .Labels "' + _LABEL + '"}}',
            ],
            timeout=20,
        )
    except (OSError, subprocess.TimeoutExpired):
        return []
    conflicts: list[str] = []
    for line in inspect.stdout.splitlines():
        parts = line.split("|")
        if len(parts) < 3:
            continue
        name, subnets, project = parts[0], parts[1].split(), parts[2]
        if own_project and project == own_project:
            continue
        for subnet in subnets:
            try:
                other = ipaddress.ip_network(subnet, strict=False)
            except ValueError:
                continue
            if other.version == wanted.version and wanted.overlaps(other):
                owner = f", lab project {project}" if project and project != "<no value>" else ""
                conflicts.append(f"network '{name}' ({subnet}{owner})")
    return conflicts


# ----------------------------------------------------------------- teardown


@dataclass
class TeardownResult:
    ok: bool
    steps: list[str] = field(default_factory=list)
    error: str | None = None


def resources_left(project: str) -> dict[str, list[str]]:
    left: dict[str, list[str]] = {"containers": [], "networks": [], "volumes": []}
    queries = {
        "containers": ["docker", "ps", "-aq", "--filter", f"label={_LABEL}={project}"],
        "networks": ["docker", "network", "ls", "-q", "--filter", f"label={_LABEL}={project}"],
        "volumes": ["docker", "volume", "ls", "-q", "--filter", f"label={_LABEL}={project}"],
    }
    for kind, cmd in queries.items():
        try:
            proc = _run(cmd, timeout=15)
        except (OSError, subprocess.TimeoutExpired):
            left[kind] = ["<unknown>"]
            continue
        if proc.returncode != 0:
            left[kind] = ["<unknown>"]
            continue
        left[kind] = [ln.strip() for ln in proc.stdout.splitlines() if ln.strip()]
    return left


def _force_remove(project: str) -> None:
    """Label-based cleanup used when ``compose down`` is not enough."""
    leftovers = resources_left(project)
    for cid in leftovers["containers"]:
        if cid != "<unknown>":
            _run(["docker", "rm", "-f", "-v", cid], timeout=60)
    for nid in leftovers["networks"]:
        if nid != "<unknown>":
            _run(["docker", "network", "rm", nid], timeout=30)
    for vid in leftovers["volumes"]:
        if vid != "<unknown>":
            _run(["docker", "volume", "rm", "-f", vid], timeout=30)


def teardown(workspace: Path, project: str | None = None, *, timeout: float = 180) -> TeardownResult:
    """Stop and remove containers, network and volumes, then verify nothing is left."""
    project = project or read_project(workspace)
    result = TeardownResult(ok=False)
    if not project:
        result.error = "no .labforge-project file in the workspace, cannot tell which Compose project to remove"
        return result
    if not docker_available():
        result.error = "docker is not on PATH on the API host"
        return result

    if (workspace / COMPOSE_FILE).exists():
        try:
            proc = _run(
                ["docker", "compose", "-p", project, "down", "-v", "--remove-orphans", "-t", "10"],
                cwd=workspace,
                timeout=timeout,
            )
            result.steps.append(f"compose down exit {proc.returncode}")
            if proc.returncode != 0:
                result.steps.append((proc.stderr or proc.stdout).strip()[-400:])
        except subprocess.TimeoutExpired:
            result.steps.append("compose down timed out")
        except OSError as exc:
            result.error = f"could not run docker: {exc}"
            return result

    left = resources_left(project)
    if any(left.values()):
        result.steps.append("compose down left resources, removing by label")
        _force_remove(project)
        left = resources_left(project)

    remaining = {kind: ids for kind, ids in left.items() if ids}
    if remaining:
        result.error = "resources still present after teardown: " + ", ".join(
            f"{len(ids)} {kind}" for kind, ids in remaining.items()
        )
        return result
    result.ok = True
    return result


def halt(workspace: Path, project: str | None = None, *, timeout: float = 240) -> TeardownResult:
    """Stop the containers but keep the network, volumes and workspace.

    Windows guests get a minute to shut down cleanly so their disk survives.
    ``resume`` (``up_command``) brings the same lab back with its data.
    """
    project = project or read_project(workspace)
    result = TeardownResult(ok=False)
    if not project:
        result.error = "no .labforge-project file in the workspace, cannot tell which Compose project to stop"
        return result
    if not docker_available():
        result.error = "docker is not on PATH on the API host"
        return result
    try:
        proc = _run(
            ["docker", "compose", "-p", project, "stop", "-t", "60"],
            cwd=workspace,
            timeout=timeout,
        )
    except subprocess.TimeoutExpired:
        result.error = "docker compose stop timed out"
        return result
    except OSError as exc:
        result.error = f"could not run docker: {exc}"
        return result
    result.steps.append(f"compose stop exit {proc.returncode}")
    if proc.returncode != 0:
        result.error = (proc.stderr or proc.stdout).strip()[-300:] or "docker compose stop failed"
        return result
    if running_count(workspace) > 0:
        result.error = "some containers are still running after docker compose stop"
        return result
    result.ok = True
    return result
