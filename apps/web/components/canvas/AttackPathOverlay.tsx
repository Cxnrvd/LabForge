"use client";

import * as React from "react";
import { AlertTriangle, Eye, EyeOff } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils/cn";
import { computeAttackPaths, pathColour } from "@/lib/canvas/attack-paths";
import { isZone, useTopologyStore } from "@/lib/store/topology-store";
import type { LabConfig } from "@labforge/schema";

/**
 * Compact panel anchored bottom-right that runs the attack-path
 * heuristic against the current topology and shows the top 3 paths
 * sorted by risk. Toggling the panel on writes the involved-edge set
 * into a session var the canvas reads to highlight those edges.
 */
const HIGHLIGHT_EVENT = "labforge:attack-path-highlight";

export function dispatchAttackHighlight(detail: {
  edges: string[];
  nodes: string[];
  active: boolean;
}): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(HIGHLIGHT_EVENT, { detail }));
}

export function useAttackHighlight() {
  const [state, setState] = React.useState<{
    edges: Set<string>;
    nodes: Set<string>;
    active: boolean;
  }>({ edges: new Set(), nodes: new Set(), active: false });

  React.useEffect(() => {
    const handler = (ev: Event) => {
      const detail = (ev as CustomEvent).detail as {
        edges: string[];
        nodes: string[];
        active: boolean;
      };
      setState({
        edges: new Set(detail.edges),
        nodes: new Set(detail.nodes),
        active: detail.active,
      });
    };
    window.addEventListener(HIGHLIGHT_EVENT, handler);
    return () => window.removeEventListener(HIGHLIGHT_EVENT, handler);
  }, []);
  return state;
}

export function AttackPathOverlay() {
  const nodes = useTopologyStore((s) => s.nodes);
  const edges = useTopologyStore((s) => s.edges);
  const meta = useTopologyStore((s) => s.meta);
  const [visible, setVisible] = React.useState(false);

  const topology: LabConfig = React.useMemo(() => {
    return {
      id: meta.id,
      name: meta.name,
      description: meta.description,
      network_cidr: meta.network_cidr,
      provider: meta.provider,
      version: "1.0",
      zones: [],
      edges: edges.map((e) => e.data!.topologyEdge),
      nodes: nodes
        .filter((n) => !isZone(n))
        .map((n) => ("data" in n && "topologyNode" in n.data ? n.data.topologyNode : null))
        .filter((n): n is NonNullable<typeof n> => n !== null),
    };
  }, [nodes, edges, meta]);

  const result = React.useMemo(() => computeAttackPaths(topology), [topology]);

  React.useEffect(() => {
    if (!visible) {
      dispatchAttackHighlight({ edges: [], nodes: [], active: false });
      return;
    }
    dispatchAttackHighlight({
      edges: Array.from(result.involvedEdges),
      nodes: Array.from(result.involvedNodes),
      active: true,
    });
  }, [visible, result.involvedEdges, result.involvedNodes]);

  // Nothing to show if no attackers / no edges.
  if (topology.nodes.filter((n) => n.type === "attacker").length === 0) return null;
  if (topology.edges.length === 0) return null;

  const top = result.paths.slice(0, 3);
  return (
    // Tucked under the toolbar on the right so it doesn't collide with
    // React Flow's Controls cluster in the bottom-right corner. z-20 puts
    // it on the same plane as the left NodePalette and BELOW the Toolbar
    // (z-40) + BuildPreflightBanner (z-30) — see LabCanvas for the full
    // z-index ladder.
    <div className="absolute right-4 top-20 z-20 w-72 rounded-md border bg-background/95 p-3 text-xs shadow-md backdrop-blur">

      <div className="mb-2 flex items-center gap-2">
        <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
        <span className="font-semibold">Attack paths</span>
        <Button
          variant="ghost"
          size="icon"
          className="ml-auto h-6 w-6"
          aria-pressed={visible}
          aria-label={visible ? "Hide attack-path overlay" : "Show attack-path overlay"}
          onClick={() => setVisible((v) => !v)}
        >
          {visible ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
        </Button>
      </div>
      {top.length === 0 ? (
        <p className="text-muted-foreground">
          No paths from any attacker node to a high-value asset. Add CVEs or vulnerable
          roles to your targets to surface them.
        </p>
      ) : (
        <ol className="space-y-2">
          {top.map((path, idx) => {
            const colour = pathColour(path.score);
            const hops = path.nodes
              .map((id) => {
                const node = topology.nodes.find((n) => n.id === id);
                return node?.config.hostname ?? id;
              })
              .join(" → ");
            return (
              <li key={idx} className="rounded border-l-2 pl-2" style={{ borderColor: colour }}>
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: colour }}>
                    Score {path.score}
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    {path.nodes.length - 1} hop{path.nodes.length === 2 ? "" : "s"}
                  </span>
                </div>
                <p className="mt-0.5 truncate font-mono text-[11px]">{hops}</p>
                {path.rationale.length > 0 && (
                  <p
                    className={cn(
                      "mt-0.5 truncate text-[10px] text-muted-foreground",
                    )}
                  >
                    {path.rationale.join(" · ")}
                  </p>
                )}
              </li>
            );
          })}
        </ol>
      )}
      <p className="mt-2 text-[10px] text-muted-foreground">
        Heuristic — not an exploit planner. Pin CVEs on a node to push it up the rank.
      </p>
    </div>
  );
}
