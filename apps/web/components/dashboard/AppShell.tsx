"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useTheme } from "next-themes";

import { CommandPalette } from "@/components/canvas/CommandPalette";
import { KeybindingsHelp } from "@/components/dashboard/KeybindingsHelp";
import { cn } from "@/lib/utils/cn";

/**
 * LabForge Dashboard 10 application shell.
 *
 * Renders the 220 px sidebar + the topmost ``.tb1`` breadcrumb. Per-page
 * ``tb2`` (tabs) and ``tb3`` (actions) toolbars are rendered by each page
 * via the `<PageToolbars>` helper exported from this module — kept here so
 * every page imports a single, consistent component family.
 *
 * Every visual rule in this shell comes from labforge-designs.html / the
 * ``.lf .…`` classes in apps/web/styles/labforge-d10.css. The shadcn HSL
 * palette stays available for the existing leaf components (drawers,
 * tooltips, sonner toasts), but the page chrome is purely D10-classed.
 */

interface NavEntry {
  href: string;
  label: string;
  icon: string; // single-char glyph from the mockup (◧, ◆, ▤, ◰, ⚙, ⚠, ✓, ⬇, ⌥)
  badge?: { label: string; hot?: boolean };
}

const WORKSPACE_NAV: NavEntry[] = [
  { href: "/", label: "Dashboard", icon: "◧" },
  { href: "/build", label: "Canvas", icon: "◆", badge: { label: "live", hot: true } },
  { href: "/labs", label: "Labs", icon: "▤" },
  { href: "/monitor", label: "Monitor", icon: "◉" },
  { href: "/templates", label: "Templates", icon: "◰" },
];

const CATALOG_NAV: NavEntry[] = [
  { href: "/vendors", label: "Vendors", icon: "⚙", badge: { label: "50+" } },
  { href: "/cves", label: "CVEs", icon: "⚠", badge: { label: "2", hot: true } },
];

const BUILD_NAV: NavEntry[] = [
  { href: "/build/validate", label: "Validation", icon: "✓" },
  { href: "/build/generate", label: "Generate", icon: "⬇" },
];

const SYSTEM_NAV: NavEntry[] = [
  { href: "/settings", label: "Settings", icon: "⌥" },
  { href: "/onboard", label: "CLI Agent", icon: "⎘" },
  { href: "/doctor", label: "API Docs", icon: "⌕" },
];

/* ============================================================
   Shell
   ============================================================ */

