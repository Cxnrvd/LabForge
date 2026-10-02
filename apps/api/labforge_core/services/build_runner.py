"""In-app Build Lab runner.

The web Build button POSTs the canvas topology here. We:
  1. Create the Lab row first, so the lab id (not its name) keys everything
     that follows: workspace directory, Compose project, process sentinels.
  2. Generate the bundle straight to disk (no zip round-trip): a Vagrantfile
     for the VM providers, a docker-compose project for ``provider: docker``.
  3. Spawn ``vagrant up`` / ``docker compose up --wait`` as a detached
     subprocess writing combined stdout+stderr to ``<workspace>/build.log``.
     A sentinel file ``.build.exit`` carries the eventual exit code.
  4. Spawn the heartbeat daemon so the dashboard sees per-VM / per-container
     state once things come up.

The runner returns immediately. The /labs/{id}/build/log endpoint tails
the log; the /labs/{id}/build/status endpoint reads the sentinel.

Lifecycle rules
---------------
* A workspace belongs to exactly one lab row and is never reused, so a second
  Build can no longer wipe the directory a running build is still using.
* Building a topology whose name matches a live lab is refused (``LabExistsError``)
  unless the caller asks to ``replace`` it, which performs a real teardown first.
* ``destroy_lab`` removes the VMs/containers first, verifies they are gone, and
  only then deletes the workspace. If teardown fails the lab is kept so the user
  can see it and retry.
"""

from __future__ import annotations

import contextlib
import json
import logging
import os
import re
import shutil
import signal
import subprocess
import sys
import tempfile
import threading
import time
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

from labforge_schema import LabConfig, Provider
from sqlmodel import Session, select

from labforge_core.models import Lab
from labforge_core.services import boxes, docker_runtime, hostenv, preflight
from labforge_core.services.compose_generator import (
    build_bundle,
    has_windows_guests,
    host_port_free,
    project_name,
)
from labforge_core.services.generator import BOX_MAP, generate_artifacts, vagrant_provider_name
from labforge_core.settings import get_settings

BUILD_LOG = "build.log"
BUILD_EXIT = ".build.exit"
BUILD_PID = ".build.pid"
BUILD_ABORTED = ".build.aborted"
DAEMON_PID = ".labforge-daemon.pid"

# Lab statuses that mean "something may be running or still starting".
ACTIVE_STATUSES = ("building", "running", "partial")

_LOGGER = logging.getLogger("labforge.build_runner")

# Serialises "is there already a live lab with this name? -> create the row".
# The API runs as one process, so a process-local lock is enough.
_CREATE_LOCK = threading.Lock()
_LAB_LOCKS: dict[int, threading.Lock] = {}
_LAB_LOCKS_GUARD = threading.Lock()


def _lab_lock(lab_id: int) -> threading.Lock:
    with _LAB_LOCKS_GUARD:
        return _LAB_LOCKS.setdefault(lab_id, threading.Lock())


class BuildPrereqError(RuntimeError):
    """Vagrant/Docker isn't installed, not running, wrong version, etc."""

    def __init__(self, message: str, code: str = "vagrant_missing") -> None:
        super().__init__(message)
        self.code = code


class LabExistsError(RuntimeError):
    """A live lab already exists for this topology name."""

    def __init__(self, lab_ids: list[int], name: str) -> None:
        super().__init__(
            f"A lab named '{name}' already exists (id {', '.join(map(str, lab_ids))}). "
            "Destroy it first, or build with replace to tear it down and start over."
        )
        self.lab_ids = lab_ids


class SubnetConflictError(RuntimeError):
    """The lab network overlaps one that already exists on the Docker host."""


class HaltFailed(RuntimeError):
    """Stopping or resuming a lab failed; the message says why."""


class DestroyFailed(RuntimeError):
    """Teardown could not be verified; the lab was left in place."""


def _utcnow() -> datetime:
    """Naive UTC now (what the DB and sentinel files already use), without the deprecated call."""
    return datetime.now(UTC).replace(tzinfo=None)


def _slug(name: str) -> str:
    return re.sub(r"[^a-z0-9-]+", "-", name.lower()).strip("-") or "lab"


def vagrant_available() -> bool:
    return shutil.which("vagrant") is not None


def runtime_of(workspace: Path) -> str:
    """``"docker"`` or ``"vagrant"``, decided by what is in the workspace."""
    return "docker" if docker_runtime.is_docker_workspace(workspace) else "vagrant"


def _write_artifacts(
    topology: LabConfig, workspace: Path, box_overrides: dict | None = None
) -> None:
    artifacts = generate_artifacts(topology, box_overrides=box_overrides)
    workspace.mkdir(parents=True, exist_ok=True)
    # LF endings everywhere: these scripts run inside Linux guests, where a
    # CRLF shebang fails with "bad interpreter", even if the API runs on Windows.
    hostenv.write_guest_file(workspace / "Vagrantfile", artifacts.vagrantfile)
    provision_dir = workspace / "provision"
    provision_dir.mkdir(exist_ok=True)
    for filename, body in artifacts.provisioner_scripts.items():
        hostenv.write_guest_file(provision_dir / filename, body)
    if artifacts.hosts_file:
        hostenv.write_guest_file(workspace / "hosts", artifacts.hosts_file)
    if artifacts.readme:
        hostenv.write_guest_file(workspace / "README.md", artifacts.readme)
    hostenv.write_guest_file(workspace / "topology.json", topology.model_dump_json(indent=2))


