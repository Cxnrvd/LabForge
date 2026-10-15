"use client";

/**
 * /labs/[id] — Per-lab page (Nodes tab) per labforge-designs.html #p5.
 *
 * Visual contract:
 *   - tb2 tabs: Overview / Topology / Nodes (active) / Activity / Settings.
 *   - tb3: status pill + refresh + open-in-canvas link.
 *   - 3-column body:
 *       left rail  (240px) — node list with .sd status dots, click to select
 *       center            — selected node card (illustration + meta + roles)
 *       right rail (320px) — vendor catalog grid filtered by category tabs
 *
 * Selection is URL-driven via ?panel=node&nodeId=<id>. If no nodeId is
 * supplied we fall back to the first node in the topology. The vendor
 * grid is click-to-add — mutations are local to this page (UI-only per
 * the brief; we don't PATCH the topology here).
 */

import * as React from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";

import { PageToolbars, type TabSpec } from "@/components/dashboard/AppShell";
import { api } from "@/lib/api/client";
import { ILLUSTRATIONS } from "@/components/canvas/illustrations";
import { VendorIconInner } from "@/components/icons/VendorIcon";
import {
  CATEGORY_ORDER,
  encodeRole,
  type IconCategory,
  lookupVendor,
  parseRole,
  type VendorEntry,
  vendorsByCategory,
} from "@/lib/icons/catalog";
import { cn } from "@/lib/utils/cn";
import type { LabConfig, NodeType, TopologyNode } from "@labforge/schema";

/* ============================================================
   Types — local mirrors of the labs API payload
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

/* ============================================================
   Helpers
   ============================================================ */

type StatusBucket = "running" | "provisioning" | "halted" | "failed";

function bucketFor(status: string): StatusBucket {
  const s = (status ?? "").toLowerCase();
  if (s === "running" || s === "partial") return "running";
  if (s === "failed" || s === "aborted" || s === "error") return "failed";
  if (
    s === "provisioning" ||
    s === "building" ||
    s === "pending" ||
    s === "starting"
  ) {
    return "provisioning";
  }
  return "halted";
}

function statusDotClass(b: StatusBucket): "run" | "prov" | "stop" | "err" {
  if (b === "running") return "run";
  if (b === "provisioning") return "prov";
  if (b === "failed") return "err";
  return "stop";
}

function statusPillTone(b: StatusBucket): "act" | "warn" | "danger" | "mute" {
  if (b === "running") return "act";
  if (b === "provisioning") return "warn";
  if (b === "failed") return "danger";
  return "mute";
}

function osLabel(os: string): string {
  // Lightweight OS pretty-printer — avoids pulling in the OS_LABELS map from
  // the schema package (it's a const enum-style record and the names are
  // already human-readable once snake_case is unwound).
  return os.replace(/_/g, " ");
}

function nodeTypeLabel(t: NodeType): string {
  return t.replace(/_/g, " ");
}

/* ============================================================
   Page
   ============================================================ */

/**
 * Default export is a thin Suspense wrapper. ``useSearchParams`` in Next 15
 * must live under a ``<Suspense>`` boundary or the framework throws during
 * client hydration (same root cause as /build).
 */
export default function LabDetailPage(): React.ReactElement {
  return (
    <React.Suspense
      fallback={
        <div style={{ padding: 24, color: "var(--d10-fg-faint)" }}>
          Loading lab…
        </div>
      }
    >
      <LabDetailPageInner />
    </React.Suspense>
  );
}

