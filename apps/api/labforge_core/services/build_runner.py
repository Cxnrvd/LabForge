"""In-app Build Lab runner.

The web Build button POSTs the canvas topology here. We:
  1. Generate the Vagrant bundle straight to disk (no zip round-trip).
  2. Register a Lab row.
  3. Spawn ``vagrant up`` as a detached subprocess writing combined
     stdout+stderr to ``<workspace>/build.log``. A sentinel file
     ``.build.exit`` carries the eventual exit code.
  4. Spawn the heartbeat daemon so the dashboard sees per-VM state once
     VMs come up.

The runner returns immediately. The /labs/{id}/build/log endpoint tails
the log; the /labs/{id}/build/status endpoint reads the sentinel.
"""

from __future__ import annotations

import logging
import os
import re
import shutil
import signal
import subprocess
import sys
import tempfile
import time
from datetime import datetime
from pathlib import Path
from typing import Optional

from sqlmodel import Session, select

from labforge_schema import LabConfig

from labforge_core.models import Lab
from labforge_core.services.generator import generate_artifacts
from labforge_core.settings import get_settings

BUILD_LOG = "build.log"
BUILD_EXIT = ".build.exit"
BUILD_PID = ".build.pid"
BUILD_ABORTED = ".build.aborted"

_LOGGER = logging.getLogger("labforge.build_runner")


class BuildPrereqError(RuntimeError):
    """Vagrant isn't installed / wrong version / etc."""


def _slug(name: str) -> str:
    return re.sub(r"[^a-z0-9-]+", "-", name.lower()).strip("-") or "lab"


def vagrant_available() -> bool:
    return shutil.which("vagrant") is not None


def _write_artifacts(topology: LabConfig, workspace: Path) -> None:
    artifacts = generate_artifacts(topology)
    workspace.mkdir(parents=True, exist_ok=True)
    (workspace / "Vagrantfile").write_text(artifacts.vagrantfile, encoding="utf-8")
    provision_dir = workspace / "provision"
    provision_dir.mkdir(exist_ok=True)
    for filename, body in artifacts.provisioner_scripts.items():
        (provision_dir / filename).write_text(body, encoding="utf-8")
    if artifacts.hosts_file:
        (workspace / "hosts").write_text(artifacts.hosts_file, encoding="utf-8")
    if artifacts.readme:
        (workspace / "README.md").write_text(artifacts.readme, encoding="utf-8")
    (workspace / "topology.json").write_text(
        topology.model_dump_json(indent=2), encoding="utf-8"
    )


def _shim_dir() -> Path:
    """Where to drop the throwaway build-shim script.

    We deliberately put this outside the workspace so the workspace stays
    a clean artifact dir (no `_build_shim.py` litter once the build is
    over) and so the shim can survive workspace recreation.
    """
    d = Path(tempfile.gettempdir()) / "labforge-shims"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _spawn_vagrant_up(workspace: Path, provider: str) -> int:
    """Detach `vagrant up --provider <provider>` so the handler can return.

    The provider is forced both via the CLI flag and by setting
    ``VAGRANT_DEFAULT_PROVIDER`` in the spawned env, so a stale system
    default (e.g. ``vmware_desktop``) can't silently win.
    """
    log_path = workspace / BUILD_LOG
    log_path.write_text(
        (
            f"--- vagrant up start {datetime.utcnow().isoformat()} ---\n"
            f"--- provider={provider} ---\n"
        ),
        encoding="utf-8",
    )
    fh = log_path.open("a", encoding="utf-8", buffering=1)  # line-buffered

    # On POSIX `start_new_session=True` detaches; on Windows we use the
    # CREATE_NEW_PROCESS_GROUP flag for the same effect.
    creationflags = 0
    if os.name == "nt":
        creationflags = subprocess.CREATE_NEW_PROCESS_GROUP  # type: ignore[attr-defined]
        creationflags |= 0x00000008  # DETACHED_PROCESS

    # Drop the shim outside the workspace so the artifact dir stays
    # clean. One shim file per workspace slug is enough.
    shim_name = f"build_shim_{_slug(workspace.name)}_{int(time.time())}.py"
    shim = _shim_dir() / shim_name
    shim.write_text(_BUILD_SHIM, encoding="utf-8")

    env = {**os.environ, "VAGRANT_DEFAULT_PROVIDER": provider}

    proc = subprocess.Popen(
        [sys.executable, str(shim), str(workspace), provider],
        cwd=str(workspace),
        stdout=fh,
        stderr=subprocess.STDOUT,
        stdin=subprocess.DEVNULL,
        start_new_session=os.name != "nt",
        creationflags=creationflags,
        env=env,
    )
    (workspace / BUILD_PID).write_text(str(proc.pid), encoding="utf-8")
    return proc.pid


