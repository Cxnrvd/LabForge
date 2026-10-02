"""Read-only host metrics for the dashboard."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter

from labforge_core.services import hostmetrics

router = APIRouter(prefix="/host", tags=["host"])


@router.get("/metrics")
def host_metrics() -> dict[str, Any]:
    """CPU, memory and workspace-disk usage plus container/VM engine versions."""
    return {**hostmetrics.sample(), "engine": hostmetrics.engine()}
