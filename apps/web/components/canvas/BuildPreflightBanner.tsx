"use client";

import * as React from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { useQuery } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils/cn";
import { api } from "@/lib/api/client";
import { useTopologyStore } from "@/lib/store/topology-store";

/**
 * Surfaces the result of `GET /labs/build/preflight` above the canvas
 * Toolbar so the tester knows before clicking Build whether the API
 * host can actually execute it.
 *
 * Render contract:
 *   - vagrant missing  → red banner, blocks confidence in Build
 *   - default provider mismatches topology.provider → amber banner
 *   - all green        → renders nothing (zero visual cost)
 */
export function BuildPreflightBanner(): React.ReactElement | null {
  const topologyProvider = useTopologyStore((s) => s.meta.provider);

  const preflightQ = useQuery({
    queryKey: ["build-preflight"],
    queryFn: () => api.buildPreflight(),
    // Cheap probe; re-poll on a coarse interval so installing Vagrant
    // mid-session clears the banner without a manual refresh.
    refetchInterval: 15_000,
    staleTime: 10_000,
  });

  if (preflightQ.isLoading || !preflightQ.data) return null;

  const data = preflightQ.data;

  if (topologyProvider === "docker") {
    let dockerMessage: string | null = null;
    if (!data.docker_available) {
      dockerMessage = "Docker not detected on the API host — Build will fail. Install Docker Desktop or Docker Engine and click Re-check.";
    } else if (!data.docker_daemon) {
      dockerMessage = `The Docker daemon is not running${data.detail ? ` (${data.detail})` : ""} — start Docker and click Re-check.`;
    } else if (!data.compose_version) {
      dockerMessage = "The 'docker compose' v2 plugin is missing — install it and click Re-check.";
    } else if (!data.compose_supported) {
      dockerMessage = `Docker Compose ${data.compose_version} is too old — 2.24 or newer is required.`;
    }
    if (!dockerMessage) return null;
    return <PreflightBar tone="destructive" message={dockerMessage} onRecheck={() => preflightQ.refetch()} busy={preflightQ.isFetching} />;
  }

  const missingVagrant = !data.vagrant_available;
  const providerMismatch = Boolean(
    data.vagrant_available &&
      data.default_provider &&
      data.default_provider !== topologyProvider,
  );

  if (!missingVagrant && !providerMismatch) return null;

  const tone = missingVagrant ? "destructive" : "warning";
  const message = missingVagrant
    ? "Vagrant not detected on the API host — Build will fail. Install Vagrant 2.4+ and click Re-check."
    : `System default provider is "${data.default_provider}", but this topology targets "${topologyProvider}". Build will force --provider ${topologyProvider}; this banner is just an FYI.`;

  return (
    <PreflightBar tone={tone} message={message} onRecheck={() => preflightQ.refetch()} busy={preflightQ.isFetching} />
  );
}

function PreflightBar({
  tone,
  message,
  onRecheck,
  busy,
}: {
  tone: "destructive" | "warning";
  message: string;
  onRecheck: () => void;
  busy: boolean;
}): React.ReactElement {
  return (
    <div
      className={cn(
        // z-30: above NodePalette/AttackPathOverlay (z-20), below the
        // Toolbar (z-40). Banner must be visible whenever vagrant is missing.
        "pointer-events-auto absolute left-1/2 top-[60px] z-30 -translate-x-1/2",
        "flex max-w-[680px] items-center gap-2 rounded-md border px-3 py-1.5 text-xs shadow-sm",
        tone === "destructive"
          ? "border-red-500/50 bg-red-500/10 text-red-800 dark:text-red-200"
          : "border-amber-500/50 bg-amber-500/10 text-amber-800 dark:text-amber-200",
      )}
      role="status"
    >
      <AlertTriangle
        className={cn(
          "h-3.5 w-3.5 shrink-0",
          tone === "destructive" ? "text-red-600" : "text-amber-600",
        )}
        aria-hidden
      />
      <span className="leading-snug">{message}</span>
      <Button
        variant="ghost"
        size="sm"
        className="ml-auto h-6 px-2 text-[11px]"
        onClick={onRecheck}
        disabled={busy}
      >
        <RefreshCw
          className={cn(
            "mr-1 h-3 w-3",
            busy && "animate-spin",
          )}
        />
        Re-check
      </Button>
    </div>
  );

}
