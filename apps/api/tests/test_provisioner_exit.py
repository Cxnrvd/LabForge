"""A provisioner that could not install something must not report success."""

from __future__ import annotations

import shutil
import subprocess
from types import SimpleNamespace

import pytest

from labforge_core.services import generator
from labforge_core.services.template_loader import get_template


def _working_bash() -> str | None:
    # On Windows `bash` can be the WSL launcher stub, which exists but cannot run anything.
    for candidate in (shutil.which("bash"), r"C:/Program Files/Git/bin/bash.exe"):
        if not candidate:
            continue
        try:
            probe = subprocess.run([candidate, "-c", "echo ok"], capture_output=True, text=True, timeout=20)
        except (OSError, subprocess.TimeoutExpired):
            continue
        if probe.returncode == 0 and probe.stdout.strip() == "ok":
            return candidate
    return None


BASH = _working_bash()


def _render(blocks, cves=()):
    topology = get_template("basic-ad")
    node = next(n for n in topology.nodes if not generator.is_windows(n))
    env = generator._jinja_env()
    text = env.get_template("provision_linux.sh.j2").render(
        node=node,
        is_dc=False,
        cve_blocks=[SimpleNamespace(cve_id=c[0], description="test", script=c[1]) for c in cves],
        install_blocks=[SimpleNamespace(label=label, body=body, description="test") for label, body in blocks],
        endpoints={},
    )
    return text


def _run(text, tmp_path):
    # Drop the parts that need a real VM; keep the block handling and the exit logic.
    text = text.replace("hostnamectl", "true #").replace("| chpasswd", "| cat >/dev/null")
    text = text.replace("LOG=/var/log/labforge-provision.log", f"LOG={tmp_path}/p.log")
    script = tmp_path / "p.sh"
    script.write_text(text, encoding="utf-8", newline="\n")
    return subprocess.run([BASH, str(script)], capture_output=True, text=True)


@pytest.mark.skipif(BASH is None, reason="bash not available")
def test_all_blocks_ok_exits_zero(tmp_path):
    r = _run(_render([("good", "echo fine")]), tmp_path)
    assert r.returncode == 0, r.stdout + r.stderr
    assert "provisioner complete" in r.stdout


@pytest.mark.skipif(BASH is None, reason="bash not available")
def test_a_failing_role_makes_the_provisioner_fail_but_later_blocks_still_run(tmp_path):
    r = _run(_render([("broken", "echo before\nfalse\necho not-reached"), ("after", "echo after-ran")]), tmp_path)
    assert r.returncode == 1, r.stdout + r.stderr
    assert "role 'broken' FAILED" in r.stdout
    assert "not-reached" not in r.stdout
    assert "after-ran" in r.stdout
    assert "FINISHED WITH ERRORS" in r.stdout


@pytest.mark.skipif(BASH is None, reason="bash not available")
def test_a_failing_cve_script_fails_the_provisioner(tmp_path):
    r = _run(_render([], cves=[("CVE-2099-0001", "exit 3")]), tmp_path)
    assert r.returncode == 1, r.stdout + r.stderr
    assert "CVE CVE-2099-0001 FAILED with exit code 3" in r.stdout


def test_windows_template_reports_failed_roles():
    topology = get_template("basic-ad")
    node = next(n for n in topology.nodes if generator.is_windows(n))
    text = generator._jinja_env().get_template("provision_windows.ps1.j2").render(
        node=node,
        is_dc=False,
        cve_blocks=[],
        install_blocks=[SimpleNamespace(label="r", body="throw 'x'", description="test")],
        endpoints={},
    )
    assert "$failed += " in text
    assert "exit 1" in text
