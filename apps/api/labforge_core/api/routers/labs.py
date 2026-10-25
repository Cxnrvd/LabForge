"""Lab lifecycle records + heartbeat ingest from the agent."""

from __future__ import annotations

import asyncio
import json
import logging
import os
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Annotated

from fastapi import (
    APIRouter,
    Depends,
    HTTPException,
    Query,
    Request,
    Response,
    WebSocket,
    WebSocketDisconnect,
    status,
)
from fastapi import Path as PathParam
from labforge_schema import LabConfig, Provider
from sqlmodel import Session, select

from labforge_core.api.rate_limit import limit, rate_limited
from labforge_core.api.security import require_agent_token
from labforge_core.models import Lab, LabHeartbeat, get_engine, get_session
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
from labforge_core.services import docker_runtime, hostenv, images
from labforge_core.services import workspace as workspace_store
from labforge_core.services.build_runner import (
    ALL_WIFI_SCENARIOS,
    NODE_FILES,
    BuildPrereqError,
    DestroyFailed,
    HaltFailed,
    LabExistsError,
    NodeNotFound,
    SubnetConflictError,
    apply_wifi_scenario,
    destroy_lab,
    fetch_node_file,
    fetch_wazuh_password,
    halt_lab,
    node_log,
    parse_per_vm_phases,
    pause_lab,
    pause_node,
    read_build_status,
    read_log_chunk,
    resume_lab,
    start_build,
    start_node,
    stop_build,
    stop_node,
)
from labforge_core.services.compose_generator import endpoints_from_workspace
from labforge_core.services.live_bus import bus
from labforge_core.services.template_loader import TemplateNotFound, get_template

_LOGGER = logging.getLogger("labforge.labs")

router = APIRouter(prefix="/labs", tags=["labs"])
# Real ids are small positive integers; anything larger overflows SQLite and used to be a 500.
LabId = Annotated[int, PathParam(ge=1, le=2_147_483_647)]

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
        created_at=datetime.now(UTC),
        updated_at=datetime.now(UTC),
    )
    session.add(row)
    session.commit()
    session.refresh(row)
    return LabSummary.model_validate(row, from_attributes=True)


