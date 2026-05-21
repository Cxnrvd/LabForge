"use client";

import * as React from "react";
import {
  BaseEdge,
  EdgeLabelRenderer,
  type EdgeProps,
  getStraightPath,
} from "@xyflow/react";

import type { FlowEdgeData } from "@/lib/store/topology-store";

/**
 * Edge used in monitor / threat-visualiser mode. The base path is drawn with
 * a subtle dashed stroke; a small SVG circle animates along the path with
 * `<animateMotion>` to give the "live data flow" feel of Darktrace.
 */
export function LiveEdge({
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
  const topEdge = data?.topologyEdge;
  const meta = data as Record<string, unknown> | undefined;
  const severity = meta?.severity as "ok" | "warn" | "alert" | undefined;
  const packets = typeof meta?.packets === "number" ? (meta!.packets as number) : 0;

  const baseStroke =
    severity === "alert"
      ? "#ef4444"
      : severity === "warn"
        ? "#f59e0b"
        : "hsl(var(--foreground) / 0.55)";
  const flowColor =
    severity === "alert"
      ? "#fca5a5"
      : severity === "warn"
        ? "#fde68a"
        : "#34d399";

  // Map packet count → particle density bucket. Decorative when 0
  // (preserves the v1 look when the daemon can't capture).
  const measured = packets > 0;
  const bucket = !measured ? 1 : packets < 10 ? 1 : packets < 100 ? 2 : 3;
  const particleDelays = !measured
    ? [0, 0.66, 1.33]
    : bucket === 1
      ? [0]
      : bucket === 2
        ? [0, 0.8, 1.6]
        : [0, 0.4, 0.8, 1.2, 1.6, 2.0];
  const dur =
    severity === "alert"
      ? "1.6s"
      : bucket === 3
        ? "1.6s"
        : bucket === 1 && measured
          ? "3.2s"
          : "2.4s";
  const particleOpacity = measured ? 0.95 : 0.45;

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        style={{
          stroke: baseStroke,
          strokeWidth: measured ? 1.8 : 1.5,
          strokeDasharray: "6 6",
          opacity: measured ? 0.7 : 0.45,
        }}
        markerEnd="url(#labforge-arrow)"
      />
      {/* Particles along the path — count scaled by flow rate. */}
      {particleDelays.map((delay, idx) => (
        <circle
          key={idx}
          r={severity === "alert" ? 3.5 : measured && bucket === 3 ? 3 : 2.5}
          fill={flowColor}
          opacity={particleOpacity}
          filter="url(#labforge-glow)"
        >
          <animateMotion
            dur={dur}
            repeatCount="indefinite"
            begin={`${delay}s`}
            path={edgePath}
          />
        </circle>
      ))}
      <EdgeLabelRenderer>
        <div
          style={{
            position: "absolute",
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            pointerEvents: selected ? "all" : "none",
          }}
          className="rounded-md border bg-background/90 px-2 py-0.5 text-[10px] font-medium shadow-sm backdrop-blur"
        >
          {topEdge?.label ?? topEdge?.protocol.toUpperCase() ?? "TCP"}
          {topEdge?.port ? `:${topEdge.port}` : ""}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}
