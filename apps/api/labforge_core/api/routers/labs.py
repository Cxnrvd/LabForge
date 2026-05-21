"""Lab lifecycle records + heartbeat ingest from the agent."""

from __future__ import annotations

import asyncio
import json
import logging
import os
from datetime import datetime, timedelta
from typing import Annotated

from fastapi import (
    APIRouter,
    Depends,
    HTTPException,
    Query,
    Request,
    WebSocket,
    WebSocketDisconnect,
    status,
)
from sqlmodel import Session, select

from pathlib import Path

from labforge_core.api.rate_limit import limit
from labforge_core.api.security import require_agent_token
from labforge_core.models import Lab, LabHeartbeat, get_session
from labforge_core.schemas.api import (
    ActivityEntry,
    BuildLogChunk,
    BuildRequest,
    BuildResponse,
    BuildStatus,
    HeartbeatPayload,
    LabCreateRequest,
    LabSummary,
)
from labforge_core.services.build_runner import (
    BuildPrereqError,
    read_build_status,
    read_log_chunk,
    start_build,
    stop_build,
    vagrant_available,
)
from labforge_core.services.live_bus import bus

_LOGGER = logging.getLogger("labforge.labs")

router = APIRouter(prefix="/labs", tags=["labs"])
_AUTH = [Depends(require_agent_token)]


@router.get("", response_model=list[LabSummary])
def list_labs(
    session: Annotated[Session, Depends(get_session)],
) -> list[LabSummary]:
    rows = session.exec(select(Lab).order_by(Lab.updated_at.desc())).all()
    return [LabSummary.model_validate(r, from_attributes=True) for r in rows]


@router.post(
    "",
    response_model=LabSummary,
    status_code=status.HTTP_201_CREATED,
    dependencies=_AUTH,
)
def create_lab(
    payload: LabCreateRequest,
    session: Annotated[Session, Depends(get_session)],
) -> LabSummary:
    row = Lab(
        topology_slug=payload.topology_slug,
        name=payload.name,
        provider=payload.provider,
        status="pending",
        workspace_path=payload.workspace_path,
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow(),
    )
    session.add(row)
    session.commit()
    session.refresh(row)
    return LabSummary.model_validate(row, from_attributes=True)


@router.get("/{lab_id}", response_model=LabSummary)
def get_lab(
    lab_id: int,
    session: Annotated[Session, Depends(get_session)],
) -> LabSummary:
    row = session.get(Lab, lab_id)
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"detail": f"Lab {lab_id} not found", "code": "not_found"},
        )
    return LabSummary.model_validate(row, from_attributes=True)


@router.patch("/{lab_id}/status", response_model=LabSummary, dependencies=_AUTH)
def update_status(
    lab_id: int,
    new_status: str,
    session: Annotated[Session, Depends(get_session)],
) -> LabSummary:
    row = session.get(Lab, lab_id)
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"detail": f"Lab {lab_id} not found", "code": "not_found"},
        )
    row.status = new_status
    row.updated_at = datetime.utcnow()
    session.add(row)
    session.commit()
    session.refresh(row)
    return LabSummary.model_validate(row, from_attributes=True)


@router.delete("/{lab_id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=_AUTH)
def delete_lab(
    lab_id: int,
    session: Annotated[Session, Depends(get_session)],
) -> None:
    row = session.get(Lab, lab_id)
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"detail": f"Lab {lab_id} not found", "code": "not_found"},
        )
    session.delete(row)
    session.commit()


# ---------------------------------------------------------------- heartbeat

@router.post("/{lab_id}/heartbeat", response_model=LabSummary, dependencies=_AUTH)
@limit("heartbeat", capacity=60, per_seconds=60.0)
async def post_heartbeat(
    request: Request,
    lab_id: int,
    payload: HeartbeatPayload,
    session: Annotated[Session, Depends(get_session)],
) -> LabSummary:
    """Agent posts this every ~10 s while a lab workspace is alive.

    Rate-limited to 60/min per IP — a runaway agent shouldn't be able to
    starve other tenants. The payload is persisted and also broadcast on
    the live bus so any WebSocket subscribers see it without polling.
    """
    lab = session.get(Lab, lab_id)
    if lab is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"detail": f"Lab {lab_id} not found", "code": "not_found"},
        )

    captured_at = payload.captured_at or datetime.utcnow()
    serialized = payload.model_dump(mode="json")
    serialized["captured_at"] = captured_at.isoformat()
    hb = LabHeartbeat(
        lab_id=lab_id,
        captured_at=captured_at,
        payload_json=json.dumps(
            {k: v for k, v in serialized.items() if k != "captured_at"},
            separators=(",", ":"),
        ),
    )
    session.add(hb)

    lab.status = payload.lab_status or lab.status
    lab.updated_at = captured_at
    session.add(lab)
    session.commit()
    session.refresh(lab)

    # Best-effort broadcast — broker errors must not fail the ingest path.
    try:
        await bus.publish(lab_id, {"type": "heartbeat", "data": serialized})
    except Exception as exc:  # noqa: BLE001
        _LOGGER.warning("bus_publish_failed", extra={"lab_id": lab_id, "error": str(exc)})

    return LabSummary.model_validate(lab, from_attributes=True)


