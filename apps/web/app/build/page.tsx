"use client";

/**
 * Canvas page — LabForge Dashboard 10 / mockup `#p2`.
 *
 * This was the missing route that caused every "Canvas" sidebar link and
 * every `/build?template=…` / `/build?topology=…` redirect to 404.
 *
 * Query params (both optional, mutually exclusive):
 *   ?template=<id>     — load a bundled template from /api/v1/templates/{id}
 *   ?topology=<slug>   — load a saved topology from /api/v1/topologies/{slug}
 *
 * The floating in-canvas Toolbar already exposes Add / Validate / Build /
 * Export, so no tb3 is needed here. tb2 holds the Canvas / Validate /
 * Generate sub-navigation that mirrors the sidebar Build section.
 */

import * as React from "react";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";

import { PageToolbars, type TabSpec } from "@/components/dashboard/AppShell";
import { LabCanvas } from "@/components/canvas/LabCanvas";
import { api } from "@/lib/api/client";
import { useTopologyStore } from "@/lib/store/topology-store";

/* ============================================================
   Query-param loader — must be inside Suspense for Next.js 15
   ============================================================ */

function CanvasLoader(): null {
  const searchParams = useSearchParams();
  const loadTopology = useTopologyStore((s) => s.loadTopology);
  const loaded = React.useRef(false);

  React.useEffect(() => {
    if (loaded.current) return;
    const templateId = searchParams.get("template");
    const topologySlug = searchParams.get("topology");
    if (!templateId && !topologySlug) return;
    loaded.current = true;

    const load = async (): Promise<void> => {
      try {
        const topology = templateId
          ? await api.getTemplate(templateId)
          : await api.getStoredTopology(topologySlug!);
        loadTopology(topology);
        toast.success(`Loaded "${topology.name}"`, {
          description: "Topology is ready on the canvas.",
        });
      } catch {
        toast.error("Failed to load topology", {
          description: "Check that the template or topology slug is correct.",
        });
      }
    };

    void load();
  }, [searchParams, loadTopology]);

  return null;
}

/* ============================================================
   Page
   ============================================================ */

const TABS: TabSpec[] = [
  { id: "canvas", label: "Canvas", active: true, href: "/build" },
  { id: "validate", label: "Validate", href: "/build/validate" },
  { id: "generate", label: "Generate", href: "/build/generate" },
];

export default function BuildPage(): React.ReactElement {
  return (
    <>
      <PageToolbars tabs={TABS} noActions />

      {/* Fill the remaining content height. The LabCanvas uses absolute
          positioning internally, so this wrapper must have explicit height
          via flex — the AppShell content area is already a flex column. */}
      <div style={{ flex: 1, minHeight: 0, position: "relative" }}>
        <React.Suspense fallback={null}>
          <CanvasLoader />
        </React.Suspense>
        <LabCanvas />
      </div>
    </>
  );
}
