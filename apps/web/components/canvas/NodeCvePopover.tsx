"use client";

import * as React from "react";
import { ExternalLink, Loader2, Pin, ShieldAlert } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { lookupVendor, parseRole } from "@/lib/icons/catalog";
import { useRoleCves } from "@/lib/api/hooks";
import { useTopologyStore } from "@/lib/store/topology-store";

const SEVERITY_TONE: Record<string, string> = {
  CRITICAL: "bg-red-500/15 text-red-700 dark:text-red-300",
  HIGH: "bg-orange-500/15 text-orange-700 dark:text-orange-300",
  MEDIUM: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  LOW: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  NONE: "bg-muted text-muted-foreground",
};

interface NodeCvePopoverProps {
  nodeId: string;
  role: string;
  children: React.ReactNode;
}

export function NodeCvePopover({ nodeId, role, children }: NodeCvePopoverProps) {
  const [open, setOpen] = React.useState(false);
  const parsed = parseRole(role);
  const vendor = lookupVendor(role);
  const cves = useRoleCves(role, open);
  const updateNodeConfig = useTopologyStore((s) => s.updateNodeConfig);

  const handlePin = (cveId: string, e: React.MouseEvent): void => {
    e.stopPropagation();
    updateNodeConfig(nodeId, (n) => {
      if (n.config.cves.includes(cveId)) return n;
      return { ...n, config: { ...n.config, cves: [...n.config.cves, cveId] } };
    });
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="pointer-events-auto cursor-help"
          aria-label={`CVEs matching ${role}`}
          onClick={(e) => e.stopPropagation()}
        >
          {children}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={6}
        className="w-80 p-0"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b px-3 py-2">
          <ShieldAlert className="h-4 w-4 text-muted-foreground" />
          <p className="text-sm font-semibold">
            {vendor?.label ?? parsed.id}
            {parsed.version && (
              <span className="ml-1 font-mono text-xs text-muted-foreground">
                @{parsed.version}
              </span>
            )}
          </p>
        </div>

        {!parsed.version && (
          <p className="px-3 py-3 text-xs text-muted-foreground">
            Pin a version (e.g. <code className="rounded bg-muted px-1">apache@2.4.49</code>) to
            auto-fetch CVEs.
          </p>
        )}

        {parsed.version && cves.isLoading && (
          <div className="flex items-center gap-2 px-3 py-3 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" /> Searching NVD…
          </div>
        )}

        {parsed.version && cves.isError && (
          <p className="px-3 py-3 text-xs text-destructive">
            Could not reach the NVD search endpoint.
          </p>
        )}

        {parsed.version && cves.data && cves.data.length === 0 && (
          <p className="px-3 py-3 text-xs text-muted-foreground">
            No CVEs matched. Searches the NVD by name + version — narrow the version if needed.
          </p>
        )}

        {parsed.version && cves.data && cves.data.length > 0 && (
          <ul className="max-h-72 divide-y overflow-y-auto">
            {cves.data.map((c) => (
              <li key={c.id} className="space-y-1 px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <a
                    href={`https://nvd.nist.gov/vuln/detail/${c.id}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 font-mono text-xs font-semibold hover:underline"
                  >
                    {c.id} <ExternalLink className="h-3 w-3" />
                  </a>
                  <Badge className={SEVERITY_TONE[c.severity] ?? SEVERITY_TONE.NONE}>
                    {c.severity}
                    {c.cvss_score != null && (
                      <span className="ml-1 tabular-nums">{c.cvss_score.toFixed(1)}</span>
                    )}
                  </Badge>
                </div>
                <p className="line-clamp-2 text-[11px] text-muted-foreground">
                  {c.description}
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-6 px-2 text-[11px]"
                  onClick={(e) => handlePin(c.id, e)}
                >
                  <Pin className="mr-1 h-3 w-3" /> Pin to node
                </Button>
              </li>
            ))}
          </ul>
        )}

        <Separator />
        <p className="px-3 py-2 text-[10px] text-muted-foreground">
          Source: NIST NVD · cached for 1 hour
        </p>
      </PopoverContent>
    </Popover>
  );
}
