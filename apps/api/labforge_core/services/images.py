"""Image library: what each lab needs on this computer, and what is already here.

Four kinds of entry, all identified by a stable string id:

* ``docker``       a container image reference, for example ``docker.elastic.co/kibana/kibana:8.15.3``.
                   Images LabForge builds itself (``labforge/log-replay:<hash>``) are built, not pulled.
* ``windows-base`` the Windows installer ISO downloaded from Microsoft, kept in the local volume
                   ``labforge-win-base-<id>``. A lab seeded from it skips the 6 GB download (the
                   slowest part of a first boot) and still installs fresh, so its first-boot setup runs.
* ``golden``       a saved copy of a Windows machine's disk volume (``labforge-golden-<slug>``). A new
                   lab seeded from it skips the download and the install.
* ``vagrant-box``  a Vagrant box for the VM providers.

Windows disks never leave this computer on their own: there is no push or upload code path here.
Export writes a local archive for the person who asked for it, nothing more.
"""

from __future__ import annotations

import json
import re
import shutil
import subprocess
import tempfile
import threading
import time
from collections.abc import Iterator
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml
from labforge_schema import LabConfig

from labforge_core.services import docker_runtime, preflight
from labforge_core.services.compose_generator import WINDOWS_IMAGE, build_bundle, is_windows_guest
from labforge_core.services.template_loader import get_template, list_templates

BASE_PREFIX = "labforge-win-base-"
GOLDEN_PREFIX = "labforge-golden-"
LABEL_BASE = "labforge.base"
LABEL_GOLDEN = "labforge.golden"

WINDOWS_BASES: dict[str, tuple[str, str]] = {
    "windows-10": ("10", "Windows 10"),
    "windows-11": ("11", "Windows 11"),
    "windows-2019": ("2019", "Windows Server 2019"),
    "windows-2022": ("2022", "Windows Server 2022"),
}
_OS_TO_BASE = {
    "windows_10": "windows-10",
    "windows_11": "windows-11",
    "windows_server_2019": "windows-2019",
    "windows_server_2022": "windows-2022",
}
# Rough sizes shown for things that are not on disk yet.
ESTIMATE_MB = {"windows-base": 20000, "docker": 600, "vagrant-box": 1500}
KNOWN_ESTIMATE_MB = {
    "docker.elastic.co/elasticsearch/elasticsearch": 1960,
    "docker.elastic.co/kibana/kibana": 1850,
    "kalilinux/kali-rolling": 3200,
    "dockurr/windows": 800,
}
# Disk images are sparse (64 GB apparent, about 11 GB used). BusyBox cp would write all 64 GB, so
# copies use GNU coreutils.
COPY_IMAGE = "debian:bookworm-slim"
BASE_USER = "labadmin"
BASE_PASSWORD = "LabForge!2026"


_CACHE: dict[str, tuple[float, Any]] = {}


def _cached(key: str, ttl: float, make):
    """Time based cache, stale while revalidate: an expired value is returned at once and refreshed
    in the background, so a slow Docker call (copying a big disk keeps the engine busy) never makes
    a page wait or the proxy time out. Only the very first call computes inline."""
    now = time.monotonic()
    hit = _CACHE.get(key)
    if hit is None:
        value = make()
        _CACHE[key] = (now, value)
        return value
    if now - hit[0] >= ttl and key not in _REFRESHING:
        _REFRESHING.add(key)

        def refresh() -> None:
            try:
                _CACHE[key] = (time.monotonic(), make())
            except Exception:
                pass
            finally:
                _REFRESHING.discard(key)

        threading.Thread(target=refresh, name=f"refresh-{key}", daemon=True).start()
    return hit[1]


_REFRESHING: set[str] = set()


def clear_cache() -> None:
    _CACHE.clear()
    _REFRESHING.clear()


class ImageError(RuntimeError):
    def __init__(self, message: str, code: str = "image_error", status: int = 409) -> None:
        super().__init__(message)
        self.code = code
        self.status = status


@dataclass
class Job:
    id: str
    action: str
    status: str = "pulling"
    progress: float | None = None
    error: str | None = None
    started: float = field(default_factory=time.time)


