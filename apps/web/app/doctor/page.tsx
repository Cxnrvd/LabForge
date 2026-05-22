"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";

import { api, getStoredToken } from "@/lib/api/client";

interface HealthResponse {
  status: string;
  version?: string;
  auth_required?: boolean;
  nvd_key_set?: boolean;
}

interface PreflightResponse {
  vagrant_available: boolean;
  vagrant_version?: string | null;
  default_provider?: string | null;
}

type CheckState = "ok" | "warn" | "err" | "unknown";

interface CheckRow {
  title: string;
  meta: string;
  state: CheckState;
  resultLabel: string;
  detail: string;
  action?: { label: string; href?: string };
}

function CheckIcon({ state }: { state: CheckState }) {
  if (state === "ok") {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--green)" strokeWidth="2.5">
        <path d="M22 11.08V12a10 10 0 11-5.93-9.14" />
        <path d="M22 4L12 14.01l-3-3" />
      </svg>
    );
  }
  if (state === "warn") {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--amber)" strokeWidth="2.5">
        <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
        <path d="M12 9v4M12 17h.01" />
      </svg>
    );
  }
  if (state === "err") {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--red)" strokeWidth="2.5">
        <circle cx="12" cy="12" r="10" />
        <path d="M15 9l-6 6M9 9l6 6" />
      </svg>
    );
  }
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--ink-mute)" strokeWidth="2.5">
      <circle cx="12" cy="12" r="10" />
      <path d="M12 8v4M12 16h.01" />
    </svg>
  );
}

function stateBadgeClass(state: CheckState): string {
  if (state === "ok") return "badge live";
  if (state === "warn") return "badge warn";
  if (state === "err") return "badge err";
  return "badge";
}

function CheckRowView({ row }: { row: CheckRow }) {
  return (
    <tr>
      <td>
        <CheckIcon state={row.state} />
      </td>
      <td>
        <div className="row-title">{row.title}</div>
        <div className="meta-line">{row.meta}</div>
      </td>
      <td>
        <span className={stateBadgeClass(row.state)}>
          <span className="d" />
          {row.resultLabel}
        </span>
      </td>
      <td>
        <span
          className="mono"
          style={{
            fontSize: 12,
            color: row.detail === "—" ? "var(--ink-mute)" : undefined,
          }}
        >
          {row.detail}
        </span>
      </td>
      <td>
        {row.action ? (
          row.action.href ? (
            <a className="ico-btn" href={row.action.href}>
              {row.action.label}
            </a>
          ) : (
            <button className="btn sm">{row.action.label}</button>
          )
        ) : (
          <button className="ico-btn">›</button>
        )}
      </td>
    </tr>
  );
}

function maskToken(token: string | null): string {
  if (!token) return "—";
  const tail = token.slice(-4);
  return `••••••••${tail}`;
}