function LabDetailPageInner(): React.ReactElement {
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();
  const id = Number(params?.id);
  const enabled = Number.isFinite(id);

  const labQ = useQuery<Lab>({
    queryKey: ["lab", id],
    queryFn: () => fetch(`/api/v1/labs/${id}`).then((r) => r.json()),
    enabled,
    refetchInterval: 8000,
  });
  const lab = labQ.data;

  const topologyQ = useQuery<LabConfig>({
    queryKey: ["lab-topology", id],
    queryFn: () => api.getLabTopology(id),
    enabled,
  });
  const topology = topologyQ.data;

  /* ---------- selection from ?nodeId= ---------- */

  const nodeIdParam = searchParams?.get("nodeId") ?? null;
  const nodes: TopologyNode[] = React.useMemo(
    () => topology?.nodes ?? [],
    [topology],
  );
  const selectedNode: TopologyNode | null = React.useMemo(() => {
    if (!nodes.length) return null;
    if (nodeIdParam) {
      const match = nodes.find((n) => n.id === nodeIdParam);
      if (match) return match;
    }
    return nodes[0] ?? null;
  }, [nodes, nodeIdParam]);

  const selectNode = (nodeId: string): void => {
    const usp = new URLSearchParams(searchParams?.toString() ?? "");
    usp.set("panel", "node");
    usp.set("nodeId", nodeId);
    router.replace(`/labs/${id}?${usp.toString()}`);
  };

  /* ---------- local catalog-add overlay ---------- */
  // The brief says UI-only — we keep an in-page Set of role strings added
  // via the right-rail catalog and merge them into the selected node's
  // applied-roles list. This never round-trips to the API.

  const [addedRolesByNode, setAddedRolesByNode] = React.useState<
    Record<string, string[]>
  >({});

  const appliedRoles: string[] = React.useMemo(() => {
    if (!selectedNode) return [];
    const fromTopology = selectedNode.config.roles ?? [];
    const fromOverlay = addedRolesByNode[selectedNode.id] ?? [];
    const merged: string[] = [];
    for (const r of [...fromTopology, ...fromOverlay]) {
      if (!merged.includes(r)) merged.push(r);
    }
    return merged;
  }, [selectedNode, addedRolesByNode]);

  const addVendor = (entry: VendorEntry): void => {
    if (!selectedNode) return;
    const role = encodeRole(entry.id, entry.versions?.[0] ?? null);
    setAddedRolesByNode((prev) => {
      const existing = prev[selectedNode.id] ?? [];
      // Don't double-add and don't shadow an existing topology role.
      if (existing.includes(role)) return prev;
      if ((selectedNode.config.roles ?? []).some((r) => parseRole(r).id === entry.id)) {
        return prev;
      }
      return { ...prev, [selectedNode.id]: [...existing, role] };
    });
  };

  /* ---------- catalog category tabs (right rail) ---------- */

  const [catCategory, setCatCategory] = React.useState<IconCategory | "All">(
    "All",
  );
  const grouped = React.useMemo(() => vendorsByCategory(), []);
  const visibleVendors: VendorEntry[] = React.useMemo(() => {
    if (catCategory === "All") {
      return CATEGORY_ORDER.flatMap((c) => grouped[c]);
    }
    return grouped[catCategory] ?? [];
  }, [catCategory, grouped]);

  /* ---------- tabs spec (tb2) ---------- */

  const tabs: TabSpec[] = [
    { id: "overview", label: "Overview", href: `/labs/${id}?tab=overview` },
    { id: "topology", label: "Topology", href: `/labs/${id}?tab=topology` },
    {
      id: "nodes",
      label: "Nodes",
      count: nodes.length || undefined,
      active: true,
    },
    { id: "activity", label: "Activity", href: `/labs/${id}?tab=activity` },
    { id: "settings", label: "Settings", href: `/labs/${id}?tab=settings` },
  ];

  /* ---------- tb3 actions ---------- */

  const bucket = bucketFor(lab?.status ?? "");

  const actions = (
    <>
      <span className={cn("pill", statusPillTone(bucket))}>
        <span className={cn("sd", statusDotClass(bucket))} style={{ marginRight: 6 }} />
        {lab?.status ?? "—"}
      </span>
      <button
        type="button"
        className="btn"
        onClick={() => {
          labQ.refetch();
          topologyQ.refetch();
        }}
        disabled={labQ.isFetching || topologyQ.isFetching}
      >
        ↻ Refresh
      </button>
      <div className="right">
        <Link className="btn" href={`/monitor/${id}`}>
          ◆ Open in canvas
        </Link>
      </div>
    </>
  );

  /* ---------- loading / invalid id ---------- */

  if (!enabled) {
    return (
      <>
        <PageToolbars tabs={tabs} actions={actions} />
        <div style={{ padding: 24, color: "var(--d10-err)" }}>Invalid lab id.</div>
      </>
    );
  }

  if (labQ.isLoading || topologyQ.isLoading) {
    return (
      <>
        <PageToolbars tabs={tabs} actions={actions} />
        <div style={{ padding: 24, color: "var(--d10-fg-faint)" }}>
          Loading lab…
        </div>
      </>
    );
  }

  /* ============================================================
     Render
     ============================================================ */

  return (
    <>
      <PageToolbars tabs={tabs} actions={actions} />

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "240px 1fr 320px",
          minHeight: 0,
          flex: 1,
          overflow: "hidden",
        }}
      >
        {/* =================== LEFT RAIL — node list =================== */}
        <aside
          className="filt"
          style={{ borderRight: "1px solid var(--d10-border)", minHeight: 0 }}
        >
          <div className="group">
            <div className="lh">
              Nodes <span>{nodes.length}</span>
            </div>
            {nodes.length === 0 && (
              <div
                style={{
                  padding: 12,
                  fontSize: 11,
                  color: "var(--d10-fg-faint)",
                }}
              >
                This lab has no nodes yet.
              </div>
            )}
            {nodes.map((n) => {
              const isSel = selectedNode?.id === n.id;
              // Per-node status — without per-VM health on this page we
              // mirror the lab-level bucket; running labs paint nodes "run",
              // failed labs paint them "err", etc.
              const dot = statusDotClass(bucket);
              return (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => selectNode(n.id)}
                  className={cn("nav", isSel && "active")}
                  style={{
                    width: "100%",
                    textAlign: "left",
                    background: isSel ? "var(--d10-bg-elev-1)" : "transparent",
                    border: 0,
                    cursor: "pointer",
                    padding: "8px 10px",
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                  }}
                >
                  <span className={cn("sd", dot)} />
                  <span
                    style={{
                      flex: 1,
                      minWidth: 0,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      fontSize: 12,
                      color: isSel ? "var(--d10-fg-strong)" : "var(--d10-fg)",
                    }}
                  >
                    {n.config.hostname}
                  </span>
                  <span
                    style={{
                      fontSize: 10,
                      color: "var(--d10-fg-faint)",
                      textTransform: "uppercase",
                      letterSpacing: "0.06em",
                    }}
                  >
                    {n.type}
                  </span>
                </button>
              );
            })}
          </div>
        </aside>

        {/* =================== CENTER — node card =================== */}
        <section
          style={{
            minWidth: 0,
            padding: 18,
            overflowY: "auto",
            background: "var(--d10-bg)",
          }}
        >
          {!selectedNode ? (
            <EmptyNodeState labName={lab?.name ?? ""} />
          ) : (
            <NodeCard
              node={selectedNode}
              roles={appliedRoles}
              labName={lab?.name ?? ""}
            />
          )}
        </section>

        {/* =================== RIGHT RAIL — vendor catalog =================== */}
        <aside
          className="inspector"
          style={{ borderLeft: "1px solid var(--d10-border)", minHeight: 0 }}
        >
          <div className="ih">
            <div className="ic">⚙</div>
            <div>
              <div className="nm">Vendor catalog</div>
              <div className="ty">click to attach to {selectedNode?.config.hostname ?? "—"}</div>
            </div>
          </div>

          {/* Category tabs */}
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 4,
              padding: "10px 12px",
              borderBottom: "1px solid var(--d10-border)",
            }}
          >
            <CategoryChip
              label="All"
              active={catCategory === "All"}
              onClick={() => setCatCategory("All")}
            />
            {CATEGORY_ORDER.map((c) => (
              <CategoryChip
                key={c}
                label={c}
                count={grouped[c].length}
                active={catCategory === c}
                onClick={() => setCatCategory(c)}
              />
            ))}
          </div>

          {/* Vendor grid */}
          <div style={{ overflowY: "auto", padding: 10 }}>
            <div className="vendor-grid">
              {visibleVendors.map((entry) => {
                const attached =
                  selectedNode != null &&
                  appliedRoles.some((r) => parseRole(r).id === entry.id);
                return (
                  <button
                    key={entry.id}
                    type="button"
                    onClick={() => addVendor(entry)}
                    disabled={!selectedNode || attached}
                    className={cn("v-card", attached && "selected")}
                    style={{
                      cursor: !selectedNode || attached ? "default" : "pointer",
                      opacity: !selectedNode ? 0.5 : 1,
                      textAlign: "left",
                    }}
                  >
                    <div className="top">
                      <div
                        className="logo"
                        style={{
                          background: entry.color,
                          color: "#fff",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        <VendorIconInner entry={entry} size={18} color="#fff" />
                      </div>
                      <div style={{ minWidth: 0 }}>
                        <div className="nm">{entry.label}</div>
                        <div className="cat">{entry.category}</div>
                      </div>
                    </div>
                    {entry.versions && entry.versions.length > 0 && (
                      <div className="v-row">
                        {entry.versions.slice(0, 3).map((v) => (
                          <span key={v} className="v-chip">
                            {v}
                          </span>
                        ))}
                      </div>
                    )}
                  </button>
                );
              })}
              {visibleVendors.length === 0 && (
                <div
                  style={{
                    color: "var(--d10-fg-faint)",
                    fontSize: 11,
                    padding: 12,
                  }}
                >
                  No vendors in this category.
                </div>
              )}
            </div>
          </div>
        </aside>
      </div>
    </>
  );
}

