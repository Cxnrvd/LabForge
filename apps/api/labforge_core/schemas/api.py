"""API-only request/response models (not part of the canonical topology schema)."""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from labforge_schema import LabConfig
from pydantic import BaseModel, ConfigDict, Field


class GenerateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    topology: LabConfig
    include_readme: bool = True
    include_hosts_file: bool = True
    # Docker runtime only: bind service ports to 127.0.0.1 ("loopback") or
    # publish nothing ("none").
    publish: Literal["none", "loopback"] = "loopback"


class BuildRequest(BaseModel):
    """In-app `Build Lab` — same payload as Generate, plus build options."""

    model_config = ConfigDict(extra="forbid")
    topology: LabConfig
    workspace_name: str | None = None
    # Tear down any existing lab built from the same topology name first.
    # Without it a second Build of a running lab is refused (409).
    replace: bool = False
    publish: Literal["none", "loopback"] = "loopback"


class BuildResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")
    lab_id: int
    workspace_path: str
    pid: int | None = None


class BuildLogChunk(BaseModel):
    model_config = ConfigDict(extra="forbid")
    lines: list[str] = Field(default_factory=list)
    next_offset: int = 0
    bytes_total: int = 0


class BuildStatus(BaseModel):
    model_config = ConfigDict(extra="forbid")
    # Vocabulary returned by services.build_runner.read_build_status:
    #   "running"   — .build.pid exists, no .build.exit yet
    #   "succeeded" — .build.exit 0
    #   "partial"   — .build.exit != 0 BUT at least one VM is still alive
    #                 in the hypervisor (e.g. SSH timeout on the last VM
    #                 while earlier VMs are reachable)
    #   "failed"    — .build.exit != 0 and no VMs alive
    #   "aborted"   — .build.aborted sentinel present (user-initiated stop)
    #   "unknown"   — no sentinels at all
    phase: str
    exit_code: int | None = None
    finished_at: str | None = None
    pid: int | None = None


class BuildPhases(BaseModel):
    """Per-VM phase snapshot for the /monitor stepper.

    Keys are hostnames as they appear in the topology. Values are one of
    the strings from ``services.build_runner._PHASE_ORDER`` plus
    ``failed`` when an error marker is observed.
    """

    model_config = ConfigDict(extra="forbid")
    per_vm: dict[str, str] = Field(default_factory=dict)
    overall: str  # "running" | "succeeded" | "failed" | "aborted" | "unknown"


class TemplateSummary(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str
    name: str
    description: str
    node_count: int
    edge_count: int


class LabSummary(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: int
    topology_slug: str
    name: str
    provider: str
    status: str
    workspace_path: str | None = None
    created_at: datetime
    updated_at: datetime


class LabCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    topology_slug: str = Field(min_length=1)
    name: str = Field(min_length=1, max_length=128)
    provider: str = "virtualbox"
    workspace_path: str | None = None


class ErrorResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")
    detail: str
    code: str


class VmState(BaseModel):
    model_config = ConfigDict(extra="forbid")
    hostname: str
    state: str  # "running" | "poweroff" | "saved" | "not_created" | "aborted" | ...
    provider: str | None = None
    ip: str | None = None


class FlowSample(BaseModel):
    """One source→destination flow observed during a heartbeat window.

    The window is the gap between the previous and current heartbeat
    (typically ~10 s). ``packets`` is a count; ``bytes_estimate`` is the
    sum of caplen values from tcpdump (or 0 if the tool didn't expose it).
    """

    model_config = ConfigDict(extra="forbid")
    src_ip: str
    dst_ip: str
    packets: int = 0
    bytes_estimate: int = 0
    protocol: str | None = None


class HeartbeatPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    lab_status: str = "unknown"
    vms: list[VmState] = Field(default_factory=list)
    log_tail: list[str] = Field(default_factory=list)
    flows: list[FlowSample] = Field(default_factory=list)
    captured_at: datetime | None = None


class ActivityEntry(BaseModel):
    model_config = ConfigDict(extra="forbid")
    lab_id: int
    lab_name: str
    captured_at: datetime
    lab_status: str
    running_vms: int
    total_vms: int
    log_snippet: str | None = None
