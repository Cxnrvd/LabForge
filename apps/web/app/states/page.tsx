"use client";

import * as React from "react";

function SectionHeader({ tone, title }: { tone: "info" | "warn" | "err" | "neutral"; title: string }) {
  const cls =
    tone === "err"
      ? "badge err"
      : tone === "warn"
      ? "badge warn"
      : tone === "info"
      ? "badge info"
      : "badge";
  const label =
    tone === "err" ? "Error" : tone === "warn" ? "Warning" : tone === "info" ? "Loading" : "Empty";
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 10 }}>
      <span className={cls}>
        <span className="d" />
        {label}
      </span>
      <h2 style={{ margin: 0, fontSize: 14, fontWeight: 600, letterSpacing: "-.005em" }}>{title}</h2>
    </div>
  );
}

function InfoIcon() {
  return (
    <svg className="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
      <circle cx="12" cy="12" r="10" />
      <path d="M12 16v-4M12 8h.01" />
    </svg>
  );
}

function ErrorIcon() {
  return (
    <svg className="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
      <circle cx="12" cy="12" r="10" />
      <path d="M12 8v4M12 16h.01" />
    </svg>
  );
}

function WarnIcon() {
  return (
    <svg className="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
      <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
      <path d="M12 9v4M12 17h.01" />
    </svg>
  );
}

function ListIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M3 7h18M3 12h18M3 17h18" />
    </svg>
  );
}

function ShieldIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M12 2l3 7h7l-5.5 4 2 7L12 16l-6.5 4 2-7L2 9h7z" />
    </svg>
  );
}

function NoLabsEmpty() {
  return (
    <div className="empty">
      <ListIcon />
      <h3>No labs yet</h3>
      <p>Start from a vetted template, or drag your first node onto a blank canvas.</p>
      <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
        <button className="btn" type="button">
          Browse templates
        </button>
        <button className="btn primary" type="button">
          + Blank canvas
        </button>
      </div>
    </div>
  );
}

function NoCvesEmpty() {
  return (
    <div className="empty">
      <ShieldIcon />
      <h3>No CVEs match</h3>
      <p>Pinning a CVE lets the provisioner install a vulnerable build, useful for hands-on exploit work.</p>
      <button className="btn primary" type="button">
        Browse NVD →
      </button>
    </div>
  );
}

function ApiOfflineBanner() {
  return (
    <>
      <div className="banner err">
        <ErrorIcon />
        <div className="grow">
          <div>
            <b>Can&apos;t reach the LabForge API</b> at{" "}
            <span className="mono">http://127.0.0.1:8000</span>
          </div>
          <div className="meta-line" style={{ marginTop: 4 }}>
            connection refused after 10s · is the API server running?
          </div>
        </div>
        <button className="btn sm" type="button">
          Retry
        </button>
        <button className="btn sm" type="button">
          Settings
        </button>
      </div>
      <div className="banner" style={{ marginTop: 10 }}>
        <InfoIcon />
        <div className="grow">
          Start it locally:{" "}
          <span
            className="mono"
            style={{
              color: "var(--ink)",
              background: "var(--bg-2)",
              padding: "2px 6px",
              borderRadius: 4,
            }}
          >
            pnpm dev:api
          </span>{" "}
          or set a different URL in Settings.
        </div>
      </div>
    </>
  );
}

function VagrantMissingBanner() {
  return (
    <div className="banner warn">
      <WarnIcon />
      <div className="grow">
        <div>
          <b>Vagrant not found on PATH</b>
        </div>
        <div className="meta-line" style={{ marginTop: 4 }}>
          Install Vagrant 2.4+ and either VirtualBox, VMware Desktop, or libvirt to bring labs up locally.
        </div>
      </div>
      <button className="btn sm" type="button">
        Install guide
      </button>
      <button className="btn sm" type="button">
        Doctor
      </button>
    </div>
  );
}

function BuildFailedCard() {
  return (
    <div className="card">
      <div className="card-h" style={{ background: "rgba(204,0,0,0.04)" }}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--red)" strokeWidth="2.5">
          <circle cx="12" cy="12" r="10" />
          <path d="M15 9l-6 6M9 9l6 6" />
        </svg>
        <h3>redteam-q2-engagement · build #041 failed</h3>
        <div className="grow" />
        <span className="badge err">
          <span className="d" />
          vagrant_up exit 1
        </span>
      </div>
      <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "grid", gridTemplateColumns: "140px 1fr", gap: 12, alignItems: "start" }}>
          <span className="mono" style={{ color: "var(--ink-mute)", fontSize: 12 }}>
            Phase
          </span>
          <span className="mono" style={{ fontSize: 13 }}>
            vagrant up · 14:18:44
          </span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "140px 1fr", gap: 12, alignItems: "start" }}>
          <span className="mono" style={{ color: "var(--ink-mute)", fontSize: 12 }}>
            Exit code
          </span>
          <span className="mono" style={{ fontSize: 13, color: "var(--red)" }}>
            1
          </span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "140px 1fr", gap: 12, alignItems: "start" }}>
          <span className="mono" style={{ color: "var(--ink-mute)", fontSize: 12 }}>
            Stderr
          </span>
          <pre
            style={{
              margin: 0,
              fontFamily: "'Geist Mono', monospace",
              fontSize: 12.5,
              padding: 12,
              background: "var(--bg-1)",
              border: "1px solid var(--line)",
              borderRadius: 6,
              whiteSpace: "pre-wrap",
              color: "var(--red)",
            }}
          >
{`==> vagrant: The provider 'vmware_desktop' is not registered. Did you mean 'virtualbox'?
==> vagrant: Could not find a registered box. Check ~/.vagrant.d/boxes/`}
          </pre>
        </div>
        <div style={{ display: "flex", gap: 8, paddingTop: 8, borderTop: "1px solid var(--line)", flexWrap: "wrap" }}>
          <button className="btn" type="button">
            View full log
          </button>
          <button className="btn" type="button">
            Open workspace
          </button>
          <button className="btn" type="button">
            Switch provider
          </button>
          <button className="btn primary" type="button">
            Retry build
          </button>
          <button className="btn danger" style={{ marginLeft: "auto" }} type="button">
            Destroy &amp; cleanup
          </button>
        </div>
      </div>
    </div>
  );
}

