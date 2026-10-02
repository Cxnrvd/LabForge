"""Curated CVE provisioners: what is actually wired up versus notes only."""

from __future__ import annotations

from fastapi import FastAPI
from fastapi.testclient import TestClient

from labforge_core.api.routers import cves as cves_router
from labforge_core.provisioners import cve_lookup


def test_every_curated_cve_has_a_description():
    known = set(cve_lookup.list_known_cves())
    described = set(cve_lookup.known_cve_descriptions())
    assert known, "no .sh files found under provisioner_scripts_dir"
    missing = known - described
    assert not missing, f"curated script(s) with no entry in _DESCRIPTIONS: {missing}"


def test_fully_provisioned_cves_actually_claim_to_install_something_real():
    """A CVE not in the notes-only set must read as real in both the function and the payload."""
    for cve in cve_lookup.list_known_cves():
        payload = cve_lookup.resolve_cve_payload(cve)
        assert payload.known is True
        assert payload.fully_provisioned == cve_lookup.is_fully_provisioned(cve)


def test_notes_only_cves_are_windows_only_and_say_so():
    for cve in cve_lookup._NOTES_ONLY:
        assert cve in cve_lookup.list_known_cves(), f"{cve} marked notes-only but has no script"
        assert cve_lookup.is_fully_provisioned(cve) is False
        description = cve_lookup.known_cve_descriptions()[cve]
        assert "notes only" in description.lower() or "Notes only" in description


def test_unknown_cve_is_never_reported_as_fully_provisioned():
    assert cve_lookup.is_fully_provisioned("CVE-1999-9999") is False
    payload = cve_lookup.resolve_cve_payload("CVE-1999-9999")
    assert payload.known is False and payload.fully_provisioned is False
    assert "no curated provisioner is bundled" in payload.script


def test_log4shell_and_struts_and_heartbleed_and_shellshock_are_fully_provisioned():
    """These are the CVEs a template actually ships — they must read as real, not notes-only."""
    for cve in ("CVE-2021-44228", "CVE-2017-5638", "CVE-2014-0160", "CVE-2014-6271"):
        assert cve_lookup.is_fully_provisioned(cve) is True, cve


def test_curated_endpoint_matches_the_lookup_module():
    app = FastAPI()
    app.include_router(cves_router.router, prefix="/api/v1")
    rows = TestClient(app).get("/api/v1/cves/curated").json()
    ids = {r["cve_id"] for r in rows}
    assert ids == set(cve_lookup.list_known_cves())
    by_id = {r["cve_id"]: r for r in rows}
    assert by_id["CVE-2021-44228"]["fully_provisioned"] is True
    assert by_id["CVE-2020-1472"]["fully_provisioned"] is False
