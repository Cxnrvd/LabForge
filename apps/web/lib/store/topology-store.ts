"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { useShallow } from "zustand/react/shallow";
import {
  type Edge as RFEdge,
  type Node as RFNode,
  applyEdgeChanges,
  applyNodeChanges,
  type EdgeChange,
  type NodeChange,
  type Connection,
} from "@xyflow/react";

import {
  DEFAULT_OS_PER_NODE_TYPE,
  NODE_TYPE_LABELS,
  type LabConfig,
  type NodeType,
  type TopologyEdge,
  type TopologyNode,
  type Protocol,
  type ValidationIssue,
  type Zone,
  type ZoneShape,
} from "@labforge/schema";

const HISTORY_LIMIT = 100;

export interface FlowNodeData extends Record<string, unknown> {
  topologyNode: TopologyNode;
}

export type FlowNode = RFNode<FlowNodeData, NodeType>;

export interface FlowZoneData extends Record<string, unknown> {
  zone: Zone;
}

export type FlowZone = RFNode<FlowZoneData, "zone">;

export interface FlowEdgeData extends Record<string, unknown> {
  topologyEdge: TopologyEdge;
}
export type FlowEdge = RFEdge<FlowEdgeData>;

export type AnyFlowNode = FlowNode | FlowZone;

interface HistoryEntry {
  nodes: AnyFlowNode[];
  edges: FlowEdge[];
  meta: LabMeta;
}

export interface LabMeta {
  id: string;
  name: string;
  description: string;
  network_cidr: string;
  provider: "virtualbox" | "vmware" | "libvirt";
}

interface TopologyState {
  nodes: AnyFlowNode[];
  edges: FlowEdge[];
  meta: LabMeta;
  selectedNodeId: string | null;
  validationIssues: ValidationIssue[];
  past: HistoryEntry[];
  future: HistoryEntry[];
  /** Increments every time `loadTopology` runs — the canvas observes this
   *  counter and re-fits the viewport when it changes. */
  fitToken: number;

  applyNodeChanges: (changes: NodeChange<AnyFlowNode>[]) => void;
  applyEdgeChanges: (changes: EdgeChange<FlowEdge>[]) => void;
  addNode: (type: NodeType, position: { x: number; y: number }) => void;
  removeNode: (id: string) => void;
  updateNodeConfig: (id: string, updater: (node: TopologyNode) => TopologyNode) => void;
  setNodePositions: (updates: { id: string; position: { x: number; y: number } }[]) => void;
  connect: (params: Connection, protocol: Protocol, port: number | null) => void;
  removeEdge: (id: string) => void;
  setSelectedNode: (id: string | null) => void;
  setValidationIssues: (issues: ValidationIssue[]) => void;
  setMeta: (meta: Partial<LabMeta>) => void;
  loadTopology: (topology: LabConfig) => void;
  reset: () => void;
  toTopology: () => LabConfig;

  // Zones
  addZone: (shape: ZoneShape, position: { x: number; y: number }) => void;
  updateZone: (id: string, updater: (zone: Zone) => Zone) => void;
  removeZone: (id: string) => void;

  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
}

