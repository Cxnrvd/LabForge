"""Image library with a mocked Docker layer."""

from __future__ import annotations

import json
import subprocess
import time
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlmodel import Session, SQLModel, create_engine
from sqlmodel.pool import StaticPool

from labforge_core.api.routers import images as images_router
from labforge_core.models import get_session
from labforge_core.services import compose_generator, docker_runtime, images
from labforge_core.services.template_loader import get_template

ES = "docker.elastic.co/elasticsearch/elasticsearch:8.15.3"


class FakeDocker:
    def __init__(self) -> None:
        self.calls: list[list[str]] = []
        self.volumes: set[str] = set()
        self.fail_copy = False

    def run(self, args, timeout=60):
        self.calls.append(list(args))
        rc, out = 0, ""
        if args[:2] == ["volume", "inspect"]:
            rc = 0 if args[2] in self.volumes else 1
        elif args[:2] == ["volume", "create"]:
            self.volumes.add(args[-1])
        elif args[:2] == ["volume", "rm"]:
            self.volumes.discard(args[-1])
        elif args[0] == "run" and "cp -a --sparse=always /from/. /to/" in args:
            rc = 1 if self.fail_copy else 0
        return subprocess.CompletedProcess(args, rc, out, "boom" if rc else "")


@pytest.fixture
def fake(monkeypatch):
    f = FakeDocker()
    monkeypatch.setattr(images, "_docker", f.run)
    monkeypatch.setattr(images, "_docker_images", lambda: {ES: {"Size": "1.96GB", "CreatedAt": "2026-09-01"}})
    monkeypatch.setattr(images, "_volumes", lambda: {})
    monkeypatch.setattr(images, "_vagrant_boxes", lambda: {})
    monkeypatch.setattr(images.preflight, "docker_disk", lambda: {"free_gb": 100.0})
    images._JOBS.clear()
    images.clear_cache()
    return f


def test_windows_lab_needs_a_windows_base_the_dockurr_image_kali_and_elastic():
    reqs = {r["key"]: r for r in images.topology_images(get_template("ransomware-intrusion-lab"))}
    assert reqs["windows-10"]["nodes"] == ["ws-acc-014", "ws-ops-003"]
    assert reqs["windows-10"]["ids"] == ["windows-10", "dockurr/windows:latest"]
    assert ES in reqs and "kalilinux/kali-rolling:latest" in reqs
    linux = {r["key"] for r in images.topology_images(get_template("ransomware-intrusion-linux-lab"))}
    assert "windows-10" not in linux


def test_listing_marks_ready_and_missing(fake):
    by_id = {e["id"]: e for e in images.list_images()["images"]}
    assert by_id[ES]["status"] == "ready" and by_id[ES]["size_mb"] == 1960
    assert by_id["windows-10"]["status"] == "missing" and by_id["windows-10"]["kind"] == "windows-base"
    assert by_id["kalilinux/kali-rolling:latest"]["status"] == "missing"
    assert "ransomware-intrusion-lab" in by_id[ES]["used_by"]


def test_golden_images_are_listed_from_labelled_volumes(fake, monkeypatch):
    monkeypatch.setattr(
        images,
        "_volumes",
        lambda: {"labforge-golden-finance": {"labels": {"labforge.golden": "true", "labforge.golden.name": "finance"}, "size_mb": 18400}},
    )
    golden = [e for e in images.list_images()["images"] if e["kind"] == "golden"]
    assert golden == [
        {
            "id": "golden-finance", "kind": "golden", "name": "finance", "size_mb": 18400, "status": "ready",
            "used_by": [], "tag": "golden", "note": "Local only. Windows images must not be shared.",
        }
    ]


def test_requirements_report_readiness(fake):
    state = {r["key"]: r["status"] for r in images.requirements(get_template("ransomware-intrusion-lab"))}
    assert state[ES] == "ready" and state["windows-10"] == "missing"


def test_pull_runs_in_the_background_and_reports_progress(fake, monkeypatch):
    import threading

    seen = []
    release = threading.Event()

    def fake_pull(job, ref):
        seen.append(ref)
        job.progress = 50.0
        release.wait(5)

    monkeypatch.setattr(images, "_pull_docker", fake_pull)
    images.pull("kalilinux/kali-rolling:latest")
    entry = next(e for e in images.list_images()["images"] if e["id"] == "kalilinux/kali-rolling:latest")
    assert entry["status"] == "pulling" and entry["progress"] == 50.0
    release.set()
    for _ in range(100):
        if images._JOBS["kalilinux/kali-rolling:latest"].status == "done":
            break
        time.sleep(0.05)
    assert seen == ["kalilinux/kali-rolling:latest"]


def test_failed_pull_is_explained(fake, monkeypatch):
    def boom(job, ref):
        raise images.ImageError("docker pull failed. Check your internet connection.")

    monkeypatch.setattr(images, "_pull_docker", boom)
    images.pull("kalilinux/kali-rolling:latest")
    for _ in range(40):
        if images._JOBS["kalilinux/kali-rolling:latest"].status == "failed":
            break
        time.sleep(0.05)
    entry = next(e for e in images.list_images()["images"] if e["id"] == "kalilinux/kali-rolling:latest")
    assert entry["status"] == "missing" and "internet" in entry["note"]


