"use client";

import * as React from "react";
import { Activity, Filter, Search, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils/cn";
import type { EventCategory, EventSeverity, MonitorEvent } from "@/lib/monitor/events";

const SEV_COLOR: Record<EventSeverity, string> = {
  info: "bg-slate-400",
  ok: "bg-emerald-500",
  warn: "bg-amber-500",
  alert: "bg-red-500",
};

const CAT_LABEL: Record<EventCategory, string> = {
  system: "sys",
  vm: "vm",
  network: "net",
  auth: "auth",
  threat: "threat",
  service: "svc",
  provision: "prov",
};

function timeShort(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return iso.slice(11, 19);
  }
}

interface EventLogProps {
  events: MonitorEvent[];
  selectedHostname?: string | null;
  onSelectHost?: (hostname: string | null) => void;
}

const SEVERITY_CHIPS: { value: "all" | EventSeverity; label: string; dot: string }[] = [
  { value: "all", label: "All", dot: "bg-slate-300" },
  { value: "alert", label: "Alert", dot: "bg-red-500" },
  { value: "warn", label: "Warn", dot: "bg-amber-500" },
  { value: "ok", label: "OK", dot: "bg-emerald-500" },
  { value: "info", label: "Info", dot: "bg-slate-400" },
];

export function EventLog({
  events,
  selectedHostname,
  onSelectHost,
}: EventLogProps) {
  const [filter, setFilter] = React.useState("");
  const [severity, setSeverity] = React.useState<"all" | EventSeverity>("all");

  const filtered = React.useMemo(() => {
    const q = filter.trim().toLowerCase();
    return events.filter((e) => {
      if (severity !== "all" && e.severity !== severity) return false;
      if (selectedHostname && e.hostname !== selectedHostname) return false;
      if (!q) return true;
      return (
        e.message.toLowerCase().includes(q) ||
        (e.hostname?.toLowerCase().includes(q) ?? false) ||
        e.category.toLowerCase().includes(q)
      );
    });
  }, [events, filter, severity, selectedHostname]);

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-lg border bg-card/85 shadow-sm">
      <div className="flex items-center justify-between border-b px-3 py-2">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-emerald-500" />
          <p className="text-sm font-semibold">Event stream</p>
        </div>
        <Badge variant="secondary" className="text-[10px] tabular-nums">
          {filtered.length}
        </Badge>
      </div>

      {selectedHostname && (
        <div className="flex items-center gap-2 border-b bg-primary/5 px-3 py-1.5 text-xs">
          <Filter className="h-3 w-3 text-primary" />
          <span className="text-muted-foreground">Focused on</span>
          <code className="rounded bg-background px-1 font-mono text-[11px] font-semibold">
            {selectedHostname}
          </code>
          <Button
            variant="ghost"
            size="icon"
            className="ml-auto h-5 w-5"
            onClick={() => onSelectHost?.(null)}
            aria-label="Clear host focus"
          >
            <X className="h-3 w-3" />
          </Button>
        </div>
      )}

      <div className="space-y-1.5 border-b px-3 py-2">
        <div className="flex items-center gap-1.5">
          <Search className="h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="search events…"
            className="h-7 border-0 bg-transparent px-1 text-xs shadow-none focus-visible:ring-0"
          />
          {filter && (
            <Button
              variant="ghost"
              size="icon"
              className="h-5 w-5"
              onClick={() => setFilter("")}
            >
              <X className="h-3 w-3" />
            </Button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1">
          {SEVERITY_CHIPS.map((c) => (
            <button
              key={c.value}
              type="button"
              onClick={() => setSeverity(c.value)}
              className={cn(
                "flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] transition-colors",
                severity === c.value
                  ? "border-foreground bg-foreground text-background"
                  : "border-input bg-background hover:bg-accent",
              )}
            >
              <span className={cn("h-1.5 w-1.5 rounded-full", c.dot)} />
              {c.label}
            </button>
          ))}
        </div>
      </div>

      <ScrollArea className="flex-1">
        {filtered.length === 0 ? (
          <p className="px-3 py-6 text-center text-xs text-muted-foreground">
            No events match.
          </p>
        ) : (
          <div className="divide-y">
            {filtered.map((e) => (
              <button
                key={e.id}
                type="button"
                onClick={() =>
                  e.hostname &&
                  onSelectHost?.(
                    e.hostname === selectedHostname ? null : e.hostname,
                  )
                }
                className={cn(
                  "block w-full px-3 py-2 text-left transition-colors hover:bg-accent/40",
                  e.severity === "alert" && "bg-red-500/5 hover:bg-red-500/10",
                  e.severity === "warn" && "bg-amber-500/5 hover:bg-amber-500/10",
                  e.hostname === selectedHostname && "ring-1 ring-inset ring-primary/40",
                )}
              >
                <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                  <span
                    className={cn(
                      "inline-block h-1.5 w-1.5 rounded-full",
                      SEV_COLOR[e.severity],
                    )}
                  />
                  <span className="font-mono tabular-nums">{timeShort(e.capturedAt)}</span>
                  <Badge variant="outline" className="text-[9px] uppercase">
                    {CAT_LABEL[e.category]}
                  </Badge>
                  {e.hostname && (
                    <span className="font-mono text-foreground">{e.hostname}</span>
                  )}
                </div>
                <p className="mt-0.5 break-words font-mono text-[11px] leading-relaxed text-foreground/90">
                  {e.message}
                </p>
              </button>
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
