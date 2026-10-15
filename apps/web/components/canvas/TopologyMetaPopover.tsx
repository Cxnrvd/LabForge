"use client";

import * as React from "react";
import { AlertCircle, Network, Settings2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useTopologyStore } from "@/lib/store/topology-store";
import { cn } from "@/lib/utils/cn";

const CIDR_REGEX =
  /^(?:(?:25[0-5]|2[0-4]\d|[01]?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d?\d)\/(?:3[0-2]|[12]?\d)$/;

type Provider = "virtualbox" | "vmware" | "libvirt";

const PROVIDER_LABELS: Record<Provider, string> = {
  virtualbox: "VirtualBox",
  vmware: "VMware (Workstation/Fusion)",
  libvirt: "libvirt / KVM",
};

/**
 * Topology-level meta editor exposed next to the lab name in the toolbar.
 * Lets the user set the network CIDR and provider without dipping into a
 * template or hand-editing the topology JSON — the two fields the rest
 * of the canvas defaults already lock you into.
 *
 * Client-side CIDR validation mirrors the Pydantic ``_CIDR_RE`` in
 * ``packages/schema/python/labforge_schema/topology.py`` so the user
 * gets immediate feedback before hitting Build (which would 422
 * server-side for the same reason).
 */
export function TopologyMetaPopover() {
  const meta = useTopologyStore((s) => s.meta);
  const setMeta = useTopologyStore((s) => s.setMeta);

  const [cidrDraft, setCidrDraft] = React.useState(meta.network_cidr);
  const [open, setOpen] = React.useState(false);

  // Reset the draft when the popover re-opens — otherwise a user who
  // typed an invalid CIDR, closed without saving, and reopened, would
  // see their stale invalid string.
  React.useEffect(() => {
    if (open) setCidrDraft(meta.network_cidr);
  }, [open, meta.network_cidr]);

  const cidrValid = CIDR_REGEX.test(cidrDraft);
  const cidrChanged = cidrDraft !== meta.network_cidr;

  const commitCidr = (): void => {
    if (cidrValid && cidrChanged) {
      setMeta({ network_cidr: cidrDraft });
    } else if (!cidrValid) {
      // Snap back to last good value so the canvas store never holds an
      // invalid CIDR — the IP-allocation helper assumes a valid mask.
      setCidrDraft(meta.network_cidr);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              aria-label="Topology settings (CIDR + provider)"
            >
              <Settings2 className="h-4 w-4" />
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>Network &amp; provider</TooltipContent>
      </Tooltip>
      <PopoverContent align="start" className="w-72 space-y-3 p-3">
        <div>
          <p className="text-xs font-semibold text-foreground">Topology settings</p>
          <p className="text-[11px] text-muted-foreground">
            Applied to every node in this lab. Existing node IPs aren&apos;t auto-rewritten.
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="meta-cidr" className="flex items-center gap-1.5 text-[11px]">
            <Network className="h-3 w-3" />
            Network CIDR
          </Label>
          <Input
            id="meta-cidr"
            value={cidrDraft}
            onChange={(e) => setCidrDraft(e.target.value)}
            onBlur={commitCidr}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                commitCidr();
                setOpen(false);
              }
            }}
            placeholder="192.168.56.0/24"
            spellCheck={false}
            className={cn(
              "h-8 font-mono text-xs",
              !cidrValid && "border-destructive focus-visible:ring-destructive",
            )}
            aria-invalid={!cidrValid}
          />
          <p
            className={cn(
              "flex items-start gap-1 text-[10px]",
              cidrValid ? "text-muted-foreground" : "text-destructive",
            )}
          >
            {!cidrValid && <AlertCircle className="mt-px h-3 w-3 shrink-0" />}
            <span>
              {cidrValid
                ? "All node IPs must fall inside this range."
                : "Invalid CIDR — e.g. 10.0.0.0/16 or 192.168.56.0/24"}
            </span>
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="meta-provider" className="text-[11px]">
            Provider
          </Label>
          <Select
            value={meta.provider}
            onValueChange={(v: Provider) => setMeta({ provider: v })}
          >
            <SelectTrigger id="meta-provider" className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(PROVIDER_LABELS) as Provider[]).map((p) => (
                <SelectItem key={p} value={p} className="text-xs">
                  {PROVIDER_LABELS[p]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-[10px] text-muted-foreground">
            Vagrant runs <code>vagrant up --provider {meta.provider === "vmware" ? "vmware_desktop" : meta.provider}</code>.
          </p>
        </div>
      </PopoverContent>
    </Popover>
  );
}