def test_unknown_image_is_a_404_error(fake):
    with pytest.raises(images.ImageError) as err:
        images.pull("nope/nothing:1")
    assert err.value.status == 404


def test_golden_from_a_base_copies_the_volume_and_labels_it(fake):
    fake.volumes.add("labforge-win-base-windows-10")
    entry = images.create_golden("windows-10", "Finance Victim!")
    assert entry["id"] == "golden-finance-victim"
    for _ in range(40):
        if images._JOBS["golden-finance-victim"].status != "pulling":
            break
        time.sleep(0.05)
    assert images._JOBS["golden-finance-victim"].status == "done"
    create = next(c for c in fake.calls if c[:2] == ["volume", "create"])
    assert "labforge.golden=true" in create and create[-1] == "labforge-golden-finance-victim"
    copy = next(c for c in fake.calls if c[0] == "run")
    assert "labforge-win-base-windows-10:/from:ro" in copy


def test_golden_needs_a_prepared_base_and_a_free_name(fake):
    with pytest.raises(images.ImageError, match="not prepared"):
        images.create_golden("windows-10", "x")
    fake.volumes.update({"labforge-win-base-windows-10", "labforge-golden-x"})
    with pytest.raises(images.ImageError, match="already exists"):
        images.create_golden("windows-10", "x")
    with pytest.raises(images.ImageError):
        images.create_golden("windows-10", "!!!")


def test_failed_copy_removes_the_half_made_golden_volume(fake):
    fake.volumes.add("labforge-win-base-windows-10")
    fake.fail_copy = True
    images.create_golden("windows-10", "broken")
    for _ in range(40):
        if images._JOBS["golden-broken"].status != "pulling":
            break
        time.sleep(0.05)
    assert images._JOBS["golden-broken"].status == "failed"
    assert "labforge-golden-broken" not in fake.volumes


def test_golden_from_a_lab_machine_stops_and_restarts_it(fake):
    fake.volumes.add("lf1-x_ws-storage")
    calls = fake.calls
    orig = fake.run

    def run(args, timeout=60):
        if args[0] == "inspect":
            calls.append(list(args))
            return subprocess.CompletedProcess(args, 0, "true\n", "")
        return orig(args, timeout)

    images._docker = run  # restored by the fixture's monkeypatch on teardown? no: reset below
    try:
        images.create_golden("lab:1:ws", "snap", project_volume_lookup=lambda token: ("lf1-x_ws-storage", "lf1-x-ws-1"))
        for _ in range(40):
            if images._JOBS["golden-snap"].status != "pulling":
                break
            time.sleep(0.05)
    finally:
        images._docker = orig
    names = [c[0] for c in calls]
    assert names.index("stop") < names.index("run") < names.index("start")


def test_remove_uses_the_right_command_per_kind(fake):
    fake.volumes.update({"labforge-win-base-windows-10", "labforge-golden-a"})
    images.remove("windows-10")
    images.remove("golden-a")
    images.remove(ES)
    assert ["volume", "rm", "labforge-win-base-windows-10"] in fake.calls
    assert ["volume", "rm", "labforge-golden-a"] in fake.calls
    assert ["image", "rm", ES] in fake.calls


def test_prepare_queues_only_what_is_missing(fake, monkeypatch):
    queued = []
    monkeypatch.setattr(images, "pull", lambda image_id: queued.append(image_id))
    result = images.prepare("ransomware-intrusion-linux-lab")
    assert ES not in result
    assert result == queued


def test_export_refuses_missing_and_never_pushes(fake):
    with pytest.raises(images.ImageError):
        images.export_stream("windows-10")
    # There is deliberately no code path that uploads an image anywhere.
    source = Path(images.__file__).read_text(encoding="utf-8")
    assert "docker push" not in source and '"push"' not in source


def test_golden_role_creates_a_seed_file_and_the_build_goes_through_the_copy_step(tmp_path):
    topology = get_template("ransomware-intrusion-lab")
    topology.nodes[-1].config.roles = ["golden-image@finance"]
    files, art = compose_generator.build_bundle(topology, project="lf3-x")
    seeds = json.loads(files[".labforge-seeds.json"])
    assert seeds == [{"host": "ws-ops-003", "golden": "finance", "project": "lf3-x"}]
    assert not any("golden-image" in w for w in art.warnings)
    (tmp_path / ".labforge-seeds.json").write_text(files[".labforge-seeds.json"])
    cmd = docker_runtime.up_command("lf3-x", workspace=tmp_path)
    assert cmd[1:4] == ["-m", "labforge_core.services.build_steps", str(tmp_path)]
    assert docker_runtime.up_command("lf3-x", workspace=tmp_path / "none")[0] == "docker"
    no_golden = compose_generator.build_bundle(get_template("ransomware-intrusion-lab"), project="lf3-x")[0]
    assert ".labforge-seeds.json" not in no_golden


