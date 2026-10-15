"use client";

import * as React from "react";

const COLOR_TOKENS: { name: string; varName: string; bordered?: boolean }[] = [
  { name: "--bg", varName: "--bg", bordered: true },
  { name: "--bg-1", varName: "--bg-1", bordered: true },
  { name: "--bg-2", varName: "--bg-2" },
  { name: "--bg-3", varName: "--bg-3" },
  { name: "--ink", varName: "--ink" },
  { name: "--ink-dim", varName: "--ink-dim" },
  { name: "--blue", varName: "--blue" },
  { name: "--red", varName: "--red" },
  { name: "--amber", varName: "--amber" },
  { name: "--green", varName: "--green" },
  { name: "--purple", varName: "--purple" },
  { name: "--teal", varName: "--teal" },
];

const SPACING_SCALE = [2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 24, 32, 40, 56];

const BADGES: { cls: string; label: string }[] = [
  { cls: "badge", label: "Default" },
  { cls: "badge live", label: "Live · healthy" },
  { cls: "badge info", label: "Info" },
  { cls: "badge warn", label: "Warning" },
  { cls: "badge err", label: "Error" },
  { cls: "badge violet", label: "Violet" },
];

const SEV: { cls: string; label: string }[] = [
  { cls: "sev crit", label: "Crit · 9.8" },
  { cls: "sev high", label: "High · 7.5" },
  { cls: "sev med", label: "Med · 6.0" },
  { cls: "sev low", label: "Low" },
];

const TAGS: { cls: string; label: string }[] = [
  { cls: "tag", label: "default tag" },
  { cls: "tag k", label: "filled tag" },
  { cls: "tag blue", label: "blue" },
  { cls: "tag purple", label: "purple" },
  { cls: "tag green", label: "green" },
];

const RADIO_LABEL_STYLE: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  fontSize: 13,
  color: "var(--ink-dim)",
};

function Swatch({ name, varName, bordered }: { name: string; varName: string; bordered?: boolean }) {
  return (
    <div>
      <div
        style={{
          height: 56,
          background: `var(${varName})`,
          border: bordered ? "1px solid var(--line)" : undefined,
          borderRadius: 6,
        }}
      />
      <div className="mono" style={{ fontSize: 11, marginTop: 4, color: "var(--ink-mute)" }}>
        {name}
      </div>
    </div>
  );
}

function ColorGrid() {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 12 }}>
      {COLOR_TOKENS.map((t) => (
        <Swatch key={t.name} {...t} />
      ))}
    </div>
  );
}

function SpacingSwatch({ size }: { size: number }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
      <div
        style={{
          width: size,
          height: size,
          background: "var(--ink)",
          borderRadius: 2,
        }}
      />
      <div className="mono" style={{ fontSize: 11, color: "var(--ink-mute)" }}>
        {size}px
      </div>
    </div>
  );
}

function GearIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="3" />
      <path d="M19 12a7 7 0 11-14 0z" />
    </svg>
  );
}

function ArrowRightIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M5 12h14M12 5l7 7-7 7" />
    </svg>
  );
}

function BannerIcon({ tone }: { tone: "info" | "success" | "warn" | "err" }) {
  if (tone === "success") {
    return (
      <svg className="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
        <path d="M22 11.08V12a10 10 0 11-5.93-9.14" />
        <path d="M22 4L12 14.01l-3-3" />
      </svg>
    );
  }
  if (tone === "warn") {
    return (
      <svg className="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
        <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
        <path d="M12 9v4M12 17h.01" />
      </svg>
    );
  }
  return (
    <svg className="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={tone === "err" ? 2.5 : 2}>
      <circle cx="12" cy="12" r="10" />
      {tone === "err" ? <path d="M12 8v4M12 16h.01" /> : <path d="M12 16v-4M12 8h.01" />}
    </svg>
  );
}

function Banner({
  tone,
  lead,
  body,
}: {
  tone: "info" | "success" | "warn" | "err";
  lead: string;
  body: string;
}) {
  return (
    <div className={`banner ${tone}`}>
      <BannerIcon tone={tone} />
      <div className="grow">
        <b>{lead}</b> {body}
      </div>
    </div>
  );
}

