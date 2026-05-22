"use client";

import * as React from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  type Edge,
  type Node as RFNode,
} from "@xyflow/react";
import { useQuery } from "@tanstack/react-query";

import type { LabConfig, NodeType, OsType, Protocol } from "@labforge/schema";
import { api, type BuildPhase, type BuildPhasesPayload } from "@/lib/api/client";
import { useLiveBus, type LiveBusEvent } from "@/lib/api/live-bus";
import { Skeleton } from "@/components/ui/skeleton";

import {
  LiveTopologyNode,
  type LiveTopologyNodeData,
  type LiveNodeState,
} from "./LiveTopologyNode";
import { BuildPhaseStepper } from "./BuildPhaseStepper";

const nodeTypes = { liveNode: LiveTopologyNode };

// Heartbeat / flow shape served by the live bus.
interface HeartbeatVm {
  hostname: string;
  state: string;
  ip?: string | null;
  provider?: string | null;
}

interface FlowSample {
  src_ip: string;
  dst_ip: string;
  protocol?: string | null;
  packets: number;
  bytes_estimate: number;
}

interface HeartbeatData {
  lab_status?: string;
  vms?: HeartbeatVm[];
  flows?: FlowSample[];
}

const FLOW_WINDOW_MS = 30_000; // 30s rolling traffic window
const FLOW_KEY_SEP = "→";

interface FlowMemory {
  expiresAt: number;
  packets: number;
}

function _flowKey(srcIp: string, dstIp: string, protocol?: string | null): string {
  return `${srcIp}${FLOW_KEY_SEP}${dstIp}${FLOW_KEY_SEP}${(protocol ?? "").toLowerCase()}`;
}

function _stateFromTelemetry(
  buildPhase: BuildPhase | undefined,
  vmState: string | undefined,
  overall: BuildPhasesPayload["overall"],
): LiveNodeState {
  if (vmState === "running") return "running";
  if (buildPhase === "failed" || overall === "failed" || overall === "aborted") {
    return "failed";
  }
  if (buildPhase === "ready") return "running";
  if (buildPhase) return "provisioning";
  if (overall === "running") return "defined";
  return "defined";
}

