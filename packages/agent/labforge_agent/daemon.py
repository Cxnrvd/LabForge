"""Heartbeat daemon — runs alongside a provisioned lab and POSTs status to
the LabForge API every ``interval`` seconds. Spawned by ``labforge run``
and torn down by ``labforge destroy`` (which removes the workspace dir).
"""

from __future__ import annotations

import os
import re
import shutil
import signal
import subprocess
import sys
import time
from collections import deque
from datetime import datetime
from pathlib import Path
from typing import Iterable

import httpx


def _vagrant_status(workspace: Path) -> tuple[str, list[dict]]:
    """Run ``vagrant status --machine-readable`` and parse out per-VM state.

    Returns (lab_status, vms[]).
    """
    try:
        proc = subprocess.run(
            ["vagrant", "status", "--machine-readable"],
            cwd=str(workspace),
            check=False,
            capture_output=True,
            text=True, encoding="utf-8", errors="replace",
            timeout=15,
        )
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return "unknown", []

    states: dict[str, dict] = {}
    for raw in proc.stdout.splitlines():
        parts = raw.split(",")
        if len(parts) < 4:
            continue
        _ts, target, key, *rest = parts
        if not target:
            continue
        vm = states.setdefault(target, {"hostname": target, "state": "unknown"})
        if key == "state":
            vm["state"] = rest[0] if rest else "unknown"
        elif key == "provider-name" and rest:
            vm["provider"] = rest[0]

    vms = list(states.values())
    if not vms:
        return "unknown", []
    running = sum(1 for v in vms if v["state"] == "running")
    if running == len(vms):
        lab_status = "running"
    elif running == 0:
        lab_status = "stopped"
    else:
        lab_status = "partial"
    return lab_status, vms


def _is_docker_workspace(workspace: Path) -> bool:
    return (workspace / "docker-compose.yml").exists() and not (workspace / "Vagrantfile").exists()


def _compose_project(workspace: Path) -> str | None:
    path = workspace / ".labforge-project"
    if path.exists():
        value = path.read_text(encoding="utf-8").strip()
        return value or None
    return None


def _compose_status(workspace: Path) -> tuple[str, list[dict]]:
    """``docker compose ps`` for a docker-runtime lab.

    Returns (lab_status, vms[]) in the same shape as ``_vagrant_status`` so the
    API and dashboard need no special case: each container is one "VM" whose
    hostname is its compose service name.
    """
    import json

    project = _compose_project(workspace)
    if not project:
        return "unknown", []
    try:
        proc = subprocess.run(
            ["docker", "compose", "-p", project, "ps", "-a", "--format", "json"],
            cwd=str(workspace),
            check=False,
            capture_output=True,
            text=True, encoding="utf-8", errors="replace",
            timeout=20,
        )
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return "unknown", []
    if proc.returncode != 0:
        return "unknown", []

    text = proc.stdout.strip()
    rows: list[dict] = []
    if text.startswith("["):
        try:
            rows = list(json.loads(text))
        except ValueError:
            rows = []
    else:
        for line in text.splitlines():
            try:
                rows.append(json.loads(line))
            except ValueError:
                continue

    vms: list[dict] = []
    for row in rows:
        state = (row.get("State") or "unknown").lower()
        health = (row.get("Health") or "").lower()
        if state == "running" and health in ("starting", "unhealthy"):
            state = health
        vms.append(
            {
                "hostname": row.get("Service") or row.get("Name", "?"),
                "state": state,
                "provider": "docker",
            }
        )
    if not vms:
        return "unknown", []
    running = sum(1 for v in vms if v["state"] == "running")
    if running == len(vms):
        lab_status = "running"
    elif running == 0:
        lab_status = "stopped"
    else:
        lab_status = "partial"
    return lab_status, vms


def _topology_ip_map(workspace: Path) -> dict[str, str]:
    """hostname -> IP from the frozen ``topology.json`` (docker runtime)."""
    import json

    path = workspace / "topology.json"
    if not path.exists():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    out: dict[str, str] = {}
    for node in data.get("nodes", []):
        cfg = node.get("config", {})
        if cfg.get("hostname") and cfg.get("ip"):
            out[cfg["hostname"]] = cfg["ip"]
    return out


def _compose_log_tail(workspace: Path, max_lines: int = 50) -> list[str]:
    project = _compose_project(workspace)
    if not project:
        return []
    try:
        proc = subprocess.run(
            ["docker", "compose", "-p", project, "logs", "--no-color", "--tail", "5"],
            cwd=str(workspace),
            check=False,
            capture_output=True,
            text=True, encoding="utf-8", errors="replace",
            timeout=15,
        )
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return []
    if proc.returncode != 0:
        return []
    return [ln for ln in proc.stdout.splitlines() if ln.strip()][-max_lines:]


