"use client";

import * as React from "react";
import {
  AlertOctagon,
  CheckCircle2,
  CircleDot,
  CircleHelp,
  Hammer,
  Loader2,
  Pause,
  XCircle,
} from "lucide-react";

import { cn } from "@/lib/utils/cn";

/**
 * Single source of truth for the lab/build/event/severity vocabulary.
 *
 * Every place that surfaces state should render through this component so
 * the same word is always the same colour, the same icon, and the same
 * weight. If you find yourself reaching for a `<Badge>` with a state-y
 * label, use this instead.
 */
export type Status =
  // Lab lifecycle
  | "running"
  | "building"
  | "succeeded"
  | "failed"
  | "partial"
  | "stopped"
  | "pending"
  | "unknown"
  // Event severity
  | "ok"
  | "warn"
  | "alert"
  | "info";

interface StatusMeta {
  label: string;
  classes: string;
  Icon?: React.ComponentType<{ className?: string }>;
  pulse?: boolean;
}

const META: Record<Status, StatusMeta> = {
  // ---- lab lifecycle
  running: {
    label: "Running",
    classes:
      "border-emerald-500/40 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
    Icon: CircleDot,
  },
  building: {
    label: "Building",
    classes:
      "border-blue-500/40 bg-blue-500/15 text-blue-700 dark:text-blue-300",
    Icon: Hammer,
    pulse: true,
  },
  succeeded: {
    label: "Succeeded",
    classes:
      "border-emerald-500/40 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
    Icon: CheckCircle2,
  },
  failed: {
    label: "Failed",
    classes: "border-red-500/50 bg-red-500/15 text-red-700 dark:text-red-300",
    Icon: XCircle,
  },
  partial: {
    label: "Partial",
    classes:
      "border-amber-500/40 bg-amber-500/15 text-amber-700 dark:text-amber-300",
    Icon: CircleDot,
  },
  stopped: {
    label: "Stopped",
    classes: "border-border bg-muted text-muted-foreground",
    Icon: Pause,
  },
  pending: {
    label: "Pending",
    classes:
      "border-blue-500/40 bg-blue-500/10 text-blue-700 dark:text-blue-300",
    Icon: Loader2,
    pulse: true,
  },
  unknown: {
    label: "Unknown",
    classes: "border-border bg-muted text-muted-foreground",
    Icon: CircleHelp,
  },

  // ---- event severity
  ok: {
    label: "OK",
    classes:
      "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
    Icon: CheckCircle2,
  },
  warn: {
    label: "Warn",
    classes:
      "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300",
    Icon: AlertOctagon,
  },
  alert: {
    label: "Alert",
    classes: "border-red-500/50 bg-red-500/15 text-red-700 dark:text-red-300",
    Icon: AlertOctagon,
  },
  info: {
    label: "Info",
    classes: "border-border bg-muted text-muted-foreground",
    Icon: CircleDot,
  },
};

interface StatusBadgeProps {
  state: Status | string;
  /** Override the displayed label (defaults to the canonical label). */
  label?: string;
  /** Hide the leading icon. */
  iconOff?: boolean;
  /** Render a smaller chip suitable for table rows. */
  size?: "default" | "sm";
  className?: string;
}

function normalize(state: string): Status {
  const lower = state.toLowerCase();
  if (lower in META) return lower as Status;
  return "unknown";
}

export function StatusBadge({
  state,
  label,
  iconOff,
  size = "default",
  className,
}: StatusBadgeProps) {
  const key = normalize(state);
  const meta = META[key];
  const Icon = meta.Icon;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border font-semibold capitalize",
        size === "sm" ? "px-1.5 py-0 text-[10px]" : "px-2 py-0.5 text-xs",
        meta.classes,
        className,
      )}
      data-state={key}
    >
      {!iconOff && Icon && (
        <Icon
          className={cn(
            size === "sm" ? "h-2.5 w-2.5" : "h-3 w-3",
            meta.pulse && "animate-pulse",
          )}
        />
      )}
      {label ?? meta.label}
    </span>
  );
}
