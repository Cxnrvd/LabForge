"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { ShieldAlert } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { api } from "@/lib/api/client";
import type { CVEEntry } from "@labforge/schema";

const SEVERITY_VARIANT: Record<string, "critical" | "high" | "medium" | "low" | "outline"> = {
  CRITICAL: "critical",
  HIGH: "high",
  MEDIUM: "medium",
  LOW: "low",
  NONE: "outline",
};

export function CveFeed() {
  // We don't have a "recent" NVD endpoint wired in; instead surface a few
  // headline CVE queries so the dashboard always has something live.
  const { data, isLoading, isError } = useQuery<CVEEntry[]>({
    queryKey: ["cve-feed"],
    queryFn: async () => {
      const results = await api.searchCves("remote code execution", 12);
      return results;
    },
    staleTime: 60 * 60 * 1000, // 1h
  });

  return (
    <Card className="h-[420px] overflow-hidden">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <ShieldAlert className="h-4 w-4 text-red-500" /> NVD feed
        </CardTitle>
      </CardHeader>
      <CardContent className="h-[360px] p-0">
        <ScrollArea className="h-full px-4 pb-4">
          {isLoading && (
            <div className="space-y-2">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-14 w-full" />
              ))}
            </div>
          )}
          {isError && (
            <p className="py-6 text-center text-xs text-destructive">
              NVD upstream unreachable.
            </p>
          )}
          {data?.map((c) => (
            <div key={c.id} className="border-b py-2 last:border-b-0">
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs font-semibold">{c.id}</span>
                <Badge
                  variant={SEVERITY_VARIANT[c.severity] ?? "outline"}
                  className="text-[10px]"
                >
                  {c.severity}
                </Badge>
                {c.cvss_score != null && (
                  <Badge variant="outline" className="text-[10px]">
                    CVSS {c.cvss_score.toFixed(1)}
                  </Badge>
                )}
              </div>
              <p className="mt-1 line-clamp-2 text-[11px] text-muted-foreground">
                {c.description}
              </p>
            </div>
          ))}
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
