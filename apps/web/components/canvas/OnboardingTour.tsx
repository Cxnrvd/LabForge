"use client";

import * as React from "react";
import { ArrowRight, X } from "lucide-react";

import { cn } from "@/lib/utils/cn";
import { Button } from "@/components/ui/button";

/**
 * Four-step coachmark overlay for the first build-page visit. Each step
 * highlights one part of the canvas (palette, toolbar, validate, build)
 * with a numbered card explaining what it does. Dismiss persists so we
 * don't show it again.
 *
 * Designed to be skippable — every state has a clear "Skip tour" exit
 * and Esc closes the whole thing. Cheap to remove later: this component
 * has no dependencies on the rest of the canvas state.
 */

const STORAGE_KEY = "labforge.onboarding.v1";

interface Step {
  title: string;
  body: string;
  /** CSS selector to highlight; the card anchors near the element. */
  selector?: string;
  fallbackPosition: "top-left" | "top-right" | "bottom-left" | "bottom-right" | "center";
}

const STEPS: Step[] = [
  {
    title: "Drag a node from the palette",
    body:
      "The rail on the left holds the 11 node types — workstations, servers, attackers, PLCs, cameras. Drag any one onto the canvas (or hit Enter on a focused tile to drop it in the centre).",
    selector: "[aria-label='Node palette']",
    fallbackPosition: "top-left",
  },
  {
    title: "Wire nodes with edges",
    body:
      "Hover a node to see its connection handles, then drag from the handle to another node. You'll be asked which protocol the edge uses (TCP, SSH, Modbus, RTSP, etc.).",
    fallbackPosition: "center",
  },
  {
    title: "Validate before you build",
    body:
      "Click Validate in the toolbar to catch duplicate IPs, internet-to-internal exposure, and OS/role mismatches before vagrant up. Warnings show as badges on the offending nodes.",
    selector: "button[aria-label='Validate']",
    fallbackPosition: "top-right",
  },
  {
    title: "Hit Build Lab",
    body:
      "Build runs vagrant up on the API host and streams the log into the monitor view. The activity feed on the dashboard updates as heartbeats arrive. Generate Lab (in the overflow menu) downloads a zip instead.",
    selector: "button[aria-label='Build Lab']",
    fallbackPosition: "top-right",
  },
];

function hasSeenTour(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return true;
  }
}

function markTourSeen(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, "1");
  } catch {
    /* ignore */
  }
}

export function OnboardingTour() {
  const [open, setOpen] = React.useState(false);
  const [step, setStep] = React.useState(0);

  React.useEffect(() => {
    if (!hasSeenTour()) setOpen(true);
  }, []);

  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") finish();
      if (e.key === "ArrowRight") next();
      if (e.key === "ArrowLeft") setStep((s) => Math.max(0, s - 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const finish = (): void => {
    markTourSeen();
    setOpen(false);
  };

  const next = (): void => {
    if (step === STEPS.length - 1) finish();
    else setStep((s) => s + 1);
  };

  if (!open) return null;
  const current = STEPS[step];
  if (!current) return null;
  const anchor = positionFor(current);
  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-background/40 backdrop-blur-sm"
        onClick={finish}
        aria-hidden
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="labforge-onboarding-title"
        className={cn(
          "fixed z-50 w-[320px] max-w-[90vw] rounded-lg border bg-card p-4 shadow-2xl",
          anchor,
        )}
      >
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
            Step {step + 1} of {STEPS.length}
          </span>
          <button
            type="button"
            onClick={finish}
            aria-label="Skip tour"
            className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        <h3
          id="labforge-onboarding-title"
          className="text-sm font-semibold"
        >
          {current.title}
        </h3>
        <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{current.body}</p>
        <div className="mt-4 flex items-center justify-between">
          <button
            type="button"
            onClick={finish}
            className="text-[11px] text-muted-foreground hover:text-foreground"
          >
            Skip tour
          </button>
          <Button size="sm" className="h-8" onClick={next}>
            {step === STEPS.length - 1 ? "Got it" : "Next"}
            <ArrowRight className="ml-1 h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </>
  );
}

function positionFor(step: Step): string {
  switch (step.fallbackPosition) {
    case "top-left":
      return "left-20 top-24";
    case "top-right":
      return "right-6 top-24";
    case "bottom-left":
      return "bottom-24 left-6";
    case "bottom-right":
      return "bottom-24 right-6";
    case "center":
    default:
      return "left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2";
  }
}
