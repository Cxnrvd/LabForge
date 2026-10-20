"""guest_exec must not fall into the slow `vagrant ssh` path just because the wrong ssh.exe was found."""

from __future__ import annotations

import subprocess

from labforge_core.services import build_runner as br


def test_windows_prefers_git_ssh_over_the_builtin_openssh(monkeypatch, tmp_path):
    git_ssh = tmp_path / "ssh.exe"
    git_ssh.write_text("")
    monkeypatch.setattr(br.hostenv, "is_windows", lambda: True)
    monkeypatch.setattr(br, "_GIT_SSH_CANDIDATES", (tmp_path / "missing.exe", git_ssh))
    monkeypatch.setattr(br.shutil, "which", lambda name: r"C:\Windows\System32\OpenSSH\ssh.exe")
    assert br._ssh_binary() == str(git_ssh)


def test_falls_back_to_path_ssh_when_git_is_absent(monkeypatch, tmp_path):
    monkeypatch.setattr(br.hostenv, "is_windows", lambda: True)
    monkeypatch.setattr(br, "_GIT_SSH_CANDIDATES", (tmp_path / "nope.exe",))
    monkeypatch.setattr(br.shutil, "which", lambda name: "/usr/bin/ssh")
    assert br._ssh_binary() == "/usr/bin/ssh"


def test_non_windows_uses_path_ssh(monkeypatch):
    monkeypatch.setattr(br.hostenv, "is_windows", lambda: False)
    monkeypatch.setattr(br.shutil, "which", lambda name: "/usr/bin/ssh")
    assert br._ssh_binary() == "/usr/bin/ssh"


def test_rejected_key_goes_straight_to_vagrant_without_a_slow_refresh(monkeypatch, tmp_path):
    refreshes: list[bool] = []

    def fake_info(ws, host, *, refresh=False):
        refreshes.append(refresh)
        return {"HostName": "127.0.0.1", "Port": "2222", "User": "vagrant", "IdentityFile": "k"}

    monkeypatch.setattr(br, "_ssh_binary", lambda: "ssh")
    monkeypatch.setattr(br, "_ssh_info", fake_info)
    calls: list[list[str]] = []

    def fake_run_killtree(argv, **k):
        calls.append(argv)
        if argv[0] == "ssh":
            return subprocess.CompletedProcess(argv, 255, "", "WARNING: UNPROTECTED PRIVATE KEY FILE!")
        return subprocess.CompletedProcess(argv, 0, "ok", "")

    monkeypatch.setattr(br, "_run_killtree", fake_run_killtree)
    proc = br.guest_exec(tmp_path, "ap-target", "true")
    assert proc.stdout == "ok"
    assert len(calls) == 2
    assert calls[0][0] == "ssh"
    assert calls[1][:3] == ["vagrant", "ssh", "ap-target"]
    assert refreshes == [False]
