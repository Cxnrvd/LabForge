"use client";

/**
 * /labs — Labs list (matches labforge-designs.html #p3).
 *
 * Visual contract:
 *   - tb2 (tabs) + tb3 (actions) come from PageToolbars.
 *   - 240px filter rail (.filt) + main column (table + inline live-log card).
 *   - All visuals via the .lf .… classes in apps/web/styles/labforge-d10.css.
 *
 * Backend:
 *   - GET /api/v1/labs                          (existing)
 *   - GET /api/v1/labs/{id}/heartbeat           (existing, for node count + last action)
 *   - GET /api/v1/labs/{id}/build/log?since=N   (existing, polled for the inline tail)
 */

import * as React from "react";
import Link from "next/link";
import { useQueries, useQuery } from "@tanstack/react-query";

import { PageToolbars, type TabSpec } from "@/components/dashboard/AppShell";
import { api } from "@/lib/api/client";
import { cn } from "@/lib/utils/cn";

/* ============================================================
   Types — local mirrors of the existing API payloads
   ============================================================ */

interface Lab {
  id: number;
  name: string;
  topology_slug: string;
  provider: string;
  status: string;
  workspace_path?: string | null;
  updated_at: string;
}

interface Heartbeat {
  lab_status: string;
  vms: Array<{ hostname: string; state: string; ip?: string | null }>;
  log_tail: string[];
  captured_at?: string;
}

/* ============================================================
   Static catalogs (display-only)
   ============================================================ */

// Template slug → pill tone. Anything not listed falls through to "mute".
const TEMPLATE_TONE: Record<string, "info" | "warn" | "purple" | "mute" | "act" | "danger"> = {
  "basic-ad": "info",
  "cve-lab-log4shell": "warn",
  "red-team-range": "purple",
  "dfir-lab": "info",
  "smart-factory": "purple",
  "llm-red-team-range": "purple",
  "wan-sim": "info",
};

const TEMPLATE_FILTERS: Array<{ id: string; label: string }> = [
  { id: "basic-ad", label: "basic-ad" },
  { id: "cve-lab-log4shell", label: "cve-lab-log4shell" },
  { id: "red-team-range", label: "red-team-range" },
  { id: "dfir-lab", label: "dfir-lab" },
  { id: "smart-factory", label: "smart-factory" },
  { id: "llm-red-team-range", label: "llm-red-team-range" },
  { id: "wan-sim", label: "wan-sim" },
  { id: "custom", label: "custom" },
];

const PROVIDERS = ["virtualbox", "vmware", "libvirt"] as const;
type Provider = (typeof PROVIDERS)[number];

/* ============================================================
   Helpers
   ============================================================ */

type StatusBucket = "running" | "provisioning" | "halted" | "failed";

function bucketFor(status: string): StatusBucket {
  const s = status.toLowerCase();
  if (s === "running" || s === "partial") return "running";
  if (s === "failed" || s === "aborted" || s === "error") return "failed";
  if (s === "provisioning" || s === "building" || s === "pending" || s === "starting") {
    return "provisioning";
  }
  // TODO: needs backend support — no explicit "halted" state in the API yet;
  // everything that isn't running/failed/provisioning is treated as halted.
  return "halted";
}

function statusDotClass(b: StatusBucket): "run" | "prov" | "stop" | "err" {
  if (b === "running") return "run";
  if (b === "provisioning") return "prov";
  if (b === "failed") return "err";
  return "stop";
}

function uptimeFrom(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "—";
  const diff = Math.max(0, Date.now() - t);
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  if (h < 24) return `${h}h ${rm.toString().padStart(2, "0")}m`;
  const d = Math.floor(h / 24);
  const rh = h % 24;
  return `${d}d ${rh.toString().padStart(2, "0")}h`;
}

function templatePillTone(slug: string): string {
  return TEMPLATE_TONE[slug] ?? "mute";
}

/* ============================================================
   Inline log preview — polled or live-bussed
   ============================================================ */

interface LogCardProps {
  lab: Lab;
  onClose: () => void;
}