def _write_docker_bundle(
    topology: LabConfig, workspace: Path, *, project: str, publish: str
) -> list[str]:
    """Write the compose project; returns the generator's warnings."""
    files, artifacts = build_bundle(topology, publish=publish, project=project, port_free=host_port_free)
    workspace.mkdir(parents=True, exist_ok=True)
    for rel, content in files.items():
        target = workspace / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        hostenv.write_guest_file(target, content, rel)
    return artifacts.warnings


def _shim_dir() -> Path:
    """Where to drop the throwaway build-shim script.

    We deliberately put this outside the workspace so the workspace stays
    a clean artifact dir (no `_build_shim.py` litter once the build is
    over) and so the shim can survive workspace recreation.
    """
    d = Path(tempfile.gettempdir()) / "labforge-shims"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _spawn_build(workspace: Path, argv: list[str], *, banner: str, env_extra: dict[str, str] | None = None) -> int:
    """Detach ``argv`` (``vagrant up ...`` / ``docker compose up ...``).

    The shim runs the command, captures its exit code, and writes the
    ``.build.exit`` sentinel however the command ends. Output goes to
    ``build.log``.
    """
    log_path = workspace / BUILD_LOG
    log_path.write_text(
        f"--- build start {_utcnow().isoformat()} ---\n{banner}\n",
        encoding="utf-8",
    )
    fh = log_path.open("a", encoding="utf-8", buffering=1)  # line-buffered

    # On POSIX `start_new_session=True` detaches. On Windows use a new process
    # group plus a hidden console (CREATE_NO_WINDOW): unlike DETACHED_PROCESS,
    # the console children (vagrant, VBoxManage, docker) then inherit it instead
    # of each opening a visible window.
    creationflags = 0
    if hostenv.is_windows():
        creationflags = subprocess.CREATE_NEW_PROCESS_GROUP | 0x08000000  # type: ignore[attr-defined]

    shim_name = f"build_shim_{_slug(workspace.name)}_{int(time.time())}.py"
    shim = _shim_dir() / shim_name
    shim.write_text(_BUILD_SHIM, encoding="utf-8")

    env = {**os.environ, **(env_extra or {})}

    proc = subprocess.Popen(
        [sys.executable, str(shim), str(workspace), json.dumps(argv)],
        cwd=str(workspace),
        stdout=fh,
        stderr=subprocess.STDOUT,
        stdin=subprocess.DEVNULL,
        start_new_session=not hostenv.is_windows(),
        creationflags=creationflags,
        env=env,
    )
    (workspace / BUILD_PID).write_text(str(proc.pid), encoding="utf-8")
    return proc.pid


# Shim that runs the build command, captures the exit code, and writes the
# sentinel file regardless of how the command terminates. Lives in a temp dir
# so the workspace stays free of build scaffolding.
_BUILD_SHIM = '''import json, os, re, subprocess, sys, time
ws = sys.argv[1]
argv = json.loads(sys.argv[2])
exit_path = os.path.join(ws, ".build.exit")
# docker pull prints one progress line per layer every few hundred ms, which buries the
# useful lines in tens of KB of noise. Keep one of them every 10 seconds.
progress = re.compile(r"^[ \t]*[0-9a-f]{12}[ \t]+(Downloading|Extracting|Pulling fs layer|Waiting|Download complete|Verifying Checksum)")
try:
    proc = subprocess.Popen(argv, cwd=ws, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                            text=True, encoding="utf-8", errors="replace", bufsize=1)
    last = 0.0
    for line in proc.stdout:
        if progress.match(line):
            now = time.time()
            if now - last < 10:
                continue
            last = now
        sys.stdout.write(line)
        sys.stdout.flush()
    rc = proc.wait()
except FileNotFoundError:
    rc = 127
except Exception as exc:
    print(f"[build-shim] {exc}", file=sys.stdout, flush=True)
    rc = 1
with open(exit_path, "w", encoding="utf-8") as fh:
    fh.write(f"{rc}\\n{int(time.time())}\\n")
'''


def _spawn_daemon(lab: Lab, workspace: Path) -> None:
    """Heartbeat daemon, best effort: the build proceeds without it."""
    try:
        from labforge_agent import daemon as _daemon

        _daemon.spawn_detached(
            lab_id=lab.id or 0,
            workspace=workspace,
            api_base=f"http://127.0.0.1:{os.environ.get('LABFORGE_API_PORT', '8000')}",
            api_token=get_settings().agent_token,
        )
    except Exception:
        _LOGGER.warning("heartbeat_daemon_spawn_failed", exc_info=True)


