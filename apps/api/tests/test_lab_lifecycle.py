"""Lab lifecycle with a mocked Docker layer: build, status, stop, start, destroy."""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlmodel import Session, SQLModel, create_engine
from sqlmodel.pool import StaticPool

from labforge_core.api.routers import labs as labs_router
from labforge_core.models import Lab, get_session
from labforge_core.services import build_runner, docker_runtime
from labforge_core.services.template_loader import get_template


class FakeDocker:
    """Records what the runner asked Docker to do and answers like a healthy daemon."""

    def __init__(self) -> None:
        self.spawned: list[list[str]] = []
        self.daemons = 0
        self.halts = 0
        self.teardowns = 0
        self.halt_ok = True
        self.teardown_ok = True
        self.running = 4


@pytest.fixture
def fake(monkeypatch) -> FakeDocker:
    f = FakeDocker()
    monkeypatch.setattr(docker_runtime, "prereq_problem", lambda: None)
    monkeypatch.setattr(docker_runtime, "subnet_conflicts", lambda *a, **k: [])
    monkeypatch.setattr(docker_runtime, "running_count", lambda ws: f.running)
    monkeypatch.setattr(build_runner.preflight, "blocking_problem", lambda topology: None)
    monkeypatch.setattr(build_runner, "host_port_free", lambda port: True)

    def spawn(workspace: Path, argv: list[str], **kw) -> int:
        f.spawned.append(argv)
        (workspace / build_runner.BUILD_PID).write_text("4242", encoding="utf-8")
        return 4242

    def halt(ws, project=None, **kw):
        f.halts += 1
        return docker_runtime.TeardownResult(ok=f.halt_ok, error=None if f.halt_ok else "boom")

    def teardown(ws, project=None, **kw):
        f.teardowns += 1
        return docker_runtime.TeardownResult(ok=f.teardown_ok, error=None if f.teardown_ok else "stuck")

    monkeypatch.setattr(build_runner, "_spawn_build", spawn)
    monkeypatch.setattr(build_runner, "_spawn_daemon", lambda lab, ws: setattr(f, "daemons", f.daemons + 1))
    monkeypatch.setattr(build_runner, "_stop_daemon", lambda ws: None)
    monkeypatch.setattr(build_runner, "is_pid_alive", lambda pid: False)
    monkeypatch.setattr(docker_runtime, "halt", halt)
    monkeypatch.setattr(docker_runtime, "teardown", teardown)
    return f


@pytest.fixture
def session():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    SQLModel.metadata.create_all(engine)
    with Session(engine) as s:
        yield s
    engine.dispose()


def _build(session, tmp_path) -> Lab:
    return build_runner.start_build_detailed(get_template("ransomware-intrusion-linux-lab"), session, tmp_path).lab


def _finish_build(lab: Lab, code: int = 0) -> None:
    (Path(lab.workspace_path) / build_runner.BUILD_EXIT).write_text(f"{code}\n1790000000\n", encoding="utf-8")


def test_build_writes_the_bundle_and_starts_compose(fake, session, tmp_path):
    lab = _build(session, tmp_path)
    ws = Path(lab.workspace_path)
    assert lab.status == "building"
    assert (ws / "docker-compose.yml").exists()
    assert (ws / ".labforge-project").read_text().strip().startswith("lf")
    assert fake.spawned[0][:3] == ["docker", "compose", "-p"]
    assert "up" in fake.spawned[0] and "--wait" in fake.spawned[0]
    assert fake.daemons == 1


def test_status_follows_the_exit_sentinel(fake, session, tmp_path):
    lab = _build(session, tmp_path)
    ws = Path(lab.workspace_path)
    assert build_runner.read_build_status(ws)["phase"] == "running"
    _finish_build(lab, 0)
    assert build_runner.read_build_status(ws)["phase"] == "succeeded"
    (ws / build_runner.BUILD_EXIT).write_text("1\n1790000000\n", encoding="utf-8")
    fake.running = 0
    assert build_runner.read_build_status(ws)["phase"] == "failed"
    fake.running = 2
    assert build_runner.read_build_status(ws)["phase"] == "partial"


