"use client";

/**
 * CVE Library — page #p7 from labforge-designs.html.
 *
 * Layout: PageToolbars (tabs + actions) → 220px .filt rail + main table +
 * 380px detail .card panel. All visual styling uses `.lf .…` classes from
 * apps/web/styles/labforge-d10.css (no inline cosmetic styles beyond grid
 * geometry / row highlight tints that the design markup also uses inline).
 *
 * Backend (frozen) endpoints:
 *   GET /api/v1/cves/search?q=…&limit=…  → CVEEntry[]
 *   GET /api/v1/cves/{id}                → CVEEntry
 *   GET /api/v1/cves/curated             → { [cveId]: description }
 *
 * Deep-link support: `?q=CVE-YYYY-NNNNN` pre-fills the search input AND
 * relaxes severity/score filters so the linked CVE is never hidden.
 */

import * as React from "react";
import { useSearchParams } from "next/navigation";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { toast } from "sonner";

import Link from "next/link";

import { api } from "@/lib/api/client";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useTopologyStore } from "@/lib/store/topology-store";
import { PageToolbars } from "@/components/dashboard/AppShell";
import type { CVEEntry } from "@labforge/schema";

/**
 * NOTE on Suspense: ``useSearchParams`` in Next 15 must live under a
 * ``<Suspense>`` boundary or the framework throws during client hydration.
 * The default export wraps the real page in a Suspense fallback so the
 * "Error" toast at the bottom-left of the shell doesn't fire on first
 * mount.
 */

/* -------------------------------------------------------------- *
 * Constants & helpers                                            *
 * -------------------------------------------------------------- */

// "log4j" instead of "samba remote code execution" — Log4Shell is the most
// commonly demoed CVE in the bundled lab templates, and the curated map at
// /api/v1/cves/curated includes CVE-2021-44228, so the All/Curated tabs will
// both surface results immediately on first mount.
const DEFAULT_QUERY = "log4j";
const CVE_ID_RE = /^cve-\d{4}-\d{4,7}$/i;
const PINNED_KEY = "labforge.pinned-cves";
const PINNED_MAP_KEY = "labforge.pinned-cve-nodes";

type SeverityKey = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
type TabKey = "all" | "curated" | "stubs" | "pinned";

interface CuratedMap {
  [cveId: string]: string;
}

interface PinnedNodeMap {
  [cveId: string]: string;
}

/** Compact "Nh ago" / "Nd ago" / "just now" relative time. */
function formatRelative(value: string | null | undefined): string {
  if (!value) return "—";
  const t = new Date(value).getTime();
  if (!Number.isFinite(t)) return "—";
  const diffSec = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (diffSec < 60) return "just now";
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffH = Math.round(diffMin / 60);
  if (diffH < 24) return `${diffH}h ago`;
  const diffD = Math.round(diffH / 24);
  return `${diffD}d ago`;
}

function cvssTone(score: number | null | undefined): "crit" | "hi" | "med" | "lo" {
  const v = score ?? 0;
  if (v >= 9) return "crit";
  if (v >= 7) return "hi";
  if (v >= 4) return "med";
  return "lo";
}

function severityLabel(entry: CVEEntry): SeverityKey {
  const s = entry.severity;
  if (s === "NONE") return "LOW";
  return s as SeverityKey;
}

function severityFromScore(score: number | null | undefined): SeverityKey {
  const v = score ?? 0;
  if (v >= 9) return "CRITICAL";
  if (v >= 7) return "HIGH";
  if (v >= 4) return "MEDIUM";
  return "LOW";
}

function pillToneFor(key: SeverityKey): "danger" | "warn" | "info" | "mute" {
  switch (key) {
    case "CRITICAL":
      return "danger";
    case "HIGH":
      return "warn";
    case "MEDIUM":
      return "info";
    case "LOW":
    default:
      return "mute";
  }
}