def _live_labs_named(session: Session, slug: str) -> list[Lab]:
    rows = session.exec(select(Lab).where(Lab.topology_slug == slug)).all()
    # A stopped lab still owns its network, volumes and subnet.
    return [row for row in rows if row.status in (*ACTIVE_STATUSES, "stopped")]


@dataclass
class BuildResult:
    lab: Lab
    workspace: Path
    warnings: list[str]


def start_build(
    topology: LabConfig,
    session: Session,
    workspace_root: Path | None = None,
    *,
    replace: bool = False,
    publish: str = "loopback",
) -> tuple[Lab, Path]:
    """Create the lab, write its bundle and start the build.

    Returns the persisted Lab and its workspace. Raises:

    * ``BuildPrereqError`` if Vagrant / Docker is unavailable,
    * ``LabExistsError`` if a live lab with this name exists and ``replace`` is false,
    * ``SubnetConflictError`` if a docker lab's network overlaps an existing one,
    * ``DestroyFailed`` if ``replace`` could not tear the old lab down.
    """
    result = start_build_detailed(
        topology, session, workspace_root, replace=replace, publish=publish
    )
    return result.lab, result.workspace


def start_build_detailed(
    topology: LabConfig,
    session: Session,
    workspace_root: Path | None = None,
    *,
    replace: bool = False,
    publish: str = "loopback",
) -> BuildResult:
    use_docker = topology.provider is Provider.DOCKER
    if use_docker:
        problem = docker_runtime.prereq_problem() or preflight.blocking_problem(topology)
        if problem:
            raise BuildPrereqError(problem[1], problem[0])
    else:
        vm_problem = hostenv.provider_problem(topology.provider)
        if vm_problem:
            raise BuildPrereqError(vm_problem[1], vm_problem[0])

    settings = get_settings()
    root = workspace_root or settings.workspace_root
    slug = _slug(topology.name)

    if replace:
        # Real teardown of every lab built from this topology name, outside
        # the create lock because it can take a while.
        for old in session.exec(select(Lab).where(Lab.topology_slug == slug)).all():
            destroy_lab(old, session)

    with _CREATE_LOCK:
        live = _live_labs_named(session, slug)
        if live:
            raise LabExistsError([lab.id or 0 for lab in live], topology.name)
        lab = Lab(
            topology_slug=slug,
            name=topology.name,
            provider=topology.provider.value,
            status="building",
            workspace_path=None,
            created_at=_utcnow(),
            updated_at=_utcnow(),
        )
        session.add(lab)
        session.commit()
        session.refresh(lab)
        # Immutable workspace key: the lab id. The name only decorates it.
        workspace = root / f"{slug}-{lab.id}"
        lab.workspace_path = str(workspace)
        session.add(lab)
        session.commit()

    warnings: list[str] = []
    try:
        project = project_name(f"lf{lab.id}-{slug}")
        if use_docker:
            conflicts = docker_runtime.subnet_conflicts(topology.network_cidr, own_project=project)
            if conflicts:
                raise SubnetConflictError(
                    f"The lab network {topology.network_cidr} overlaps "
                    + "; ".join(conflicts)
                    + ". Change the network CIDR or destroy the other lab."
                )
            warnings = _write_docker_bundle(topology, workspace, project=project, publish=publish)
            # A Windows guest downloads and installs Windows on its first start.
            wait = 5400 if has_windows_guests(topology) else 900
            argv = docker_runtime.up_command(project, wait_timeout=wait, workspace=workspace)
            banner = f"--- runtime=docker project={project} ---"
            env_extra = None
        else:
            provider = vagrant_provider_name(topology.provider)
            try:
                resolved = boxes.resolve_boxes(topology, provider, BOX_MAP)
            except boxes.BoxUnavailable as exc:
                raise BuildPrereqError(str(exc), "box_unavailable") from exc
            warnings = [
                *resolved.warnings,
                *hostenv.provider_warnings(topology.provider),
                *hostenv.resource_warnings(topology, root),
            ]
            clash = hostenv.host_ip_conflicts(topology.network_cidr)
            if clash:
                warnings.append(
                    f"This computer already has address(es) {', '.join(clash)} inside the lab network "
                    f"{topology.network_cidr}. Pick a different network CIDR if VMs are unreachable."
                )
            _write_artifacts(topology, workspace, resolved.overrides)
            argv = ["vagrant", "up", "--provider", provider]
            banner = f"--- runtime=vagrant provider={provider} ---"
            env_extra = {"VAGRANT_DEFAULT_PROVIDER": provider}
        for warning in warnings:
            _LOGGER.info("compose_warning lab=%s %s", lab.id, warning)
        pid = _spawn_build(workspace, argv, banner=banner, env_extra=env_extra)
        if warnings:
            with (workspace / BUILD_LOG).open("a", encoding="utf-8") as fh:
                fh.writelines(f"[labforge] warning: {w}\n" for w in warnings)
    except Exception:
        # Never leave a half-created lab behind: drop the row and any files.
        session.delete(lab)
        session.commit()
        shutil.rmtree(workspace, ignore_errors=True)
        raise

    _spawn_daemon(lab, workspace)
    print(f"[build_runner] {banner} pid={pid} workspace={workspace}", flush=True)
    return BuildResult(lab=lab, workspace=workspace, warnings=warnings)