_JOBS: dict[str, Job] = {}
_LOCK = threading.Lock()


def _docker(args: list[str], timeout: float = 60) -> subprocess.CompletedProcess[str]:
    return docker_runtime._run(["docker", *args], timeout=timeout)


def _slug(text: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
    if not slug:
        raise ImageError("The name needs at least one letter or digit.", "bad_name", 422)
    return slug[:48]


# ------------------------------------------------------------------ catalog


@dataclass
class Spec:
    id: str
    kind: str
    name: str
    tag: str | None
    used_by: set[str] = field(default_factory=set)
    custom: bool = False  # built by LabForge rather than pulled


def _split_ref(ref: str) -> tuple[str, str | None]:
    last = ref.rsplit("/", 1)[-1]
    if ":" in last:
        name, tag = ref.rsplit(":", 1)
        return name, tag
    return ref, None


def topology_images(topology: LabConfig) -> list[dict[str, Any]]:
    """Requirements of one topology: ``[{key, label, kind, nodes, ids}]``. Pure, no Docker calls."""
    files, artifacts = build_bundle(topology, project="lf-img", include_readme=False, include_hosts_file=False)
    compose = yaml.safe_load(files["docker-compose.yml"]) or {}
    by_host = {n.config.hostname: n for n in topology.nodes}
    reqs: dict[str, dict[str, Any]] = {}

    def add(key: str, label: str, kind: str, host: str, ids: list[str]) -> None:
        item = reqs.setdefault(key, {"key": key, "label": label, "kind": kind, "nodes": [], "ids": []})
        if host not in item["nodes"]:
            item["nodes"].append(host)
        for i in ids:
            if i not in item["ids"]:
                item["ids"].append(i)

    for host, svc in (compose.get("services") or {}).items():
        node = by_host.get(host)
        image = svc.get("image")
        if node is not None and is_windows_guest(node):
            base = _OS_TO_BASE[node.config.os.value]
            add(base, f"{WINDOWS_BASES[base][1]} base", "windows-base", host, [base, image or WINDOWS_IMAGE])
        elif image:
            add(image, image, "docker", host, [image])
    for host in artifacts.fallback_notes:
        add(f"vm:{host}", f"{host} needs a VM provider", "vagrant-box", host, [])
    return list(reqs.values())


def catalog() -> dict[str, Spec]:
    """Every image any bundled template needs, with who uses it."""
    return _cached("catalog", 300, _build_catalog)


def _build_catalog() -> dict[str, Spec]:
    specs: dict[str, Spec] = {}
    for template in list_templates():
        for req in topology_images(template):
            for image_id in req["ids"]:
                kind = "windows-base" if image_id in WINDOWS_BASES else "docker"
                name, tag = (WINDOWS_BASES[image_id][1] + " base", "dockurr/windows") if kind == "windows-base" else _split_ref(image_id)
                spec = specs.setdefault(image_id, Spec(image_id, kind, name, tag, custom=name.startswith("labforge/")))
                spec.used_by.add(template.id)
    return specs


# ------------------------------------------------------------------ state


def _docker_images() -> dict[str, dict[str, Any]]:
    proc = _docker(["image", "ls", "--no-trunc", "--format", "{{json .}}"], timeout=30)
    found: dict[str, dict[str, Any]] = {}
    if proc.returncode != 0:
        return found
    for line in proc.stdout.splitlines():
        try:
            row = json.loads(line)
        except ValueError:
            continue
        ref = f"{row.get('Repository')}:{row.get('Tag')}"
        found[ref] = row
        if row.get("Tag") == "latest":
            found[str(row.get("Repository"))] = row
    return found


def _parse_size_mb(text: str | None) -> float:
    if not text:
        return 0.0
    m = re.match(r"([\d.]+)\s*([kKMGT]?B)", text.strip())
    if not m:
        return 0.0
    mult = {"B": 1 / 1e6, "KB": 1 / 1e3, "MB": 1.0, "GB": 1e3, "TB": 1e6}[m.group(2).upper()]
    return float(m.group(1)) * mult


def _used_mb(volume: str) -> float | None:
    """Disk actually used by a volume. ``docker system df`` reports the apparent size, which is
    64 GB for a sparse Windows disk that uses 11 GB."""
    proc = _docker(["run", "--rm", "-v", f"{volume}:/s:ro", COPY_IMAGE, "du", "-sm", "/s"], timeout=120)
    if proc.returncode != 0:
        return None
    try:
        return float(proc.stdout.split()[0])
    except (ValueError, IndexError):
        return None


def _volumes() -> dict[str, dict[str, Any]]:
    """Labelled LabForge volumes (bases and golden images) with the space they really use."""
    out: dict[str, dict[str, Any]] = {}
    for label in (LABEL_GOLDEN, LABEL_BASE):
        proc = _docker(["volume", "ls", "--filter", f"label={label}=true", "--format", "{{json .}}"], timeout=30)
        if proc.returncode != 0:
            continue
        for line in proc.stdout.splitlines():
            try:
                row = json.loads(line)
            except ValueError:
                continue
            labels = dict(p.split("=", 1) for p in (row.get("Labels") or "").split(",") if "=" in p)
            name = row["Name"]
            used = _cached("used:" + name, 120, lambda name=name: _used_mb(name))
            out[name] = {"labels": labels, "size_mb": used or 0.0}
    return out


def _entry(spec_id: str, kind: str, name: str, tag: str | None, size_mb: float, status: str,
           used_by: list[str], updated: str | None = None, note: str | None = None) -> dict[str, Any]:
    job = _JOBS.get(spec_id)
    entry: dict[str, Any] = {
        "id": spec_id, "kind": kind, "name": name, "size_mb": round(size_mb),
        "status": status, "used_by": sorted(used_by),
    }
    if tag:
        entry["tag"] = tag
    if updated:
        entry["updated_at"] = updated
    if note:
        entry["note"] = note
    if job and job.status == "pulling":
        entry["status"] = "pulling"
        if job.progress is not None:
            entry["progress"] = job.progress
    elif job and job.status == "failed" and status != "ready":
        entry["note"] = f"Last attempt failed: {job.error}"
    return entry


def list_images() -> dict[str, Any]:
    local = _docker_images()
    volumes = _volumes()
    entries: list[dict[str, Any]] = []
    for spec in catalog().values():
        if spec.kind == "docker":
            row = local.get(spec.id)
            size = _parse_size_mb(row.get("Size")) if row else KNOWN_ESTIMATE_MB.get(spec.name, ESTIMATE_MB["docker"])
            note = "Built by LabForge on the first build." if spec.custom else None
            entries.append(_entry(spec.id, "docker", spec.name, spec.tag, size, "ready" if row else "missing",
                                  list(spec.used_by), row.get("CreatedAt") if row else None, note))
        else:
            vol = volumes.get(BASE_PREFIX + spec.id)
            entries.append(_entry(spec.id, "windows-base", spec.name, spec.tag,
                                  vol["size_mb"] if vol else ESTIMATE_MB["windows-base"],
                                  "ready" if vol else "missing", list(spec.used_by), None,
                                  "Downloaded from Microsoft on first boot, then kept in a local volume. Never shared."))
    for name, vol in volumes.items():
        if name.startswith(GOLDEN_PREFIX) and vol["labels"].get(LABEL_GOLDEN) == "true":
            entries.append(_entry("golden-" + name[len(GOLDEN_PREFIX):], "golden",
                                  vol["labels"].get("labforge.golden.name", name[len(GOLDEN_PREFIX):]),
                                  "golden", vol["size_mb"], "ready", [],
                                  vol["labels"].get("labforge.golden.created"),
                                  "Local only. Windows images must not be shared."))
    listed = {e["id"] for e in entries}
    for job in list(_JOBS.values()):
        # A golden image that is still being copied, or whose copy failed, has no volume yet. Show it
        # anyway so the person sees progress or the reason.
        if job.id.startswith("golden-") and job.id not in listed and job.status in ("pulling", "failed"):
            entries.append(_entry(job.id, "golden", job.id[len("golden-"):], "golden", 0,
                                  "missing", [], None, "Local only. Windows images must not be shared."))
    boxes = _vagrant_boxes()
    for tid_box, used in _box_requirements().items():
        have = boxes.get(tid_box)
        entries.append(_entry("box:" + tid_box, "vagrant-box", tid_box, None, 1500, "ready" if have else "missing",
                              list(used), None, None))
    total = sum(e["size_mb"] for e in entries if e["status"] != "missing")
    free = preflight.docker_disk().get("free_gb")
    return {"images": entries, "total_mb": total, "disk_free_gb": free}


# ------------------------------------------------------------------ vagrant boxes


def _vagrant_boxes() -> dict[str, str]:
    return _cached("boxes", 120, _read_vagrant_boxes)


def _read_vagrant_boxes() -> dict[str, str]:
    if not shutil.which("vagrant"):
        return {}
    try:
        proc = subprocess.run(["vagrant", "box", "list"], capture_output=True, text=True, errors="replace", timeout=30)
    except (OSError, subprocess.TimeoutExpired):
        return {}
    boxes: dict[str, str] = {}
    for line in proc.stdout.splitlines():
        m = re.match(r"^(\S+)\s+\((\w+),", line.strip())
        if m:
            boxes[m.group(1)] = m.group(2)
    return boxes


def _box_requirements() -> dict[str, set[str]]:
    from labforge_core.services.generator import BOX_MAP

    out: dict[str, set[str]] = {}
    for template in list_templates():
        if template.provider.value == "docker":
            continue
        for node in template.nodes:
            box = BOX_MAP.get(node.config.os.value)
            if box:
                out.setdefault(box if isinstance(box, str) else str(box), set()).add(template.id)
    return out


# ------------------------------------------------------------------ jobs


def _start(image_id: str, action: str, target) -> Job:
    with _LOCK:
        existing = _JOBS.get(image_id)
        if existing and existing.status == "pulling":
            return existing
        job = Job(image_id, action)
        _JOBS[image_id] = job

    def run() -> None:
        try:
            target(job)
            job.status = "done"
            job.progress = 100.0
        except Exception as exc:
            job.status = "failed"
            job.error = str(exc)[:300]

    threading.Thread(target=run, name=f"image-{action}-{image_id}", daemon=True).start()
    return job


def get_entry(image_id: str) -> dict[str, Any]:
    for entry in list_images()["images"]:
        if entry["id"] == image_id:
            return entry
    raise ImageError(f"Unknown image {image_id!r}.", "not_found", 404)


def pull(image_id: str) -> dict[str, Any]:
    if image_id in WINDOWS_BASES:
        _start(image_id, "prepare-base", lambda job: _prepare_base(job, image_id))
    elif image_id.startswith("box:"):
        box = image_id[4:]
        _start(image_id, "box", lambda job: _box_add(box))
    elif image_id.startswith("golden-"):
        raise ImageError("A golden image is made from a Windows machine, it cannot be downloaded.", "not_downloadable")
    else:
        spec = catalog().get(image_id)
        if spec is None:
            raise ImageError(f"Unknown image {image_id!r}.", "not_found", 404)
        if spec.custom:
            _start(image_id, "build", lambda job: _build_custom(job, spec))
        else:
            _start(image_id, "pull", lambda job: _pull_docker(job, image_id))
    return get_entry(image_id)


def _pull_docker(job: Job, ref: str) -> None:
    proc = subprocess.Popen(["docker", "pull", ref], stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                            text=True, encoding="utf-8", errors="replace")
    layers = done = 0
    assert proc.stdout is not None
    for line in proc.stdout:
        if "Pulling fs layer" in line:
            layers += 1
        elif "Pull complete" in line or "Already exists" in line:
            done += 1
        if layers:
            job.progress = min(99.0, 100.0 * done / layers)
    if proc.wait() != 0:
        raise ImageError(f"docker pull {ref} failed. Check the name and your internet connection.")


def _build_custom(job: Job, spec: Spec) -> None:
    template_id = sorted(spec.used_by)[0]
    template = get_template(template_id)
    files, _ = build_bundle(template, project="lf-prep")
    with tempfile.TemporaryDirectory(prefix="labforge-prep-") as tmp:
        root = Path(tmp)
        for rel, content in files.items():
            target = root / rel
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(content if isinstance(content, bytes) else content.encode())
        compose = yaml.safe_load((root / "docker-compose.yml").read_text(encoding="utf-8"))
        services = [n for n, s in compose["services"].items() if s.get("image") == spec.id and s.get("build")]
        if not services:
            raise ImageError(f"{spec.id} is not built by any service of {template_id}.")
        proc = docker_runtime._run(["docker", "compose", "-p", "lf-prep", "build", *services], cwd=root, timeout=1800)
        if proc.returncode != 0:
            raise ImageError("docker compose build failed: " + (proc.stderr or proc.stdout).strip()[-200:])


def _box_add(box: str) -> None:
    proc = subprocess.run(["vagrant", "box", "add", "--provider", "virtualbox", "--force", box],
                          capture_output=True, text=True, errors="replace", timeout=3600)
    if proc.returncode != 0:
        raise ImageError("vagrant box add failed: " + (proc.stderr or proc.stdout).strip()[-200:])


def guest_ip(container: str) -> str | None:
    """Address of the Windows guest behind a dockurr container (read from its NAT rule)."""
    proc = _docker(["exec", container, "sh", "-c", "iptables -t nat -S QEMU_DNAT 2>/dev/null | tail -1"], timeout=15)
    m = re.search(r"--to-destination (\d+\.\d+\.\d+\.\d+)", proc.stdout or "")
    return m.group(1) if m else None


def guest_rdp_ready(container: str) -> bool:
    ip = guest_ip(container)
    if not ip:
        return False
    proc = _docker(["exec", container, "bash", "-c", f"(echo > /dev/tcp/{ip}/3389) >/dev/null 2>&1"], timeout=15)
    return proc.returncode == 0


ISO_FILES = "*.iso windows.base windows.ver"


def _prepare_base(job: Job, image_id: str, timeout_s: float = 10800) -> None:
    """Download the Windows ISO into the base volume by starting a guest, then keep only the ISO."""
    version, _ = WINDOWS_BASES[image_id]
    volume = BASE_PREFIX + image_id
    container = "labforge-base-" + image_id
    if _docker(["volume", "inspect", volume]).returncode == 0:
        return
    _docker(["volume", "create", "--label", f"{LABEL_BASE}=true", "--label", f"labforge.base.os={image_id}", volume])
    _docker(["rm", "-f", container])
    run = _docker([
        "run", "-d", "--name", container, "--device", "/dev/kvm", "--cap-add", "NET_ADMIN",
        "--stop-timeout", "30", "--memory", "5g", "-v", f"{volume}:/storage",
        "-e", f"VERSION={version}", "-e", "RAM_SIZE=2G", "-e", "CPU_CORES=1", "-e", "DISK_SIZE=64G",
        "-e", "RAM_CHECK=N", "--label", "labforge.managed=true", WINDOWS_IMAGE,
    ], timeout=300)
    if run.returncode != 0:
        _docker(["volume", "rm", "-f", volume])
        raise ImageError("Could not start the Windows downloader: " + (run.stderr or run.stdout).strip()[-200:])
    deadline = time.time() + timeout_s
    try:
        while time.time() < deadline:
            time.sleep(10)
            if _docker(["inspect", container, "--format", "{{.State.Running}}"]).stdout.strip() != "true":
                logs = _docker(["logs", "--tail", "5", container]).stdout
                raise ImageError("The Windows downloader stopped: " + logs.strip()[-200:])
            logs = _docker(["logs", "--tail", "40", container]).stdout
            m = re.findall(r"(\d+)%", logs)
            if m:
                job.progress = min(95.0, float(m[-1]))
            if "Booting Windows" in logs or "Windows started successfully" in logs:
                break  # the ISO is complete once QEMU boots from it
        else:
            raise ImageError("The Windows download did not finish in time.")
    except Exception:
        _docker(["rm", "-f", container])
        _docker(["volume", "rm", "-f", volume])
        raise
    _docker(["rm", "-f", container], timeout=120)
    _trim_to_iso(volume)


def _trim_to_iso(volume: str) -> None:
    """Keep only the installer ISO (and its marker files) in a base volume."""
    proc = _docker([
        "run", "--rm", "-v", f"{volume}:/s", COPY_IMAGE, "sh", "-c",
        "cd /s && for f in *; do case $f in *.iso|windows.base|windows.ver) ;; *) rm -rf \"$f\";; esac; done; ls",
    ], timeout=300)
    if proc.returncode != 0 or ".iso" not in proc.stdout:
        _docker(["volume", "rm", "-f", volume])
        raise ImageError("The download did not leave an ISO behind.")


def adopt_base(source_volume: str, image_id: str) -> None:
    """Keep the ISO of an already booted guest's storage volume as the base for ``image_id``."""
    if image_id not in WINDOWS_BASES:
        raise ImageError("Unknown Windows base.", "not_found", 404)
    volume = BASE_PREFIX + image_id
    if _docker(["volume", "inspect", volume]).returncode == 0:
        raise ImageError("That base already exists.", "exists")
    _docker(["volume", "create", "--label", f"{LABEL_BASE}=true", "--label", f"labforge.base.os={image_id}", volume])
    proc = _docker(["run", "--rm", "-v", f"{source_volume}:/from:ro", "-v", f"{volume}:/to", COPY_IMAGE,
                    "sh", "-c", f"cd /from && cp -a --sparse=always {ISO_FILES} /to/"], timeout=3600)
    if proc.returncode != 0:
        _docker(["volume", "rm", "-f", volume])
        raise ImageError("Could not copy the ISO: " + (proc.stderr or proc.stdout).strip()[-200:])


# ------------------------------------------------------------------ remove


def remove(image_id: str) -> None:
    if image_id in WINDOWS_BASES:
        _remove_volume(BASE_PREFIX + image_id)
    elif image_id.startswith("golden-"):
        _remove_volume(GOLDEN_PREFIX + image_id[len("golden-"):])
    elif image_id.startswith("box:"):
        proc = subprocess.run(["vagrant", "box", "remove", "-f", image_id[4:]], capture_output=True, text=True, errors="replace", timeout=120)
        if proc.returncode != 0:
            raise ImageError(proc.stderr.strip()[-200:] or "vagrant box remove failed")
    else:
        proc = _docker(["image", "rm", image_id], timeout=120)
        if proc.returncode != 0:
            raise ImageError("Docker would not remove it, a lab is probably still using it: " + proc.stderr.strip()[-200:])


def _remove_volume(volume: str) -> None:
    proc = _docker(["volume", "rm", volume], timeout=120)
    if proc.returncode != 0:
        raise ImageError("The disk is in use by a running guest. Stop it first. " + proc.stderr.strip()[-160:])


# ------------------------------------------------------------------ golden images


def volume_for_source(source_id: str) -> tuple[str, str | None]:
    """``(volume, container_to_stop)`` for a base id or ``lab:<id>:<host>``."""
    if source_id in WINDOWS_BASES:
        volume = BASE_PREFIX + source_id
        if _docker(["volume", "inspect", volume]).returncode != 0:
            raise ImageError("That Windows base is not prepared yet.", "not_ready")
        return volume, None
    m = re.fullmatch(r"lab:(\d+):([a-z0-9-]+)", source_id)
    if not m:
        raise ImageError("source_id must be a Windows base id or lab:<lab id>:<machine>.", "bad_source", 422)
    return f"@lab:{m.group(1)}:{m.group(2)}", None


def create_golden(source_id: str, name: str, *, project_volume_lookup=None) -> dict[str, Any]:
    slug = _slug(name)
    target = GOLDEN_PREFIX + slug
    image_id = "golden-" + slug
    if _docker(["volume", "inspect", target]).returncode == 0:
        raise ImageError(f"A golden image named {slug!r} already exists.", "exists")
    source, _ = volume_for_source(source_id)
    container = None
    if source.startswith("@lab:"):
        if project_volume_lookup is None:
            raise ImageError("Lab sources need the API lab lookup.", "bad_source", 422)
        source, container = project_volume_lookup(source)

    def work(job: Job) -> None:
        was_running = False
        if container:
            was_running = _docker(["inspect", container, "--format", "{{.State.Running}}"]).stdout.strip() == "true"
            if was_running:
                _docker(["stop", "-t", "120", container], timeout=200)
        try:
            created = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
            _docker(["volume", "create", "--label", f"{LABEL_GOLDEN}=true", "--label", f"labforge.golden.name={slug}",
                     "--label", f"labforge.golden.created={created}", target])
            proc = _docker(["run", "--rm", "-v", f"{source}:/from:ro", "-v", f"{target}:/to", COPY_IMAGE,
                            "sh", "-c", "cp -a --sparse=always /from/. /to/"], timeout=7200)
            if proc.returncode != 0:
                _docker(["volume", "rm", "-f", target])
                raise ImageError("Copy failed: " + (proc.stderr or proc.stdout).strip()[-200:])
        finally:
            if container and was_running:
                _docker(["start", container], timeout=120)

    _start(image_id, "golden", work)
    return {"id": image_id, "kind": "golden", "name": slug, "size_mb": 0, "status": "pulling", "used_by": []}


def golden_volume(name: str) -> str:
    volume = GOLDEN_PREFIX + _slug(name)
    if _docker(["volume", "inspect", volume]).returncode != 0:
        raise ImageError(f"Golden image {name!r} does not exist on this computer.", "not_found", 404)
    return volume


# ------------------------------------------------------------------ prepare, export, import


def prepare(template_id: str) -> list[str]:
    template = get_template(template_id)
    local = _docker_images()
    volumes = _volumes()
    queued: list[str] = []
    for req in topology_images(template):
        for image_id in req["ids"]:
            if image_id in WINDOWS_BASES:
                if BASE_PREFIX + image_id in volumes:
                    continue
            elif image_id in local:
                continue
            pull(image_id)
            queued.append(image_id)
    return queued


def requirements(topology: LabConfig) -> list[dict[str, Any]]:
    """Requirements of a topology with their readiness, for the Launch dialog."""
    status = {e["id"]: e for e in list_images()["images"]}
    out = []
    for req in topology_images(topology):
        entries = [status.get(i) for i in req["ids"] if i in status]
        if req["kind"] == "vagrant-box":
            state = "missing"
        elif entries and all(e["status"] == "ready" for e in entries):
            state = "ready"
        elif any(e and e["status"] == "pulling" for e in entries):
            state = "pulling"
        else:
            state = "missing"
        out.append({**req, "status": state, "size_mb": sum(e["size_mb"] for e in entries if e["status"] != "ready")})
    return out


def export_stream(image_id: str) -> tuple[str, Iterator[bytes]]:
    """``(filename, byte iterator)`` for a local archive. Docker images use docker save, disks use tar."""
    if image_id in WINDOWS_BASES or image_id.startswith("golden-"):
        volume = BASE_PREFIX + image_id if image_id in WINDOWS_BASES else GOLDEN_PREFIX + image_id[len("golden-"):]
        if _docker(["volume", "inspect", volume]).returncode != 0:
            raise ImageError("That image is not on this computer.", "not_found", 404)
        cmd = ["docker", "run", "--rm", "-v", f"{volume}:/src:ro", COPY_IMAGE, "tar", "-S", "-C", "/src", "-cf", "-", "."]
        return f"{volume}.tar", _stream(cmd)
    if image_id.startswith("box:"):
        raise ImageError("Vagrant boxes are exported with `vagrant box repackage`.", "not_supported")
    if image_id not in _docker_images():
        raise ImageError("That image is not on this computer.", "not_found", 404)
    safe = re.sub(r"[^A-Za-z0-9_.-]+", "_", image_id)
    return f"{safe}.tar", _stream(["docker", "save", image_id])


def _stream(cmd: list[str]) -> Iterator[bytes]:
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    assert proc.stdout is not None
    try:
        while chunk := proc.stdout.read(1 << 20):
            yield chunk
    finally:
        proc.stdout.close()
        proc.wait()


def import_archive(kind: str, name: str, source: Iterator[bytes]) -> dict[str, Any]:
    """Load a local archive. ``kind`` is ``docker`` or ``golden``."""
    if kind == "docker":
        proc = subprocess.Popen(["docker", "load"], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    elif kind == "golden":
        slug = _slug(name)
        volume = GOLDEN_PREFIX + slug
        if _docker(["volume", "inspect", volume]).returncode == 0:
            raise ImageError(f"A golden image named {slug!r} already exists.", "exists")
        created = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        _docker(["volume", "create", "--label", f"{LABEL_GOLDEN}=true", "--label", f"labforge.golden.name={slug}",
                 "--label", f"labforge.golden.created={created}", volume])
        proc = subprocess.Popen(["docker", "run", "--rm", "-i", "-v", f"{volume}:/dst", COPY_IMAGE, "tar", "-C", "/dst", "-xf", "-"],
                                stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    else:
        raise ImageError("kind must be docker or golden.", "bad_kind", 422)
    assert proc.stdin is not None and proc.stdout is not None
    try:
        for chunk in source:
            proc.stdin.write(chunk)
    finally:
        proc.stdin.close()
    out = proc.stdout.read().decode(errors="replace")
    if proc.wait() != 0:
        if kind == "golden":
            _docker(["volume", "rm", "-f", volume])
        raise ImageError("Import failed: " + out.strip()[-200:])
    return {"imported": kind, "output": out.strip()[-300:]}


# ------------------------------------------------------------------ labs seeded from a golden image


def seed_volume(project: str, host: str, golden: str) -> str:
    """Create ``<project>_<host>-storage`` as a copy of a golden image, labelled so Compose owns it."""
    source = golden_volume(golden)
    volume = f"{project}_{host}-storage"
    if _docker(["volume", "inspect", volume]).returncode == 0:
        return volume
    _docker(["volume", "create", "--label", f"com.docker.compose.project={project}",
             "--label", f"com.docker.compose.volume={host}-storage", volume])
    proc = _docker(["run", "--rm", "-v", f"{source}:/from:ro", "-v", f"{volume}:/to", COPY_IMAGE,
                    "sh", "-c", "cp -a --sparse=always /from/. /to/"], timeout=7200)
    if proc.returncode != 0:
        _docker(["volume", "rm", "-f", volume])
        raise ImageError("Could not copy the golden image: " + (proc.stderr or proc.stdout).strip()[-200:])
    return volume


def seed_base_volume(project: str, host: str, base_id: str) -> str:
    """Create ``<project>_<host>-storage`` holding only the downloaded ISO, so setup skips the download."""
    source = BASE_PREFIX + base_id
    if _docker(["volume", "inspect", source]).returncode != 0:
        raise ImageError(f"The {base_id} base is not prepared.", "not_ready")
    volume = f"{project}_{host}-storage"
    if _docker(["volume", "inspect", volume]).returncode == 0:
        return volume
    _docker(["volume", "create", "--label", f"com.docker.compose.project={project}",
             "--label", f"com.docker.compose.volume={host}-storage", volume])
    proc = _docker(["run", "--rm", "-v", f"{source}:/from:ro", "-v", f"{volume}:/to", COPY_IMAGE,
                    "sh", "-c", f"cd /from && cp -a --sparse=always {ISO_FILES} /to/"], timeout=3600)
    if proc.returncode != 0:
        _docker(["volume", "rm", "-f", volume])
        raise ImageError("Could not copy the ISO: " + (proc.stderr or proc.stdout).strip()[-200:])
    return volume


def base_seeds(topology: LabConfig, project: str, existing: list[dict[str, str]]) -> list[dict[str, str]]:
    """Seeds for Windows nodes that have no golden image but whose Windows base is already downloaded."""
    taken = {seed["host"] for seed in existing}
    wanted = [(n.config.hostname, _OS_TO_BASE[n.config.os.value]) for n in topology.nodes
              if is_windows_guest(n) and n.config.hostname not in taken]
    if not wanted:
        return []
    have = {b for b in {base for _, base in wanted} if _docker(["volume", "inspect", BASE_PREFIX + b]).returncode == 0}
    return [{"host": host, "base": base, "project": project} for host, base in wanted if base in have]

