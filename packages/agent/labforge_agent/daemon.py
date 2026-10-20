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
from datetime import UTC, datetime
from pathlib import Path
from typing import Iterable

import httpx


def _run_killtree(argv: list[str], *, cwd: str | None, timeout: float) -> subprocess.CompletedProcess:
    """``subprocess.run`` whose timeout kills the whole process tree.

    ``vagrant.exe`` spawns ``ruby.exe`` underneath it; plain ``run(timeout=...)`` kills only the
    top process on Windows, so every timed-out call leaked a ruby.exe (one per heartbeat cycle).
    """
    proc = subprocess.Popen(
        argv, cwd=cwd, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        text=True, encoding="utf-8", errors="replace",
        start_new_session=not sys.platform.startswith("win"),
    )
    try:
        out, err = proc.communicate(timeout=timeout)
    except subprocess.TimeoutExpired:
        if sys.platform.startswith("win"):
            subprocess.call(
                ["taskkill", "/F", "/T", "/PID", str(proc.pid)],
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            )
        else:
            try:
                os.killpg(proc.pid, signal.SIGKILL)
            except (ProcessLookupError, PermissionError):
                pass
        try:
            proc.communicate(timeout=5)
        except Exception:
            pass
        raise
    return subprocess.CompletedProcess(argv, proc.returncode, out, err)


def _summarise(vms: list[dict]) -> tuple[str, list[dict]]:
    if not vms:
        return "unknown", []
    running = sum(1 for v in vms if v["state"] == "running")
    if running == len(vms):
        return "running", vms
    return ("stopped" if running == 0 else "partial"), vms


_VMRUN_WINDOWS = (
    Path(r"C:\Program Files (x86)\VMware\VMware Workstation\vmrun.exe"),
    Path(r"C:\Program Files\VMware\VMware Workstation\vmrun.exe"),
)


def _find_vmrun() -> str | None:
    found = shutil.which("vmrun")
    if found:
        return found
    return next((str(p) for p in _VMRUN_WINDOWS if p.exists()), None)


def _vmx_key(path: str) -> str:
    return os.path.normcase(os.path.realpath(path.strip()))


def _vmware_status(workspace: Path) -> tuple[str, list[dict]] | None:
    """Fast path for vmware_desktop labs: ``vmrun list`` against the .vmx paths Vagrant recorded.

    ``vagrant status`` costs 20-30 s of Ruby start-up per call on this plugin and holds the
    machine lock the whole time. ``vmrun list`` answers in well under a second. Returns None
    when this isn't a VMware workspace (or vmrun is missing) so the caller falls back.
    """
    machines = workspace / ".vagrant" / "machines"
    if not machines.is_dir():
        return None
    recorded: dict[str, str] = {}
    for mdir in sorted(machines.iterdir()):
        id_file = mdir / "vmware_desktop" / "id"
        if id_file.is_file():
            recorded[mdir.name] = id_file.read_text(encoding="utf-8", errors="replace").strip()
    vmrun = _find_vmrun()
    if not recorded or not vmrun:
        return None
    try:
        proc = _run_killtree([vmrun, "list"], cwd=None, timeout=15)
    except (OSError, subprocess.TimeoutExpired):
        return None
    if proc.returncode != 0:
        return None
    running = {_vmx_key(ln) for ln in proc.stdout.splitlines()[1:] if ln.strip()}

    def state_of(vmx: str) -> str:
        if _vmx_key(vmx) in running:
            return "running"
        # vmrun cannot tell suspended from powered off; VMware leaves a .vmss next to the .vmx.
        return "suspended" if any(Path(vmx).parent.glob("*.vmss")) else "poweroff"

    return _summarise(
        [{"hostname": n, "state": state_of(v), "provider": "vmware_desktop"} for n, v in recorded.items()]
    )


