"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Activity } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";

interface ActivityEntry {
  lab_id: number;
  lab_name: string;
  captured_at: string;
  lab_status: string;
  running_vms: number;
  total_vms: number;
  log_snippet: string | null;
}

function timeAgo(iso: string): string {
  const now = Date.now();
  const then = new Date(iso).getTime();
  const sec = Math.max(0, Math.round((now - then) / 1000));
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.round(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.round(sec / 3600)}h ago`;
  return `${Math.round(sec / 86400)}d ago`;
}

export function ActivityFeed() {
  const { data, isLoading } = useQuery<ActivityEntry[]>({
    queryKey: ["activity"],
    queryFn: () => fetch("/api/v1/labs/activity/recent").then((r) => r.json()),
    refetchInterval: 5000,
  });

  return (
    <Card className="h-[420px] overflow-hidden">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Activity className="h-4 w-4" /> Activity feed
        </CardTitle>
      </CardHeader>
      <CardContent className="h-[360px] p-0">
        <ScrollArea className="h-full px-4 pb-4">
          {isLoading && (
            <div className="space-y-2">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          )}
          {!isLoading && (!data || data.length === 0) && (
            <p className="py-6 text-center text-xs text-muted-foreground">
              No telemetry yet. Bring up a lab to populate this feed.
            </p>
          )}
          {data?.map((e, idx) => (
            <div
              key={`${e.lab_id}-${e.captured_at}-${idx}`}
              className="flex items-start gap-2 border-b py-2 last:border-b-0"
            >
              <span className="mt-1 inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-xs">
                  <span className="font-medium">{e.lab_name}</span>
                  <Badge variant="outline" className="text-[10px] capitalize">
                    {e.lab_status}
                  </Badge>
                  <span className="text-muted-foreground">
                    {e.running_vms}/{e.total_vms} VMs
                  </span>
                  <span className="ml-auto text-muted-foreground">
                    {timeAgo(e.captured_at)}
                  </span>
                </div>
                {e.log_snippet && (
                  <p className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">
                    {e.log_snippet}
                  </p>
                )}
              </div>
            </div>
          ))}
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
