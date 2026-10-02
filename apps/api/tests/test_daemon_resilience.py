"""The heartbeat daemon must survive log bytes the Windows code page cannot decode."""

from __future__ import annotations

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
