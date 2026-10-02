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
from labforge_core.services import compose_generator as cg
from labforge_core.services.template_loader import list_templates
from labforge_core.services.validator import validate_topology

TEMPLATES = list(list_templates())
TEMPLATE_IDS = [t.id for t in TEMPLATES]


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
