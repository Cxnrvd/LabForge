"""Regression tests for the generator's injection-defence layers.

The generator concatenates user-controlled strings (passwords, hostnames,
topology names, labels) into Vagrantfile Ruby literals, bash command
strings, and PowerShell SecureString arguments. The schema regex is the
first line of defence; the ``bash_q``/``ps_q`` Jinja filters and
``| tojson`` calls in the templates are the second. These tests lock
both layers in so a regex relaxation does not silently reopen the
injection surface.
"""

from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

import pytest
from labforge_schema import LabConfig
from pydantic import ValidationError

from labforge_core.services.generator import bash_q, generate_artifacts, ps_q


def _find_usable_bash() -> str | None:
    """Locate a bash that can actually exec a no-op.

    On Windows ``shutil.which("bash")`` may resolve to the
    ``WindowsApps\\bash.EXE`` WSL stub even when no distro is installed,
    so we probe ``bash -c :`` and fall back to common git-bash paths
    before giving up.
    """
    candidates = []
    via_which = shutil.which("bash")
    if via_which:
        candidates.append(via_which)
    candidates += [
        r"C:\Program Files\Git\bin\bash.exe",
        r"C:\Program Files\Git\usr\bin\bash.exe",
        "/bin/bash",
        "/usr/bin/bash",
    ]
    for path in candidates:
        if not Path(path).exists():
            continue
        try:
            r = subprocess.run([path, "-c", ":"], capture_output=True, text=True, timeout=5)
        except OSError:
            continue
        if r.returncode == 0:
            return path
    return None


BASH = _find_usable_bash()


def _minimal_node(**overrides):
    base = {
        "id": "n1",
        "type": "server",
        "label": "Server 1",
        "position": {"x": 0, "y": 0},
        "config": {
            "os": "ubuntu_2204",
            "ip": "192.168.55.10",
            "hostname": "n1",
            "cves": [],
            "roles": [],
            "memory_mb": 1024,
            "cpus": 1,
            "credentials": {"username": "vagrant", "password": "Vagrant!2025"},
            "vlan": None,
            "gateway": None,
        },
        "attack_tags": [],
    }
    config = base["config"]
    for k, v in overrides.items():
        if k in config:
            config[k] = v
        elif k == "credentials_password":
            config["credentials"]["password"] = v
        else:
            base[k] = v
    return base


def _topology(name="Lab", *, nodes=None, **kwargs):
    return {
        "name": name,
        "description": "",
        "network_cidr": "192.168.55.0/24",
        "provider": kwargs.pop("provider", "virtualbox"),
        "version": "1.0",
        "nodes": nodes if nodes is not None else [_minimal_node()],
        "edges": [],
        "zones": [],
    }


# ---------------------------------------------------------------- schema layer

SHELL_METAS = ['"', "'", "`", "$", ";", "\\", "\n", "\r"]


@pytest.mark.parametrize("meta", SHELL_METAS)
def test_password_rejects_shell_metacharacter(meta):
    bad = _topology(nodes=[_minimal_node(credentials_password=f"a{meta}b")])
    with pytest.raises(ValidationError):
        LabConfig.model_validate(bad)


@pytest.mark.parametrize(
    "bad_name",
    [
        'foo"bar',
        "foo;rm -rf /tmp",
        "foo`whoami`",
        "foo$(whoami)",
        "foo\nbar",
        "foo#{ruby_inject}",
        "你好",  # non-ASCII
    ],
)
def test_topology_name_rejects_unsafe(bad_name):
    with pytest.raises(ValidationError):
        LabConfig.model_validate(_topology(name=bad_name))


def test_nodes_must_be_at_least_one():
    with pytest.raises(ValidationError):
        LabConfig.model_validate(_topology(nodes=[]))


def test_nodes_max_is_capped():
    too_many = [
        _minimal_node(id=f"n{i}", hostname=f"n{i}", ip=f"192.168.55.{i % 250 + 2}")
        for i in range(501)
    ]
    bad = _topology(nodes=too_many)
    # tweak each node's id/hostname to satisfy the per-node validators
    for i, n in enumerate(bad["nodes"]):
        n["id"] = f"n{i}"
        n["config"]["hostname"] = f"n{i:03d}"
        n["config"]["ip"] = f"192.168.{i // 250}.{i % 250 + 2}"
    bad["network_cidr"] = "192.168.0.0/16"
    with pytest.raises(ValidationError):
        LabConfig.model_validate(bad)


