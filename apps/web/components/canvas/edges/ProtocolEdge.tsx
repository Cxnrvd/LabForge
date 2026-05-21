"use client";

import * as React from "react";
import {
  BaseEdge,
  EdgeLabelRenderer,
  type EdgeProps,
  getStraightPath,
} from "@xyflow/react";
import { X } from "lucide-react";

import { useTopologyStore, type FlowEdgeData } from "@/lib/store/topology-store";

export function ProtocolEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  data,
  selected,
}: EdgeProps & { data?: FlowEdgeData }) {
  const [edgePath, labelX, labelY] = getStraightPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
  });
  const removeEdge = useTopologyStore((s) => s.removeEdge);
  const [hovered, setHovered] = React.useState(false);
  const topEdge = data?.topologyEdge;

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        style={{
          stroke:
            selected || hovered
              ? "hsl(var(--primary))"
              : "hsl(var(--foreground) / 0.85)",
          strokeWidth: selected || hovered ? 3.5 : 2.5,
        }}
        markerEnd="url(#labforge-arrow)"
      />
      <path
        d={edgePath}
        fill="none"
        stroke="transparent"
        strokeWidth={20}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      />
      <EdgeLabelRenderer>
        <div
          style={{
            position: "absolute",
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            pointerEvents: "all",
          }}
          className="flex items-center gap-1 rounded-md border bg-background px-2 py-0.5 text-[10px] font-medium shadow-sm"
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
        >
          <span>
            {topEdge?.label ?? topEdge?.protocol.toUpperCase() ?? "TCP"}
            {topEdge?.port ? `:${topEdge.port}` : ""}
          </span>
          {(hovered || selected) && (
            <button
              onClick={() => removeEdge(id)}
              aria-label="Delete edge"
              className="rounded-sm p-0.5 text-muted-foreground hover:bg-destructive/20 hover:text-destructive"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}