@router.get("/{lab_id}/heartbeat", response_model=HeartbeatPayload)
def latest_heartbeat(
    lab_id: int,
    session: Annotated[Session, Depends(get_session)],
) -> HeartbeatPayload:
    row = session.exec(
        select(LabHeartbeat)
        .where(LabHeartbeat.lab_id == lab_id)
        .order_by(LabHeartbeat.captured_at.desc())
    ).first()
    if row is None:
        # Empty heartbeat — dashboard can render "no telemetry yet".
        return HeartbeatPayload(lab_status="unknown", vms=[], log_tail=[])
    data = json.loads(row.payload_json)
    data["captured_at"] = row.captured_at
    return HeartbeatPayload.model_validate(data)


@router.get("/{lab_id}/log", response_model=list[str])
def lab_log(
    lab_id: int,
    session: Annotated[Session, Depends(get_session)],
    lines: int = Query(default=200, ge=1, le=2000),
) -> list[str]:
    """Concatenate `log_tail` from the last few heartbeats so the dashboard
    can show a rolling tail. Newest entry last."""
    rows = session.exec(
        select(LabHeartbeat)
        .where(LabHeartbeat.lab_id == lab_id)
        .order_by(LabHeartbeat.captured_at.desc())
        .limit(20)
    ).all()
    rows.reverse()  # oldest → newest
    out: list[str] = []
    seen: set[str] = set()
    for row in rows:
        payload = json.loads(row.payload_json)
        for line in payload.get("log_tail") or []:
            if line in seen:
                continue
            seen.add(line)
            out.append(line)
    return out[-lines:]


# ---------------------------------------------------------------- build

@router.post(
    "/build",
    response_model=BuildResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=_AUTH,
)
def trigger_build(
    payload: BuildRequest,
    session: Annotated[Session, Depends(get_session)],
) -> BuildResponse:
    """Generate a workspace + run `vagrant up` in the background.

    Returns immediately with a lab id the UI can poll
    (``GET /labs/{id}/build/log`` and ``/build/status``).
    """
    try:
        lab, workspace = start_build(payload.topology, session)
    except BuildPrereqError as exc:
        raise HTTPException(
            status_code=status.HTTP_412_PRECONDITION_FAILED,
            detail={"detail": str(exc), "code": "vagrant_missing"},
        ) from exc
    pid_file = workspace / ".build.pid"
    pid = int(pid_file.read_text().strip()) if pid_file.exists() else None
    return BuildResponse(
        lab_id=lab.id or 0,
        workspace_path=str(workspace),
        pid=pid,
    )


def _resolve_workspace(lab: Lab) -> Path:
    if not lab.workspace_path:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"detail": "Lab has no workspace recorded", "code": "no_workspace"},
        )
    return Path(lab.workspace_path)


@router.get("/{lab_id}/build/log", response_model=BuildLogChunk)
def build_log(
    lab_id: int,
    session: Annotated[Session, Depends(get_session)],
    since: int = Query(default=0, ge=0),
) -> BuildLogChunk:
    lab = session.get(Lab, lab_id)
    if lab is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"detail": f"Lab {lab_id} not found", "code": "not_found"},
        )
    workspace = _resolve_workspace(lab)
    chunk = read_log_chunk(workspace, since=since)
    return BuildLogChunk(**chunk)


@router.get("/{lab_id}/build/status", response_model=BuildStatus)
def build_status(
    lab_id: int,
    session: Annotated[Session, Depends(get_session)],
) -> BuildStatus:
    lab = session.get(Lab, lab_id)
    if lab is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"detail": f"Lab {lab_id} not found", "code": "not_found"},
        )
    workspace = _resolve_workspace(lab)
    snap = read_build_status(workspace)
    # Reflect terminal state into the persisted lab status the dashboard
    # already shows on /labs.
    if snap["phase"] == "succeeded" and lab.status == "building":
        lab.status = "running"
        session.add(lab)
        session.commit()
    elif snap["phase"] in ("failed", "aborted") and lab.status == "building":
        lab.status = "failed"
        session.add(lab)
        session.commit()
    return BuildStatus(**snap)