def test_seed_volume_is_labelled_for_compose_so_destroy_removes_it(fake):
    fake.volumes.add("labforge-golden-finance")
    name = images.seed_volume("lf3-x", "ws-ops-003", "finance")
    create = next(c for c in fake.calls if c[:2] == ["volume", "create"])
    assert name == "lf3-x_ws-ops-003-storage"
    assert "com.docker.compose.project=lf3-x" in create and "com.docker.compose.volume=ws-ops-003-storage" in create


@pytest.fixture
def client(fake):
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    SQLModel.metadata.create_all(engine)
    app = FastAPI()
    app.include_router(images_router.router, prefix="/api/v1")
    session = Session(engine)
    app.dependency_overrides[get_session] = lambda: session
    return TestClient(app)


def test_routes(client, fake, monkeypatch):
    monkeypatch.setattr(images.docker_runtime, "docker_available", lambda: True)
    body = client.get("/api/v1/images").json()
    assert body["disk_free_gb"] == 100.0 and any(i["id"] == ES for i in body["images"])
    topo = get_template("ransomware-intrusion-linux-lab").model_dump(mode="json")
    req = client.post("/api/v1/images/required", json={"topology": topo}).json()["requirements"]
    assert {r["key"] for r in req} >= {ES}
    assert client.post("/api/v1/images/prepare", json={"template_id": "nope"}).status_code == 404
    assert client.post("/api/v1/images/nope%2Fnothing:1/pull").status_code == 404
    assert client.delete(f"/api/v1/images/{ES.replace('/', '%2F')}").status_code == 204
    assert ["image", "rm", ES] in fake.calls
    assert client.post("/api/v1/images/golden", json={"source_id": "windows-10", "name": "a"}).status_code == 409


def test_export_is_a_local_download(client, fake, monkeypatch):
    monkeypatch.setattr(images, "_stream", lambda cmd: iter([b"tar-bytes"]))
    r = client.post(f"/api/v1/images/{ES}/export")
    assert r.status_code == 200 and r.content == b"tar-bytes"
    assert r.headers["x-labforge-local-only"] == "true"
    assert r.headers["content-disposition"].startswith("attachment")


def test_windows_nodes_start_from_the_downloaded_installer_when_a_base_exists(fake):
    topology = get_template("ransomware-intrusion-lab")
    assert images.base_seeds(topology, "lf4-x", []) == []  # nothing downloaded yet
    fake.volumes.add("labforge-win-base-windows-10")
    seeds = images.base_seeds(topology, "lf4-x", [])
    assert [s["host"] for s in seeds] == ["ws-acc-014", "ws-ops-003"] and seeds[0]["base"] == "windows-10"
    # a node with a golden image keeps it
    only = images.base_seeds(topology, "lf4-x", [{"host": "ws-acc-014", "golden": "g", "project": "lf4-x"}])
    assert [s["host"] for s in only] == ["ws-ops-003"]


def test_seeding_from_a_base_copies_only_the_iso_and_labels_the_volume(fake):
    fake.volumes.add("labforge-win-base-windows-10")
    name = images.seed_base_volume("lf4-x", "ws-acc-014", "windows-10")
    assert name == "lf4-x_ws-acc-014-storage"
    copy = next(c for c in fake.calls if c[0] == "run")
    assert "cp -a --sparse=always *.iso windows.base windows.ver /to/" in copy[-1]
    create = next(c for c in fake.calls if c[:2] == ["volume", "create"])
    assert "com.docker.compose.project=lf4-x" in create
    with pytest.raises(images.ImageError, match="not prepared"):
        images.seed_base_volume("lf4-x", "ws", "windows-11")


def test_adopting_an_installed_guests_iso_as_the_base(fake):
    images.adopt_base("lf1-x_ws-storage", "windows-10")
    assert "labforge-win-base-windows-10" in fake.volumes
    copy = next(c for c in fake.calls if c[0] == "run")
    assert "lf1-x_ws-storage:/from:ro" in copy
    with pytest.raises(images.ImageError, match="already exists"):
        images.adopt_base("lf1-x_ws-storage", "windows-10")


def test_the_build_writes_base_seeds_next_to_the_bundle(tmp_path, monkeypatch):
    from labforge_core.services import build_runner

    monkeypatch.setattr(images, "base_seeds", lambda topology, project, existing: [{"host": "ws-acc-014", "base": "windows-10", "project": project}])
    build_runner._write_docker_bundle(get_template("ransomware-intrusion-lab"), tmp_path, project="lf5-x", publish="loopback")
    seeds = json.loads((tmp_path / ".labforge-seeds.json").read_text())
    assert seeds == [{"host": "ws-acc-014", "base": "windows-10", "project": "lf5-x"}]


def test_a_failed_golden_copy_stays_visible_with_its_reason(fake):
    fake.volumes.add("labforge-win-base-windows-10")
    fake.fail_copy = True
    images.create_golden("windows-10", "oops")
    for _ in range(40):
        if images._JOBS["golden-oops"].status != "pulling":
            break
        time.sleep(0.05)
    entry = next(e for e in images.list_images()["images"] if e["id"] == "golden-oops")
    assert entry["status"] == "missing" and "Last attempt failed" in entry["note"]