_HOST_RE = re.compile(r'config\.vm\.define\s+"([^"]+)"')
_IP_RE = re.compile(r'ip:\s*"([0-9.]+)"')
# tcpdump "-nn" line, e.g.:
#   11:22:33.444 IP 10.0.0.1.443 > 10.0.0.2.55001: Flags [.], ...
# We deliberately accept both the .port suffix and bare-IP form so ICMP and
# ARP-ish lines still parse.
_TCPDUMP_RE = re.compile(
    r"\bIP6?\s+([0-9.]+?)(?:\.\d+)?\s+>\s+([0-9.]+?)(?:\.\d+)?:\s+(\S+)"
)


def _vagrantfile_ip_map(workspace: Path) -> dict[str, str]:
    """Parse the bundled Vagrantfile for hostname → private IP, so heartbeats
    carry the IPs the dashboard can show alongside ``vagrant status``."""
    vf = workspace / "Vagrantfile"
    if not vf.exists():
        return {}
    out: dict[str, str] = {}
    current: str | None = None
    for line in vf.read_text(encoding="utf-8", errors="ignore").splitlines():
        m_host = _HOST_RE.search(line)
        if m_host:
            current = m_host.group(1)
            continue
        m_ip = _IP_RE.search(line)
        if m_ip and current:
            out.setdefault(current, m_ip.group(1))
    return out


def _detect_capture_ifaces(ip_map: dict[str, str]) -> list[str]:
    """Pick the host-side interfaces that route the lab's private subnets.

    Best-effort. We look at the `/24` subnet of each known guest IP and
    return any host iface whose own address sits in the same subnet.

    Returns an empty list on platforms where we can't enumerate ifaces.
    """
    if not ip_map:
        return []
    subnets = {".".join(ip.split(".")[:3]) for ip in ip_map.values() if ip}
    if not subnets:
        return []
    found: list[str] = []
    try:
        # POSIX path: parse `ip -o -4 addr` if available.
        if shutil.which("ip"):
            proc = subprocess.run(
                ["ip", "-o", "-4", "addr"],
                capture_output=True, text=True, encoding="utf-8", errors="replace", check=False, timeout=5,
            )
            for line in proc.stdout.splitlines():
                parts = line.split()
                if len(parts) < 4:
                    continue
                iface, addr = parts[1], parts[3].split("/")[0]
                if ".".join(addr.split(".")[:3]) in subnets and iface not in found:
                    found.append(iface)
            return found
        # macOS / BSD: ifconfig
        if shutil.which("ifconfig"):
            proc = subprocess.run(
                ["ifconfig"], capture_output=True, text=True, encoding="utf-8", errors="replace", check=False, timeout=5,
            )
            current: str | None = None
            for raw in proc.stdout.splitlines():
                if raw and not raw.startswith((" ", "\t")):
                    current = raw.split(":", 1)[0]
                elif current and "inet " in raw:
                    after = raw.split("inet ", 1)[1].split()[0]
                    if ".".join(after.split(".")[:3]) in subnets and current not in found:
                        found.append(current)
            return found
    except (OSError, subprocess.TimeoutExpired):
        return found
    return found


def _capture_flows(ifaces: list[str], duration: float) -> list[dict]:
    """Best-effort packet sample via tcpdump.

    Aggregates (src_ip, dst_ip, protocol) tuples into packet counts over
    ``duration`` seconds across all detected ifaces. Returns ``[]`` if
    tcpdump isn't installed, can't be invoked (insufficient privileges),
    or returns nothing.
    """
    if not ifaces or duration < 1.0:
        return []
    if shutil.which("tcpdump") is None:
        return []
    aggregated: dict[tuple[str, str, str], int] = {}
    timeout = max(2.0, duration + 1.0)
    for iface in ifaces:
        try:
            proc = subprocess.run(
                ["tcpdump", "-i", iface, "-nn", "-q",
                 "-G", str(int(duration)), "-W", "1",
                 "-c", "500"],
                capture_output=True, text=True, encoding="utf-8", errors="replace", check=False, timeout=timeout,
            )
        except (FileNotFoundError, subprocess.TimeoutExpired, PermissionError):
            continue
        for raw in proc.stdout.splitlines():
            m = _TCPDUMP_RE.search(raw)
            if not m:
                continue
            src, dst, proto = m.group(1), m.group(2), m.group(3)
            # Strip trailing comma/colon residue from the protocol token.
            proto = proto.strip(",:").lower() or "ip"
            key = (src, dst, proto)
            aggregated[key] = aggregated.get(key, 0) + 1
    return [
        {"src_ip": k[0], "dst_ip": k[1], "protocol": k[2], "packets": v, "bytes_estimate": 0}
        for k, v in aggregated.items()
    ]


def _tail_logs(workspace: Path, max_lines: int = 50) -> list[str]:
    """Best-effort tail of any provisioning log we can find under the
    workspace. Vagrant doesn't centralise these by default, so we collect
    from a few likely paths."""
    candidates: list[Path] = []
    for pattern in (
        ".vagrant/machines/*/virtualbox/action_provision",
        "*.log",
        "provision/*.log",
    ):
        candidates.extend(workspace.glob(pattern))
    lines: deque[str] = deque(maxlen=max_lines)
    for path in candidates:
        try:
            with path.open("r", encoding="utf-8", errors="ignore") as fh:
                for raw in fh:
                    raw = raw.rstrip()
                    if raw:
                        lines.append(f"{path.name}: {raw}")
        except OSError:
            continue
    return list(lines)


