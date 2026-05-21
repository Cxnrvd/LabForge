"use client";

import * as React from "react";
import { Diff, GitCompare } from "lucide-react";
import { useQuery } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { api } from "@/lib/api/client";
import { useTopologyStore } from "@/lib/store/topology-store";
import { cn } from "@/lib/utils/cn";

interface Row {
  hostname: string;
  kind: "added" | "removed" | "modified" | "same";
  fields?: string[];
}

/**
 * Compare the live canvas to a saved template. Useful for "what did I
 * change vs the bundled red-team-range?" — the diff is field-level so
 * you see exactly which roles you added or which IPs drifted.
 */
export function TemplateDiffSheet({
  templateId,
  children,
}: {
  templateId: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(false);
  const toTopology = useTopologyStore((s) => s.toTopology);

  const tplQ = useQuery({
    queryKey: ["template", templateId, "for-diff"],
    queryFn: () => api.getTemplate(templateId),
    enabled: open,
  });

  const rows: Row[] = React.useMemo(() => {
    if (!tplQ.data) return [];
    const current = toTopology();
    const byHostCurrent = new Map(current.nodes.map((n) => [n.config.hostname, n]));
    const byHostTemplate = new Map(tplQ.data.nodes.map((n) => [n.config.hostname, n]));
    const all = new Set<string>([...byHostCurrent.keys(), ...byHostTemplate.keys()]);
    const out: Row[] = [];
    for (const host of all) {
      const cur = byHostCurrent.get(host);
      const tpl = byHostTemplate.get(host);
      if (cur && !tpl) {
        out.push({ hostname: host, kind: "added" });
      } else if (!cur && tpl) {
        out.push({ hostname: host, kind: "removed" });
      } else if (cur && tpl) {
        const changes: string[] = [];
        if (cur.config.ip !== tpl.config.ip) {
          changes.push(`ip: ${tpl.config.ip} → ${cur.config.ip}`);
        }
        if (cur.config.os !== tpl.config.os) {
          changes.push(`os: ${tpl.config.os} → ${cur.config.os}`);
        }
        const tplRoles = new Set(tpl.config.roles);
        const curRoles = new Set(cur.config.roles);
        for (const r of curRoles) if (!tplRoles.has(r)) changes.push(`+role ${r}`);
        for (const r of tplRoles) if (!curRoles.has(r)) changes.push(`-role ${r}`);
        const tplCves = new Set(tpl.config.cves);
        const curCves = new Set(cur.config.cves);
        for (const c of curCves) if (!tplCves.has(c)) changes.push(`+cve ${c}`);
        for (const c of tplCves) if (!curCves.has(c)) changes.push(`-cve ${c}`);
        out.push({
          hostname: host,
          kind: changes.length === 0 ? "same" : "modified",
          fields: changes,
        });
      }
    }
    return out.sort((a, b) => a.hostname.localeCompare(b.hostname));
  }, [tplQ.data, toTopology]);

  const counts = rows.reduce(
    (acc, row) => {
      acc[row.kind] += 1;
      return acc;
    },
    { added: 0, removed: 0, modified: 0, same: 0 },
  );

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <div onClick={() => setOpen(true)}>{children}</div>
      <SheetContent side="right" className="w-[420px] sm:w-[480px]">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <GitCompare className="h-4 w-4" /> vs <code>{templateId}</code>
          </SheetTitle>
          <p className="text-xs text-muted-foreground">
            {counts.added} added · {counts.removed} removed · {counts.modified} modified ·{" "}
            {counts.same} unchanged
          </p>
        </SheetHeader>
        <ScrollArea className="mt-3 h-[calc(100%-100px)] pr-2">
          <ul className="space-y-1.5">
            {rows.map((row) => (
              <li
                key={row.hostname}
                className={cn(
                  "rounded-md border p-2 text-xs",
                  row.kind === "added" && "border-emerald-500/40 bg-emerald-500/5",
                  row.kind === "removed" && "border-red-500/40 bg-red-500/5",
                  row.kind === "modified" && "border-amber-500/40 bg-amber-500/5",
                  row.kind === "same" && "opacity-60",
                )}
              >
                <div className="flex items-center justify-between">
                  <code className="text-xs font-medium">{row.hostname}</code>
                  <span className="text-[10px] uppercase tracking-wide">{row.kind}</span>
                </div>
                {row.fields && row.fields.length > 0 && (
                  <ul className="mt-1 space-y-0.5">
                    {row.fields.map((f, idx) => (
                      <li key={idx} className="font-mono text-[10px] text-muted-foreground">
                        {f}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
