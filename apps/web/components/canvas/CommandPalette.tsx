"use client";

import * as React from "react";
import { usePathname, useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  Camera,
  CheckCircle2,
  Circle,
  Cloud,
  Cog,
  Crosshair,
  Database,
  Download,
  FileJson,
  Flame,
  Hammer,
  LayoutDashboard,
  LayoutGrid,
  LayoutTemplate,
  Monitor,
  MonitorSpeaker,
  Moon,
  Network,
  Play,
  Plus,
  Server,
  Settings,
  Shield,
  Square,
  Sun,
  Terminal,
  Triangle,
} from "lucide-react";
import { toast } from "sonner";

import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";
import { api, type ApiError } from "@/lib/api/client";
import { useTopologyStore, isZone } from "@/lib/store/topology-store";
import { useLaunchStore } from "@/lib/store/launch-store";
import { layoutTopology } from "@/lib/canvas/auto-layout";
import { downloadBlob, downloadJson } from "@/lib/utils/download";
import {
  useGenerateZip,
  useTemplates,
  useValidateTopology,
} from "@/lib/api/hooks";
import type { LabConfig, NodeType, ZoneShape } from "@labforge/schema";

const NODE_ITEMS: { type: NodeType; label: string; Icon: React.ComponentType<{ className?: string }> }[] = [
  { type: "workstation", label: "Workstation", Icon: Monitor },
  { type: "server", label: "Server", Icon: Server },
  { type: "domain_controller", label: "Domain Controller", Icon: Shield },
  { type: "router", label: "Router", Icon: Network },
  { type: "firewall", label: "Firewall", Icon: Flame },
  { type: "attacker", label: "Attacker", Icon: Terminal },
  { type: "target", label: "Target", Icon: Crosshair },
  { type: "database", label: "Database", Icon: Database },
  { type: "ics_plc", label: "ICS PLC", Icon: Cog },
  { type: "ics_hmi", label: "HMI / SCADA", Icon: MonitorSpeaker },
  { type: "camera", label: "IP Camera", Icon: Camera },
  { type: "internet", label: "Internet", Icon: Cloud },
];