@router.get("/{lab_id}", response_model=LabSummary)
def get_lab(
    lab_id: LabId,
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
    lab_id: LabId,
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
    row.updated_at = datetime.now(UTC)
    session.add(row)
    session.commit()
    session.refresh(row)
    return LabSummary.model_validate(row, from_attributes=True)


@router.delete("/{lab_id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=_LIFECYCLE_LIMIT)
def delete_lab(
    lab_id: LabId,
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
    lab_id: LabId,
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

    captured_at = payload.captured_at or datetime.now(UTC)
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

    # `pause_lab`/`resume_lab`/`halt_lab` set `lab.status` explicitly and bump
    # `updated_at` at the moment they act. The daemon they just told to stop
    # (or restart) can still have one heartbeat in flight sampled a moment
    # earlier, reporting the pre-transition state — most visibly, a sample
    # taken just before `vagrant suspend` finishes can still read "running"
    # and would otherwise stomp the "paused" this request just set. Give an
    # explicit transition a short grace window to win over a stale,
    # contradicting heartbeat instead of unconditionally overwriting it.
    def _aware(dt: datetime) -> datetime:
        return dt if dt.tzinfo is not None else dt.replace(tzinfo=UTC)

    stale_grace = (
        lab.status in ("paused", "building")
        and payload.lab_status
        and payload.lab_status != lab.status
        and (_aware(captured_at) - _aware(lab.updated_at)).total_seconds() < 20
    )
    if not stale_grace:
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
    lab_id: LabId,
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
    lab_id: LabId,
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


def _lookup_lab(lab_id: int) -> Lab:
    """Fetch a Lab row through a short-lived session that releases its pooled
    connection immediately, instead of one held open (via ``Depends(get_session)``)
    for the full duration of a slow ``vagrant ssh`` call below. Holding a pool
    connection across a 60-90s subprocess starves the shared pool (5 + 10
    overflow) and cascades into unrelated endpoints failing with
    ``QueuePool ... timed out`` once a couple of these stack up against an
    unreachable VM."""
    with Session(get_engine()) as session:
        lab = session.get(Lab, lab_id)
        if lab is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Lab not found")
        session.expunge(lab)
        return lab


@router.get("/{lab_id}/node-log/{hostname}", response_model=list[str])
def node_log_endpoint(
    lab_id: LabId,
    hostname: str,
    service: str = Query(default="hostapd"),
    lines: int = Query(default=100, ge=1, le=500),
) -> list[str]:
    """Best-effort live tail of a service's journal inside one guest VM —
    used by the webinar dashboard to show hostapd's own log (association,
    deauth, EAPOL activity) without wiring up a real SIEM query. Never
    errors the request; a VM that isn't reachable yet just comes back as a
    single explanatory line."""
    lab = _lookup_lab(lab_id)
    workspace = _resolve_workspace(lab)
    out, err = node_log(workspace, hostname, lab.provider == "docker", service, lines)
    return out if err is None else [f"[{err}]"]


@router.get("/{lab_id}/wazuh-password/{hostname}")
def wazuh_password_endpoint(lab_id: LabId, hostname: str) -> dict[str, object]:
    """Read the Wazuh dashboard admin password straight off the manager VM.

    Deliberately not a log lookup: the install step that generates this
    password only ever runs once, on the VM's first `vagrant up` — asking
    a user to go find that line in build.log breaks the moment the lab is
    resumed/rebuilt after it already scrolled past, or the log itself was
    rotated. This re-reads the fixed file the wazuh-manager role drops on
    disk, live, every time it's called, so the UI's AccessPanel can just
    offer a button instead of a "search the log" instruction that cannot
    be guaranteed to work.
    """
    lab = _lookup_lab(lab_id)
    workspace = _resolve_workspace(lab)
    password, err = fetch_wazuh_password(workspace, hostname, lab.provider == "docker")
    return {"ok": password is not None, "password": password, "error": err}


@router.post("/{lab_id}/wifi-scenario/{hostname}")
def wifi_scenario_endpoint(
    lab_id: LabId,
    hostname: str,
    scenario: str = Query(description=f"One of: {', '.join(sorted(ALL_WIFI_SCENARIOS))}"),
) -> dict[str, object]:
    """Switch a hostapd node to a named demo scenario (open/wep/wpa2/wpa3) and
    restart hostapd — the webinar dashboard's segment switcher. Returns
    ``{ok, message}`` with a 200 either way; the caller checks ``ok``, since
    a VM that isn't reachable is an expected, recoverable state here, not a
    server error."""
    lab = _lookup_lab(lab_id)
    workspace = _resolve_workspace(lab)
    ok, message = apply_wifi_scenario(workspace, hostname, lab.provider == "docker", scenario)
    return {"ok": ok, "message": message}


@router.get("/{lab_id}/node-file/{hostname}")
def node_file_endpoint(
    lab_id: LabId,
    hostname: str,
    file: str = Query(description=f"One of: {', '.join(sorted(NODE_FILES))}"),
) -> Response:
    """Download one allowlisted file out of a guest VM — today, the hostapd
    role's rolling capture.pcap, so a webinar segment's traffic can be
    reviewed after the fact instead of only watched scroll by in the log."""
    if file not in NODE_FILES:
        raise HTTPException(status_code=400, detail=f"Unknown file {file!r}")
    lab = _lookup_lab(lab_id)
    workspace = _resolve_workspace(lab)
    data, err = fetch_node_file(workspace, hostname, lab.provider == "docker", NODE_FILES[file])
    if err is not None:
        raise HTTPException(status_code=502, detail=err)
    return Response(
        content=data,
        media_type="application/vnd.tcpdump.pcap",
        headers={"Content-Disposition": f'attachment; filename="{hostname}-{file}"'},
    )


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
    lab_id: LabId,
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
    lab_id: LabId,
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
        lab.updated_at = datetime.now(UTC)
        session.add(lab)
        session.commit()
    return BuildStatus(**snap)


@router.get("/{lab_id}/build/phases", response_model=BuildPhases)
def build_phases(
    lab_id: LabId,
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
    lab_id: LabId,
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
    lab_id: LabId,
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
        lab.updated_at = datetime.now(UTC)
        session.add(lab)
        session.commit()
    return BuildStatus(**read_build_status(workspace))


@router.post("/{lab_id}/halt", response_model=LabSummary, dependencies=_LIFECYCLE_LIMIT)
def halt_lab_route(
    lab_id: LabId,
    session: Annotated[Session, Depends(get_session)],
) -> LabSummary:
    """Stop a lab's containers/VMs and keep its data, network and workspace.

    Docker: ``compose stop``. Vagrant: ``vagrant halt`` (full poweroff —
    for a faster round-trip, use POST /{lab_id}/pause instead)."""
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


@router.post("/{lab_id}/pause", response_model=LabSummary, dependencies=_LIFECYCLE_LIMIT)
def pause_lab_route(
    lab_id: LabId,
    session: Annotated[Session, Depends(get_session)],
) -> LabSummary:
    """Pause a running lab without tearing it down — available for every
    runtime. Vagrant: ``vagrant suspend`` (RAM state saved to disk, VM
    powered off). Docker: ``docker compose pause`` (containers frozen via
    the cgroup freezer, stay resident in memory). Either way, POST
    /{lab_id}/resume afterward is faster than Stop + Start."""
    lab = session.get(Lab, lab_id)
    if lab is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"detail": f"Lab {lab_id} not found", "code": "not_found"},
        )
    try:
        pause_lab(lab, session)
    except HaltFailed as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"detail": str(exc), "code": "pause_failed"},
        ) from exc
    session.refresh(lab)
    return LabSummary.model_validate(lab, from_attributes=True)


