"use client";

import * as React from "react";
import { Handle, Position } from "@xyflow/react";
import { Settings2 } from "lucide-react";
import { useShallow } from "zustand/react/shallow";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils/cn";
import {
  type NodeType,
  OS_LABELS,
} from "@labforge/schema";
import { useTopologyStore, type FlowNodeData } from "@/lib/store/topology-store";
import { VendorBadge } from "@/components/icons/VendorIcon";
import { lookupVendor } from "@/lib/icons/catalog";
import { ILLUSTRATIONS } from "@/components/canvas/illustrations";
import { NodeCvePopover } from "@/components/canvas/NodeCvePopover";

interface BaseNodeProps {
  id: string;
  data: FlowNodeData;
  selected?: boolean;
  type: NodeType;
}

/**
 * Muted accent per node type. Saturation deliberately dialled down so that
 * severity tints (alert red, warn amber, ok green) dominate the visual
 * hierarchy on the canvas — the eye is drawn to *what is wrong*, not to
 * "router orange". Hue is kept distinct so each node type is still
 * recognisable at a glance.
 */
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

export function BaseNode({ id, data, selected, type }: BaseNodeProps) {
  const setSelectedNode = useTopologyStore((s) => s.setSelectedNode);
  const issues = useTopologyStore(
    useShallow((s) =>
      s.validationIssues.filter(
        (i) => i.node_id === id && i.severity === "error",
      ),
    ),
  );
  const node = data.topologyNode;
  const cveCount = node.config.cves.length;
  const accent = ACCENTS[type];
  const Illustration = ILLUSTRATIONS[type];

  const vendorBadges = React.useMemo(() => {
    const seen = new Set<string>();
    const matches: { vendorId: string; role: string }[] = [];
    for (const role of node.config.roles) {
      const entry = lookupVendor(role);
      if (entry && !seen.has(entry.id)) {
        seen.add(entry.id);
        matches.push({ vendorId: entry.id, role });
      }
    }
    return matches;
  }, [node.config.roles]);

  const VISIBLE_BADGES = 4;
  const overflow = Math.max(0, vendorBadges.length - VISIBLE_BADGES);
  const hasError = issues.length > 0;

  return (
    <div
      className="group relative flex w-[148px] flex-col items-center"
      onClick={() => setSelectedNode(id)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") setSelectedNode(id);
      }}
    >
      {/* Connection handles — anchored at the left / right perimeter of
          the node's illustration so React Flow's getBezierPath /
          getStraightPath draws clean edges that meet the chassis instead
          of overshooting through the icon. Handles are invisible by
          default; on hover/focus of the parent ``.group`` they fade in
          as small accent-orange dots so the user has a clear "grab here
          to draw a connection" affordance. */}
      <Handle
        type="target"
        position={Position.Left}
        className="!h-3 !w-3 !rounded-full !border-2 !border-transparent !bg-transparent transition-colors duration-150 group-hover:!border-[var(--d10-accent)] group-hover:!bg-[var(--d10-accent)] group-focus-within:!border-[var(--d10-accent)] group-focus-within:!bg-[var(--d10-accent)]"
        style={{ top: "50%", transform: "translate(-50%, -50%)" }}
      />
      <Handle
        type="source"
        position={Position.Right}
        className="!h-3 !w-3 !rounded-full !border-2 !border-transparent !bg-transparent transition-colors duration-150 group-hover:!border-[var(--d10-accent)] group-hover:!bg-[var(--d10-accent)] group-focus-within:!border-[var(--d10-accent)] group-focus-within:!bg-[var(--d10-accent)]"
        style={{ top: "50%", transform: "translate(50%, -50%)" }}
      />

      {/* Illustration with optional selection / error glow */}
      <div
        className={cn(
          "relative cursor-pointer rounded-full transition-transform duration-150",
          selected && "scale-[1.04]",
        )}
        style={{
          filter: hasError
            ? "drop-shadow(0 0 8px rgba(239,68,68,0.7))"
            : selected
              ? `drop-shadow(0 0 10px ${accent}80)`
              : undefined,
        }}
      >
        <Illustration
          accent={accent}
          os={node.config.os}
          roles={node.config.roles}
          className="h-[112px] w-[112px] select-none"
        />

        {/* vendor "sticker" badges, top-right */}
        {vendorBadges.length > 0 && (
          <div className="pointer-events-none absolute -right-2 top-0 flex flex-col items-end gap-1">
            {vendorBadges.slice(0, VISIBLE_BADGES).map(({ vendorId, role }) => (
              <NodeCvePopover key={vendorId} nodeId={id} role={role}>
                <VendorBadge id={vendorId} size={18} />
              </NodeCvePopover>
            ))}
            {overflow > 0 && (
              <span className="inline-flex h-[24px] min-w-[24px] items-center justify-center rounded-full bg-white px-1.5 text-[10px] font-semibold text-slate-700 shadow ring-2 ring-slate-300">
                +{overflow}
              </span>
            )}
          </div>
        )}

        {/* gear pip, top-left, only visible on hover/select */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setSelectedNode(id);
          }}
          className={cn(
            "absolute -left-2 -top-2 inline-flex h-6 w-6 items-center justify-center rounded-full border bg-background text-muted-foreground shadow-sm transition-opacity hover:text-foreground",
            selected
              ? "opacity-100"
              : "opacity-0 group-hover:opacity-100",
          )}
          aria-label="Configure node"
        >
          <Settings2 className="h-3 w-3" />
        </button>

        {/* CVE warning pip, bottom-right */}
        {cveCount > 0 && (
          <span
            className="absolute -bottom-1 -right-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-destructive-foreground shadow ring-2 ring-background"
            title={`${cveCount} CVE${cveCount === 1 ? "" : "s"} preinstalled`}
          >
            {cveCount}
          </span>
        )}
      </div>

      {/* hostname + meta line below */}
      <div className="mt-1 flex max-w-[160px] flex-col items-center text-center">
        <p className="text-sm font-semibold leading-tight text-foreground">
          {node.config.hostname}
        </p>
        <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
          {node.label}
        </p>
        <div className="mt-1 flex flex-wrap items-center justify-center gap-1">
          <Badge variant="secondary" className="font-mono text-[10px] leading-tight py-0">
            {node.config.ip}
          </Badge>
          <Badge variant="outline" className="text-[10px] leading-tight py-0">
            {OS_LABELS[node.config.os]}
          </Badge>
        </div>
        {hasError && (
          <p className="mt-1 max-w-[160px] text-[10px] font-medium text-destructive">
            {issues[0]!.message}
          </p>
        )}
      </div>
    </div>
  );
}
