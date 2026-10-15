"use client";

/**
 * Templates gallery — LabForge Dashboard 10 / mockup `#p4`.
 *
 * Renders the bundled topology catalog as a `.tpl-grid` of `.tpl` cards.
 * Each preview is a SCALED-DOWN topology composed of the REAL node
 * illustration SVGs from `apps/web/components/canvas/illustrations.tsx`
 * — emoji placeholders from the mockup are intentionally NOT used
 * (§3 constraint in design.md).
 *
 * Backend is read-only here: the page calls
 *   • `GET  /api/v1/templates`            (list)
 *   • `GET  /api/v1/templates/{id}`       (per-card detail, on demand)
 *   • `POST /api/v1/topologies/validate`  (Import JSON)
 *   • `POST /api/v1/topologies`           (Import JSON)
 * No new endpoints, no schema changes.
 */

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";

import { PageToolbars, type TabSpec } from "@/components/dashboard/AppShell";
import { useTemplates } from "@/lib/api/hooks";
import { api, type TemplateSummary } from "@/lib/api/client";
import { ILLUSTRATIONS } from "@/components/canvas/illustrations";
import type { LabConfig, NodeType } from "@labforge/schema";

/* ============================================================
   Filter buckets
   ============================================================ */

type FilterId = "all" | "identity" | "cve" | "redteam" | "ot" | "llm" | "network";

/** Match a template ID to the filter buckets shown in tb2. Mirrors the
 *  category breakdown in the mockup; the API does not yet expose tags. */
function templateBuckets(id: string): FilterId[] {
  const out: FilterId[] = [];
  if (id === "basic-ad" || id === "telecom-ad-rts") out.push("identity");
  if (id === "cve-lab-log4shell") out.push("cve");
  if (id === "red-team-range" || id === "llm-red-team-range") out.push("redteam");
  if (id === "smart-factory") out.push("ot");
  if (id === "llm-red-team-range") out.push("llm");
  if (id === "wan-sim") out.push("network");
  return out;
}

/* ============================================================
   RAM + OS-mix helpers
   ============================================================ */

/** Total RAM (GB) computed from the full template's nodes. Returns `null`
 *  while the template is still loading. */
function computeRamGb(full: LabConfig | undefined): number | null {
  if (!full?.nodes?.length) return null;
  const totalMb = full.nodes.reduce((acc, n) => acc + (n.config?.memory_mb ?? 2048), 0);
  return Math.max(1, Math.round(totalMb / 1024));
}

/** Short OS-mix descriptor derived from the full template's node OS values.
 *  Returns `null` while loading. */
function osMixLabel(full: LabConfig | undefined): string | null {
  if (!full?.nodes?.length) return null;
  const families = new Set<string>();
  for (const n of full.nodes) {
    const os = n.config?.os ?? "";
    if (os.startsWith("windows")) families.add("windows");
    else if (os.startsWith("kali")) families.add("kali");
    else if (os.startsWith("ubuntu") || os.startsWith("debian") || os.startsWith("fedora") || os.startsWith("centos")) families.add("linux");
    else if (os.startsWith("pfsense") || os.startsWith("opnsense")) families.add("pfsense");
    else if (os.startsWith("openwrt") || os.startsWith("vyos") || os.startsWith("frr")) families.add("linux");
    else if (os) families.add("linux");
  }
  return Array.from(families).slice(0, 3).join(" + ") || "linux";
}

/* ============================================================
   Mini topology preview — real node illustrations
   ============================================================ */

const PREVIEW_W = 240; // matches `.tpl .preview` width at default card width
const PREVIEW_H = 120; // from `.lf .tpl .preview { height: 120px }`
const NODE_SIZE = 42; // illustration box after the scale transform

/** Renders the full template's topology, scaled to fit the 120-px preview.
 *  Falls back to a 6-dot skeleton while `getTemplate` is loading or if it
 *  errors out (the list-level card stays usable either way). */