def test_halt_keeps_the_workspace_and_marks_the_lab_stopped(fake, session, tmp_path):
    lab = _build(session, tmp_path)
    _finish_build(lab)
    lab.status = "running"
    build_runner.halt_lab(lab, session)
    assert fake.halts == 1
    assert session.get(Lab, lab.id).status == "stopped"
    assert Path(lab.workspace_path).exists()


def test_failed_halt_leaves_the_lab_running(fake, session, tmp_path):
    lab = _build(session, tmp_path)
    _finish_build(lab)
    lab.status = "running"
    fake.halt_ok = False
    with pytest.raises(build_runner.HaltFailed, match="boom"):
        build_runner.halt_lab(lab, session)
    assert session.get(Lab, lab.id).status == "running"


def test_resume_reruns_compose_up_and_clears_old_sentinels(fake, session, tmp_path):
    lab = _build(session, tmp_path)
    ws = Path(lab.workspace_path)
    _finish_build(lab)
    (ws / ".labforge-daemon-stop").write_text("stop")
    lab.status = "stopped"
    fake.spawned.clear()
    build_runner.resume_lab(lab, session)
    assert session.get(Lab, lab.id).status == "building"
    assert not (ws / build_runner.BUILD_EXIT).exists()
    assert not (ws / ".labforge-daemon-stop").exists()
    assert "up" in fake.spawned[0]
    assert fake.daemons == 2


def test_only_a_stopped_lab_can_be_started(fake, session, tmp_path):
    lab = _build(session, tmp_path)
    lab.status = "running"
    with pytest.raises(build_runner.HaltFailed, match="only a stopped lab"):
        build_runner.resume_lab(lab, session)


def test_a_stopped_lab_still_blocks_a_second_build_of_the_same_template(fake, session, tmp_path):
    lab = _build(session, tmp_path)
    lab.status = "stopped"
    session.add(lab)
    session.commit()
    with pytest.raises(build_runner.LabExistsError):
        _build(session, tmp_path)


def test_cancelling_a_build_stops_the_containers_it_already_made(fake, session, tmp_path, monkeypatch):
    lab = _build(session, tmp_path)
    monkeypatch.setattr(build_runner.hostenv, "is_windows", lambda: False)
    monkeypatch.setattr(build_runner.os, "killpg", lambda *a: None, raising=False)
    monkeypatch.setattr(build_runner.os, "kill", lambda *a: None)
    result = build_runner.stop_build(Path(lab.workspace_path), kill_timeout_s=0.1)
    assert result["phase"] == "aborted"
    assert fake.halts == 1


def test_destroy_tears_down_then_removes_workspace_and_row(fake, session, tmp_path):
    lab = _build(session, tmp_path)
    _finish_build(lab)
    ws = Path(lab.workspace_path)
    build_runner.destroy_lab(lab, session)
    assert fake.teardowns == 1
    assert fake.halts == 0
    assert not ws.exists()
    assert session.get(Lab, lab.id) is None


def test_failed_destroy_keeps_the_lab_unless_forced(fake, session, tmp_path):
    lab = _build(session, tmp_path)
    _finish_build(lab)
    fake.teardown_ok = False
    with pytest.raises(build_runner.DestroyFailed, match="stuck"):
        build_runner.destroy_lab(lab, session)
    assert session.get(Lab, lab.id).status == "destroy_failed"
    build_runner.destroy_lab(lab, session, force=True)
    assert session.get(Lab, lab.id) is None


def test_api_restart_restarts_the_heartbeat_daemon_of_running_labs(fake, session, tmp_path):
    lab = _build(session, tmp_path)
    lab.status = "running"
    session.add(lab)
    session.commit()
    fake.daemons = 0
    assert build_runner.reattach_daemons(session) == 1
    assert fake.daemons == 1


def test_labforge_agent_is_importable_by_the_api_environment():
    # The build runner starts the heartbeat daemon with this interpreter; without the
    # package every Docker lab shows 0/0 machines in the monitor.
    from labforge_agent import daemon

    assert callable(daemon.spawn_detached)


