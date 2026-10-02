"""Workspace location: validation, saving, moving. Only temporary folders are used."""

from __future__ import annotations

import os
import stat
from datetime import UTC, datetime
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlmodel import Session, SQLModel, create_engine
from sqlmodel.pool import StaticPool

from labforge_core.api.routers import settings as settings_router
from labforge_core.models import Lab, get_session
from labforge_core.services import build_runner, workspace
from labforge_core.services.template_loader import get_template


@pytest.fixture
def db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    SQLModel.metadata.create_all(engine)
    with Session(engine) as session:
        yield session


@pytest.fixture
def default_dir(tmp_path, monkeypatch):
    path = tmp_path / "default-ws"
    monkeypatch.setattr(workspace, "configured_default", lambda: path)
    return path


@pytest.fixture
def client(db, default_dir):
    app = FastAPI()
    app.include_router(settings_router.router, prefix="/api/v1")
    app.dependency_overrides[get_session] = lambda: db
    return TestClient(app)


def _lab(status: str, path: Path) -> Lab:
    now = datetime.now(UTC).replace(tzinfo=None)
    return Lab(topology_slug="demo", name="demo", provider="docker", status=status,
               workspace_path=str(path), created_at=now, updated_at=now)


def _folder(tmp_path: Path, name: str) -> Path:
    path = tmp_path / name
    path.mkdir()
    return path


def test_get_reports_default_path_free_space_and_writable(client, default_dir):
    body = client.get("/api/v1/settings/workspace").json()
    assert body["path"] == str(default_dir)
    assert body["source"] == "default" and body["state"] == "ok"
    assert body["writable"] is True and body["free_gb"] > 0


def test_valid_path_is_saved_and_used_without_restart(client, tmp_path):
    target = _folder(tmp_path, "bigdrive")
    r = client.put("/api/v1/settings/workspace", json={"path": str(target)})
    assert r.status_code == 200, r.text
    assert r.json()["path"] == str(target) and r.json()["source"] == "settings"
    assert workspace.root() == target  # same process, no restart
    assert client.get("/api/v1/settings/workspace").json()["path"] == str(target)
    assert workspace.require_usable() == target


def test_validate_endpoint_does_not_save(client, tmp_path, default_dir):
    target = _folder(tmp_path, "candidate")
    body = client.post("/api/v1/settings/workspace/validate", json={"path": str(target)}).json()
    assert body["ok"] is True and body["writable"] is True and body["free_gb"] > 0
    assert workspace.root() == default_dir


@pytest.mark.parametrize(
    ("raw", "code"),
    [("", "empty"), ("relative/folder", "not_absolute")],
)
def test_invalid_text_is_rejected(client, raw, code):
    r = client.put("/api/v1/settings/workspace", json={"path": raw})
    assert r.status_code == 422 and r.json()["detail"]["code"] == code


def test_missing_folder_and_file_are_rejected(client, tmp_path):
    missing = client.put("/api/v1/settings/workspace", json={"path": str(tmp_path / "nope")})
    assert missing.status_code == 422 and missing.json()["detail"]["code"] == "missing"
    afile = tmp_path / "file.txt"
    afile.write_text("x")
    not_dir = client.put("/api/v1/settings/workspace", json={"path": str(afile)})
    assert not_dir.json()["detail"]["code"] == "not_a_folder"


def test_folder_inside_the_repo_or_system_folders_is_rejected(client, tmp_path, monkeypatch):
    fake_repo = _folder(tmp_path, "repo")
    inside = _folder(fake_repo, "labs")
    monkeypatch.setattr(workspace, "repo_root", lambda: fake_repo)
    r = client.put("/api/v1/settings/workspace", json={"path": str(inside)})
    assert r.status_code == 422 and r.json()["detail"]["code"] == "protected"
    assert "source folder" in r.json()["detail"]["detail"]

    system = _folder(tmp_path, "system")
    monkeypatch.setattr(workspace, "_system_folders", lambda: [system])
    r = client.put("/api/v1/settings/workspace", json={"path": str(_folder(system, "sub"))})
    assert r.json()["detail"]["code"] == "protected" and "operating system" in r.json()["detail"]["detail"]
    assert workspace.saved_path() is None


