"use client";

import * as React from "react";
import { NodeResizer, type NodeProps } from "@xyflow/react";
import { Pencil, Trash2 } from "lucide-react";

import { cn } from "@/lib/utils/cn";
import { useTopologyStore, type FlowZoneData } from "@/lib/store/topology-store";
import { Input } from "@/components/ui/input";

/**
 * hex → rgba with the supplied alpha. Used so the zone fill respects the
 * configured opacity without us monkey-patching CSS opacity (which would
 * also fade the label).
 */
function hexToRgba(hex: string, alpha: number): string {
  const m = hex.replace("#", "");
  const full =
    m.length === 3
      ? m
          .split("")
          .map((c) => c + c)
          .join("")
      : m;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function ZoneNode({ data, selected }: NodeProps) {
  const zoneData = data as FlowZoneData;
  const { zone } = zoneData;
  const removeZone = useTopologyStore((s) => s.removeZone);
  const updateZone = useTopologyStore((s) => s.updateZone);
  const [editing, setEditing] = React.useState(false);
  const [draftLabel, setDraftLabel] = React.useState(zone.label);

  React.useEffect(() => setDraftLabel(zone.label), [zone.label]);

  const commitLabel = (): void => {
    setEditing(false);
    if (draftLabel !== zone.label) {
      updateZone(zone.id, (z) => ({ ...z, label: draftLabel }));
    }
  };

  const fill = hexToRgba(zone.color, zone.opacity);
  const stroke = hexToRgba(zone.color, 0.65);

  return (
    <div
      className={cn(
        "relative h-full w-full",
        selected && "rounded-xl ring-2 ring-ring ring-offset-2 ring-offset-background",
      )}
    >
      <NodeResizer
        isVisible={selected ?? false}
        minWidth={120}
        minHeight={80}
        handleClassName="!h-2.5 !w-2.5 !rounded-sm !bg-background !border !border-ring"
        lineClassName="!border-ring"
      />

      {zone.shape === "rectangle" && (
        <div
          className="absolute inset-0"
          style={{
            background: fill,
            border: `2px dashed ${stroke}`,
            borderRadius: 18,
          }}
        />
      )}

      {zone.shape === "ellipse" && (
        // Inflate the visible ellipse beyond the bbox so its inscribed
        // rectangle still surrounds nodes positioned near the top/bottom
        // edges of the saved bbox.
        <div
          className="absolute"
          style={{
            top: "-12%",
            left: "-6%",
            right: "-6%",
            bottom: "-12%",
            background: fill,
            border: `2px dashed ${stroke}`,
            borderRadius: "50%",
          }}
        />
      )}

      {zone.shape === "triangle" && (
        // Wider trapezoid (was a sharp apex). Top is 56% of bbox width so a
        // node positioned near the top of the bbox fits inside the polygon.
        <svg
          className="absolute inset-0 h-full w-full"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <polygon
            points="22,4 78,4 96,96 4,96"
            fill={fill}
            stroke={stroke}
            strokeWidth="0.6"
            strokeDasharray="2 1.2"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      )}

      {zone.shape === "cloud" && (
        // Soft cloud blob for "External" / "Internet" / "SaaS" zones.
        <svg
          className="absolute inset-0 h-full w-full"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            d="M 12 70
               C 4 70, 4 50, 16 48
               C 14 32, 32 22, 44 30
               C 50 14, 76 14, 80 30
               C 96 30, 96 52, 82 56
               C 92 70, 76 84, 64 76
               C 56 92, 28 92, 24 78
               C 8 84, 4 70, 12 70 Z"
            fill={fill}
            stroke={stroke}
            strokeWidth="0.6"
            strokeDasharray="2 1.2"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      )}

      <div className="absolute left-3 top-2 flex items-center gap-1">
        {editing ? (
          <Input
            autoFocus
            value={draftLabel}
            onChange={(e) => setDraftLabel(e.target.value)}
            onBlur={commitLabel}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitLabel();
              if (e.key === "Escape") {
                setDraftLabel(zone.label);
                setEditing(false);
              }
            }}
            className="h-6 w-40 bg-background/90 px-2 text-xs font-semibold"
          />
        ) : (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="rounded-md bg-background/85 px-2 py-0.5 text-xs font-semibold shadow-sm hover:bg-background"
            style={{ color: zone.color }}
          >
            {zone.label || "Zone"}
          </button>
        )}
        {selected && (
          <>
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="rounded-md bg-background/85 p-1 text-muted-foreground shadow-sm hover:text-foreground"
              aria-label="Edit zone label"
            >
              <Pencil className="h-3 w-3" />
            </button>
            <button
              type="button"
              onClick={() => removeZone(zone.id)}
              className="rounded-md bg-background/85 p-1 text-muted-foreground shadow-sm hover:text-destructive"
              aria-label="Delete zone"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </>
        )}
      </div>
    </div>
  );
}