export default function DoctorPage(): React.JSX.Element {
  const [lastRunAt, setLastRunAt] = React.useState<Date>(() => new Date());
  const [lastRunMs, setLastRunMs] = React.useState<number>(0);

  const healthQ = useQuery<HealthResponse & { _latencyMs: number }>({
    queryKey: ["doctor-health"],
    queryFn: async () => {
      const start = performance.now();
      const res = await fetch("/api/v1/health", { cache: "no-store" });
      const latency = Math.round(performance.now() - start);
      if (!res.ok) throw new Error(`${res.status}`);
      const body = (await res.json()) as HealthResponse;
      return { ...body, _latencyMs: latency };
    },
    retry: 1,
  });

  const preflightQ = useQuery<PreflightResponse>({
    queryKey: ["doctor-preflight"],
    queryFn: () => api.buildPreflight(),
    retry: 1,
  });

  const token = React.useMemo(() => getStoredToken(), [healthQ.dataUpdatedAt]);

  React.useEffect(() => {
    if (!healthQ.isFetching && !preflightQ.isFetching) {
      // crude duration: time since most recent query started
      const updated = Math.max(
        healthQ.dataUpdatedAt || 0,
        preflightQ.dataUpdatedAt || 0,
        healthQ.errorUpdatedAt || 0,
        preflightQ.errorUpdatedAt || 0,
      );
      if (updated) {
        setLastRunAt(new Date(updated));
        setLastRunMs((healthQ.data?._latencyMs ?? 0) + 0);
      }
    }
  }, [
    healthQ.isFetching,
    preflightQ.isFetching,
    healthQ.dataUpdatedAt,
    preflightQ.dataUpdatedAt,
    healthQ.errorUpdatedAt,
    preflightQ.errorUpdatedAt,
    healthQ.data?._latencyMs,
  ]);

  const rerun = (): void => {
    void healthQ.refetch();
    void preflightQ.refetch();
  };

  // ---- Build hypervisor check rows -------------------------------------
  const vagrantOk = preflightQ.data?.vagrant_available === true;
  const vagrantVersion = preflightQ.data?.vagrant_version || null;
  const provider = preflightQ.data?.default_provider || null;

  const hypervisorRows: CheckRow[] = [
    {
      title: "Vagrant binary",
      meta: "labforge requires Vagrant ≥ 2.4",
      state: preflightQ.isLoading
        ? "unknown"
        : vagrantOk
          ? "ok"
          : "err",
      resultLabel: preflightQ.isLoading
        ? "checking…"
        : vagrantOk
          ? (vagrantVersion ?? "available")
          : "not found",
      detail: vagrantOk
        ? `default provider: ${provider ?? "—"}`
        : "install Vagrant to build labs",
    },
    {
      title: "VirtualBox provider",
      meta: "VBoxManage detection (run agent doctor for ground truth)",
      state: "unknown",
      resultLabel: "browser cannot verify",
      detail: "labforge doctor",
    },
    {
      title: "VirtualBox host-only networks.conf",
      meta: "required for UAC-free networking",
      state: "unknown",
      resultLabel: "browser cannot verify",
      detail: "labforge doctor",
    },
    {
      title: "VMware Desktop plugin",
      meta: "vagrant-vmware-desktop · vmrun detection",
      state: "unknown",
      resultLabel: "browser cannot verify",
      detail: "labforge doctor",
    },
    {
      title: "libvirt",
      meta: "only needed if you use the libvirt provider",
      state: "unknown",
      resultLabel: "browser cannot verify",
      detail: "labforge doctor",
    },
    {
      title: "Hyper-V conflict (Windows)",
      meta: "VirtualBox cannot run alongside Hyper-V",
      state: "unknown",
      resultLabel: "browser cannot verify",
      detail: "bcdedit /set hypervisorlaunchtype off",
    },
  ];

  // ---- API & agent rows ------------------------------------------------
  const apiOk = healthQ.isSuccess;
  const apiErr = healthQ.isError;
  const authRequired = healthQ.data?.auth_required === true;
  const nvdSet = healthQ.data?.nvd_key_set === true;
  const tokenSet = Boolean(token);

  const apiRows: CheckRow[] = [
    {
      title: "API reachability",
      meta: `GET /health · auth_required=${authRequired ? "true" : "false"}`,
      state: healthQ.isLoading ? "unknown" : apiOk ? "ok" : "err",
      resultLabel: healthQ.isLoading
        ? "checking…"
        : apiOk
          ? `200 · ${healthQ.data?._latencyMs ?? 0}ms`
          : "unreachable",
      detail: typeof window !== "undefined" ? window.location.origin : "/api/v1",
    },
    {
      title: "Agent token",
      meta: "required when API is reachable beyond loopback",
      state: authRequired
        ? tokenSet
          ? "ok"
          : "warn"
        : tokenSet
          ? "ok"
          : "unknown",
      resultLabel: tokenSet ? "set" : authRequired ? "missing" : "not required",
      detail: tokenSet ? `${maskToken(token)} · scope: write` : "—",
      action: tokenSet ? undefined : { label: "Configure", href: "/settings" },
    },
    {
      title: "NVD API key",
      meta: "lifts rate limit from 5 to 50 req/30s",
      state: healthQ.isLoading ? "unknown" : nvdSet ? "ok" : "warn",
      resultLabel: healthQ.isLoading ? "checking…" : nvdSet ? "set" : "not set",
      detail: nvdSet ? "configured server-side" : "—",
    },
    {
      title: "Heartbeat daemon",
      meta: "posts /api/v1/labs/{id}/heartbeat every 10s",
      state: "unknown",
      resultLabel: "browser cannot verify",
      detail: "labforge doctor",
    },
  ];

  // ---- Summary counts --------------------------------------------------
  const allRows = [...hypervisorRows, ...apiRows];
  const total = allRows.length;
  const okCount = allRows.filter((r) => r.state === "ok").length;
  const warnCount = allRows.filter((r) => r.state === "warn").length;
  const errCount = allRows.filter((r) => r.state === "err").length;

  // ---- Banner ----------------------------------------------------------
  let bannerClass = "banner";
  let bannerNode: React.ReactNode = null;
  if (errCount > 0) {
    bannerClass = "banner err";
    bannerNode = (
      <>
        <svg
          className="ico"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
        >
          <circle cx="12" cy="12" r="10" />
          <path d="M15 9l-6 6M9 9l6 6" />
        </svg>
        <div className="grow">
          <b>{errCount} failure{errCount === 1 ? "" : "s"}</b> — critical checks failed.
          Run <span className="mono" style={{ color: "var(--ink)" }}>labforge doctor</span>{" "}
          on the host for full diagnostics.
        </div>
        <button className="btn sm" onClick={rerun}>
          Re-check
        </button>
      </>
    );
  } else if (warnCount > 0) {
    bannerClass = "banner warn";
    bannerNode = (
      <>
        <svg
          className="ico"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
        >
          <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
          <path d="M12 9v4M12 17h.01" />
        </svg>
        <div className="grow">
          <b>{warnCount} advisor{warnCount === 1 ? "y" : "ies"}</b> — review the
          warnings below. The browser cannot verify host-level binaries; run{" "}
          <span className="mono" style={{ color: "var(--ink)" }}>labforge doctor</span>{" "}
          for ground truth.
        </div>
        <button className="btn sm" onClick={rerun}>
          Re-check
        </button>
      </>
    );
  } else {
    bannerClass = "banner success";
    bannerNode = (
      <>
        <svg
          className="ico"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
        >
          <path d="M22 11.08V12a10 10 0 11-5.93-9.14" />
          <path d="M22 4L12 14.01l-3-3" />
        </svg>
        <div className="grow">
          <b>All browser-visible checks pass</b> — for host-level binaries (VirtualBox,
          libvirt, Hyper-V, disk/RAM), run{" "}
          <span className="mono" style={{ color: "var(--ink)" }}>labforge doctor</span>{" "}
          on the agent.
        </div>
        <button className="btn sm" onClick={rerun}>
          Re-check
        </button>
      </>
    );
  }

  // ---- Raw report ------------------------------------------------------
  const rawReport = React.useMemo(() => {
    const obj = {
      version: healthQ.data?.version ?? "unknown",
      host: typeof navigator !== "undefined" ? navigator.userAgent : "unknown",
      duration_ms: lastRunMs,
      checks: {
        vagrant: vagrantOk
          ? { ok: true, version: vagrantVersion }
          : { ok: false, reason: "binary not found via /labs/build/preflight" },
        default_provider: provider,
        api: apiErr
          ? { ok: false, reason: "GET /health failed" }
          : {
              ok: true,
              url: typeof window !== "undefined" ? window.location.origin : null,
              latency_ms: healthQ.data?._latencyMs ?? null,
              auth_required: authRequired,
            },
        agent_token: { ok: tokenSet, required: authRequired },
        nvd_key: { ok: nvdSet },
      },
      advisories: [
        ...(warnCount > 0
          ? [
              "Browser cannot verify host binaries — run `labforge doctor` on the agent host.",
            ]
          : []),
        ...(!tokenSet && authRequired
          ? ["API auth_required=true but no agent token stored — configure in Settings."]
          : []),
      ],
    };
    return JSON.stringify(obj, null, 2);
  }, [
    healthQ.data?.version,
    healthQ.data?._latencyMs,
    lastRunMs,
    vagrantOk,
    vagrantVersion,
    provider,
    apiErr,
    authRequired,
    tokenSet,
    nvdSet,
    warnCount,
  ]);

  const copyReport = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(rawReport);
      toast.success("Doctor report copied");
    } catch {
      toast.error("Copy failed");
    }
  };

  // ---- Render ----------------------------------------------------------
  const summaryBadgeClass =
    errCount > 0 ? "badge err" : warnCount > 0 ? "badge warn" : "badge live";
  const summaryText = `${okCount} of ${total} checks pass`;

  const timeStr = lastRunAt.toLocaleTimeString(undefined, { hour12: false });

  return (
    <main className="page" style={{ maxWidth: 1100 }}>
      <div className="pagehead">
        <div className="grow">
          <h1 className="h1">Doctor</h1>
          <div className="meta mono">
            labforge doctor · pre-flight checks for your host · last run {timeStr}
            {lastRunMs ? ` · ${lastRunMs}ms` : ""}
          </div>
        </div>
        <span className={summaryBadgeClass}>
          <span className="d" />
          {summaryText}
        </span>
        <button className="btn" onClick={() => void copyReport()}>
          Copy report
        </button>
        <button
          className="btn primary"
          onClick={rerun}
          disabled={healthQ.isFetching || preflightQ.isFetching}
        >
          {healthQ.isFetching || preflightQ.isFetching ? "Running…" : "Re-run all checks"}
        </button>
      </div>

      {/* Summary banner */}
      <div className={bannerClass} style={{ marginBottom: 22 }}>
        {bannerNode}
      </div>

      {/* Hypervisor checks */}
      <div className="card" style={{ marginBottom: 18 }}>
        <div className="card-h">
          <h3>Hypervisor</h3>
          <div className="sub">Vagrant binary &amp; providers</div>
        </div>
        <table className="t">
          <thead>
            <tr>
              <th style={{ width: 32 }}></th>
              <th>Check</th>
              <th>Result</th>
              <th>Path / Version</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {hypervisorRows.map((row) => (
              <CheckRowView key={row.title} row={row} />
            ))}
          </tbody>
        </table>
      </div>

      {/* Host resources */}
      <div className="card" style={{ marginBottom: 18 }}>
        <div className="card-h">
          <h3>Host resources</h3>
          <div className="sub">browser cannot read host disk/RAM/CPU — run agent doctor</div>
        </div>
        <div
          className="card-b"
          style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 18 }}
        >
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
              <span style={{ color: "var(--ink-mute)", fontSize: 12 }}>Workspace disk</span>
              <span className="mono" style={{ fontSize: 13, color: "var(--ink-mute)" }}>
                unknown
              </span>
            </div>
            <div className="prog">
              <i style={{ width: "0%" }} />
            </div>
            <div className="help">
              ~/.labforge/workspaces · run <span className="mono">labforge doctor</span> for free-space data
            </div>
          </div>
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
              <span style={{ color: "var(--ink-mute)", fontSize: 12 }}>Host RAM</span>
              <span className="mono" style={{ fontSize: 13, color: "var(--ink-mute)" }}>
                unknown
              </span>
            </div>
            <div className="prog">
              <i style={{ width: "0%" }} />
            </div>
            <div className="help">browsers cannot inspect host memory</div>
          </div>
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
              <span style={{ color: "var(--ink-mute)", fontSize: 12 }}>CPU cores</span>
              <span className="mono" style={{ fontSize: 13, color: "var(--ink-mute)" }}>
                {typeof navigator !== "undefined" && navigator.hardwareConcurrency
                  ? `${navigator.hardwareConcurrency} logical`
                  : "unknown"}
              </span>
            </div>
            <div className="prog">
              <i style={{ width: "0%" }} />
            </div>
            <div className="help">
              navigator.hardwareConcurrency is an approximation · agent reports actual cores
            </div>
          </div>
        </div>
      </div>

      {/* API + agent */}
      <div className="card" style={{ marginBottom: 18 }}>
        <div className="card-h">
          <h3>API &amp; agent</h3>
          <div className="sub">live from /api/v1/health</div>
        </div>
        <table className="t">
          <thead>
            <tr>
              <th style={{ width: 32 }}></th>
              <th>Check</th>
              <th>Result</th>
              <th>Detail</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {apiRows.map((row) => (
              <CheckRowView key={row.title} row={row} />
            ))}
          </tbody>
        </table>
      </div>

      {/* Raw output / copyable */}
      <div className="card">
        <div className="card-h">
          <h3>Raw report</h3>
          <div className="sub">labforge doctor --json (browser-side approximation)</div>
          <div className="grow" />
          <button className="btn sm" onClick={() => void copyReport()}>
            Copy
          </button>
        </div>
        <pre
          style={{
            margin: 0,
            padding: 18,
            background: "var(--bg-1)",
            fontFamily: "'Geist Mono', monospace",
            fontSize: 12.5,
            lineHeight: 1.55,
            color: "var(--ink-dim)",
            whiteSpace: "pre-wrap",
            maxHeight: 280,
            overflowY: "auto",
          }}
        >
          {rawReport}
        </pre>
      </div>
    </main>
  );
}