# ------------------------------------------------------------------ destroy


def _stop_daemon(workspace: Path) -> None:
    with contextlib.suppress(Exception):
        from labforge_agent import daemon as _daemon

        _daemon.request_stop(workspace)
    pid_file = workspace / DAEMON_PID
    if pid_file.exists():
        with contextlib.suppress(ValueError, OSError):
            pid = int(pid_file.read_text().strip())
            if pid > 0 and is_pid_alive(pid):
                os.kill(pid, signal.SIGTERM)


def _vagrant_teardown(workspace: Path) -> str | None:
    """Return an error string, or ``None`` on success."""
    if not vagrant_available():
        return "vagrant is not on PATH, so the VMs cannot be destroyed"
    try:
        proc = subprocess.run(
            ["vagrant", "destroy", "-f"],
            cwd=str(workspace),
            capture_output=True,
            text=True, errors="replace",
            timeout=600,
            check=False,
        )
    except subprocess.TimeoutExpired:
        return "vagrant destroy timed out after 10 minutes"
    except OSError as exc:
        return f"could not run vagrant: {exc}"
    if proc.returncode != 0:
        tail = (proc.stderr or proc.stdout).strip().splitlines()[-3:]
        return f"vagrant destroy exited {proc.returncode}: {' | '.join(tail)}"
    return None


def destroy_lab(lab: Lab, session: Session, *, force: bool = False) -> None:
    """Tear down a lab for real, then delete its workspace and row.

    The VMs / containers are removed first and verified gone. If that fails and
    ``force`` is false, ``DestroyFailed`` is raised and nothing else is deleted,
    so the lab stays visible and can be retried. ``force`` removes the record
    even when teardown failed (for orphans whose infrastructure is already gone).
    """
    lab_id = lab.id or 0
    with _lab_lock(lab_id):
        workspace = Path(lab.workspace_path) if lab.workspace_path else None
        if workspace is not None and workspace.exists():
            if read_build_status(workspace)["phase"] == "running":
                stop_build(workspace, halt_containers=False)
            _stop_daemon(workspace)
            if runtime_of(workspace) == "docker":
                result = docker_runtime.teardown(workspace)
                error = None if result.ok else (result.error or "teardown failed")
            else:
                error = _vagrant_teardown(workspace)
            if error and not force:
                lab.status = "destroy_failed"
                lab.updated_at = _utcnow()
                session.add(lab)
                session.commit()
                raise DestroyFailed(error)
            shutil.rmtree(workspace, ignore_errors=True)
        session.delete(lab)
        session.commit()
    with _LAB_LOCKS_GUARD:
        _LAB_LOCKS.pop(lab_id, None)


def halt_lab(lab: Lab, session: Session) -> None:
    """Stop a Docker lab's containers and keep its data. ``resume_lab`` brings it back."""
    lab_id = lab.id or 0
    with _lab_lock(lab_id):
        workspace = Path(lab.workspace_path) if lab.workspace_path else None
        if workspace is None or not workspace.exists():
            raise HaltFailed("The lab workspace is gone, so there is nothing to stop. Destroy the lab instead.")
        if runtime_of(workspace) != "docker":
            raise HaltFailed("Stop and resume are available for Docker labs only.")
        if read_build_status(workspace)["phase"] == "running":
            stop_build(workspace)
        _stop_daemon(workspace)
        result = docker_runtime.halt(workspace)
        if not result.ok:
            raise HaltFailed(result.error or "docker compose stop failed")
        lab.status = "stopped"
        lab.updated_at = _utcnow()
        session.add(lab)
        session.commit()


def resume_lab(lab: Lab, session: Session) -> int:
    """Start a stopped Docker lab again with ``compose up``. Returns the build pid."""
    lab_id = lab.id or 0
    with _lab_lock(lab_id):
        workspace = Path(lab.workspace_path) if lab.workspace_path else None
        if workspace is None or not (workspace / docker_runtime.COMPOSE_FILE).exists():
            raise HaltFailed("The lab workspace is gone. Build the lab again.")
        if runtime_of(workspace) != "docker":
            raise HaltFailed("Stop and resume are available for Docker labs only.")
        if lab.status not in ("stopped", "failed", "partial"):
            raise HaltFailed(f"The lab is {lab.status}, only a stopped lab can be started.")
        problem = docker_runtime.prereq_problem()
        if problem:
            raise BuildPrereqError(problem[1], problem[0])
        project = docker_runtime.read_project(workspace)
        if not project:
            raise HaltFailed("The lab has no .labforge-project file, build it again.")
        for sentinel in (BUILD_EXIT, BUILD_ABORTED, BUILD_PID, ".labforge-daemon-stop"):
            (workspace / sentinel).unlink(missing_ok=True)
        topology = json.loads((workspace / "topology.json").read_text(encoding="utf-8"))
        wait = 5400 if any(str(n.get("config", {}).get("os", "")).startswith("windows") for n in topology.get("nodes", [])) else 900
        pid = _spawn_build(
            workspace,
            docker_runtime.up_command(project, wait_timeout=wait),
            banner=f"--- resume runtime=docker project={project} ---",
        )
        lab.status = "building"
        lab.updated_at = _utcnow()
        session.add(lab)
        session.commit()
    _spawn_daemon(lab, workspace)
    return pid


