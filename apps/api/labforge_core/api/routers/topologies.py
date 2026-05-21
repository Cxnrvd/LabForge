"""Topology persistence and validation endpoints."""

from __future__ import annotations

import json
import re
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlmodel import Session, select

from labforge_schema import LabConfig, ValidationResult

from labforge_core.models import StoredTopology, get_session
from labforge_core.services.validator import validate_topology

router = APIRouter(prefix="/topologies", tags=["topologies"])


def _slugify(name: str) -> str:
    return re.sub(r"[^a-z0-9-]+", "-", name.lower()).strip("-") or "topology"


@router.post("/validate", response_model=ValidationResult)
def validate(topology: LabConfig) -> ValidationResult:
    return validate_topology(topology)


@router.get("", response_model=list[dict])
def list_topologies(
    session: Annotated[Session, Depends(get_session)],
) -> list[dict]:
    rows = session.exec(select(StoredTopology).order_by(StoredTopology.updated_at.desc())).all()
    return [
        {
            "slug": row.slug,
            "name": row.name,
            "description": row.description,
            "updated_at": row.updated_at.isoformat(),
        }
        for row in rows
    ]


@router.get("/{slug}", response_model=LabConfig)
def get_topology(
    slug: str,
    session: Annotated[Session, Depends(get_session)],
) -> LabConfig:
    row = session.exec(select(StoredTopology).where(StoredTopology.slug == slug)).first()
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"detail": f"No topology with slug {slug}", "code": "not_found"},
        )
    return LabConfig.model_validate(row.payload())


@router.post("", response_model=LabConfig, status_code=status.HTTP_201_CREATED)
def upsert_topology(
    topology: LabConfig,
    session: Annotated[Session, Depends(get_session)],
) -> LabConfig:
    result = validate_topology(topology)
    if not result.valid:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "detail": "Topology validation failed",
                "code": "invalid_topology",
                "issues": [issue.model_dump() for issue in result.issues],
            },
        )

    slug = _slugify(topology.name)
    payload_json = topology.model_dump_json()
    row = session.exec(select(StoredTopology).where(StoredTopology.slug == slug)).first()
    now = datetime.utcnow()
    if row is None:
        row = StoredTopology(
            slug=slug,
            name=topology.name,
            description=topology.description,
            payload_json=payload_json,
            created_at=now,
            updated_at=now,
        )
        session.add(row)
    else:
        row.name = topology.name
        row.description = topology.description
        row.payload_json = payload_json
        row.updated_at = now
        session.add(row)
    session.commit()
    return LabConfig.model_validate(json.loads(row.payload_json))


@router.delete("/{slug}", status_code=status.HTTP_204_NO_CONTENT)
def delete_topology(
    slug: str,
    session: Annotated[Session, Depends(get_session)],
) -> None:
    row = session.exec(select(StoredTopology).where(StoredTopology.slug == slug)).first()
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"detail": f"No topology with slug {slug}", "code": "not_found"},
        )
    session.delete(row)
    session.commit()
