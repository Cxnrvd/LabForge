"""Optional bearer-token auth for write endpoints.

If ``settings.agent_token`` is unset, the dependency is a no-op — the API
stays open by default so existing dev setups keep working. If set, every
write endpoint requires ``Authorization: Bearer <token>`` and returns 401
on mismatch.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import Depends, Header, HTTPException, status

from labforge_core.settings import Settings, get_settings


def require_agent_token(
    settings: Annotated[Settings, Depends(get_settings)],
    authorization: Annotated[str | None, Header(alias="Authorization")] = None,
) -> None:
    expected = settings.agent_token
    if not expected:
        return
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"detail": "Missing bearer token", "code": "auth_required"},
            headers={"WWW-Authenticate": "Bearer"},
        )
    presented = authorization.split(" ", 1)[1].strip()
    if presented != expected:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"detail": "Invalid bearer token", "code": "auth_invalid"},
            headers={"WWW-Authenticate": "Bearer"},
        )