function LogCard({ lab, onClose }: LogCardProps): React.ReactElement {
  const [lines, setLines] = React.useState<string[]>([]);
  const [collapsed, setCollapsed] = React.useState(false);
  const offsetRef = React.useRef(0);
  const preRef = React.useRef<HTMLPreElement | null>(null);

  // Reset when the lab id changes — different log file, different offset.
  React.useEffect(() => {
    offsetRef.current = 0;
    setLines([]);
  }, [lab.id]);

  // Poll every 2s. The live-bus helper exists but only ships heartbeats,
  // not raw provisioning log lines, so we stick with the polled endpoint
  // (which is the one the design brief lists).
  useQuery({
    queryKey: ["labs-page-log", lab.id],
    queryFn: async () => {
      const res = await api.buildLog(lab.id, offsetRef.current);
      if (res.lines.length > 0) {
        setLines((prev) => {
          const merged = [...prev, ...res.lines];
          return merged.length > 800 ? merged.slice(-800) : merged;
        });
      }
      offsetRef.current = res.next_offset;
      return res;
    },
    refetchInterval: 2000,
    refetchIntervalInBackground: false,
  });

  // Auto-scroll to the tail whenever new lines arrive (and we're not collapsed).
  React.useEffect(() => {
    if (collapsed) return;
    const el = preRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [lines, collapsed]);

  return (
    <div className="card" style={{ margin: 14 }}>
      <div className="card-h">
        <div className="title" style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button
            type="button"
            onClick={() => setCollapsed((v) => !v)}
            aria-label={collapsed ? "Expand log" : "Collapse log"}
            style={{
              background: "transparent",
              border: 0,
              color: "var(--d10-accent)",
              cursor: "pointer",
              fontSize: 12,
              padding: 0,
            }}
          >
            {collapsed ? "▶" : "▼"}
          </button>
          <span style={{ color: "var(--d10-fg-strong)", fontWeight: 600 }}>{lab.name}</span>
          <span className="mono" style={{ color: "var(--d10-fg-faint)", fontSize: 11 }}>
            /var/log/labforge-provision.log · live
          </span>
        </div>
        <div className="actions">
          <span className="pill mute">tail -f</span>
          <button
            type="button"
            className="btn"
            onClick={onClose}
            aria-label="Close log preview"
          >
            ✕
          </button>
        </div>
      </div>
      <div className="card-b" style={{ padding: 0 }}>
        <pre
          ref={preRef}
          className="code"
          style={{
            display: collapsed ? "none" : "block",
            border: "none",
            borderRadius: 0,
            margin: 0,
            maxHeight: 280,
            overflowY: "auto",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}
        >
          {lines.length === 0 ? (
            <span className="c"># waiting for log output…</span>
          ) : (
            lines.map((ln, i) => <LogLine key={i} text={ln} />)
          )}
        </pre>
      </div>
    </div>
  );
}

/**
 * Highlight the leading token only (matches the mockup):
 *   `# …`   → .c   (faint comment)
 *   `[+] …` → .n   (info blue)
 *   `==> …` → .k   (accent orange)
 *   `✓ …`   → .s   (ok green)
 */
function LogLine({ text }: { text: string }): React.ReactElement {
  let prefixLen = 0;
  let cls: "c" | "n" | "k" | "s" | null = null;

  if (text.startsWith("==>")) {
    cls = "k";
    prefixLen = 3;
  } else if (text.startsWith("[+]")) {
    cls = "n";
    prefixLen = 3;
  } else if (text.startsWith("#")) {
    cls = "c";
    // Whole line for comments — the mockup colors the entire `# …` row.
    return (
      <>
        <span className="c">{text}</span>
        {"\n"}
      </>
    );
  } else if (text.startsWith("✓")) {
    cls = "s";
    prefixLen = 1;
  }

  if (!cls) {
    return <>{text + "\n"}</>;
  }
  return (
    <>
      <span className={cls}>{text.slice(0, prefixLen)}</span>
      {text.slice(prefixLen)}
      {"\n"}
    </>
  );
}

/* ============================================================
   Page
   ============================================================ */

export default function LabsIndex(): React.ReactElement {
  /* ---------- queries ---------- */

  const labsQ = useQuery<Lab[]>({
    queryKey: ["labs"],
    queryFn: () => fetch("/api/v1/labs").then((r) => r.json()),
    refetchInterval: 5000,
  });
  const labs = React.useMemo(() => labsQ.data ?? [], [labsQ.data]);

  // Status counts (used by both tb2 tabs and the .filt status group).
  const counts = React.useMemo(() => {
    const c = { all: labs.length, running: 0, provisioning: 0, halted: 0, failed: 0 };
    for (const l of labs) {
      const b = bucketFor(l.status);
      c[b] += 1;
    }
    return c;
  }, [labs]);

  /* ---------- filter / view state ---------- */

  const [activeTab, setActiveTab] = React.useState<"all" | "running" | "halted" | "failed">("all");
  const [search, setSearch] = React.useState("");
  const [selectedLabId, setSelectedLabId] = React.useState<number | null>(null);

  // .filt Status group — multi-select checkboxes.
  // Default: every box unchecked. An empty selection means "no constraint"
  // so the unfiltered view shows every lab (running, halted, failed, …).
  // Ticking a box narrows the result set; unticking widens it again.
  const [statusFilter, setStatusFilter] = React.useState<Record<StatusBucket, boolean>>({
    running: false,
    provisioning: false,
    halted: false,
    failed: false,
  });

  // Default: every template box unchecked → no constraint, show all labs.
  // Ticking one or more becomes an allow-list.
  const [templateFilter, setTemplateFilter] = React.useState<Record<string, boolean>>(() => ({
    "basic-ad": false,
    "cve-lab-log4shell": false,
    "red-team-range": false,
    "dfir-lab": false,
    "smart-factory": false,
    "llm-red-team-range": false,
    "wan-sim": false,
    custom: false,
  }));

  const [providerFilter, setProviderFilter] = React.useState<Provider>("virtualbox");

  /* ---------- per-row heartbeats (nodes + last action) ---------- */

  const heartbeatQueries = useQueries({
    queries: labs.map((lab) => ({
      queryKey: ["lab-heartbeat-row", lab.id],
      queryFn: () => fetch(`/api/v1/labs/${lab.id}/heartbeat`).then((r) => r.json() as Promise<Heartbeat>),
      // Only poll while the lab is actually live — halted/failed rows don't
      // need a refresh loop, just the one-shot fetch for last-action text.
      refetchInterval:
        bucketFor(lab.status) === "running" || bucketFor(lab.status) === "provisioning"
          ? 8000
          : false,
      staleTime: 4000,
    })),
  });

  const heartbeatByLabId = React.useMemo(() => {
    const m = new Map<number, Heartbeat | undefined>();
    labs.forEach((lab, i) => {
      const q = heartbeatQueries[i];
      m.set(lab.id, q?.data as Heartbeat | undefined);
    });
    return m;
  }, [labs, heartbeatQueries]);

  /* ---------- derived rows (table) ---------- */

  const rows = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    return labs.filter((lab) => {
      const bucket = bucketFor(lab.status);

      // tb2 tab — the dim "+ New view" tab never selects anything.
      if (activeTab === "running" && bucket !== "running" && bucket !== "provisioning") return false;
      if (activeTab === "halted" && bucket !== "halted") return false;
      if (activeTab === "failed" && bucket !== "failed") return false;

      // .filt Status checkboxes — checked statuses form an allow-list; an
      // empty allow-list means "no constraint, show every status".
      const anyStatusChecked = Object.values(statusFilter).some(Boolean);
      if (anyStatusChecked && !statusFilter[bucket]) return false;

      // .filt Template checkboxes — checked templates form an allow-list, but
      // an empty allow-list means "show everything" (otherwise the page is
      // useless until you click something).
      const anyTemplateChecked = Object.values(templateFilter).some(Boolean);
      if (anyTemplateChecked) {
        const matched = Object.entries(templateFilter).some(([slug, on]) => {
          if (!on) return false;
          if (slug === "custom") {
            return !(lab.topology_slug in TEMPLATE_TONE);
          }
          return lab.topology_slug.includes(slug);
        });
        if (!matched) return false;
      }

      // .filt Provider chip
      if (lab.provider && lab.provider !== providerFilter) return false;

      // Search box — name / template / workspace path (≈ "hostname" in the brief)
      if (q) {
        const hay = `${lab.name} ${lab.topology_slug} ${lab.workspace_path ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [labs, activeTab, statusFilter, templateFilter, providerFilter, search]);

  /* ---------- active filter count (for the "⛛ Filter · N" pill) ---------- */

  const activeFilterCount = React.useMemo(() => {
    let n = 0;
    // Defaults are now "all unchecked = no constraint", so any ticked box is
    // a non-default active filter that contributes to the count.
    Object.values(statusFilter).forEach((v) => {
      if (v) n += 1;
    });
    Object.values(templateFilter).forEach((v) => {
      if (v) n += 1;
    });
    if (providerFilter !== "virtualbox") n += 1;
    return n;
  }, [statusFilter, templateFilter, providerFilter]);

  /* ---------- CSV export (client-side) ---------- */

  const handleExportCsv = (): void => {
    const header = ["id", "name", "template", "status", "provider", "updated_at"];
    const csv = [header.join(",")]
      .concat(
        rows.map((l) =>
          [l.id, l.name, l.topology_slug, l.status, l.provider, l.updated_at]
            .map((v) => `"${String(v).replace(/"/g, '""')}"`)
            .join(","),
        ),
      )
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `labforge-labs-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  /* ---------- tabs spec ---------- */

  const tabs: TabSpec[] = [
    {
      id: "all",
      label: "All labs",
      count: counts.all,
      active: activeTab === "all",
      onSelect: () => setActiveTab("all"),
    },
    {
      id: "running",
      label: "Running",
      count: counts.running + counts.provisioning,
      active: activeTab === "running",
      onSelect: () => setActiveTab("running"),
    },
    {
      id: "halted",
      label: "Halted",
      // TODO: needs backend support — no halt state in /api/v1/labs yet, so
      // this count is derived from the "everything else" bucket in bucketFor().
      count: counts.halted,
      active: activeTab === "halted",
      onSelect: () => setActiveTab("halted"),
    },
    {
      id: "failed",
      label: "Failed",
      count: counts.failed,
      countTone: "err",
      active: activeTab === "failed",
      onSelect: () => setActiveTab("failed"),
    },
  ];

  /* ---------- tb3 actions ---------- */

  const actions = (
    <>
      <input
        className="search"
        placeholder="Search labs by name, template, or hostname…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        style={{ width: 240 }}
      />
      <button type="button" className="btn">
        ⛛ Filter
        <span className="pill warn" style={{ marginLeft: 4 }}>
          {activeFilterCount}
        </span>
      </button>
      <button type="button" className="btn">
        ↕ Sort: Uptime
      </button>
      <button type="button" className="btn">
        ≡ Group: Template
      </button>
      <button type="button" className="btn">
        ⎘ Columns
      </button>
      <div className="right">
        <button
          type="button"
          className="btn"
          onClick={() => labsQ.refetch()}
          disabled={labsQ.isFetching}
        >
          ↻ Refresh
        </button>
        <button type="button" className="btn" onClick={handleExportCsv}>
          ↗ Export CSV
        </button>
        <Link className="btn primary" href="/build">
          + New lab
        </Link>
      </div>
    </>
  );

  /* ---------- helpers for the filter rail ---------- */

  const toggleStatus = (k: StatusBucket): void =>
    setStatusFilter((s) => ({ ...s, [k]: !s[k] }));
  const toggleTemplate = (k: string): void =>
    setTemplateFilter((s) => ({ ...s, [k]: !s[k] }));

  // Per-template counts for the rail (over the full unfiltered list).
  const templateCounts = React.useMemo(() => {
    const m: Record<string, number> = {};
    for (const f of TEMPLATE_FILTERS) m[f.id] = 0;
    for (const lab of labs) {
      let matched = false;
      for (const f of TEMPLATE_FILTERS) {
        if (f.id === "custom") continue;
        if (lab.topology_slug.includes(f.id)) {
          m[f.id] = (m[f.id] ?? 0) + 1;
          matched = true;
          break;
        }
      }
      if (!matched) m.custom = (m.custom ?? 0) + 1;
    }
    return m;
  }, [labs]);

  const selectedLab = selectedLabId != null ? labs.find((l) => l.id === selectedLabId) ?? null : null;

  /* ============================================================
     Render
     ============================================================ */

  return (
    <>
      <PageToolbars tabs={tabs} actions={actions} />

      <div style={{ display: "grid", gridTemplateColumns: "240px 1fr", minHeight: 0, flex: 1, overflow: "hidden" }}>
        {/* ----------------- filter rail ----------------- */}
        {/* .filt is already overflow-y: auto; add min-height:0 so the
            grid track allows it to scroll independently. */}
        <div className="filt" style={{ minHeight: 0 }}>
          <div className="group">
            <div className="lh">
              Status <span>−</span>
            </div>
            <label>
              <input
                type="checkbox"
                checked={statusFilter.running}
                onChange={() => toggleStatus("running")}
              />
              <span>Running</span>
              <span className="ct ok">{counts.running}</span>
            </label>
            <label>
              <input
                type="checkbox"
                checked={statusFilter.provisioning}
                onChange={() => toggleStatus("provisioning")}
              />
              <span>Provisioning</span>
              <span className="ct warn">{counts.provisioning}</span>
            </label>
            <label>
              <input
                type="checkbox"
                checked={statusFilter.halted}
                onChange={() => toggleStatus("halted")}
              />
              <span>Halted</span>
              <span className="ct mute">{counts.halted}</span>
            </label>
            <label>
              <input
                type="checkbox"
                checked={statusFilter.failed}
                onChange={() => toggleStatus("failed")}
              />
              <span>Failed</span>
              <span className="ct err">{counts.failed}</span>
            </label>
          </div>

          <div className="group">
            <div className="lh">Template</div>
            {TEMPLATE_FILTERS.map((t) => (
              <label key={t.id}>
                <input
                  type="checkbox"
                  checked={!!templateFilter[t.id]}
                  onChange={() => toggleTemplate(t.id)}
                />
                <span>{t.label}</span>
                <span className="ct">{templateCounts[t.id] ?? 0}</span>
              </label>
            ))}
          </div>

          <div className="group">
            <div className="lh">Provider</div>
            <div className="chip-row">
              {PROVIDERS.map((p) => (
                <span
                  key={p}
                  role="button"
                  tabIndex={0}
                  className={cn("chip", providerFilter === p && "act")}
                  onClick={() => setProviderFilter(p)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") setProviderFilter(p);
                  }}
                >
                  {p}
                </span>
              ))}
            </div>
          </div>

        </div>

        {/* ----------------- main column ----------------- */}
        <div style={{ minWidth: 0, minHeight: 0, overflowY: "auto" }}>
          <table>
            <thead>
              <tr>
                <th>Lab</th>
                <th>Template</th>
                <th>Status</th>
                <th>Nodes</th>
                <th>Provider</th>
                <th>Uptime</th>
                <th>Last action</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {labsQ.isLoading && (
                <tr>
                  <td colSpan={8} style={{ color: "var(--d10-fg-faint)" }}>
                    Loading labs…
                  </td>
                </tr>
              )}
              {!labsQ.isLoading && rows.length === 0 && (
                <tr>
                  <td colSpan={8} style={{ color: "var(--d10-fg-faint)" }}>
                    No labs match the current filters.{" "}
                    <Link href="/build" style={{ color: "var(--d10-accent)" }}>
                      Open the builder
                    </Link>{" "}
                    to create one.
                  </td>
                </tr>
              )}
              {rows.map((lab) => {
                const bucket = bucketFor(lab.status);
                const hb = heartbeatByLabId.get(lab.id);
                const nodeCount = hb?.vms?.length;
                const lastAction =
                  hb?.log_tail && hb.log_tail.length > 0
                    ? hb.log_tail[hb.log_tail.length - 1]?.slice(0, 60) ?? "—"
                    : "—";
                const isSelected = selectedLabId === lab.id;
                return (
                  <tr
                    key={lab.id}
                    onClick={() => setSelectedLabId(isSelected ? null : lab.id)}
                    style={{
                      cursor: "pointer",
                      background: isSelected ? "var(--d10-bg-elev-1)" : undefined,
                    }}
                  >
                    <td>
                      <strong>{lab.name}</strong>
                      <br />
                      <span className="sub mono">
                        {lab.workspace_path ?? `~/labs/${lab.topology_slug}`}
                      </span>
                    </td>
                    <td>
                      <span className={cn("pill", templatePillTone(lab.topology_slug))}>
                        {lab.topology_slug}
                      </span>
                    </td>
                    <td>
                      <span className={cn("sd", statusDotClass(bucket))} />
                      {lab.status}
                    </td>
                    <td>{nodeCount ?? "—"}</td>
                    <td className="mono">{lab.provider}</td>
                    <td>{bucket === "running" ? uptimeFrom(lab.updated_at) : "—"}</td>
                    <td className="mono" style={{ color: "var(--d10-fg-faint)" }}>
                      {lastAction}
                    </td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <Link
                        href={`/monitor/${lab.id}`}
                        className="btn primary"
                        style={{ textDecoration: "none" }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        Monitor →
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {selectedLab && (
            <LogCard lab={selectedLab} onClose={() => setSelectedLabId(null)} />
          )}
        </div>
      </div>
    </>
  );
}
