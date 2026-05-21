"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Hammer,
  Pause,
  Play,
  RadioTower,
  ShieldAlert,
  TriangleAlert,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils/cn";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { StatusBadge } from "@/components/ui/status-badge";
import { DeleteLabButton } from "@/components/labs/DeleteLabButton";

interface MonitorHeaderProps {
  labId: number;
  labName: string;
  provider: string;
  liveStatus: string;
  alerts: number;
  warns: number;
  hostsUp: number;
  hostsTotal: number;
  paused: boolean;
  onTogglePause: () => void;
  topologySlug: string;
  capturedAt: string | null;
}

/* lab-status colour now resolved through <StatusBadge> */

export function MonitorHeader({
  labId,
  labName,
  provider,
  liveStatus,
  alerts,
  warns,
  hostsUp,
  hostsTotal,
  paused,
  onTogglePause,
  topologySlug,
  capturedAt,
}: MonitorHeaderProps) {
  const captured = capturedAt ? new Date(capturedAt) : null;
  const stale = captured ? Date.now() - captured.getTime() > 15_000 : true;
  const router = useRouter();

  return (
    <div className="flex h-14 shrink-0 items-center gap-3 border-b bg-card/60 px-3">
      <Button asChild variant="ghost" size="sm" className="h-8">
        <Link href="/">
          <ArrowLeft className="mr-1 h-4 w-4" />
          Back
        </Link>
      </Button>

      <div className="flex min-w-0 items-center gap-2">
        <RadioTower
          className={cn(
            "h-4 w-4",
            paused
              ? "text-muted-foreground"
              : stale
                ? "text-amber-500"
                : "text-emerald-500 animate-pulse",
          )}
        />
        <p className="truncate text-sm font-semibold">{labName}</p>
        <StatusBadge state={liveStatus} size="sm" />
        <Badge variant="outline" className="text-[10px]">
          {provider}
        </Badge>
      </div>

      <div className="ml-auto flex items-center gap-1.5">
        <KpiTile
          label="Alerts"
          value={alerts}
          tone={alerts > 0 ? "alert" : "neutral"}
          Icon={ShieldAlert}
        />
        <KpiTile
          label="Warns"
          value={warns}
          tone={warns > 0 ? "warn" : "neutral"}
          Icon={TriangleAlert}
        />
        <KpiTile
          label="Hosts"
          value={`${hostsUp}/${hostsTotal}`}
          tone={
            hostsTotal > 0 && hostsUp === hostsTotal
              ? "ok"
              : hostsUp === 0
                ? "alert"
                : "warn"
          }
        />

        <div className="mx-2 h-6 w-px bg-border" />

        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="outline" size="icon" className="h-8 w-8" onClick={onTogglePause}>
              {paused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{paused ? "Resume polling" : "Pause polling"}</TooltipContent>
        </Tooltip>

        <Button asChild variant="outline" size="sm" className="h-8">
          <Link href={`/build/${topologySlug}`}>
            <Hammer className="mr-1 h-3.5 w-3.5" />
            Builder
          </Link>
        </Button>

        <Tooltip>
          <TooltipTrigger asChild>
            <DeleteLabButton
              labId={labId}
              labName={labName}
              variant="outline"
              size="icon"
              className="h-8 w-8 text-muted-foreground hover:text-destructive"
              onDeleted={() => router.push("/labs")}
            />
          </TooltipTrigger>
          <TooltipContent>Delete lab</TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}

interface KpiTileProps {
  label: string;
  value: number | string;
  tone?: "neutral" | "ok" | "warn" | "alert";
  Icon?: React.ComponentType<{ className?: string }>;
}

function KpiTile({ label, value, tone = "neutral", Icon }: KpiTileProps) {
  return (
    <div
      className={cn(
        "flex h-8 items-center gap-1.5 rounded-md border bg-background/60 px-2 text-xs",
        tone === "ok" && "border-emerald-500/40 text-emerald-700 dark:text-emerald-300",
        tone === "warn" && "border-amber-500/40 text-amber-700 dark:text-amber-300",
        tone === "alert" &&
          "border-red-500/60 bg-red-500/10 text-red-700 dark:text-red-300",
      )}
    >
      {Icon && <Icon className="h-3.5 w-3.5" />}
      <span className="text-muted-foreground">{label}</span>
      <span className="font-semibold tabular-nums">{value}</span>
    </div>
  );
}
