"use client";

import * as React from "react";
import { useReactFlow } from "@xyflow/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
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
  LayoutGrid,
  LayoutTemplate,
  Loader2,
  MoreHorizontal,
  Monitor,
  MonitorSpeaker,
  Network,
  Play,
  Plus,
  Redo2,
  Save,
  Server,
  Shield,
  Square,
  Terminal,
  Triangle,
  Undo2,
} from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { api, type ApiError } from "@/lib/api/client";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Input } from "@/components/ui/input";
import { TopologyMetaPopover } from "@/components/canvas/TopologyMetaPopover";
import { useGenerateZip, useValidateTopology } from "@/lib/api/hooks";
import { isZone, useTopologyStore } from "@/lib/store/topology-store";
import { downloadBlob, downloadJson } from "@/lib/utils/download";
import { layoutTopology } from "@/lib/canvas/auto-layout";
import type { NodeType, ZoneShape } from "@labforge/schema";

interface NodeMenuEntry {
  type: NodeType;
  label: string;
  Icon: React.ComponentType<{ className?: string }>;
}

const NODE_ENTRIES: NodeMenuEntry[] = [
  { type: "workstation", label: "Workstation", Icon: Monitor },
  { type: "server", label: "Server", Icon: Server },
  { type: "domain_controller", label: "Domain Controller", Icon: Shield },
  { type: "router", label: "Router", Icon: Network },
  { type: "firewall", label: "Firewall", Icon: Flame },
  { type: "attacker", label: "Attacker", Icon: Terminal },
  { type: "target", label: "Target", Icon: Crosshair },
  { type: "database", label: "Database", Icon: Database },
  { type: "ics_plc", label: "ICS PLC", Icon: Cog },
  { type: "ics_hmi", label: "ICS HMI / SCADA", Icon: MonitorSpeaker },
  { type: "camera", label: "IP Camera", Icon: Camera },
  { type: "internet", label: "Internet / Cloud", Icon: Cloud },
];

interface ZoneMenuEntry {
  shape: ZoneShape;
  label: string;
  Icon: React.ComponentType<{ className?: string }>;
}

const ZONE_ENTRIES: ZoneMenuEntry[] = [
  { shape: "rectangle", label: "Rectangle (Network / Subnet)", Icon: Square },
  { shape: "ellipse", label: "Ellipse (Cluster / Forest)", Icon: Circle },
  { shape: "triangle", label: "Trapezoid (Trust / DMZ)", Icon: Triangle },
  { shape: "cloud", label: "Cloud (External / SaaS)", Icon: Cloud },
];

