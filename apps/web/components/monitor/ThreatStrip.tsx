"use client";

import * as React from "react";
import { AlertTriangle, ShieldAlert } from "lucide-react";

import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils/cn";
import type { MonitorEvent } from "@/lib/monitor/events";

/**
 * Aggregate the alert-level events into severity tiles like the Darktrace
 * threat bar. Each unique message becomes a tile with a count + first-seen.
 */
function buildTiles(events: MonitorEvent[]) {
  const buckets = new Map<
    string,
    { message: string; count: number; firstSeen: string; hostname?: string; severity: "alert" | "warn" }
  >();
  for (const e of events) {
    if (e.severity !== "alert" && e.severity !== "warn") continue;
    // Truncate the message to a normalised key — first 60 chars.
    const key = e.message.slice(0, 60);
    const existing = buckets.get(key);
    if (existing) {
      existing.count += 1;
      if (e.capturedAt < existing.firstSeen) existing.firstSeen = e.capturedAt;
    } else {
      buckets.set(key, {
        message: e.message,
        count: 1,
        firstSeen: e.capturedAt,
        hostname: e.hostname,
        severity: e.severity,
      });
    }
  }
  return [...buckets.values()]
    .sort((a, b) => (a.severity === b.severity ? b.count - a.count : a.severity === "alert" ? -1 : 1))
    .slice(0, 12);
}

export function ThreatStrip({ events }: { events: MonitorEvent[] }) {
  const tiles = React.useMemo(() => buildTiles(events), [events]);

  if (tiles.length === 0) {
    return (
      <div className="flex h-full items-center justify-center rounded-lg border bg-card/60 px-4 text-xs text-muted-foreground">
        <ShieldAlert className="mr-2 h-4 w-4" />
        No threats detected yet — everything looks quiet.
      </div>
    );
  }

  return (
    <div className="flex h-full gap-2 overflow-x-auto px-1 pb-1">
      {tiles.map((t, idx) => {
        const isAlert = t.severity === "alert";
        // Darktrace-style "confidence" derived from count — naive but reads well.
        const confidence = Math.min(100, 60 + t.count * 5 + (isAlert ? 20 : 0));
        return (
          <Card
            key={idx}
            className={cn(
              "flex min-w-[220px] shrink-0 cursor-pointer flex-col gap-1 border-l-4 p-3 text-xs transition-colors hover:bg-accent/30",
              isAlert ? "border-l-red-500" : "border-l-amber-500",
            )}
          >
            <div className="flex items-center gap-2">
              <AlertTriangle
                className={cn(
                  "h-4 w-4",
                  isAlert ? "text-red-500" : "text-amber-500",
                )}
              />
              <span className="text-base font-semibold">{confidence}%</span>
              <span className="ml-auto text-[10px] text-muted-foreground">×{t.count}</span>
            </div>
            <p className="line-clamp-2 font-medium leading-tight text-foreground">
              {t.message}
            </p>
            <p className="text-[10px] text-muted-foreground">
              {t.hostname ?? "—"}
              <span className="ml-2 opacity-50">
                {new Date(t.firstSeen).toLocaleTimeString()}
              </span>
            </p>
          </Card>
        );
      })}
    </div>
  );
}