export function AppShell({ children }: { children: React.ReactNode }): React.ReactElement {
  const pathname = usePathname() ?? "/";
  const [paletteOpen, setPaletteOpen] = React.useState(false);
  const [helpOpen, setHelpOpen] = React.useState(false);
  const { theme, resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);
  // SSR-safe: render dark tokens until hydration so the data-theme attribute
  // matches the server output, then flip to the user's actual preference.
  const activeTheme = mounted ? (resolvedTheme ?? theme ?? "dark") : "dark";
  const isDark = activeTheme !== "light";
  const toggleTheme = (): void => setTheme(isDark ? "light" : "dark");

  React.useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
        return;
      }
      if (e.key === "?" && !meta) {
        const t = e.target as HTMLElement | null;
        const tag = t?.tagName?.toLowerCase();
        if (tag === "input" || tag === "textarea" || t?.isContentEditable) return;
        e.preventDefault();
        setHelpOpen(true);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const isActive = (href: string): boolean => {
    if (href === "/") return pathname === "/";
    return pathname === href || pathname.startsWith(`${href}/`);
  };

  // Live counts feeding badges in the sidebar + tb1. Cheap polls; failures
  // are silent so the shell renders even if the API is down.
  const labsQ = useQuery<Array<{ id: number; status: string }>>({
    queryKey: ["labs"],
    queryFn: () => fetch("/api/v1/labs").then((r) => r.json()),
    refetchInterval: 8000,
    staleTime: 4000,
  });
  const healthQ = useQuery<{ status?: string }>({
    queryKey: ["api-health"],
    queryFn: () => fetch("/api/v1/health").then((r) => r.json()),
    refetchInterval: 15_000,
    staleTime: 8_000,
  });
  const apiOk = healthQ.data?.status === "ok";
  const labsCount = labsQ.data?.length ?? 0;
  const runningCount = (labsQ.data ?? []).filter(
    (l) => l.status === "running" || l.status === "partial",
  ).length;

  const workspaceNavWithCounts: NavEntry[] = WORKSPACE_NAV.map((e) => {
    if (e.href === "/labs" && labsCount > 0) {
      return { ...e, badge: { label: String(labsCount) } };
    }
    if (e.href === "/build" && runningCount === 0) {
      // Drop the "live" hot badge when nothing is actually building.
      return { ...e, badge: undefined };
    }
    return e;
  });

  const breadcrumb = breadcrumbFor(pathname);

  // Pages that own multi-pane internal scrolling — disable the outer
  // `.content` scroll so only the individual panes scroll their own
  // content. Each of these pages already wires per-pane `overflow-y: auto`.
  const noOuterScroll =
    pathname === "/cves" ||
    pathname === "/vendors" ||
    pathname === "/labs" ||
    pathname.startsWith("/labs/") ||
    pathname === "/build/validate";

  return (
    <div className="lf" data-theme={isDark ? "dark" : "light"} suppressHydrationWarning>
      <aside className="sidebar">
        <div className="brand">
          <div className="logo">LF</div>
          <div className="ws">
            LabForge
            <small>v1.4 · main</small>
          </div>
        </div>
        <div className="section-label">Workspace</div>
        {workspaceNavWithCounts.map((e) => (
          <SideLink key={e.href} entry={e} active={isActive(e.href)} />
        ))}
        <div className="section-label">Catalog</div>
        {CATALOG_NAV.map((e) => (
          <SideLink key={e.href} entry={e} active={isActive(e.href)} />
        ))}
        <div className="section-label">Build</div>
        {BUILD_NAV.map((e) => (
          <SideLink key={e.href} entry={e} active={isActive(e.href)} />
        ))}
        <div className="section-label">System</div>
        {SYSTEM_NAV.map((e) => (
          <SideLink key={e.href} entry={e} active={isActive(e.href)} />
        ))}
        <div className="footer">
          <span className="dot" />
          <span>
            API ·{" "}
            <span className="mono">
              {apiOk ? "127.0.0.1:8000" : "offline"}
            </span>
          </span>
        </div>
      </aside>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          flex: 1,
          minWidth: 0,
          minHeight: 0,
          height: "100vh",
          overflow: "hidden",
        }}
      >
        <header className="tb1">
          <div className="crumb">
            <span style={{ marginLeft: 0 }}>LabForge</span>
            {breadcrumb.map((seg, i) => (
              <React.Fragment key={i}>
                <span style={{ color: "var(--d10-fg-faint)", marginLeft: 8 }}>/</span>
                <span className={i === breadcrumb.length - 1 ? "head" : undefined}>
                  {seg}
                </span>
              </React.Fragment>
            ))}
          </div>
          {pathname.startsWith("/build") && (
            <span className="autosave">
              <span className="dot" />
              autosaved 2s ago
            </span>
          )}
          <div className="right">
            <button
              type="button"
              onClick={() => setPaletteOpen(true)}
              className="kbd"
              style={{ cursor: "pointer" }}
              aria-label="Open command palette (⌘K)"
            >
              ⌘K
            </button>
            <button
              type="button"
              onClick={toggleTheme}
              style={{
                background: "transparent",
                border: 0,
                color: "var(--d10-fg-mute)",
                fontSize: 14,
                cursor: "pointer",
                padding: "2px 4px",
                lineHeight: 1,
              }}
              aria-label={`Switch to ${isDark ? "light" : "dark"} theme`}
              title={`Theme: ${activeTheme} — click to switch`}
              suppressHydrationWarning
            >
              {isDark ? "☀" : "☾"}
            </button>
            <button
              type="button"
              onClick={() => setHelpOpen(true)}
              style={{
                background: "transparent",
                border: 0,
                color: "var(--d10-fg-faint)",
                fontSize: 12,
                cursor: "pointer",
              }}
              aria-label="Help (?)"
            >
              ?
            </button>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              🔔 <span style={{ color: "var(--d10-accent)" }}>{Math.min(3, runningCount)}</span>
            </span>
            <div className="avtar">CM</div>
          </div>
        </header>

        <main
          className={cn("content", noOuterScroll && "content--noscroll")}
          style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}
        >
          {children}
        </main>
      </div>

      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
      <KeybindingsHelp open={helpOpen} onOpenChange={setHelpOpen} />
    </div>
  );
}

