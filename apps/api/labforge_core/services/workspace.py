"""Where LabForge keeps lab folders: the one place that answers it.

Resolution order, first match wins:

1. the folder chosen in Settings (saved in ``workspace.json`` under the config dir, so it
   survives restarts and can be changed while the API runs),
2. ``LABFORGE_WORKSPACE_ROOT``,
3. the default from ``settings.default_workspace_root`` (inside a source checkout that is
   ``<repo>/.labforge/workspaces``, otherwise ``~/.labforge/workspaces``).

A folder chosen in Settings is never replaced by another drive behind the person's back: when it
is missing, unwritable or on a different device than when it was chosen, ``status()`` says so and
``require_usable()`` raises. Callers show that error instead of building somewhere else.
"""

from __future__ import annotations

import contextlib
import json
import os
import shutil
import tempfile
import threading
from pathlib import Path
from typing import Any

from sqlmodel import Session, select

from labforge_core.settings import default_workspace_root, get_settings

GB = 1024**3
CONFIG_NAME = "workspace.json"
_MOVE_LOCK = threading.Lock()


class WorkspaceError(RuntimeError):
    def __init__(self, message: str, code: str, status: int = 409, extra: dict[str, Any] | None = None) -> None:
        super().__init__(message)
        self.code = code
        self.status = status
        self.extra = extra or {}


# ------------------------------------------------------------------ saved choice


def config_dir() -> Path:
    override = os.environ.get("LABFORGE_CONFIG_DIR")
    return Path(override) if override else Path.home() / ".labforge"


def _config_file() -> Path:
    return config_dir() / CONFIG_NAME


def _load() -> dict[str, Any]:
    try:
        data = json.loads(_config_file().read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    return data if isinstance(data, dict) else {}


def _save(data: dict[str, Any]) -> None:
    target = _config_file()
    target.parent.mkdir(parents=True, exist_ok=True)
    tmp = target.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, indent=2), encoding="utf-8")
    tmp.replace(target)


def _clear() -> None:
    with contextlib.suppress(FileNotFoundError):
        _config_file().unlink()


def saved_path() -> Path | None:
    raw = _load().get("path")
    return Path(raw) if isinstance(raw, str) and raw else None


def configured_default() -> Path:
    """What applies when nothing was chosen in Settings: the environment variable, else the default."""
    settings = get_settings()
    return Path(settings.workspace_root)


def root() -> Path:
    """The workspace folder every part of LabForge uses."""
    return saved_path() or configured_default()


def source() -> str:
    if saved_path() is not None:
        return "settings"
    if "workspace_root" in get_settings().model_fields_set or "LABFORGE_WORKSPACE_ROOT" in os.environ:
        return "environment"
    return "default"


def _device(path: Path) -> int | None:
    try:
        return path.stat().st_dev
    except OSError:
        return None


# ------------------------------------------------------------------ checks


def repo_root() -> Path | None:
    repo = Path(__file__).resolve().parents[4]
    if (repo / ".git").exists() and (repo / "packages" / "schema").exists():
        return repo
    return None


def _inside(path: Path, parent: Path) -> bool:
    try:
        path.relative_to(parent)
    except ValueError:
        return False
    return True


def _system_folders() -> list[Path]:
    if os.name == "nt":
        names = ("SystemRoot", "windir", "ProgramFiles", "ProgramFiles(x86)", "ProgramW6432", "ProgramData")
        return [Path(os.environ[n]) for n in names if os.environ.get(n)]
    return [
        Path(p)
        for p in (
            "/bin", "/boot", "/dev", "/etc", "/lib", "/lib32", "/lib64", "/proc", "/run", "/sbin",
            "/sys", "/usr", "/var/lib", "/System", "/Library", "/Applications", "/private/etc",
            "/private/var/db",
        )
    ]


def _protected_reason(path: Path) -> str | None:
    """Why this folder must not hold labs, or None."""
    if path == Path(path.anchor):
        return "That is the top of a drive. Pick a folder on it, for example a new folder called LabForge."
    for folder in _system_folders():
        try:
            resolved = folder.resolve()
        except OSError:
            continue
        if _inside(path, resolved):
            return f"That is an operating system folder ({resolved}). Pick a folder you own."
    repo = repo_root()
    if repo is not None and _inside(path, repo.resolve()):
        default = default_workspace_root().resolve()
        if not _inside(path, default):
            return f"That is inside the LabForge source folder ({repo}). Pick a folder outside it."
    return None


