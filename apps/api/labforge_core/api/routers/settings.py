"""Runtime settings that can change without a restart. Today: where lab folders are stored."""

from __future__ import annotations

from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlmodel import Session

from labforge_core.api.rate_limit import rate_limited
from labforge_core.api.security import require_agent_token
from labforge_core.models import get_session
from labforge_core.services import workspace

router = APIRouter(prefix="/settings", tags=["settings"])
_AUTH = [Depends(require_agent_token), rate_limited("settings", capacity=20, per_seconds=60.0)]


class ValidateRequest(BaseModel):
    path: str = Field(max_length=4096)


class ChangeRequest(BaseModel):
    # null goes back to LABFORGE_WORKSPACE_ROOT or the built-in default.
    path: str | None = Field(default=None, max_length=4096)
    # Asked for when the old folder holds labs: "move" them along, or "leave" them and start fresh.
    existing_data: Literal["move", "leave"] | None = None


def _http(exc: workspace.WorkspaceError) -> HTTPException:
    return HTTPException(
        status_code=exc.status,
        detail={"detail": str(exc), "code": exc.code, **exc.extra},
    )


@router.get("/workspace")
def get_workspace(session: Annotated[Session, Depends(get_session)]) -> dict[str, Any]:
    """Current workspace folder, free space, whether it is writable, and any problem with it."""
    return {**workspace.status(), "existing": workspace.existing_data(workspace.root(), session)}


@router.post("/workspace/validate", dependencies=_AUTH)
def validate_workspace(payload: ValidateRequest, session: Annotated[Session, Depends(get_session)]) -> dict[str, Any]:
    """Test a path without saving it (the Test path button)."""
    return workspace.validate(payload.path, session)


@router.put("/workspace", dependencies=_AUTH)
def put_workspace(payload: ChangeRequest, session: Annotated[Session, Depends(get_session)]) -> dict[str, Any]:
    """Save a new workspace folder. 409 ``existing_data`` means: ask whether to move or leave the old data."""
    try:
        return workspace.change(payload.path, payload.existing_data, session)
    except workspace.WorkspaceError as exc:
        raise _http(exc) from exc
