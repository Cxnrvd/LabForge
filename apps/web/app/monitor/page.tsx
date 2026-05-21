"use client";

import * as React from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Activity, ArrowRight, Hammer } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/ui/status-badge";

interface Lab {
  id: number;
  name: string;
  topology_slug: string;
  provider: string;
  status: string;
  workspace_path?: string | null;
  updated_at: string;
}

export default function MonitorIndex() {
  const { data, isLoading } = useQuery<Lab[]>({
    queryKey: ["labs"],
    queryFn: () => fetch("/api/v1/labs").then((r) => r.json()),
    refetchInterval: 4000,
  });

  const building = (data ?? []).filter(
    (l) => l.status === "building" || l.status === "pending",
  );
  const recent = (data ?? [])
    .filter((l) => l.status !== "building" && l.status !== "pending")
    .slice(0, 8);

  return (
    <div className="space-y-4 p-6">
      <header>
        <h2 className="flex items-center gap-2 text-xl font-semibold">
          <Activity className="h-5 w-5" /> Monitor
        </h2>
        <p className="text-sm text-muted-foreground">
          Live view of in-progress builds and recent labs. Click a row for the streaming{" "}
          <code className="rounded bg-muted px-1">vagrant up</code> log.
        </p>
      </header>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Hammer className="h-4 w-4" /> Building now
          </CardTitle>
          <CardDescription>
            Trigger a build from the canvas with <strong>Build Lab</strong>.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {isLoading && <Skeleton className="h-12 w-full" />}
          {!isLoading && building.length === 0 && (
            <div className="rounded-md border border-dashed p-8 text-center">
              <Hammer className="mx-auto h-8 w-8 text-muted-foreground/40" />
              <p className="mt-2 text-sm font-medium">No builds in progress</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Open the canvas, drop a topology, click <strong>Build Lab</strong> — the live{" "}
                <code className="rounded bg-muted px-1">vagrant up</code> log streams here.
              </p>
              <Link
                href="/build"
                className="mt-3 inline-flex h-8 items-center gap-1 rounded-md border bg-background px-3 text-xs font-medium hover:bg-accent"
              >
                Open builder
              </Link>
            </div>
          )}
          {building.map((lab) => (
            <BuildRow key={lab.id} lab={lab} active />
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Recent labs</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {isLoading && <Skeleton className="h-12 w-full" />}
          {!isLoading && recent.length === 0 && (
            <p className="rounded-md border border-dashed p-6 text-center text-xs text-muted-foreground">
              No labs registered yet.
            </p>
          )}
          {recent.map((lab) => (
            <BuildRow key={lab.id} lab={lab} />
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function BuildRow({ lab }: { lab: Lab; active?: boolean }) {
  return (
    <Link
      href={`/monitor/${lab.id}`}
      className="flex items-center gap-2 rounded-md border bg-card p-3 transition-colors hover:bg-accent/40"
    >
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold">{lab.name}</p>
        <p className="truncate text-xs text-muted-foreground">
          <code className="rounded bg-muted px-1">{lab.topology_slug}</code>{" "}
          · {new Date(lab.updated_at).toLocaleString()}
        </p>
      </div>
      <StatusBadge state={lab.status} />
      <Button variant="ghost" size="icon" className="h-8 w-8" asChild>
        <span>
          <ArrowRight className="h-3.5 w-3.5" />
        </span>
      </Button>
    </Link>
  );
}