@pytest.mark.skipif(os.name == "nt" or os.geteuid() == 0, reason="needs a non-root POSIX user")
def test_unwritable_folder_is_rejected(client, tmp_path):
    ro = _folder(tmp_path, "readonly")
    ro.chmod(stat.S_IRUSR | stat.S_IXUSR)
    try:
        r = client.put("/api/v1/settings/workspace", json={"path": str(ro)})
        assert r.status_code == 422 and r.json()["detail"]["code"] == "not_writable"
    finally:
        ro.chmod(stat.S_IRWXU)


def test_unwritable_is_detected_by_the_write_probe(client, tmp_path, monkeypatch):
    target = _folder(tmp_path, "probe")
    monkeypatch.setattr(workspace, "_writable", lambda p: (False, "Permission denied"))
    r = client.put("/api/v1/settings/workspace", json={"path": str(target)})
    assert r.status_code == 422 and r.json()["detail"]["code"] == "not_writable"


def test_chosen_path_that_disappears_is_an_error_not_a_silent_fallback(client, tmp_path, db):
    target = _folder(tmp_path, "usb")
    client.put("/api/v1/settings/workspace", json={"path": str(target)})
    target.rmdir()
    body = client.get("/api/v1/settings/workspace").json()
    assert body["state"] == "missing" and "not available" in body["error"]
    assert body["path"] == str(target)  # still reports the chosen path, not the default
    with pytest.raises(workspace.WorkspaceError) as err:
        workspace.require_usable()
    assert err.value.code == "workspace_unavailable"
    with pytest.raises(build_runner.BuildPrereqError):
        build_runner.start_build_detailed(get_template("ransomware-intrusion-linux-lab"), db)


def test_changing_with_existing_data_asks_first_and_changes_nothing(client, tmp_path, default_dir):
    old = _folder(tmp_path, "old")
    new = _folder(tmp_path, "new")
    client.put("/api/v1/settings/workspace", json={"path": str(old)})
    (old / "lab-1").mkdir()
    (old / "lab-1" / "docker-compose.yml").write_text("services: {}")

    r = client.put("/api/v1/settings/workspace", json={"path": str(new)})
    assert r.status_code == 409
    detail = r.json()["detail"]
    assert detail["code"] == "existing_data" and detail["choices"] == ["move", "leave"]
    assert detail["existing"]["entries"] == 1 and detail["existing"]["path"] == str(old)
    assert workspace.root() == old and (old / "lab-1").exists()


def test_leave_switches_path_and_keeps_old_data_in_place(client, tmp_path):
    old = _folder(tmp_path, "old")
    new = _folder(tmp_path, "new")
    client.put("/api/v1/settings/workspace", json={"path": str(old)})
    (old / "lab-1").mkdir()
    r = client.put("/api/v1/settings/workspace", json={"path": str(new), "existing_data": "leave"})
    assert r.status_code == 200 and r.json()["path"] == str(new) and r.json()["moved"] is None
    assert (old / "lab-1").exists() and not (new / "lab-1").exists()


def test_move_relocates_folders_and_repoints_labs(client, tmp_path, db):
    old = _folder(tmp_path, "old")
    new = _folder(tmp_path, "new")
    client.put("/api/v1/settings/workspace", json={"path": str(old)})
    lab_dir = old / "demo-1"
    lab_dir.mkdir()
    (lab_dir / "docker-compose.yml").write_text("services: {}")
    db.add(_lab("halted", lab_dir))
    db.commit()

    r = client.put("/api/v1/settings/workspace", json={"path": str(new), "existing_data": "move"})
    assert r.status_code == 200, r.text
    assert r.json()["moved"]["entries"] == 1 and r.json()["moved"]["labs"] == 1
    assert (new / "demo-1" / "docker-compose.yml").read_text() == "services: {}"
    assert not (old / "demo-1").exists()
    db.expire_all()
    assert db.get(Lab, 1).workspace_path == str(new / "demo-1")
    assert workspace.root() == new


