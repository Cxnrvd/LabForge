"use client";

import * as React from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Connection,
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
import type { NodeType, Protocol } from "@labforge/schema";
import { ConnectionPopover } from "@/components/panels/ConnectionPopover";

interface InnerCanvasProps {
  hideToolbar?: boolean;
}

function InnerCanvas({ hideToolbar = false }: InnerCanvasProps) {
  const nodes = useTopologyStore((s) => s.nodes);
  const edges = useTopologyStore((s) => s.edges);
  const fitToken = useTopologyStore((s) => s.fitToken);
  const applyNodeChanges = useTopologyStore((s) => s.applyNodeChanges);
  const applyEdgeChanges = useTopologyStore((s) => s.applyEdgeChanges);
  const connect = useTopologyStore((s) => s.connect);
  const setSelectedNode = useTopologyStore((s) => s.setSelectedNode);
  const loadTopology = useTopologyStore((s) => s.loadTopology);
  const addNode = useTopologyStore((s) => s.addNode);

  const { fitView, screenToFlowPosition, zoomTo } = useReactFlow();
  const lastFitToken = React.useRef(0);
  const highlight = useAttackHighlight();
  // Local toggle for the dotted background grid. Listens for the
  // tb3 toolbar's "▦ Grid" button via a window event.
  const [showGrid, setShowGrid] = React.useState(true);

  // tb3 toolbar buttons on /build live OUTSIDE the ReactFlowProvider,
  // so they communicate with this inner canvas via window events
  // instead of direct refs.
  React.useEffect(() => {
    const onFit = (): void => {
      fitView({ ...FIT_OPTIONS, duration: 450 });
    };
    const onZoom100 = (): void => {
      zoomTo(1, { duration: 250 });
    };
    const onToggleGrid = (): void => {
      setShowGrid((v) => !v);
    };
    window.addEventListener("labforge:fit", onFit);
    window.addEventListener("labforge:zoom-100", onZoom100);
    window.addEventListener("labforge:toggle-grid", onToggleGrid);
    return () => {
      window.removeEventListener("labforge:fit", onFit);
      window.removeEventListener("labforge:zoom-100", onZoom100);
      window.removeEventListener("labforge:toggle-grid", onToggleGrid);
    };
  }, [fitView, zoomTo]);

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
      () => fitView({ ...FIT_OPTIONS, duration: 0 }),
      80,
    );
    const t2 = window.setTimeout(
      () => fitView({ ...FIT_OPTIONS, duration: 450 }),
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
        fitViewOptions={{ ...FIT_OPTIONS, duration: 450 }}
        snapToGrid
        snapGrid={[16, 16]}
        onPaneClick={() => setSelectedNode(null)}
        proOptions={{ hideAttribution: true }}
        defaultEdgeOptions={{ type: "protocol" }}
      >
        {showGrid && <Background variant={BackgroundVariant.Dots} gap={20} size={1} />}
        {/* CSS in labforge-d10.css overrides position to right-edge,
            vertically centred — sits below the Attack Paths panel. */}
        <Controls position="top-right" />
      </ReactFlow>

      {!hideToolbar && <Toolbar />}
      <BuildPreflightBanner />
      <ValidationPanel />

      {/*
        z-index ladder for floating canvas chrome:
          z-50  ConnectionPopover modal + OnboardingTour coach-marks
          z-40  Toolbar + NodeConfigPanel right drawer
          z-30  BuildPreflightBanner (red/amber blocker, must be visible)
          z-20  NodePalette (left), AttackPathOverlay (right), LabBudgetBar (bottom)
          z-10  React Flow Controls + MiniMap (their built-in z)
        Left-rail palette is collapsible via a chevron on its header so the
        user can claim back the left edge of the canvas when needed.
      */}
      <NodePalette className="absolute left-4 top-4 bottom-4 z-20" />

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

export interface LabCanvasProps {
  /**
   * When true, the floating in-canvas Toolbar (legacy actions row) is
   * suppressed. The D10 /build page has all those actions in the page-
   * level tb3 toolbar, so rendering them twice is redundant.
   */
  hideToolbar?: boolean;
}

// Keep the nodes clear of the floating palette (left), toolbar (top) and zoom controls (right).
const FIT_OPTIONS = {
  padding: { top: "96px", left: "260px", right: "90px", bottom: "70px" },
  minZoom: 0.2,
  maxZoom: 1.5,
} as const;

export function LabCanvas({ hideToolbar = false }: LabCanvasProps = {}) {
  return (
    <ReactFlowProvider>
      <InnerCanvas hideToolbar={hideToolbar} />
    </ReactFlowProvider>
  );
}
