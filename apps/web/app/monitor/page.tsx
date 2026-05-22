"use client";

import * as React from "react";
import Link from "next/link";
import { useQueries, useQuery } from "@tanstack/react-query";

import { api } from "@/lib/api/client";
import { ILLUSTRATIONS } from "@/components/canvas/illustrations";
import type { LabConfig, NodeType } from "@labforge/schema";

interface Lab {
  id: number;
  name: string;
  topology_slug: string;
  provider: string;
  status: string;
  workspace_path?: string | null;
  created_at: string;
  updated_at: string;
}

type FilterKey = "all" | "running" | "building" | "stopped" | "failed";

type HeartbeatPayload = Awaited<ReturnType<typeof api.getLabHeartbeat>>;

function normaliseStatus(status: string): FilterKey | "other" {
  const s = status.toLowerCase();
  if (s === "running") return "running";
  if (s === "building" || s === "pending") return "building";
  if (s === "stopped" || s === "halted" || s === "destroyed") return "stopped";
  if (s === "failed" || s === "error") return "failed";
  return "other";
}

function formatAge(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const diff = Math.max(0, Date.now() - then);
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d === 1) return "yesterday";
  return `${d}d ago`;
}

const PHASE_PCT: Record<string, number> = {
  defined: 5,
  downloading: 20,
  importing: 35,
  booting: 55,
  network: 70,
  provisioning: 85,
  ready: 100,
  failed: 100,
};

function heartbeatProgress(hb: HeartbeatPayload | undefined): number | null {
  if (!hb || !hb.vms?.length) return null;
  // Use VM state heuristic: count "running" vs total.
  const total = hb.vms.length;
  const ready = hb.vms.filter((v) => /running|ready/i.test(v.state)).length;
  if (total === 0) return null;
  return Math.round((ready / total) * 100);
}

function vmCounts(hb: HeartbeatPayload | undefined): { ready: number; total: number } | null {
  if (!hb || !hb.vms) return null;
  const total = hb.vms.length;
  const ready = hb.vms.filter((v) => /running|ready/i.test(v.state)).length;
  return { ready, total };
}