/* ============================================================
   Sidebar link
   ============================================================ */

function SideLink({ entry, active }: { entry: NavEntry; active: boolean }): React.ReactElement {
  return (
    <Link
      href={entry.href}
      className={cn("nav", active && "active")}
      aria-current={active ? "page" : undefined}
    >
      <span className="icn">{entry.icon}</span>
      <span>{entry.label}</span>
      {entry.badge && (
        <span className={cn("badge", entry.badge.hot && "hot")}>{entry.badge.label}</span>
      )}
    </Link>
  );
}

/* ============================================================
   Per-page toolbars
   ============================================================ */

export interface TabSpec {
  id: string;
  label: string;
  count?: number | string;
  countTone?: "ok" | "warn" | "err" | "accent";
  onSelect?: () => void;
  active?: boolean;
  href?: string;
}

export interface PageToolbarsProps {
  tabs?: TabSpec[];
  /** Optional right-aligned hint inside tb2 (e.g. "⌥+1…9 to switch"). */
  tabHint?: React.ReactNode;
  /** Whole tb3 content. Pages compose buttons + dividers themselves so
   *  the shell stays generic across canvas/templates/labs/etc. */
  actions?: React.ReactNode;
  /** Drop tb2 entirely (e.g. dashboard page). */
  noTabs?: boolean;
  /** Drop tb3 entirely (rare; dashboard does this). */
  noActions?: boolean;
}

/**
 * Render the second + third toolbar rows. Pages opt-in:
 *
 *   <PageToolbars
 *     tabs={[{ id: "all", label: "All labs", count: 7, active: true }]}
 *     actions={<><input className="search" placeholder="Search…" />…</>}
 *   />
 */
export function PageToolbars({
  tabs,
  tabHint,
  actions,
  noTabs,
  noActions,
}: PageToolbarsProps): React.ReactElement {
  return (
    <>
      {!noTabs && (
        <div className="tb2">
          {tabs?.map((t) =>
            t.href ? (
              <Link
                key={t.id}
                href={t.href}
                className={cn("tab", t.active && "act")}
                style={{ textDecoration: "none" }}
              >
                {t.label}
                {t.count !== undefined && (
                  <span className={cn("ct", t.countTone)}>· {t.count}</span>
                )}
              </Link>
            ) : (
              <button
                key={t.id}
                type="button"
                className={cn("tab", t.active && "act")}
                onClick={t.onSelect}
              >
                {t.label}
                {t.count !== undefined && (
                  <span className={cn("ct", t.countTone)}>· {t.count}</span>
                )}
              </button>
            ),
          )}
          {tabHint && <span className="right">{tabHint}</span>}
        </div>
      )}
      {!noActions && actions !== undefined && <div className="tb3">{actions}</div>}
    </>
  );
}

/* ============================================================
   Internal helpers
   ============================================================ */

function breadcrumbFor(pathname: string): string[] {
  if (pathname === "/") return ["Workspace", "Dashboard"];
  const segments = pathname.split("/").filter(Boolean);
  const head = segments[0] ?? "";
  switch (head) {
    case "build":
      if (segments[1] === "validate") return ["Build", "Validation"];
      if (segments[1] === "generate") return ["Build", "Generate"];
      return ["Canvas", segments[1] ?? "Untitled"];
    case "labs":
      return segments.length > 1
        ? ["Workspace", "Labs", segments[1] ?? ""]
        : ["Workspace", "Labs"];
    case "monitor":
      return segments.length > 1
        ? ["Workspace", "Monitor", segments[1] ?? ""]
        : ["Workspace", "Monitor"];
    case "templates":
      return ["Catalog", "Templates"];
    case "vendors":
      return ["Catalog", "Vendors"];
    case "cves":
      return ["Catalog", "CVEs"];
    case "settings":
      return ["System", "Settings"];
    case "doctor":
      return ["System", "Doctor"];
    case "onboard":
      return ["System", "Onboarding"];
    case "design-system":
      return ["System", "Design system"];
    case "states":
      return ["System", "Empty & error states"];
    case "learn":
      return ["Workspace", "Learn"];
    default:
      return [head.charAt(0).toUpperCase() + head.slice(1)];
  }
}
