"use client";

import * as React from "react";
import {
  Background,
  BackgroundVariant,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Edge as RFEdge,
  type Node as RFNode,
} from "@xyflow/react";

import type { LabConfig, NodeType, TopologyEdge, TopologyNode, Zone } from "@labforge/schema";

import { nodeTypes } from "@/components/canvas/nodes";
import { edgeTypes as buildEdgeTypes } from "@/components/canvas/edges";
import { LiveEdge } from "@/components/canvas/edges/LiveEdge";
import type { FlowNodeData, FlowZoneData } from "@/lib/store/topology-store";
import { edgeFlowRates, type FlowSample } from "@/lib/monitor/events";

interface VmState {
  hostname: string;
  state: string;
  ip?: string | null;
}

interface LiveCanvasProps {
  topology: LabConfig;
  vms: VmState[];
  /** Hostnames currently considered "alerting" — edges touching these get
   *  the red threat treatment. */
  threatHosts?: ReadonlySet<string>;
  /** Hostname currently focused (clicked). Edges touching this host
   *  brighten; the others dim. */
  selectedHostname?: string | null;
  /** Called when the user clicks a node (hostname) or the background (null). */
  onSelectHost?: (hostname: string | null) => void;
  /** Per-(src,dst) flow samples from the latest heartbeat. */
  flows?: FlowSample[];
}

function edgeSeverity(
  e: TopologyEdge,
  topology: LabConfig,
  vms: VmState[],
  threatHosts: ReadonlySet<string>,
): "ok" | "warn" | "alert" {
  const src = topology.nodes.find((n) => n.id === e.source);
  const dst = topology.nodes.find((n) => n.id === e.target);
  if (!src || !dst) return "warn";
  if (threatHosts.has(src.config.hostname) || threatHosts.has(dst.config.hostname)) {
    return "alert";
  }
  const srcVm = vms.find((v) => v.hostname === src.config.hostname);
  const dstVm = vms.find((v) => v.hostname === dst.config.hostname);
  const srcOk = src.type === "internet" || srcVm?.state === "running";
  const dstOk = dst.type === "internet" || dstVm?.state === "running";
  if (srcOk && dstOk) return "ok";
  return "warn";
}

type FlowNode = RFNode<FlowNodeData, NodeType>;
type FlowZone = RFNode<FlowZoneData, "zone">;
type AnyNode = FlowNode | FlowZone;

function toFlowNode(n: TopologyNode, selected: boolean): FlowNode {
  return {
    id: n.id,
    type: n.type,
    position: n.position,
    data: { topologyNode: n },
    draggable: false,
    selectable: true,
    selected,
  };
}

function toFlowZone(z: Zone): FlowZone {
  return {
    id: z.id,
    type: "zone",
    position: z.position,
    width: z.size.width,
    height: z.size.height,
    style: { width: z.size.width, height: z.size.height },
    zIndex: -1,
    data: { zone: z },
    draggable: false,
    selectable: false,
  };
}

const monitorEdgeTypes = { ...buildEdgeTypes, protocol: LiveEdge };

function Inner({
  topology,
  vms,
  threatHosts,
  selectedHostname,
  onSelectHost,
  flows,
}: LiveCanvasProps & { threatHosts: ReadonlySet<string> }) {
  const { fitView } = useReactFlow();

  const flowRates = React.useMemo(() => {
    const pairs = topology.edges.map((e) => {
      const src = topology.nodes.find((n) => n.id === e.source);
      const dst = topology.nodes.find((n) => n.id === e.target);
      return {
        edgeId: e.id,
        sourceIp: src?.config.ip ?? "",
        targetIp: dst?.config.ip ?? "",
      };
    });
    return edgeFlowRates(flows, pairs);
  }, [flows, topology.edges, topology.nodes]);

  const nodes: AnyNode[] = React.useMemo(
    () => [
      ...(topology.zones ?? []).map(toFlowZone),
      ...topology.nodes.map((n) =>
        toFlowNode(n, n.config.hostname === selectedHostname),
      ),
    ],
    [topology.nodes, topology.zones, selectedHostname],
  );

  const selectedNodeIds = React.useMemo(() => {
    if (!selectedHostname) return null;
    const ids = new Set<string>();
    for (const n of topology.nodes) {
      if (n.config.hostname === selectedHostname) ids.add(n.id);
    }
    return ids;
  }, [topology.nodes, selectedHostname]);

  const edges: RFEdge[] = React.useMemo(
    () =>
      topology.edges.map((e) => {
        const sev = edgeSeverity(e, topology, vms, threatHosts);
        const touchesSelection =
          !selectedNodeIds ||
          selectedNodeIds.has(e.source) ||
          selectedNodeIds.has(e.target);
        return {
          id: e.id,
          source: e.source,
          target: e.target,
          type: "protocol",
          data: {
            topologyEdge: e,
            severity: sev,
            packets: flowRates.get(e.id) ?? 0,
          },
          style: {
            opacity: touchesSelection ? 1 : 0.18,
            transition: "opacity 200ms",
          },
        };
      }),
    [topology, vms, threatHosts, selectedNodeIds, flowRates],
  );

  React.useEffect(() => {
    const t1 = window.setTimeout(
      () => fitView({ padding: 0.18, duration: 0, minZoom: 0.2, maxZoom: 1.5 }),
      80,
    );
    const t2 = window.setTimeout(
      () => fitView({ padding: 0.18, duration: 450, minZoom: 0.2, maxZoom: 1.5 }),
      280,
    );
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [topology.id, fitView]);

  const handleNodeClick = (_: React.MouseEvent, node: RFNode): void => {
    if (node.type === "zone") return;
    const tnode = topology.nodes.find((n) => n.id === node.id);
    if (!tnode) return;
    const next = tnode.config.hostname === selectedHostname ? null : tnode.config.hostname;
    onSelectHost?.(next);
  };

  return (
    <div className="relative h-full w-full text-foreground/85">
      <svg className="pointer-events-none absolute h-0 w-0" aria-hidden>
        <defs>
          <marker
            id="labforge-arrow"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" />
          </marker>
          <filter id="labforge-glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="1.2" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
      </svg>

      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={monitorEdgeTypes}
        fitView
        fitViewOptions={{ padding: 0.18, duration: 0, minZoom: 0.2, maxZoom: 1.5 }}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable
        panOnDrag
        zoomOnScroll
        onNodeClick={handleNodeClick}
        onPaneClick={() => onSelectHost?.(null)}
        proOptions={{ hideAttribution: true }}
        defaultEdgeOptions={{ type: "protocol" }}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} />
      </ReactFlow>
    </div>
  );
}

export function LiveCanvas(props: LiveCanvasProps) {
  return (
    <ReactFlowProvider>
      <Inner {...props} threatHosts={props.threatHosts ?? new Set()} />
    </ReactFlowProvider>
  );
}
