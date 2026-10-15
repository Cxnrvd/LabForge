"""Image library API (contract in apps/web/lib/api/images.ts)."""

from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import StreamingResponse
from labforge_schema import LabConfig
from pydantic import BaseModel, Field
from sqlmodel import Session

from labforge_core.api.rate_limit import rate_limited
from labforge_core.api.security import require_agent_token
from labforge_core.models import Lab, get_session
from labforge_core.services import compose_generator, docker_runtime, images
from labforge_core.services.template_loader import TemplateNotFound

router = APIRouter(prefix="/images", tags=["images"])
_AUTH = [Depends(require_agent_token), rate_limited("images", capacity=30, per_seconds=60.0)]


def _http(exc: images.ImageError) -> HTTPException:
    return HTTPException(status_code=exc.status, detail={"detail": str(exc), "code": exc.code})


class GoldenRequest(BaseModel):
    source_id: str = Field(min_length=1, max_length=120)
    name: str = Field(min_length=1, max_length=80)


class PrepareRequest(BaseModel):
    template_id: str = Field(min_length=1, max_length=120)


class RequiredRequest(BaseModel):
    topology: LabConfig


@router.get("")
def list_images() -> dict[str, Any]:
    if not docker_runtime.docker_available():
        return {"images": [], "total_mb": 0, "disk_free_gb": None}
    return images.list_images()


@router.post("/required", dependencies=_AUTH)
def required(payload: RequiredRequest) -> dict[str, Any]:
    """What this topology needs and whether it is here, plus which nodes a Docker build would
    actually include (for the Launch dialog's pre-build warning about nodes Docker can't run)."""
    try:
        requirements = images.requirements(payload.topology)
    except images.ImageError as exc:
        raise _http(exc) from exc
    return {
        "requirements": requirements,
        "node_coverage": compose_generator.docker_node_coverage(payload.topology),
    }


@router.post("/prepare", dependencies=_AUTH)
def prepare(payload: PrepareRequest) -> dict[str, list[str]]:
    try:
        return {"queued": images.prepare(payload.template_id)}
    except TemplateNotFound as exc:
        raise HTTPException(status_code=404, detail={"detail": "Unknown template", "code": "not_found"}) from exc
    except images.ImageError as exc:
        raise _http(exc) from exc


@router.post("/golden", dependencies=_AUTH)
def make_golden(
    payload: GoldenRequest,
    session: Annotated[Session, Depends(get_session)],
) -> dict[str, Any]:
    """Save a Windows disk as a local golden image. Source: a prepared base id or ``lab:<id>:<machine>``."""

    def lookup(token: str) -> tuple[str, str]:
        _, lab_id, host = token.split(":")
        lab = session.get(Lab, int(lab_id))
        if lab is None or not lab.workspace_path:
            raise images.ImageError(f"Lab {lab_id} not found.", "not_found", 404)
        project = docker_runtime.read_project(Path(lab.workspace_path))
        if not project:
            raise images.ImageError("The lab has no Compose project.", "not_found", 404)
        return f"{project}_{host}-storage", f"{project}-{host}-1"

    try:
        return images.create_golden(payload.source_id, payload.name, project_volume_lookup=lookup)
    except images.ImageError as exc:
        raise _http(exc) from exc


@router.post("/import", dependencies=_AUTH)
async def import_image(
    request: Request,
    kind: Annotated[str, Query(pattern="^(docker|golden)$")],
    name: Annotated[str, Query(max_length=80)] = "imported",
) -> dict[str, Any]:
    """Load a local archive made by Export. The body is the raw tar."""
    chunks: list[bytes] = [chunk async for chunk in request.stream()]

    def source() -> Iterator[bytes]:
        yield from chunks

    try:
        return images.import_archive(kind, name, source())
    except images.ImageError as exc:
        raise _http(exc) from exc


@router.post("/{image_id:path}/pull", dependencies=_AUTH)
def pull(image_id: str) -> dict[str, Any]:
    try:
        return images.pull(image_id)
    except images.ImageError as exc:
        raise _http(exc) from exc


@router.post("/{image_id:path}/export", dependencies=_AUTH)
def export(image_id: str) -> StreamingResponse:
    """Download a local archive. Windows disks are exported only on request and stay on this machine."""
    try:
        filename, stream = images.export_stream(image_id)
    except images.ImageError as exc:
        raise _http(exc) from exc
    return StreamingResponse(
        stream,
        media_type="application/x-tar",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "X-LabForge-Local-Only": "true",
        },
    )


@router.delete("/{image_id:path}", status_code=status.HTTP_204_NO_CONTENT, dependencies=_AUTH)
def remove(image_id: str) -> None:
    try:
        images.remove(image_id)
    except images.ImageError as exc:
        raise _http(exc) from exc