/* ============================================================
   Center card subcomponents
   ============================================================ */

function NodeCard({
  node,
  roles,
  labName,
}: {
  node: TopologyNode;
  roles: string[];
  labName: string;
}): React.ReactElement {
  const Illustration = ILLUSTRATIONS[node.type];

  // Partition roles → vendor vs custom — mirrors NodeConfigPanel.tsx.
  const vendorRoles: {
    role: string;
    entry: VendorEntry;
    version: string | null;
  }[] = [];
  const customRoles: string[] = [];
  for (const role of roles) {
    const entry = lookupVendor(role);
    if (entry) {
      vendorRoles.push({ role, entry, version: parseRole(role).version });
    } else {
      customRoles.push(role);
    }
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 16,
        maxWidth: 880,
      }}
    >
      {/* Header card */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "180px 1fr",
          gap: 18,
          background: "var(--d10-bg-elev-2)",
          border: "1px solid var(--d10-border)",
          borderRadius: 8,
          padding: 18,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "var(--d10-bg-elev-1)",
            border: "1px solid var(--d10-border-soft)",
            borderRadius: 6,
            minHeight: 160,
          }}
        >
          {Illustration && (
            <Illustration
              os={node.config.os}
              roles={roles}
              size={140}
              accent="var(--d10-accent)"
            />
          )}
        </div>

        <div
          style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}
        >
          <div
            style={{
              fontSize: 10,
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              color: "var(--d10-fg-faint)",
            }}
          >
            {labName} · node
          </div>
          <div
            style={{
              fontSize: 22,
              fontWeight: 600,
              color: "var(--d10-fg-strong)",
            }}
          >
            {node.config.hostname}
          </div>
          <div style={{ fontSize: 12, color: "var(--d10-fg-mute)" }}>
            {nodeTypeLabel(node.type)} · {osLabel(node.config.os)}
          </div>

          {/* Stat row */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(4, 1fr)",
              gap: 10,
              marginTop: 12,
            }}
          >
            <Stat
              label="CPU"
              value={`${node.config.cpus} vCPU`}
            />
            <Stat
              label="RAM"
              value={`${(node.config.memory_mb / 1024).toFixed(1)} GB`}
            />
            <Stat
              label="IP"
              value={node.config.ip || "—"}
              mono
            />
            <Stat label="VLAN" value={node.config.vlan?.toString() ?? "—"} mono />
          </div>

          {/* Attack tag chips */}
          {(node.attack_tags?.length ?? 0) > 0 && (
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 6,
                marginTop: 12,
              }}
            >
              {node.attack_tags!.map((tag, i) => (
                <span
                  key={`${tag.tactic}-${tag.technique ?? i}`}
                  className="pill warn"
                  style={{ textTransform: "lowercase" }}
                >
                  {tag.tactic}{tag.technique ? ` · ${tag.technique}` : ""}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Applied roles */}
      <div
        style={{
          background: "var(--d10-bg-elev-2)",
          border: "1px solid var(--d10-border)",
          borderRadius: 8,
          padding: 14,
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 10,
          }}
        >
          <div
            style={{
              fontSize: 10,
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              color: "var(--d10-fg-faint)",
            }}
          >
            Applied roles · {roles.length}
          </div>
          <div style={{ fontSize: 10, color: "var(--d10-fg-faint)" }}>
            attach from the catalog on the right
          </div>
        </div>

        {roles.length === 0 ? (
          <div
            style={{
              border: "1px dashed var(--d10-border-strong)",
              borderRadius: 6,
              padding: 18,
              textAlign: "center",
              color: "var(--d10-fg-faint)",
              fontSize: 12,
            }}
          >
            No roles attached.
          </div>
        ) : (
          <div style={{ display: "grid", gap: 6 }}>
            {vendorRoles.map(({ role, entry, version }) => (
              <div
                key={role}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  background: "var(--d10-bg-elev-1)",
                  border: "1px solid var(--d10-border)",
                  borderRadius: 6,
                  padding: "8px 10px",
                }}
              >
                <span
                  style={{
                    width: 22,
                    height: 22,
                    borderRadius: 4,
                    background: entry.color,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                  }}
                >
                  <VendorIconInner entry={entry} size={14} color="#fff" />
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: 12,
                      color: "var(--d10-fg-strong)",
                      fontWeight: 500,
                    }}
                  >
                    {entry.label}
                  </div>
                  <div
                    style={{ fontSize: 10, color: "var(--d10-fg-faint)" }}
                  >
                    {entry.description}
                  </div>
                </div>
                <span className="pill mute mono" style={{ fontSize: 10 }}>
                  {version ? `@${version}` : "—"}
                </span>
              </div>
            ))}
            {customRoles.map((role) => (
              <div
                key={role}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  background: "var(--d10-bg-elev-1)",
                  border: "1px solid var(--d10-border)",
                  borderRadius: 6,
                  padding: "8px 10px",
                }}
              >
                <span
                  style={{
                    width: 22,
                    height: 22,
                    borderRadius: 4,
                    background: "var(--d10-bg-elev-3)",
                    flexShrink: 0,
                  }}
                />
                <code
                  style={{
                    flex: 1,
                    minWidth: 0,
                    fontSize: 12,
                    color: "var(--d10-fg)",
                  }}
                >
                  {role}
                </code>
                <span className="pill mute" style={{ fontSize: 10 }}>
                  custom
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}): React.ReactElement {
  return (
    <div
      style={{
        background: "var(--d10-bg-elev-1)",
        border: "1px solid var(--d10-border-soft)",
        borderRadius: 6,
        padding: "8px 10px",
      }}
    >
      <div
        style={{
          fontSize: 9,
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          color: "var(--d10-fg-faint)",
        }}
      >
        {label}
      </div>
      <div
        className={mono ? "mono" : undefined}
        style={{
          fontSize: 13,
          color: "var(--d10-fg-strong)",
          fontWeight: 500,
        }}
      >
        {value}
      </div>
    </div>
  );
}