export function Toolbar() {
  const { screenToFlowPosition } = useReactFlow();
  const addNode = useTopologyStore((s) => s.addNode);
  const addZone = useTopologyStore((s) => s.addZone);
  const setNodePositions = useTopologyStore((s) => s.setNodePositions);
  const undo = useTopologyStore((s) => s.undo);
  const redo = useTopologyStore((s) => s.redo);
  const canUndo = useTopologyStore((s) => s.past.length > 0);
  const canRedo = useTopologyStore((s) => s.future.length > 0);
  const setValidationIssues = useTopologyStore((s) => s.setValidationIssues);
  const issueCount = useTopologyStore((s) => s.validationIssues.length);
  const toTopology = useTopologyStore((s) => s.toTopology);
  const meta = useTopologyStore((s) => s.meta);
  const setMeta = useTopologyStore((s) => s.setMeta);

  const validate = useValidateTopology();
  const generate = useGenerateZip();
  const router = useRouter();
  const qc = useQueryClient();
  const build = useMutation<
    Awaited<ReturnType<typeof api.buildLab>>,
    ApiError,
    Parameters<typeof api.buildLab>[0]
  >({ mutationFn: (topology) => api.buildLabConfirmed(topology) });
  const save = useMutation<
    Awaited<ReturnType<typeof api.saveTopology>>,
    ApiError,
    Parameters<typeof api.saveTopology>[0]
  >({
    mutationFn: (topology) => api.saveTopology(topology),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["stored-topologies"] });
    },
  });

  const handleAddNode = (type: NodeType): void => {
    const position = screenToFlowPosition({
      x: window.innerWidth / 2,
      y: window.innerHeight / 2,
    });
    addNode(type, position);
  };

  const handleAddZone = (shape: ZoneShape): void => {
    const center = screenToFlowPosition({
      x: window.innerWidth / 2,
      y: window.innerHeight / 2,
    });
    addZone(shape, { x: center.x - 160, y: center.y - 110 });
  };

  const handleValidate = async (): Promise<void> => {
    const topology = toTopology();
    try {
      const result = await validate.mutateAsync(topology);
      setValidationIssues(result.issues);
      if (result.valid) {
        toast.success("Topology is valid", {
          description:
            result.issues.length > 0
              ? `${result.issues.length} warning(s) — see node badges`
              : "No issues found.",
        });
      } else {
        toast.error(`${result.issues.length} validation issue(s)`, {
          description: result.issues[0]?.message ?? "See nodes for details.",
        });
      }
    } catch (err) {
      const e = err as { detail?: string };
      toast.error("Validation failed", { description: e.detail });
    }
  };

  const handleExportJson = (): void => {
    const topology = toTopology();
    if (topology.nodes.length === 0) {
      toast.error("Canvas is empty", { description: "Add a node before exporting." });
      return;
    }
    downloadJson(topology, `${topology.name.toLowerCase().replace(/\s+/g, "-")}.json`);
    toast.success("Exported topology.json");
  };

  const handleAutoLayout = (): void => {
    const { nodes, edges } = useTopologyStore.getState();
    const realNodes = nodes
      .filter((n) => !isZone(n))
      .map((n) => ({ id: n.id, type: n.type }));
    if (realNodes.length === 0) {
      toast.error("Canvas is empty");
      return;
    }
    const layoutEdges = edges.map((e) => ({ source: e.source, target: e.target }));
    const positions = layoutTopology(realNodes, layoutEdges);
    setNodePositions(positions);
    toast.success("Auto-layout applied");
  };

  const handleGenerate = async (): Promise<void> => {
    const topology = toTopology();
    if (topology.nodes.length === 0) {
      toast.error("Canvas is empty", { description: "Add at least one node first." });
      return;
    }
    try {
      const blob = await generate.mutateAsync(topology);
      const filename = `labforge-${topology.name.toLowerCase().replace(/\s+/g, "-")}.zip`;
      downloadBlob(blob, filename);
      toast.success("Lab generated", { description: filename });
    } catch (err) {
      const e = err as { detail?: string };
      toast.error("Generation failed", { description: e.detail ?? "Check API logs." });
    }
  };

  const handleSave = async (): Promise<void> => {
    const topology = toTopology();
    if (topology.nodes.length === 0) {
      toast.error("Canvas is empty", { description: "Add a node before saving." });
      return;
    }
    try {
      const saved = await save.mutateAsync(topology);
      toast.success("Topology saved", {
        description: `${saved.name} is in your Saved topologies list.`,
      });
    } catch (err) {
      const e = err as ApiError;
      const description =
        e.code === "invalid_topology"
          ? "Topology has validation errors — fix them and try again."
          : e.detail ?? "Check API logs.";
      toast.error("Save failed", { description });
    }
  };

  const handleBuild = async (): Promise<void> => {
    const topology = toTopology();
    if (topology.nodes.length === 0) {
      toast.error("Canvas is empty", { description: "Add at least one node first." });
      return;
    }
    try {
      const result = await build.mutateAsync(topology);
      toast.success("Build started", {
        description:
          topology.provider === "docker"
            ? "Starting the containers. Follow progress in the monitor."
            : `vagrant up running in ${result.workspace_path}`,
      });
      router.push(`/monitor/${result.lab_id}`);
    } catch (err) {
      const e = err as ApiError;
      const description =
        e.code === "vagrant_missing"
          ? "Install Vagrant 2.4+ on the API host, then retry."
          : e.detail ?? "Check API logs.";
      toast.error("Build failed to start", { description });
    }
  };

  return (
    // z-40: above NodePalette (z-20), BuildPreflightBanner (z-30), and
    // every other canvas overlay — the Toolbar must always be reachable.
    <div className="absolute left-1/2 top-4 z-40 -translate-x-1/2">
      <div className="flex items-center gap-1 rounded-lg border bg-background/95 p-1.5 shadow-lg backdrop-blur">
        {/* Segment 1 — lab name + meta (CIDR + provider) */}
        <Input
          value={meta.name}
          onChange={(e) => setMeta({ name: e.target.value })}
          className="h-8 w-44 border-transparent bg-transparent text-sm font-medium focus-visible:border-input"
          aria-label="Lab name"
        />
        <TopologyMetaPopover />
        <Separator orientation="vertical" className="mx-1 h-6" />

        {/* Segment 2 — Add (nodes + zones) + Templates */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="h-8">
              <Plus className="mr-1 h-4 w-4" />
              Add
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-64">
            <DropdownMenuLabel>Node types</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {NODE_ENTRIES.map(({ type, label, Icon }) => (
              <DropdownMenuItem key={type} onSelect={() => handleAddNode(type)}>
                <Icon className="h-4 w-4" />
                {label}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Zone shapes</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {ZONE_ENTRIES.map(({ shape, label, Icon }) => (
              <DropdownMenuItem key={shape} onSelect={() => handleAddZone(shape)}>
                <Icon className="h-4 w-4" />
                {label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <Button asChild variant="ghost" size="sm" className="h-8">
          <Link href="/templates">
            <LayoutTemplate className="mr-1 h-4 w-4" />
            Templates
          </Link>
        </Button>

        <Separator orientation="vertical" className="mx-1 h-6" />

        {/* Segment 3 — layout / undo / redo */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={handleAutoLayout}
              aria-label="Auto-layout"
            >
              <LayoutGrid className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Auto-layout (LR)</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={undo}
              disabled={!canUndo}
              aria-label="Undo"
            >
              <Undo2 className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Undo</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={redo}
              disabled={!canRedo}
              aria-label="Redo"
            >
              <Redo2 className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Redo</TooltipContent>
        </Tooltip>

        <Separator orientation="vertical" className="mx-1 h-6" />

        {/* Segment 4 — Validate · Build (CTA) · overflow */}
        <Button
          variant="ghost"
          size="sm"
          className="h-8"
          onClick={handleValidate}
          disabled={validate.isPending}
        >
          <CheckCircle2 className="mr-1 h-4 w-4" />
          Validate
          {issueCount > 0 && (
            <span className="ml-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold leading-none text-destructive-foreground">
              {issueCount}
            </span>
          )}
        </Button>
        <Button
          variant="default"
          size="sm"
          className="h-8"
          onClick={handleBuild}
          disabled={build.isPending}
        >
          {build.isPending ? (
            <>
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              Starting…
            </>
          ) : (
            <>
              <Play className="mr-1 h-4 w-4" />
              Build Lab
            </>
          )}
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="More actions">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Export · Generate</TooltipContent>
            </Tooltip>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>Topology</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={handleSave} disabled={save.isPending}>
              {save.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              Save topology
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Export</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={handleGenerate}
              disabled={generate.isPending}
            >
              {generate.isPending ? (
                <Hammer className="h-4 w-4 animate-pulse" />
              ) : (
                <Download className="h-4 w-4" />
              )}
              Generate Lab (.zip)
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={handleExportJson}>
              <FileJson className="h-4 w-4" />
              Export topology JSON
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