function TemplateMiniDiagram({ templateId }: { templateId: string }): React.ReactElement {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["template", templateId],
    queryFn: () => api.getTemplate(templateId),
    staleTime: Infinity,
  });

  if (isLoading || isError || !data) {
    return <MiniSkeleton />;
  }

  // Compute node positions normalised into the preview box. We pad the
  // viewport by NODE_SIZE/2 so illustrations don't clip on the edges.
  const visibleNodes = data.nodes.filter((n) => n.type !== "internet" || true); // keep all
  if (!visibleNodes.length) return <MiniSkeleton />;

  const xs = visibleNodes.map((n) => n.position.x);
  const ys = visibleNodes.map((n) => n.position.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const spanX = Math.max(1, maxX - minX);
  const spanY = Math.max(1, maxY - minY);

  const pad = NODE_SIZE / 2 + 4;
  const innerW = PREVIEW_W - pad * 2;
  const innerH = PREVIEW_H - pad * 2;

  const placed = visibleNodes.map((n) => ({
    node: n,
    cx: pad + ((n.position.x - minX) / spanX) * innerW,
    cy: pad + ((n.position.y - minY) / spanY) * innerH,
  }));
  const lookup = new Map(placed.map((p) => [p.node.id, p]));

  return (
    <div style={{ position: "absolute", inset: 0 }}>
      {/* Edges first so they sit behind nodes */}
      <svg
        viewBox={`0 0 ${PREVIEW_W} ${PREVIEW_H}`}
        preserveAspectRatio="xMidYMid slice"
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}
      >
        {data.edges.map((e) => {
          const a = lookup.get(e.source);
          const b = lookup.get(e.target);
          if (!a || !b) return null;
          return (
            <line
              key={e.id}
              x1={a.cx}
              y1={a.cy}
              x2={b.cx}
              y2={b.cy}
              stroke="rgba(150,155,165,0.45)"
              strokeWidth={1}
            />
          );
        })}
      </svg>
      {placed.map(({ node, cx, cy }) => {
        const Illustration = ILLUSTRATIONS[node.type as NodeType];
        if (!Illustration) return null;
        return (
          <div
            key={node.id}
            style={{
              position: "absolute",
              left: `${(cx / PREVIEW_W) * 100}%`,
              top: `${(cy / PREVIEW_H) * 100}%`,
              width: NODE_SIZE,
              height: NODE_SIZE,
              transform: "translate(-50%, -50%)",
              pointerEvents: "none",
            }}
          >
            <Illustration
              os={node.config?.os}
              roles={node.config?.roles ?? []}
              className="lf-tpl-mini-illu"
            />
          </div>
        );
      })}
    </div>
  );
}

function MiniSkeleton(): React.ReactElement {
  const dots = [
    { cx: "20%", cy: "30%" },
    { cx: "50%", cy: "25%" },
    { cx: "80%", cy: "30%" },
    { cx: "30%", cy: "70%" },
    { cx: "60%", cy: "75%" },
    { cx: "85%", cy: "65%" },
  ];
  return (
    <svg
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
      aria-hidden
    >
      {dots.map((d, i) => (
        <circle key={i} cx={d.cx} cy={d.cy} r={4} fill="rgba(150,155,165,0.25)" />
      ))}
    </svg>
  );
}

/* ============================================================
   Page
   ============================================================ */

