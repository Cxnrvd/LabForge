"""Read-only host metrics for the dashboard."""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Query

from labforge_core.services import hostmetrics, preflight

router = APIRouter(prefix="/host", tags=["host"])


@router.get("/metrics")
def host_metrics() -> dict[str, Any]:
    """CPU, memory and workspace-disk usage plus container/VM engine versions."""
    return {**hostmetrics.sample(), "engine": hostmetrics.engine()}


@router.get("/preflight")
def host_preflight(
    windows_guests: Annotated[int, Query(ge=0, le=20, description="Windows guests in the lab about to be built")] = 0,
    memory_mb: Annotated[int | None, Query(ge=0, le=1_000_000, description="Total container memory the lab asks for")] = None,
    recheck: Annotated[bool, Query(description="Forget cached probe results (KVM)")] = False,
) -> dict[str, Any]:
    """Is this computer ready to run a Docker lab? Each problem comes with the exact fix."""
    if recheck:
        preflight.reset_cache()
        hostmetrics._reset_cache()
    return preflight.run(windows_guests=windows_guests, memory_needed_mb=memory_mb)