def read_log_chunk(workspace: Path, since: int = 0, max_bytes: int = 64 * 1024) -> dict:
    """Tail-style read of build.log from byte offset ``since``.

    Returns ``{lines: [...], next_offset: N, bytes_total: M}``.
    """
    path = workspace / BUILD_LOG
    if not path.exists():
        return {"lines": [], "next_offset": since, "bytes_total": 0}
    size = path.stat().st_size
    if since > size:
        # Log was rotated/truncated; rewind.
        since = 0
    with path.open("rb") as fh:
        fh.seek(since)
        chunk = fh.read(max_bytes)
    text = chunk.decode("utf-8", errors="replace")
    # Hold back any incomplete trailing line so the next poll picks it up
    # whole.
    if not text.endswith("\n"):
        last_nl = text.rfind("\n")
        if last_nl >= 0:
            text[last_nl + 1 :]
            text = text[: last_nl + 1]
            chunk_consumed = len(text.encode("utf-8"))
        else:
            chunk_consumed = 0
    else:
        chunk_consumed = len(chunk)
    lines = [ln for ln in text.split("\n") if ln]
    return {
        "lines": lines,
        "next_offset": since + chunk_consumed,
        "bytes_total": size,
    }


def _provider_vms_running(workspace: Path) -> int:
    """Cheap, per-provider probe: how many of this workspace's VMs are up?

    Each Vagrant-managed VM stamps its hypervisor UUID into
    ``.vagrant/machines/<name>/<provider>/id`` when it's first created.
    We collect those UUIDs and cross-reference against the hypervisor's
    running-VM list — UUID match is provider-canonical and survives
    every renaming convention (the human-readable VM name embeds the
    topology label which we can't reverse-engineer from the workspace
    slug).

    Returns the count of VMs whose hypervisor process can still be
    observed. Returns -1 when we can't probe at all (no .vagrant dir,
    no provider CLI on PATH) — callers treat that as "unknown" and do
    NOT promote a failure to partial in that case.
    """
    machines_dir = workspace / ".vagrant" / "machines"
    if not machines_dir.exists():
        return -1

    # Collect (machine_name, provider, uuid) tuples for every VM
    # Vagrant has created. We use the directory layout instead of
    # parsing state files because the layout is documented and
    # stable across Vagrant 2.2 → 2.4.
    expected: list[tuple[str, str, str]] = []
    try:
        for machine_dir in machines_dir.iterdir():
            if not machine_dir.is_dir():
                continue
            machine = machine_dir.name
            for provider_dir in machine_dir.iterdir():
                if not provider_dir.is_dir():
                    continue
                id_file = provider_dir / "id"
                if not id_file.exists():
                    continue
                try:
                    uuid = id_file.read_text(encoding="utf-8").strip()
                except OSError:
                    continue
                if uuid:
                    expected.append((machine, provider_dir.name, uuid))
    except OSError:
        return -1
    if not expected:
        return -1

    # We only check VirtualBox + VMware because they're the two
    # providers LabForge supports today. libvirt would require
    # virsh + a session bus; bail to -1 in that case so the caller
    # doesn't make a decision on stale data.
    providers = {p for _, p, _ in expected}
    if "virtualbox" not in providers:
        return -1

    try:
        out = subprocess.run(
            [*_vboxmanage_command(), "list", "runningvms"],
            capture_output=True,
            text=True, errors="replace",
            timeout=5,
            check=False,
        )
        running_blob = out.stdout or ""
    except (OSError, subprocess.TimeoutExpired):
        return -1

    # Each line looks like:  "labforge-foo-kali" {2644078d-...}
    # We just look for the UUIDs Vagrant stamped — name renaming
    # cannot fool the match.
    alive = sum(
        1 for _machine, provider, uuid in expected
        if provider == "virtualbox" and uuid in running_blob
    )
    return alive


def _vboxmanage_command() -> list[str]:
    return hostenv.vboxmanage_command()


