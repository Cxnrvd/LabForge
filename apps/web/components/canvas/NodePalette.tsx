"use client";

import * as React from "react";
import { useReactFlow } from "@xyflow/react";
import {
  Camera,
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
export function NodePalette({ className, collapsed = false }: NodePaletteProps) {
  const { screenToFlowPosition } = useReactFlow();
  const addNode = useTopologyStore((s) => s.addNode);

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
        "z-10 flex flex-col gap-1 rounded-lg border bg-background/95 p-1.5 shadow-md backdrop-blur",
        className,
      )}
      aria-label="Node palette"
    >
      {ENTRIES.map(({ type, label, Icon, hint }) => (
        <button
          key={type}
          type="button"
          draggable
          onDragStart={(e) => {
            e.dataTransfer.effectAllowed = "copy";
            e.dataTransfer.setData(DATA_TRANSFER_KEY, type);
            // Some browsers need *any* string set or the drag is silently
            // cancelled — set a duplicate text/plain payload so the canvas
            // drop handler can also be tested with a plain editor.
            e.dataTransfer.setData("text/plain", type);
          }}
          onClick={() => dropToCentre(type)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              dropToCentre(type);
            }
          }}
          title={hint}
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