# ---------------------------------------------------------------- filter layer

@pytest.mark.parametrize(
    "raw",
    [
        "simple",
        'with "double" quotes',
        "with 'single' quotes",
        "with `backtick`",
        "with $dollar",
        "with ; semicolon",
        "with\nnewline",
    ],
)
def test_bash_q_renders_safe_token(raw):
    out = bash_q(raw)
    # shlex.quote always wraps tokens containing meta chars in single
    # quotes (or no quotes when the input is entirely safe).
    assert out.startswith("'") or out == raw or out.isalnum() or "'" not in out[1:-1]
    # Reconstruct a bash command and parse it — `bash -n -c "echo $token"`
    # exits 0 iff the token is syntactically safe in a bash double-quoted
    # context.
    if BASH is None:
        pytest.skip("usable bash not available")
    rc = subprocess.run(
        [BASH, "-n", "-c", f"echo {out}"],
        capture_output=True,
        text=True,
    )
    assert rc.returncode == 0, f"bash -n failed: {rc.stderr!r} for {raw!r} -> {out!r}"


@pytest.mark.parametrize(
    "raw",
    [
        "simple",
        "with 'single' quotes",
        "with ''already doubled''",
        "with $dollar",
        "with `backtick`",
        "with\nnewline",
    ],
)
def test_ps_q_renders_safe_token(raw):
    out = ps_q(raw)
    # Must begin and end with single quotes, and any embedded single quote
    # must be doubled.
    assert out.startswith("'") and out.endswith("'")
    inner = out[1:-1]
    # Every embedded "'" must be paired (PowerShell escape form is '').
    i = 0
    while i < len(inner):
        if inner[i] == "'":
            assert i + 1 < len(inner) and inner[i + 1] == "'", (
                f"unpaired single quote in {out!r}"
            )
            i += 2
        else:
            i += 1


# ---------------------------------------------------------------- template layer

def test_vagrantfile_uses_tojson_quotes_for_strings():
    tpl = LabConfig.model_validate(_topology(name="Lab With Spaces"))
    art = generate_artifacts(tpl)
    vf = art.vagrantfile
    # tojson quotes use \"-escapes; if any raw {{ value }} leaked, the
    # surrounding "..." would render the value without tojson escaping.
    # Check by ensuring the hostname appears inside a JSON-style literal.
    assert '"n1"' in vf
    # No string interpolation tokens should ever appear in the rendered
    # output.
    assert "{{ " not in vf and "}}" not in vf


def test_generated_provisioner_password_is_shell_quoted():
    safe_password = "Vagrant-2025_OK!"  # passes the regex
    tpl = LabConfig.model_validate(
        _topology(nodes=[_minimal_node(credentials_password=safe_password)])
    )
    art = generate_artifacts(tpl)
    sh = next(iter(art.provisioner_scripts.values()))
    assert safe_password in sh
    # The password line uses the printf vagrant:<quoted> idiom — never a
    # bare double-quoted interpolation.
    line = next(ln for ln in sh.splitlines() if "chpasswd" in ln)
    # The password must be inside shlex.quote output (single-quoted or
    # entirely safe). Bare `"<password>"` inside the chpasswd line would
    # mean the old vulnerable template snuck back in.
    assert f'"vagrant:{safe_password}"' not in line


def test_generated_bash_provisioner_parses():
    """bash -n catches stray quoting that visual inspection misses."""
    if BASH is None:
        pytest.skip("usable bash not available")
    # Construct a topology with all the tricky-but-allowed characters.
    safe_name = "UAT (parens) ,punct."
    safe_password = "p@ss!2025_-+=:?.|~"
    tpl = LabConfig.model_validate(
        _topology(
            name=safe_name,
            nodes=[_minimal_node(credentials_password=safe_password)],
        )
    )
    art = generate_artifacts(tpl)
    sh = next(iter(art.provisioner_scripts.values()))
    rc = subprocess.run([BASH, "-n"], input=sh, capture_output=True, text=True)
    assert rc.returncode == 0, f"bash -n failed: {rc.stderr!r}"