def read_build_status(workspace: Path) -> dict:
    """Resolve build state from sentinel files.

    Normally the ``.build.exit`` exit code is authoritative — zero means
    succeeded, anything else failed, plus the ``.build.aborted`` flag
    overrides to ``aborted``. The one tricky case the original logic got
    wrong: ``vagrant up`` can exit non-zero (e.g. SSH timeout on the last
    VM) WHILE earlier VMs in the multi-machine config are healthy and
    SSH-reachable. We now poll the hypervisor's running-VM list and, when
    at least one of this workspace's VMs is alive, downgrade ``failed``
    to ``partial`` so the dashboard reflects what the user can actually
    see in VirtualBox / VMware.
    """
    pid_file = workspace / BUILD_PID
    exit_file = workspace / BUILD_EXIT
    aborted_file = workspace / BUILD_ABORTED
    if exit_file.exists():
        body = exit_file.read_text(encoding="utf-8").strip().splitlines()
        try:
            exit_code = int(body[0])
        except (IndexError, ValueError):
            exit_code = -1
        finished_at = body[1] if len(body) > 1 else None
        if aborted_file.exists():
            phase = "aborted"
        elif exit_code == 0:
            phase = "succeeded"
        else:
            # Build exited non-zero. Check if any VM is still alive in
            # the hypervisor — if so this is a partial success rather
            # than a hard failure.
            if runtime_of(workspace) == "docker":
                alive = docker_runtime.running_count(workspace)
            else:
                alive = _provider_vms_running(workspace)
            phase = "partial" if alive > 0 else "failed"
        return {
            "phase": phase,
            "exit_code": exit_code,
            "finished_at": finished_at,
            "pid": int(pid_file.read_text().strip()) if pid_file.exists() else None,
        }
    if pid_file.exists():
        return {
            "phase": "running",
            "exit_code": None,
            "finished_at": None,
            "pid": int(pid_file.read_text().strip()),
        }
    return {"phase": "unknown", "exit_code": None, "finished_at": None, "pid": None}


# Phase parsing — every Vagrant log line prefixed `==> hostname:` is
# enough to drive a coarse 5-step stepper. The patterns below match the
# observed text of `vagrant up` for both the virtualbox and the
# vmware_desktop providers. Order matters: later matches override earlier
# ones because a VM that has reached "Running provisioner" has already
# passed the boot/network steps even if those markers are also present.
_VM_LINE_RE = re.compile(r"==>\s+([A-Za-z0-9][A-Za-z0-9._-]*):\s+(.*)$")
_PHASE_MARKERS: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("downloading", re.compile(r"^(Downloading:|Box Provider:|Adding box)")),
    ("importing", re.compile(r"^(Importing base box|Cloning VMware VM)")),
    ("booting", re.compile(r"^(Booting VM|Waiting for the VM to receive an address|Starting the VMware VM)")),
    ("network", re.compile(r"^(Setting hostname|Configuring (?:and enabling )?network|Preparing network adapters|Forwarding ports)")),
    ("provisioning", re.compile(r"^Running provisioner")),
    ("ready", re.compile(r"^Machine booted and ready!|LabForge provisioner complete")),
)
_PHASE_ORDER: tuple[str, ...] = (
    "defined",
    "downloading",
    "importing",
    "booting",
    "network",
    "provisioning",
    "ready",
)
_PHASE_RANK = {p: i for i, p in enumerate(_PHASE_ORDER)}


_DOCKER_CONTAINER_RE = re.compile(r"^\s*Container\s+(\S+)\s+(\w+)\s*$")
_DOCKER_IMAGE_RE = re.compile(r"^\s*(?:Image\s+)?(\S+)\s+(Pulling|Pulled|Building|Built)\s*$")
_DOCKER_BUILD_STEP_RE = re.compile(r"^#\d+\s+\[([A-Za-z0-9._-]+)\s")
_DOCKER_ACTION_PHASE = {
    "pulling": "downloading",
    "pulled": "importing",
    "building": "importing",
    "built": "importing",
    "creating": "booting",
    "created": "booting",
    "starting": "booting",
    "started": "booting",
    "waiting": "provisioning",
    "healthy": "ready",
    "running": "ready",
    "error": "failed",
    "exited": "failed",
}


def _compose_services(workspace: Path) -> list[str]:
    try:
        import yaml

        doc = yaml.safe_load((workspace / docker_runtime.COMPOSE_FILE).read_text(encoding="utf-8"))
        return list((doc or {}).get("services", {}).keys())
    except Exception:
        return []


def _parse_docker_phases(workspace: Path) -> dict[str, str]:
    """Per-service phase from ``docker compose up --progress plain`` output."""
    path = workspace / BUILD_LOG
    if not path.exists():
        return {}
    project = docker_runtime.read_project(workspace) or ""
    services = _compose_services(workspace)
    out: dict[str, str] = dict.fromkeys(services, "defined")

    def service_of(token: str) -> str:
        if project and token.startswith(f"{project}-"):
            token = token[len(project) + 1 :]
        return re.sub(r"-\d+$", "", token)

    def bump(service: str, phase: str) -> None:
        if services and service not in out:
            return
        current = out.get(service)
        advances = phase == "failed" or current is None or _PHASE_RANK[phase] > _PHASE_RANK[current]
        if advances and current != "failed":
            out[service] = phase

    try:
        with path.open("r", encoding="utf-8", errors="replace") as fh:
            for raw in fh:
                line = raw.rstrip("\n")
                m = _DOCKER_CONTAINER_RE.match(line)
                if m:
                    phase = _DOCKER_ACTION_PHASE.get(m.group(2).lower())
                    if phase:
                        bump(service_of(m.group(1)), phase)
                    continue
                m = _DOCKER_IMAGE_RE.match(line)
                if m:
                    phase = _DOCKER_ACTION_PHASE.get(m.group(2).lower())
                    if phase:
                        bump(m.group(1), phase)
                    continue
                m = _DOCKER_BUILD_STEP_RE.match(line)
                if m:
                    bump(m.group(1), "importing")
    except OSError:
        return {}

    # ``Started`` is final for services without a healthcheck, and compose
    # only exits 0 once everything is up and healthy: trust the exit code.
    exit_file = workspace / BUILD_EXIT
    if exit_file.exists():
        body = exit_file.read_text(encoding="utf-8").strip().splitlines()
        if body and body[0].strip() == "0":
            for service in services:
                out[service] = "ready"
    return {k: v for k, v in out.items() if v != "defined"}


