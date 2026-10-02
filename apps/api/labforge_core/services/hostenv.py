"""What the machine running LabForge looks like, and what that means for a build.

LabForge builds VMs through Vagrant and containers through Docker. Both behave
differently depending on the host, and Windows is where most of the sharp edges
are, so everything host-specific lives here:

* line endings: scripts written for Linux guests must be LF even when the API
  runs on Windows (a CRLF shebang makes the guest fail with ``bad interpreter``);
* which hypervisor is installed and usable (VirtualBox, VMware Workstation);
* whether Hyper-V / WSL2 is holding the CPU virtualisation features;
* whether the lab will fit in the host's RAM and disk;
* whether the lab's network collides with one the host already has.

Nothing here raises: every probe returns a value describing what it found, so
the preflight endpoint, the build and ``python -m labforge_core.services.hostenv``
all report the same facts.
"""

from __future__ import annotations

import ctypes
import json
import os
import re
import shutil
import socket
import subprocess
import sys
import time
from collections.abc import Iterable
from ipaddress import ip_address, ip_network
from pathlib import Path

from labforge_schema import LabConfig, Provider

# Windows tooling that is not on PATH after a default install.
_VBOX_WINDOWS = Path(r"C:\Program Files\Oracle\VirtualBox\VBoxManage.exe")
_VMRUN_WINDOWS = (
    Path(r"C:\Program Files (x86)\VMware\VMware Workstation\vmrun.exe"),
    Path(r"C:\Program Files\VMware\VMware Workstation\vmrun.exe"),
)

# Vagrant and VirtualBox both choke on very long Windows paths.
MAX_SAFE_WORKSPACE_PATH = 120

TEXT_SUFFIXES = {
    ".sh", ".py", ".ps1", ".yml", ".yaml", ".json", ".md", ".txt", ".env", ".c", ".h",
    ".yar", ".conf", ".cfg", ".ini", ".service", ".j2", ".rb", "",
}
TEXT_NAMES = {"Dockerfile", "Vagrantfile", "esq", "triage", "motd.sh", "hosts"}


def is_windows() -> bool:
    return os.name == "nt"


def is_macos() -> bool:
    return sys.platform == "darwin"


# --------------------------------------------------------------- line endings


def normalize_eol(data: bytes) -> bytes:
    """CRLF and lone CR to LF."""
    return data.replace(b"\r\n", b"\n").replace(b"\r", b"\n")


def looks_like_text(relative_name: str, data: bytes) -> bool:
    name = Path(relative_name).name
    if name in TEXT_NAMES or Path(name).suffix.lower() in TEXT_SUFFIXES:
        return b"\x00" not in data[:4096]
    return False


def write_text_lf(path: Path, content: str, *, bom: bool = False) -> None:
    """Write text with LF endings on every platform.

    ``Path.write_text`` translates ``\\n`` to ``\\r\\n`` on Windows, which breaks
    shell scripts and Dockerfiles that run inside Linux guests. ``bom=True`` adds
    a UTF-8 byte order mark, which Windows PowerShell 5.1 needs to read
    non-ASCII characters in a ``.ps1`` correctly.
    """
    data = normalize_eol(content.encode("utf-8"))
    if bom:
        data = b"\xef\xbb\xbf" + data
    path.write_bytes(data)


def write_guest_file(path: Path, content: str | bytes, relative_name: str | None = None) -> None:
    """Write a generated file for a guest or container, normalising text to LF."""
    name = relative_name or path.name
    if isinstance(content, str):
        write_text_lf(path, content, bom=path.suffix.lower() == ".ps1")
        return
    path.write_bytes(normalize_eol(content) if looks_like_text(name, content) else content)


# ------------------------------------------------------------------ resources


