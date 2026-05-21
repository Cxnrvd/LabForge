"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  AlertTriangle,
  GraduationCap,
  Hammer,
  LayoutDashboard,
  LayoutTemplate,
  Search,
  Server,
  Settings,
  Zap,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";

import { cn } from "@/lib/utils/cn";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { CommandPalette } from "@/components/canvas/CommandPalette";
import { KeybindingsHelp } from "@/components/dashboard/KeybindingsHelp";
import { ThemeToggle } from "@/components/dashboard/ThemeToggle";

interface NavItem {
  href: string;
  label: string;
  Icon: React.ComponentType<{ className?: string }>;
}

const NAV: NavItem[] = [
  { href: "/", label: "Dashboard", Icon: LayoutDashboard },
  { href: "/build", label: "Build", Icon: Hammer },
  { href: "/monitor", label: "Monitor", Icon: Activity },
  { href: "/templates", label: "Templates", Icon: LayoutTemplate },
  { href: "/labs", label: "Labs", Icon: Server },
  { href: "/learn", label: "Learn", Icon: GraduationCap },
  { href: "/settings", label: "Settings", Icon: Settings },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? "/";

  const [paletteOpen, setPaletteOpen] = React.useState(false);
  const [helpOpen, setHelpOpen] = React.useState(false);
  React.useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
        return;
      }
      // `?` opens the help dialog. Skip when the user is in an input so
      // the literal `?` character can still be typed.
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
    return pathname.startsWith(href);
  };

  // Light cross-app counts so the rail can hint at activity without making
  // the user click around. Polled gently — these are just signals.
  const labsQ = useQuery<Array<{ status: string }>>({
    queryKey: ["labs"],
    queryFn: () => fetch("/api/v1/labs").then((r) => r.json()),
    refetchInterval: 8000,
    staleTime: 4000,
  });

  // Soft warning if the API is running with auth disabled. Stays out of
  // the way (small pill near the right side of the header) so it doesn't
  // nag developers but is impossible to miss in prod.
  const healthQ = useQuery<{ auth_required?: boolean }>({
    queryKey: ["api-health-banner"],
    queryFn: () => fetch("/api/v1/health").then((r) => r.json()),
    refetchInterval: 30_000,
    staleTime: 15_000,
  });
  const authDisabled = healthQ.data?.auth_required === false;
  const counts: Record<string, number> = {};
  for (const l of labsQ.data ?? []) {
    if (l.status === "building" || l.status === "pending") {
      counts["/monitor"] = (counts["/monitor"] ?? 0) + 1;
    }
    if (l.status === "running" || l.status === "partial") {
      counts["/labs"] = (counts["/labs"] ?? 0) + 1;
    }
  }

  return (
    <div className="flex h-screen w-screen overflow-hidden">
      {/* Left rail */}
      <aside className="flex w-14 shrink-0 flex-col items-center gap-2 border-r bg-card py-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary text-primary-foreground">
          <Zap className="h-4 w-4" />
        </div>
        <nav className="mt-3 flex flex-col items-center gap-1">
          {NAV.map(({ href, label, Icon }) => {
            const badge = counts[href];
            return (
              <Tooltip key={href}>
                <TooltipTrigger asChild>
                  <Link
                    href={href}
                    className={cn(
                      "relative flex h-10 w-10 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
                      isActive(href) && "bg-accent text-foreground",
                    )}
                    aria-label={label}
                  >
                    <Icon className="h-4 w-4" />
                    {badge ? (
                      <span
                        className={cn(
                          "absolute -right-1 -top-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold leading-none ring-2 ring-card",
                          href === "/monitor"
                            ? "bg-blue-500 text-white"
                            : "bg-emerald-500 text-white",
                        )}
                      >
                        {badge}
                      </span>
                    ) : null}
                  </Link>
                </TooltipTrigger>
                <TooltipContent side="right">
                  {label}
                  {badge ? ` · ${badge}` : ""}
                </TooltipContent>
              </Tooltip>
            );
          })}
        </nav>
        <div className="mt-auto" />
      </aside>

      {/* Main area */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-3 border-b bg-card/60 px-4">
          <h1 className="text-sm font-semibold tracking-tight">
            LabForge Mission Control
          </h1>
          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            className="ml-auto flex h-8 items-center gap-2 rounded-md border bg-background px-2 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            aria-label="Open command palette"
          >
            <Search className="h-3 w-3" />
            <span className="hidden sm:inline">Quick search…</span>
            <kbd className="ml-1 rounded border bg-muted px-1.5 py-0.5 font-mono text-[10px]">
              ⌘K
            </kbd>
          </button>
          {authDisabled && (
            <Tooltip>
              <TooltipTrigger asChild>
                <span
                  role="status"
                  className="inline-flex items-center gap-1 rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-700 dark:text-amber-300"
                >
                  <AlertTriangle className="h-3 w-3" /> Dev mode
                </span>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                API is running with <code>LABFORGE_AGENT_TOKEN</code> unset — write
                endpoints accept all callers. Required only on a non-dev deployment.
              </TooltipContent>
            </Tooltip>
          )}
          <ThemeToggle />
          <span className="text-xs text-muted-foreground">v0.1</span>
        </header>
        <main className="min-h-0 flex-1 overflow-auto">{children}</main>
      </div>
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
      <KeybindingsHelp open={helpOpen} onOpenChange={setHelpOpen} />
    </div>
  );
}