@router.post("/{lab_id}/resume", response_model=LabSummary, dependencies=_BUILD_LIMIT)
def resume_lab_route(
    lab_id: LabId,
    session: Annotated[Session, Depends(get_session)],
) -> LabSummary:
    """Start a stopped or paused lab again. Progress shows up in /build/status and /build/log."""
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


def _node_action_error(exc: Exception, code: str) -> HTTPException:
    if isinstance(exc, NodeNotFound):
        return HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"detail": str(exc), "code": "node_not_found"},
        )
    return HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail={"detail": str(exc), "code": code},
    )


@router.post("/{lab_id}/nodes/{hostname}/stop", dependencies=_LIFECYCLE_LIMIT)
def stop_node_route(
    lab_id: LabId,
    hostname: str,
    session: Annotated[Session, Depends(get_session)],
) -> dict[str, str]:
    """Power off one VM (``vagrant halt <hostname>``), leaving the rest of the lab running."""
    lab = _lookup_lab(lab_id)
    try:
        stop_node(lab, session, hostname)
    except (HaltFailed, NodeNotFound) as exc:
        raise _node_action_error(exc, "node_stop_failed") from exc
    return {"hostname": hostname, "action": "stop"}


@router.post("/{lab_id}/nodes/{hostname}/pause", dependencies=_LIFECYCLE_LIMIT)
def pause_node_route(
    lab_id: LabId,
    hostname: str,
    session: Annotated[Session, Depends(get_session)],
) -> dict[str, str]:
    """Suspend one VM (``vagrant suspend <hostname>``), leaving the rest of the lab running."""
    lab = _lookup_lab(lab_id)
    try:
        pause_node(lab, session, hostname)
    except (HaltFailed, NodeNotFound) as exc:
        raise _node_action_error(exc, "node_pause_failed") from exc
    return {"hostname": hostname, "action": "pause"}


@router.post("/{lab_id}/nodes/{hostname}/start", dependencies=_BUILD_LIMIT)
def start_node_route(
    lab_id: LabId,
    hostname: str,
    session: Annotated[Session, Depends(get_session)],
) -> dict[str, str]:
    """Bring one VM up (``vagrant up <hostname>``) from halted, suspended, or
    an externally-killed state — the same verb covers all three."""
    lab = _lookup_lab(lab_id)
    try:
        start_node(lab, session, hostname)
    except (HaltFailed, NodeNotFound) as exc:
        raise _node_action_error(exc, "node_start_failed") from exc
    return {"hostname": hostname, "action": "start"}


@router.post("/{lab_id}/nodes/{hostname}/resume", dependencies=_BUILD_LIMIT)
def resume_node_route(
    lab_id: LabId,
    hostname: str,
    session: Annotated[Session, Depends(get_session)],
) -> dict[str, str]:
    """Alias of start for a suspended VM — ``vagrant up <hostname>`` is the
    right verb either way, kept as a separate route so the UI can show a
    Resume label instead of Start when the VM is suspended rather than off."""
    lab = _lookup_lab(lab_id)
    try:
        start_node(lab, session, hostname)
    except (HaltFailed, NodeNotFound) as exc:
        raise _node_action_error(exc, "node_resume_failed") from exc
    return {"hostname": hostname, "action": "resume"}


@router.get("/{lab_id}/endpoints")
def lab_endpoints(
    lab_id: LabId,
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
    template_id: Annotated[
        str | None, Query(description="Bundled template to report per-image readiness for")
    ] = None,
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
        "virtualbox_extpack": status["virtualbox_extpack"],
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
    payload["workspace"] = workspace_store.status()
    if template_id:
        try:
            payload["images"] = images.plan(get_template(template_id))
        except TemplateNotFound:
            raise HTTPException(
                status_code=404,
                detail={"detail": "Unknown template", "code": "not_found"},
            ) from None
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
async def live_stream(websocket: WebSocket, lab_id: LabId) -> None:
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
    since = datetime.now(UTC) - timedelta(hours=24)
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
