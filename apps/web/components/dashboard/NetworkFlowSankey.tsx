"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Cable } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { LabConfig } from "@labforge/schema";

interface TemplateSummary {
  id: string;
  name: string;
  edge_count: number;
}

/**
 * v1: render the most-connected nodes from saved topologies as a
 * top-talkers table rather than a full sankey. Wire to live tcpdump in v2.
 */
export function NetworkFlowSankey() {
  const { data: templates, isLoading: tLoading } = useQuery<TemplateSummary[]>({
    queryKey: ["templates"],
    queryFn: () => fetch("/api/v1/templates").then((r) => r.json()),
  });

  const { data: topologies } = useQuery<LabConfig[]>({
    queryKey: ["topologies-full", templates?.map((t) => t.id)],
    queryFn: async () => {
      if (!templates) return [];
      const all = await Promise.all(
        templates.map((t) =>
          fetch(`/api/v1/templates/${t.id}`).then((r) => r.json() as Promise<LabConfig>),
        ),
      );
      return all;
    },
    enabled: !!templates,
  });

  // Compute degree (in+out) per (lab, host)
  const rows = React.useMemo(() => {
    if (!topologies) return [] as Array<{
      lab: string;
      host: string;
      protocol: string;
      degree: number;
    }>;
    const out: Array<{ lab: string; host: string; protocol: string; degree: number }> = [];
    for (const t of topologies) {
      const counts = new Map<string, number>();
      for (const e of t.edges) {
        counts.set(e.source, (counts.get(e.source) ?? 0) + 1);
        counts.set(e.target, (counts.get(e.target) ?? 0) + 1);
      }
      for (const [host, degree] of counts) {
        const node = t.nodes.find((n) => n.id === host);
        if (!node) continue;
        const proto = t.edges.find((e) => e.source === host || e.target === host)?.protocol ?? "tcp";
        out.push({ lab: t.name, host: node.config.hostname, protocol: proto, degree });
      }
    }
    out.sort((a, b) => b.degree - a.degree);
    return out.slice(0, 12);
  }, [topologies]);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Cable className="h-4 w-4" /> Top edges
        </CardTitle>
        <CardDescription className="text-xs">
          Hosts with the most connections across saved topologies. v2 will swap this for
          live tcpdump flows.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {tLoading && <Skeleton className="h-32 w-full" />}
        {!tLoading && (
          <ScrollArea className="h-[180px]">
            <table className="w-full text-xs">
              <thead className="text-muted-foreground">
                <tr>
                  <th className="text-left font-medium">Lab</th>
                  <th className="text-left font-medium">Host</th>
                  <th className="text-left font-medium">Edges</th>
                  <th className="text-left font-medium">Proto</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className="border-t">
                    <td className="py-1 pr-2 text-muted-foreground">{r.lab}</td>
                    <td className="py-1 pr-2 font-medium">{r.host}</td>
                    <td className="py-1 pr-2">
                      <Badge variant="secondary" className="text-[10px]">
                        {r.degree}
                      </Badge>
                    </td>
                    <td className="py-1 pr-2">
                      <Badge variant="outline" className="text-[10px] uppercase">
                        {r.protocol}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}
