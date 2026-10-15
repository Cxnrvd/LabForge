"""Vagrantfile + provisioner generation endpoint."""

from __future__ import annotations

import re

from fastapi import APIRouter, HTTPException, Query, Request, status
from fastapi.responses import Response

from labforge_core.api.rate_limit import limit
from labforge_core.schemas.api import GenerateRequest
from labforge_core.services.generator import generate_zip
from labforge_core.services.validator import validate_topology

router = APIRouter(prefix="/generate", tags=["generate"])


@router.post("", response_class=Response)
@limit("generate", capacity=12, per_seconds=60.0)
async def generate(
    request: Request,
    payload: GenerateRequest,
    target: str = Query(default="vagrant", description="vagrant | docker-compose"),
) -> Response:
    """Render the topology to a downloadable bundle.

    ``target=vagrant`` (default) emits Vagrantfile + provisioners.
    ``target=docker-compose`` emits a ``docker-compose.yml`` plus per-
    container env files — useful for nodes that don't need a full VM
    (web apps, OpenPLC, MediaMTX, databases). See
    ``services.generator.generate_zip`` for the per-target file list.
    """
    if target not in {"vagrant", "docker-compose"}:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "detail": f"Unknown target: {target}",
                "code": "unknown_target",
            },
        )
    result = validate_topology(payload.topology)
    if not result.valid:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "detail": "Topology validation failed",
                "code": "invalid_topology",
                "issues": [issue.model_dump() for issue in result.issues],
            },
        )

    archive = generate_zip(
        payload.topology,
        include_readme=payload.include_readme,
        include_hosts_file=payload.include_hosts_file,
        target=target,
    )
    safe_name = re.sub(r"[^a-zA-Z0-9_-]+", "-", payload.topology.name.lower()).strip("-")
    suffix = "" if target == "vagrant" else f"-{target}"
    filename = f"labforge-{safe_name or 'lab'}{suffix}.zip"
    return Response(
        content=archive,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