const ZONE_ITEMS: { shape: ZoneShape; label: string; Icon: React.ComponentType<{ className?: string }> }[] = [
  { shape: "rectangle", label: "Rectangle", Icon: Square },
  { shape: "ellipse", label: "Ellipse", Icon: Circle },
  { shape: "triangle", label: "Trapezoid", Icon: Triangle },
  { shape: "cloud", label: "Cloud", Icon: Cloud },
];

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CommandPalette({ open, onOpenChange }: CommandPaletteProps) {
  const router = useRouter();
  const pathname = usePathname() ?? "";
  const { setTheme } = useTheme();
  const addNode = useTopologyStore((s) => s.addNode);
  const addZone = useTopologyStore((s) => s.addZone);
  const setNodePositions = useTopologyStore((s) => s.setNodePositions);
  const setValidationIssues = useTopologyStore((s) => s.setValidationIssues);
  const toTopology = useTopologyStore((s) => s.toTopology);
  const loadTopology = useTopologyStore((s) => s.loadTopology);

  const validate = useValidateTopology();
  const generate = useGenerateZip();
  const templatesQ = useTemplates();
  const close = (): void => onOpenChange(false);

  /**
   * Static drop position when the palette adds a node from outside the
   * canvas page. Routes to /build first so the user sees the result.
   */
  const onCanvas = pathname.startsWith("/build");
  const dropPosition = (): { x: number; y: number } => ({ x: 240, y: 200 });
  const ensureBuilder = (): void => {
    if (!onCanvas) router.push("/build");
  };

  const runAutoLayout = (): void => {
    const { nodes, edges } = useTopologyStore.getState();
    const realNodes = nodes.filter((n) => !isZone(n)).map((n) => ({ id: n.id, type: n.type }));
    if (realNodes.length === 0) {
      toast.error("Canvas is empty");
      return;
    }
    const positions = layoutTopology(
      realNodes,
      edges.map((e) => ({ source: e.source, target: e.target })),
    );
    setNodePositions(positions);
    toast.success("Auto-layout applied");
  };

  const runValidate = async (): Promise<void> => {
    const topology = toTopology();
    try {
      const result = await validate.mutateAsync(topology);
      setValidationIssues(result.issues);
      if (result.valid) {
        toast.success("Topology is valid");
      } else {
        toast.error(`${result.issues.length} validation issue(s)`);
      }
    } catch (err) {
      toast.error("Validation failed", { description: (err as ApiError).detail });
    }
  };

  const runGenerate = async (): Promise<void> => {
    const topology = toTopology();
    if (topology.nodes.length === 0) {
      toast.error("Canvas is empty");
      return;
    }
    try {
      const blob = await generate.mutateAsync(topology);
      const filename = `labforge-${topology.name.toLowerCase().replace(/\s+/g, "-")}.zip`;
      downloadBlob(blob, filename);
      toast.success("Lab generated", { description: filename });
    } catch (err) {
      toast.error("Generation failed", {
        description: (err as ApiError).detail ?? "Check API logs.",
      });
    }
  };

  const runExportJson = (): void => {
    const topology = toTopology();
    if (topology.nodes.length === 0) {
      toast.error("Canvas is empty");
      return;
    }
    downloadJson(topology, `${topology.name.toLowerCase().replace(/\s+/g, "-")}.json`);
    toast.success("Exported topology.json");
  };

  const showLaunch = useLaunchStore((st) => st.show);
  const runBuild = (): void => {
    if (toTopology().nodes.length === 0) {
      toast.error("Canvas is empty");
      return;
    }
    showLaunch();
  };

  const loadTemplate = async (id: string): Promise<void> => {
    try {
      const topology = await api.getTemplate(id);
      loadTopology(topology);
      ensureBuilder();
      toast.success("Template loaded");
    } catch (err) {
      toast.error("Could not load template", {
        description: (err as ApiError).detail,
      });
    }
  };

  const select = (fn: () => void | Promise<void>) => () => {
    close();
    void fn();
  };

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="Type a command or search…" />
      <CommandList>
        <CommandEmpty>No matches.</CommandEmpty>

        <CommandGroup heading="Add to canvas">
          {NODE_ITEMS.map(({ type, label, Icon }) => (
            <CommandItem
              key={`node-${type}`}
              value={`add node ${label}`}
              onSelect={select(() => {
                ensureBuilder();
                addNode(type, dropPosition());
              })}
            >
              <Plus className="opacity-60" />
              <Icon />
              <span>Add {label}</span>
            </CommandItem>
          ))}
          {ZONE_ITEMS.map(({ shape, label, Icon }) => (
            <CommandItem
              key={`zone-${shape}`}
              value={`add zone ${label}`}
              onSelect={select(() => {
                ensureBuilder();
                addZone(shape, dropPosition());
              })}
            >
              <Plus className="opacity-60" />
              <Icon />
              <span>Add {label} zone</span>
            </CommandItem>
          ))}
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Canvas actions">
          <CommandItem value="auto layout LR rearrange" onSelect={select(runAutoLayout)}>
            <LayoutGrid />
            <span>Auto-layout (LR)</span>
          </CommandItem>
          <CommandItem value="validate topology" onSelect={select(runValidate)}>
            <CheckCircle2 />
            <span>Validate topology</span>
          </CommandItem>
          <CommandItem value="export json topology download" onSelect={select(runExportJson)}>
            <FileJson />
            <span>Export JSON</span>
          </CommandItem>
          <CommandItem value="export package download zip" onSelect={select(runGenerate)}>
            <Download />
            <span>Export package (.zip)</span>
          </CommandItem>
          <CommandItem
            value="launch lab start run build"
            onSelect={select(runBuild)}
            className="text-foreground"
          >
            <Play />
            <span>Launch lab</span>
            <CommandShortcut>↵</CommandShortcut>
          </CommandItem>
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Templates">
          {(templatesQ.data ?? []).map((t) => (
            <CommandItem
              key={t.id}
              value={`template ${t.name} ${t.id}`}
              onSelect={select(() => loadTemplate(t.id))}
            >
              <LayoutTemplate />
              <span>{t.name}</span>
              <span className="ml-auto text-[10px] text-muted-foreground">
                {t.node_count} nodes
              </span>
            </CommandItem>
          ))}
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Navigate">
          {[
            { href: "/", label: "Dashboard", Icon: LayoutDashboard },
            { href: "/build", label: "Builder", Icon: Hammer },
            { href: "/monitor", label: "Monitor (builds)", Icon: Terminal },
            { href: "/labs", label: "Labs", Icon: Server },
            { href: "/templates", label: "Templates", Icon: LayoutTemplate },
            { href: "/settings", label: "Settings", Icon: Settings },
          ].map(({ href, label, Icon }) => (
            <CommandItem
              key={href}
              value={`go ${label}`}
              onSelect={select(() => router.push(href))}
            >
              <Icon />
              <span>{label}</span>
              <ArrowRight className="ml-auto opacity-50" />
            </CommandItem>
          ))}
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Theme">
          <CommandItem value="theme light" onSelect={select(() => setTheme("light"))}>
            <Sun /> <span>Light</span>
          </CommandItem>
          <CommandItem value="theme dark" onSelect={select(() => setTheme("dark"))}>
            <Moon /> <span>Dark</span>
          </CommandItem>
          <CommandItem value="theme system" onSelect={select(() => setTheme("system"))}>
            <span>System</span>
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}