def test_halt_and_resume_routes(fake, session, tmp_path):
    lab = _build(session, tmp_path)
    _finish_build(lab)
    lab.status = "running"
    session.add(lab)
    session.commit()
    app = FastAPI()
    app.include_router(labs_router.router, prefix="/api/v1")
    app.dependency_overrides[get_session] = lambda: session
    client = TestClient(app)

    assert client.post(f"/api/v1/labs/{lab.id}/halt").json()["status"] == "stopped"
    assert client.post(f"/api/v1/labs/{lab.id}/resume").json()["status"] == "building"
    assert client.post(f"/api/v1/labs/{lab.id}/resume").status_code == 409
    assert client.post("/api/v1/labs/999/halt").status_code == 404
    fake.halt_ok = False
    session.get(Lab, lab.id).status = "running"
    assert client.post(f"/api/v1/labs/{lab.id}/halt").json()["detail"]["code"] == "halt_failed"


def test_build_shim_drops_pull_progress_noise_and_writes_the_exit_file(tmp_path):
    import subprocess
    import sys

    noisy = (
        "import sys\n"
        "print('Container x Creating')\n"
        "for i in range(500):\n"
        "    print(' 7084f65aba35 Downloading ' + str(i) + 'MB')\n"
        "print('Container x Started')\n"
    )
    script = tmp_path / "noisy.py"
    script.write_text(noisy, encoding="utf-8")
    shim = tmp_path / "shim.py"
    shim.write_text(build_runner._BUILD_SHIM, encoding="utf-8")
    import json

    out = subprocess.run(
        [sys.executable, str(shim), str(tmp_path), json.dumps([sys.executable, str(script)])],
        capture_output=True, text=True, check=True,
    ).stdout
    assert "Container x Creating" in out and "Container x Started" in out
    assert out.count("Downloading") <= 2
    code, _stamp = (tmp_path / ".build.exit").read_text().split()
    assert code == "0"


def test_endpoints_are_read_back_from_a_built_workspace(tmp_path):
    from labforge_core.services.compose_generator import build_bundle, endpoints_from_workspace

    files, _ = build_bundle(get_template("ransomware-intrusion-linux-lab"), project="lf7-x", port_free=lambda p: p != 9200)
    for rel, content in files.items():
        target = tmp_path / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(content if isinstance(content, bytes) else content.encode())

    found = {ep["host"]: ep for ep in endpoints_from_workspace(tmp_path)}
    assert found["kibana"]["url"] == "http://127.0.0.1:5601/"
    assert found["kibana"]["label"] == "Kibana"
    assert found["elastic"]["host_port"] == 10200  # 9200 was busy
    assert endpoints_from_workspace(tmp_path / "missing") == []


def test_endpoints_route(fake, session, tmp_path):
    lab = _build(session, tmp_path)
    app = FastAPI()
    app.include_router(labs_router.router, prefix="/api/v1")
    app.dependency_overrides[get_session] = lambda: session
    client = TestClient(app)
    urls = {ep["label"]: ep["url"] for ep in client.get(f"/api/v1/labs/{lab.id}/endpoints").json()}
    assert urls["Kibana"].startswith("http://127.0.0.1:")
    assert client.get("/api/v1/labs/404/endpoints").status_code == 404


def test_lifecycle_routes_are_rate_limited(fake, session, tmp_path):
    from labforge_core.api import rate_limit

    rate_limit.reset_for_tests()
    app = FastAPI()
    app.include_router(labs_router.router, prefix="/api/v1")
    app.dependency_overrides[get_session] = lambda: session
    client = TestClient(app)
    codes = [client.post("/api/v1/labs/999/halt").status_code for _ in range(22)]
    assert codes[:20] == [404] * 20
    assert codes[20:] == [429, 429]
    body = client.post("/api/v1/labs/999/halt").json()
    assert body["detail"]["code"] == "rate_limited"
    # The build trigger has its own, tighter bucket.
    builds = [client.post("/api/v1/labs/build", json={}).status_code for _ in range(8)]
    assert builds[-1] == 429
    rate_limit.reset_for_tests()


def test_absurd_lab_ids_are_rejected_not_a_500(fake, session):
    app = FastAPI()
    app.include_router(labs_router.router, prefix="/api/v1")
    app.dependency_overrides[get_session] = lambda: session
    client = TestClient(app)
    for path in ("", "/build/status", "/endpoints", "/topology", "/heartbeat"):
        assert client.get(f"/api/v1/labs/99999999999999999999{path}").status_code == 422, path
        assert client.get(f"/api/v1/labs/0{path}").status_code == 422, path
    assert client.post("/api/v1/labs/99999999999999999999/halt").status_code == 422
