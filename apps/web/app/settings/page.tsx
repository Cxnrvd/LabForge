"use client";

/**
 * /settings — Dashboard 10 redesign.
 *
 * Maps to #p10 in labforge-designs.html. Seven anchor sections wired up to
 * PageToolbars tabs:
 *
 *   General · API & CLI · Vagrant Provider · NVD feed · Catalog overrides ·
 *   Theme · Keybinds
 *
 * UI-only. The only backed endpoint used here is /api/v1/health (read-only)
 * — every editable field persists to a `labforge.*` localStorage key. No new
 * endpoints are introduced; sections without backend support are flagged
 * with a TODO comment inline.
 */

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { useTheme } from "next-themes";
import { toast } from "sonner";

import { PageToolbars, type TabSpec } from "@/components/dashboard/AppShell";
import { getStoredToken } from "@/lib/api/client";

/* ============================================================
   localStorage keys (all under `labforge.*`)
   ============================================================ */

const TOKEN_KEY = "labforge.token";
const WS_NAME_KEY = "labforge.workspace-name";
const WS_THEME_KEY = "labforge.workspace-default-theme";
// TODO: needs backend support — NVD config is local-only until /api/v1/config lands
const NVD_KEY = "labforge.nvd-key";
const NVD_SCHEDULE_KEY = "labforge.nvd-schedule";
// TODO: needs backend support — catalog overrides are local-only
const CATALOG_OVERRIDES_KEY = "labforge.catalog-overrides";
const THEME_VARIANT_KEY = "labforge.theme-variant";

const DEFAULT_WS_NAME = "LabForge · main";
const DEFAULT_NVD_SCHEDULE = "daily";
const DEFAULT_THEME = "dark";
const API_BASE = "/api/v1";

interface CatalogOverride {
  vendor: string;
  url: string;
}