def parse_per_vm_phases(workspace: Path) -> dict[str, str]:
    """Scan build.log and return ``{hostname: phase}`` per VM / container.

    The returned phase is the highest-ranked one we saw for that VM —
    so a brief "booting" line followed by "Running provisioner: shell"
    yields ``provisioning``. Hostnames that have never appeared in the
    log map to nothing (omitted from the dict). VMs that hit an error
    marker map to ``failed``.

    Cheap regex pass; runs once per request, no caching. build.log
    rarely exceeds ~1 MB even for long builds so this is fine.
    """
    if runtime_of(workspace) == "docker":
        return _parse_docker_phases(workspace)
    path = workspace / BUILD_LOG
    if not path.exists():
        return {}
    out: dict[str, str] = {}
    error_seen: set[str] = set()
    try:
        with path.open("r", encoding="utf-8", errors="replace") as fh:
            for raw in fh:
                m = _VM_LINE_RE.match(raw)
                if not m:
                    continue
                host, rest = m.group(1), m.group(2)
                # Any obvious error from this VM line marks it failed,
                # but only after it has at least started progressing —
                # an early "Box could not be found" isn't a failure.
                lower = rest.lower()
                if (
                    "error:" in lower
                    or "exception" in lower
                    or "could not connect" in lower
                ) and host in out:
                    error_seen.add(host)
                for phase, pattern in _PHASE_MARKERS:
                    if pattern.match(rest):
                        existing = out.get(host)
                        if existing is None or _PHASE_RANK[phase] > _PHASE_RANK[existing]:
                            out[host] = phase
                        break
    except OSError:
        return {}
    for host in error_seen:
        out[host] = "failed"
    return out


def is_pid_alive(pid: int) -> bool:
    """Cross-platform liveness probe.

    On POSIX, ``os.kill(pid, 0)`` raises ``ProcessLookupError`` for a
    missing PID. On Windows, we use ``OpenProcess`` via ctypes — it
    returns 0 for non-existent PIDs.
    """
    if pid <= 0:
        return False
    if os.name == "nt":
        import ctypes  # local import keeps Linux paths clean

        PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
        kernel32 = ctypes.windll.kernel32  # type: ignore[attr-defined]
        handle = kernel32.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, False, pid)
        if not handle:
            return False
        try:
            # If the process has exited, GetExitCodeProcess returns
            # something other than STILL_ACTIVE (259).
            STILL_ACTIVE = 259
            exit_code = ctypes.c_ulong(0)
            if kernel32.GetExitCodeProcess(handle, ctypes.byref(exit_code)) == 0:
                return False
            return exit_code.value == STILL_ACTIVE
        finally:
            kernel32.CloseHandle(handle)
    try:
        os.kill(pid, 0)
        return True
    except ProcessLookupError:
        return False
    except PermissionError:
        # PID exists but we can't signal it — still "alive" for our purposes.
        return True
    except OSError:
        return False


