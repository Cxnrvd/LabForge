"""Pick a Vagrant box for each guest OS that actually exists and fits the provider.

Public Vagrant boxes come and go, and the Windows ones in particular are
unofficial evaluation images. Rather than trusting one hard-coded name, each OS
has a short list of candidates and the first one that works wins:

1. a box already downloaded for this provider (``vagrant box list``), so labs
   keep working offline and never re-download;
2. a box Vagrant Cloud confirms exists for this provider;
3. otherwise the first candidate, with a warning that it could not be verified.

If Vagrant Cloud answers and none of the candidates has the provider, the build
is refused up front with the list of what was tried, instead of failing twenty
minutes in.
"""

from __future__ import annotations

import json
import re
import subprocess
import urllib.error
import urllib.request
from collections.abc import Callable
from dataclasses import dataclass, field

from labforge_schema import LabConfig, OsType

from labforge_core.settings import get_settings

# Extra candidates tried after BOX_MAP's own choice. Windows boxes are unofficial
# evaluation images (licence timer: 90 to 180 days), so keep alternatives handy.
EXTRA_CANDIDATES: dict[OsType, tuple[str, ...]] = {
    OsType.WINDOWS_10: ("gusztavvargadr/windows-10", "StefanScherer/windows_10"),
    OsType.WINDOWS_11: ("gusztavvargadr/windows-11", "StefanScherer/windows_11"),
    OsType.WINDOWS_SERVER_2019: ("gusztavvargadr/windows-server-2019-standard", "StefanScherer/windows_2019"),
    OsType.WINDOWS_SERVER_2022: ("gusztavvargadr/windows-server-2022-standard", "StefanScherer/windows_2022"),
    OsType.UBUNTU_2204: ("bento/ubuntu-22.04", "generic/ubuntu2204"),
    OsType.UBUNTU_2404: ("bento/ubuntu-24.04", "generic/ubuntu2404"),
    OsType.DEBIAN_12: ("debian/bookworm64", "bento/debian-12"),
}

# What Vagrant Cloud calls each provider.
_CLOUD_NAMES: dict[str, set[str]] = {
    "virtualbox": {"virtualbox"},
    "vmware_desktop": {"vmware_desktop", "vmware_workstation", "vmware_fusion"},
    "libvirt": {"libvirt"},
}

Fetch = Callable[[str], dict | None]
Cached = Callable[[], set[tuple[str, str]]]


class BoxUnavailable(RuntimeError):
    """No candidate box exists for a guest OS on this provider."""


@dataclass
class BoxResolution:
    overrides: dict[OsType, str] = field(default_factory=dict)
    warnings: list[str] = field(default_factory=list)
    report: list[dict[str, str]] = field(default_factory=list)


def fetch_cloud_box(name: str, timeout: float = 8) -> dict | None:
    """Vagrant Cloud record for ``org/box``, ``{}`` if it does not exist, ``None`` if unreachable."""
    req = urllib.request.Request(
        f"https://app.vagrantup.com/api/v1/box/{name}",
        headers={"Accept": "application/json", "User-Agent": "labforge"},
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.load(resp)
    except urllib.error.HTTPError as exc:
        return {} if exc.code in (403, 404) else None
    except (urllib.error.URLError, TimeoutError, OSError, ValueError):
        return None


def cached_boxes() -> set[tuple[str, str]]:
    """``{(box, provider)}`` already downloaded."""
    try:
        proc = subprocess.run(
            ["vagrant", "box", "list"], capture_output=True, text=True, timeout=30, check=False
        )
    except (OSError, subprocess.SubprocessError):
        return set()
    found: set[tuple[str, str]] = set()
    for line in proc.stdout.splitlines():
        match = re.match(r"^(\S+)\s+\(([^,)]+)", line.strip())
        if match:
            found.add((match.group(1), match.group(2)))
    return found


def _providers_of(record: dict) -> set[str]:
    current = record.get("current_version") or {}
    return {p.get("name", "") for p in current.get("providers", [])}


def candidates_for(os_type: OsType, default_box: str) -> list[str]:
    seen: list[str] = []
    override = get_settings().box_overrides.get(os_type.value)
    for name in ([override] if override else []) + [default_box, *EXTRA_CANDIDATES.get(os_type, ())]:
        if name and name not in seen:
            seen.append(name)
    return seen


def resolve_boxes(
    topology: LabConfig,
    provider: str,
    default_boxes: dict[OsType, str],
    *,
    fetch: Fetch = fetch_cloud_box,
    cached: Cached = cached_boxes,
    verify: bool | None = None,
) -> BoxResolution:
    """Choose a box per guest OS. Raises ``BoxUnavailable`` only on a definite miss."""
    result = BoxResolution()
    verify = get_settings().verify_boxes if verify is None else verify
    have = cached()
    cloud_names = _CLOUD_NAMES.get(provider, {provider})
    seen_os: set[OsType] = set()

    for node in topology.nodes:
        os_type = node.config.os
        if os_type in seen_os or node.type.value == "internet":
            continue
        seen_os.add(os_type)
        default = default_boxes.get(os_type, "")
        tried: list[str] = []
        chosen: str | None = None
        how = ""
        unreachable = False

        options = candidates_for(os_type, default)
        for name in options:
            if (name, provider) in have:
                chosen, how = name, "already downloaded"
                break
        if chosen is None and verify:
            for name in options:
                record = fetch(name)
                if record is None:
                    unreachable = True
                    continue
                if record and _providers_of(record) & cloud_names:
                    chosen, how = name, "confirmed on Vagrant Cloud"
                    break
                tried.append(name + (" (no " + provider + " build)" if record else " (not found)"))
        if chosen is None:
            if verify and tried and not unreachable:
                raise BoxUnavailable(
                    f"No Vagrant box found for {os_type.value} on {provider}. Tried: {', '.join(tried)}. "
                    "Download one by hand with 'vagrant box add', or set "
                    f"LABFORGE_BOX_OVERRIDES='{{\"{os_type.value}\": \"org/box\"}}'."
                )
            chosen = options[0] if options else default
            how = "not verified"
            result.warnings.append(
                f"Could not verify a box for {os_type.value} (Vagrant Cloud unreachable); using {chosen}. "
                "A first build needs internet access to download it."
                if verify
                else f"Box check is off; using {chosen} for {os_type.value}."
            )
        if chosen != default:
            result.overrides[os_type] = chosen
        result.report.append({"os": os_type.value, "box": chosen, "source": how})
    return result
