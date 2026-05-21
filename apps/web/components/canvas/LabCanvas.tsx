"use client";

import * as React from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Connection,
  type Node as RFNode,
  type OnConnect,
} from "@xyflow/react";

import { BuildPreflightBanner } from "./BuildPreflightBanner";
import { Toolbar } from "./Toolbar";
import { ValidationPanel } from "./ValidationPanel";
import { edgeTypes } from "./edges";
import { nodeTypes } from "./nodes";
import { AttackPathOverlay, useAttackHighlight } from "./AttackPathOverlay";
import { LabBudgetBar } from "./LabBudgetBar";
import { NodePalette, readPaletteDrop } from "./NodePalette";
import { OnboardingTour } from "./OnboardingTour";
import { NodeConfigPanel } from "@/components/panels/NodeConfigPanel";
import {
  type AnyFlowNode,
  type FlowEdge,
  useTopologyStore,
} from "@/lib/store/topology-store";
import {
  SAMPLE_TOPOLOGY,
  hasSeenBuild,
  markBuildSeen,
} from "@/lib/canvas/sample-topology";
import { NODE_STYLES } from "@/lib/utils/node-style";
import type { NodeType, Protocol } from "@labforge/schema";
import { ConnectionPopover } from "@/components/panels/ConnectionPopover";

function InnerCanvas() {
  const nodes = useTopologyStore((s) => s.nodes);
  const edges = useTopologyStore((s) => s.edges);
  const fitToken = useTopologyStore((s) => s.fitToken);
  const applyNodeChanges = useTopologyStore((s) => s.applyNodeChanges);
  const applyEdgeChanges = useTopologyStore((s) => s.applyEdgeChanges);
  const connect = useTopologyStore((s) => s.connect);
  const setSelectedNode = useTopologyStore((s) => s.setSelectedNode);
  const loadTopology = useTopologyStore((s) => s.loadTopology);
  const addNode = useTopologyStore((s) => s.addNode);

  const { fitView, screenToFlowPosition } = useReactFlow();
  const lastFitToken = React.useRef(0);
  const highlight = useAttackHighlight();

  // When the attack-path overlay is active, dim every edge that isn't on a
  // ranked path. Computed in a memo so we don't allocate new edge style
  // objects on every render.
  const displayedEdges = React.useMemo(() => {
    if (!highlight.active) return edges;
    return edges.map((e) => ({
      ...e,
      style: {
        ...(e.style ?? {}),
        opacity: highlight.edges.has(e.id) ? 1 : 0.12,
        transition: "opacity 200ms",
      },
    }));
  }, [edges, highlight]);

  // Drag-and-drop from the NodePalette into the canvas. We only claim the
  // drag when the incoming dataTransfer carries our private MIME so a
  // user dropping a stray file from their OS isn't accidentally consumed.
  const handleDragOver = React.useCallback((e: React.DragEvent) => {
    if (e.dataTransfer.types.includes(NodePalette.dataTransferKey)) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    }
  }, []);
  const handleDrop = React.useCallback(
    (e: React.DragEvent) => {
      const type = readPaletteDrop(e);
      if (!type) return;
      e.preventDefault();
      const position = screenToFlowPosition({ x: e.clientX, y: e.clientY });
      addNode(type, position);
    },
    [addNode, screenToFlowPosition],
  );

  // First-visit experience: pre-load a small sample so the canvas isn't a
  // blank screen with no idea what to do. Skipped on subsequent visits and
  // when the canvas already has content (e.g. /build/[slug] streamed in
  // a saved topology).
  React.useEffect(() => {
    if (hasSeenBuild()) return;
    if (useTopologyStore.getState().nodes.length > 0) return;
    loadTopology(SAMPLE_TOPOLOGY);
    markBuildSeen();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [pendingConnection, setPendingConnection] = React.useState<Connection | null>(null);

  // Re-fit the viewport whenever a new topology is loaded into the store.
  // The 80ms+280ms two-pass mirrors what TemplateGallery did, so it works
  // when the canvas is already mounted (e.g. /build/[slug]).
  React.useEffect(() => {
    if (fitToken === lastFitToken.current) return;
    lastFitToken.current = fitToken;
    if (fitToken === 0) return; // initial mount handled by `fitView` prop
    if (nodes.length === 0) return;
    const t1 = window.setTimeout(
      () => fitView({ padding: 0.25, duration: 0, minZoom: 0.2, maxZoom: 1.5 }),
      80,
    );
    const t2 = window.setTimeout(
      () => fitView({ padding: 0.25, duration: 450, minZoom: 0.2, maxZoom: 1.5 }),
      280,
    );
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [fitToken, fitView, nodes.length]);

  const handleConnect: OnConnect = (params) => {
    setPendingConnection(params);
  };

  const finalizeConnection = (protocol: Protocol, port: number | null): void => {
    if (!pendingConnection) return;
    connect(pendingConnection, protocol, port);
    setPendingConnection(null);
  };

  return (
    <div
      className="relative h-full w-full text-foreground/85"
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {/* Shared arrow marker referenced by every edge's marker-end.
          Inherits color from `currentColor` so it matches the edge stroke. */}
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
        </defs>
      </svg>
      <ReactFlow<AnyFlowNode, FlowEdge>
        nodes={nodes}
        edges={displayedEdges}
        onNodesChange={applyNodeChanges}
        onEdgesChange={applyEdgeChanges}
        onConnect={handleConnect}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        nodesDraggable
        fitView
        fitViewOptions={{ padding: 0.25, duration: 450, minZoom: 0.2, maxZoom: 1.5 }}
        snapToGrid
        snapGrid={[16, 16]}
        onPaneClick={() => setSelectedNode(null)}
        proOptions={{ hideAttribution: true }}
        defaultEdgeOptions={{ type: "protocol" }}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} />
        <Controls position="bottom-right" />
        <MiniMap
          position="bottom-left"
          pannable
          zoomable
          nodeColor={(node: RFNode) => {
            const t = (node.type ?? "workstation") as NodeType;
            return NODE_STYLES[t]?.miniMapColor ?? "#64748b";
          }}
          maskColor="hsl(var(--background) / 0.6)"
          className="!bg-card !border"
        />
      </ReactFlow>

      <Toolbar />
      <BuildPreflightBanner />
      <ValidationPanel />

      {/* Left-rail palette: drag a type onto the canvas, or click/Enter to
          drop it at the centre. */}
      <NodePalette className="absolute left-4 top-20 w-56" />

      {/* Live RAM/CPU/time budget; pinned bottom-left, hides when empty. */}
      <LabBudgetBar />

      {/* Attack-path heuristic panel; dispatches a highlight event the
          canvas above listens to via ``useAttackHighlight``. */}
      <AttackPathOverlay />

      <NodeConfigPanel />

      <ConnectionPopover
        open={!!pendingConnection}
        onCancel={() => setPendingConnection(null)}
        onConfirm={finalizeConnection}
      />

      {/* Coachmark overlay shown only on the first visit. */}
      <OnboardingTour />
    </div>
  );
}

export function LabCanvas() {
  return (
    <ReactFlowProvider>
      <InnerCanvas />
    </ReactFlowProvider>
  );
}
