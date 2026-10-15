"""Renders each role's provisioner script through the real generator and
actually runs it in a throwaway Linux container.

This exists because the rest of the suite only proves a role's script
*renders* without a Jinja error — it says nothing about whether the bash
inside it actually works on a real box. Three real bugs shipped past a
fully green test suite before this file existed: a sed pattern that matched
a comment but not the config line it was meant to patch, a cert FreeRADIUS's
own unprivileged user couldn't read, and a Realtek-detection check that
silently no-opped because the package providing `lsusb` was never
installed. All three failed instantly the moment the script *ran*
somewhere. This is that "somewhere" — a disposable container, not a VM, so
it's cheap enough to run on every PR.

Run locally: ``pytest -m docker_role -v`` (needs Docker; skips cleanly if
Docker isn't on PATH, same as CI's separate `role-scripts` job expects).

Not covered here: anything needing real wireless hardware (hostapd's actual
AP-mode behavior), anything Windows (needs a Windows container, out of
scope for this harness), and the DKMS wrong-kernel class of bug (needs a
kernel upgrade mid-script to reproduce — containers share the host kernel,
so this can't trigger here; see docs/labs/wifi/wifi-adapter-compatibility.md for
the real-hardware verification that class of bug needs).
"""

from __future__ import annotations

import shutil
import subprocess
import tempfile
from pathlib import Path

import pytest
from labforge_schema import (
    Credentials,
    LabConfig,
    NodeConfig,
    NodeType,
    OsType,
    Position,
    Provider,
    TopologyNode,
)

from labforge_core.services.generator import generate_artifacts

DOCKER_AVAILABLE = shutil.which("docker") is not None
pytestmark = [
    pytest.mark.docker_role,
    pytest.mark.skipif(not DOCKER_AVAILABLE, reason="docker is not on PATH"),
]

_IMAGE = "debian:12"


def _render_role_script(role: str) -> bytes:
    """Build a one-node topology carrying ``role`` and return its rendered
    provisioner script, exactly as a real build would produce it — same
    generator call, same UTF-8 encoding, same LF normalization."""
    node = TopologyNode(
        id="n1",
        type=NodeType.SERVER,
        label="role under test",
        position=Position(x=0, y=0),
        config=NodeConfig(
            os=OsType.DEBIAN_12,
            ip="10.99.0.5",
            hostname="roletest",
            roles=[role],
            credentials=Credentials(username="vagrant", password="ChangeMe123"),
        ),
    )
    topology = LabConfig(
        name="role-script-test",
        network_cidr="10.99.0.0/24",
        provider=Provider.VIRTUALBOX,
        nodes=[node],
    )
    artifacts = generate_artifacts(topology)
    assert artifacts.warnings == [], f"role {role!r} has no curated installer — nothing to test"
    (script_name,) = [f for f in artifacts.provisioner_scripts if f.startswith("provision_roletest")]
    return artifacts.provisioner_scripts[script_name].encode("utf-8")


class _Container:
    """A throwaway Debian container the test can copy a script into and run
    commands against. Always removed, even if the test raises."""

    def __init__(self, image: str = _IMAGE) -> None:
        self.name = f"labforge-role-test-{id(self)}"
        self.image = image

    def __enter__(self) -> _Container:
        subprocess.run(
            ["docker", "run", "-d", "--name", self.name, self.image, "sleep", "600"],
            check=True, capture_output=True, text=True, timeout=60,
        )
        return self

    def __exit__(self, *exc: object) -> None:
        subprocess.run(["docker", "rm", "-f", self.name], capture_output=True, timeout=30)

    def run_script(self, script: bytes, *, timeout: int = 180) -> subprocess.CompletedProcess[str]:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "role.sh"
            path.write_bytes(script)
            subprocess.run(["docker", "cp", str(path), f"{self.name}:/role.sh"], check=True, capture_output=True, timeout=30)
        return subprocess.run(
            ["docker", "exec", self.name, "bash", "/role.sh"],
            capture_output=True, text=True, timeout=timeout,
        )

    def exec(self, *cmd: str, timeout: int = 30) -> subprocess.CompletedProcess[str]:
        return subprocess.run(["docker", "exec", self.name, *cmd], capture_output=True, text=True, timeout=timeout)


def test_freeradius_actually_authenticates() -> None:
    """The role must leave a FreeRADIUS that (a) passes its own config
    check and (b) actually authenticates the documented test identity —
    not just "the install command exited 0"."""
    script = _render_role_script("freeradius")
    with _Container() as c:
        result = c.run_script(script, timeout=180)
        assert result.returncode == 0, result.stdout + result.stderr

        check = c.exec("freeradius", "-C")
        assert check.returncode == 0, "freeradius config check failed:\n" + check.stdout + check.stderr

        # radtest against 127.0.0.1 hits the box's pre-existing "client
        # localhost" stanza (secret: testing123), not the role's own
        # 0.0.0.0/0 NAS entry — a real AP's request would come from a LAN
        # IP and match the role's entry instead. Both paths share the same
        # user database, so this still proves the identity/auth chain
        # works end to end.
        auth = c.exec(
            "sh", "-c",
            "freeradius -f -l /tmp/radiusd.log & sleep 2; "
            "radtest labforge LabForgeDemo123 127.0.0.1 1812 testing123",
            timeout=30,
        )
        assert "Access-Accept" in auth.stdout, auth.stdout + auth.stderr

        # The EAP-TLS cert chain must actually validate against the CA this
        # role claims to have wired into eap.conf — not just exist on disk.
        verify = c.exec(
            "openssl", "verify", "-CAfile", "/opt/labforge/freeradius-client-certs/ca.pem",
            "/etc/freeradius/3.0/certs/client.crt",
        )
        assert "OK" in verify.stdout, verify.stdout + verify.stderr