def _free(path: Path) -> tuple[float | None, float | None]:
    probe = path
    while not probe.exists() and probe.parent != probe:
        probe = probe.parent
    try:
        usage = shutil.disk_usage(str(probe))
    except OSError:
        return None, None
    return round(usage.free / GB, 2), round(usage.total / GB, 2)


def _writable(path: Path) -> tuple[bool, str | None]:
    try:
        with tempfile.NamedTemporaryFile(dir=path, prefix=".labforge-write-test-"):
            pass
    except OSError as exc:
        return False, str(exc)
    return True, None


def status() -> dict[str, Any]:
    """The workspace as it is right now: path, where it came from, free space and any problem."""
    path = root()
    src = source()
    free_gb, total_gb = _free(path)
    exists = path.exists()
    writable = False
    state, error = "ok", None
    if exists:
        writable, why = _writable(path) if path.is_dir() else (False, "It is not a folder.")
        if not writable:
            state, error = "not_writable", f"LabForge cannot write to {path}. {why or ''}".strip()
        elif src == "settings":
            saved_dev = _load().get("device")
            now = _device(path)
            if saved_dev is not None and now is not None and saved_dev != now:
                state = "device_changed"
                error = (
                    f"{path} is now on a different drive than when you chose it. "
                    "Reconnect the drive, or choose another folder."
                )
    elif src == "settings":
        state = "missing"
        error = f"The workspace folder {path} is not available. Reconnect its drive or choose another folder in Settings."
    else:
        # Default and environment paths are created on the first build. Writable means "can be created".
        probe = path
        while not probe.exists() and probe.parent != probe:
            probe = probe.parent
        writable = _writable(probe)[0] if probe.is_dir() else False
        if not writable:
            state, error = "not_writable", f"LabForge cannot create {path}."
    return {
        "path": str(path),
        "source": src,
        "default_path": str(configured_default()),
        "exists": exists,
        "writable": writable,
        "state": state,
        "error": error,
        "free_gb": free_gb,
        "total_gb": total_gb,
        "drive": (path.anchor or str(path)) if path.anchor else None,
    }


def require_usable() -> Path:
    """The workspace folder, created if it is the default, or ``WorkspaceError`` saying what is wrong."""
    state = status()
    if state["state"] != "ok":
        raise WorkspaceError(state["error"], "workspace_unavailable", 409)
    path = root()
    if _MOVE_LOCK.locked():
        raise WorkspaceError("The workspace is being moved. Try again in a minute.", "workspace_moving", 409)
    path.mkdir(parents=True, exist_ok=True)
    return path


# ------------------------------------------------------------------ existing data


def _dir_size_mb(path: Path) -> float:
    total = 0
    for dirpath, _dirs, files in os.walk(path):
        for name in files:
            try:
                total += (Path(dirpath) / name).lstat().st_size
            except OSError:
                continue
    return round(total / (1024 * 1024), 1)


def existing_data(path: Path, session: Session | None = None) -> dict[str, Any]:
    """What is already in a workspace folder (lab folders and anything else) and how many labs point at it."""
    entries: list[str] = []
    size = 0.0
    if path.is_dir():
        entries = sorted(p.name for p in path.iterdir() if not p.name.startswith(".labforge-write-test-"))
        size = _dir_size_mb(path)
    labs = 0
    if session is not None:
        from labforge_core.models import Lab

        for lab in session.exec(select(Lab)).all():
            if lab.workspace_path and _inside(Path(lab.workspace_path), path):
                labs += 1
    return {"path": str(path), "entries": len(entries), "labs": labs, "size_mb": size, "names": entries[:20]}


def validate(raw: str, session: Session | None = None) -> dict[str, Any]:
    """Check a folder the person typed. Never creates or changes anything.

    Returns ``{"ok": bool, "path", "code", "error", "free_gb", "writable", "existing"}``.
    """
    text = (raw or "").strip()
    if not text:
        return _verdict(None, "empty", "Type the full path of a folder.")
    path = Path(os.path.expandvars(text)).expanduser()
    if not path.is_absolute():
        return _verdict(path, "not_absolute", "Use a full path, starting from the top of a drive.")
    try:
        path = path.resolve()
    except OSError as exc:
        return _verdict(path, "bad_path", str(exc))
    if not path.exists():
        return _verdict(path, "missing", f"{path} does not exist. Create the folder first, then test again.")
    if not path.is_dir():
        return _verdict(path, "not_a_folder", f"{path} is a file, not a folder.")
    reason = _protected_reason(path)
    if reason:
        return _verdict(path, "protected", reason)
    ok, why = _writable(path)
    if not ok:
        return _verdict(path, "not_writable", f"LabForge cannot write to {path}. {why}", writable=False)
    verdict = _verdict(path, None, None, writable=True)
    if path != root():
        verdict["existing"] = existing_data(path, session)
    return verdict


