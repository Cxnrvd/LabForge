"""Lab lifecycle records + heartbeat ingest from the agent."""

from __future__ import annotations

import asyncio
import json
import logging
import os
from datetime import datetime, timedelta
from pathlib import Path
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
from labforge_schema import LabConfig, Provider
from sqlmodel import Session, select

from labforge_core.api.rate_limit import limit, rate_limited
from labforge_core.api.security import require_agent_token
from labforge_core.models import Lab, LabHeartbeat, get_session
from labforge_core.schemas.api import (
    ActivityEntry,
    BuildLogChunk,
    BuildPhases,
    BuildRequest,
    BuildResponse,
    BuildStatus,
    HeartbeatPayload,
    LabCreateRequest,
    LabSummary,
)
from labforge_core.services import docker_runtime, hostenv
from labforge_core.services.build_runner import (
    BuildPrereqError,
    DestroyFailed,
    HaltFailed,
    LabExistsError,
    SubnetConflictError,
    destroy_lab,
    halt_lab,
    parse_per_vm_phases,
    read_build_status,
    read_log_chunk,
    resume_lab,
    start_build,
    stop_build,
)
from labforge_core.services.compose_generator import endpoints_from_workspace
from labforge_core.services.live_bus import bus

_LOGGER = logging.getLogger("labforge.labs")

router = APIRouter(prefix="/labs", tags=["labs"])
_AUTH = [Depends(require_agent_token)]
# Lifecycle calls shell out to Docker or Vagrant, so a loop of them can pin the machine.
_BUILD_LIMIT = [*_AUTH, rate_limited("lab_build", capacity=6, per_seconds=60.0)]
_LIFECYCLE_LIMIT = [*_AUTH, rate_limited("lab_lifecycle", capacity=20, per_seconds=60.0)]


@router.get("", response_model=list[LabSummary])
def list_labs(
    session: Annotated[Session, Depends(get_session)],
    limit: int = Query(default=50, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
) -> list[LabSummary]:
    """Most-recently-updated first; pagination caps the response so a long
    history doesn't blow out the dashboard's initial render."""
    rows = session.exec(
        select(Lab).order_by(Lab.updated_at.desc()).offset(offset).limit(limit)
    ).all()
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


@router.delete("/{lab_id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=_LIFECYCLE_LIMIT)
def delete_lab(
    lab_id: int,
    session: Annotated[Session, Depends(get_session)],
    force: Annotated[
        bool,
        Query(description="Remove the record even if the VMs/containers could not be torn down."),
    ] = False,
) -> None:
    """Destroy a lab: remove its VMs / containers, verify, then delete the record.

    Unlike a plain row delete this tears the infrastructure down first. If that
    fails the lab is kept (status ``destroy_failed``) and a 502 explains why, so
    nothing is orphaned silently. ``?force=true`` removes the record anyway.
    """
    row = session.get(Lab, lab_id)
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"detail": f"Lab {lab_id} not found", "code": "not_found"},
        )
    try:
        destroy_lab(row, session, force=force)
    except DestroyFailed as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail={
                "detail": f"Could not tear lab {lab_id} down: {exc}. "
                "The lab was kept; fix the problem and retry, or force-delete the record.",
                "code": "destroy_failed",
            },
        ) from exc


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
    except Exception as exc:
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
    dependencies=_BUILD_LIMIT,
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
        lab, workspace = start_build(
            payload.topology,
            session,
            replace=payload.replace,
            publish=payload.publish,
        )
    except BuildPrereqError as exc:
        raise HTTPException(
            status_code=status.HTTP_412_PRECONDITION_FAILED,
            detail={"detail": str(exc), "code": exc.code},
        ) from exc
    except LabExistsError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"detail": str(exc), "code": "lab_exists", "lab_ids": exc.lab_ids},
        ) from exc
    except SubnetConflictError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"detail": str(exc), "code": "subnet_conflict"},
        ) from exc
    except DestroyFailed as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail={
                "detail": f"Could not replace the existing lab: {exc}",
                "code": "destroy_failed",
            },
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
    #   succeeded → running       (everything came up clean)
    #   partial   → partial       (build exited non-zero but at least one
    #                              VM is alive — common when one VM's SSH
    #                              hand-shake times out but the others
    #                              are reachable; user can still poke
    #                              the live ones)
    #   failed    → failed        (build exited non-zero AND no VMs alive)
    #   aborted   → failed        (treated as a hard stop for the lab row)
    new_status: str | None = None
    if snap["phase"] == "succeeded" and lab.status == "building":
        new_status = "running"
    elif snap["phase"] == "partial" and lab.status in ("building", "failed"):
        # Allow promotion FROM failed too — a prior status poll may have
        # written `failed` before all VMs finished hand-shake.
        new_status = "partial"
    elif snap["phase"] in ("failed", "aborted") and lab.status == "building":
        new_status = "failed"
    if new_status is not None and new_status != lab.status:
        lab.status = new_status
        lab.updated_at = datetime.utcnow()
        session.add(lab)
        session.commit()
    return BuildStatus(**snap)


