"""Preflight: busy ports are skipped, and every blocker explains itself with a fix."""

from __future__ import annotations

import socket

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from labforge_core.api.routers import host as host_router
from labforge_core.services import compose_generator, docker_runtime, preflight
from labforge_core.services.template_loader import get_template

GB = 1024**3


@pytest.fixture
def healthy(monkeypatch):
    monkeypatch.setattr(
        docker_runtime,
        "runtime_status",
        lambda: {
            "docker_available": True,
            "docker_daemon": True,
            "docker_version": "29.0",
            "compose_version": "2.40",
            "compose_supported": True,
            "detail": None,
        },
    )
    monkeypatch.setattr(preflight, "docker_memory_mb", lambda: 16000)
    monkeypatch.setattr(preflight, "kvm_in_docker", lambda: True)
    monkeypatch.setattr(preflight, "docker_disk", lambda: {"path": "D:\\docker", "free_gb": 200.0, "total_gb": 500.0})
    monkeypatch.setattr(preflight, "_labforge_published_ports", lambda: set())
    monkeypatch.setattr(preflight, "host_port_free", lambda p: True)


def _by_id(report):
    return {c["id"]: c for c in report["checks"]}


def test_busy_port_is_skipped():
    taken: set[int] = set()
    assert compose_generator._pick_host_port(9200, taken, lambda p: p != 9200) == 10200
    assert compose_generator._pick_host_port(9200, taken, lambda p: p != 9200) == 11200


def test_host_port_free_sees_a_listener():
    with socket.socket() as srv:
        srv.bind(("127.0.0.1", 0))
        srv.listen()
        busy = srv.getsockname()[1]
        assert compose_generator.host_port_free(busy) is False
    assert compose_generator.host_port_free(busy) is True


def test_build_moves_a_busy_port_and_says_so():
    topology = get_template("ransomware-intrusion-lab")
    art = compose_generator.render(topology, port_free=lambda p: p != 9200)
    assert any(host_port == 10200 for ports in art.published_ports.values() for host_port, _ in ports)
    assert any("10200" in w for w in art.warnings)
    assert "127.0.0.1:10200:9200" in art.compose_yaml


def test_everything_ok(healthy):
    report = preflight.run(windows_guests=1, memory_needed_mb=6000, ports=[])
    assert report["ready"] is True
    assert {c["status"] for c in report["checks"]} <= {"ok", "warn"}


def test_docker_not_running_says_how_to_start_it(healthy, monkeypatch):
    monkeypatch.setattr(
        docker_runtime,
        "runtime_status",
        lambda: {"docker_available": True, "docker_daemon": False, "detail": "pipe not found", "compose_supported": False},
    )
    check = _by_id(preflight.run(ports=[]))["docker"]
    assert check["status"] == "fail"
    assert "Start Docker Desktop" in check["fix"]


def test_docker_missing(healthy, monkeypatch):
    monkeypatch.setattr(
        docker_runtime,
        "runtime_status",
        lambda: {"docker_available": False, "docker_daemon": False, "detail": None, "compose_supported": False},
    )
    check = _by_id(preflight.run(ports=[]))["docker"]
    assert check["status"] == "fail" and "Install Docker Desktop" in check["fix"]


def test_low_docker_memory_gives_the_wslconfig_fix(healthy, monkeypatch):
    monkeypatch.setattr(preflight, "docker_memory_mb", lambda: 2048)
    check = _by_id(preflight.run(memory_needed_mb=3000, ports=[]))["docker_memory"]
    assert check["status"] == "fail"
    assert ".wslconfig" in check["fix"] and "wsl --shutdown" in check["fix"]


def test_tight_docker_memory_is_only_a_warning(healthy, monkeypatch):
    monkeypatch.setattr(preflight, "docker_memory_mb", lambda: 8000)
    assert _by_id(preflight.run(memory_needed_mb=6500, ports=[]))["docker_memory"]["status"] == "warn"


def test_missing_kvm_blocks_windows_guests_only(healthy, monkeypatch):
    monkeypatch.setattr(preflight, "kvm_in_docker", lambda: False)
    assert _by_id(preflight.run(windows_guests=1, ports=[]))["kvm"]["status"] == "fail"
    assert "kvm" not in _by_id(preflight.run(windows_guests=0, ports=[]))


def test_disk_is_measured_where_docker_keeps_its_data(healthy, monkeypatch):
    monkeypatch.setattr(preflight, "docker_disk", lambda: {"path": "F:\\Docker", "free_gb": 12.0, "total_gb": 500.0})
    check = _by_id(preflight.run(windows_guests=1, ports=[]))["disk"]
    assert check["status"] == "fail" and "F:\\Docker" in check["detail"]
    assert "Disk image location" in check["fix"]


def test_busy_ports_are_a_warning_not_a_blocker(healthy, monkeypatch):
    monkeypatch.setattr(preflight, "host_port_free", lambda p: p != 5601)
    report = preflight.run(ports=[9200, 5601])
    assert _by_id(report)["ports"]["status"] == "warn"
    assert report["ready"] is True


def test_ports_published_by_our_own_labs_are_not_conflicts(healthy, monkeypatch):
    monkeypatch.setattr(preflight, "host_port_free", lambda p: False)
    monkeypatch.setattr(preflight, "_labforge_published_ports", lambda: {9200, 5601})
    assert _by_id(preflight.run(ports=[9200, 5601]))["ports"]["status"] == "ok"


def test_blocking_problem_names_the_check(healthy, monkeypatch):
    monkeypatch.setattr(preflight, "docker_memory_mb", lambda: 2048)
    code, message = preflight.blocking_problem(get_template("ransomware-intrusion-lab"))
    assert code == "preflight_docker_memory"
    assert "wsl --shutdown" in message


def test_blocking_problem_is_none_when_ready(healthy):
    assert preflight.blocking_problem(get_template("ransomware-intrusion-lab")) is None


def test_preflight_route(healthy):
    app = FastAPI()
    app.include_router(host_router.router, prefix="/api/v1")
    body = TestClient(app).get("/api/v1/host/preflight?windows_guests=1&memory_mb=6000").json()
    assert body["ready"] is True
    assert {c["id"] for c in body["checks"]} >= {"docker", "compose", "docker_memory", "kvm", "disk", "ports"}
    assert TestClient(app).get("/api/v1/host/preflight?windows_guests=-1").status_code == 422