function EmptyNodeState({ labName }: { labName: string }): React.ReactElement {
  return (
    <div
      style={{
        background: "var(--d10-bg-elev-2)",
        border: "1px dashed var(--d10-border-strong)",
        borderRadius: 8,
        padding: 48,
        textAlign: "center",
      }}
    >
      <div
        style={{
          fontSize: 18,
          color: "var(--d10-fg-strong)",
          marginBottom: 6,
        }}
      >
        {labName || "This lab"} has no nodes
      </div>
      <div style={{ fontSize: 12, color: "var(--d10-fg-faint)" }}>
        Open it in the canvas to add hosts, routers, or attackers.
      </div>
    </div>
  );
}

function CategoryChip({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count?: number;
  active?: boolean;
  onClick: () => void;
}): React.ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn("chip", active && "act")}
      style={{
        background: active ? "var(--d10-bg-elev-3)" : "var(--d10-bg-elev-1)",
        border: "1px solid var(--d10-border)",
        color: active ? "var(--d10-fg-strong)" : "var(--d10-fg-mute)",
        padding: "3px 8px",
        borderRadius: 4,
        fontSize: 10,
        textTransform: "uppercase",
        letterSpacing: "0.05em",
        cursor: "pointer",
      }}
    >
      {label}
      {count !== undefined && (
        <span style={{ color: "var(--d10-fg-faint)", marginLeft: 4 }}>
          {count}
        </span>
      )}
    </button>
  );
}
