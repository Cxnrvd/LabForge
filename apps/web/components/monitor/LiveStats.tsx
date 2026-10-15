"use client";

import * as React from "react";
import {
  Cable,
  Cpu,
  Globe,
  HardDrive,
  KeyRound,
  Network,
  RefreshCw,
  Server,
  ShieldAlert,
  X,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils/cn";
import { OS_LABELS, type LabConfig } from "@labforge/schema";
import { lookupVendor, parseRole } from "@/lib/icons/catalog";
import { VendorIconInner } from "@/components/icons/VendorIcon";
import type { MonitorEvent } from "@/lib/monitor/events";

interface VmState {
  hostname: string;
  state: string;
  ip?: string | null;
}

interface LiveStatsProps {
  topology: LabConfig | null;
  vms: VmState[];
  capturedAt?: string | null;
  threatHosts: ReadonlySet<string>;
  selectedHostname?: string | null;
  onSelectHost?: (hostname: string | null) => void;
  events: MonitorEvent[];
}

const STATE_COLOR: Record<string, string> = {
  running: "bg-emerald-500",
  poweroff: "bg-slate-400",
  saved: "bg-blue-500",
  aborted: "bg-red-500",
  unknown: "bg-slate-300",
  not_created: "bg-slate-300",
};

export function LiveStats(props: LiveStatsProps) {
  return (
    <div className="flex h-full flex-col overflow-hidden rounded-lg border bg-card/85 shadow-sm">
      <div className="flex items-center justify-between border-b px-3 py-2">
        <div className="flex items-center gap-2">
          <RefreshCw
            className={cn(
              "h-3.5 w-3.5",
              props.capturedAt ? "text-emerald-500" : "text-muted-foreground",
            )}
          />
          <p className="text-sm font-semibold">
            {props.selectedHostname ? "Device drilldown" : "Live status"}
          </p>
        </div>
        <span className="text-[10px] text-muted-foreground tabular-nums">
          {props.capturedAt
            ? new Date(props.capturedAt).toLocaleTimeString()
            : "no telemetry"}
        </span>
      </div>

      <ScrollArea className="flex-1 px-3 py-2">
        {props.selectedHostname ? (
          <DeviceDrilldown {...props} hostname={props.selectedHostname} />
        ) : (
          <OverallView {...props} />
        )}
      </ScrollArea>
    </div>
  );
}

function OverallView({ topology, vms, threatHosts, onSelectHost }: LiveStatsProps) {
  const total = vms.length;
  const running = vms.filter((v) => v.state === "running").length;
  const stopped = vms.filter((v) => v.state === "poweroff" || v.state === "aborted").length;
  const unknown = total - running - stopped;

  const topPorts = React.useMemo(() => {
    if (!topology) return [];
    const counts = new Map<number, { count: number; protocol: string }>();
    for (const e of topology.edges) {
      if (e.port == null) continue;
      const v = counts.get(e.port) ?? { count: 0, protocol: e.protocol };
      v.count += 1;
      counts.set(e.port, v);
    }
    return [...counts.entries()]
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 6)
      .map(([port, v]) => ({ port, ...v }));
  }, [topology]);

  return (
    <div className="space-y-3">
      <section>
        <p className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
          Connections
        </p>
        <div className="grid grid-cols-2 gap-1 text-xs">
          <StatRow label="Normal" value={running} accent="bg-emerald-500" />
          <StatRow label="Stopped" value={stopped} accent="bg-slate-400" />
          <StatRow label="Unknown" value={unknown} accent="bg-slate-300" />
          <StatRow label="Breached" value={threatHosts.size} accent="bg-red-500" />
        </div>
      </section>

      {topPorts.length > 0 && (
        <section>
          <p className="mb-1 flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground">
            <Cable className="h-3 w-3" /> Top ports
          </p>
          <div className="space-y-0.5">
            {topPorts.map(({ port, count, protocol }) => (
              <div key={port} className="flex items-center gap-2 text-xs">
                <code className="rounded bg-muted px-1 font-mono">{port}</code>
                <Badge variant="outline" className="text-[10px] uppercase">
                  {protocol}
                </Badge>
                <span className="ml-auto tabular-nums text-muted-foreground">×{count}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      <section>
        <div className="mb-1 flex items-center justify-between">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
            Devices ({total})
          </p>
          <Badge variant="secondary" className="text-[10px]">
            {running}/{total} up
          </Badge>
        </div>
        <div className="space-y-0.5">
          {vms.length === 0 && (
            <p className="text-[10px] text-muted-foreground">
              Awaiting heartbeat from the agent.
            </p>
          )}
          {vms.map((vm) => (
            <button
              key={vm.hostname}
              type="button"
              onClick={() => onSelectHost?.(vm.hostname)}
              className={cn(
                "flex w-full items-center gap-2 rounded px-1.5 py-1 text-xs transition-colors hover:bg-accent/40",
                threatHosts.has(vm.hostname) && "bg-red-500/10 hover:bg-red-500/20",
              )}
            >
              <span
                className={cn(
                  "h-2 w-2 shrink-0 rounded-full",
                  STATE_COLOR[vm.state] ?? STATE_COLOR.unknown,
                )}
              />
              <Server className="h-3 w-3 shrink-0 text-muted-foreground" />
              <span className="truncate font-medium">{vm.hostname}</span>
              {vm.ip && (
                <code className="ml-auto rounded bg-muted px-1 font-mono text-[10px] tabular-nums">
                  {vm.ip}
                </code>
              )}
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

function DeviceDrilldown({
  topology,
  vms,
  threatHosts,
  events,
  hostname,
  onSelectHost,
}: LiveStatsProps & { hostname: string }) {
  const vm = vms.find((v) => v.hostname === hostname);
  const node = topology?.nodes.find((n) => n.config.hostname === hostname);
  const hostEvents = React.useMemo(
    () => events.filter((e) => e.hostname === hostname).slice(0, 12),
    [events, hostname],
  );

  // Edges touching this node
  const edges = React.useMemo(() => {
    if (!topology || !node) return [];
    return topology.edges
      .filter((e) => e.source === node.id || e.target === node.id)
      .map((e) => {
        const otherId = e.source === node.id ? e.target : e.source;
        const other = topology.nodes.find((n) => n.id === otherId);
        return {
          id: e.id,
          direction: e.source === node.id ? "→" : "←",
          peer: other?.config.hostname ?? otherId,
          protocol: e.protocol,
          port: e.port,
          label: e.label,
        };
      });
  }, [topology, node]);

  const vendorBadges = React.useMemo(() => {
    if (!node) return [];
    const out: string[] = [];
    const seen = new Set<string>();
    for (const role of node.config.roles) {
      const entry = lookupVendor(role);
      if (entry && !seen.has(entry.id)) {
        seen.add(entry.id);
        out.push(entry.id);
      }
    }
    return out;
  }, [node]);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Server className="h-4 w-4 text-foreground" />
        <p className="truncate font-mono text-sm font-semibold">{hostname}</p>
        <Button
          variant="ghost"
          size="icon"
          className="ml-auto h-6 w-6"
          onClick={() => onSelectHost?.(null)}
          aria-label="Clear focus"
        >
          <X className="h-3 w-3" />
        </Button>
      </div>

      <div className="flex flex-wrap gap-1.5">
        <Badge
          variant="outline"
          className={cn(
            "text-[10px]",
            threatHosts.has(hostname) && "border-red-500 text-red-500",
          )}
        >
          {threatHosts.has(hostname) && <ShieldAlert className="mr-1 h-3 w-3" />}
          {vm?.state ?? "unknown"}
        </Badge>
        {node && (
          <Badge variant="outline" className="text-[10px]">
            {node.type.replace("_", " ")}
          </Badge>
        )}
        {node && (
          <Badge variant="outline" className="text-[10px]">
            {OS_LABELS[node.config.os]}
          </Badge>
        )}
      </div>

      <div className="space-y-1 rounded-md border bg-background/50 p-2 text-xs">
        <Field icon={Globe} label="IP">
          <code className="rounded bg-muted px-1 font-mono">
            {vm?.ip ?? node?.config.ip ?? "—"}
          </code>
        </Field>
        {node && (
          <>
            <Field icon={Network} label="Gateway">
              <code className="rounded bg-muted px-1 font-mono">
                {node.config.gateway ?? "—"}
              </code>
            </Field>
            <Field icon={Cpu} label="Compute">
              {node.config.cpus} vCPU · {(node.config.memory_mb / 1024).toFixed(1)} GB
            </Field>
            <Field icon={KeyRound} label="Login">
              <code className="rounded bg-muted px-1 font-mono">
                {node.config.credentials.username}
              </code>
            </Field>
          </>
        )}
      </div>

      {vendorBadges.length > 0 && (
        <section>
          <p className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
            Services
          </p>
          <div className="flex flex-wrap gap-1">
            {vendorBadges.map((id) => {
              const entry = lookupVendor(id);
              if (!entry) return null;
              return (
                <span
                  key={id}
                  className="flex items-center gap-1 rounded-md border bg-background/60 px-1.5 py-0.5 text-[10px]"
                  style={{ borderColor: entry.color + "55" }}
                >
                  <VendorIconInner entry={entry} size={11} />
                  {entry.label}
                </span>
              );
            })}
          </div>
        </section>
      )}

      {edges.length > 0 && (
        <section>
          <p className="mb-1 flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground">
            <Cable className="h-3 w-3" /> Connections ({edges.length})
          </p>
          <div className="space-y-0.5">
            {edges.map((e) => (
              <button
                key={e.id}
                type="button"
                onClick={() => onSelectHost?.(e.peer)}
                className="flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-xs hover:bg-accent/40"
              >
                <span className="font-mono text-muted-foreground">{e.direction}</span>
                <span className="truncate font-medium">{e.peer}</span>
                <Badge variant="outline" className="ml-auto text-[10px] uppercase">
                  {e.protocol}{e.port ? `:${e.port}` : ""}
                </Badge>
              </button>
            ))}
          </div>
        </section>
      )}

      <Separator />

      <section>
        <p className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
          Recent events ({hostEvents.length})
        </p>
        <div className="space-y-1">
          {hostEvents.length === 0 && (
            <p className="text-[10px] text-muted-foreground">No events for this host yet.</p>
          )}
          {hostEvents.map((e) => (
            <div
              key={e.id}
              className={cn(
                "rounded border bg-background/50 px-2 py-1 text-[11px]",
                e.severity === "alert" && "border-red-500/30 bg-red-500/5",
                e.severity === "warn" && "border-amber-500/30 bg-amber-500/5",
              )}
            >
              <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                <span className="font-mono tabular-nums">
                  {new Date(e.capturedAt).toLocaleTimeString()}
                </span>
                <Badge variant="outline" className="text-[9px] uppercase">
                  {e.category}
                </Badge>
                <span className="ml-auto uppercase">{e.severity}</span>
              </div>
              <p className="mt-0.5 break-words font-mono leading-relaxed">{e.message}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function StatRow({ label, value, accent }: { label: string; value: number; accent: string }) {
  return (
    <div className="flex items-center gap-1.5 rounded border bg-background/60 px-2 py-1">
      <span className={cn("h-2 w-2 rounded-full", accent)} />
      <span className="text-muted-foreground">{label}</span>
      <span className="ml-auto font-semibold tabular-nums">{value}</span>
    </div>
  );
}

function Field({
  icon: Icon,
  label,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2">
      <Icon className="h-3 w-3 text-muted-foreground" />
      <span className="text-muted-foreground">{label}</span>
      <span className="ml-auto">{children}</span>
    </div>
  );
}

// silence unused import warnings (HardDrive kept for future use)
void HardDrive;