def test_generated_vagrantfile_parses_with_vagrant_validate(tmp_path):
    """Best-effort end-to-end syntax check; skipped when vagrant is absent."""
    vagrant = shutil.which("vagrant")
    if vagrant is None:
        pytest.skip("vagrant not on PATH — CI without the binary skips this check")
    tpl = LabConfig.model_validate(_topology(name="UAT parse check"))
    art = generate_artifacts(tpl)
    workspace = tmp_path / "vagrant-workspace"
    workspace.mkdir()
    (workspace / "Vagrantfile").write_text(art.vagrantfile, encoding="utf-8")
    provision_dir = workspace / "provision"
    provision_dir.mkdir()
    for filename, body in art.provisioner_scripts.items():
        (provision_dir / filename).write_text(body, encoding="utf-8")
    rc = subprocess.run(
        [vagrant, "validate"],
        cwd=str(workspace),
        capture_output=True,
        text=True,
        timeout=30,
    )
    assert rc.returncode == 0, f"vagrant validate failed:\nstdout={rc.stdout}\nstderr={rc.stderr}"


# ---------------------------------------------------------------- roles (schema + template)
#
# Unlike password/topology.name, `roles` originally had no format validator at all, even though a
# role's bare name and its free-text "@version" suffix are spliced into the provisioner's
# begin/end role echo and Write-Host lines (block.label). A role such as
# 'apache@"; touch /tmp/pwned; echo "' broke out of the surrounding double-quoted bash string and
# ran as a real command during `vagrant up` — confirmed by actually executing the generated
# script. Fixed at both layers, same as password: a schema regex (_ROLE_RE) and bash_q/ps_q
# escaping of block.label/block.description in the templates.


@pytest.mark.parametrize("meta", SHELL_METAS)
def test_role_rejects_shell_metacharacter(meta):
    bad = _topology(nodes=[_minimal_node(roles=[f"apache@a{meta}b"])])
    with pytest.raises(ValidationError):
        LabConfig.model_validate(bad)


@pytest.mark.parametrize(
    "role",
    [
        "apache",
        "apache@2.4.49",
        "log-replay@ransomware-intrusion",
        "siemens-simatic@TIA Portal V19",
        "schneider-modicon@EcoStruxure 15.x",
        "AD-Domain-Services",
    ],
)
def test_role_accepts_every_real_bundled_role_shape(role):
    """These exact strings are used by bundled templates — the regex must never reject them."""
    tpl = LabConfig.model_validate(_topology(nodes=[_minimal_node(roles=[role])]))
    assert tpl.nodes[0].config.roles == [role]


def test_malicious_role_is_rejected_before_it_reaches_the_generator():
    payload = 'apache@"; touch /tmp/labforge-test-pwned-schema; echo "'
    with pytest.raises(ValidationError):
        LabConfig.model_validate(_topology(nodes=[_minimal_node(roles=[payload])]))


def test_role_injection_is_neutralized_even_if_the_schema_is_bypassed(tmp_path):
    """Defense in depth: render the real on-disk template directly with a hand-built block that
    skips NodeConfig's own validator (as a future internal caller, a plugin, or a bug might), then
    actually execute the generated script and prove the injected command never runs — not just
    that the string looks escaped."""
    if BASH is None:
        pytest.skip("usable bash not available")
    from labforge_schema import Credentials, NodeConfig, NodeType, OsType, Position, TopologyNode

    from labforge_core.services.generator import _jinja_env

    marker = tmp_path / "PWNED"
    node = TopologyNode(
        id="n1",
        type=NodeType.SERVER,
        label="n1",
        position=Position(x=0, y=0),
        config=NodeConfig(
            os=OsType.UBUNTU_2204,
            ip="192.168.55.10",
            hostname="n1",
            roles=[],
            credentials=Credentials(username="vagrant", password="vagrant"),
        ),
    )
    evil_block = {
        "label": f'apache@"; touch {marker}; echo "',
        "version": "",
        "description": "x",
        "body": "true",
    }
    rendered = _jinja_env().get_template("provision_linux.sh.j2").render(
        node=node, is_dc=False, cve_blocks=[], install_blocks=[evil_block], endpoints={},
    )
    assert subprocess.run([BASH, "-n"], input=rendered, capture_output=True, text=True).returncode == 0
    subprocess.run([BASH], input=rendered, capture_output=True, text=True, timeout=10)
    assert not marker.exists(), "injected command ran — the role escaping regressed"
    # And the attempted payload is still visible, verbatim, in the log output for review.
    assert 'touch' in rendered and str(marker) in rendered
