"""Phase parsing against real `docker compose up --progress plain` output."""

from __future__ import annotations

from pathlib import Path

from labforge_core.services import build_runner

COMPOSE = "services:\n  elastic: {}\n  kibana: {}\n  replay: {}\n"
LOG_RUNNING = """\
 Network lf1-demo_labforge Created
 Container lf1-demo-elastic-1 Creating
 Container lf1-demo-kibana-1 Created
 Container lf1-demo-elastic-1 Started
 Container lf1-demo-elastic-1 Waiting
 Container lf1-demo-elastic-1 Healthy
 Container lf1-demo-kibana-1 Started
"""


def _workspace(tmp_path: Path, log: str) -> Path:
    (tmp_path / "docker-compose.yml").write_text(COMPOSE)
    (tmp_path / ".labforge-project").write_text("lf1-demo\n")
    (tmp_path / build_runner.BUILD_LOG).write_text(log)
    return tmp_path


def test_phases_progress_per_service(tmp_path):
    phases = build_runner.parse_per_vm_phases(_workspace(tmp_path, LOG_RUNNING))
    assert phases["elastic"] == "ready"
    assert phases["kibana"] in {"booting", "provisioning"}
    assert phases.get("replay", "defined") == "defined"


def test_failure_line_marks_service_failed(tmp_path):
    log = LOG_RUNNING + " Container lf1-demo-kibana-1 Error\n"
    phases = build_runner.parse_per_vm_phases(_workspace(tmp_path, log))
    assert phases["kibana"] == "failed"
    assert phases["elastic"] == "ready"