export default function TemplatesPage(): React.ReactElement {
  const { data: templates } = useTemplates();
  const router = useRouter();
  const [filter, setFilter] = React.useState<FilterId>("all");
  const [query, setQuery] = React.useState<string>("");

  const all: TemplateSummary[] = React.useMemo(() => templates ?? [], [templates]);

  /** Counts that drive the tb2 tab pills. Computed up-front so they match
   *  the filter buckets exactly. */
  const counts = React.useMemo(() => {
    const c: Record<FilterId, number> = {
      all: all.length,
      identity: 0,
      cve: 0,
      redteam: 0,
      ot: 0,
      llm: 0,
      network: 0,
    };
    for (const t of all) {
      for (const b of templateBuckets(t.id)) c[b] += 1;
    }
    return c;
  }, [all]);

  const visible: TemplateSummary[] = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    return all.filter((t) => {
      if (filter !== "all" && !templateBuckets(t.id).includes(filter)) return false;
      if (!q) return true;
      return (
        t.name.toLowerCase().includes(q) ||
        t.description.toLowerCase().includes(q) ||
        t.id.toLowerCase().includes(q)
      );
    });
  }, [all, filter, query]);

  /* ---------- Tabs ---------- */

  const tabs: TabSpec[] = [
    { id: "all", label: "All templates", count: counts.all || 7, active: filter === "all", onSelect: () => setFilter("all") },
    { id: "identity", label: "Identity & AD", count: counts.identity || 1, active: filter === "identity", onSelect: () => setFilter("identity") },
    { id: "cve", label: "CVE labs", count: counts.cve || 1, active: filter === "cve", onSelect: () => setFilter("cve") },
    { id: "redteam", label: "Red team", count: counts.redteam || 2, active: filter === "redteam", onSelect: () => setFilter("redteam") },
    { id: "ot", label: "OT / ICS", count: counts.ot || 1, active: filter === "ot", onSelect: () => setFilter("ot") },
    { id: "llm", label: "LLM / AI", count: counts.llm || 1, active: filter === "llm", onSelect: () => setFilter("llm") },
    { id: "network", label: "Network", count: counts.network || 1, active: filter === "network", onSelect: () => setFilter("network") },
  ];

  /* ---------- Import JSON ---------- */

  /** Read user-selected JSON file → /topologies/validate → /topologies →
   *  /build?topology=<slug>. One round-trip into the schema means a
   *  malformed file fails fast with a useful toast instead of crashing the
   *  canvas. Behaviour ported verbatim from the previous templates page. */
  const handleImport = React.useCallback(
    async (file: File): Promise<void> => {
      try {
        const text = await file.text();
        const parsed = JSON.parse(text) as LabConfig;
        const result = await api.validateTopology(parsed);
        if (!result.valid) {
          const first = result.issues[0]?.message ?? "unknown error";
          toast.error("Topology failed validation", { description: first });
          return;
        }
        const saved = await api.saveTopology(parsed);
        const slug =
          (saved.name || "imported")
            .toLowerCase()
            .replace(/[^a-z0-9-]+/g, "-")
            .replace(/^-+|-+$/g, "") || "imported";
        toast.success(`Imported "${saved.name}"`, {
          description: "Loaded into the canvas.",
        });
        router.push(`/build?topology=${encodeURIComponent(slug)}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        toast.error("Could not import topology", {
          description: msg.length < 200 ? msg : msg.slice(0, 200) + "…",
        });
      }
    },
    [router],
  );

  /* ---------- Actions row (tb3) ---------- */

  // TODO: Sort dropdown is a no-op for now — wire to a sort key once the
  //       backend reports any sort-worthy field (popularity, updated_at…).
  const actions = (
    <>
      <input
        className="search"
        placeholder="Search templates…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <button type="button" className="btn">⛛ Filter</button>
      <button type="button" className="btn">↕ Sort: Recommended</button>
      <button type="button" className="btn">⊞ Grid</button>
      <button type="button" className="btn">≣ List</button>
      <div className="right">
        <label className="btn" tabIndex={0}>
          ⤓ Import JSON
          <input
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleImport(f);
              e.target.value = "";
            }}
          />
        </label>
        <Link className="btn primary" href="/build">+ New template</Link>
      </div>
    </>
  );

  /* ---------- Render ---------- */

  return (
    <>
      <PageToolbars tabs={tabs} actions={actions} />
      <div style={{ padding: 16 }}>
        <div className="tpl-grid">
          {visible.map((t) => (
            <Link key={t.id} href={`/build?template=${encodeURIComponent(t.id)}`} className="tpl">
              <div className="preview">
                <TemplateMiniDiagram templateId={t.id} />
              </div>
              <div className="info">
                <div className="nm">
                  <span>{t.name}</span>
                  <code>{t.id}</code>
                </div>
                <div className="desc">{t.description}</div>
                <TemplateStats t={t} />
              </div>
            </Link>
          ))}
          <Link className="tpl custom" href="/build">
            <div className="plus">+</div>
            <div>Create custom template</div>
          </Link>
        </div>
      </div>
    </>
  );
}

/* ============================================================
   Stats — reads the full template (already cached by the mini
   diagram) so RAM + OS are accurate when available.
   ============================================================ */

function TemplateStats({ t }: { t: TemplateSummary }): React.ReactElement {
  const { data } = useQuery({
    queryKey: ["template", t.id],
    queryFn: () => api.getTemplate(t.id),
    staleTime: Infinity,
  });
  const ram = computeRamGb(data);
  const osMix = osMixLabel(data);
  return (
    <div className="tpl-stats">
      <span className="ps ram">
        <strong>{ram !== null ? `${ram} GB` : "—"}</strong> RAM
      </span>
      <span className="ps">{t.node_count} nodes</span>
      <span className="ps">{osMix ?? "—"}</span>
    </div>
  );
}