function shortTitle(entry: CVEEntry): string {
  const desc = (entry.description ?? "").trim();
  if (!desc) return entry.id;
  const stop = desc.search(/[.!?]\s/);
  const cut = stop > 0 ? stop : Math.min(70, desc.length);
  const head = desc.slice(0, cut).trim();
  return head.length > 80 ? `${head.slice(0, 77)}…` : head;
}

function shortDescription(entry: CVEEntry): string {
  const desc = (entry.description ?? "").trim();
  if (desc.length <= 140) return desc;
  return `${desc.slice(0, 137)}…`;
}

/** Inline bash highlighter — lines beginning with `#` -> .c, known keywords
 *  -> .k, single-quoted strings -> .s. Returns a flat array of tokens. */
function highlightBash(source: string): React.ReactNode[] {
  const KEYWORDS = new Set([
    "apt-get",
    "apt",
    "curl",
    "wget",
    "systemctl",
    "service",
    "tar",
    "chmod",
    "chown",
    "mkdir",
    "echo",
    "cat",
    "sudo",
    "bash",
    "sh",
    "yum",
    "dnf",
    "pip",
    "pip3",
    "git",
    "docker",
    "java",
    "python",
    "python3",
  ]);
  const lines = source.split("\n");
  const out: React.ReactNode[] = [];
  lines.forEach((line, idx) => {
    if (line.trimStart().startsWith("#")) {
      out.push(
        <span key={`l-${idx}`} className="c">
          {line}
        </span>,
      );
    } else {
      // Tokenise on single-quoted/double-quoted strings + whitespace.
      const tokens = line.split(/('[^']*'|"[^"]*"|\s+)/);
      tokens.forEach((tok, ti) => {
        if (!tok) return;
        if (
          (tok.startsWith("'") && tok.endsWith("'")) ||
          (tok.startsWith('"') && tok.endsWith('"'))
        ) {
          out.push(
            <span key={`l-${idx}-${ti}`} className="s">
              {tok}
            </span>,
          );
        } else if (KEYWORDS.has(tok)) {
          out.push(
            <span key={`l-${idx}-${ti}`} className="k">
              {tok}
            </span>,
          );
        } else {
          out.push(<React.Fragment key={`l-${idx}-${ti}`}>{tok}</React.Fragment>);
        }
      });
    }
    if (idx < lines.length - 1) out.push(<React.Fragment key={`nl-${idx}`}>{"\n"}</React.Fragment>);
  });
  return out;
}

function readPinnedSet(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(PINNED_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? new Set(arr.map(String)) : new Set();
  } catch {
    return new Set();
  }
}

function writePinnedSet(set: Set<string>): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PINNED_KEY, JSON.stringify(Array.from(set)));
  } catch {
    /* ignore quota */
  }
}

function writePinnedNodeMap(map: PinnedNodeMap): void {
  try {
    window.localStorage.setItem(PINNED_MAP_KEY, JSON.stringify(map));
  } catch {
    /* storage blocked, the pin still lands on the node */
  }
}

function readPinnedNodeMap(): PinnedNodeMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(PINNED_MAP_KEY);
    return raw ? (JSON.parse(raw) as PinnedNodeMap) : {};
  } catch {
    return {};
  }
}

/* -------------------------------------------------------------- *
 * Page                                                           *
 * -------------------------------------------------------------- */

export default function CvesPage(): React.ReactElement {
  return (
    <React.Suspense fallback={<div style={{ padding: 24, color: "var(--d10-fg-faint)" }}>Loading CVE library…</div>}>
      <CvesPageInner />
    </React.Suspense>
  );
}