export default function MonitorIndex() {
  const [filter, setFilter] = React.useState<FilterKey>("all");

  const { data: labs = [] } = useQuery<Lab[]>({
    queryKey: ["labs"],
    queryFn: () => fetch("/api/v1/labs").then((r) => r.json()),
    refetchInterval: 15_000,
    staleTime: 10_000,
  });

  const totals = React.useMemo(() => {
    const counts = { total: labs.length, running: 0, building: 0, stopped: 0, failed: 0 };
    for (const l of labs) {
      const k = normaliseStatus(l.status);
      if (k === "running") counts.running += 1;
      else if (k === "building") counts.building += 1;
      else if (k === "stopped") counts.stopped += 1;
      else if (k === "failed") counts.failed += 1;
    }
    return counts;
  }, [labs]);

  // Heartbeats only for labs that are running or building.
  const liveLabs = React.useMemo(
    () =>
      labs.filter((l) => {
        const k = normaliseStatus(l.status);
        return k === "running" || k === "building";
      }),
    [labs],
  );

  const heartbeatQueries = useQueries({
    queries: liveLabs.map((lab) => ({
      queryKey: ["lab-heartbeat", lab.id],
      queryFn: () => api.getLabHeartbeat(lab.id),
      // Gate per-lab polling on "running" status — we don't need to thrash
      // heartbeat endpoints for halted labs.
      enabled: normaliseStatus(lab.status) === "running",
      refetchInterval: 30_000,
      staleTime: 20_000,
      retry: false,
    })),
  });

  const heartbeats = React.useMemo(() => {
    const map = new Map<number, HeartbeatPayload>();
    liveLabs.forEach((lab, i) => {
      const d = heartbeatQueries[i]?.data;
      if (d) map.set(lab.id, d);
    });
    return map;
  }, [liveLabs, heartbeatQueries]);

  const building = labs.filter((l) => normaliseStatus(l.status) === "building");
  const running = labs.filter((l) => normaliseStatus(l.status) === "running");
  const recent = labs
    .filter((l) => {
      const k = normaliseStatus(l.status);
      return k === "stopped" || k === "failed" || k === "other";
    })
    .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
    .slice(0, 12);

  const showBuilding = filter === "all" || filter === "building";
  const showRunning = filter === "all" || filter === "running";
  const showRecent =
    filter === "all" || filter === "stopped" || filter === "failed";

  const recentFiltered = recent.filter((l) => {
    if (filter === "all") return true;
    const k = normaliseStatus(l.status);
    if (filter === "stopped") return k === "stopped" || k === "other";
    if (filter === "failed") return k === "failed";
    return true;
  });

  return (
    <main className="page">
      <div className="pagehead">
        <div style={{ flex: 1 }}>
          <h1 className="h1">Labs</h1>
          <div className="meta mono">
            {totals.total} total · {totals.running} running · {totals.building} building ·{" "}
            {totals.stopped} stopped · {totals.failed} failed
          </div>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <Link className="btn primary" href="/build">
            + New Lab
          </Link>
        </div>
      </div>

      <div style={{ display: "flex", gap: 6, marginBottom: 18, flexWrap: "wrap" }}>
        <FilterPill active={filter === "all"} count={totals.total} onClick={() => setFilter("all")}>
          All
        </FilterPill>
        <FilterPill
          active={filter === "running"}
          count={totals.running}
          onClick={() => setFilter("running")}
        >
          Running
        </FilterPill>
        <FilterPill
          active={filter === "building"}
          count={totals.building}
          onClick={() => setFilter("building")}
        >
          Building
        </FilterPill>
        <FilterPill
          active={filter === "stopped"}
          count={totals.stopped}
          onClick={() => setFilter("stopped")}
        >
          Stopped
        </FilterPill>
        <FilterPill
          active={filter === "failed"}
          count={totals.failed}
          onClick={() => setFilter("failed")}
        >
          Failed
        </FilterPill>
      </div>

      {/* Building section */}
      {showBuilding && building.length > 0 && (
        <section style={{ marginBottom: 22 }}>
          <SectionHeader
            badge={
              <span className="badge live">
                <span className="d" />
                Building · {building.length}
              </span>
            }
            note="in progress · streaming logs"
          />
          <div style={{ display: "grid", gap: 14 }}>
            {building.map((lab) => (
              <BuildingCard
                key={lab.id}
                lab={lab}
                heartbeat={heartbeats.get(lab.id)}
              />
            ))}
          </div>
        </section>
      )}

      {/* Running section */}
      {showRunning && running.length > 0 && (
        <section style={{ marginBottom: 22 }}>
          <SectionHeader
            badge={
              <span className="badge live">
                <span className="d" />
                Running · {running.length}
              </span>
            }
            note="healthy heartbeats · last 10s"
          />
          <div className="grid12">
            {running.map((lab) => (
              <div className="s6" key={lab.id}>
                <RunningCard lab={lab} heartbeat={heartbeats.get(lab.id)} />
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Recent section */}
      {showRecent && (
        <section>
          <SectionHeader
            badge={<span className="badge">Recent · {recentFiltered.length}</span>}
            note="stopped, draft, or failed"
          />
          <div className="card s12">
            {recentFiltered.length === 0 ? (
              <div style={{ padding: "28px 22px", textAlign: "center" }} className="meta mono">
                No recent labs.
              </div>
            ) : (
              <table className="t">
                <thead>
                  <tr>
                    <th style={{ width: 36 }}></th>
                    <th>Lab</th>
                    <th>Template</th>
                    <th>Provider</th>
                    <th>VMs</th>
                    <th>Status</th>
                    <th style={{ textAlign: "right" }}>Last activity</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {recentFiltered.map((lab) => (
                    <RecentRow
                      key={lab.id}
                      lab={lab}
                      heartbeat={heartbeats.get(lab.id)}
                    />
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>
      )}

      {totals.total === 0 && (
        <div className="card" style={{ padding: 36, textAlign: "center" }}>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>No labs yet</div>
          <div className="meta mono" style={{ marginBottom: 14 }}>
            Build a lab from the canvas to see live status here.
          </div>
          <Link className="btn primary" href="/build">
            Open builder
          </Link>
        </div>
      )}
    </main>
  );
}

/* ------------------------------------------------------------------ */
/* Subcomponents                                                       */
/* ------------------------------------------------------------------ */

function FilterPill({
  active,
  count,
  onClick,
  children,
}: {
  active: boolean;
  count: number;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className={active ? "btn sm primary" : "btn sm"}
      onClick={onClick}
    >
      {children}{" "}
      <span className="mono" style={{ opacity: 0.7, marginLeft: 4 }}>
        {count}
      </span>
    </button>
  );
}

function SectionHeader({ badge, note }: { badge: React.ReactNode; note: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
      {badge}
      <div style={{ height: 1, background: "var(--line)", flex: 1 }} />
      <span className="mono" style={{ fontSize: 12, color: "var(--ink-mute)" }}>
        {note}
      </span>
    </div>
  );
}

function BuildingCard({
  lab,
  heartbeat,
}: {
  lab: Lab;
  heartbeat: HeartbeatPayload | undefined;
}) {
  const pct = heartbeatProgress(heartbeat);
  const counts = vmCounts(heartbeat);
  const displayPct = pct ?? 50;
  const indeterminate = pct === null;
  return (
    <div className="card" style={{ padding: 0, overflow: "hidden" }}>
      <div
        style={{
          padding: "18px 22px",
          display: "grid",
          gridTemplateColumns: "1fr auto auto",
          gap: 16,
          alignItems: "center",
          borderBottom: "1px solid var(--line)",
        }}
      >
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <div className="row-title">{lab.name}</div>
            <span className="badge info">
              <span className="d" />
              Building{pct !== null ? ` · ${pct}%` : ""}
            </span>
            <span className="badge mono">#{lab.id}</span>
          </div>
          <div className="meta-line mono" style={{ marginTop: 4 }}>
            {lab.topology_slug} · {lab.provider}
            {counts ? ` · ${counts.ready}/${counts.total} VMs healthy` : ""}
          </div>
        </div>
        <Link className="btn" href={`/monitor/${lab.id}`}>
          View logs
        </Link>
        <Link className="btn primary" href={`/monitor/${lab.id}`}>
          Open live →
        </Link>
      </div>
      <div style={{ padding: "16px 22px" }}>
        <div className="prog">
          <i
            style={{
              width: `${displayPct}%`,
              background: "var(--blue)",
              opacity: indeterminate ? 0.5 : 1,
            }}
          />
        </div>
        <div
          className="mono"
          style={{
            display: "flex",
            justifyContent: "space-between",
            marginTop: 10,
            fontSize: 12,
            color: "var(--ink-mute)",
          }}
        >
          <span>
            {indeterminate
              ? "● awaiting first heartbeat"
              : `● ${counts?.ready ?? 0}/${counts?.total ?? 0} VMs ready`}
          </span>
          <span>updated {formatAge(lab.updated_at)}</span>
        </div>
      </div>
    </div>
  );
}

function RunningCard({
  lab,
  heartbeat,
}: {
  lab: Lab;
  heartbeat: HeartbeatPayload | undefined;
}) {
  const counts = vmCounts(heartbeat);
  return (
    <Link href={`/monitor/${lab.id}`} style={{ textDecoration: "none", color: "inherit" }}>
      <div className="card" style={{ cursor: "pointer", overflow: "hidden" }}>
        <div
          style={{
            background: "var(--bg-1)",
            height: 120,
            padding: 14,
            borderBottom: "1px solid var(--line)",
          }}
        >
          <TopologyPreview labId={lab.id} />
        </div>
        <div style={{ padding: "14px 18px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
            <span
              style={{
                width: 8,
                height: 8,
                background: "var(--green)",
                borderRadius: "50%",
                boxShadow: "0 0 8px rgba(10,124,74,0.6)",
                display: "inline-block",
              }}
            />
            <div className="row-title">{lab.name}</div>
            <div style={{ flex: 1 }} />
            <span className="badge live">
              <span className="d" />
              {counts ? `${counts.ready}/${counts.total} healthy` : "live"}
            </span>
          </div>
          <div className="meta-line mono">
            {lab.topology_slug} · {lab.provider}
            {counts ? ` · ${counts.total} VMs` : ""}
          </div>
          <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap" }}>
            <span className="tag">{lab.topology_slug}</span>
            <span className="tag k">{lab.provider}</span>
            {counts && counts.total > 0 && (
              <span className="tag mono">{counts.total} VMs</span>
            )}
          </div>
        </div>
      </div>
    </Link>
  );
}

function RecentRow({
  lab,
  heartbeat,
}: {
  lab: Lab;
  heartbeat: HeartbeatPayload | undefined;
}) {
  const kind = normaliseStatus(lab.status);
  const dotColor =
    kind === "failed"
      ? "var(--red)"
      : kind === "running"
        ? "var(--green)"
        : kind === "building"
          ? "var(--blue)"
          : "var(--ink-faint)";
  const counts = vmCounts(heartbeat);
  const badge =
    kind === "failed" ? (
      <span className="badge err">
        <span className="d" />
        Failed
      </span>
    ) : kind === "stopped" ? (
      <span className="badge">Stopped</span>
    ) : kind === "running" ? (
      <span className="badge live">
        <span className="d" />
        Running
      </span>
    ) : (
      <span className="badge">{lab.status}</span>
    );
  return (
    <tr>
      <td>
        <span
          style={{
            width: 8,
            height: 8,
            display: "inline-block",
            background: dotColor,
            borderRadius: "50%",
            boxShadow:
              kind === "failed" ? "0 0 8px rgba(204,0,0,0.6)" : undefined,
          }}
        />
      </td>
      <td>
        <div className="row-title">{lab.name}</div>
        <div className="meta-line mono">{lab.topology_slug}</div>
      </td>
      <td>
        <span className="tag">{lab.topology_slug}</span>
      </td>
      <td>
        <span className="mono" style={{ fontSize: 12 }}>
          {lab.provider}
        </span>
      </td>
      <td className="mono">{counts ? counts.total : "—"}</td>
      <td>{badge}</td>
      <td className="age mono" style={{ textAlign: "right" }}>
        {formatAge(lab.updated_at)}
      </td>
      <td>
        <Link className="ico-btn" href={`/monitor/${lab.id}`}>
          ›
        </Link>
      </td>
    </tr>
  );
}

/**
 * Per-lab topology thumbnail: fetches the topology JSON and renders each
 * non-zone node as its corresponding `ILLUSTRATIONS[type]` SVG, sized down
 * to 28 px so we can fit a small horizontal strip. Falls back to a single
 * "no topology" placeholder when the topology isn't available yet.
 */
function TopologyPreview({ labId }: { labId: number }) {
  const topologyQ = useQuery<LabConfig>({
    queryKey: ["lab-topology-thumb", labId],
    queryFn: () => api.getLabTopology(labId),
    // Topologies are effectively immutable for a built lab; only refetch
    // every minute and only when the cache entry is stale.
    staleTime: 60_000,
    refetchInterval: false,
    retry: 0,
  });

  const topo = topologyQ.data;
  const nodes = React.useMemo(() => {
    if (!topo?.nodes) return [];
    // Filter out zone-style nodes (they're containers, not VMs) and any
    // node type we don't have an illustration for.
    return topo.nodes.filter(
      (n) => (n.type as string) !== "zone" && ILLUSTRATIONS[n.type as NodeType] != null,
    );
  }, [topo]);

  if (nodes.length === 0) {
    return (
      <div
        className="mono"
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--ink-faint)",
          fontSize: 11,
        }}
      >
        {topologyQ.isLoading ? "loading topology…" : "no topology"}
      </div>
    );
  }

  const visible = nodes.slice(0, 8);
  const overflow = nodes.length - visible.length;
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        gap: 6,
        flexWrap: "wrap",
      }}
    >
      {visible.map((n) => {
        const type = n.type as NodeType;
        const Illustration = ILLUSTRATIONS[type];
        if (!Illustration) return null;
        return (
          <div
            key={n.id}
            title={`${n.label} (${type})`}
            style={{
              width: 28,
              height: 28,
              flexShrink: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Illustration
              os={n.config.os}
              roles={n.config.roles}
              className="h-7 w-7 select-none"
              size={28}
            />
          </div>
        );
      })}
      {overflow > 0 && (
        <span
          className="mono"
          style={{ fontSize: 11, color: "var(--ink-faint)", marginLeft: 4 }}
        >
          +{overflow}
        </span>
      )}
    </div>
  );
}
