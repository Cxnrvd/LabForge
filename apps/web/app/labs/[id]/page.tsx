"use client";

import * as React from "react";
import { useParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { LiveCanvas } from "@/components/monitor/LiveCanvas";
import { EventLog } from "@/components/monitor/EventLog";
import { LiveStats } from "@/components/monitor/LiveStats";
import { MonitorHeader } from "@/components/monitor/MonitorHeader";
import { Timeline } from "@/components/monitor/Timeline";
import { eventsFromHeartbeats, hostsWithAlerts } from "@/lib/monitor/events";
import { api } from "@/lib/api/client";
import { useLiveBus, type LiveBusEvent } from "@/lib/api/live-bus";
import type { LabConfig } from "@labforge/schema";

interface Lab {
  id: number;
  name: string;
  topology_slug: string;
  provider: string;
  status: string;
  workspace_path?: string;
  updated_at: string;
}

interface Heartbeat {
  lab_status: string;
  vms: Array<{ hostname: string; state: string; ip?: string | null }>;
  log_tail: string[];
  flows?: Array<{
    src_ip: string;
    dst_ip: string;
    packets?: number;
    bytes_estimate?: number;
    protocol?: string | null;
  }>;
  captured_at?: string;
}

export default function LabMonitorPage() {
  const params = useParams<{ id: string }>();
  const id = Number(params?.id);
  const enabled = Number.isFinite(id);

  // Local UI state
  const [selectedHostname, setSelectedHostname] = React.useState<string | null>(null);
  const [paused, setPaused] = React.useState(false);

  // Esc clears the host focus.
  React.useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if (e.key === "Escape" && selectedHostname) setSelectedHostname(null);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [selectedHostname]);

  const labQ = useQuery<Lab>({
    queryKey: ["lab", id],
    queryFn: () => fetch(`/api/v1/labs/${id}`).then((r) => r.json()),
    enabled,
    refetchInterval: paused ? false : 8000,
  });
  const lab = labQ.data;

  const topologyQ = useQuery<LabConfig>({
    queryKey: ["lab-topology", lab?.topology_slug],
    queryFn: async () => {
      const slug = lab!.topology_slug;
      const stored = await fetch(`/api/v1/topologies/${slug}`);
      if (stored.ok) return stored.json();
      return api.getTemplate(slug);
    },
    enabled: !!lab?.topology_slug,
  });

  const qc = useQueryClient();

  // Live bus subscription. When the WebSocket is healthy each heartbeat
  // is pushed into the same query cache the polling fallback writes to,
  // so downstream consumers (LiveCanvas, LiveStats, Timeline) don't care
  // which source the data came from.
  const liveBus = useLiveBus(enabled ? id : null, {
    enabled: enabled && !paused,
    onEvent: React.useCallback(
      (ev: LiveBusEvent) => {
        if (ev.type !== "heartbeat") return;
        const data = ev.data as Heartbeat | undefined;
        if (!data) return;
        qc.setQueryData<Heartbeat>(["lab-heartbeat", id], data);
      },
      [id, qc],
    ),
  });

  // Polling fallback. While the bus is "open" we throttle polling to
  // 30s (insurance against a missed envelope); on error/closed we revert
  // to the original 4s cadence so users still see updates.
  const pollInterval = paused
    ? false
    : liveBus.status === "open"
      ? 30_000
      : 4_000;

  const hbQ = useQuery<Heartbeat>({
    queryKey: ["lab-heartbeat", id],
    queryFn: () => fetch(`/api/v1/labs/${id}/heartbeat`).then((r) => r.json()),
    enabled,
    refetchInterval: pollInterval,
  });

  const activityQ = useQuery<
    Array<{ lab_id: number; captured_at: string; log_snippet?: string | null }>
  >({
    queryKey: ["lab-activity"],
    queryFn: () => fetch("/api/v1/labs/activity/recent?limit=120").then((r) => r.json()),
    enabled,
    refetchInterval: paused ? false : 5000,
  });

  const events = React.useMemo(() => {
    if (!hbQ.data) return [];
    const ev = eventsFromHeartbeats({ heartbeats: [hbQ.data] });
    for (const a of activityQ.data ?? []) {
      if (a.lab_id !== id || !a.log_snippet) continue;
      ev.push({
        id: `act-${a.captured_at}-${a.lab_id}`,
        capturedAt: a.captured_at,
        severity: "info",
        category: "system",
        message: a.log_snippet,
      });
    }
    ev.sort((a, b) => (a.capturedAt < b.capturedAt ? 1 : -1));
    return ev;
  }, [hbQ.data, activityQ.data, id]);

  const threatHosts = React.useMemo(() => hostsWithAlerts(events), [events]);
  const vms = hbQ.data?.vms ?? [];

  // KPI roll-up
  const alertsCount = events.filter((e) => e.severity === "alert").length;
  const warnsCount = events.filter((e) => e.severity === "warn").length;
  const hostsUp = vms.filter((v) => v.state === "running").length;

  if (!enabled) {
    return <div className="p-6 text-sm text-destructive">Invalid lab id.</div>;
  }

  if (!lab || !topologyQ.data) {
    return (
      <div className="space-y-3 p-4">
        <Skeleton className="h-14 w-full" />
        <div className="grid grid-cols-12 gap-3">
          <Skeleton className="col-span-3 h-[60vh] w-full" />
          <Skeleton className="col-span-6 h-[60vh] w-full" />
          <Skeleton className="col-span-3 h-[60vh] w-full" />
        </div>
        <Skeleton className="h-20 w-full" />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <MonitorHeader
        labId={lab.id}
        labName={lab.name}
        provider={lab.provider}
        liveStatus={hbQ.data?.lab_status ?? lab.status}
        alerts={alertsCount}
        warns={warnsCount}
        hostsUp={hostsUp}
        hostsTotal={vms.length}
        paused={paused}
        onTogglePause={() => setPaused((p) => !p)}
        topologySlug={lab.topology_slug}
        capturedAt={hbQ.data?.captured_at ?? null}
      />

      <Tabs
        defaultValue="topology"
        className="flex min-h-0 flex-1 flex-col gap-2 p-3"
      >
        <TabsList className="self-start">
          <TabsTrigger value="topology">Topology</TabsTrigger>
          <TabsTrigger value="events">
            Events
            {events.length > 0 && (
              <span className="ml-1.5 rounded-full bg-muted-foreground/15 px-1.5 text-[10px] tabular-nums">
                {events.length}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="stats">Stats</TabsTrigger>
        </TabsList>

        <TabsContent value="topology" className="m-0 min-h-0 flex-1 outline-none">
          <div className="grid h-full min-h-0 grid-cols-12 gap-3">
            <div className="col-span-9 h-full min-h-0 overflow-hidden rounded-lg border bg-card/40 shadow-sm">
              <LiveCanvas
                topology={topologyQ.data}
                vms={vms}
                threatHosts={threatHosts}
                selectedHostname={selectedHostname}
                onSelectHost={setSelectedHostname}
                flows={hbQ.data?.flows ?? []}
              />
            </div>
            <div className="col-span-3 h-full min-h-0">
              <LiveStats
                topology={topologyQ.data}
                vms={vms}
                events={events}
                capturedAt={hbQ.data?.captured_at ?? null}
                threatHosts={threatHosts}
                selectedHostname={selectedHostname}
                onSelectHost={setSelectedHostname}
              />
            </div>
          </div>
        </TabsContent>

        <TabsContent value="events" className="m-0 min-h-0 flex-1 outline-none">
          <div className="h-full min-h-0">
            <EventLog
              events={events}
              selectedHostname={selectedHostname}
              onSelectHost={setSelectedHostname}
            />
          </div>
        </TabsContent>

        <TabsContent value="stats" className="m-0 min-h-0 flex-1 outline-none">
          <div className="h-full min-h-0">
            <LiveStats
              topology={topologyQ.data}
              vms={vms}
              events={events}
              capturedAt={hbQ.data?.captured_at ?? null}
              threatHosts={threatHosts}
              selectedHostname={selectedHostname}
              onSelectHost={setSelectedHostname}
            />
          </div>
        </TabsContent>
      </Tabs>

      {/* Timeline persists across tabs — gives temporal context regardless
          of which view is active. */}
      <div className="h-[96px] shrink-0 p-3 pt-0">
        <Timeline events={events} />
      </div>
    </div>
  );
}