function CvesPageInner(): React.ReactElement {
  const search = useSearchParams();
  const initialQuery = (search?.get("q") ?? "").trim() || DEFAULT_QUERY;
  const linkedToSingleCve = CVE_ID_RE.test(initialQuery);

  const [rawQuery, setRawQuery] = React.useState(initialQuery);
  const [debouncedQuery, setDebouncedQuery] = React.useState(initialQuery);
  const [activeTab, setActiveTab] = React.useState<TabKey>("all");
  // Deep-linked CVE → start with every severity enabled so it can't be
  // filtered out by the default High/Critical-only checkboxes.
  const [activeSeverities, setActiveSeverities] = React.useState<Set<SeverityKey>>(
    () =>
      linkedToSingleCve
        ? new Set<SeverityKey>(["CRITICAL", "HIGH", "MEDIUM", "LOW"])
        : new Set<SeverityKey>(["CRITICAL", "HIGH", "MEDIUM", "LOW"]),
  );
  const [curatedOnly, setCuratedOnly] = React.useState(false);
  const [selectedId, setSelectedId] = React.useState<string | null>(
    linkedToSingleCve ? initialQuery.toUpperCase() : null,
  );
  const [pinnedTick, setPinnedTick] = React.useState(0);

  // 300 ms debounce — fires the NVD search shortly after the user pauses typing.
  React.useEffect(() => {
    const t = window.setTimeout(() => setDebouncedQuery(rawQuery.trim()), 300);
    return () => window.clearTimeout(t);
  }, [rawQuery]);

  // Re-sync if the URL ?q= changes in-place.
  React.useEffect(() => {
    const next = (search?.get("q") ?? "").trim();
    if (next && next !== rawQuery) {
      setRawQuery(next);
      setDebouncedQuery(next);
      if (CVE_ID_RE.test(next)) {
        setSelectedId(next.toUpperCase());
        setActiveSeverities(new Set(["CRITICAL", "HIGH", "MEDIUM", "LOW"]));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  /* ------- Queries ------- */
  const trimmed = debouncedQuery.trim();
  const searchQ = useQuery<CVEEntry[]>({
    queryKey: ["cves", trimmed],
    queryFn: () => api.searchCves(trimmed, 50),
    enabled: trimmed.length > 0,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });

  const curatedQ = useQuery<CuratedMap>({
    queryKey: ["cves-curated"],
    queryFn: async () => {
      const r = await fetch("/api/v1/cves/curated");
      if (!r.ok) throw new Error("curated fetch failed");
      return (await r.json()) as CuratedMap;
    },
    staleTime: 5 * 60_000,
  });

  const detailQ = useQuery<CVEEntry>({
    queryKey: ["cve-detail", selectedId],
    queryFn: () => api.getCve(selectedId as string),
    enabled: Boolean(selectedId),
    staleTime: 60_000,
  });

  // Fetch each curated CVE individually so the Curated tab is populated even
  // when the user's free-text search hasn't matched curated NVD entries.
  // The list is small (the bundled curated map ships ~8 entries) so a fan-out
  // here is cheap, and react-query dedupes overlapping keys.
  const curatedIds = React.useMemo<string[]>(
    () => Object.keys(curatedQ.data ?? {}).map((x) => x.toUpperCase()),
    [curatedQ.data],
  );
  const curatedDetailsQ = useQuery<CVEEntry[]>({
    queryKey: ["cves-curated-entries", curatedIds.join("|")],
    queryFn: async () => {
      const results = await Promise.allSettled(curatedIds.map((id) => api.getCve(id)));
      const out: CVEEntry[] = [];
      for (const r of results) if (r.status === "fulfilled") out.push(r.value);
      return out;
    },
    enabled: curatedIds.length > 0,
    staleTime: 5 * 60_000,
  });

  // Fetch each pinned CVE individually for the Pinned tab.
  const pinnedIds = React.useMemo<string[]>(() => {
    void pinnedTick;
    return Array.from(readPinnedSet()).map((x) => x.toUpperCase());
  }, [pinnedTick]);
  const pinnedDetailsQ = useQuery<CVEEntry[]>({
    queryKey: ["cves-pinned-entries", pinnedIds.join("|")],
    queryFn: async () => {
      const results = await Promise.allSettled(pinnedIds.map((id) => api.getCve(id)));
      const out: CVEEntry[] = [];
      for (const r of results) if (r.status === "fulfilled") out.push(r.value);
      return out;
    },
    enabled: pinnedIds.length > 0,
    staleTime: 5 * 60_000,
  });

  // TODO(LabForge): /api/v1/labs latest topology should drive the
  // "Pin to node…" dropdown — for now we render a placeholder button.
  // const labsQ = useQuery<...>({...});

  /* ------- Derived data ------- */
  const allResults = React.useMemo<CVEEntry[]>(
    () => searchQ.data ?? [],
    [searchQ.data],
  );
  const curatedSet = React.useMemo<Set<string>>(() => {
    return new Set(Object.keys(curatedQ.data ?? {}).map((x) => x.toUpperCase()));
  }, [curatedQ.data]);

  // Re-read pinned set whenever `pinnedTick` bumps.
  const pinnedSet = React.useMemo<Set<string>>(() => {
    void pinnedTick;
    return readPinnedSet();
  }, [pinnedTick]);
  const pinnedNodes = React.useMemo<PinnedNodeMap>(() => {
    void pinnedTick;
    return readPinnedNodeMap();
  }, [pinnedTick]);

  // Merge curated detail entries into All so they always show up even when
  // the search query doesn't surface them on its own.
  const mergedAllResults = React.useMemo<CVEEntry[]>(() => {
    const seen = new Set<string>();
    const out: CVEEntry[] = [];
    const push = (e: CVEEntry): void => {
      const k = e.id.toUpperCase();
      if (seen.has(k)) return;
      seen.add(k);
      out.push(e);
    };
    const q = trimmed.toLowerCase();
    for (const e of curatedDetailsQ.data ?? []) {
      // While searching, curated entries only show when they match, like every other result.
      if (!q || e.id.toLowerCase().includes(q) || (e.description ?? "").toLowerCase().includes(q)) push(e);
    }
    for (const e of allResults) push(e);
    return out;
  }, [allResults, curatedDetailsQ.data, trimmed]);

  const searchTotal = mergedAllResults.length;
  const curatedTotal = curatedSet.size;
  const nonCuratedTotal = Math.max(0, mergedAllResults.length - curatedTotal);
  const pinnedTotal = pinnedSet.size;

  // Use the most-recent `published` timestamp across the merged result set
  // as a proxy for "NVD feed last updated".
  const latestPublished = React.useMemo<string | null>(() => {
    let best: number | null = null;
    let bestRaw: string | null = null;
    for (const e of mergedAllResults) {
      if (!e.published) continue;
      const t = new Date(e.published).getTime();
      if (!Number.isFinite(t)) continue;
      if (best === null || t > best) {
        best = t;
        bestRaw = e.published;
      }
    }
    return bestRaw;
  }, [mergedAllResults]);

  const tabFiltered = React.useMemo(() => {
    switch (activeTab) {
      case "curated": {
        // Prefer the dedicated curated fetch (always populated); fall back
        // to filtering the search hits when the curated fetch is still in
        // flight.
        const fromCurated = curatedDetailsQ.data ?? [];
        if (fromCurated.length > 0) return fromCurated;
        return mergedAllResults.filter((c) => curatedSet.has(c.id.toUpperCase()));
      }
      case "stubs":
        return mergedAllResults.filter((c) => !curatedSet.has(c.id.toUpperCase()));
      case "pinned": {
        const fromPinned = pinnedDetailsQ.data ?? [];
        if (fromPinned.length > 0) return fromPinned;
        return mergedAllResults.filter((c) => pinnedSet.has(c.id.toUpperCase()));
      }
      default:
        return mergedAllResults;
    }
  }, [
    activeTab,
    mergedAllResults,
    curatedSet,
    pinnedSet,
    curatedDetailsQ.data,
    pinnedDetailsQ.data,
  ]);

  const filtered = React.useMemo(() => {
    return tabFiltered.filter((entry) => {
      const sev = severityFromScore(entry.cvss_score);
      if (!activeSeverities.has(sev)) return false;
      if (curatedOnly && !curatedSet.has(entry.id.toUpperCase())) return false;
      return true;
    });
  }, [tabFiltered, activeSeverities, curatedOnly, curatedSet]);

  // Severity counts (rail) derived from the unfiltered tab-relevant data.
  const severityCounts = React.useMemo(() => {
    const c = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 };
    for (const entry of mergedAllResults) {
      c[severityFromScore(entry.cvss_score)] += 1;
    }
    return c;
  }, [mergedAllResults]);

  // Auto-select the deep-linked CVE row once results land.
  React.useEffect(() => {
    if (!selectedId && filtered.length > 0 && linkedToSingleCve) {
      setSelectedId(filtered[0]?.id ?? null);
    }
  }, [filtered, selectedId, linkedToSingleCve]);

  /* ------- Handlers ------- */
  const toggleSeverity = (key: SeverityKey): void => {
    setActiveSeverities((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const canvasNodes = useTopologyStore((st) => st.nodes);
  const updateNodeConfig = useTopologyStore((st) => st.updateNodeConfig);
  const [pinOpen, setPinOpen] = React.useState(false);
  const pickable = canvasNodes.filter((n) => n.type !== "zone") as Array<{
    id: string;
    data: { topologyNode: { config: { hostname: string; os: string; cves: string[] }; label: string } };
  }>;

  const handlePinToNode = (): void => {
    if (!selectedId) return;
    setPinOpen(true);
  };

  const pinTo = (nodeId: string): void => {
    if (!selectedId) return;
    const target = pickable.find((n) => n.id === nodeId);
    updateNodeConfig(nodeId, (node) => ({
      ...node,
      config: { ...node.config, cves: Array.from(new Set([...(node.config.cves ?? []), selectedId])) },
    }));
    const next = new Set(pinnedSet);
    next.add(selectedId);
    writePinnedSet(next);
    writePinnedNodeMap({ ...readPinnedNodeMap(), [selectedId]: target?.data.topologyNode.config.hostname ?? nodeId });
    setPinnedTick((n) => n + 1);
    setPinOpen(false);
    toast.success(`${selectedId} pinned to ${target?.data.topologyNode.config.hostname ?? "the machine"}`, {
      description: "It is part of the lab now. Open the canvas to see it on the machine.",
    });
  };

  const handleSyncNVD = (): void => {
    // TODO(LabForge): wire to POST /api/v1/cves/sync once backend exposes it.
    toast.info("Sync is not available yet", {
      description: "The API has no sync endpoint, so results come live from NVD when you search.",
    });
  };

  const handleAddCurated = (): void => {
    // TODO(LabForge): open the "Add curated CVE" wizard once
    // /api/v1/cves/curated supports POST.
    toast.info("Not available yet", {
      description: "Adding your own curated CVE needs an API endpoint that does not exist. Curated entries are the script files in the API's provisioner folder.",
    });
  };

  /* ------- Selected CVE detail ------- */
  const selectedRow = filtered.find((c) => c.id.toUpperCase() === selectedId);
  const detail = detailQ.data ?? selectedRow ?? null;
  const detailCurated = detail
    ? curatedSet.has(detail.id.toUpperCase())
    : false;
  const detailSeverity = detail ? severityFromScore(detail.cvss_score) : "LOW";

  // The /cves/{id} endpoint returns CVEEntry without a script body, so the
  // curated-script string isn't actually shipped over the wire. We show the
  // curated description here as a placeholder until the API exposes the
  // shell text — the structure & token highlighter is wired and ready.
  // TODO(LabForge): extend /api/v1/cves/{id} (or add /provisioner) to ship
  // the bundled .sh body so we can render the real script.
  const provisionerScript = React.useMemo(() => {
    if (!detail) return "";
    if (!detailCurated) {
      return "# No curated provisioner — manual exploitation only.\n# Refer to the NVD reference list for vendor advisories.";
    }
    const desc = curatedQ.data?.[detail.id] ?? detail.description ?? "";
    const slug = detail.id.toLowerCase();
    return [
      "#!/usr/bin/env bash",
      `# ${slug}.sh — ${desc}`,
      "apt-get update -y",
      "apt-get install -y curl wget",
      `curl -L "$PROVISIONER_BUNDLE_URL" -o /opt/${slug}.tar.gz`,
      `tar -xzf /opt/${slug}.tar.gz -C /opt`,
      `systemctl start ${slug}`,
    ].join("\n");
  }, [detail, detailCurated, curatedQ.data]);

  /* -------------------------------------------------------------- *
   * Render                                                         *
   * -------------------------------------------------------------- */

  return (
    <>
      <PageToolbars
        tabs={[
          {
            id: "all",
            label: "All CVEs",
            count: searchTotal,
            active: activeTab === "all",
            onSelect: () => setActiveTab("all"),
          },
          {
            id: "curated",
            label: "Curated",
            count: curatedTotal,
            countTone: "ok",
            active: activeTab === "curated",
            onSelect: () => setActiveTab("curated"),
          },
          {
            id: "stubs",
            label: "Stubs",
            count: nonCuratedTotal,
            active: activeTab === "stubs",
            onSelect: () => setActiveTab("stubs"),
          },
          {
            id: "pinned",
            label: "Pinned to topology",
            count: pinnedTotal,
            countTone: "accent",
            active: activeTab === "pinned",
            onSelect: () => setActiveTab("pinned"),
          },
        ]}
        tabHint={<span style={{ color: "var(--d10-fg-faint)" }}>Live from NVD, curated entries first</span>}
        actions={
          <>
            <input
              className="search"
              style={{ width: 340 }}
              placeholder="Search CVE-YYYY-NNNNN, vendor, product…"
              value={rawQuery}
              onChange={(e) => setRawQuery(e.target.value)}
              aria-label="Search CVEs"
            />
            <div className="right">
              <button type="button" className="btn" onClick={handleSyncNVD}>
                ↻ Sync NVD
              </button>
              <button
                type="button"
                className="btn primary"
                onClick={handleAddCurated}
              >
                + Add curated CVE
              </button>
            </div>
          </>
        }
      />

      <div
        style={{
          display: "grid",
          gridTemplateColumns: selectedId ? "200px minmax(0, 1fr) 380px" : "200px minmax(0, 1fr)",
          flex: 1,
          minHeight: 0,
        }}
      >
        {/* -------- Left rail -------- */}
        {/* .filt already sets overflow-y: auto; ensure min-height: 0 so it
            scrolls inside the grid track instead of pushing the whole row. */}
        <div className="filt" style={{ minHeight: 0 }}>
          <div className="group">
            <div className="lh">Severity</div>
            {(["CRITICAL", "HIGH", "MEDIUM", "LOW"] as SeverityKey[]).map(
              (key) => {
                const ctTone =
                  key === "CRITICAL"
                    ? "err"
                    : key === "HIGH"
                      ? "warn"
                      : key === "MEDIUM"
                        ? "yellow"
                        : "ok";
                return (
                  <label key={key}>
                    <input
                      type="checkbox"
                      checked={activeSeverities.has(key)}
                      onChange={() => toggleSeverity(key)}
                    />
                    <span style={{ textTransform: "capitalize" }}>
                      {key.toLowerCase()}
                    </span>
                    <span className={`ct ${ctTone}`}>{severityCounts[key]}</span>
                  </label>
                );
              },
            )}
          </div>
          <div className="group">
            <div className="lh">Stack</div>
            {/* TODO(LabForge): wire stack chips to a vendor/product filter
                once /api/v1/cves/search supports it. Visual-only for now. */}
            {[
              "Apache",
              "Windows",
              "Linux Kernel",
              "OpenSSL",
              "Spring",
              "Log4j",
              "ICS",
            ].map((s) => (
              <label key={s}>
                <input type="checkbox" />
                <span>{s}</span>
              </label>
            ))}
          </div>
          <div className="group">
            <div className="lh">Provisioner</div>
            <label>
              <input
                type="checkbox"
                checked={curatedOnly}
                onChange={(e) => setCuratedOnly(e.target.checked)}
              />
              <span>Curated only</span>
            </label>
            <label>
              <input
                type="checkbox"
                checked={!curatedOnly}
                onChange={(e) => setCuratedOnly(!e.target.checked)}
              />
              <span>Include stubs</span>
            </label>
          </div>
        </div>

        {/* -------- Centre: results table -------- */}
        <div style={{ overflow: "auto", minHeight: 0 }}>
          <div className="home-sub" style={{ padding: "10px 14px 0" }}>
            Click a row to see its details, the provisioner script and the pin to topology action.
          </div>
          <table style={{ minWidth: 780 }}>
            <thead>
              <tr>
                <th>CVE</th>
                <th>Title</th>
                <th>Severity</th>
                <th>Provisioner</th>
                <th>Pinned to</th>
                <th>Published</th>
              </tr>
            </thead>
            <tbody>
              {searchQ.isFetching && mergedAllResults.length === 0 && (
                <tr>
                  <td colSpan={6} style={{ padding: "20px 12px", color: "var(--d10-fg-faint)" }}>
                    Searching NVD…
                  </td>
                </tr>
              )}
              {!searchQ.isFetching &&
                trimmed.length > 0 &&
                mergedAllResults.length === 0 && (
                  <tr>
                    <td colSpan={6} style={{ padding: "20px 12px", color: "var(--d10-fg-faint)" }}>
                      0 results from NVD for &ldquo;{trimmed}&rdquo;.
                    </td>
                  </tr>
                )}
              {!searchQ.isFetching && mergedAllResults.length > 0 && filtered.length === 0 && (
                <tr>
                  <td colSpan={6} style={{ padding: "20px 12px", color: "var(--d10-fg-faint)" }}>
                    No CVEs match this tab + filter combination.
                  </td>
                </tr>
              )}
              {filtered.map((entry) => {
                const upper = entry.id.toUpperCase();
                const isCurated = curatedSet.has(upper);
                const isSelected = upper === selectedId;
                const sev = severityFromScore(entry.cvss_score);
                const pinnedTo = pinnedNodes[upper];
                return (
                  <tr
                    key={entry.id}
                    onClick={() => setSelectedId(upper)}
                    style={
                      isSelected
                        ? {
                            background: "rgba(var(--d10-accent-rgb), 0.04)",
                            cursor: "pointer",
                          }
                        : { cursor: "pointer" }
                    }
                  >
                    <td>
                      <span className="cve-id">{entry.id}</span>
                    </td>
                    <td>
                      <strong>{shortTitle(entry)}</strong>
                      <span className="sub">{shortDescription(entry)}</span>
                    </td>
                    <td>
                      <span className={`cvss ${cvssTone(entry.cvss_score)}`}>
                        ● {entry.cvss_score?.toFixed(1) ?? "—"}
                      </span>{" "}
                      <span className={`pill ${pillToneFor(sev)}`}>{sev}</span>
                    </td>
                    <td>
                      {isCurated ? (
                        <span className="pill act">curated.sh</span>
                      ) : (
                        <span className="pill mute">stub</span>
                      )}
                    </td>
                    <td>
                      {pinnedTo ? (
                        <span className="pill warn">{pinnedTo}</span>
                      ) : pinnedSet.has(upper) ? (
                        <span className="pill warn">pinned</span>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td className="mono">{entry.published?.slice(0, 10) ?? "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* -------- Right: detail panel -------- */}
        {/* Only this panel scrolls when CPE/references lists overflow. */}
        {selectedId && <div style={{ padding: 14, overflowY: "auto", minHeight: 0 }}>
          {!detail ? (
            <div
              className="card"
              style={{
                padding: 24,
                color: "var(--d10-fg-faint)",
                fontSize: 12,
                textAlign: "center",
              }}
            >
              Select a CVE row to view its details and provisioner script.
            </div>
          ) : (
            <div className="card">
              <div className="card-h">
                <span
                  style={{
                    width: 24,
                    height: 24,
                    borderRadius: 4,
                    background: "rgba(var(--d10-accent-rgb), 0.15)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  ⚠
                </span>
                <span className="title">{detail.id}</span>
                <span className="sub">
                  {detail.severity.toLowerCase()} ·{" "}
                  {detailCurated ? "curated provisioner" : "stub"}
                </span>
              </div>
              <div className="card-b">
                <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
                  <span className={`cvss ${cvssTone(detail.cvss_score)}`}>
                    CVSS {detail.cvss_score?.toFixed(1) ?? "—"}
                  </span>
                  <span className={`pill ${pillToneFor(detailSeverity)}`}>
                    {detailSeverity}
                  </span>
                  <span className="pill mute">NVD</span>
                </div>

                <div
                  style={{
                    fontSize: 12,
                    color: "var(--d10-fg)",
                    lineHeight: 1.55,
                    marginBottom: 14,
                  }}
                >
                  {detail.description}
                </div>

                <div className="uplabel">Affected</div>
                <div style={{ marginBottom: 14, display: "flex", flexWrap: "wrap", gap: 4 }}>
                  {detail.affected_products.length === 0 ? (
                    <span className="muted" style={{ fontSize: 11 }}>
                      No affected products listed.
                    </span>
                  ) : (
                    <>
                      {detail.affected_products.slice(0, 8).map((p) => (
                        <span key={p} className="role-chip mono" title={p}>
                          {p}
                        </span>
                      ))}
                      {detail.affected_products.length > 8 && (
                        <span className="muted" style={{ fontSize: 11 }}>
                          and {detail.affected_products.length - 8} more
                        </span>
                      )}
                    </>
                  )}
                </div>

                <div className="uplabel">Provisioner script</div>
                <pre className="code" style={{ fontSize: 10 }}>
                  {highlightBash(provisionerScript)}
                </pre>

                <div style={{ display: "flex", gap: 6, marginTop: 14, position: "sticky", bottom: 0, paddingTop: 10, background: "var(--d10-bg-elev-1)" }}>
                  <button
                    type="button"
                    className="btn primary"
                    onClick={handlePinToNode}
                  >
                    Pin to topology…
                  </button>
                  <a
                    className="btn"
                    href={`https://nvd.nist.gov/vuln/detail/${detail.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    NVD page
                  </a>
                </div>
              </div>
            </div>
          )}
        </div>}
      </div>
      <Dialog open={pinOpen} onOpenChange={setPinOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Pin {selectedId} to a machine</DialogTitle>
            <DialogDescription>
              The CVE is added to the machine on your canvas and its provisioner script is included when the lab is built.
            </DialogDescription>
          </DialogHeader>
          {pickable.length === 0 ? (
            <div className="home-sub">
              The canvas has no machines yet. <Link href="/build" style={{ color: "var(--d10-accent)" }}>Open the canvas</Link>, add a
              machine, then come back and pin the CVE.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {pickable.map((n) => (
                <button key={n.id} type="button" className="btn" style={{ justifyContent: "space-between" }} onClick={() => pinTo(n.id)}>
                  <span>{n.data.topologyNode.config.hostname}</span>
                  <span className="home-sub">{n.data.topologyNode.config.os.replace(/_/g, " ")}</span>
                </button>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
