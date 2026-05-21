"""Prebuilt template endpoints."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, status

from labforge_schema import LabConfig

from labforge_core.schemas.api import TemplateSummary
from labforge_core.services.template_loader import (
    TemplateNotFound,
    get_template,
    list_templates,
)

router = APIRouter(prefix="/templates", tags=["templates"])


@router.get("", response_model=list[TemplateSummary])
def list_all() -> list[TemplateSummary]:
    return [
        TemplateSummary(
            id=t.id,
            name=t.name,
            description=t.description,
            node_count=len(t.nodes),
            edge_count=len(t.edges),
        )
        for t in list_templates()
    ]


@router.get("/{template_id}", response_model=LabConfig)
def get_one(template_id: str) -> LabConfig:
    try:
        return get_template(template_id)
    except TemplateNotFound as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"detail": str(exc), "code": "template_not_found"},
        ) from exc