@router.post(
    "/{lab_id}/build/stop",
    response_model=BuildStatus,
    dependencies=_AUTH,
)
def stop_lab_build(
    lab_id: int,
    session: Annotated[Session, Depends(get_session)],
) -> BuildStatus:
    """User-initiated abort of an in-flight build.

    Idempotent: calling this on an already-terminal build returns the
    current phase without re-signalling anything.
    """
    lab = session.get(Lab, lab_id)
    if lab is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"detail": f"Lab {lab_id} not found", "code": "not_found"},
        )
    workspace = _resolve_workspace(lab)
    result = stop_build(workspace)
    if result["phase"] == "aborted" and lab.status == "building":
        lab.status = "failed"
        lab.updated_at = datetime.utcnow()
        session.add(lab)
        session.commit()
    return BuildStatus(**read_build_status(workspace))


@router.get("/build/preflight")
def build_preflight() -> dict[str, object]:
    """Cheap probe so the UI can disable / warn on the Build button.

    Returns at minimum ``vagrant_available``. Best-effort additions:
    ``vagrant_version`` (parsed from ``vagrant --version``), and the
    default provider env var if one is set so the UI can call out a
    mismatch with the topology's chosen provider.
    """
    import subprocess

    payload: dict[str, object] = {"vagrant_available": vagrant_available()}
    if payload["vagrant_available"]:
        try:
            out = subprocess.run(
                ["vagrant", "--version"],
                capture_output=True,
                text=True,
                timeout=5,
                check=False,
            )
            version = (out.stdout or "").strip().split()[-1] if out.stdout else None
            payload["vagrant_version"] = version
        except Exception:  # noqa: BLE001 — best-effort
            payload["vagrant_version"] = None
    default_provider = os.environ.get("VAGRANT_DEFAULT_PROVIDER")
    if default_provider:
        payload["default_provider"] = default_provider
    return payload


@router.websocket("/{lab_id}/ws")
async def live_stream(websocket: WebSocket, lab_id: int) -> None:
    """Live telemetry stream for a single lab.

    The dashboard opens this on mount and consumes one JSON envelope
    per heartbeat. Each envelope looks like::

        {"type": "heartbeat", "data": {...HeartbeatPayload...}}

    The stream also sends an initial ``{"type": "hello", "lab_id": N}``
    so the client can confirm the connection without waiting for the
    next agent tick.
    """
    await websocket.accept()
    queue = await bus.subscribe(lab_id)
    try:
        await websocket.send_json({"type": "hello", "lab_id": lab_id})
        while True:
            # Race a read against a get(): client disconnect surfaces
            # as a WebSocketDisconnect from receive; new telemetry as
            # the next queue item.
            receive_task = asyncio.create_task(websocket.receive_text())
            queue_task = asyncio.create_task(queue.get())
            done, pending = await asyncio.wait(
                {receive_task, queue_task},
                return_when=asyncio.FIRST_COMPLETED,
            )
            for task in pending:
                task.cancel()
            if receive_task in done:
                # Inbound message from client — currently only used as
                # an opaque keep-alive. We don't expect a payload but
                # consume gracefully.
                try:
                    receive_task.result()
                except WebSocketDisconnect:
                    break
                continue
            message = queue_task.result()
            await websocket.send_json(message)
    except WebSocketDisconnect:
        pass
    finally:
        await bus.unsubscribe(lab_id, queue)


@router.get("/activity/recent", response_model=list[ActivityEntry])
def recent_activity(
    session: Annotated[Session, Depends(get_session)],
    limit: int = Query(default=30, ge=1, le=200),
) -> list[ActivityEntry]:
    """Cross-lab activity feed for the dashboard."""
    since = datetime.utcnow() - timedelta(hours=24)
    rows = session.exec(
        select(LabHeartbeat, Lab)
        .where(LabHeartbeat.lab_id == Lab.id, LabHeartbeat.captured_at >= since)
        .order_by(LabHeartbeat.captured_at.desc())
        .limit(limit)
    ).all()
    out: list[ActivityEntry] = []
    for hb, lab in rows:
        payload = json.loads(hb.payload_json)
        vms = payload.get("vms") or []
        running = sum(1 for v in vms if v.get("state") == "running")
        log_tail = payload.get("log_tail") or []
        out.append(
            ActivityEntry(
                lab_id=lab.id or 0,
                lab_name=lab.name,
                captured_at=hb.captured_at,
                lab_status=payload.get("lab_status", lab.status),
                running_vms=running,
                total_vms=len(vms),
                log_snippet=log_tail[-1] if log_tail else None,
            )
        )
    return out
