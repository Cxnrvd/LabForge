"""The heartbeat daemon must survive log bytes the Windows code page cannot decode."""

from __future__ import annotations

import json
import subprocess
import sys

from labforge_agent import daemon

UTF8_LOG = "import sys; sys.stdout.buffer.write(bytes([0xe2, 0x9d, 0xaf]) + b' Starting Windows' + bytes([10, 0x9d, 10]))"


def _fake_docker(monkeypatch):
    real_run = subprocess.run

    def run(cmd, **kwargs):
        # Same keyword arguments the daemon passes (text, encoding, errors), different program.
        return real_run([sys.executable, "-c", UTF8_LOG], **kwargs)

    monkeypatch.setattr(daemon.subprocess, "run", run)
    monkeypatch.setattr(daemon, "_compose_project", lambda ws: "lf1-test")


def test_log_tail_decodes_utf8_and_junk_bytes(monkeypatch, tmp_path):
    _fake_docker(monkeypatch)
    lines = daemon._compose_log_tail(tmp_path)
    assert any("Starting Windows" in ln for ln in lines)


def test_one_bad_sample_does_not_kill_the_daemon(monkeypatch, tmp_path):
    (tmp_path / "docker-compose.yml").write_text("services: {}\n")
    (tmp_path / ".build.exit").write_text("0\n1\n")
    (tmp_path / "topology.json").write_text('{"nodes": []}')

    def boom(ws):
        raise UnicodeDecodeError("charmap", b"\x9d", 0, 1, "undefined")

    monkeypatch.setattr(daemon, "_compose_status", boom)
    monkeypatch.setattr(daemon, "_detect_capture_ifaces", lambda ip_map: [])
    assert daemon.run(lab_id=1, workspace=tmp_path, api_base="http://127.0.0.1:9", one_shot=True) == 0


def test_ansi_colour_codes_are_stripped_from_the_log_tail(monkeypatch, tmp_path):
    real_run = subprocess.run
    esc = chr(27)
    prog = f"print({esc!r} + '[1;34mDownloading Windows 10' + {esc!r} + '[0m')"

    def run(cmd, **kwargs):
        return real_run([sys.executable, "-c", prog], **kwargs)

    monkeypatch.setattr(daemon.subprocess, "run", run)
    monkeypatch.setattr(daemon, "_compose_project", lambda ws: "lf1-test")
    assert daemon._compose_log_tail(tmp_path) == ["Downloading Windows 10"]


def test_a_windows_container_is_installing_until_the_guest_answers(monkeypatch, tmp_path):
    rows = [
        {"Service": "elastic", "Name": "p-elastic-1", "State": "running", "Health": "healthy", "Image": "elastic:8"},
        {"Service": "ws", "Name": "p-ws-1", "State": "running", "Health": "", "Image": "dockurr/windows:latest"},
    ]

    class Done:
        returncode = 0
        stdout = json.dumps(rows)

    monkeypatch.setattr(daemon.subprocess, "run", lambda *a, **k: Done())
    monkeypatch.setattr(daemon, "_compose_project", lambda ws: "p")
    daemon._WINDOWS_READY.clear()
    ready = {"value": False}
    monkeypatch.setattr(daemon, "_windows_ready", lambda name: ready["value"])

    status, vms = daemon._compose_status(tmp_path)
    states = {v["hostname"]: v["state"] for v in vms}
    assert states == {"elastic": "running", "ws": "installing"} and status == "partial"

    ready["value"] = True
    status, vms = daemon._compose_status(tmp_path)
    assert {v["state"] for v in vms} == {"running"} and status == "running"


def test_never_built_reads_the_notes_the_build_already_wrote(tmp_path):
    """compose_generator.build_bundle writes notes/<hostname>.txt for every node Docker skipped
    (compose_generator.coverage_from_fallback_notes, apps/api). The daemon posts that straight
    through rather than re-deriving which nodes were dropped."""
    notes = tmp_path / "notes"
    notes.mkdir()
    (notes / "DC01.txt").write_text("DC01 (domain_controller, windows_server_2019) needs a full VM.\n")
    (notes / "fw01.txt").write_text("fw01 (firewall, ubuntu_2204) has no role here that runs in Docker.\n")
    out = daemon._never_built(tmp_path)
    assert out == [
        {"hostname": "DC01", "reason": "DC01 (domain_controller, windows_server_2019) needs a full VM."},
        {"hostname": "fw01", "reason": "fw01 (firewall, ubuntu_2204) has no role here that runs in Docker."},
    ]


def test_never_built_is_empty_when_nothing_was_skipped(tmp_path):
    assert daemon._never_built(tmp_path) == []  # no notes/ dir at all (Vagrant workspace, or a clean Docker build)
    (tmp_path / "notes").mkdir()
    assert daemon._never_built(tmp_path) == []  # notes/ exists but nothing in it


def test_heartbeat_payload_carries_never_built(monkeypatch, tmp_path):
    (tmp_path / "docker-compose.yml").write_text("services: {}\n")
    (tmp_path / ".build.exit").write_text("0\n1\n")
    (tmp_path / "topology.json").write_text('{"nodes": []}')
    (tmp_path / "notes").mkdir()
    (tmp_path / "notes" / "DC01.txt").write_text("needs a full VM.\n")
    posted = {}

    class FakeClient:
        def __init__(self, *a, **k):
            pass

        def post(self, path, json):
            posted.update(json)

        def close(self):
            pass

    monkeypatch.setattr(daemon.httpx, "Client", FakeClient)
    monkeypatch.setattr(daemon, "_compose_status", lambda ws: ("running", []))
    monkeypatch.setattr(daemon, "_detect_capture_ifaces", lambda ip_map: [])
    daemon.run(lab_id=1, workspace=tmp_path, api_base="http://127.0.0.1:9", one_shot=True)
    assert posted["never_built"] == [{"hostname": "DC01", "reason": "needs a full VM."}]
