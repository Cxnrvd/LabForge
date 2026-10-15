"use client";

// NOTE: This page is currently rendered INSIDE the global AppShell defined in
// apps/web/app/layout.tsx, so the sidebar and topbar will still appear around
// the centred welcome layout. The reference design (designs/01-welcome.html)
// is a true full-screen, no-shell view. To match the design pixel-for-pixel we
// would need to move this route into a `(no-shell)` route group with its own
// minimal layout. Deferred to keep this PR scoped — see TODO above.

import * as React from "react";
import Link from "next/link";

import { api, getStoredToken } from "@/lib/api/client";

type CheckStatus = "ok" | "warn" | "err" | "info";

interface PreflightPayload {
  vagrant_available: boolean;
  vagrant_version?: string | null;
  default_provider?: string | null;
}

interface CheckRow {
  key: string;
  name: string;
  status: CheckStatus;
  result: React.ReactNode;
  detail: React.ReactNode;
}

const CheckIcon = ({ status }: { status: CheckStatus }) => {
  if (status === "ok") {
    return (
      <svg className="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
        <path d="M22 11.08V12a10 10 0 11-5.93-9.14" />
        <path d="M22 4L12 14.01l-3-3" />
      </svg>
    );
  }
  if (status === "warn") {
    return (
      <svg className="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
        <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
        <path d="M12 9v4M12 17h.01" />
      </svg>
    );
  }
  if (status === "err") {
    return (
      <svg className="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
        <circle cx="12" cy="12" r="10" />
        <path d="M15 9l-6 6M9 9l6 6" />
      </svg>
    );
  }
  return (
    <svg className="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 16v-4M12 8h.01" />
    </svg>
  );
};

const bannerClass = (status: CheckStatus) => {
  switch (status) {
    case "ok":
      return "banner success";
    case "warn":
      return "banner warn";
    case "err":
      return "banner err";
    default:
      return "banner info";
  }
};

const ReadyBadge = () => (
  <span className="badge live">
    <span className="d" />
    ready
  </span>
);

const StatusBadge = ({ status }: { status: CheckStatus }) => {
  if (status === "ok") return <ReadyBadge />;
  if (status === "warn")
    return (
      <span className="badge warn">
        <span className="d" />
        check
      </span>
    );
  if (status === "err")
    return (
      <span className="badge err">
        <span className="d" />
        missing
      </span>
    );
  return (
    <span className="badge info">
      <span className="d" />
      optional
    </span>
  );
};