@router.get("/{lab_id}/build/phases", response_model=BuildPhases)
def build_phases(
    lab_id: int,
    session: Annotated[Session, Depends(get_session)],
) -> BuildPhases:
    """Per-VM phase snapshot driven by parsing ``build.log``.

    The /monitor topology view polls this every few seconds to colour
    each node's status ring. Cheap regex scan — see
    ``services.build_runner.parse_per_vm_phases`` for the markers.
    """
    lab = session.get(Lab, lab_id)
    if lab is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"detail": f"Lab {lab_id} not found", "code": "not_found"},
        )
    workspace = _resolve_workspace(lab)
    per_vm = parse_per_vm_phases(workspace)
    snap = read_build_status(workspace)
    return BuildPhases(per_vm=per_vm, overall=snap.get("phase", "unknown"))


@router.get("/{lab_id}/topology", response_model=LabConfig)
def get_lab_topology(
    lab_id: int,
    session: Annotated[Session, Depends(get_session)],
) -> LabConfig:
    """Return the topology JSON that was frozen into the workspace.

    The build runner writes ``topology.json`` into the workspace dir at
    build time. Serving it back here lets the live-topology view on
    /monitor render the same canvas the user designed, without needing
    a separate persisted-topology slug.
    """
    lab = session.get(Lab, lab_id)
    if lab is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"detail": f"Lab {lab_id} not found", "code": "not_found"},
        )
    workspace = _resolve_workspace(lab)
    topology_file = workspace / "topology.json"
    if not topology_file.exists():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={
                "detail": f"Lab {lab_id} has no topology.json in its workspace",
                "code": "no_topology",
            },
        )
    try:
        return LabConfig.model_validate_json(topology_file.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"detail": f"Could not parse topology.json: {exc}", "code": "bad_topology"},
        ) from exc


@router.post(
    "/{lab_id}/build/stop",
    response_model=BuildStatus,
    dependencies=_LIFECYCLE_LIMIT,
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


@router.post("/{lab_id}/halt", response_model=LabSummary, dependencies=_LIFECYCLE_LIMIT)
def halt_lab_route(
    lab_id: int,
    session: Annotated[Session, Depends(get_session)],
) -> LabSummary:
    """Stop a Docker lab's containers and keep its data, network and workspace."""
    lab = session.get(Lab, lab_id)
    if lab is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"detail": f"Lab {lab_id} not found", "code": "not_found"},
        )
    try:
        halt_lab(lab, session)
    except HaltFailed as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"detail": str(exc), "code": "halt_failed"},
        ) from exc
    session.refresh(lab)
    return LabSummary.model_validate(lab, from_attributes=True)


@router.post("/{lab_id}/resume", response_model=LabSummary, dependencies=_BUILD_LIMIT)
def resume_lab_route(
    lab_id: int,
    session: Annotated[Session, Depends(get_session)],
) -> LabSummary:
    """Start a stopped Docker lab again. Progress shows up in /build/status and /build/log."""
    lab = session.get(Lab, lab_id)
    if lab is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"detail": f"Lab {lab_id} not found", "code": "not_found"},
        )
    try:
        resume_lab(lab, session)
    except BuildPrereqError as exc:
        raise HTTPException(
            status_code=status.HTTP_412_PRECONDITION_FAILED,
            detail={"detail": str(exc), "code": exc.code},
        ) from exc
    except HaltFailed as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"detail": str(exc), "code": "resume_failed"},
        ) from exc
    session.refresh(lab)
    return LabSummary.model_validate(lab, from_attributes=True)


@router.get("/{lab_id}/endpoints")
def lab_endpoints(
    lab_id: int,
    session: Annotated[Session, Depends(get_session)],
) -> list[dict[str, object]]:
    """Addresses a running Docker lab publishes on this computer (Kibana, consoles, RDP)."""
    lab = session.get(Lab, lab_id)
    if lab is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"detail": f"Lab {lab_id} not found", "code": "not_found"},
        )
    workspace = _resolve_workspace(lab)
    return endpoints_from_workspace(workspace)


@router.get("/build/preflight")
def build_preflight(
    provider: Annotated[str | None, Query(description="Topology provider to check, e.g. virtualbox")] = None,
) -> dict[str, object]:
    """Cheap probe so the UI can disable / warn on the Build button.

    ``vagrant_available`` / ``vagrant_version`` / ``default_provider`` describe
    the VM providers; the ``docker_*`` and ``compose_*`` keys describe the
    docker runtime. Both sets are always present so the UI can pick the check
    that matches the topology's provider. Pass ``provider`` to also get
    ``provider_problem`` (blocks a build) and ``provider_warnings`` (advice)
    for that provider on this host.
    """
    status = hostenv.vm_runtime_status()
    payload: dict[str, object] = {
        "vagrant_available": bool(status["vagrant_version"]),
        "vagrant_version": status["vagrant_version"],
        "virtualbox_version": status["virtualbox_version"],
        "vmware_available": bool(status["vmware_vmrun"]),
        "vmware_plugin": status["vmware_plugin"],
        "hypervisor_present": status["hypervisor_present"],
        "host_os": status["host_os"],
        "host_arch": status["host_arch"],
        "host_memory_mb": status["memory_mb"],
    }
    default_provider = os.environ.get("VAGRANT_DEFAULT_PROVIDER")
    if default_provider:
        payload["default_provider"] = default_provider
    payload.update(docker_runtime.runtime_status())
    if provider:
        try:
            prov = Provider(provider)
        except ValueError:
            prov = None
        if prov is not None:
            problem = hostenv.provider_problem(prov, status) if prov is not Provider.DOCKER else None
            payload["provider_problem"] = {"code": problem[0], "message": problem[1]} if problem else None
            payload["provider_warnings"] = hostenv.provider_warnings(prov, status)
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