function InnerView({ labId }: { labId: number }) {
  // ------------------------------------------------------------- data
  const topologyQ = useQuery<LabConfig>({
    queryKey: ["lab-topology", labId],
    queryFn: () => api.getLabTopology(labId),
    enabled: Number.isFinite(labId),
    staleTime: Infinity, // topology.json is frozen at build time
  });

  const phasesQ = useQuery<BuildPhasesPayload>({
    queryKey: ["build-phases", labId],
    queryFn: () => api.buildPhases(labId),
    enabled: Number.isFinite(labId),
    refetchInterval: 2500,
  });

  // Heartbeat carries VM up/down state + tcpdump flow samples. The
  // WebSocket drives both the per-node "running" ring and the
  // animated traffic-flow edges. Polling /heartbeat is a fallback if
  // the WS drops; the existing live-bus hook already retries 3 times.
  const [vmStates, setVmStates] = React.useState<Record<string, HeartbeatVm>>({});
  // hostname → most-recent IP that heartbeats report it on.
  const [recentFlows, setRecentFlows] = React.useState<Map<string, FlowMemory>>(
    () => new Map(),
  );

  const onEvent = React.useCallback((ev: LiveBusEvent) => {
    if (ev.type !== "heartbeat" || !ev.data) return;
    const hb = ev.data as HeartbeatData;
    if (hb.vms) {
      setVmStates((prev) => {
        const next = { ...prev };
        for (const vm of hb.vms!) {
          if (vm.hostname) next[vm.hostname] = vm;
        }
        return next;
      });
    }
    if (hb.flows && hb.flows.length > 0) {
      setRecentFlows((prev) => {
        const now = Date.now();
        const next = new Map(prev);
        for (const f of hb.flows!) {
          if (!f.src_ip || !f.dst_ip) continue;
          const key = _flowKey(f.src_ip, f.dst_ip, f.protocol);
          next.set(key, {
            expiresAt: now + FLOW_WINDOW_MS,
            packets: (next.get(key)?.packets ?? 0) + (f.packets ?? 0),
          });
        }
        // Garbage-collect expired entries inline so the map doesn't
        // grow forever on long-running labs.
        for (const [k, v] of next) if (v.expiresAt < now) next.delete(k);
        return next;
      });
    }
  }, []);

  useLiveBus(Number.isFinite(labId) ? labId : null, { onEvent });

  // Force re-render every 5s so animated edges naturally fade when
  // their flow memory expires without us getting a fresh heartbeat.
  const [, setTick] = React.useState(0);
  React.useEffect(() => {
    const t = window.setInterval(() => setTick((n) => n + 1), 5000);
    return () => window.clearInterval(t);
  }, []);

  // ------------------------------------------------------------- derived
  const topology = topologyQ.data;
  const phases = phasesQ.data?.per_vm ?? {};
  const overall = phasesQ.data?.overall ?? "unknown";

  const flowNodes: RFNode<LiveTopologyNodeData>[] = React.useMemo(() => {
    if (!topology) return [];
    return topology.nodes.map((n) => {
      const vm = vmStates[n.config.hostname];
      const buildPhase = phases[n.config.hostname];
      const state = _stateFromTelemetry(buildPhase, vm?.state, overall);
      return {
        id: n.id,
        type: "liveNode",
        position: { x: n.position.x, y: n.position.y },
        data: {
          type: n.type as NodeType,
          hostname: n.config.hostname,
          label: n.label,
          ip: vm?.ip ?? n.config.ip,
          os: n.config.os as OsType,
          roles: n.config.roles,
          state,
          buildPhase,
        },
        draggable: false,
        selectable: false,
      };
    });
  }, [topology, vmStates, phases, overall]);

  const flowEdges: Edge[] = React.useMemo(() => {
    if (!topology) return [];
    // Build a hostname→IP lookup so we can match flow samples back to
    // topology edges. Prefer heartbeat-reported IP when present; fall
    // back to the topology's declared IP otherwise.
    const ipByHostname = new Map<string, string>();
    for (const n of topology.nodes) {
      const hb = vmStates[n.config.hostname];
      ipByHostname.set(n.config.hostname, hb?.ip ?? n.config.ip);
    }
    const idToHostname = new Map<string, string>();
    for (const n of topology.nodes) idToHostname.set(n.id, n.config.hostname);

    const now = Date.now();

    return topology.edges.map((e) => {
      const srcHost = idToHostname.get(e.source);
      const dstHost = idToHostname.get(e.target);
      const srcIp = srcHost ? ipByHostname.get(srcHost) : undefined;
      const dstIp = dstHost ? ipByHostname.get(dstHost) : undefined;

      // Match either direction since most chatty protocols are
      // bidirectional; the visual just shows "there is traffic on
      // this edge", not which side initiated.
      let live = false;
      let packets = 0;
      if (srcIp && dstIp) {
        const candidates = [
          _flowKey(srcIp, dstIp, e.protocol as Protocol),
          _flowKey(dstIp, srcIp, e.protocol as Protocol),
          // Daemon sometimes can't fill protocol — match without it
          // too so plain TCP/UDP samples still light up the edge.
          _flowKey(srcIp, dstIp),
          _flowKey(dstIp, srcIp),
        ];
        for (const k of candidates) {
          const f = recentFlows.get(k);
          if (f && f.expiresAt > now) {
            live = true;
            packets += f.packets;
          }
        }
      }

      return {
        id: e.id,
        source: e.source,
        target: e.target,
        animated: live,
        label: e.label ?? `${e.protocol}${e.port ? `:${e.port}` : ""}`,
        labelBgPadding: [4, 2] as [number, number],
        labelBgBorderRadius: 4,
        labelBgStyle: { fill: live ? "rgba(16, 185, 129, 0.15)" : "rgba(148,163,184,0.10)" },
        style: {
          stroke: live ? "rgb(16, 185, 129)" : "rgb(148, 163, 184)",
          strokeWidth: live ? 2 : 1,
          opacity: live ? 1 : 0.55,
          transition: "stroke 200ms, stroke-width 200ms, opacity 200ms",
        },
        data: { packets },
      } satisfies Edge;
    });
  }, [topology, vmStates, recentFlows]);

  // ------------------------------------------------------------- render
  if (topologyQ.isLoading) {
    return (
      <div className="flex h-full flex-col gap-3 p-4">
        <Skeleton className="h-8 w-full" />
        <Skeleton className="flex-1" />
      </div>
    );
  }
  if (topologyQ.isError) {
    return (
      <div className="m-4 rounded border border-amber-500/40 bg-amber-500/10 p-3 text-xs">
        Could not load the topology for this lab. The build may have wiped
        the workspace, or the API doesn&apos;t yet serve a topology for
        this lab id. Switch to the Logs tab to see what&apos;s happening.
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="border-b p-2">
        <BuildPhaseStepper perVm={phases} overall={overall} />
      </div>
      <div className="relative flex-1">
        <ReactFlow
          nodes={flowNodes}
          edges={flowEdges}
          nodeTypes={nodeTypes}
          fitView
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          panOnDrag
          zoomOnScroll
          minZoom={0.2}
          maxZoom={2}
          proOptions={{ hideAttribution: true }}
        >
          <Background variant={BackgroundVariant.Dots} gap={20} size={1} />
          <Controls position="bottom-left" showInteractive={false} />
          <MiniMap position="bottom-right" pannable zoomable />
        </ReactFlow>
        <Legend />
      </div>
    </div>
  );
}

function Legend() {
  return (
    <div className="pointer-events-none absolute top-4 left-4 flex flex-col gap-1 rounded-md border bg-card/90 p-2 text-[10px] shadow backdrop-blur">
      <p className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
        Live state
      </p>
      <LegendItem color="rgba(148, 163, 184, 0.45)" label="defined" />
      <LegendItem color="rgba(245, 158, 11, 0.85)" label="provisioning" />
      <LegendItem color="rgba(16, 185, 129, 0.85)" label="running" />
      <LegendItem color="rgba(239, 68, 68, 0.95)" label="failed" />
      <p className="mt-1 text-[9px] text-muted-foreground">
        Solid green edge = traffic seen in the last 30 s
      </p>
    </div>
  );
}

function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span
        className="inline-block h-2.5 w-2.5 rounded-full"
        style={{ background: color }}
      />
      <span>{label}</span>
    </div>
  );
}

export function LiveTopologyView({ labId }: { labId: number }) {
  return (
    <ReactFlowProvider>
      <InnerView labId={labId} />
    </ReactFlowProvider>
  );
}
