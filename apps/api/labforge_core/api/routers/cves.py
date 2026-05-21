"""CVE search and lookup endpoints (NVD-backed)."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query, Request, status

from labforge_schema import CVEEntry

from labforge_core.api.rate_limit import limit
from labforge_core.provisioners.cve_lookup import known_cve_descriptions, list_known_cves
from labforge_core.services.cve_client import CVEClientError, CVENotFound, get_cve, search_cves

router = APIRouter(prefix="/cves", tags=["cves"])


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


@router.get("/curated", response_model=dict[str, str])
def curated() -> dict[str, str]:
    """Known CVEs with bundled curated provisioner scripts."""
    descriptions = known_cve_descriptions()
    known = set(list_known_cves())
    return {cve: descriptions.get(cve, "") for cve in sorted(known)}


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
