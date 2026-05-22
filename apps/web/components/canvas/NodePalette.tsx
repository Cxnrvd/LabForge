"use client";

import * as React from "react";
import { useReactFlow } from "@xyflow/react";
import {
  Camera,
  ChevronLeft,
  ChevronRight,
  Cloud,
  Cog,
  Crosshair,
  Database,
  Flame,
  Monitor,
  MonitorSpeaker,
  Network,
  Server,
  Shield,
  Terminal,
} from "lucide-react";

import { cn } from "@/lib/utils/cn";
import { useTopologyStore } from "@/lib/store/topology-store";
import type { NodeType } from "@labforge/schema";

interface PaletteEntry {
  type: NodeType;
  label: string;
  Icon: React.ComponentType<{ className?: string }>;
  hint: string;
}

const ENTRIES: PaletteEntry[] = [
  { type: "workstation", label: "Workstation", Icon: Monitor, hint: "Windows / Linux user host" },
  { type: "server", label: "Server", Icon: Server, hint: "Generic Linux server" },
  { type: "domain_controller", label: "Domain Controller", Icon: Shield, hint: "Windows AD DS" },
  { type: "router", label: "Router", Icon: Network, hint: "OpenWrt / VyOS" },
  { type: "firewall", label: "Firewall", Icon: Flame, hint: "pfSense / OPNsense" },
  { type: "attacker", label: "Attacker", Icon: Terminal, hint: "Kali / Parrot" },
  { type: "target", label: "Target", Icon: Crosshair, hint: "Objective host" },
  { type: "database", label: "Database", Icon: Database, hint: "MySQL / Postgres" },
  { type: "ics_plc", label: "PLC", Icon: Cog, hint: "OpenPLC / SIMATIC" },
  { type: "ics_hmi", label: "HMI / SCADA", Icon: MonitorSpeaker, hint: "Rapid SCADA" },
  { type: "camera", label: "IP Camera", Icon: Camera, hint: "MediaMTX / Motion" },
  { type: "internet", label: "Internet", Icon: Cloud, hint: "External network" },
];

const DATA_TRANSFER_KEY = "application/x-labforge-node-type";

interface NodePaletteProps {
  className?: string;
  collapsed?: boolean;
}

/**
 * Left rail of draggable node types. Native HTML5 drag-and-drop into the
 * React Flow canvas: the rail sets ``application/x-labforge-node-type``
 * on dragstart, the canvas wrapper handles ``ondrop`` and forwards to
 * the store's ``addNode`` action.
 *
 * Falls back to keyboard: Enter/Space on a focused tile adds the node
 * to the centre of the canvas, mirroring the existing toolbar Add menu.
 */
export function NodePalette({ className, collapsed: initialCollapsed = false }: NodePaletteProps) {
  const { screenToFlowPosition } = useReactFlow();
  const addNode = useTopologyStore((s) => s.addNode);
  // Persist the collapsed state per browser so a user who hides the
  // palette stays unblocked across reloads. ``initialCollapsed`` (the
  // prop) is the seed value only on the very first render.
  const [collapsed, setCollapsed] = React.useState<boolean>(initialCollapsed);
  const listRef = React.useRef<HTMLDivElement | null>(null);
  React.useEffect(() => {
    try {
      const stored = window.localStorage.getItem("labforge.palette-collapsed");
      if (stored === "1") setCollapsed(true);
    } catch {
      /* SSR / private mode — ignore */
    }
  }, []);

  // External "focus the palette" trigger (tb3 toolbar's "+ Node" button
  // on /build dispatches this event). Expands the rail if collapsed,
  // then focuses the first node tile so keyboard users can immediately
  // Enter/Space to drop a node.
  React.useEffect(() => {
    const onFocus = (): void => {
      setCollapsed(false);
      try {
        window.localStorage.setItem("labforge.palette-collapsed", "0");
      } catch {
        /* ignore */
      }
      // Wait a tick so the rail re-renders expanded before focusing.
      window.setTimeout(() => {
        const first = listRef.current?.querySelector<HTMLButtonElement>(
          "button[draggable='true']",
        );
        first?.focus();
      }, 0);
    };
    window.addEventListener("labforge:focus-palette", onFocus);
    return () => window.removeEventListener("labforge:focus-palette", onFocus);
  }, []);

  const toggle = (): void => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem("labforge.palette-collapsed", next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  const dropToCentre = (type: NodeType): void => {
    const position = screenToFlowPosition({
      x: window.innerWidth / 2,
      y: window.innerHeight / 2,
    });
    addNode(type, position);
  };

  return (
    <aside
      className={cn(
        // Sits ABOVE the React Flow canvas (default z) but BELOW the
        // floating Toolbar (z-40) and any drawer/modal. See LabCanvas
        // for the full z-index ladder. The rail is anchored top + bottom
        // by the parent (className adds bottom-4), and scrolls internally
        // when the node list overflows.
        "z-20 flex flex-col gap-1 overflow-y-auto rounded-lg border bg-background/95 p-1.5 shadow-md backdrop-blur",
        collapsed ? "w-12" : "w-56",
        className,
      )}
      aria-label="Node palette"
    >
      <button
        type="button"
        onClick={toggle}
        className="flex items-center justify-between rounded-md px-2 py-1 text-[10px] uppercase tracking-wide text-muted-foreground hover:bg-accent hover:text-foreground"
        aria-expanded={!collapsed}
        aria-controls="node-palette-list"
        title={collapsed ? "Expand palette" : "Collapse palette"}
      >
        {!collapsed && <span>Add node</span>}
        {collapsed ? (
          <ChevronRight className="h-3.5 w-3.5" />
        ) : (
          <ChevronLeft className="h-3.5 w-3.5" />
        )}
      </button>
      <div id="node-palette-list" ref={listRef} className="flex flex-col gap-1">
        {ENTRIES.map(({ type, label, Icon, hint }) => (
          <button
            key={type}
            type="button"
            draggable
            onDragStart={(e) => {
              e.dataTransfer.effectAllowed = "copy";
              e.dataTransfer.setData(DATA_TRANSFER_KEY, type);
              e.dataTransfer.setData("text/plain", type);
            }}
            onClick={() => dropToCentre(type)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                dropToCentre(type);
              }
            }}
            title={collapsed ? `${label} — ${hint}` : hint}
            aria-label={`Add ${label}`}
            className={cn(
              "group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:bg-accent focus-visible:text-foreground focus-visible:outline-none",
              collapsed && "justify-center px-1.5",
            )}
          >
            <Icon className="h-4 w-4 shrink-0" />
            {!collapsed && (
              <span className="flex min-w-0 flex-col items-start text-left">
                <span className="truncate text-xs font-medium text-foreground">{label}</span>
                <span className="truncate text-[10px] text-muted-foreground/80">{hint}</span>
              </span>
            )}
          </button>
        ))}
      </div>
    </aside>
  );
}

NodePalette.dataTransferKey = DATA_TRANSFER_KEY;

/** Read a NodeType off a DragEvent's dataTransfer, returning null on miss. */
export function readPaletteDrop(event: DragEvent | React.DragEvent): NodeType | null {
  const raw = event.dataTransfer?.getData(DATA_TRANSFER_KEY) ?? "";
  if (!raw) return null;
  return raw as NodeType;
}