@pytest.mark.parametrize("busy", ["running", "building", "partial"])
def test_move_is_refused_while_a_lab_is_running_or_building(client, tmp_path, db, busy):
    old = _folder(tmp_path, "old")
    new = _folder(tmp_path, "new")
    client.put("/api/v1/settings/workspace", json={"path": str(old)})
    (old / "demo-1").mkdir()
    db.add(_lab(busy, old / "demo-1"))
    db.commit()
    r = client.put("/api/v1/settings/workspace", json={"path": str(new), "existing_data": "move"})
    assert r.status_code == 409 and r.json()["detail"]["code"] == "labs_active"
    assert (old / "demo-1").exists() and workspace.root() == old and not any(new.iterdir())


def test_move_refuses_a_destination_that_already_has_the_same_names(client, tmp_path):
    old = _folder(tmp_path, "old")
    new = _folder(tmp_path, "new")
    client.put("/api/v1/settings/workspace", json={"path": str(old)})
    (old / "demo-1").mkdir()
    (new / "demo-1").mkdir()
    r = client.put("/api/v1/settings/workspace", json={"path": str(new), "existing_data": "move"})
    assert r.status_code == 409 and r.json()["detail"]["code"] == "destination_not_empty"
    assert workspace.root() == old


def test_failed_move_is_undone(client, tmp_path, monkeypatch):
    old = _folder(tmp_path, "old")
    new = _folder(tmp_path, "new")
    client.put("/api/v1/settings/workspace", json={"path": str(old)})
    for name in ("a-1", "b-2"):
        (old / name).mkdir()
    real = workspace.shutil.move
    calls = {"n": 0}

    def flaky(src, dst):
        calls["n"] += 1
        if calls["n"] == 2:
            raise OSError("disk full")
        return real(src, dst)

    monkeypatch.setattr(workspace.shutil, "move", flaky)
    r = client.put("/api/v1/settings/workspace", json={"path": str(new), "existing_data": "move"})
    assert r.status_code == 500 and r.json()["detail"]["code"] == "move_failed"
    monkeypatch.setattr(workspace.shutil, "move", real)
    assert sorted(p.name for p in old.iterdir()) == ["a-1", "b-2"] and not any(new.iterdir())
    assert workspace.root() == old


def test_null_path_resets_to_the_default(client, tmp_path, default_dir):
    target = _folder(tmp_path, "chosen")
    client.put("/api/v1/settings/workspace", json={"path": str(target)})
    r = client.put("/api/v1/settings/workspace", json={"path": None})
    assert r.status_code == 200 and r.json()["path"] == str(default_dir)
    assert r.json()["source"] == "default" and workspace.saved_path() is None


def test_build_uses_the_chosen_workspace_not_a_default(client, tmp_path, db, monkeypatch):
    target = _folder(tmp_path, "labs-here")
    client.put("/api/v1/settings/workspace", json={"path": str(target)})
    assert workspace.require_usable() == target
    seen: dict[str, Path] = {}
    monkeypatch.setattr(build_runner.docker_runtime, "prereq_problem", lambda: None)
    monkeypatch.setattr(build_runner.preflight, "blocking_problem", lambda t: None)

    def stop(topology, ws, **kw):
        seen["ws"] = ws
        raise RuntimeError("stop here")

    monkeypatch.setattr(build_runner, "_write_docker_bundle", stop)
    monkeypatch.setattr(build_runner.docker_runtime, "subnet_conflicts", lambda *a, **k: [])
    topo = get_template("ransomware-intrusion-linux-lab")
    with pytest.raises(RuntimeError, match="stop here"):
        build_runner.start_build_detailed(topo, db)
    assert str(seen["ws"]).startswith(str(target))
