"use client";

import * as React from "react";
import { Check, Loader2 } from "lucide-react";

import { cn } from "@/lib/utils/cn";

import type { BuildPhase } from "@/lib/api/client";

/** The 5-step coarse stepper the system prompt's priority #3 asks for.
 *  Per-VM phases collapse onto these stops; the "current" stop is the
 *  least-advanced phase across every still-active VM. */
const STEPS: Array<{ id: BuildPhase | "generate"; label: string }> = [
  { id: "generate", label: "Generate" },
  { id: "downloading", label: "Import boxes" },
  { id: "booting", label: "Boot" },
  { id: "network", label: "Network" },
  { id: "provisioning", label: "Provision" },
];

const PHASE_RANK: Record<BuildPhase | "generate", number> = {
  generate: 0,
  defined: 0,
  downloading: 1,
  importing: 1,
  booting: 2,
  network: 3,
  provisioning: 4,
  ready: 5,
  failed: -1,
};

interface BuildPhaseStepperProps {
  perVm: Record<string, BuildPhase>;
  /** Overall build phase from /build/status (succeeded/failed/aborted/running/unknown). */
  overall: "running" | "succeeded" | "failed" | "aborted" | "unknown";
  /** Docker labs pull images and wait for health checks; VM labs import boxes and provision. */
  provider?: string;
}

const DOCKER_LABELS: Partial<Record<BuildPhase | "generate", string>> = {
  downloading: "Pull images",
  booting: "Start containers",
  network: "Network",
  provisioning: "Health checks",
};

/** Returns the lowest rank among per-VM phases — the slowest VM wins. */
function _slowestPhaseRank(perVm: Record<string, BuildPhase>): number {
  const ranks = Object.values(perVm).map((p) => PHASE_RANK[p] ?? 0);
  if (ranks.length === 0) return 0;
  return Math.min(...ranks);
}

export function BuildPhaseStepper({ perVm, overall, provider }: BuildPhaseStepperProps) {
  const slowest = _slowestPhaseRank(perVm);
  const anyFailed = Object.values(perVm).some((p) => p === "failed") || overall === "failed";
  const allReady = Object.values(perVm).length > 0 && Object.values(perVm).every((p) => p === "ready");
  const isDone = overall === "succeeded" || allReady;

  return (
    <ol className="flex w-full items-center gap-1 rounded-md border bg-card p-2 text-xs">
      {STEPS.map((step, idx) => {
        const stepRank = PHASE_RANK[step.id] ?? 0;
        let state: "done" | "active" | "pending" = "pending";
        if (isDone) state = "done";
        else if (stepRank < slowest) state = "done";
        else if (stepRank === slowest) state = "active";

        const isFailed = anyFailed && state === "active";
        return (
          <React.Fragment key={step.id}>
            <li
              className={cn(
                "flex items-center gap-1.5 rounded px-2 py-1 transition-colors",
                state === "done" && !isFailed && "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
                state === "active" && !isFailed && "bg-amber-500/20 text-amber-700 dark:text-amber-300",
                state === "active" && isFailed && "bg-red-500/20 text-red-700 dark:text-red-300",
                state === "pending" && "text-muted-foreground",
              )}
            >
              <span
                className={cn(
                  "flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-semibold",
                  state === "done" && !isFailed && "bg-emerald-500 text-white",
                  state === "active" && !isFailed && "bg-amber-500 text-white",
                  state === "active" && isFailed && "bg-red-500 text-white",
                  state === "pending" && "bg-muted text-muted-foreground",
                )}
              >
                {state === "done" && !isFailed ? (
                  <Check className="h-2.5 w-2.5" />
                ) : state === "active" && !isFailed ? (
                  <Loader2 className="h-2.5 w-2.5 animate-spin" />
                ) : (
                  idx + 1
                )}
              </span>
              {(provider === "docker" && DOCKER_LABELS[step.id]) || step.label}
            </li>
            {idx < STEPS.length - 1 && (
              <span
                aria-hidden
                className={cn(
                  "h-px flex-1",
                  stepRank < slowest ? "bg-emerald-500/40" : "bg-border",
                )}
              />
            )}
          </React.Fragment>
        );
      })}
    </ol>
  );
}