def run(
    *,
    lab_id: int,
    workspace: Path,
    api_base: str = "http://127.0.0.1:8000",
    interval: float = 10.0,
    one_shot: bool = False,
    api_token: str | None = None,
) -> int:
    """Heartbeat loop. Exits cleanly when the workspace directory disappears
    or a STOP sentinel file appears in it."""
    stop_file = workspace / ".labforge-daemon-stop"
    docker_mode = _is_docker_workspace(workspace)
    ip_map = _topology_ip_map(workspace) if docker_mode else _vagrantfile_ip_map(workspace)
    headers = {"Authorization": f"Bearer {api_token}"} if api_token else {}
    client = httpx.Client(base_url=api_base, timeout=5, headers=headers)
    capture_ifaces = _detect_capture_ifaces(ip_map)
    # tcpdump captures inside roughly half the heartbeat window so the
    # daemon still has time to read state + POST before the next tick.
    capture_window = max(1.0, min(8.0, interval / 2.0))

    def _shutdown(_sig, _frame):
        raise SystemExit(0)

    signal.signal(signal.SIGTERM, _shutdown)
    signal.signal(signal.SIGINT, _shutdown)

    # While the in-app build is still in flight (no .build.exit yet),
    # ``vagrant status --machine-readable`` competes for Vagrant's
    # per-machine lock with the ongoing ``vagrant up`` and crashes the
    # build with "machine is locked". Defer the status query until the
    # sentinel lands; until then, surface a placeholder so the dashboard
    # still gets heartbeats with log_tail + flows for telemetry.
    build_exit = workspace / ".build.exit"

    try:
        while True:
            if not workspace.exists() or stop_file.exists():
                break

            try:
                if build_exit.exists():
                    lab_status, vms = (
                        _compose_status(workspace) if docker_mode else _vagrant_status(workspace)
                    )
                    for vm in vms:
                        vm["ip"] = ip_map.get(vm["hostname"])
                else:
                    lab_status, vms = "building", []
                flows = _capture_flows(capture_ifaces, capture_window)
                payload = {
                    "lab_status": lab_status,
                    "vms": vms,
                    "log_tail": _compose_log_tail(workspace) if docker_mode else _tail_logs(workspace),
                    "flows": flows,
                    "captured_at": datetime.utcnow().isoformat(),
                }
                client.post(f"/api/v1/labs/{lab_id}/heartbeat", json=payload)
            except Exception as exc:
                # The daemon must outlive anything a single sample throws at it (an API outage,
                # undecodable log bytes, a docker call that hangs). One bad sample is not the
                # end of the monitor.
                print(f"[daemon] heartbeat failed: {type(exc).__name__}: {exc}", file=sys.stderr)

            if one_shot:
                return 0
            # Subtract the capture window so heartbeats land roughly on the
            # requested cadence even though tcpdump blocks the loop.
            time.sleep(max(0.0, interval - capture_window))
    finally:
        client.close()
    return 0


def spawn_detached(
    *,
    lab_id: int,
    workspace: Path,
    api_base: str,
    interval: float = 10.0,
    api_token: str | None = None,
) -> int:
    """Spawn ``labforge daemon`` as a detached background process. Returns the
    PID (parent's child).

    The token is passed through the environment (``LABFORGE_API_TOKEN``) so
    it never appears in process listings.
    """
    cmd = [
        sys.executable,
        "-m",
        "labforge_agent",
        "daemon",
        "--lab-id",
        str(lab_id),
        "--workspace",
        str(workspace),
        "--api-base",
        api_base,
        "--interval",
        str(int(interval)),
    ]
    log_path = workspace / "daemon.log"
    fh = log_path.open("a", encoding="utf-8")
    fh.write(f"\n--- daemon start {datetime.utcnow().isoformat()} ---\n")
    fh.flush()
    env = {**os.environ}
    if api_token:
        env["LABFORGE_API_TOKEN"] = api_token
    popen_kwargs: dict = {}
    if os.name == "nt":
        # Hidden console shared by the daemon's own vagrant/docker calls, so no
        # window flashes on every poll. New process group so it outlives the API.
        popen_kwargs["creationflags"] = (
            subprocess.CREATE_NEW_PROCESS_GROUP | 0x08000000  # CREATE_NO_WINDOW
        )
    else:
        popen_kwargs["start_new_session"] = True
    proc = subprocess.Popen(
        cmd,
        cwd=str(workspace),
        stdout=fh,
        stderr=fh,
        stdin=subprocess.DEVNULL,
        env=env,
        **popen_kwargs,
    )
    pid_file = workspace / ".labforge-daemon.pid"
    pid_file.write_text(str(proc.pid), encoding="utf-8")
    return proc.pid


def request_stop(workspace: Path) -> None:
    """Drop a sentinel file the daemon loop polls for."""
    (workspace / ".labforge-daemon-stop").write_text("stop", encoding="utf-8")


def _ignored_kwargs(*_: Iterable[object]) -> None: ...
