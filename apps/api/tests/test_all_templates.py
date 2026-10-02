"""Every bundled template, exercised the same way Launch would: topology validation, a Docker
bundle generation (even for templates whose default provider is a VM provider, since the UI lets
you pick Docker for any template), and the CVE-wiring checks the Log4Shell/Struts fixes were
about: a node tagged with a CVE must resolve to a curated, fully-provisioned script, or the test
fails loudly instead of someone finding out at build time."""

from __future__ import annotations

import pytest
import yaml
from labforge_schema import Provider

from labforge_core.provisioners.cve_lookup import is_fully_provisioned
from labforge_core.provisioners.role_registry import linux_snippet, windows_snippet
from labforge_core.services import compose_generator as cg
from labforge_core.services.generator import generate_artifacts
from labforge_core.services.template_loader import list_templates
from labforge_core.services.validator import validate_topology

TEMPLATES = list(list_templates())
TEMPLATE_IDS = [t.id for t in TEMPLATES]

# Custom docker_roles.py roles that exist to build a container and have no Vagrant/VM equivalent
# by design. Anything else with no curated installer is a bug, not a deliberate gap — see the
# splunk-enterprise / pfsense-emulator fixes, both of which were role-name typos relative to an
# installer that already existed under a slightly different name.
DOCKER_ONLY_ROLES = {"log-replay", "analyst-workstation", "malware-analysis", "fakenet", "log4shell-target"}


@pytest.mark.parametrize("topology", TEMPLATES, ids=TEMPLATE_IDS)
def test_template_passes_its_own_validator(topology):
    result = validate_topology(topology)
    errors = [i for i in result.issues if i.severity == "error"]
    assert not errors, f"{topology.id}: {[e.message for e in errors]}"


@pytest.mark.parametrize("topology", TEMPLATES, ids=TEMPLATE_IDS)
def test_every_cve_tagged_on_a_template_node_is_a_real_working_provisioner(topology):
    """If a template's own author tags a node with a CVE, it must not be a stub or notes-only —
    that is exactly the bug class the Log4Shell and Struts fixes were for."""
    for node in topology.nodes:
        for cve in node.config.cves:
            assert is_fully_provisioned(cve), (
                f"{topology.id}/{node.config.hostname} is tagged {cve}, but that CVE has no "
                "fully-provisioned script — picking it would silently do nothing"
            )


@pytest.mark.parametrize("topology", TEMPLATES, ids=TEMPLATE_IDS)
def test_template_generates_a_docker_bundle_without_crashing(topology):
    """The Launch dialog lets a VM-provider template be built on Docker too. This does not assert
    every node survives the switch (some, like a domain controller, legitimately cannot run as a
    container and are listed in fallback_notes instead) — only that generation itself never raises,
    every service that IS produced has an image or a build context, and nothing both ignores a role
    for 'no container preset' AND leaves the node with no image at all silently."""
    docker_topology = topology.model_copy(update={"provider": Provider.DOCKER})
    files, artifacts = cg.build_bundle(
        docker_topology, project="lf-audit", include_readme=False, include_hosts_file=False
    )
    compose = yaml.safe_load(files["docker-compose.yml"]) or {}
    services = compose.get("services", {})
    by_hostname = {n.config.hostname: n for n in topology.nodes}
    accounted = set(services) | set(artifacts.fallback_notes)
    missing = set(by_hostname) - accounted
    assert not missing, f"{topology.id}: node(s) silently dropped, no service and no fallback note: {missing}"
    for name, svc in services.items():
        assert svc.get("image") or svc.get("build"), f"{topology.id}/{name}: service has neither image nor build"


@pytest.mark.parametrize("topology", TEMPLATES, ids=TEMPLATE_IDS)
def test_every_edge_endpoint_is_a_real_node(topology):
    ids = {n.id for n in topology.nodes}
    for edge in topology.edges:
        assert edge.source in ids, f"{topology.id}: edge {edge.id} source {edge.source!r} is not a node"
        assert edge.target in ids, f"{topology.id}: edge {edge.id} target {edge.target!r} is not a node"


@pytest.mark.parametrize("topology", TEMPLATES, ids=TEMPLATE_IDS)
def test_every_role_on_a_template_resolves_to_a_curated_installer(topology):
    """A role string that almost, but doesn't quite, match a registered installer (a typo, or a
    more specific name than what's registered) silently installs nothing on the Vagrant/VM path —
    this caught dfir-lab's 'splunk-enterprise@9.3.0' (only 'splunk' was registered) and
    telecom-ad-rts's 'pfsense-emulator' (only 'pfsense' was registered)."""
    for node in topology.nodes:
        windows = node.config.os.value.startswith("windows")
        for role in node.config.roles:
            bare = role.split("@", 1)[0]
            if bare in DOCKER_ONLY_ROLES:
                continue
            snippet = windows_snippet(bare) if windows else linux_snippet(bare)
            assert snippet is not None, (
                f"{topology.id}/{node.config.hostname}: role '{bare}' has no curated installer "
                f"({'windows' if windows else 'linux'}) — check for a near-match typo"
            )


# cve-lab-log4shell's vuln01 carries both roles=['log4shell-target'] (a Docker-only custom role,
# see docker_roles.py) and cves=['CVE-2021-44228'] — the Docker build uses the role, the Vagrant
# build uses the CVE's curated script, and both produce the same real vulnerable app. The role has
# no Vagrant installer by design, so generate_artifacts() correctly warns about it there; that one
# warning is expected and not itself a gap, unlike every other case this test guards against.
_EXPECTED_WARNING_TEMPLATES = {"cve-lab-log4shell": {"log4shell-target"}}


@pytest.mark.parametrize("topology", [t for t in TEMPLATES if t.provider.value != "docker"], ids=[t.id for t in TEMPLATES if t.provider.value != "docker"])
def test_vm_templates_generate_no_coverage_warnings_on_their_own_provider(topology):
    """generate_artifacts().warnings flags exactly the role/CVE gaps the test above checks for.
    A bundled template should never trip it on its own default provider — if it does, something
    in the template references a role or CVE that doesn't actually get set up."""
    artifacts = generate_artifacts(topology)
    expected_roles = _EXPECTED_WARNING_TEMPLATES.get(topology.id, set())
    unexpected = [w for w in artifacts.warnings if not any(role in w for role in expected_roles)]
    assert unexpected == [], f"{topology.id}: {unexpected}"


@pytest.mark.parametrize("topology", [t for t in TEMPLATES if t.provider.value == "docker"], ids=[t.id for t in TEMPLATES if t.provider.value == "docker"])
def test_docker_native_templates_warn_instead_of_silently_doing_nothing_on_vagrant(topology):
    """The flip side of the Docker-bundle test above: a Docker-native template's custom roles
    (log-replay, analyst-workstation, ...) have no Vagrant equivalent and never will — the fix is
    for that to be a loud warning if someone picks Vagrant/VirtualBox for it from the Launch
    override, not silence, the same gap the Log4Shell bug was on Docker."""
    from labforge_schema import Provider

    vagrant_topology = topology.model_copy(update={"provider": Provider.VIRTUALBOX})
    artifacts = generate_artifacts(vagrant_topology)
    docker_only_roles_present = {
        r.split("@", 1)[0] for n in topology.nodes for r in n.config.roles
    } & DOCKER_ONLY_ROLES
    if docker_only_roles_present:
        assert artifacts.warnings, f"{topology.id}: expected a warning for {docker_only_roles_present}, got none"
