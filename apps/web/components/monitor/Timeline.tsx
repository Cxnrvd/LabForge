"use client";

import * as React from "react";
import { Clock } from "lucide-react";

import { cn } from "@/lib/utils/cn";
import type { MonitorEvent } from "@/lib/monitor/events";

interface TimelineProps {
  events: MonitorEvent[];
  /** Number of buckets to render across the timeline. */
  buckets?: number;
  /** Time window in milliseconds (default 30 min). */
  windowMs?: number;
}

interface Bucket {
  start: number; // epoch ms
  alert: number;
  warn: number;
  ok: number;
  info: number;
  total: number;
}

/**
 * Stacked-bar event-density timeline. Each column represents a fixed time
 * window; height is total event count; sub-bars are severity-tinted.
 * Renders quietly when there's no data so it doesn't dominate the layout.
 */
export function Timeline({ events, buckets = 40, windowMs = 30 * 60_000 }: TimelineProps) {
  const data = React.useMemo(() => {
    if (events.length === 0) return { rows: [] as Bucket[], max: 0, from: 0, to: 0 };
    const to = Date.now();
    const from = to - windowMs;
    const bucketMs = windowMs / buckets;
    const rows: Bucket[] = Array.from({ length: buckets }, (_, i) => ({
      start: from + i * bucketMs,
      alert: 0,
      warn: 0,
      ok: 0,
      info: 0,
      total: 0,
    }));
    for (const e of events) {
      const t = new Date(e.capturedAt).getTime();
      if (Number.isNaN(t) || t < from || t > to) continue;
      const idx = Math.min(buckets - 1, Math.floor((t - from) / bucketMs));
      const b = rows[idx];
      if (!b) continue;
      b[e.severity] += 1;
      b.total += 1;
    }
    const max = rows.reduce((m, b) => Math.max(m, b.total), 0);
    return { rows, max, from, to };
  }, [events, buckets, windowMs]);

  const fmt = (ms: number): string =>
    new Date(ms).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

  return (
    <div className="flex h-full w-full items-stretch gap-3 rounded-lg border bg-card/85 px-3 py-2">
      <div className="flex w-24 shrink-0 flex-col justify-between text-[10px] text-muted-foreground">
        <div className="flex items-center gap-1">
          <Clock className="h-3 w-3" />
          <span className="font-semibold uppercase tracking-wide">Timeline</span>
        </div>
        <div className="space-y-0.5">
          <p className="font-mono tabular-nums">{fmt(data.from)}</p>
          <p className="font-mono tabular-nums text-foreground">{fmt(data.to)}</p>
          <p className="text-muted-foreground">last {Math.round(windowMs / 60_000)} min</p>
        </div>
      </div>

      <div className="flex flex-1 items-end gap-[1px]">
        {data.rows.map((b, idx) => {
          const h = data.max ? b.total / data.max : 0;
          const segments = [
            { count: b.alert, color: "bg-red-500" },
            { count: b.warn, color: "bg-amber-500" },
            { count: b.ok, color: "bg-emerald-500" },
            { count: b.info, color: "bg-slate-400" },
          ];
          return (
            <div
              key={idx}
              className="group relative flex h-full min-w-[3px] flex-1 flex-col-reverse"
              title={`${fmt(b.start)} — ${b.total} event${b.total === 1 ? "" : "s"}`}
            >
              {segments.map((s, i) => (
                <div
                  key={i}
                  className={cn("w-full", s.color)}
                  style={{
                    height: data.max ? `${(s.count / data.max) * 100}%` : 0,
                    opacity: s.count ? 0.95 : 0,
                  }}
                />
              ))}
              {/* tiny pulse on the last column so user sees "live" */}
              {idx === data.rows.length - 1 && b.total === 0 && (
                <div
                  className="absolute bottom-0 left-0 h-1 w-full rounded-t-sm bg-emerald-500/40"
                  style={{ height: `${4 + h * 8}%` }}
                />
              )}
              <span className="pointer-events-none absolute -top-5 left-1/2 hidden -translate-x-1/2 rounded bg-background/95 px-1.5 py-0.5 text-[10px] shadow group-hover:block">
                {b.total ? `${b.total}` : "—"}
              </span>
            </div>
          );
        })}
      </div>

      <div className="flex w-24 shrink-0 flex-col justify-end gap-0.5 text-[10px] text-muted-foreground">
        <div className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-full bg-red-500" /> alert
        </div>
        <div className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-full bg-amber-500" /> warn
        </div>
        <div className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-full bg-emerald-500" /> ok
        </div>
        <div className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-full bg-slate-400" /> info
        </div>
      </div>
    </div>
  );
}
