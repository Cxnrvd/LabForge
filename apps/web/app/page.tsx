"use client";

/**
 * LabForge Mission Control dashboard (page #p1).
 *
 * Renders only the content area — the AppShell in apps/web/app/layout.tsx
 * provides the 220 px `.sidebar` and the top `.tb1` breadcrumb. Per the
 * mockup, the dashboard has NO tb2/tb3, so we omit `<PageToolbars>` entirely
 * and wrap the body in a padded container (the `.lf .content` rule has
 * no padding by default).
 *
 * All visual classes (.kpi, .spark, .card, .card-h, .pill, .sd, .feed-item,
 * .tpl, .btn, .trend, …) come from apps/web/styles/labforge-d10.css, which
 * is already imported globally by the layout.
 */

import * as React from "react";
import Link from "next/link";
import { useQuery, useQueries } from "@tanstack/react-query";

import { api } from "@/lib/api/client";
import type { TemplateSummary } from "@/lib/api/client";
import { ILLUSTRATIONS } from "@/components/canvas/illustrations";
import type { LabConfig, NodeType } from "@labforge/schema";

/* -------------------------------------------------------------- *
 * Types                                                          *
 * -------------------------------------------------------------- */

interface Lab {
  id: number;
  name: string;
  status: string;
  template_id?: string | null;
  provider?: string | null;
  workspace_path?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

interface Heartbeat {
  lab_status: string;
  vms: Array<{ state: string; hostname?: string; name?: string }>;
}

interface ActivityEntry {
  lab_id: number;
  lab_name: string;
  captured_at: string;
  lab_status: string;
  running_vms: number;
  total_vms: number;
  log_snippet: string | null;
}

interface StoredTopology {
  slug: string;
  name: string;
  description?: string | null;
  updated_at: string;
}

interface CveSearchHit {
  id: string;
  description: string;
  cvss_score: number | null;
  severity: string;
}

/* -------------------------------------------------------------- *
 * Helpers                                                        *
 * -------------------------------------------------------------- */

function uptime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  if (isNaN(ms) || ms < 0) return "—";
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h.toString().padStart(2, "0")}h`;
  if (h > 0) return `${h}h ${m.toString().padStart(2, "0")}m`;
  return `${m}m`;
}

function hms(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "--:--:--";
  return d.toLocaleTimeString([], { hour12: false });
}

function templatePillTone(
  templateId: string | null | undefined,
): "purple" | "info" | "warn" {
  if (!templateId) return "warn";
  if (templateId === "basic-ad" || templateId === "red-team-range") {
    return "purple";
  }
  if (templateId === "dfir-lab" || templateId === "wan-sim") return "info";
  return "warn";
}

function labStatusDotClass(status: string): "run" | "prov" | "stop" | "err" {
  const s = (status ?? "").toLowerCase();
  if (s === "running") return "run";
  if (s === "partial" || s === "building" || s === "provisioning") return "prov";
  if (s === "failed" || s === "error") return "err";
  return "stop";
}

function feedDotClass(labStatus: string): "ok" | "info" | "warn" | "err" {
  const s = (labStatus ?? "").toLowerCase();
  if (s === "running") return "ok";
  if (s === "partial" || s === "building") return "info";
  if (s === "failed" || s === "error") return "err";
  return "warn";
}

/** Deterministic 0..1 hash of any non-negative integer (mulberry-style). */
function hashFloat(seed: number): number {
  let x = (seed + 0x6d2b79f5) | 0;
  x = Math.imul(x ^ (x >>> 15), x | 1);
  x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
  return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
}

/* -------------------------------------------------------------- *
 * Page                                                           *
 * -------------------------------------------------------------- */

export default function MissionControl(): React.ReactElement {
  const { data: labs } = useQuery<Lab[]>({
    queryKey: ["labs"],
    queryFn: () => fetch("/api/v1/labs").then((r) => r.json()),
    refetchInterval: 15_000,
    staleTime: 10_000,
  });

  const { data: topologies } = useQuery<StoredTopology[]>({
    queryKey: ["topologies"],
    queryFn: () => fetch("/api/v1/topologies").then((r) => r.json()),
    staleTime: 60_000,
  });

  const { data: templates } = useQuery<TemplateSummary[]>({
    queryKey: ["templates"],
    queryFn: () => api.listTemplates(),
    staleTime: 5 * 60_000,
  });

  // Cheap NVD-backed search (server caches). Used only for KPI count.
  const { data: cveHits } = useQuery<CveSearchHit[]>({
    queryKey: ["cve-feed-count"],
    queryFn: () =>
      fetch("/api/v1/cves/search?q=remote%20code%20execution&limit=200").then(
        (r) => r.json(),
      ),
    staleTime: 5 * 60_000,
    retry: 0,
  });

  const { data: activity } = useQuery<ActivityEntry[]>({
    queryKey: ["activity"],
    queryFn: () => fetch("/api/v1/labs/activity/recent").then((r) => r.json()),
    refetchInterval: 15_000,
    staleTime: 10_000,
  });

  const labsList = labs ?? [];
  const runningLabs = labsList.filter(
    (l) => l.status === "running" || l.status === "partial",
  );

  // Heartbeats for each running lab — fan-out via useQueries. Gated by
  // status === running so halted/failed labs don't poll, and slowed to 30s
  // so the dashboard doesn't thrash N parallel requests every 5 seconds.
  const heartbeatQueries = useQueries({
    queries: runningLabs.map((lab) => ({
      queryKey: ["heartbeat", lab.id],
      queryFn: () => api.getLabHeartbeat(lab.id),
      enabled: lab.status === "running",
      refetchInterval: 30_000,
      staleTime: 20_000,
      retry: 0,
    })),
  });
  const heartbeats: Record<number, Heartbeat | undefined> = {};
  runningLabs.forEach((lab, i) => {
    heartbeats[lab.id] = heartbeatQueries[i]?.data as Heartbeat | undefined;
  });

  /* ----- KPI computations ----- */
  const runningCount = runningLabs.length;

  const savedTopologiesCount = topologies?.length ?? 0;

  const cveTrackedCount = cveHits?.length ?? 0;

  // Approximate allocated RAM by counting running VMs × 2 GB average.
  // Labelled "approx" in the tile since the backend doesn't expose per-lab
  // RAM aggregates.
  const approxRunningVmCount = Object.values(heartbeats).reduce(
    (acc, hb) => acc + (hb?.vms.filter((v) => v.state === "running").length ?? 0),
    0,
  );
  const approxRamGb = approxRunningVmCount * 2;

  // Deterministic sparkline heights derived from lab count.
  const sparkHeights = Array.from({ length: 7 }, (_, i) =>
    Math.round(30 + hashFloat(labsList.length * 7 + i) * 70),
  );

  const recentActivity = (activity ?? []).slice(0, 12);

  // Prefer the four canonical featured templates from the mockup, but fall
  // back to whatever the API returns first.
  const featuredOrder = [
    "basic-ad",
    "cve-lab-log4shell",
    "dfir-lab",
    "wan-sim",
  ];
  const allTemplates = templates ?? [];
  const featuredTemplates: TemplateSummary[] = [];
  for (const wanted of featuredOrder) {
    const hit = allTemplates.find((t) => t.id === wanted);
    if (hit) featuredTemplates.push(hit);
  }
  for (const t of allTemplates) {
    if (featuredTemplates.length >= 4) break;
    if (!featuredTemplates.find((x) => x.id === t.id)) featuredTemplates.push(t);
  }

  return (
    <div style={{ padding: 16 }}>
      {/* ---------- KPI row ---------- */}
      <div className="g-4" style={{ marginBottom: 14 }}>
        <div className="kpi">
          <div className="lbl">Active Labs</div>
          <div className="val">{runningCount}</div>
        </div>
        <div className="kpi">
          <div className="lbl">Saved Topologies</div>
          <div className="val">{savedTopologiesCount}</div>
          <div className="trend neutral">— unchanged</div>
        </div>
        <div className="kpi">
          <div className="lbl">CVEs Tracked</div>
          <div className="val">{cveTrackedCount}</div>
        </div>
        <div className="kpi">
          <div className="lbl">Allocated RAM</div>
          <div className="val">
            {approxRamGb}{" "}
            <span style={{ fontSize: 13, color: "var(--d10-fg-faint)" }}>
              GB
            </span>
          </div>
          <div className="trend neutral">approx · 2 GB per VM</div>
          <div className="spark">
            {sparkHeights.map((h, i) => (
              <span key={i} style={{ height: `${h}%` }} />
            ))}
          </div>
        </div>
      </div>

      {/* ---------- Row: Running Labs + Activity ---------- */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "2fr 1fr",
          gap: 14,
        }}
      >
        <div className="card">
          <div className="card-h">
            <span className="title">Running Labs</span>
            <span style={{ color: "var(--d10-fg-faint)" }}>· vagrant up</span>
            <div className="actions">
              <Link
                href="/labs"
                className="btn"
                style={{ textDecoration: "none" }}
              >
                View all →
              </Link>
            </div>
          </div>
          <div className="card-b" style={{ padding: 0 }}>
            <RunningLabsTable labs={runningLabs} heartbeats={heartbeats} />
          </div>
        </div>

        <div className="card">
          <div className="card-h">
            <span className="title">Activity</span>
            <div className="actions">
              <span style={{ color: "var(--d10-fg-faint)" }}>last 24h</span>
            </div>
          </div>
          <div>
            <ActivityFeed entries={recentActivity} />
          </div>
        </div>
      </div>

      {/* ---------- Row: Quick-start templates + Quick Actions ---------- */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 280px",
          gap: 14,
          marginTop: 14,
        }}
      >
        <div className="card">
          <div className="card-h">
            <span className="title">Quick-start templates</span>
            <div className="actions">
              <Link
                href="/templates"
                className="accent"
                style={{
                  textDecoration: "none",
                  fontSize: 11,
                }}
              >
                Browse all {allTemplates.length || 7} →
              </Link>
            </div>
          </div>
          <QuickStartTemplates items={featuredTemplates} />
        </div>

        <div className="card">
          <div className="card-h">
            <span className="title">Quick Actions</span>
          </div>
          <QuickActions />
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------- *
 * Running labs table                                             *
 * -------------------------------------------------------------- */

function RunningLabsTable({
  labs,
  heartbeats,
}: {
  labs: Lab[];
  heartbeats: Record<number, Heartbeat | undefined>;
}): React.ReactElement {
  if (labs.length === 0) {
    return (
      <div
        style={{
          padding: 18,
          color: "var(--d10-fg-faint)",
          fontSize: 12.5,
        }}
      >
        No running labs. Build a topology on the canvas to get started.
      </div>
    );
  }
  return (
    <table>
      <thead>
        <tr>
          <th>Lab</th>
          <th>Template</th>
          <th>Nodes</th>
          <th>RAM</th>
          <th>Status</th>
          <th>Uptime</th>
        </tr>
      </thead>
      <tbody>
        {labs.map((lab) => {
          const hb = heartbeats[lab.id];
          const nodeCount = hb?.vms.length;
          // TODO: needs backend support — heartbeat does not return
          // per-VM memory; approximate RAM as VM count × 2 GB.
          const ramApprox = nodeCount ? `${nodeCount * 2} GB` : "—";
          const pillTone = templatePillTone(lab.template_id);
          const dotClass = labStatusDotClass(lab.status);
          const updated = lab.updated_at ?? lab.created_at ?? null;
          const isHalted =
            lab.status === "stopped" ||
            lab.status === "halted" ||
            lab.status === "failed";
          return (
            <tr key={lab.id}>
              <td>
                <strong>{lab.name}</strong>
                <br />
                <span className="sub">
                  {lab.workspace_path ?? `lab #${lab.id}`}
                </span>
              </td>
              <td>
                {lab.template_id ? (
                  <span className={`pill ${pillTone}`}>{lab.template_id}</span>
                ) : (
                  <span style={{ color: "var(--d10-fg-faint)" }}>—</span>
                )}
              </td>
              <td>{nodeCount ?? "—"}</td>
              <td>{ramApprox}</td>
              <td>
                <span className={`sd ${dotClass}`} /> {lab.status}
              </td>
              <td>{isHalted ? "—" : uptime(updated)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/* -------------------------------------------------------------- *
 * Activity feed                                                  *
 * -------------------------------------------------------------- */

function ActivityFeed({
  entries,
}: {
  entries: ActivityEntry[];
}): React.ReactElement {
  if (entries.length === 0) {
    return (
      <div
        style={{
          padding: 18,
          color: "var(--d10-fg-faint)",
          fontSize: 12.5,
        }}
      >
        No telemetry yet. Bring up a lab to populate this feed.
      </div>
    );
  }
  return (
    <>
      {entries.map((e, idx) => {
        const tone = feedDotClass(e.lab_status);
        const summary =
          e.log_snippet && e.log_snippet.length > 0
            ? e.log_snippet
            : `${e.lab_status} · ${e.running_vms}/${e.total_vms} VMs`;
        return (
          <div
            key={`${e.lab_id}-${e.captured_at}-${idx}`}
            className="feed-item"
          >
            <span className={`dot ${tone}`} />
            <div className="txt">
              Lab{" "}
              <strong style={{ color: "var(--d10-fg)" }}>{e.lab_name}</strong>{" "}
              {summary}
            </div>
            <span className="ts">{hms(e.captured_at)}</span>
          </div>
        );
      })}
    </>
  );
}

/* -------------------------------------------------------------- *
 * Quick-start templates                                          *
 * -------------------------------------------------------------- */

function QuickStartTemplates({
  items,
}: {
  items: TemplateSummary[];
}): React.ReactElement {
  // Fan-out fetch of the full template body for each summary so we can render
  // a tiny topology thumbnail of the first few nodes. The /api/v1/templates/{id}
  // payload is small and the dashboard only shows 4 templates, so 4 parallel
  // requests on first paint is acceptable; staleTime keeps them out of the
  // refetch hot path.
  const templateQueries = useQueries({
    queries: items.map((tpl) => ({
      queryKey: ["template-body", tpl.id],
      queryFn: () => api.getTemplate(tpl.id),
      staleTime: 5 * 60_000,
      retry: 0,
    })),
  });

  if (items.length === 0) {
    return (
      <div
        style={{
          padding: 18,
          color: "var(--d10-fg-faint)",
          fontSize: 12.5,
        }}
      >
        No templates loaded.
      </div>
    );
  }
  return (
    <div className="qt-grid">
      {items.map((tpl, i) => {
        // TODO: needs backend support — TemplateSummary does not include
        // a RAM total. Approximate as node_count × 2 GB for display.
        const ramApprox = Math.max(2, tpl.node_count * 2);
        const body = templateQueries[i]?.data as LabConfig | undefined;
        return (
          <Link
            key={tpl.id}
            className="qt-card"
            href={`/build?template=${encodeURIComponent(tpl.id)}`}
            aria-label={`Use template ${tpl.name}`}
          >
            <QuickTemplateThumb body={body} />
            <div className="qt-body">
              <div className="qt-title">
                <span
                  style={{
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {tpl.name}
                </span>
                <code className="qt-slug">{tpl.id}</code>
              </div>
              <div className="qt-desc">{tpl.description ?? ""}</div>
              <div className="qt-stats">
                <span className="qt-pill ram">
                  <strong>{ramApprox} GB</strong>
                </span>
                <span className="qt-pill">{tpl.node_count} nodes</span>
                <span className="qt-pill">{templateOsMix(body)}</span>
              </div>
            </div>
          </Link>
        );
      })}
    </div>
  );
}

/** Tiny strip of node illustrations for a Quick-start template card. */
function QuickTemplateThumb({
  body,
}: {
  body: LabConfig | undefined;
}): React.ReactElement {
  if (!body || !body.nodes?.length) {
    return (
      <div className="qt-thumb">
        <span className="qt-thumb-empty">loading…</span>
      </div>
    );
  }
  const renderable = body.nodes.filter(
    (n) =>
      (n.type as string) !== "zone" && ILLUSTRATIONS[n.type as NodeType] != null,
  );
  const visible = renderable.slice(0, 5);
  const overflow = renderable.length - visible.length;
  return (
    <div className="qt-thumb">
      {visible.map((n) => {
        const Illustration = ILLUSTRATIONS[n.type as NodeType];
        if (!Illustration) return null;
        return (
          <div
            key={n.id}
            className="qt-thumb-node"
            title={`${n.label} (${n.type})`}
          >
            <Illustration
              os={n.config.os}
              roles={n.config.roles}
              size={30}
              className="h-7 w-7 select-none"
            />
          </div>
        );
      })}
      {overflow > 0 && <span className="qt-thumb-more">+{overflow}</span>}
    </div>
  );
}

/** OS distribution label, e.g. "linux · win" or "mixed". */
function templateOsMix(body: LabConfig | undefined): string {
  if (!body || !body.nodes?.length) return "—";
  const oses = new Set<string>();
  for (const n of body.nodes) {
    const os = (n.config.os ?? "").toLowerCase();
    if (!os) continue;
    if (os.includes("win")) oses.add("win");
    else if (
      os.includes("ubuntu") ||
      os.includes("debian") ||
      os.includes("centos") ||
      os.includes("rocky") ||
      os.includes("alpine") ||
      os.includes("kali") ||
      os.includes("linux")
    ) {
      oses.add("linux");
    } else {
      oses.add(os);
    }
  }
  if (oses.size === 0) return "—";
  if (oses.size === 1) return Array.from(oses)[0]!;
  return Array.from(oses).slice(0, 2).join(" · ");
}

/* -------------------------------------------------------------- *
 * Quick actions                                                  *
 * -------------------------------------------------------------- */

function QuickActions(): React.ReactElement {
  return (
    <div
      style={{
        padding: 12,
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      <Link
        className="btn primary"
        href="/build"
        style={{ textDecoration: "none", textAlign: "left" }}
      >
        + New blank topology
      </Link>
      <Link
        className="btn"
        href="/templates#import"
        style={{ textDecoration: "none", textAlign: "left" }}
      >
        ⤓ Import topology.json
      </Link>
      <Link
        className="btn"
        href="/cves"
        style={{ textDecoration: "none", textAlign: "left" }}
      >
        ⌕ Search NVD CVE…
      </Link>
      <a
        className="btn"
        href="http://127.0.0.1:8000/docs"
        target="_blank"
        rel="noreferrer"
        style={{ textDecoration: "none", textAlign: "left" }}
      >
        ⎘ Open OpenAPI /docs
      </a>
      <Link
        className="btn"
        href="/labs"
        style={{ textDecoration: "none", textAlign: "left" }}
      >
        ⚡ View all labs →
      </Link>
    </div>
  );
}
