"use client";

import * as React from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  useStore,
  type Edge,
  type Node as RFNode,
} from "@xyflow/react";
import { useQuery } from "@tanstack/react-query";

import type { LabConfig, NodeType, OsType, Protocol, TopologyNode } from "@labforge/schema";
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

// ---------------------------------------------------------------- access panel
//
// "Where do I actually reach this thing" is scattered across role scripts and
// README output today — the user has to SSH in and search. One role can map
// to zero, one, or several reachable endpoints; everything else (databases,
// log shippers, RADIUS) has no browsable UI at all, so it's left out rather
// than padded with "no web UI" noise for every node.
// The visible label is always "ip:port" — that's the literal ask: a user
// should be able to read the address off this panel without opening the
// link, not decode a prose name back into a port number themselves.
interface AccessEndpoint {
  ip: string;
  port: number;
  label: string; // what it's for, e.g. "captive portal" / "ssh" — shown as a suffix, never standing in for the address
  scheme?: "http" | "https"; // present only for entries that are actually clickable
}

const WINDOWS_OS = new Set<OsType>([
  "windows_10",
  "windows_11",
  "windows_server_2019",
  "windows_server_2022",
] as OsType[]);

// Role (base name, "@version" suffix already stripped) -> extra endpoints
// beyond the universal ssh/rdp line. Only roles with a confirmed, reachable
// UI/port are listed — see role_installers.py for the source of truth on
// each port (e.g. splunk-enterprise installs only the forwarder, no web UI,
// so it's deliberately absent here).
function _roleEndpoints(role: string, ip: string): AccessEndpoint[] {
  switch (role) {
    case "captive-portal":
      return [{ ip, port: 80, label: "captive portal", scheme: "http" }];
    case "wazuh-manager":
      return [{ ip, port: 443, label: "Wazuh dashboard", scheme: "https" }];
    case "apache":
      return [{ ip, port: 80, label: "Apache", scheme: "http" }];
    case "log4shell-target":
      return [{ ip, port: 8080, label: "vuln app", scheme: "http" }];
    default:
      return [];
  }
}

function accessEndpoints(node: TopologyNode): AccessEndpoint[] {
  const ip = node.config.ip;
  const windows = WINDOWS_OS.has(node.config.os);
  const out: AccessEndpoint[] = [];
  const seen = new Set<string>();
  for (const role of node.config.roles ?? []) {
    for (const ep of _roleEndpoints(role.split("@")[0] ?? role, ip)) {
      const key = `${ep.port}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(ep);
    }
  }
  // Universal fallback so every node still shows *something* to connect
  // with, even one with no web role at all.
  out.push(
    windows
      ? { ip, port: 3389, label: "RDP" }
      : { ip, port: 22, label: `ssh as ${node.config.credentials.username}` },
  );
  return out;
}

function AccessPanel({ topology, labId }: { topology: LabConfig; labId: number }) {
  const nodes = topology.nodes.filter((n) => n.type !== "internet");
  if (nodes.length === 0) return null;
  const wazuhManager = nodes.find((n) =>
    (n.config.roles ?? []).some((r) => r.split("@")[0] === "wazuh-manager"),
  );
  return (
    <div className="border-t bg-muted/30 px-3 py-2">
      <p className="mb-1 text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
        Accessible via
      </p>
      <div
        className="grid gap-x-3 gap-y-0.5 text-[10px] leading-tight"
        style={{ gridTemplateColumns: "max-content max-content 1fr" }}
      >
        {nodes.map((n) => (
          <React.Fragment key={n.id}>
            <span className="font-medium text-foreground">{n.config.hostname}</span>
            <span className="font-mono text-muted-foreground">
              {n.config.credentials.username}/{n.config.credentials.password}
            </span>
            <span className="flex flex-wrap gap-x-2 text-muted-foreground">
              {accessEndpoints(n).map((ep, i) => {
                const address = `${ep.ip}:${ep.port}`;
                return (
                  <React.Fragment key={`${ep.ip}:${ep.port}`}>
                    {i > 0 && <span className="opacity-50">·</span>}
                    {ep.scheme ? (
                      <a
                        href={`${ep.scheme}://${ep.ip}:${ep.port}/`}
                        target="_blank"
                        rel="noreferrer"
                        className="font-mono underline decoration-dotted underline-offset-2 hover:text-foreground"
                        title={`Opens ${ep.scheme}://${address}/ in a new tab`}
                      >
                        {address}
                      </a>
                    ) : (
                      <code className="font-mono">{address}</code>
                    )}
                    <span className="opacity-70">({ep.label})</span>
                  </React.Fragment>
                );
              })}
            </span>
          </React.Fragment>
        ))}
      </div>
      {wazuhManager && (
        <WazuhPasswordRow labId={labId} hostname={wazuhManager.config.hostname} />
      )}
    </div>
  );
}

