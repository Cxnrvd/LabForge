"""What a build can reuse and what it must fetch. Docker and Vagrant are mocked."""

from __future__ import annotations

import subprocess

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from labforge_core.api.routers import labs as labs_router
from labforge_core.services import compose_generator, images
from labforge_core.services.template_loader import get_template

ES = "docker.elastic.co/elasticsearch/elasticsearch:8.15.3"
KIBANA = "docker.elastic.co/kibana/kibana:8.15.3"
LOG = "labforge/log-replay:a4d32c15deda"
ANALYST = "labforge/analyst-workstation:193b94e6f790"
KALI = "kalilinux/kali-rolling:latest"
TEMPLATE = "ransomware-intrusion-lab"


def _row(ref: str, size: str = "1GB") -> dict[str, str]:
    repo, tag = ref.rsplit(":", 1)
    return {"Repository": repo, "Tag": tag, "Size": size, "CreatedAt": "2026-09-01"}


class Local:
    """What this pretend computer has: Docker images, volumes and Vagrant boxes."""

    def __init__(self) -> None:
        self.docker: dict[str, dict[str, str]] = {}
        self.volumes: dict[str, dict] = {}
        self.boxes: dict[str, str] = {}
        self.engine = True
        self.started: list[tuple[str, str]] = []
        self.commands: list[list[str]] = []

    def add(self, *refs: str) -> None:
        for ref in refs:
            row = _row(ref)
            self.docker[ref] = row
            if row["Tag"] == "latest":
                self.docker[row["Repository"]] = row


@pytest.fixture
def local(monkeypatch):
    state = Local()

    def run(args, timeout=60):
        state.commands.append(list(args))
        rc = 0 if state.engine else 1
        return subprocess.CompletedProcess(args, rc, "", "")

    monkeypatch.setattr(images, "_docker", run)
    monkeypatch.setattr(images, "_docker_images", lambda: dict(state.docker))
    monkeypatch.setattr(images, "_volumes", lambda: dict(state.volumes))
    monkeypatch.setattr(images, "_vagrant_boxes", lambda: dict(state.boxes))
    monkeypatch.setattr(images.preflight, "docker_disk", lambda: {"free_gb": 500.0})

    def fake_start(image_id, action, target):
        state.started.append((image_id, action))
        return images.Job(image_id, action)

    monkeypatch.setattr(images, "_start", fake_start)
    images._JOBS.clear()
    images.clear_cache()
    return state


def _volume(os_id: str, name: str = "win10-golden") -> dict:
    return {"labels": {"labforge.golden": "true", "labforge.golden.os": os_id, "labforge.golden.name": name}, "size_mb": 9000.0}


def test_nothing_local_means_every_image_is_pulled_or_built(local):
    plan = images.plan(get_template(TEMPLATE))
    assert set(plan["missing_ids"]) == {ES, KIBANA, LOG, ANALYST, KALI, "windows-10", "dockurr/windows:latest"}
    assert plan["present_ids"] == []


def test_only_the_missing_images_are_queued(local):
    local.add(ES, KIBANA, LOG)
    queued = images.prepare(TEMPLATE)
    assert set(queued) == {ANALYST, KALI, "windows-10", "dockurr/windows:latest"}
    assert {i for i, _ in local.started} == set(queued)
    assert ES not in {i for i, _ in local.started}


def test_second_build_downloads_nothing(local):
    local.add(ES, KIBANA, LOG, ANALYST, KALI, "dockurr/windows:latest")
    local.volumes["labforge-win-base-windows-10"] = {"labels": {"labforge.base": "true"}, "size_mb": 6000.0}
    plan = images.plan(get_template(TEMPLATE))
    assert plan["missing_ids"] == [] and plan["download_mb"] == 0
    assert images.prepare(TEMPLATE) == [] and local.started == []


def test_pull_of_an_image_that_is_already_here_does_nothing(local):
    local.add(ES)
    entry = images.pull(ES)
    assert entry["status"] == "ready" and local.started == []
    images.pull(ES, force=True)  # only when explicitly asked to refresh
    assert local.started == [(ES, "pull")]


def test_a_different_tag_of_the_same_repository_is_outdated_and_gets_pulled(local):
    local.add("docker.elastic.co/elasticsearch/elasticsearch:8.14.0")
    entries = {e["id"]: e for e in images.list_images()["images"]}
    assert entries[ES]["status"] == "outdated" and "8.15.3" in entries[ES]["note"]
    reqs = {r["key"]: r for r in images.requirements(get_template(TEMPLATE))}
    assert reqs[ES]["status"] == "outdated" and reqs[ES]["missing_ids"] == [ES]
    assert ES in images.prepare(TEMPLATE)


def test_a_golden_image_for_the_same_windows_version_replaces_the_base_download(local):
    local.add(ES, KIBANA, LOG, ANALYST, KALI, "dockurr/windows:latest")
    local.volumes["labforge-golden-win10-golden"] = _volume("windows-10")
    reqs = {r["key"]: r for r in images.requirements(get_template(TEMPLATE))}
    assert reqs["windows-10"]["status"] == "ready" and "windows-10" in reqs["windows-10"]["present"]
    assert images.prepare(TEMPLATE) == []
    # another version does not count
    local.volumes["labforge-golden-win10-golden"] = _volume("windows-11")
    assert "windows-10" in images.plan(get_template(TEMPLATE))["missing_ids"]


