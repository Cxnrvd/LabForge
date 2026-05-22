"use client";

import * as React from "react";
import { Cpu, HardDrive, MemoryStick } from "lucide-react";

import { cn } from "@/lib/utils/cn";
import { isZone, useTopologyStore } from "@/lib/store/topology-store";

/**
 * Running totals for the canvas: RAM, CPU, disk, estimated `vagrant up`
 * time. Pinned to the bottom-left of the build view so the user gets
 * live feedback as nodes are added. Thresholds match what a typical
 * 16 GB workstation can sustain; the bar turns amber/red as we approach.
 */

const MEMORY_AMBER_MB = 12 * 1024;
const MEMORY_RED_MB = 16 * 1024;
const CPU_AMBER = 8;
const CPU_RED = 12;
const PROVISION_AVG_SECONDS = 90; // empirical from the bundled templates

function fmtMb(mb: number): string {
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
  return `${mb} MB`;
}

function fmtSeconds(s: number): string {
  if (s < 90) return `${Math.round(s)}s`;
  const minutes = Math.round(s / 60);
  if (minutes < 60) return `${minutes}m`;
  return `${(minutes / 60).toFixed(1)}h`;
}

export function LabBudgetBar() {
  const nodes = useTopologyStore((s) => s.nodes);

  const stats = React.useMemo(() => {
    let memory = 0;
    let cpus = 0;
    let count = 0;
    let provisionable = 0;
    for (const n of nodes) {
      if (isZone(n)) continue;
      const t = n.data.topologyNode;
      memory += t.config.memory_mb;
      cpus += t.config.cpus;
      count += 1;
      if (t.type !== "internet") provisionable += 1;
    }
    const estSeconds = provisionable * PROVISION_AVG_SECONDS + (provisionable > 0 ? 60 : 0);
    return { memory, cpus, count, provisionable, estSeconds };
  }, [nodes]);

  if (stats.count === 0) return null;

  const memoryTone =
    stats.memory >= MEMORY_RED_MB
      ? "text-red-600 dark:text-red-400"
      : stats.memory >= MEMORY_AMBER_MB
        ? "text-amber-600 dark:text-amber-400"
        : "text-muted-foreground";
  const cpuTone =
    stats.cpus >= CPU_RED
      ? "text-red-600 dark:text-red-400"
      : stats.cpus >= CPU_AMBER
        ? "text-amber-600 dark:text-amber-400"
        : "text-muted-foreground";

  return (
    <div
      role="status"
      aria-live="polite"
      // Centred along the bottom so it doesn't collide with React Flow's
      // MiniMap (bottom-left) or Controls (bottom-right). z-20 puts it on
      // the same plane as the side panels and BELOW the Toolbar (z-40).
      className="pointer-events-none absolute bottom-4 left-1/2 z-20 flex -translate-x-1/2 items-center gap-3 rounded-md border bg-background/90 px-3 py-2 text-xs shadow-md backdrop-blur"
    >
      <span className="font-medium">{stats.count} node{stats.count === 1 ? "" : "s"}</span>
      <span className="text-muted-foreground">·</span>
      <span className={cn("inline-flex items-center gap-1", memoryTone)}>
        <MemoryStick className="h-3.5 w-3.5" />
        <span className="tabular-nums">{fmtMb(stats.memory)}</span>
      </span>
      <span className={cn("inline-flex items-center gap-1", cpuTone)}>
        <Cpu className="h-3.5 w-3.5" />
        <span className="tabular-nums">{stats.cpus} vCPU</span>
      </span>
      <span className="inline-flex items-center gap-1 text-muted-foreground">
        <HardDrive className="h-3.5 w-3.5" />
        <span className="tabular-nums">~{fmtSeconds(stats.estSeconds)} to up</span>
      </span>
    </div>
  );
}