def _vagrant_status(workspace: Path) -> tuple[str, list[dict]]:
    """Per-VM state of a Vagrant lab: ``vmrun list`` for VMware, else ``vagrant status``.

    Returns (lab_status, vms[]).
    """
    fast = _vmware_status(workspace)
    if fast is not None:
        return fast
    try:
        proc = _run_killtree(
            ["vagrant", "status", "--machine-readable"],
            cwd=str(workspace),
            # Slow providers can take 20-30 s; at 15 s a VMware lab read "unknown" forever,
            # which hides the Pause/Resume buttons.
            timeout=60,
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

    return _summarise(list(states.values()))


def _is_docker_workspace(workspace: Path) -> bool:
    return (workspace / "docker-compose.yml").exists() and not (workspace / "Vagrantfile").exists()


def _compose_project(workspace: Path) -> str | None:
    path = workspace / ".labforge-project"
    if path.exists():
        value = path.read_text(encoding="utf-8").strip()
        return value or None
    return None


_WINDOWS_READY: set[str] = set()


def _windows_ready(container: str) -> bool:
    """True once the Windows guest behind a dockurr container accepts connections on 3389."""
    if not container:
        return True
    if container in _WINDOWS_READY:
        return True
    try:
        nat = subprocess.run(
            ["docker", "exec", container, "sh", "-c", "iptables -t nat -S QEMU_DNAT 2>/dev/null | tail -1"],
            capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=15, check=False,
        ).stdout
        m = re.search(r"--to-destination (\d+\.\d+\.\d+\.\d+)", nat)
        if not m:
            return False
        probe = subprocess.run(
            ["docker", "exec", container, "bash", "-c", f"(echo > /dev/tcp/{m.group(1)}/3389) >/dev/null 2>&1"],
            capture_output=True, timeout=15, check=False,
        )
    except (OSError, subprocess.TimeoutExpired):
        return False
    if probe.returncode == 0:
        _WINDOWS_READY.add(container)
        return True
    return False


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
        if state == "running" and "dockurr/windows" in str(row.get("Image", "")):
            # The container is up long before Windows is: download, setup and first boot take
            # 10 to 45 minutes. Report "installing" until the guest answers on its RDP port.
            if not _windows_ready(row.get("Name", "")):
                state = "installing"
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


def _never_built(workspace: Path) -> list[dict]:
    """Nodes the topology asked for that this build never attempted — read straight from the
    notes/<hostname>.txt files the Docker generator itself writes for every skipped node
    (compose_generator.build_bundle), so this can never drift from what the build actually did."""
    notes_dir = workspace / "notes"
    if not notes_dir.is_dir():
        return []
    out: list[dict] = []
    for path in sorted(notes_dir.glob("*.txt")):
        try:
            reason = path.read_text(encoding="utf-8").strip()
        except OSError:
            continue
        if reason:
            out.append({"hostname": path.stem, "reason": reason})
    return out


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


_VMX_IFACE_RE = re.compile(r'^ethernet(\d+)\.(connectiontype|vnet)\s*=\s*"([^"]+)"', re.IGNORECASE)


def _vmware_private_vnets(workspace: Path) -> set[str]:
    """``vmnetN`` names backing this workspace's VMware ``private_network``
    adapters (the "custom" ethernet, as opposed to the NAT one each node
    also gets for internet access)."""
    vnets: set[str] = set()
    for vmx in workspace.glob(".vagrant/machines/*/vmware_desktop/*/*.vmx"):
        try:
            lines = vmx.read_text(encoding="utf-8", errors="ignore").splitlines()
        except OSError:
            continue
        per_iface: dict[str, dict[str, str]] = {}
        for line in lines:
            m = _VMX_IFACE_RE.match(line.strip())
            if m:
                idx, key, val = m.groups()
                per_iface.setdefault(idx, {})[key] = val
        for iface in per_iface.values():
            if iface.get("connectiontype") == "custom" and iface.get("vnet", "").startswith("vmnet"):
                vnets.add(iface["vnet"])
    return vnets


def _ensure_vmware_private_network(workspace: Path) -> list[str]:
    """Self-heal the known VMware-on-Windows gap this platform can hit: a
    lab's ``private_network`` (e.g. 10.71.0.0/24) rides a host-only
    ``vmnetN`` adapter that Windows/VMware sometimes leaves on a DHCP-less
    APIPA (169.254.x.x) address instead of a static IP in the lab's
    subnet — the guest VMs come up fine, but the host can never route to
    them, and that's only discoverable by clicking a dead link after the
    lab is already "running". This runs once per lab, right after the
    first heartbeat reports it running, and fixes the host adapter itself
    instead of leaving that for someone to find later.

    Windows + Vagrant/VMware only; no-op everywhere else. Returns log
    lines (success or failure) meant to be appended to build.log so the
    fix (or the reason it couldn't happen) is visible in the Logs tab
    immediately rather than silently.
    """
    import ipaddress
    import json

    if not sys.platform.startswith("win"):
        return []
    topo_path = workspace / "topology.json"
    if not topo_path.exists():
        return []
    try:
        topo = json.loads(topo_path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return []
    cidr = topo.get("network_cidr")
    if not cidr:
        return []
    try:
        net = ipaddress.ip_network(cidr, strict=False)
    except ValueError:
        return []
    gateway = None
    for node in topo.get("nodes", []):
        gw = node.get("config", {}).get("gateway")
        if gw:
            gateway = gw
            break
    gateway = gateway or str(next(net.hosts()))

    vnets = _vmware_private_vnets(workspace)
    if not vnets:
        return []

    lines: list[str] = []
    for vnet in sorted(vnets):
        alias = f"VMware Network Adapter VMnet{vnet[len('vmnet'):]}"
        ps_check = (
            f"(Get-NetIPAddress -InterfaceAlias '{alias}' -AddressFamily IPv4 "
            "-ErrorAction SilentlyContinue | Select-Object -ExpandProperty IPAddress) -join ','"
        )
        try:
            check = subprocess.run(
                ["powershell.exe", "-NoProfile", "-Command", ps_check],
                capture_output=True, text=True, errors="replace", timeout=15, check=False,
            )
        except (OSError, subprocess.TimeoutExpired) as exc:
            lines.append(f"[labforge] network: could not query host adapter '{alias}': {exc}")
            continue
        current_addrs = [a.strip() for a in (check.stdout or "").split(",") if a.strip()]
        already_ok = any(ipaddress.ip_address(a) in net for a in current_addrs if _is_ip(a))
        if already_ok:
            continue  # host can already route to this subnet — nothing to fix
        ps_fix = (
            f"Get-NetIPAddress -InterfaceAlias '{alias}' -AddressFamily IPv4 "
            "-ErrorAction SilentlyContinue | Remove-NetIPAddress -Confirm:$false "
            f"-ErrorAction SilentlyContinue; New-NetIPAddress -InterfaceAlias '{alias}' "
            f"-IPAddress {gateway} -PrefixLength {net.prefixlen} -ErrorAction Stop | Out-Null"
        )
        try:
            fix = subprocess.run(
                ["powershell.exe", "-NoProfile", "-Command", ps_fix],
                capture_output=True, text=True, errors="replace", timeout=20, check=False,
            )
        except (OSError, subprocess.TimeoutExpired) as exc:
            lines.append(f"[labforge] network: could not fix host adapter '{alias}' for {cidr}: {exc}")
            continue
        if fix.returncode == 0:
            was = ", ".join(current_addrs) if current_addrs else "none / APIPA"
            lines.append(
                f"[labforge] network: host adapter '{alias}' had no address in {cidr} "
                f"(was: {was}) — set it to {gateway}/{net.prefixlen} so this lab's nodes "
                "are reachable from this PC."
            )
        else:
            err = (fix.stderr or fix.stdout or "").strip().splitlines()
            lines.append(
                f"[labforge] network: '{alias}' is not routable to {cidr} and auto-fix failed "
                f"({err[-1] if err else 'unknown error'}). Node links in the monitor view won't "
                "load until this is fixed — this usually needs Administrator privileges. Open "
                f"VMware Virtual Network Editor and give {alias} a static IP of "
                f"{gateway}/{net.prefixlen}, or re-run LabForge elevated."
            )
    return lines


def _is_ip(s: str) -> bool:
    import ipaddress

    try:
        ipaddress.ip_address(s)
        return True
    except ValueError:
        return False


_ANSI = re.compile(chr(27) + r"\[[0-9;?]*[A-Za-z]")


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
    return [_ANSI.sub("", ln) for ln in proc.stdout.splitlines() if ln.strip()][-max_lines:]


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
    network_checked = False

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
                    if not network_checked and not docker_mode and lab_status in ("running", "partial"):
                        network_checked = True
                        net_lines = _ensure_vmware_private_network(workspace)
                        if net_lines:
                            with (workspace / "build.log").open("a", encoding="utf-8") as fh:
                                fh.write("\n".join(net_lines) + "\n")
                else:
                    lab_status, vms = "building", []
                flows = _capture_flows(capture_ifaces, capture_window)
                payload = {
                    "lab_status": lab_status,
                    "vms": vms,
                    "log_tail": _compose_log_tail(workspace) if docker_mode else _tail_logs(workspace),
                    "flows": flows,
                    "never_built": _never_built(workspace),
                    "captured_at": datetime.now(UTC).isoformat(),
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
    # Truncated, not appended: this file is live operational telemetry read
    # by the Monitor page's log tail, not a durable record — heartbeat
    # history already lives in the `lab_heartbeats` DB table. Appending let a
    # dead daemon's stale "heartbeat failed" lines from a prior session
    # (sometimes a day old, after the VM was killed outside the app) sit at
    # the head of every fresh tail, reading as a live failure.
    fh = log_path.open("w", encoding="utf-8")
    fh.write(f"--- daemon start {datetime.now(UTC).isoformat()} ---\n")
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
