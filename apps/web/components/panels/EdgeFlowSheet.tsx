"use client";

import * as React from "react";
import { Activity, Play } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import type { FlowSample } from "@/lib/monitor/events";

interface EdgeFlowSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  edgeLabel: string;
  flows: FlowSample[];
  /** Called when the user clicks "Start capture" — wire to the agent's
   *  tcpdump-capture endpoint. */
  onStartCapture?: () => void;
}

/**
 * Inline packet preview shown when the user clicks a live edge on the
 * monitor canvas. Displays the per-flow tcpdump samples that came in
 * with the latest heartbeat and offers a "Start capture" hook which the
 * agent surfaces as a real pcap.
 */
export function EdgeFlowSheet({
  open,
  onOpenChange,
  edgeLabel,
  flows,
  onStartCapture,
}: EdgeFlowSheetProps) {
  const total = flows.reduce(
    (acc, f) => {
      acc.packets += f.packets;
      acc.bytes += f.bytes_estimate;
      return acc;
    },
    { packets: 0, bytes: 0 },
  );

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-[420px]">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2 text-base">
            <Activity className="h-4 w-4" /> {edgeLabel}
          </SheetTitle>
          <p className="text-xs text-muted-foreground">
            {flows.length} flow{flows.length === 1 ? "" : "s"} in the last window ·{" "}
            {total.packets} pkts · {(total.bytes / 1024).toFixed(1)} KB
          </p>
        </SheetHeader>

        <div className="mt-4 flex items-center justify-between">
          <span className="text-xs font-medium">Recent flow samples</span>
          {onStartCapture && (
            <Button size="sm" onClick={onStartCapture}>
              <Play className="mr-1 h-3.5 w-3.5" /> Start capture
            </Button>
          )}
        </div>

        <ScrollArea className="mt-3 h-[calc(100%-160px)] pr-2">
          {flows.length === 0 ? (
            <p className="py-6 text-center text-xs text-muted-foreground">
              No traffic observed on this edge yet.
            </p>
          ) : (
            <ul className="space-y-1">
              {flows.map((f, idx) => (
                <li
                  key={idx}
                  className="flex items-center gap-2 rounded-md border bg-card/30 px-2 py-1.5 text-xs"
                >
                  <code className="truncate">{f.src_ip}</code>
                  <span className="text-muted-foreground">→</span>
                  <code className="truncate">{f.dst_ip}</code>
                  <span className="ml-auto flex items-center gap-1">
                    <Badge variant="outline" className="text-[10px] uppercase">
                      {f.protocol ?? "tcp"}
                    </Badge>
                    <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
                      {f.packets}p · {(f.bytes_estimate / 1024).toFixed(1)} KB
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