export default function OnboardPage() {
  const [preflight, setPreflight] = React.useState<PreflightPayload | null>(null);
  const [loading, setLoading] = React.useState<boolean>(true);
  const [error, setError] = React.useState<string | null>(null);
  const [tokenPresent, setTokenPresent] = React.useState<boolean>(false);

  const runChecks = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.buildPreflight();
      setPreflight(data);
    } catch (err) {
      const detail =
        err && typeof err === "object" && "detail" in err
          ? String((err as { detail?: string }).detail)
          : "Failed to query preflight";
      setError(detail);
      setPreflight(null);
    } finally {
      setLoading(false);
    }
    setTokenPresent(Boolean(getStoredToken()));
  }, []);

  React.useEffect(() => {
    void runChecks();
  }, [runChecks]);

  const checks: CheckRow[] = React.useMemo(() => {
    const vagrantOk = Boolean(preflight?.vagrant_available);
    const provider = preflight?.default_provider ?? null;
    const vboxOk = vagrantOk && provider === "virtualbox";

    const vagrantRow: CheckRow = {
      key: "vagrant",
      name: "Vagrant",
      status: loading ? "info" : vagrantOk ? "ok" : "err",
      result: loading ? (
        <span>Checking Vagrant…</span>
      ) : vagrantOk ? (
        <span>
          <b>Vagrant {preflight?.vagrant_version ?? ""}</b> detected
        </span>
      ) : (
        <span>
          <b>Vagrant</b> not detected
        </span>
      ),
      detail: loading
        ? "GET /api/v1/labs/build/preflight"
        : vagrantOk
        ? `default provider: ${provider ?? "unknown"}`
        : (error ?? "install Vagrant to provision labs locally"),
    };

    const vboxRow: CheckRow = {
      key: "virtualbox",
      name: "VirtualBox",
      status: loading ? "info" : vboxOk ? "ok" : "warn",
      result: loading ? (
        <span>Inferring provider…</span>
      ) : vboxOk ? (
        <span>
          <b>VirtualBox</b> provider available
        </span>
      ) : (
        <span>
          <b>VirtualBox</b> not the default provider
        </span>
      ),
      detail: loading
        ? "derived from Vagrant default_provider"
        : vboxOk
        ? "vagrant default_provider == virtualbox"
        : `current default_provider: ${provider ?? "none"}`,
    };

    const tokenRow: CheckRow = {
      key: "token",
      name: "API token",
      status: tokenPresent ? "ok" : "info",
      result: tokenPresent ? (
        <span>
          <b>API agent token</b> configured
        </span>
      ) : (
        <span>
          <b>API agent token</b> — recommended for production
        </span>
      ),
      detail: tokenPresent
        ? "labforge.token present in browser storage"
        : "leave empty to run open on loopback for local dev",
    };

    const diskRow: CheckRow = {
      key: "disk",
      name: "Disk space",
      status: "info",
      result: (
        <span>
          <b>Disk space</b> — browser can&apos;t measure
        </span>
      ),
      detail: (
        <span>
          run <span className="mono">labforge doctor</span> to verify free space on workspace disk
        </span>
      ),
    };

    return [vagrantRow, vboxRow, tokenRow, diskRow];
  }, [preflight, loading, error, tokenPresent]);

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        padding: "40px 24px",
        position: "relative",
      }}
    >
      {/* Background grid */}
      <div
        style={{
          position: "fixed",
          inset: 0,
          pointerEvents: "none",
          backgroundImage:
            "radial-gradient(circle, var(--grid-dot) 1px, transparent 1px)",
          backgroundSize: "24px 24px",
          opacity: 0.8,
        }}
      />

      <div style={{ width: "100%", maxWidth: 720, position: "relative", zIndex: 1 }}>
        {/* Logo */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            justifyContent: "center",
            marginBottom: 28,
          }}
        >
          <div
            style={{
              width: 36,
              height: 36,
              background: "var(--ink)",
              clipPath: "polygon(50% 0, 100% 100%, 0 100%)",
            }}
          />
          <div style={{ fontSize: 22, fontWeight: 600, letterSpacing: "-.02em" }}>
            LabForge
          </div>
          <span
            className="mono"
            style={{ color: "var(--ink-mute)", fontSize: 12, paddingTop: 4 }}
          >
            v0.1.0
          </span>
        </div>

        {/* Headline */}
        <h1
          className="h1"
          style={{
            textAlign: "center",
            fontSize: 40,
            fontWeight: 600,
            letterSpacing: "-.04em",
            margin: "0 0 14px",
            lineHeight: 1.1,
          }}
        >
          From canvas to{" "}
          <span
            style={{
              background: "linear-gradient(90deg, var(--blue), var(--purple))",
              WebkitBackgroundClip: "text",
              backgroundClip: "text",
              color: "transparent",
            }}
          >
            running lab
          </span>
          <br />
          in under five clicks.
        </h1>
        <p
          className="meta"
          style={{
            textAlign: "center",
            color: "var(--ink-mute)",
            fontSize: 16,
            maxWidth: 540,
            margin: "0 auto 40px",
            lineHeight: 1.6,
          }}
        >
          Diagram-driven virtual lab builder for cybersecurity professionals. Drag
          nodes, pin CVEs, click generate, run on Vagrant.
        </p>

        {/* Setup card */}
        <div className="card" style={{ padding: "28px 32px" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginBottom: 18,
            }}
          >
            <span
              className="mono"
              style={{
                color: "var(--ink-mute)",
                fontSize: 11,
                letterSpacing: ".1em",
              }}
            >
              STEP 1 OF 3
            </span>
            <div
              style={{
                flex: 1,
                height: 2,
                background: "var(--bg-2)",
                borderRadius: 2,
                overflow: "hidden",
              }}
            >
              <div style={{ width: "33%", height: "100%", background: "var(--ink)" }} />
            </div>
            <span className="mono" style={{ color: "var(--ink-mute)", fontSize: 11 }}>
              workspace setup
            </span>
          </div>

          <h2
            style={{
              margin: "0 0 6px",
              fontSize: 22,
              fontWeight: 600,
              letterSpacing: "-.02em",
            }}
          >
            Welcome to LabForge.
          </h2>
          <p
            style={{
              margin: "0 0 24px",
              color: "var(--ink-mute)",
              fontSize: 14,
            }}
          >
            A few quick checks before we get you to the canvas.
          </p>

          {/* Doctor checks */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 10,
              marginBottom: 24,
            }}
          >
            {checks.map((row) => (
              <div key={row.key} className={bannerClass(row.status)}>
                <CheckIcon status={row.status} />
                <div className="grow">
                  <div>{row.result}</div>
                  <div className="meta-line" style={{ marginTop: 2 }}>
                    {row.detail}
                  </div>
                </div>
                <StatusBadge status={row.status} />
              </div>
            ))}
          </div>

          <div
            style={{
              display: "flex",
              gap: 10,
              paddingTop: 20,
              borderTop: "1px solid var(--line)",
              alignItems: "center",
            }}
          >
            <button
              type="button"
              className="btn"
              onClick={() => void runChecks()}
              disabled={loading}
            >
              {loading ? "Checking…" : "Re-run checks"}
            </button>
            <Link href="/" className="btn ghost">
              Skip setup
            </Link>
            <Link
              href="/build"
              className="btn primary"
              style={{ marginLeft: "auto" }}
            >
              Continue · Open Build <span className="k">⏎</span>
            </Link>
          </div>
        </div>

        {/* Quick start hints */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, 1fr)",
            gap: 14,
            marginTop: 22,
          }}
        >
          <Link href="/templates" style={{ textDecoration: "none" }}>
            <div className="card" style={{ padding: 18, cursor: "pointer" }}>
              <svg
                width="22"
                height="22"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                style={{ color: "var(--blue)", marginBottom: 10 }}
              >
                <path d="M4 7h16v13H4z" />
                <path d="M4 7l8-4 8 4" />
              </svg>
              <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>
                Start from a template
              </div>
              <div style={{ color: "var(--ink-mute)", fontSize: 12.5 }}>
                Preset topologies — AD, OT/SCADA, Red Team, DFIR, Log4Shell…
              </div>
            </div>
          </Link>
          <Link href="/build" style={{ textDecoration: "none" }}>
            <div className="card" style={{ padding: 18, cursor: "pointer" }}>
              <svg
                width="22"
                height="22"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                style={{ color: "var(--purple)", marginBottom: 10 }}
              >
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <path d="M9 3v18M3 9h18" />
              </svg>
              <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>
                Build from blank
              </div>
              <div style={{ color: "var(--ink-mute)", fontSize: 12.5 }}>
                Drag node types onto a fresh canvas and connect them up.
              </div>
            </div>
          </Link>
          <Link href="/learn" style={{ textDecoration: "none" }}>
            <div className="card" style={{ padding: 18, cursor: "pointer" }}>
              <svg
                width="22"
                height="22"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                style={{ color: "var(--green)", marginBottom: 10 }}
              >
                <path d="M22 10l-10 5L2 10l10-5 10 5z" />
                <path d="M6 12v5c0 1 4 3 6 3s6-2 6-3v-5" />
              </svg>
              <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>
                Learn by doing
              </div>
              <div style={{ color: "var(--ink-mute)", fontSize: 12.5 }}>
                Blue Team, Offensive Operator, OT/ICS — curated learning paths.
              </div>
            </div>
          </Link>
        </div>
      </div>
    </div>
  );
}
