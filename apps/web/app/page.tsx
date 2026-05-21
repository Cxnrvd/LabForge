"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";

import { ActiveLabsList } from "@/components/dashboard/ActiveLabsList";
import { ActivityFeed } from "@/components/dashboard/ActivityFeed";
import { CveFeed } from "@/components/dashboard/CveFeed";
import { NetworkFlowSankey } from "@/components/dashboard/NetworkFlowSankey";
import { QuickStats } from "@/components/dashboard/QuickStats";
import { SavedTopologiesGrid } from "@/components/dashboard/SavedTopologiesGrid";
import { TopologiesGrid } from "@/components/dashboard/TopologiesGrid";

interface Lab {
  id: number;
  name: string;
  status: string;
}
interface Heartbeat {
  lab_status: string;
  vms: Array<{ state: string }>;
}
interface TemplateSummary {
  id: string;
  name: string;
  node_count: number;
  edge_count: number;
}

export default function MissionControl() {
  const { data: labs } = useQuery<Lab[]>({
    queryKey: ["labs"],
    queryFn: () => fetch("/api/v1/labs").then((r) => r.json()),
    refetchInterval: 5000,
  });
  const { data: templates } = useQuery<TemplateSummary[]>({
    queryKey: ["templates"],
    queryFn: () => fetch("/api/v1/templates").then((r) => r.json()),
  });

  // Aggregate running VM counts across the latest heartbeat per active lab.
  const activeLabIds = (labs ?? [])
    .filter((l) => l.status === "running" || l.status === "partial")
    .map((l) => l.id);

  const heartbeats = useQuery<Record<number, Heartbeat>>({
    queryKey: ["heartbeats", activeLabIds],
    queryFn: async () => {
      const entries = await Promise.all(
        activeLabIds.map(async (id) => {
          const hb = (await fetch(`/api/v1/labs/${id}/heartbeat`).then((r) =>
            r.json(),
          )) as Heartbeat;
          return [id, hb] as const;
        }),
      );
      return Object.fromEntries(entries);
    },
    enabled: activeLabIds.length > 0,
    refetchInterval: 5000,
  });

  const runningVms = React.useMemo(() => {
    if (!heartbeats.data) return 0;
    let sum = 0;
    for (const hb of Object.values(heartbeats.data)) {
      sum += hb.vms.filter((v) => v.state === "running").length;
    }
    return sum;
  }, [heartbeats.data]);

  const activeLabs = (labs ?? []).filter(
    (l) => l.status === "running" || l.status === "partial",
  ).length;

  return (
    <div className="space-y-4 p-6">
      <header>
        <h2 className="text-xl font-semibold tracking-tight">Mission Control</h2>
        <p className="text-sm text-muted-foreground">
          What&apos;s built, what&apos;s running, what&apos;s talking. All your labs at a glance.
        </p>
      </header>

      <QuickStats
        topologies={templates?.length ?? null}
        labs={activeLabs}
        runningVms={runningVms}
        alerts={0}
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <ActiveLabsList />
          <SavedTopologiesGrid />
          <TopologiesGrid />
          <NetworkFlowSankey />
        </div>
        <div className="space-y-4">
          <ActivityFeed />
          <CveFeed />
        </div>
      </div>
    </div>
  );
}
