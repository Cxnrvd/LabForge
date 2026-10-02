"""Host metrics service and route."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from labforge_core.services import docker_runtime, hostenv, hostmetrics


@pytest.fixture(autouse=True)
def _fresh_cache():
    hostmetrics._reset_cache()
    yield
    hostmetrics._reset_cache()


def test_sample_shape_and_ranges():
    data = hostmetrics.sample()
    assert set(data) == {"memory", "cpu", "disk", "sampled_at"}
    assert data["memory"]["total_mb"] > 0
    assert 0 <= data["memory"]["percent"] <= 100
    assert 0 <= data["cpu"]["percent"] <= 100
    assert data["cpu"]["cores"] >= 1
    assert data["disk"]["free_gb"] >= 0
    assert data["disk"]["total_gb"] > 0
    assert isinstance(data["disk"]["path"], str)
    assert data["sampled_at"].endswith("Z")


def test_sample_disk_walks_up_to_existing_parent(tmp_path, monkeypatch):
    class _S:
        workspace_root = tmp_path / "missing" / "deeper"

    monkeypatch.setattr(hostmetrics, "get_settings", lambda: _S())
    assert hostmetrics.sample()["disk"]["path"] == str(tmp_path)
    assert not (tmp_path / "missing").exists()


def test_sample_returns_none_when_psutil_fails(monkeypatch):
    import psutil

    def boom(*_a, **_k):
        raise RuntimeError("nope")

    for name in ("virtual_memory", "cpu_percent", "disk_usage"):
        monkeypatch.setattr(psutil, name, boom)
    data = hostmetrics.sample()
    assert data["memory"] == {"total_mb": None, "used_mb": None, "percent": None}
    assert data["cpu"]["percent"] is None
    assert data["disk"]["free_gb"] is None
    assert "sampled_at" in data


def hostmetrics_preflight():
    from labforge_core.services import preflight

    return preflight


def _patch_helpers(monkeypatch):
    calls = {"docker": 0, "vagrant": 0}

    def runtime():
        calls["docker"] += 1
        return {"docker_daemon": True, "docker_version": "27.0.1", "compose_version": "2.29.0"}

    def vagrant():
        calls["vagrant"] += 1
        return "2.4.1"

    monkeypatch.setattr(docker_runtime, "runtime_status", runtime)
    monkeypatch.setattr(hostenv, "vagrant_version", vagrant)
    monkeypatch.setattr(hostenv, "virtualbox_version", lambda: "7.0.18")
    monkeypatch.setattr(hostenv, "hypervisor_present", lambda: None)
    monkeypatch.setattr(hostmetrics_preflight(), "docker_memory_mb", lambda: 16000)
    monkeypatch.setattr(hostmetrics_preflight(), "docker_disk", lambda: {"path": "D:/docker", "free_gb": 100.0, "total_gb": 200.0})
    return calls


def test_engine_values_and_caching(monkeypatch):
    calls = _patch_helpers(monkeypatch)
    first = hostmetrics.engine()
    second = hostmetrics.engine()
    assert first == second == {
        "docker_daemon": True,
        "docker_version": "27.0.1",
        "compose_version": "2.29.0",
        "docker_memory_mb": 16000,
        "docker_disk": {"path": "D:/docker", "free_gb": 100.0, "total_gb": 200.0},
        "vagrant_version": "2.4.1",
        "virtualbox_version": "7.0.18",
        "hypervisor_present": None,
    }
    assert calls == {"docker": 1, "vagrant": 1}
    hostmetrics._reset_cache()
    hostmetrics.engine()
    assert calls["docker"] == 2


def test_engine_never_raises(monkeypatch):
    def boom(*_a, **_k):
        raise OSError("x")

    monkeypatch.setattr(docker_runtime, "runtime_status", boom)
    monkeypatch.setattr(hostenv, "vagrant_version", boom)
    monkeypatch.setattr(hostenv, "virtualbox_version", boom)
    monkeypatch.setattr(hostenv, "hypervisor_present", boom)
    out = hostmetrics.engine()
    assert out["docker_daemon"] is False
    assert out["vagrant_version"] is None


def test_route_returns_all_keys(monkeypatch):
    _patch_helpers(monkeypatch)
    from labforge_core.api.main import app

    resp = TestClient(app).get("/api/v1/host/metrics")
    assert resp.status_code == 200
    body = resp.json()
    assert set(body) == {"memory", "cpu", "disk", "sampled_at", "engine"}
    assert body["engine"]["docker_daemon"] is True
