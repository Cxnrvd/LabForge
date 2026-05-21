"use client";

import * as React from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Server } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/ui/status-badge";
import { DeleteLabButton } from "@/components/labs/DeleteLabButton";

interface Lab {
  id: number;
  name: string;
  topology_slug: string;
  provider: string;
  status: string;
  updated_at: string;
}

export default function LabsIndex() {
  const { data, isLoading } = useQuery<Lab[]>({
    queryKey: ["labs"],
    queryFn: () => fetch("/api/v1/labs").then((r) => r.json()),
    refetchInterval: 5000,
  });

  return (
    <div className="space-y-4 p-6">
      <header>
        <h2 className="flex items-center gap-2 text-xl font-semibold">
          <Server className="h-5 w-5" /> Labs
        </h2>
        <p className="text-sm text-muted-foreground">
          Every lab the agent has registered. Click one for live VM status and logs.
        </p>
      </header>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Registered labs</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {isLoading && [0, 1].map((i) => <Skeleton key={i} className="h-14 w-full" />)}
          {!isLoading && (!data || data.length === 0) && (
            <div className="space-y-3 rounded-md border border-dashed p-8 text-center">
              <Server className="mx-auto h-8 w-8 text-muted-foreground/40" />
              <div>
                <p className="text-sm font-medium">No labs yet</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Build one from the canvas, or run{" "}
                  <code className="rounded bg-muted px-1">labforge run &lt;topology.json&gt;</code>{" "}
                  from the CLI.
                </p>
              </div>
              <div className="flex justify-center gap-2">
                <Link
                  href="/build"
                  className="inline-flex h-8 items-center gap-1 rounded-md border bg-background px-3 text-xs font-medium hover:bg-accent"
                >
                  Open builder
                </Link>
                <Link
                  href="/templates"
                  className="inline-flex h-8 items-center gap-1 rounded-md border bg-background px-3 text-xs font-medium hover:bg-accent"
                >
                  Browse templates
                </Link>
              </div>
            </div>
          )}
          {data?.map((lab) => (
            <div
              key={lab.id}
              className="group flex items-center gap-2 rounded-md border bg-card p-3 transition-colors hover:bg-accent/40"
            >
              <Link
                href={`/labs/${lab.id}`}
                className="flex min-w-0 flex-1 items-center gap-2"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{lab.name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    <code className="rounded bg-muted px-1">{lab.topology_slug}</code>{" "}
                    · updated {new Date(lab.updated_at).toLocaleString()}
                  </p>
                </div>
                <Badge variant="outline" className="text-[10px]">
                  {lab.provider}
                </Badge>
                <StatusBadge state={lab.status} size="sm" />
              </Link>
              <DeleteLabButton
                labId={lab.id}
                labName={lab.name}
                className="h-8 w-8 text-muted-foreground opacity-60 transition-opacity hover:text-destructive group-hover:opacity-100"
              />
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
