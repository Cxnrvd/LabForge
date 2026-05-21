"use client";

import * as React from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, Cpu, PlayCircle, Square, StopCircle } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/ui/status-badge";

interface Lab {
  id: number;
  name: string;
  topology_slug: string;
  provider: string;
  status: string;
  updated_at: string;
}

interface VmState {
  hostname: string;
  state: string;
  ip?: string | null;
}

interface Heartbeat {
  lab_status: string;
  vms: VmState[];
  log_tail: string[];
  captured_at?: string;
}

/* status colour now resolved through <StatusBadge> */

export function ActiveLabsList() {
  const { data: labs, isLoading } = useQuery<Lab[]>({
    queryKey: ["labs"],
    queryFn: () => fetch("/api/v1/labs").then((r) => r.json()),
    refetchInterval: 5000,
  });

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Active labs</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {[0, 1].map((i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Active labs</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {(!labs || labs.length === 0) && (
          <p className="rounded-md border border-dashed p-4 text-center text-xs text-muted-foreground">
            No labs registered yet. Run{" "}
            <code className="rounded bg-muted px-1 py-0.5">labforge run &lt;topology.json&gt;</code>{" "}
            to provision one.
          </p>
        )}
        {labs?.map((lab) => <LabRow key={lab.id} lab={lab} />)}
      </CardContent>
    </Card>
  );
}

function LabRow({ lab }: { lab: Lab }) {
  const { data: hb } = useQuery<Heartbeat>({
    queryKey: ["heartbeat", lab.id],
    queryFn: () =>
      fetch(`/api/v1/labs/${lab.id}/heartbeat`).then((r) => r.json()),
    refetchInterval: 5000,
  });

  const running = hb?.vms.filter((v) => v.state === "running").length ?? 0;
  const total = hb?.vms.length ?? 0;
  const status = hb?.lab_status ?? lab.status;

  return (
    <div className="flex items-center gap-3 rounded-md border bg-card p-3 transition-colors hover:bg-accent/40">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-sm font-semibold">{lab.name}</p>
          <Badge variant="outline" className="text-[10px]">{lab.provider}</Badge>
          <StatusBadge state={status} size="sm" />
        </div>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">
          <Cpu className="mr-1 inline h-3 w-3" />
          {running} / {total} VMs running · slug{" "}
          <code className="rounded bg-muted px-1">{lab.topology_slug}</code>
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Button asChild variant="ghost" size="sm" className="h-7">
          <Link href={`/labs/${lab.id}`}>
            <PlayCircle className="mr-1 h-3.5 w-3.5" />
            Monitor
          </Link>
        </Button>
        <Button asChild variant="outline" size="sm" className="h-7">
          <Link href={`/build/${lab.topology_slug}`}>
            <Square className="mr-1 h-3.5 w-3.5" />
            Open
          </Link>
        </Button>
        <span className="hidden text-muted-foreground md:inline">
          <ChevronRight className="h-4 w-4" />
        </span>
      </div>
    </div>
  );
}
