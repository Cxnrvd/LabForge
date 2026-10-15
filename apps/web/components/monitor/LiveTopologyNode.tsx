"use client";

import * as React from "react";
import { Handle, Position } from "@xyflow/react";

import type { NodeType, OsType } from "@labforge/schema";
import { ILLUSTRATIONS } from "@/components/canvas/illustrations";
import { cn } from "@/lib/utils/cn";

import type { BuildPhase } from "@/lib/api/client";

export type LiveNodeState = "defined" | "provisioning" | "running" | "failed";

// React Flow's Node generic constrains data to `Record<string, unknown>`,
// so the interface must be assignable to that. Using a type intersection
// keeps the named fields IDE-friendly while still satisfying the constraint.
export type LiveTopologyNodeData = Record<string, unknown> & {
  type: NodeType;
  hostname: string;
  label: string;
  ip: string;
  os: OsType;
  roles: readonly string[];
  state: LiveNodeState;
  /** Phase reported by build.log (used for tooltip detail). */
  buildPhase?: BuildPhase;
};

/**
 * Read-only monitor-page node. Same illustration as the design canvas
 * but stripped of selection / settings / drag affordances and wrapped
 * in a coloured status ring driven by build/heartbeat telemetry.
 *
 * Ring colours follow the LabForge status vocabulary:
 *   gray   = defined, not yet booting
 *   amber  = provisioning (build.log shows progress)
 *   green  = running (heartbeat reports the VM as up)
 *   red    = failed / aborted
 */
const RING_COLORS: Record<LiveNodeState, string> = {
  defined: "rgba(148, 163, 184, 0.45)", // slate-400/45
  provisioning: "rgba(245, 158, 11, 0.85)", // amber-500
  running: "rgba(16, 185, 129, 0.85)", // emerald-500
  failed: "rgba(239, 68, 68, 0.95)", // red-500
};

const RING_LABELS: Record<LiveNodeState, string> = {
  defined: "defined",
  provisioning: "provisioning",
  running: "running",
  failed: "failed",
};

const ACCENTS: Record<NodeType, string> = {
  workstation: "#7BA1C7",
  server: "#7CB6C2",
  domain_controller: "#9B86C2",
  router: "#C9A07A",
  firewall: "#C28A8A",
  attacker: "#C28098",
  target: "#C2A872",
  database: "#7AB695",
  ics_plc: "#C2B47A",
  ics_hmi: "#7AB6AE",
  camera: "#A096C2",
  internet: "#7AAFC9",
};

export function LiveTopologyNode({ data }: { data: LiveTopologyNodeData }) {
  const Illustration = ILLUSTRATIONS[data.type];
  const ring = RING_COLORS[data.state];
  // Pulse the ring while the node is mid-provisioning so the eye is
  // drawn to in-flight work without overwhelming a static "running"
  // graph.
  const pulse = data.state === "provisioning";

  return (
    <div className="group relative flex w-[148px] flex-col items-center">
      {/*
        React Flow needs at least one Handle of each kind for edges to
        anchor cleanly. We keep them invisible (opacity:0,
        pointer-events:none) so they don't interfere with the
        illustration, and pin them to the vertical centre of the 112px
        icon (top:56) so edge labels float between icons rather than in
        empty space above the node.
      */}
      <Handle
        type="target"
        position={Position.Left}
        style={{ top: 56, left: 18, opacity: 0, pointerEvents: "none" }}
        className="!h-2 !w-2 !border-0 !bg-transparent"
        isConnectable={false}
      />
      <Handle
        type="source"
        position={Position.Right}
        style={{ top: 56, right: 18, opacity: 0, pointerEvents: "none" }}
        className="!h-2 !w-2 !border-0 !bg-transparent"
        isConnectable={false}
      />
      <div
        className={cn("relative rounded-full", pulse && "animate-pulse")}
        style={{ filter: `drop-shadow(0 0 10px ${ring})` }}
      >
        <Illustration
          accent={ACCENTS[data.type]}
          os={data.os}
          roles={data.roles}
          className="h-[112px] w-[112px] select-none"
        />
        <span
          className="pointer-events-none absolute -bottom-1 -right-1 inline-flex h-3 w-3 rounded-full ring-2 ring-background"
          style={{ background: ring }}
          title={`${data.hostname}: ${RING_LABELS[data.state]}${data.buildPhase ? ` (${data.buildPhase})` : ""}`}
        />
      </div>
      <div className="mt-1 flex max-w-[160px] flex-col items-center text-center">
        <p className="text-sm font-semibold leading-tight text-foreground">
          {data.hostname}
        </p>
        <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
          {data.label}
        </p>
        <code className="mt-1 rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] leading-tight">
          {data.ip}
        </code>
        {data.buildPhase && data.state !== "running" && (
          <span className="mt-0.5 text-[10px] text-muted-foreground">
            {data.buildPhase}
          </span>
        )}
      </div>
    </div>
  );
}