# Shim that runs `vagrant up --provider <provider>`, captures the exit
# code, and writes the sentinel file regardless of how vagrant terminates.
# Lives in a temp dir so the workspace stays free of build scaffolding.
_BUILD_SHIM = '''\
import os, subprocess, sys, time
ws = sys.argv[1]
provider = sys.argv[2] if len(sys.argv) > 2 else "virtualbox"
exit_path = os.path.join(ws, ".build.exit")
try:
    rc = subprocess.call(
        ["vagrant", "up", "--provider", provider],
        cwd=ws,
    )
except FileNotFoundError:
    rc = 127
except Exception as exc:
    print(f"[build-shim] {exc}", file=sys.stdout, flush=True)
    rc = 1
with open(exit_path, "w", encoding="utf-8") as fh:
    fh.write(f"{rc}\\n{int(time.time())}\\n")
'''


def start_build(
    topology: LabConfig,
    session: Session,
    workspace_root: Optional[Path] = None,
) -> tuple[Lab, Path]:
    """Synchronously: generate bundle + create Lab row + spawn vagrant up.

    Returns the persisted Lab and the workspace path. Raises BuildPrereqError
    if vagrant isn't installed.
    """
    if not vagrant_available():
        raise BuildPrereqError(
            "vagrant is not on PATH on the API host — install Vagrant 2.4+ first"
        )
    settings = get_settings()
    root = workspace_root or settings.workspace_root
    slug = _slug(topology.name)
    workspace = root / slug
    if workspace.exists() and any(workspace.iterdir()):
        # Same convention the CLI uses: re-build wipes the previous one.
        # The heartbeat daemon, if any, will exit cleanly because the dir
        # disappears for a moment.
        shutil.rmtree(workspace)
    _write_artifacts(topology, workspace)

    lab = Lab(
        topology_slug=slug,
        name=topology.name,
        provider=topology.provider.value,
        status="building",
        workspace_path=str(workspace),
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow(),
    )
    session.add(lab)
    session.commit()
    session.refresh(lab)

    pid = _spawn_vagrant_up(workspace, topology.provider.value)
    # Spawn the heartbeat daemon so once VMs come up the dashboard
    # populates without the user having to run `labforge run` in parallel.
    try:
        from labforge_agent import daemon as _daemon

        _daemon.spawn_detached(
            lab_id=lab.id or 0,
            workspace=workspace,
            api_base="http://127.0.0.1:8000",
        )
    except Exception:
        # Heartbeat is best-effort; the build still proceeds without it.
        pass
    print(f"[build_runner] vagrant up pid={pid} workspace={workspace}", flush=True)
    return lab, workspace


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
            held = text[last_nl + 1 :]
            text = text[: last_nl + 1]
            chunk_consumed = len(text.encode("utf-8"))
        else:
            held = ""
            chunk_consumed = 0
    else:
        held = ""
        chunk_consumed = len(chunk)
    lines = [ln for ln in text.split("\n") if ln]
    return {
        "lines": lines,
        "next_offset": since + chunk_consumed,
        "bytes_total": size,
    }


def read_build_status(workspace: Path) -> dict:
    """Resolve build state from sentinel files."""
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
        else:
            phase = "succeeded" if exit_code == 0 else "failed"
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


def stop_build(workspace: Path, *, kill_timeout_s: float = 5.0) -> dict:
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
            if os.name == "nt":
                # CTRL_BREAK only works because we spawn with
                # CREATE_NEW_PROCESS_GROUP. SIGTERM doesn't exist on
                # Windows in the POSIX sense.
                os.kill(pid, signal.CTRL_BREAK_EVENT)  # type: ignore[attr-defined]
            else:
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
                if os.name == "nt":
                    subprocess.call(["taskkill", "/F", "/T", "/PID", str(pid)])
                else:
                    os.kill(pid, signal.SIGKILL)
                force_killed = True
            except (ProcessLookupError, OSError) as exc:
                _LOGGER.info("stop_build_kill_failed pid=%s err=%s", pid, exc)

    # Mark aborted regardless of whether we actually had to kill anything.
    (workspace / BUILD_ABORTED).write_text(
        datetime.utcnow().isoformat(), encoding="utf-8"
    )
    if not exit_file.exists():
        exit_file.write_text(f"-1\n{int(time.time())}\n", encoding="utf-8")

    return {"phase": "aborted", "killed_pid": pid, "force_killed": force_killed}


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
            lab.updated_at = datetime.utcnow()
            session.add(lab)
            reconciled += 1
            continue
        ws = Path(lab.workspace_path)
        if not ws.exists():
            lab.status = "failed"
            lab.updated_at = datetime.utcnow()
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
            try:
                pid_file.unlink()
            except OSError:
                pass
        lab.status = "failed"
        lab.updated_at = datetime.utcnow()
        session.add(lab)
        reconciled += 1
    if reconciled:
        session.commit()
        _LOGGER.info("reconciled %d orphaned build(s) on startup", reconciled)
    return reconciled