function uid(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}-${Date.now().toString(36)}`;
}

function defaultMeta(): LabMeta {
  return {
    id: uid("lab"),
    name: "Untitled Lab",
    description: "",
    network_cidr: "192.168.56.0/24",
    provider: "virtualbox",
  };
}

function nextIp(network: string, used: Set<string>): string {
  const match = /^(\d+)\.(\d+)\.(\d+)\.\d+\/\d+$/.exec(network);
  const base = match ? `${match[1]}.${match[2]}.${match[3]}` : "192.168.56";
  for (let i = 10; i < 250; i += 1) {
    const candidate = `${base}.${i}`;
    if (!used.has(candidate)) return candidate;
  }
  return `${base}.10`;
}

const DEFAULT_ROLES_PER_TYPE: Partial<Record<NodeType, string[]>> = {
  domain_controller: ["AD-Domain-Services", "DNS"],
  attacker: ["nmap"],
  database: ["mysql"],
  ics_plc: ["openplc", "modbus-tcp"],
  ics_hmi: ["rapidscada", "modbus-master"],
  camera: ["mediamtx", "rtsp-server"],
  internet: ["external"],
};

const DEFAULT_CREDS_PER_TYPE: Partial<Record<NodeType, { username: string; password: string }>> = {
  attacker: { username: "kali", password: "kali" },
  domain_controller: { username: "Administrator", password: "Passw0rd!Lab" },
  ics_plc: { username: "operator", password: "Plc!Lab2025" },
  ics_hmi: { username: "operator", password: "Hmi!Lab2025" },
  camera: { username: "admin", password: "admin" },
};

const ZONE_PALETTE: Record<ZoneShape, string> = {
  rectangle: "#22d3ee",
  ellipse: "#a855f7",
  triangle: "#f59e0b",
  cloud: "#38bdf8",
};

function defaultNodeFor(
  type: NodeType,
  position: { x: number; y: number },
  network: string,
  usedIps: Set<string>,
  usedHostnames: Set<string>,
): TopologyNode {
  const ip = nextIp(network, usedIps);
  let hostname = `${type.replace(/_/g, "-")}`.toUpperCase();
  let suffix = 1;
  while (usedHostnames.has(hostname.toLowerCase())) {
    suffix += 1;
    hostname = `${type.replace(/_/g, "-").toUpperCase()}${suffix}`;
  }
  return {
    id: uid("n"),
    type,
    label: NODE_TYPE_LABELS[type],
    position,
    config: {
      os: DEFAULT_OS_PER_NODE_TYPE[type],
      ip,
      hostname,
      cves: [],
      roles: DEFAULT_ROLES_PER_TYPE[type] ?? [],
      memory_mb: type === "domain_controller" ? 4096 : type === "ics_plc" ? 1024 : 2048,
      cpus: 2,
      credentials: DEFAULT_CREDS_PER_TYPE[type] ?? { username: "vagrant", password: "vagrant" },
      vlan: null,
      gateway: null,
    },
    attack_tags: [],
  };
}

function toFlowNode(node: TopologyNode): FlowNode {
  return {
    id: node.id,
    type: node.type,
    position: node.position,
    data: { topologyNode: node },
  };
}

function toFlowZone(zone: Zone): FlowZone {
  return {
    id: zone.id,
    type: "zone",
    position: zone.position,
    width: zone.size.width,
    height: zone.size.height,
    style: { width: zone.size.width, height: zone.size.height },
    // Use React Flow's own zIndex prop instead of style.zIndex. Some
    // versions of fitView's getNodesBounds excludes nodes with a negative
    // CSS z-index, which shifts the computed bounding box off-center.
    zIndex: -1,
    data: { zone },
    draggable: true,
    selectable: true,
  };
}

function toFlowEdge(edge: TopologyEdge): FlowEdge {
  return {
    id: edge.id,
    source: edge.source,
    target: edge.target,
    type: "protocol",
    label: edge.label ?? edge.protocol.toUpperCase(),
    data: { topologyEdge: edge },
  };
}

function isZone(n: AnyFlowNode): n is FlowZone {
  return n.type === "zone";
}

function snapshot(state: TopologyState): HistoryEntry {
  return {
    nodes: state.nodes.map((n): AnyFlowNode =>
      isZone(n)
        ? { ...n, data: { ...n.data } }
        : { ...n, data: { ...n.data } },
    ),
    edges: state.edges.map((e) => ({ ...e, data: e.data ? { ...e.data } : undefined })),
    meta: { ...state.meta },
  };
}

function pushHistory(state: TopologyState): Pick<TopologyState, "past" | "future"> {
  const next = [...state.past, snapshot(state)];
  return {
    past: next.length > HISTORY_LIMIT ? next.slice(next.length - HISTORY_LIMIT) : next,
    future: [],
  };
}

/**
 * Persisted slice of the store. We only save the user's lab content
 * (nodes, edges, meta) — not transient state like undo history or fit
 * tokens — so reopening the canvas after a crash restores their work
 * without dragging restored selection state along.
 */
type PersistedSlice = {
  nodes: AnyFlowNode[];
  edges: FlowEdge[];
  meta: LabMeta;
};

export const useTopologyStore = create<TopologyState>()(
  persist(
    (set, get) => ({
  nodes: [],
  edges: [],
  meta: defaultMeta(),
  selectedNodeId: null,
  validationIssues: [],
  past: [],
  future: [],
  fitToken: 0,

  applyNodeChanges: (changes) => {
    const positionDone = changes.some(
      (c) => c.type === "position" && c.dragging === false,
    );
    const removed = changes.some((c) => c.type === "remove");
    const dimChanges = changes.filter((c) => c.type === "dimensions");
    const shouldSnapshot = positionDone || removed;

    // Snapshot the OLD state BEFORE applying changes; otherwise undo
    // restores the same state we just produced, i.e. no-op.
    set((state) => {
      const newNodes = applyNodeChanges(changes, state.nodes);
      const update: Partial<TopologyState> = { nodes: newNodes };
      if (shouldSnapshot) {
        Object.assign(update, pushHistory(state));
      }
      return update;
    });

    // Sync zone size from React Flow dimension changes (resize is fluid,
    // we deliberately don't push history for each pixel — only commit on
    // the final position-done event above).
    if (dimChanges.length) {
      set((state) => {
        const updated = state.nodes.map((n) => {
          if (!isZone(n)) return n;
          const change = dimChanges.find((c) => "id" in c && c.id === n.id);
          if (!change) return n;
          const w = (n.measured?.width ?? n.width) || n.data.zone.size.width;
          const h = (n.measured?.height ?? n.height) || n.data.zone.size.height;
          const nextZone: Zone = {
            ...n.data.zone,
            size: { width: w, height: h },
          };
          return { ...n, data: { ...n.data, zone: nextZone } };
        });
        return { nodes: updated };
      });
    }
  },
  applyEdgeChanges: (changes) => {
    const removed = changes.some((c) => c.type === "remove");
    set((state) => {
      const newEdges = applyEdgeChanges(changes, state.edges);
      const update: Partial<TopologyState> = { edges: newEdges };
      if (removed) {
        Object.assign(update, pushHistory(state));
      }
      return update;
    });
  },
  addNode: (type, position) => {
    set((state) => {
      const usedIps = new Set(
        state.nodes
          .filter((n): n is FlowNode => !isZone(n))
          .map((n) => n.data.topologyNode.config.ip),
      );
      const usedHostnames = new Set(
        state.nodes
          .filter((n): n is FlowNode => !isZone(n))
          .map((n) => n.data.topologyNode.config.hostname.toLowerCase()),
      );
      const topNode = defaultNodeFor(type, position, state.meta.network_cidr, usedIps, usedHostnames);
      return {
        ...pushHistory(state),
        nodes: [...state.nodes, toFlowNode(topNode)],
      };
    });
  },
  removeNode: (id) => {
    set((state) => ({
      ...pushHistory(state),
      nodes: state.nodes.filter((n) => n.id !== id),
      edges: state.edges.filter((e) => e.source !== id && e.target !== id),
      selectedNodeId: state.selectedNodeId === id ? null : state.selectedNodeId,
    }));
  },
  updateNodeConfig: (id, updater) => {
    set((state) => ({
      ...pushHistory(state),
      nodes: state.nodes.map((n) => {
        if (isZone(n) || n.id !== id) return n;
        const newTop = updater(n.data.topologyNode);
        return { ...n, type: newTop.type, data: { ...n.data, topologyNode: newTop } };
      }),
    }));
  },
  setNodePositions: (updates) => {
    if (updates.length === 0) return;
    const byId = new Map(updates.map((u) => [u.id, u.position]));
    set((state) => ({
      ...pushHistory(state),
      fitToken: state.fitToken + 1,
      nodes: state.nodes.map((n) => {
        const next = byId.get(n.id);
        if (!next) return n;
        if (isZone(n)) {
          return { ...n, position: next };
        }
        const top = n.data.topologyNode;
        return {
          ...n,
          position: next,
          data: { ...n.data, topologyNode: { ...top, position: next } },
        };
      }),
    }));
  },
  connect: (params, protocol, port) => {
    if (!params.source || !params.target) return;
    const newEdge: TopologyEdge = {
      id: uid("e"),
      source: params.source,
      target: params.target,
      protocol,
      port,
      label: protocol.toUpperCase(),
      attack_tags: [],
    };
    set((state) => ({
      ...pushHistory(state),
      edges: [...state.edges, toFlowEdge(newEdge)],
    }));
  },
  removeEdge: (id) => {
    set((state) => ({
      ...pushHistory(state),
      edges: state.edges.filter((e) => e.id !== id),
    }));
  },
  setSelectedNode: (id) => set({ selectedNodeId: id }),
  setValidationIssues: (issues) => set({ validationIssues: issues }),
  setMeta: (meta) => {
    // Meta updates (lab name input, etc.) fire on every keystroke; pushing
    // history each time floods undo. Skip history here.
    set((state) => ({
      meta: { ...state.meta, ...meta },
    }));
  },
  loadTopology: (topology) => {
    const flowNodes: AnyFlowNode[] = [
      ...(topology.zones ?? []).map(toFlowZone),
      ...topology.nodes.map(toFlowNode),
    ];
    set((state) => ({
      nodes: flowNodes,
      edges: topology.edges.map(toFlowEdge),
      meta: {
        id: topology.id,
        name: topology.name,
        description: topology.description,
        network_cidr: topology.network_cidr,
        provider: topology.provider,
      },
      selectedNodeId: null,
      validationIssues: [],
      past: [],
      future: [],
      fitToken: state.fitToken + 1,
    }));
  },
  reset: () => {
    set({
      nodes: [],
      edges: [],
      meta: defaultMeta(),
      selectedNodeId: null,
      validationIssues: [],
      past: [],
      future: [],
    });
  },
  toTopology: () => {
    const { nodes, edges, meta } = get();
    const topologyNodes: TopologyNode[] = [];
    const zones: Zone[] = [];
    for (const n of nodes) {
      if (isZone(n)) {
        zones.push({
          ...n.data.zone,
          position: { x: n.position.x, y: n.position.y },
          size: n.data.zone.size,
        });
      } else {
        topologyNodes.push({
          ...n.data.topologyNode,
          position: { x: n.position.x, y: n.position.y },
        });
      }
    }
    return {
      id: meta.id,
      name: meta.name,
      description: meta.description,
      network_cidr: meta.network_cidr,
      provider: meta.provider,
      version: "1.0" as const,
      nodes: topologyNodes,
      edges: edges.map((e) => e.data!.topologyEdge),
      zones,
    };
  },

  addZone: (shape, position) => {
    const zone: Zone = {
      id: uid("z"),
      label: shape === "triangle" ? "Triangle" : shape === "ellipse" ? "Cluster" : "Zone",
      shape,
      position,
      size: { width: 320, height: 220 },
      color: ZONE_PALETTE[shape],
      opacity: 0.15,
    };
    set((state) => ({
      ...pushHistory(state),
      nodes: [toFlowZone(zone), ...state.nodes],
    }));
  },
  updateZone: (id, updater) => {
    set((state) => ({
      ...pushHistory(state),
      nodes: state.nodes.map((n) => {
        if (!isZone(n) || n.id !== id) return n;
        const next = updater(n.data.zone);
        return {
          ...n,
          style: { width: next.size.width, height: next.size.height },
          width: next.size.width,
          height: next.size.height,
          zIndex: -1,
          data: { ...n.data, zone: next },
        };
      }),
    }));
  },
  removeZone: (id) => {
    set((state) => ({
      ...pushHistory(state),
      nodes: state.nodes.filter((n) => n.id !== id),
    }));
  },

  undo: () => {
    set((state) => {
      if (state.past.length === 0) return state;
      const previous = state.past[state.past.length - 1];
      if (!previous) return state;
      // If the currently-selected node no longer exists in the restored
      // state, drop the selection so the right-side panel doesn't show
      // stale content.
      const selectedStillExists = previous.nodes.some(
        (n) => n.id === state.selectedNodeId,
      );
      return {
        nodes: previous.nodes,
        edges: previous.edges,
        meta: previous.meta,
        past: state.past.slice(0, -1),
        future: [...state.future, snapshot(state)],
        selectedNodeId: selectedStillExists ? state.selectedNodeId : null,
      };
    });
  },
  redo: () => {
    set((state) => {
      if (state.future.length === 0) return state;
      const next = state.future[state.future.length - 1];
      if (!next) return state;
      const selectedStillExists = next.nodes.some(
        (n) => n.id === state.selectedNodeId,
      );
      return {
        nodes: next.nodes,
        edges: next.edges,
        meta: next.meta,
        future: state.future.slice(0, -1),
        past: [...state.past, snapshot(state)],
        selectedNodeId: selectedStillExists ? state.selectedNodeId : null,
      };
    });
  },
  canUndo: () => get().past.length > 0,
  canRedo: () => get().future.length > 0,
    }),
    {
      name: "labforge.canvas.v1",
      version: 1,
      // IndexedDB would be nicer for large topologies; localStorage is
      // synchronous and matches what users expect for ~tens of KB of
      // canvas state. Swap to ``createJSONStorage(() => indexedDB...)``
      // once we add an adapter.
      storage: createJSONStorage(() =>
        typeof window === "undefined"
          ? {
              getItem: () => null,
              setItem: () => {},
              removeItem: () => {},
            }
          : window.localStorage,
      ),
      // Persist only the user-meaningful slice; reset transient pieces.
      partialize: (state): PersistedSlice => ({
        nodes: state.nodes,
        edges: state.edges,
        meta: state.meta,
      }),
      merge: (persisted, current) => {
        if (!persisted || typeof persisted !== "object") return current;
        const p = persisted as Partial<PersistedSlice>;
        return {
          ...current,
          nodes: p.nodes ?? current.nodes,
          edges: p.edges ?? current.edges,
          meta: p.meta ?? current.meta,
        };
      },
    },
  ),
);

export const useTopologySelectors = {
  nodes: () => useTopologyStore(useShallow((s) => s.nodes)),
  edges: () => useTopologyStore(useShallow((s) => s.edges)),
  meta: () => useTopologyStore(useShallow((s) => s.meta)),
};

export function findIssuesForNode(
  issues: ValidationIssue[],
  nodeId: string,
): ValidationIssue[] {
  return issues.filter((i) => i.node_id === nodeId);
}

export { isZone };
