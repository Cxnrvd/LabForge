"""The two bundled Docker labs: bundles, scenario ground truth, role parsing."""

from __future__ import annotations

import importlib
import sys
from datetime import UTC, datetime
from pathlib import Path

import pytest
import yaml

from labforge_core.services import docker_roles
from labforge_core.services.compose_generator import build_bundle
from labforge_core.services.template_loader import get_template

LAB_TEMPLATES = ["ransomware-intrusion-lab", "ransomware-intrusion-linux-lab", "malware-triage-lab"]
ROLES_DIR = Path(docker_roles.__file__).resolve().parents[1] / "docker_roles"


@pytest.fixture(scope="module")
def scenario():
    sys.path.insert(0, str(ROLES_DIR / "log-replay"))
    try:
        return importlib.import_module("scenarios.ransomware_intrusion")
    finally:
        sys.path.remove(str(ROLES_DIR / "log-replay"))


def test_parse_role_version():
    assert docker_roles.parse_role("log-replay@ransomware-intrusion") == (
        "log-replay",
        "ransomware-intrusion",
    )
    assert docker_roles.parse_role("elastic") == ("elastic", None)


@pytest.mark.parametrize("template", LAB_TEMPLATES)
def test_lab_bundle_is_safe_and_complete(template):
    topology = get_template(template)
    files, art = build_bundle(topology, project="lf9-test")
    doc = yaml.safe_load(files["docker-compose.yml"])

    assert topology.provider.value == "docker"
    assert files[".labforge-project"].strip() == "lf9-test"
    assert not art.warnings or all("unknown" not in w.lower() for w in art.warnings)
    for name, svc in doc["services"].items():
        assert "container_name" not in svc, name
        assert not svc.get("privileged"), name
        for port in svc.get("ports", []):
            assert str(port).startswith("127.0.0.1:"), f"{name} publishes beyond loopback"
        build = svc.get("build")
        if build:
            assert (Path("build") / Path(build["context"]).name).as_posix() in {
                "/".join(p.split("/")[:2]) for p in files if p.startswith("build/")
            }
        assert svc["image"].split(":")[-1] != "latest" or not build


def test_malware_lab_is_air_gapped():
    files, art = build_bundle(get_template("malware-triage-lab"), project="lf9-mal")
    doc = yaml.safe_load(files["docker-compose.yml"])
    assert art.isolated
    assert doc["networks"]["labforge"]["internal"] is True
    assert not art.published_ports
    assert doc["services"]["analysis"]["dns"] == [doc["services"]["fakenet"]["networks"]["labforge"]["ipv4_address"]]


def test_custom_images_are_tagged_by_content():
    a, _ = build_bundle(get_template("malware-triage-lab"), project="p")
    b, _ = build_bundle(get_template("malware-triage-lab"), project="p")
    tag = lambda f: yaml.safe_load(f["docker-compose.yml"])["services"]["fakenet"]["image"]  # noqa: E731
    assert tag(a) == tag(b)
    assert tag(a).endswith(tuple("0123456789abcdef"))
    assert not tag(a).endswith(":local")


def test_scenario_is_deterministic_and_has_ground_truth(scenario):
    end = datetime(2026, 10, 1, 21, 0, tzinfo=UTC)
    docs1, truth1, meta1 = scenario.generate(end)
    docs2, truth2, _ = scenario.generate(end)
    assert docs1 == docs2 and truth1 == truth2
    assert int(meta1["documents"]) == len(docs1) > 20000
    ids = [d["event"]["id"] for d in docs1]
    assert len(ids) == len(set(ids)), "event ids must be unique (they are the ES _id)"
    attack_ids = {t["event_id"] for t in truth1}
    assert attack_ids <= set(ids)
    stages = {t["stage"] for t in truth1}
    assert {f"S{n:02d}" for n in range(1, 16)} <= stages


def test_scenario_uses_only_reserved_addresses_and_domains(scenario):
    docs, _, _ = scenario.generate(datetime(2026, 10, 1, 21, 0, tzinfo=UTC))
    blob = "\n".join(str(d) for d in docs[:: max(1, len(docs) // 3000)])
    for banned in ("uetcl", "nexus freight"):
        assert banned not in blob.lower()


def test_every_hunt_is_well_formed(scenario):
    ids = [h["id"] for h in scenario.HUNTS]
    assert len(ids) == len(set(ids)) == 17
    for hunt in scenario.HUNTS:
        assert hunt["kql"].strip() and hunt["columns"] and hunt["stage"] in scenario.STAGE_TITLES