def _verdict(path: Path | None, code: str | None, error: str | None, *, writable: bool = False) -> dict[str, Any]:
    free_gb, total_gb = _free(path) if path is not None else (None, None)
    return {
        "ok": code is None,
        "path": str(path) if path is not None else None,
        "code": code,
        "error": error,
        "writable": writable,
        "free_gb": free_gb,
        "total_gb": total_gb,
        "existing": None,
    }


# ------------------------------------------------------------------ change and move


def _active_labs(session: Session) -> list[Any]:
    from labforge_core.models import Lab
    from labforge_core.services.build_runner import ACTIVE_STATUSES

    return list(session.exec(select(Lab).where(Lab.status.in_(ACTIVE_STATUSES))).all())  # type: ignore[attr-defined]


def _move_entries(old: Path, new: Path) -> list[str]:
    moved: list[Path] = []
    try:
        for child in sorted(old.iterdir()):
            if child.name.startswith(".labforge-write-test-"):
                continue
            target = new / child.name
            shutil.move(str(child), str(target))
            moved.append(target)
    except Exception as exc:
        for target in reversed(moved):  # put back what already moved
            with contextlib.suppress(OSError):
                shutil.move(str(target), str(old / target.name))
        raise WorkspaceError(f"Moving the workspace failed and was undone: {exc}", "move_failed", 500) from exc
    return [p.name for p in moved]


def _repoint_labs(session: Session, old: Path, new: Path) -> int:
    from labforge_core.models import Lab

    count = 0
    for lab in session.exec(select(Lab)).all():
        if lab.workspace_path and _inside(Path(lab.workspace_path), old):
            lab.workspace_path = str(new / Path(lab.workspace_path).relative_to(old))
            session.add(lab)
            count += 1
    session.commit()
    return count


def change(path: str | None, existing_choice: str | None, session: Session) -> dict[str, Any]:
    """Point LabForge at a new workspace folder, optionally moving what is in the old one.

    ``path=None`` goes back to the environment or default location. With data in the old folder and
    no ``existing_choice`` ("move" or "leave") this raises ``WorkspaceError`` code ``existing_data``
    so the caller can ask; nothing has changed at that point.
    """
    old = root()
    if path is None:
        new = configured_default()
        verdict: dict[str, Any] = {"ok": True, "path": str(new)}
    else:
        verdict = validate(path, session)
        if not verdict["ok"]:
            raise WorkspaceError(verdict["error"], verdict["code"], 422, {"validation": verdict})
        new = Path(verdict["path"])
    if new == old:
        if path is not None:
            _save({"path": str(new), "device": _device(new)})
        return {**status(), "moved": None}

    old_data = existing_data(old, session)
    has_data = old_data["entries"] > 0 or old_data["labs"] > 0
    if has_data and existing_choice not in ("move", "leave"):
        raise WorkspaceError(
            f"{old} already holds {old_data['labs']} lab(s) and {old_data['entries']} item(s). "
            "Move them to the new folder, or leave them there and start fresh?",
            "existing_data",
            409,
            {"existing": old_data, "choices": ["move", "leave"], "new_path": str(new)},
        )

    moved: dict[str, Any] | None = None
    if has_data and existing_choice == "move":
        if _inside(new, old) or _inside(old, new):
            raise WorkspaceError("The new folder and the old one cannot be inside each other.", "nested", 422)
        if not _MOVE_LOCK.acquire(blocking=False):
            raise WorkspaceError("A move is already running.", "workspace_moving", 409)
        try:
            busy = _active_labs(session)
            if busy:
                names = ", ".join(lab.name for lab in busy[:5])
                raise WorkspaceError(
                    f"Cannot move the workspace while a lab is running or building ({names}). "
                    "Stop it or wait for the build to finish, then try again.",
                    "labs_active",
                    409,
                    {"labs": [lab.id for lab in busy]},
                )
            new.mkdir(parents=True, exist_ok=True)
            clashes = [p.name for p in old.iterdir() if (new / p.name).exists()]
            if clashes:
                raise WorkspaceError(
                    f"The new folder already has {', '.join(clashes[:5])}. Pick an empty folder.",
                    "destination_not_empty",
                    409,
                )
            names = _move_entries(old, new)
            moved = {"from": str(old), "to": str(new), "entries": len(names), "labs": _repoint_labs(session, old, new)}
        finally:
            _MOVE_LOCK.release()

    if path is None:
        _clear()
    else:
        _save({"path": str(new), "device": _device(new)})
    return {**status(), "moved": moved}