// Fetches the Wazuh dashboard admin password live, on demand, straight off
// the manager VM — deliberately not a "search the log" pointer. The
// install step that generates this password only runs once, on the VM's
// very first boot, so anything that depended on log retention (a scrolled-
// past build.log, a resumed/rebuilt lab) could never reliably find it
// again. This re-reads the fixed file the role drops on disk instead,
// which exists for as long as the VM does.
function WazuhPasswordRow({ labId, hostname }: { labId: number; hostname: string }) {
  const [state, setState] = React.useState<
    { status: "idle" } | { status: "loading" } | { status: "ok"; password: string } | { status: "error"; message: string }
  >({ status: "idle" });

  const reveal = async () => {
    setState({ status: "loading" });
    try {
      const res = await api.getWazuhPassword(labId, hostname);
      if (res.ok && res.password) {
        setState({ status: "ok", password: res.password });
      } else {
        setState({ status: "error", message: res.error ?? "not available" });
      }
    } catch (err) {
      setState({ status: "error", message: err instanceof Error ? err.message : "request failed" });
    }
  };

  return (
    <p className="mt-1 flex flex-wrap items-center gap-1.5 text-[9px] text-muted-foreground">
      <span>
        The credentials above are the OS login — the Wazuh dashboard uses a
        separate, randomly-generated admin password:
      </span>
      {state.status === "idle" && (
        <button
          type="button"
          onClick={reveal}
          className="rounded border px-1.5 py-0.5 font-sans text-[9px] font-medium text-foreground hover:bg-muted"
        >
          Reveal password
        </button>
      )}
      {state.status === "loading" && <span>loading…</span>}
      {state.status === "ok" && (
        <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-foreground">
          admin / {state.password}
        </code>
      )}
      {state.status === "error" && (
        <>
          <span className="text-amber-600 dark:text-amber-400">{state.message}</span>
          <button
            type="button"
            onClick={reveal}
            className="rounded border px-1.5 py-0.5 font-sans text-[9px] font-medium text-foreground hover:bg-muted"
          >
            Retry
          </button>
        </>
      )}
    </p>
  );
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
  const phases = React.useMemo(() => phasesQ.data?.per_vm ?? {}, [phasesQ.data]);
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
          // Same endpoint list the AccessPanel shows below the canvas —
          // computed once here so the node itself is clickable too,
          // instead of a dead `<code>` tag with no link at all.
          endpoints: accessEndpoints(n),
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
        <BuildPhaseStepper perVm={phases} overall={overall} provider={topology?.provider} />
      </div>
      <div className="relative flex-1" style={{ touchAction: "none" }}>
        <ReactFlow
          nodes={flowNodes}
          edges={flowEdges}
          nodeTypes={nodeTypes}
          fitView
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          panOnDrag
          panOnScroll={false}
          zoomOnScroll
          zoomOnPinch
          zoomOnDoubleClick
          preventScrolling
          minZoom={0.2}
          maxZoom={2}
          proOptions={{ hideAttribution: true }}
        >
          <Background variant={BackgroundVariant.Dots} gap={20} size={1} />
          <Controls position="bottom-left" showInteractive={false} />
        </ReactFlow>
        <Legend />
        <ZoomToolbar />
      </div>
      {topology && <AccessPanel topology={topology} labId={labId} />}
    </div>
  );
}

// Click-only zoom, deliberately independent of wheel/trackpad gesture
// handling (scroll-to-zoom can be unreliable depending on the OS/browser/
// input-device combination — this always works because it never depends on
// a gesture being recognized, only a click). `useStore` re-renders this on
// every zoom change so the percentage stays live whether the zoom came from
// these buttons, the scroll wheel, or a pinch gesture.
function ZoomToolbar() {
  const { zoomIn, zoomOut, fitView } = useReactFlow();
  const zoom = useStore((s) => s.transform[2]);
  return (
    <div className="absolute top-4 right-4 flex items-center gap-0.5 rounded-md border bg-card/90 p-1 text-xs shadow backdrop-blur">
      <button
        type="button"
        onClick={() => zoomOut({ duration: 150 })}
        className="flex h-6 w-6 items-center justify-center rounded hover:bg-muted"
        title="Zoom out"
      >
        −
      </button>
      <span className="w-10 text-center font-mono text-[10px] text-muted-foreground">
        {Math.round(zoom * 100)}%
      </span>
      <button
        type="button"
        onClick={() => zoomIn({ duration: 150 })}
        className="flex h-6 w-6 items-center justify-center rounded hover:bg-muted"
        title="Zoom in"
      >
        +
      </button>
      <span className="mx-0.5 h-4 w-px bg-border" />
      <button
        type="button"
        onClick={() => fitView({ duration: 200 })}
        className="flex h-6 items-center justify-center rounded px-1.5 text-[10px] hover:bg-muted"
        title="Fit the whole topology in view"
      >
        Fit
      </button>
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
