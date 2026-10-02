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
  icon: IconName;
  badge?: { label: string; hot?: boolean };
}

type IconName =
  | "home" | "canvas" | "labs" | "monitor" | "templates" | "vendors" | "cves"
  | "check" | "download" | "settings" | "agent" | "docs" | "sun" | "moon" | "bell" | "help";

const ICON_PATHS: Record<IconName, string> = {
  home: "M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z",
  canvas: "M4 4h6v6H4zM14 4h6v6h-6zM9 14h6v6H9zM7 10v2h10v-2M12 12v2",
  labs: "M9 3h6M10 3v6L4.5 19a1.5 1.5 0 0 0 1.3 2h12.4a1.5 1.5 0 0 0 1.3-2L14 9V3M7.5 15h9",
  monitor: "M3 12h4l3-8 4 16 3-8h4",
  templates: "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z",
  vendors: "M12 2l8 4.5v9L12 20l-8-4.5v-9zM12 11v9M4 6.5l8 4.5 8-4.5",
  cves: "M12 3l10 18H2zM12 10v5M12 18v.01",
  check: "M5 12.5l4.5 4.5L19 7",
  download: "M12 4v11M7 11l5 5 5-5M5 20h14",
  settings: "M4 6h10M18 6h2M4 12h2M10 12h10M4 18h12M20 18h0M14 4v4M6 10v4M16 16v4",
  agent: "M4 5h16v14H4zM8 10l3 2-3 2M13 15h4",
  docs: "M7 3h8l4 4v14H7zM15 3v4h4M10 12h6M10 16h6",
  sun: "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M5 19l1.5-1.5M17.5 6.5L19 5",
  moon: "M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z",
  bell: "M6 16V11a6 6 0 0 1 12 0v5l2 2H4zM10 21h4",
  help: "M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 1-1 1.7M12 17v.01M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z",
};

function Icon({ name, size = 18 }: { name: IconName; size?: number }): React.ReactElement {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={ICON_PATHS[name]} />
    </svg>
  );
}

const WORKSPACE_NAV: NavEntry[] = [
  { href: "/", label: "Home", icon: "home" },
  { href: "/build", label: "Canvas", icon: "canvas", badge: { label: "live", hot: true } },
  { href: "/labs", label: "Labs", icon: "labs" },
  { href: "/monitor", label: "Monitor", icon: "monitor" },
  { href: "/templates", label: "Templates", icon: "templates" },
];

const CATALOG_NAV: NavEntry[] = [
  { href: "/vendors", label: "Vendors", icon: "vendors", badge: { label: "50+" } },
  { href: "/cves", label: "CVEs", icon: "cves" },
];

const BUILD_NAV: NavEntry[] = [
  { href: "/build/validate", label: "Validation", icon: "check" },
  { href: "/build/generate", label: "Generate", icon: "download" },
];

const SYSTEM_NAV: NavEntry[] = [
  { href: "/settings", label: "Settings", icon: "settings" },
  { href: "/onboard", label: "CLI Agent", icon: "agent" },
  { href: "/doctor", label: "API Docs", icon: "docs" },
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
    pathname === "/build" ||
    pathname === "/build/validate";

  return (
    <div className="lf" data-theme={isDark ? "dark" : "light"} suppressHydrationWarning>
      <div className="frame">
      <aside className="sidebar">
        <div className="brand">
          <div className="logo">LF</div>
          <div className="ws">LabForge</div>
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
          <div className="who">
            <div className="av">CM</div>
            <div>
              <div className="nm">Conrad</div>
              <div className="sb">
                <span className="dot" style={apiOk ? undefined : { background: "var(--d10-err)" }} />
                {apiOk ? "API online" : "API offline"}
              </div>
            </div>
          </div>
        </div>
      </aside>

      <div className="frame-main">
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
              aria-label="Open command palette (Ctrl+K)"
            >
              Ctrl K
            </button>
            <button
              type="button"
              className="iconbtn"
              onClick={toggleTheme}
              aria-label={`Switch to ${isDark ? "light" : "dark"} theme`}
              title={`Theme: ${activeTheme}, click to switch`}
              suppressHydrationWarning
            >
              <Icon name={isDark ? "sun" : "moon"} />
            </button>
            <button type="button" className="iconbtn" onClick={() => setHelpOpen(true)} aria-label="Help (?)">
              <Icon name="help" />
            </button>
            <span className="iconbtn bell" title={`${runningCount} running`}>
              <Icon name="bell" />
              {runningCount > 0 && <span className="n">{runningCount}</span>}
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
      <span className="icn"><Icon name={entry.icon} /></span>
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
  if (pathname === "/") return ["Workspace", "Home"];
  const segments = pathname.split("/").filter(Boolean);
  const head = segments[0] ?? "";
  switch (head) {
    case "build":
      if (segments[1] === "validate") return ["Build", "Validation"];
      if (segments[1] === "generate") return ["Build", "Generate"];
      return ["Canvas"];
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
