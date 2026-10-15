"use client";

import * as React from "react";
import { Activity, Server } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useLabStream } from "@/lib/api/ws";

interface VmState {
  hostname: string;
  state: string;
  ip?: string | null;
}

interface MobileViewerProps {
  labId: number;
  labName: string;
  initial?: { vms?: VmState[]; log_tail?: string[]; lab_status?: string };
}

/**
 * Read-only mobile / tablet renderer for the monitor view. Replaces the
 * React Flow canvas (too cramped on a 6" screen) with a list of VMs and
 * a tail of the build log. Subscribes to the live WebSocket so the page
 * stays current without polling.
 */
export function MobileViewer({ labId, labName, initial }: MobileViewerProps) {
  const [vms, setVms] = React.useState<VmState[]>(initial?.vms ?? []);
  const [logTail, setLogTail] = React.useState<string[]>(initial?.log_tail ?? []);
  const [labStatus, setLabStatus] = React.useState(initial?.lab_status ?? "unknown");

  useLabStream({
    labId,
    onMessage: (m) => {
      if (m.type !== "heartbeat" || !m.data) return;
      const payload = m.data as {
        vms?: VmState[];
        log_tail?: string[];
        lab_status?: string;
      };
      if (payload.vms) setVms(payload.vms);
      if (payload.log_tail) setLogTail(payload.log_tail.slice(-30));
      if (payload.lab_status) setLabStatus(payload.lab_status);
    },
  });

  return (
    <div className="flex h-full flex-col gap-3 p-3">
      <header className="rounded-md border bg-card p-3">
        <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Lab</p>
        <h1 className="text-base font-semibold">{labName}</h1>
        <Badge variant="outline" className="mt-1 capitalize">
          {labStatus}
        </Badge>
      </header>

      <Card className="flex-1 overflow-hidden">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Server className="h-4 w-4" /> Hosts
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <ScrollArea className="h-[260px] px-3 pb-2">
            {vms.length === 0 ? (
              <p className="py-4 text-center text-xs text-muted-foreground">
                No VMs reported yet.
              </p>
            ) : (
              <ul className="space-y-1.5">
                {vms.map((vm) => (
                  <li
                    key={vm.hostname}
                    className="flex items-center justify-between rounded-md border px-2 py-1.5"
                  >
                    <div>
                      <p className="text-sm font-medium">{vm.hostname}</p>
                      {vm.ip && (
                        <p className="font-mono text-[10px] text-muted-foreground">
                          {vm.ip}
                        </p>
                      )}
                    </div>
                    <Badge
                      variant={vm.state === "running" ? "default" : "outline"}
                      className="capitalize"
                    >
                      {vm.state}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </ScrollArea>
        </CardContent>
      </Card>

      <Card className="flex-1 overflow-hidden">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Activity className="h-4 w-4" /> Log tail
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <ScrollArea className="h-[200px] px-3 pb-2">
            {logTail.length === 0 ? (
              <p className="py-4 text-center text-xs text-muted-foreground">No log yet.</p>
            ) : (
              <pre className="whitespace-pre-wrap break-words font-mono text-[10px] leading-snug text-muted-foreground">
                {logTail.join("\n")}
              </pre>
            )}
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}