def stop_build(workspace: Path, *, kill_timeout_s: float = 5.0, halt_containers: bool = True) -> dict:
    """User-initiated abort of an in-flight build.

    Sends SIGTERM to the shim, waits up to ``kill_timeout_s`` for a
    clean exit, then SIGKILLs the survivor. Writes the ``.build.aborted``
    sentinel so the UI can distinguish a user-cancel from a Vagrant
    failure, and writes ``.build.exit -1`` if the shim never wrote one
    itself.

    Returns ``{"phase": "...", "killed_pid": N|None, "force_killed": bool}``.
    """
    pid_file = workspace / BUILD_PID
    exit_file = workspace / BUILD_EXIT

    snap = read_build_status(workspace)
    if snap["phase"] != "running":
        # Nothing to stop — but still tag the workspace so a UI poll
        # races back a consistent "aborted" if appropriate.
        return {"phase": snap["phase"], "killed_pid": None, "force_killed": False}

    pid: int | None = None
    if pid_file.exists():
        try:
            pid = int(pid_file.read_text().strip())
        except ValueError:
            pid = None

    force_killed = False
    if pid and is_pid_alive(pid):
        try:
            if hostenv.is_windows():
                # The shim is detached from any console, so CTRL_BREAK cannot
                # reach it. taskkill /T ends the whole tree (shim, vagrant,
                # ruby, VBoxManage) in one go.
                subprocess.call(
                    ["taskkill", "/T", "/PID", str(pid)],
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                )
            else:
                # The shim leads its own session; signal the whole group so
                # the vagrant / docker child dies with it.
                try:
                    os.killpg(pid, signal.SIGTERM)
                except (ProcessLookupError, PermissionError):
                    os.kill(pid, signal.SIGTERM)
        except (ProcessLookupError, OSError) as exc:
            _LOGGER.info("stop_build_signal_failed pid=%s err=%s", pid, exc)

        deadline = time.monotonic() + kill_timeout_s
        while time.monotonic() < deadline:
            if not is_pid_alive(pid):
                break
            time.sleep(0.2)
        else:
            try:
                if hostenv.is_windows():
                    subprocess.call(
                        ["taskkill", "/F", "/T", "/PID", str(pid)],
                        stdout=subprocess.DEVNULL,
                        stderr=subprocess.DEVNULL,
                    )
                else:
                    try:
                        os.killpg(pid, signal.SIGKILL)  # type: ignore[attr-defined]
                    except (ProcessLookupError, PermissionError):
                        os.kill(pid, signal.SIGKILL)  # type: ignore[attr-defined]
                force_killed = True
            except (ProcessLookupError, OSError) as exc:
                _LOGGER.info("stop_build_kill_failed pid=%s err=%s", pid, exc)

    # Mark aborted regardless of whether we actually had to kill anything.
    (workspace / BUILD_ABORTED).write_text(
        _utcnow().isoformat(), encoding="utf-8"
    )
    if not exit_file.exists():
        exit_file.write_text(f"-1\n{int(time.time())}\n", encoding="utf-8")

    if halt_containers and runtime_of(workspace) == "docker":
        # Killing ``compose up`` leaves the containers it already created running.
        docker_runtime.halt(workspace)

    return {"phase": "aborted", "killed_pid": pid, "force_killed": force_killed}


def reattach_daemons(session: Session) -> int:
    """API-startup sweep: restart the heartbeat daemon of every live lab that lost it.

    The daemon is a child of the API run, so a restart of the API (or a reboot) leaves
    running labs with no heartbeat and a blank monitor. Returns how many were restarted.
    """
    restarted = 0
    rows = session.exec(select(Lab).where(Lab.status.in_(("running", "partial")))).all()  # type: ignore[attr-defined]
    for lab in rows:
        if not lab.workspace_path:
            continue
        ws = Path(lab.workspace_path)
        if not ws.exists():
            continue
        pid_file = ws / DAEMON_PID
        alive = False
        if pid_file.exists():
            with contextlib.suppress(ValueError, OSError):
                alive = is_pid_alive(int(pid_file.read_text().strip()))
        if not alive:
            (ws / ".labforge-daemon-stop").unlink(missing_ok=True)
            _spawn_daemon(lab, ws)
            restarted += 1
    return restarted


def reconcile_orphan_builds(session: Session) -> int:
    """API-startup sweep for builds whose host process died unnoticed.

    For every Lab with ``status='building'``:
      * If its workspace has no ``.build.exit`` AND its PID file points
        at a process that is no longer alive, write
        ``.build.exit -2`` with the current epoch, drop the PID file,
        and flip the lab to ``failed``.
      * If the workspace is missing, also flip to ``failed``.

    Returns the number of labs reconciled.
    """
    reconciled = 0
    rows = session.exec(select(Lab).where(Lab.status == "building")).all()
    for lab in rows:
        if not lab.workspace_path:
            lab.status = "failed"
            lab.updated_at = _utcnow()
            session.add(lab)
            reconciled += 1
            continue
        ws = Path(lab.workspace_path)
        if not ws.exists():
            lab.status = "failed"
            lab.updated_at = _utcnow()
            session.add(lab)
            reconciled += 1
            continue
        exit_file = ws / BUILD_EXIT
        pid_file = ws / BUILD_PID
        if exit_file.exists():
            # The shim already wrote its sentinel — the build endpoint
            # will reconcile lab.status on the next /build/status poll.
            continue
        pid: int | None = None
        if pid_file.exists():
            try:
                pid = int(pid_file.read_text().strip())
            except ValueError:
                pid = None
        if pid and is_pid_alive(pid):
            # Real, still-running build. Leave alone.
            continue
        # Dead PID + no exit sentinel => orphan. Write a synthetic exit
        # so /monitor reflects it; clear the stale PID file.
        exit_file.write_text(f"-2\n{int(time.time())}\n", encoding="utf-8")
        if pid_file.exists():
            with contextlib.suppress(OSError):
                pid_file.unlink()
        lab.status = "failed"
        lab.updated_at = _utcnow()
        session.add(lab)
        reconciled += 1
    if reconciled:
        session.commit()
        _LOGGER.info("reconciled %d orphaned build(s) on startup", reconciled)
    return reconciled