export default function DesignSystemPage() {
  return (
    <main className="page">
      <div className="pagehead">
        <div className="grow">
          <h1 className="h1">Design system</h1>
          <div className="meta mono">
            tokens · typography · components · live preview · drives both themes via data-theme
          </div>
        </div>
        <span className="badge">tokens · v0.1</span>
      </div>

      {/* Color tokens — light + dark side by side */}
      <div className="card" style={{ marginBottom: 22 }}>
        <div className="card-h">
          <h3>Color tokens</h3>
          <div className="sub">CSS variables · driven by data-theme on &lt;html&gt;</div>
        </div>
        <div className="card-b" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
          {(["light", "dark"] as const).map((theme) => (
            <div
              key={theme}
              data-theme={theme}
              style={{ background: "var(--bg)", padding: 16, borderRadius: 8, border: "1px solid var(--line)", color: "var(--ink)" }}
            >
              <div className="meta-line" style={{ marginBottom: 12, color: "var(--ink-mute)" }}>
                {theme}
              </div>
              <ColorGrid />
            </div>
          ))}
        </div>
      </div>

      {/* Typography */}
      <div className="card" style={{ marginBottom: 22 }}>
        <div className="card-h">
          <h3>Typography</h3>
          <div className="sub">Geist + Geist Mono · letter-spacing -.006em base · -.03em large headings</div>
        </div>
        <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div>
            <h1 className="h1">The quick brown fox jumps over the lazy dog</h1>
            <div className="meta-line">h1 · 30px · 600 · -.03em</div>
          </div>
          <div>
            <h2 style={{ margin: 0, fontSize: 22, fontWeight: 600, letterSpacing: "-.02em" }}>
              Section heading — pick a starting point
            </h2>
            <div className="meta-line">h2 · 22px · 600 · -.02em</div>
          </div>
          <div>
            <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600, letterSpacing: "-.005em" }}>
              Card title
            </h3>
            <div className="meta-line">card heading · 14px · 600</div>
          </div>
          <div>
            <p style={{ margin: 0, fontSize: 14 }}>
              Body copy at 14px is the default. Long-form text uses 1.5 line-height. The typography
              keeps tight letter-spacing so dense interfaces feel composed rather than airy.
            </p>
            <div className="meta-line">body · 14px · 400</div>
          </div>
          <div>
            <p className="mono" style={{ margin: 0, fontSize: 13, color: "var(--ink)" }}>
              10.0.10.20/24 · CVE-2024-3094 · 14:32:11 UTC · sha256 8c2a…f04b
            </p>
            <div className="meta-line">mono · 13px · all technical data</div>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
            <span className="badge">badge inline</span>
            <span className="kbd">⌘K</span>
            <span className="kbd">esc</span>
            <span className="mono" style={{ fontSize: 12, color: "var(--ink-mute)" }}>
              .badge + .kbd inline samples
            </span>
          </div>
        </div>
      </div>

      {/* Spacing scale */}
      <div className="card" style={{ marginBottom: 22 }}>
        <div className="card-h">
          <h3>Spacing scale</h3>
          <div className="sub">2 → 56px · used for padding, gap, margin</div>
        </div>
        <div className="card-b" style={{ display: "flex", flexWrap: "wrap", gap: 18, alignItems: "flex-end" }}>
          {SPACING_SCALE.map((s) => (
            <SpacingSwatch key={s} size={s} />
          ))}
        </div>
      </div>

      {/* Buttons */}
      <div className="card" style={{ marginBottom: 22 }}>
        <div className="card-h">
          <h3>Buttons</h3>
          <div className="sub">default · primary · ghost · danger · sm · icon</div>
        </div>
        <div className="card-b" style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
          <button className="btn primary">
            Primary action <span className="k">⏎</span>
          </button>
          <button className="btn">Default</button>
          <button className="btn ghost">Ghost</button>
          <button className="btn danger">Destructive</button>
          <button className="btn sm">Small</button>
          <button className="btn sm primary">Small primary</button>
          <button className="iconbtn" aria-label="settings">
            <GearIcon />
          </button>
          <button className="ico-btn" aria-label="next">
            <ArrowRightIcon />
          </button>
        </div>
      </div>

      {/* Badges & severity */}
      <div className="card" style={{ marginBottom: 22 }}>
        <div className="card-h">
          <h3>Badges, pills, severity</h3>
          <div className="sub">status indicators</div>
        </div>
        <div className="card-b" style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
          {BADGES.map((b) => (
            <span key={b.label} className={b.cls}>
              <span className="d" />
              {b.label}
            </span>
          ))}
          <span className="badge mono">mono · v0.1.0</span>
          <div className="divider" style={{ width: "100%", margin: "8px 0" }} />
          {SEV.map((s) => (
            <span key={s.label} className={s.cls}>
              <span className="d" />
              {s.label}
            </span>
          ))}
          <div className="divider" style={{ width: "100%", margin: "8px 0" }} />
          {TAGS.map((t) => (
            <span key={t.label} className={t.cls}>
              {t.label}
            </span>
          ))}
        </div>
      </div>

      {/* Form elements */}
      <div className="card" style={{ marginBottom: 22 }}>
        <div className="card-h">
          <h3>Form elements</h3>
          <div className="sub">.field wrappers · .input · .select · .textarea · checkbox · radio</div>
        </div>
        <div className="card-b" style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 16 }}>
          <div className="field">
            <label>Text input</label>
            <input className="input" defaultValue="acme-corp" />
            <div className="help">Used for plain string fields.</div>
          </div>
          <div className="field">
            <label>Monospace input</label>
            <input className="input mono" defaultValue="10.0.10.20/24" />
            <div className="help">Used for technical data — CIDRs, hashes, IPs.</div>
          </div>
          <div className="field">
            <label>Select</label>
            <select className="select" defaultValue="virtualbox">
              <option value="virtualbox">virtualbox</option>
              <option value="vmware">vmware</option>
              <option value="libvirt">libvirt</option>
            </select>
          </div>
          <div className="field">
            <label>Textarea</label>
            <textarea className="textarea mono" rows={3} defaultValue={"#!/bin/bash\necho hello"} />
          </div>
          <div className="field">
            <label>Checkboxes</label>
            {[
              { defaultChecked: true, text: "Enable WinRM auto-config" },
              { defaultChecked: false, text: "Pin CVE database snapshot" },
            ].map((c) => (
              <label key={c.text} style={RADIO_LABEL_STYLE}>
                <input type="checkbox" defaultChecked={c.defaultChecked} /> {c.text}
              </label>
            ))}
          </div>
          <div className="field">
            <label>Radio group</label>
            {["virtualbox", "vmware_desktop", "libvirt"].map((r, i) => (
              <label key={r} style={RADIO_LABEL_STYLE}>
                <input type="radio" name="prov" defaultChecked={i === 0} /> {r}
              </label>
            ))}
          </div>
        </div>
      </div>

      {/* Banners */}
      <div className="card" style={{ marginBottom: 22 }}>
        <div className="card-h">
          <h3>Banners</h3>
          <div className="sub">inline notices · use sparingly</div>
        </div>
        <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <Banner tone="info" lead="Heads up." body="This is an informational banner." />
          <Banner tone="success" lead="Saved." body="Topology persisted to ~/.labforge/topologies/ad-forest-finance.json" />
          <Banner tone="warn" lead="Warning." body="2 nodes are missing connections — review on canvas." />
          <Banner tone="err" lead="Error." body="Provider vmware_desktop not registered. Build aborted." />
        </div>
      </div>

      {/* Tables */}
      <div className="card" style={{ marginBottom: 22 }}>
        <div className="card-h">
          <h3>Table</h3>
          <div className="sub">.t · standard list rendering</div>
        </div>
        <table className="t">
          <thead>
            <tr>
              <th>Host</th>
              <th>OS</th>
              <th>Status</th>
              <th>Age</th>
            </tr>
          </thead>
          <tbody>
            {[
              { name: "dc01", ip: "10.0.10.10", os: "windows_server_2022", badge: "badge live", status: "running", age: "3h 12m" },
              { name: "web01", ip: "10.0.20.20", os: "ubuntu_22.04", badge: "badge warn", status: "unhealthy", age: "42m" },
              { name: "fw01", ip: "10.0.0.1", os: "pfsense_2.7", badge: "badge err", status: "down", age: "7m" },
            ].map((r) => (
              <tr key={r.name}>
                <td>
                  <div className="row-title">{r.name}</div>
                  <div className="meta-line">{r.ip}</div>
                </td>
                <td className="host">{r.os}</td>
                <td>
                  <span className={r.badge}>
                    <span className="d" />
                    {r.status}
                  </span>
                </td>
                <td className="age">{r.age}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Progress */}
      <div className="grid12" style={{ marginBottom: 22 }}>
        <div className="card s6">
          <div className="card-h">
            <h3>Progress bars</h3>
            <div className="sub">.prog · .prog.thin</div>
          </div>
          <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {([
              { cls: "prog", w: 30, color: undefined, note: "default" },
              { cls: "prog", w: 80, color: undefined, note: "default" },
              { cls: "prog thin", w: 30, color: "var(--blue)", note: "thin variant" },
              { cls: "prog thin", w: 80, color: "var(--green)", note: "thin variant, success colour" },
            ] as const).map((p, i) => (
              <div key={i}>
                <div className={p.cls}>
                  <i style={{ width: `${p.w}%`, background: p.color }} />
                </div>
                <div className="help" style={{ marginTop: 6 }}>
                  {p.w}% — {p.note}
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="card s6">
          <div className="card-h">
            <h3>KPI / stat strip</h3>
            <div className="sub">.stats · .stat</div>
          </div>
          <div className="stats" style={{ borderRadius: 0, border: 0, background: "var(--bg)" }}>
            <div className="stat">
              <div className="l">VMs healthy</div>
              <div className="v">12/14</div>
            </div>
            <div className="stat">
              <div className="l">Build queue</div>
              <div className="v">1</div>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