function readLS(key: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  try {
    return window.localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

function writeLS(key: string, value: string): void {
  if (typeof window === "undefined") return;
  try {
    if (value === "") window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

/* ============================================================
   Section anchors
   ============================================================ */

type SectionId =
  | "general"
  | "api"
  | "nvd"
  | "catalog"
  | "theme"
  | "keybinds";

const SECTIONS: { id: SectionId; label: string }[] = [
  { id: "general", label: "General" },
  { id: "api", label: "API & CLI" },
  { id: "nvd", label: "NVD feed" },
  { id: "catalog", label: "Catalog overrides" },
  { id: "theme", label: "Theme" },
  { id: "keybinds", label: "Keybinds" },
];

const KEYBINDS: { action: string; combo: string }[] = [
  { action: "Command palette", combo: "Ctrl K" },
  { action: "Help / keybinds", combo: "?" },
  { action: "Switch tab 1…9", combo: "Alt 1 to Alt 9" },
  { action: "Undo", combo: "Ctrl Z" },
  { action: "Redo", combo: "Ctrl Shift Z" },
  { action: "Save canvas", combo: "Ctrl S" },
  { action: "Build / generate", combo: "Ctrl Enter" },
];

const THEME_SWATCHES: {
  slug: string;
  variant: string;
  name: string;
  sub: string;
  gradient: string;
}[] = [
  {
    slug: "light",
    variant: "dark-pro",
    name: "Light",
    sub: "Soft Cards on a pale grey frame",
    gradient: "linear-gradient(135deg, #f1f1f1, #e8e8e8)",
  },
  {
    slug: "dark",
    variant: "dark-pro",
    name: "Dark",
    sub: "Soft Cards on near black",
    gradient: "linear-gradient(135deg, #121212, #1c1c1c)",
  },
];

/* ============================================================
   Page
   ============================================================ */

export default function SettingsPage(): React.ReactElement {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);
  const [activeSection, setActiveSection] =
    React.useState<SectionId>("general");

  React.useEffect(() => setMounted(true), []);

  /* ------ General ------ */
  const [wsName, setWsName] = React.useState(DEFAULT_WS_NAME);
  const [wsTheme, setWsTheme] = React.useState(DEFAULT_THEME);

  /* ------ API & CLI ------ */
  const [token, setToken] = React.useState("");
  const [showToken, setShowToken] = React.useState(false);

  /* ------ NVD ------ */
  const [nvdKey, setNvdKey] = React.useState("");
  const [showNvdKey, setShowNvdKey] = React.useState(false);
  const [nvdSchedule, setNvdSchedule] = React.useState(DEFAULT_NVD_SCHEDULE);

  /* ------ Catalog overrides ------ */
  const [overrides, setOverrides] = React.useState<CatalogOverride[]>([]);
  const [draftVendor, setDraftVendor] = React.useState("");
  const [draftUrl, setDraftUrl] = React.useState("");

  /* ------ Theme variant ------ */
  const [themeVariant, setThemeVariant] = React.useState("dark-pro");

  /* Hydrate from localStorage on mount. */
  React.useEffect(() => {
    setWsName(readLS(WS_NAME_KEY, DEFAULT_WS_NAME));
    setWsTheme(readLS(WS_THEME_KEY, DEFAULT_THEME));
    setToken(getStoredToken() ?? "");
    setNvdKey(readLS(NVD_KEY, ""));
    setNvdSchedule(readLS(NVD_SCHEDULE_KEY, DEFAULT_NVD_SCHEDULE));
    setThemeVariant(readLS(THEME_VARIANT_KEY, "dark-pro"));
    try {
      const raw = window.localStorage.getItem(CATALOG_OVERRIDES_KEY);
      if (raw) setOverrides(JSON.parse(raw) as CatalogOverride[]);
    } catch {
      /* ignore */
    }
  }, []);

  const persist =
    (key: string, setter: (v: string) => void) =>
    (v: string): void => {
      setter(v);
      writeLS(key, v);
    };

  const persistOverrides = (next: CatalogOverride[]): void => {
    setOverrides(next);
    try {
      window.localStorage.setItem(CATALOG_OVERRIDES_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  };

  /* ------ Health (status pill for API section) ------ */
  const healthQ = useQuery<{ status?: string; _latencyMs: number }>({
    queryKey: ["api-health-settings"],
    queryFn: async () => {
      const start = performance.now();
      const res = await fetch("/api/v1/health", { cache: "no-store" });
      const latency = Math.round(performance.now() - start);
      if (!res.ok) throw new Error(`${res.status}`);
      const body = (await res.json()) as { status?: string };
      return { ...body, _latencyMs: latency };
    },
    refetchInterval: 10_000,
    retry: 1,
  });
  const apiHealthy = healthQ.data?.status === "ok";

  /* ============================================================
     Section scroll + active-tab tracking
     ============================================================ */

  // IntersectionObserver lights up the active tab as sections scroll into view.
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  React.useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const root = containerRef.current;
    if (!root) return;
    const targets = SECTIONS.map((s) =>
      document.getElementById(s.id),
    ).filter((el): el is HTMLElement => el !== null);
    const obs = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (visible) setActiveSection(visible.target.id as SectionId);
      },
      { root, threshold: [0.25, 0.55] },
    );
    targets.forEach((t) => obs.observe(t));
    return () => obs.disconnect();
  }, []);

  const scrollTo = (id: SectionId): void => {
    setActiveSection(id);
    document.getElementById(id)?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  };

  const tabs: TabSpec[] = SECTIONS.map((s) => ({
    id: s.id,
    label: s.label,
    href: `#${s.id}`,
    active: activeSection === s.id,
    onSelect: () => scrollTo(s.id),
  }));

  /* ============================================================
     tb3 actions: Reset + Export
     ============================================================ */

  const allKeys = [
    TOKEN_KEY,
    WS_NAME_KEY,
    WS_THEME_KEY,
    NVD_KEY,
    NVD_SCHEDULE_KEY,
    CATALOG_OVERRIDES_KEY,
    THEME_VARIANT_KEY,
  ];

  const onReset = (): void => {
    if (
      typeof window !== "undefined" &&
      !window.confirm("Reset all LabForge settings to defaults?")
    ) {
      return;
    }
    allKeys.forEach((k) => writeLS(k, ""));
    setWsName(DEFAULT_WS_NAME);
    setWsTheme(DEFAULT_THEME);
    setToken("");
    setNvdKey("");
    setNvdSchedule(DEFAULT_NVD_SCHEDULE);
    setOverrides([]);
    setThemeVariant("dark-pro");
    setTheme("dark");
    toast.success("Settings reset to defaults");
  };

  const onExport = (): void => {
    const snapshot: Record<string, string | null> = {};
    if (typeof window !== "undefined") {
      allKeys.forEach((k) => {
        snapshot[k] = window.localStorage.getItem(k);
      });
    }
    const blob = new Blob([JSON.stringify(snapshot, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "labforge-config.json";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success("Exported labforge-config.json");
  };

  const onCopyBase = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(API_BASE);
      toast.success(`Copied “${API_BASE}”`);
    } catch {
      toast.error("Copy failed");
    }
  };

  const onCopyToken = async (): Promise<void> => {
    if (!token) {
      toast.info("No token to copy");
      return;
    }
    try {
      await navigator.clipboard.writeText(token);
      toast.success("Token copied to clipboard");
    } catch {
      toast.error("Copy failed");
    }
  };

  const onAddOverride = (): void => {
    const vendor = draftVendor.trim();
    const url = draftUrl.trim();
    if (!vendor || !url) {
      toast.info("Vendor + URL required");
      return;
    }
    if (overrides.some((o) => o.vendor === vendor)) {
      toast.info(`Override for “${vendor}” already exists`);
      return;
    }
    persistOverrides([...overrides, { vendor, url }]);
    setDraftVendor("");
    setDraftUrl("");
  };

  const onRemoveOverride = (vendor: string): void => {
    persistOverrides(overrides.filter((o) => o.vendor !== vendor));
  };

  const onPickTheme = (slug: string, variant: string): void => {
    setTheme(slug);
    setThemeVariant(variant);
    writeLS(THEME_VARIANT_KEY, variant);
    writeLS(WS_THEME_KEY, slug);
    setWsTheme(slug);
  };

  const actions = (
    <>
      <button type="button" className="btn" onClick={onReset}>
        ↺ Reset to defaults
      </button>
      <button type="button" className="btn primary" onClick={onExport}>
        ⤓ Export config (JSON)
      </button>
    </>
  );

  /* ============================================================
     Render
     ============================================================ */

  return (
    <>
      <PageToolbars tabs={tabs} actions={actions} />

      <div
        ref={containerRef}
        className="frame-pad scroll"
        style={{ flex: 1, minHeight: 0, overflowY: "auto" }}
      >
        {/* ============================================================
            1. General
            ============================================================ */}
        <section id="general" style={{ scrollMarginTop: 12 }}>
          <div className="card" style={{ marginBottom: 14 }}>
            <div className="card-h">
              <span className="title">General</span>
              <div className="actions">
                <span className="muted">localStorage</span>
              </div>
            </div>
            <div className="card-b">
              <div className="g-2">
                <div className="field">
                  <div className="l">Workspace name</div>
                  <input
                    value={wsName}
                    onChange={(e) =>
                      persist(WS_NAME_KEY, setWsName)(e.target.value)
                    }
                  />
                </div>
                <div className="field">
                  <div className="l">Default theme</div>
                  <select
                    value={wsTheme}
                    onChange={(e) => {
                      persist(WS_THEME_KEY, setWsTheme)(e.target.value);
                      setTheme(e.target.value);
                    }}
                  >
                    <option value="dark">Dark</option>
                    <option value="light">Light</option>
                    <option value="system">System</option>
                  </select>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ============================================================
            2. API & CLI
            ============================================================ */}
        <section id="api" style={{ scrollMarginTop: 12 }}>
          <div className="card" style={{ marginBottom: 14 }}>
            <div className="card-h">
              <span className="title">API &amp; CLI</span>
              <div className="actions">
                {apiHealthy ? (
                  <span className="pill act">
                    ● healthy {healthQ.data?._latencyMs ?? 0}ms
                  </span>
                ) : (
                  <span className="pill danger">● offline</span>
                )}
              </div>
            </div>
            <div className="card-b">
              <div className="field">
                <div className="l">API base URL</div>
                <div style={{ display: "flex", gap: 8 }}>
                  <input
                    className="mono"
                    value={API_BASE}
                    readOnly
                    style={{ flex: 1, color: "var(--d10-fg-faint)" }}
                  />
                  <button type="button" className="btn" onClick={onCopyBase}>
                    ⎘ Copy
                  </button>
                </div>
              </div>
              <div className="field">
                <div className="l">CLI agent token</div>
                <div style={{ display: "flex", gap: 8 }}>
                  <input
                    type={showToken ? "text" : "password"}
                    value={token}
                    onChange={(e) =>
                      persist(TOKEN_KEY, setToken)(e.target.value)
                    }
                    placeholder="paste bearer token…"
                    autoComplete="off"
                    style={{ flex: 1 }}
                  />
                  <button
                    type="button"
                    className="btn"
                    onClick={() => setShowToken((v) => !v)}
                  >
                    {showToken ? "Hide" : "Show"}
                  </button>
                  <button type="button" className="btn" onClick={onCopyToken}>
                    ⎘ Copy
                  </button>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ============================================================
            3. NVD feed
            (Vagrant Provider moved to /build/generate — it directly
            drives Vagrantfile generation, so it belongs in that flow.)
            ============================================================ */}
        {/* TODO: needs backend support */}
        <section id="nvd" style={{ scrollMarginTop: 12 }}>
          <div className="card" style={{ marginBottom: 14 }}>
            <div className="card-h">
              <span className="title">NVD feed</span>
              <div className="actions">
                <span className="muted">Saved in this browser only. The API does not use it yet.</span>
              </div>
            </div>
            <div className="card-b">
              <div className="g-2">
                <div className="field">
                  <div className="l">NVD API key</div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <input
                      className="mono"
                      type={showNvdKey ? "text" : "password"}
                      value={nvdKey}
                      onChange={(e) =>
                        persist(NVD_KEY, setNvdKey)(e.target.value)
                      }
                      placeholder="leave empty for unauthenticated"
                      autoComplete="off"
                      style={{ flex: 1 }}
                    />
                    <button
                      type="button"
                      className="btn"
                      onClick={() => setShowNvdKey((v) => !v)}
                    >
                      {showNvdKey ? "Hide" : "Show"}
                    </button>
                  </div>
                </div>
                <div className="field">
                  <div className="l">Sync schedule</div>
                  <select
                    value={nvdSchedule}
                    onChange={(e) =>
                      persist(NVD_SCHEDULE_KEY, setNvdSchedule)(e.target.value)
                    }
                  >
                    <option value="manual">Manual</option>
                    <option value="daily">Daily</option>
                    <option value="hourly">Hourly</option>
                  </select>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ============================================================
            5. Catalog overrides
            ============================================================ */}
        {/* TODO: needs backend support */}
        <section id="catalog" style={{ scrollMarginTop: 12 }}>
          <div className="card" style={{ marginBottom: 14 }}>
            <div className="card-h">
              <span className="title">Catalog overrides</span>
              <div className="actions">
                <span className="muted">
                  {overrides.length} override{overrides.length === 1 ? "" : "s"} · saved in this browser only, the API ignores them
                </span>
              </div>
            </div>
            <div className="card-b">
              <table>
                <thead>
                  <tr>
                    <th>Vendor</th>
                    <th>Custom installer URL</th>
                    <th style={{ width: 80 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {overrides.length === 0 ? (
                    <tr>
                      <td
                        colSpan={3}
                        className="muted"
                        style={{ textAlign: "center", padding: "16px 12px" }}
                      >
                        No overrides defined.
                      </td>
                    </tr>
                  ) : (
                    overrides.map((o) => (
                      <tr key={o.vendor}>
                        <td>
                          <strong>{o.vendor}</strong>
                        </td>
                        <td className="mono" style={{ fontSize: 11 }}>
                          {o.url}
                        </td>
                        <td>
                          <button
                            type="button"
                            className="btn danger"
                            onClick={() => onRemoveOverride(o.vendor)}
                          >
                            Remove
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                  <tr>
                    <td>
                      <input
                        value={draftVendor}
                        onChange={(e) => setDraftVendor(e.target.value)}
                        placeholder="vendor slug"
                      />
                    </td>
                    <td>
                      <input
                        className="mono"
                        value={draftUrl}
                        onChange={(e) => setDraftUrl(e.target.value)}
                        placeholder="https://…"
                      />
                    </td>
                    <td>
                      <button
                        type="button"
                        className="btn primary"
                        onClick={onAddOverride}
                      >
                        + Add
                      </button>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </section>

        {/* ============================================================
            6. Theme
            ============================================================ */}
        <section id="theme" style={{ scrollMarginTop: 12 }}>
          <div className="card" style={{ marginBottom: 14 }}>
            <div className="card-h">
              <span className="title">Theme</span>
              <div className="actions">
                <span className="muted">
                  {mounted ? `${theme ?? "system"}` : "…"}
                </span>
              </div>
            </div>
            <div className="card-b">
              <div className="g-2" style={{ rowGap: 12 }}>
                {THEME_SWATCHES.map((s) => {
                  const selected =
                    mounted && theme === s.slug && themeVariant === s.variant;
                  return (
                    <button
                      key={s.variant}
                      type="button"
                      onClick={() => onPickTheme(s.slug, s.variant)}
                      style={{
                        background: "var(--d10-bg-elev-2)",
                        border: selected
                          ? "2px solid var(--d10-accent)"
                          : "1px solid var(--d10-border)",
                        borderRadius: 6,
                        padding: 14,
                        textAlign: "left",
                        cursor: "pointer",
                        color: "var(--d10-fg)",
                        boxShadow: selected
                          ? "0 0 0 2px rgba(var(--d10-accent-rgb), 0.18)"
                          : undefined,
                      }}
                    >
                      <div
                        style={{
                          width: "100%",
                          height: 56,
                          background: s.gradient,
                          borderRadius: 4,
                          marginBottom: 8,
                        }}
                      />
                      <div
                        style={{
                          fontWeight: 600,
                          color: "var(--d10-fg-strong)",
                          fontSize: 12,
                        }}
                      >
                        {s.name}
                      </div>
                      <div className="muted" style={{ fontSize: 10 }}>
                        {s.sub}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </section>

        {/* ============================================================
            7. Keybinds
            ============================================================ */}
        <section id="keybinds" style={{ scrollMarginTop: 12 }}>
          <div className="card" style={{ marginBottom: 14 }}>
            <div className="card-h">
              <span className="title">Keybinds</span>
              <div className="actions">
                <span className="muted">read-only</span>
              </div>
            </div>
            <div className="card-b">
              <table>
                <thead>
                  <tr>
                    <th>Action</th>
                    <th>Combo</th>
                  </tr>
                </thead>
                <tbody>
                  {KEYBINDS.map((k) => (
                    <tr key={k.action}>
                      <td>{k.action}</td>
                      <td>
                        <span className="kbd">{k.combo}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      </div>
    </>
  );
}