def test_golden_image_is_listed_with_its_real_size(local):
    local.volumes["labforge-golden-win10-golden"] = _volume("windows-10")
    golden = [e for e in images.list_images()["images"] if e["kind"] == "golden"]
    assert golden[0]["size_mb"] == 9000 and golden[0]["status"] == "ready"


def test_unknown_not_missing_when_docker_is_not_running(local):
    local.engine = False
    reqs = images.requirements(get_template(TEMPLATE))
    assert {r["status"] for r in reqs} == {"unknown"}
    assert images.plan(get_template(TEMPLATE))["engine"] is False
    with pytest.raises(images.ImageError) as err:
        images.prepare(TEMPLATE)
    assert err.value.code == "docker_unavailable"


def test_compose_never_re_pulls_what_is_present():
    topology = get_template(TEMPLATE)
    files, _ = compose_generator.build_bundle(topology, project="lf-x", include_readme=False, include_hosts_file=False)
    import yaml

    services = yaml.safe_load(files["docker-compose.yml"])["services"]
    assert services and all(s.get("pull_policy", "missing") == "missing" for s in services.values())


# ---------------------------------------------------------------- vagrant boxes


def test_vagrant_box_list_is_parsed_with_providers(monkeypatch):
    out = "bento/ubuntu-22.04 (virtualbox, 202401.31.0)\nbento/ubuntu-22.04 (libvirt, 202401.31.0)\ndebian/bookworm64 (virtualbox, 12.20)\n"
    monkeypatch.setattr(images.shutil, "which", lambda name: "/usr/bin/vagrant")
    monkeypatch.setattr(images.subprocess, "run", lambda *a, **k: subprocess.CompletedProcess(a, 0, out, ""))
    assert images._read_vagrant_boxes() == {"bento/ubuntu-22.04": "libvirt,virtualbox", "debian/bookworm64": "virtualbox"}


def test_boxes_are_read_from_the_boxes_folder_when_vagrant_is_not_installed(tmp_path, monkeypatch):
    box = tmp_path / "boxes" / "bento-VAGRANTSLASH-ubuntu-22.04" / "1.0" / "virtualbox"
    box.mkdir(parents=True)
    (box / "box.ovf").write_bytes(b"x" * 2048)
    monkeypatch.setenv("VAGRANT_HOME", str(tmp_path))
    monkeypatch.setattr(images.shutil, "which", lambda name: None)
    assert images._read_vagrant_boxes() == {"bento/ubuntu-22.04": "virtualbox"}


def test_box_state_ready_missing_or_outdated_for_the_wrong_provider():
    assert images._box_state(None, {"virtualbox"}) == "missing"
    assert images._box_state("virtualbox", {"virtualbox"}) == "ready"
    assert images._box_state("libvirt", {"virtualbox"}) == "outdated"
    assert images._box_state("libvirt,virtualbox", {"virtualbox"}) == "ready"


def test_vm_template_only_needs_the_boxes_that_are_not_installed(local):
    topology = get_template("basic-ad")
    needed = {r["ids"][0]: r for r in images.requirements(topology)}
    assert needed and all(r["status"] == "missing" for r in needed.values())
    first = next(iter(needed))
    local.boxes[first[4:]] = "virtualbox"
    after = {r["ids"][0]: r["status"] for r in images.requirements(topology)}
    assert after[first] == "ready" and any(v == "missing" for k, v in after.items() if k != first)


def test_an_installed_box_is_never_added_again(local, monkeypatch):
    calls: list[list[str]] = []
    monkeypatch.setattr(images.subprocess, "run", lambda argv, **k: (calls.append(argv), subprocess.CompletedProcess(argv, 0, "", ""))[1])
    local.boxes["bento/ubuntu-22.04"] = "virtualbox"
    monkeypatch.setattr(images, "_box_requirements", lambda: {"bento/ubuntu-22.04": ({"basic-ad"}, {"virtualbox"})})
    images._box_add("bento/ubuntu-22.04")
    assert calls == []
    local.boxes["bento/ubuntu-22.04"] = "libvirt"  # wrong provider: this one is fetched
    images._box_add("bento/ubuntu-22.04")
    assert calls and calls[0][:5] == ["vagrant", "box", "add", "--provider", "virtualbox"]


# ---------------------------------------------------------------- preflight route


def test_build_preflight_reports_image_readiness_and_the_workspace(local):
    local.add(ES, KIBANA)
    app = FastAPI()
    app.include_router(labs_router.router, prefix="/api/v1")
    body = TestClient(app).get("/api/v1/labs/build/preflight", params={"template_id": TEMPLATE}).json()
    assert body["workspace"]["path"] and body["workspace"]["state"] == "ok"
    states = {r["key"]: r["status"] for r in body["images"]["requirements"]}
    assert states[ES] == "ready" and states[KIBANA] == "ready" and states[KALI] == "missing"
    assert ES in body["images"]["present_ids"] and KALI in body["images"]["missing_ids"]
    assert TestClient(app).get("/api/v1/labs/build/preflight", params={"template_id": "nope"}).status_code == 404