function ValidationBlockerBanner() {
  return (
    <div className="banner err">
      <WarnIcon />
      <div className="grow">
        <b>Domain controller</b> <span className="mono">dc01</span> is set to Ubuntu — must be Windows.
        Fix this before generating.
      </div>
      <button className="btn sm" type="button">
        Apply auto-fix
      </button>
      <button className="btn sm" type="button">
        View all issues
      </button>
    </div>
  );
}

function RateLimitBanner() {
  return (
    <div className="banner warn">
      <WarnIcon />
      <div className="grow">
        <b>NVD rate limit at 78%</b> · retry after 4s · results served from cache
      </div>
      <button className="btn sm" type="button">
        Set NVD key
      </button>
    </div>
  );
}

function SkeletonLoader() {
  return (
    <div className="card">
      <div className="card-h">
        <h3>Live topology</h3>
        <div className="sub">awaiting first heartbeat…</div>
      </div>
      <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {[40, 36, 45].map((titleWidth, i) => (
          <div
            key={i}
            className="animate-pulse"
            style={{ display: "grid", gridTemplateColumns: "60px 1fr 80px", gap: 12 }}
          >
            <div style={{ height: 60, background: "var(--bg-2)", borderRadius: 6 }} />
            <div style={{ display: "flex", flexDirection: "column", gap: 6, paddingTop: 8 }}>
              <div style={{ height: 14, background: "var(--bg-2)", borderRadius: 4, width: `${titleWidth}%` }} />
              <div style={{ height: 11, background: "var(--bg-2)", borderRadius: 4, width: "65%" }} />
              <div style={{ height: 11, background: "var(--bg-2)", borderRadius: 4, width: "28%" }} />
            </div>
            <div style={{ height: 24, background: "var(--bg-2)", borderRadius: 999 }} />
          </div>
        ))}
      </div>
    </div>
  );
}

function StateSection({ children }: { children: React.ReactNode }) {
  return <div style={{ display: "flex", flexDirection: "column" }}>{children}</div>;
}

export default function StatesPage() {
  return (
    <main className="page">
      <div className="pagehead">
        <div className="grow">
          <h1 className="h1">Empty &amp; error states</h1>
          <div className="meta mono">
            canonical placeholders for absent, broken, and first-time moments — see also{" "}
            <a href="/design-system" style={{ color: "var(--ink)", textDecoration: "underline" }}>
              /design-system
            </a>{" "}
            for tokens &amp; components
          </div>
        </div>
        <span className="badge">states · v0.1</span>
      </div>

      <div className="grid12">
        <div className="s6">
          <StateSection>
            <SectionHeader tone="neutral" title="First-time · no labs yet" />
            <NoLabsEmpty />
          </StateSection>
        </div>

        <div className="s6">
          <StateSection>
            <SectionHeader tone="neutral" title="No CVEs match the filter" />
            <NoCvesEmpty />
          </StateSection>
        </div>

        <div className="s12">
          <StateSection>
            <SectionHeader tone="err" title="API server unreachable" />
            <ApiOfflineBanner />
          </StateSection>
        </div>

        <div className="s6">
          <StateSection>
            <SectionHeader tone="warn" title="Vagrant binary missing" />
            <VagrantMissingBanner />
          </StateSection>
        </div>

        <div className="s6">
          <StateSection>
            <SectionHeader tone="warn" title="NVD rate-limited" />
            <RateLimitBanner />
          </StateSection>
        </div>

        <div className="s12">
          <StateSection>
            <SectionHeader tone="err" title="Build failed mid-flight" />
            <BuildFailedCard />
          </StateSection>
        </div>

        <div className="s6">
          <StateSection>
            <SectionHeader tone="err" title="Validation blocker on canvas" />
            <ValidationBlockerBanner />
          </StateSection>
        </div>

        <div className="s6">
          <StateSection>
            <SectionHeader tone="info" title="Skeleton — fetching topology" />
            <SkeletonLoader />
          </StateSection>
        </div>
      </div>
    </main>
  );
}