def host_memory_mb() -> int | None:
    """Total physical RAM in MB, or ``None`` if it cannot be read."""
    try:
        if is_windows():

            class _MemStatus(ctypes.Structure):
                _fields_ = [
                    ("dwLength", ctypes.c_ulong),
                    ("dwMemoryLoad", ctypes.c_ulong),
                    ("ullTotalPhys", ctypes.c_ulonglong),
                    ("ullAvailPhys", ctypes.c_ulonglong),
                    ("ullTotalPageFile", ctypes.c_ulonglong),
                    ("ullAvailPageFile", ctypes.c_ulonglong),
                    ("ullTotalVirtual", ctypes.c_ulonglong),
                    ("ullAvailVirtual", ctypes.c_ulonglong),
                    ("sullAvailExtendedVirtual", ctypes.c_ulonglong),
                ]

            status = _MemStatus()
            status.dwLength = ctypes.sizeof(_MemStatus)
            ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(status))  # type: ignore[attr-defined]
            return int(status.ullTotalPhys // (1024 * 1024))
        if is_macos():
            out = subprocess.run(["sysctl", "-n", "hw.memsize"], capture_output=True, text=True, errors="replace", timeout=5, check=False)
            return int(out.stdout.strip()) // (1024 * 1024)
        for line in Path("/proc/meminfo").read_text().splitlines():
            if line.startswith("MemTotal:"):
                return int(line.split()[1]) // 1024
    except (OSError, ValueError, subprocess.SubprocessError, AttributeError):
        return None
    return None


def lab_memory_mb(topology: LabConfig) -> int:
    return sum(n.config.memory_mb for n in topology.nodes if n.type.value != "internet")


def resource_warnings(topology: LabConfig, workspace_root: Path) -> list[str]:
    """Things that make a build slow or fail on this machine, as plain sentences."""
    warnings: list[str] = []
    need = lab_memory_mb(topology)
    total = host_memory_mb()
    if total and need > total * 0.75:
        warnings.append(
            f"This lab asks for {need} MB of RAM and the machine has {total} MB. "
            "Leave room for Windows itself: lower node memory or close other programs."
        )
    probe = workspace_root
    while not probe.exists() and probe != probe.parent:
        probe = probe.parent
    try:
        free_gb = shutil.disk_usage(probe).free / 1024**3
        windows_nodes = sum(1 for n in topology.nodes if n.config.os.value.startswith("windows"))
        needed_gb = 12 + 25 * windows_nodes
        if free_gb < needed_gb:
            warnings.append(
                f"Only {free_gb:.0f} GB free where the lab is built; about {needed_gb} GB is needed "
                "for the box downloads and VM disks."
            )
    except OSError:
        pass
    if len(str(workspace_root)) > MAX_SAFE_WORKSPACE_PATH and is_windows():
        warnings.append(
            "The workspace path is long. Windows path limits can break Vagrant; set "
            "LABFORGE_WORKSPACE_ROOT to something short such as C:\\lf."
        )
    return warnings


def host_ip_conflicts(cidr: str) -> list[str]:
    """Host addresses that already sit inside the lab network."""
    try:
        net = ip_network(cidr, strict=False)
    except ValueError:
        return []
    found: set[str] = set()
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            addr = info[4][0]
            if ip_address(addr) in net and not addr.endswith(".1"):
                found.add(addr)
    except OSError:
        return []
    return sorted(found)


# ---------------------------------------------------------------- hypervisors


def _run(args: list[str], timeout: float = 15) -> subprocess.CompletedProcess[str] | None:
    try:
        return subprocess.run(args, capture_output=True, text=True, errors="replace", timeout=timeout, check=False)
    except (OSError, subprocess.SubprocessError):
        return None


def vboxmanage_command() -> list[str]:
    found = shutil.which("VBoxManage") or shutil.which("vboxmanage")
    if found:
        return [found]
    if is_windows() and _VBOX_WINDOWS.exists():
        return [str(_VBOX_WINDOWS)]
    return ["VBoxManage"]


def vmrun_path() -> str | None:
    found = shutil.which("vmrun")
    if found:
        return found
    if is_windows():
        for candidate in _VMRUN_WINDOWS:
            if candidate.exists():
                return str(candidate)
    return None


def virtualbox_version() -> str | None:
    cmd = vboxmanage_command()
    if cmd == ["VBoxManage"] and shutil.which("VBoxManage") is None:
        return None
    proc = _run([*cmd, "--version"], timeout=10)
    if proc and proc.returncode == 0 and proc.stdout.strip():
        return proc.stdout.strip()
    return None


def vagrant_version() -> str | None:
    if shutil.which("vagrant") is None:
        return None
    proc = _run(["vagrant", "--version"], timeout=15)
    if proc and proc.returncode == 0:
        match = re.search(r"(\d+\.\d+\.\d+)", proc.stdout)
        return match.group(1) if match else proc.stdout.strip()
    return None


def vagrant_plugins() -> list[str]:
    proc = _run(["vagrant", "plugin", "list"], timeout=30)
    if not proc or proc.returncode != 0:
        return []
    return [line.split()[0] for line in proc.stdout.splitlines() if line.strip() and not line.startswith(" ")]


def hypervisor_present() -> bool | None:
    """True when Hyper-V, WSL2 or Windows Sandbox is holding the virtualisation features."""
    if not is_windows():
        return None
    proc = _run(
        ["powershell", "-NoProfile", "-NonInteractive", "-Command", "(Get-CimInstance Win32_ComputerSystem).HypervisorPresent"],
        timeout=20,
    )
    if not proc or proc.returncode != 0:
        return None
    return proc.stdout.strip().lower() == "true"


# GET /labs/build/preflight is polled every 10s while the Launch dialog is open. Uncached, that
# call is `vagrant --version` (up to 15s timeout) + `vagrant plugin list` (up to 30s, a second
# Ruby process start) + `VBoxManage --version` (10s) every single poll — on a host where any of
# those are genuinely slow to start, that reads as "the app is slow" exactly when someone is
# looking at it deciding whether to build. None of this changes second to second.
_VM_STATUS_TTL = 20.0
_vm_status_cache: tuple[float, dict[str, object]] | None = None


def reset_vm_status_cache() -> None:
    """Force the next vm_runtime_status() call to probe again (the Launch dialog's Re-check)."""
    global _vm_status_cache
    _vm_status_cache = None


def vm_runtime_status() -> dict[str, object]:
    """Everything the preflight reports about VM support, cached for a few seconds. Never raises."""
    global _vm_status_cache
    now = time.monotonic()
    if _vm_status_cache is not None and now - _vm_status_cache[0] < _VM_STATUS_TTL:
        return dict(_vm_status_cache[1])
    result = _vm_runtime_status_uncached()
    _vm_status_cache = (now, result)
    return dict(result)


def _vm_runtime_status_uncached() -> dict[str, object]:
    plugins = vagrant_plugins() if shutil.which("vagrant") else []
    return {
        "host_os": "windows" if is_windows() else ("macos" if is_macos() else "linux"),
        "host_arch": os.uname().machine if hasattr(os, "uname") else os.environ.get("PROCESSOR_ARCHITECTURE", ""),
        "vagrant_version": vagrant_version(),
        "virtualbox_version": virtualbox_version(),
        "vmware_vmrun": vmrun_path(),
        "vmware_plugin": "vagrant-vmware-desktop" in plugins,
        "hypervisor_present": hypervisor_present(),
        "memory_mb": host_memory_mb(),
    }


def provider_problem(provider: Provider, status: dict[str, object] | None = None) -> tuple[str, str] | None:
    """``(code, message)`` when VMs for this provider cannot be built here."""
    if provider is Provider.DOCKER:
        return None
    status = status or vm_runtime_status()
    if not status["vagrant_version"]:
        return "vagrant_missing", "Vagrant is not installed or not on PATH. Install Vagrant 2.4 or newer."
    if provider is Provider.VIRTUALBOX and not status["virtualbox_version"]:
        return "virtualbox_missing", "VirtualBox is not installed (VBoxManage was not found). Install VirtualBox 7.0 or newer."
    if provider is Provider.VMWARE:
        if not status["vmware_vmrun"]:
            return "vmware_missing", "VMware Workstation was not found (vmrun is missing)."
        if not status["vmware_plugin"]:
            return (
                "vmware_plugin_missing",
                "The Vagrant VMware plugin is missing. Run: vagrant plugin install vagrant-vmware-desktop "
                "and install the Vagrant VMware Utility.",
            )
    if provider is Provider.LIBVIRT and (is_windows() or is_macos()):
        return "libvirt_unsupported_host", "libvirt/KVM only works on a Linux host. Pick VirtualBox or VMware."
    return None


def provider_warnings(provider: Provider, status: dict[str, object] | None = None) -> list[str]:
    """Non-blocking advice for this provider on this host."""
    if provider is Provider.DOCKER:
        return []
    status = status or vm_runtime_status()
    out: list[str] = []
    if is_windows() and status.get("hypervisor_present") and provider is Provider.VIRTUALBOX:
        out.append(
            "Hyper-V or WSL2 is active, so VirtualBox has to share the CPU features with it. "
            "VMs usually start but run slower, and sometimes fail with VERR_NEM_VM_CREATE_FAILED. "
            "If that happens, use VMware Workstation or turn Hyper-V off (bcdedit /set hypervisorlaunchtype off, "
            "then reboot). Turning it off stops Docker Desktop's WSL2 backend."
        )
    return out


# ------------------------------------------------------------------------ CLI


def report(provider: Provider = Provider.VIRTUALBOX) -> dict[str, object]:
    status = vm_runtime_status()
    problem = provider_problem(provider, status)
    return {
        "status": status,
        "provider": provider.value,
        "problem": {"code": problem[0], "message": problem[1]} if problem else None,
        "warnings": provider_warnings(provider, status),
    }


def _main(argv: Iterable[str]) -> int:
    args = list(argv)
    provider = Provider(args[0]) if args else Provider.VIRTUALBOX
    data = report(provider)
    print(json.dumps(data, indent=2))
    return 1 if data["problem"] else 0


if __name__ == "__main__":
    raise SystemExit(_main(sys.argv[1:]))
