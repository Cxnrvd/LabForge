"use client";

import * as React from "react";
import { Activity, AlertTriangle, Boxes, Server } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

interface StatTile {
  label: string;
  value: string | number;
  Icon: React.ComponentType<{ className?: string }>;
  accent: string;
  hint?: string;
}

interface QuickStatsProps {
  topologies: number | null;
  labs: number | null;
  runningVms: number | null;
  alerts: number | null;
}

export function QuickStats({ topologies, labs, runningVms, alerts }: QuickStatsProps) {
  const tiles: StatTile[] = [
    { label: "Topologies", value: topologies ?? "—", Icon: Boxes, accent: "text-blue-500" },
    { label: "Active labs", value: labs ?? "—", Icon: Server, accent: "text-emerald-500" },
    { label: "Running VMs", value: runningVms ?? "—", Icon: Activity, accent: "text-purple-500" },
    { label: "Open alerts", value: alerts ?? "—", Icon: AlertTriangle, accent: "text-orange-500" },
  ];

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {tiles.map(({ label, value, Icon, accent }) => (
        <Card key={label}>
          <CardContent className="flex items-center justify-between gap-3 p-4">
            <div className="min-w-0">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                {label}
              </p>
              {value === "—" ? (
                <Skeleton className="mt-1 h-7 w-12" />
              ) : (
                <p className="text-2xl font-semibold">{value}</p>
              )}
            </div>
            <Icon className={"h-7 w-7 " + accent} />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