def test_captive_portal_vulnerabilities_are_live() -> None:
    """Each documented vulnerability must actually be exploitable against
    the running app, not just present in the source as intent."""
    script = _render_role_script("captive-portal")
    with _Container() as c:
        result = c.run_script(script, timeout=90)
        assert result.returncode == 0, result.stdout + result.stderr

        # The role itself has no reason to install curl (it's a Flask app,
        # not an HTTP client) — this test needs it to probe the app, same
        # as a presenter would with their own tooling against the real VM.
        c.exec("apt-get", "install", "-y", "-qq", "curl", timeout=60)
        c.exec("sh", "-c", "python3 /opt/labforge/captive-portal/app.py > /tmp/flask.log 2>&1 &")
        c.exec("sh", "-c", "sleep 2")

        xss = c.exec("curl", "-s", "http://127.0.0.1/?name=<script>alert(1)</script>")
        assert "<script>alert(1)</script>" in xss.stdout, "reflected XSS payload was not echoed back unescaped"

        sqli = c.exec(
            "curl", "-s", "-X", "POST", "http://127.0.0.1/login",
            "-d", "mac=x' OR '1'='1", "-d", "name=probe",
        )
        assert "Authorized" in sqli.stdout, sqli.stdout

        c.exec("curl", "-s", "http://127.0.0.1/authorize?mac=aa:bb:cc:dd:ee:ff")
        status = c.exec("curl", "-s", "http://127.0.0.1/status?mac=aa:bb:cc:dd:ee:ff")
        assert status.stdout.strip() == "authorized", "MAC-spoofing bypass path is broken"

        admin_denied = c.exec("curl", "-s", "-o", "/dev/null", "-w", "%{http_code}", "http://127.0.0.1/admin")
        assert admin_denied.stdout.strip() == "403"
        admin_bypassed = c.exec("curl", "-s", "-H", "Host: portal.internal", "http://127.0.0.1/admin")
        assert admin_bypassed.returncode == 0 and "forbidden" not in admin_bypassed.stdout.lower()


def test_hostapd_degrades_gracefully_without_a_wireless_adapter() -> None:
    """No container has a real wireless NIC — the role must say so clearly
    and exit 0, not crash the provisioner for every node that carries it
    before a real adapter is ever passed through."""
    script = _render_role_script("hostapd")
    with _Container() as c:
        result = c.run_script(script, timeout=120)
        assert result.returncode == 0, result.stdout + result.stderr
        assert "No wireless interface found" in result.stdout


def test_wazuh_agent_journald_and_fim_config_is_idempotent() -> None:
    """The agent's ossec.conf patch (journald ingestion + extended FIM
    paths) must actually land, stay valid XML, and not duplicate itself on
    a second provision — the exact failure mode a bad sed pattern produces
    silently (see test_captive_portal_vulnerabilities_are_live's sibling
    bugs: a sed that matches nothing just looks like success)."""
    script = _render_role_script("wazuh")
    with _Container() as c:
        result = c.run_script(script, timeout=150)
        assert result.returncode == 0, result.stdout + result.stderr

        conf = c.exec("cat", "/var/ossec/etc/ossec.conf")
        assert conf.returncode == 0, "ossec.conf should exist after a real wazuh-agent install"
        assert conf.stdout.count("log_format>journald") == 1
        assert "/root/.ssh,/home" in conf.stdout

        c.exec("apt-get", "install", "-y", "-qq", "python3", timeout=60)
        # ossec.conf legitimately holds several concatenated
        # <ossec_config>...</ossec_config> blocks, which Wazuh's own
        # parser merges but which isn't single-root XML — wrap in a
        # synthetic root before validating, same as Wazuh effectively does.
        validate = c.exec(
            "python3", "-c",
            "import xml.etree.ElementTree as ET; "
            "data = open('/var/ossec/etc/ossec.conf').read(); "
            "ET.fromstring('<root>' + data + '</root>'); "
            "print('ok')",
        )
        assert validate.stdout.strip() == "ok", "patched ossec.conf is not well-formed XML: " + validate.stderr

        second = c.run_script(script, timeout=60)
        assert second.returncode == 0, second.stdout + second.stderr
        conf2 = c.exec("cat", "/var/ossec/etc/ossec.conf")
        assert conf2.stdout.count("log_format>journald") == 1, "re-provisioning duplicated the journald block"


def test_wifi_pentest_env_installs_only_diagnostics() -> None:
    """Mirrors tests/test_generator.py's static check, but against the
    actual installed package set — belt and suspenders for the one
    boundary this role exists to enforce."""
    script = _render_role_script("wifi-pentest-env")
    with _Container() as c:
        result = c.run_script(script, timeout=120)
        assert result.returncode == 0, result.stdout + result.stderr
        for forbidden in ("aircrack-ng", "hostapd", "wifite", "hcxtools", "hashcat"):
            check = c.exec("sh", "-c", f"dpkg -s {forbidden} 2>/dev/null | grep -q installed && echo FOUND || echo NOTFOUND")
            assert check.stdout.strip() == "NOTFOUND", f"wifi-pentest-env must never install {forbidden}"
