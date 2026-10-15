"""CVE search and lookup endpoints (NVD-backed)."""

from __future__ import annotations

import re

from fastapi import APIRouter, HTTPException, Path, Query, Request, status
from labforge_schema import CVEEntry
from pydantic import BaseModel

from labforge_core.api.rate_limit import limit
from labforge_core.provisioners.cve_lookup import (
    is_fully_provisioned,
    known_cve_descriptions,
    list_known_cves,
    resolve_cve_payload,
)
from labforge_core.services.cve_client import CVEClientError, CVENotFound, get_cve, search_cves

router = APIRouter(prefix="/cves", tags=["cves"])

# A well-formed CVE id, nothing else — resolve_cve_payload reads a file named after this input
# (provisioner_scripts_dir / f"{cve_id}.sh"), so this also keeps that lookup to the curated
# scripts directory instead of taking arbitrary path segments from the URL.
_CVE_ID_RE = re.compile(r"^CVE-\d{4}-\d{4,7}$")


@router.get("/search", response_model=list[CVEEntry])
@limit("cves_search", capacity=30, per_seconds=60.0)
async def search(
    request: Request,
    q: str = Query(min_length=2, description="CVE-ID or keyword"),
    limit_: int = Query(default=10, ge=1, le=50, alias="limit"),
) -> list[CVEEntry]:
    try:
        return await search_cves(q, limit=limit_)
    except CVEClientError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail={"detail": str(exc), "code": "nvd_upstream_error"},
        ) from exc


class CuratedCve(BaseModel):
    cve_id: str
    description: str
    # True when the provisioner actually leaves a vulnerable service reachable on the lab network,
    # not just notes or attacker-side tooling (see provisioners/cve_lookup.py).
    fully_provisioned: bool


@router.get("/curated", response_model=list[CuratedCve])
def curated() -> list[CuratedCve]:
    """Every CVE with a bundled provisioner script, and whether it actually stands up a vulnerable
    target or only leaves notes (a Windows CVE, which LabForge has no curated Windows provisioner
    for). Pin one of these to a node to get the real thing, not a guess."""
    descriptions = known_cve_descriptions()
    known = sorted(set(list_known_cves()))
    return [
        CuratedCve(
            cve_id=cve,
            description=descriptions.get(cve, ""),
            fully_provisioned=is_fully_provisioned(cve),
        )
        for cve in known
    ]


class ScriptResponse(BaseModel):
    cve_id: str
    known: bool
    fully_provisioned: bool
    description: str
    # The curated .sh body for a fully-provisioned CVE; the honest stub comment LabForge would
    # actually write into a lab's provisioner for a notes-only or unrecognized one. Never
    # fabricated — this is exactly what a build does with this CVE, nothing is invented for display.
    script: str


@router.get("/{cve_id}/script", response_model=ScriptResponse)
def script(cve_id: str = Path(pattern=_CVE_ID_RE.pattern)) -> ScriptResponse:
    """What LabForge actually does with this CVE: the real curated script, or the honest stub /
    notes-only script it would write instead. Used by the CVE detail panel so it shows the real
    thing rather than a guess at what a provisioner might look like."""
    payload = resolve_cve_payload(cve_id)
    return ScriptResponse(
        cve_id=payload.cve_id,
        known=payload.known,
        fully_provisioned=payload.fully_provisioned,
        description=payload.description,
        script=payload.script,
    )


@router.get("/{cve_id}", response_model=CVEEntry)
@limit("cves_lookup", capacity=60, per_seconds=60.0)
async def lookup(request: Request, cve_id: str) -> CVEEntry:
    try:
        return await get_cve(cve_id)
    except CVENotFound as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"detail": str(exc), "code": "cve_not_found"},
        ) from exc
    except CVEClientError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail={"detail": str(exc), "code": "nvd_upstream_error"},
        ) from exc
