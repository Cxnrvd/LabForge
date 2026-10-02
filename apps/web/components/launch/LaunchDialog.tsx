"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, AlertTriangle, XCircle, Loader2, Download, Play, Container, Boxes } from "lucide-react";
import { toast } from "sonner";
import type { Provider } from "@labforge/schema";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { api, type ApiError } from "@/lib/api/client";
import { formatSize, resolveRequirements, useImages, useRequiredImages, type Readiness } from "@/lib/api/images";
import { useLaunchStore } from "@/lib/store/launch-store";
import { useTopologyStore } from "@/lib/store/topology-store";
import { downloadBlob } from "@/lib/utils/download";
import { cn } from "@/lib/utils/cn";

type Tone = "ok" | "warn" | "err";

interface Check {
  label: string;
  detail?: string;
  tone: Tone;
}

const PROVIDERS: Array<{ id: Provider; name: string; hint: string; vm: boolean }> = [
  { id: "docker", name: "Docker", hint: "Containers, and Windows guests through KVM. Recommended.", vm: false },
  { id: "virtualbox", name: "VirtualBox", hint: "Full VMs through Vagrant. Slower alongside WSL2.", vm: true },
  { id: "vmware", name: "VMware Workstation", hint: "Full VMs through Vagrant and the VMware plugin.", vm: true },
];

function Icon({ tone }: { tone: Tone }): React.ReactElement {
  if (tone === "ok") return <CheckCircle2 className="h-4 w-4 text-emerald-500" aria-hidden />;
  if (tone === "warn") return <AlertTriangle className="h-4 w-4 text-amber-500" aria-hidden />;
  return <XCircle className="h-4 w-4 text-red-500" aria-hidden />;
}

const READY_STYLE: Record<Readiness, string> = {
  ready: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  missing: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  pulling: "bg-sky-500/15 text-sky-600 dark:text-sky-400",
  outdated: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  unknown: "bg-muted text-muted-foreground",
};

function totalRamForQuery(t: { nodes: Array<{ config: { memory_mb?: number } }> } | null): number {
  return (t?.nodes ?? []).reduce((a, n) => a + (n.config.memory_mb ?? 0), 0);
}

export function LaunchDialog(): React.ReactElement {
  const open = useLaunchStore((s) => s.open);
  const setOpen = useLaunchStore((s) => s.setOpen);
  const router = useRouter();
  const qc = useQueryClient();

  const meta = useTopologyStore((s) => s.meta);
  const setMeta = useTopologyStore((s) => s.setMeta);
  const nodes = useTopologyStore((s) => s.nodes);
  const updateNodeConfig = useTopologyStore((s) => s.updateNodeConfig);
  const toTopology = useTopologyStore((s) => s.toTopology);

  const provider = meta.provider as Provider;
  const topology = React.useMemo(() => (open ? toTopology() : null), [open, nodes, meta, toTopology]);

  const preflight = useQuery({
    queryKey: ["build-preflight", provider, "dialog"],
    queryFn: () => api.buildPreflight(provider),
    enabled: open,
    refetchInterval: open ? 10_000 : false,
  });
  const windowsCount = (topology?.nodes ?? []).filter((n) => String(n.config.os).startsWith("windows")).length;
  const dockerPreflight = useQuery({
    queryKey: ["host-preflight", windowsCount, totalRamForQuery(topology)],
    queryFn: () => api.preflight({ windowsGuests: windowsCount, memoryMb: totalRamForQuery(topology) || undefined }),
    enabled: open && provider === "docker",
    refetchInterval: open ? 10_000 : false,
  });
  const host = useQuery({
    queryKey: ["host-metrics"],
    queryFn: () => api.hostMetrics(),
    enabled: open,
    retry: 0,
  });
  const imagesQ = useImages();

  const totalRam = (topology?.nodes ?? []).reduce((a, n) => a + (n.config.memory_mb ?? 0), 0);
  const totalCpu = (topology?.nodes ?? []).reduce((a, n) => a + (n.config.cpus ?? 0), 0);
  const freeMb =
    host.data?.memory.total_mb != null && host.data.memory.used_mb != null
      ? host.data.memory.total_mb - host.data.memory.used_mb
      : null;

  const requiredQ = useRequiredImages(topology, provider);
  const imageRows = resolveRequirements(topology, provider, requiredQ.data, imagesQ.data?.images, imagesQ.data?.sample ?? true);
  const missing = imageRows.filter((x) => x.state === "missing");

  const checks: Check[] = [];
  const p = preflight.data;
  if (preflight.isLoading) {
    checks.push({ label: "Checking this computer", tone: "warn" });
  } else if (!p) {
    checks.push({ label: "The API did not answer", detail: "Is it running? Start it with pnpm dev.", tone: "err" });
  } else if (provider === "docker") {
    const rep = dockerPreflight.data;
    if (rep) {
      for (const c of rep.checks) {
        if (c.status === "ok") continue;
        checks.push({
          label: c.title,
          detail: [c.detail, c.fix ? `Fix: ${c.fix}` : null].filter(Boolean).join(" "),
          tone: c.status === "fail" ? "err" : "warn",
        });
      }
      if (rep.checks.every((c) => c.status === "ok")) checks.push({ label: "Docker, memory, disk and ports are fine", tone: "ok" });
    } else if (!p.docker_available) checks.push({ label: "Docker is not installed", detail: "Install Docker Desktop, then re-check.", tone: "err" });
    else if (!p.docker_daemon) checks.push({ label: "Docker is not running", detail: "Start Docker Desktop and wait for the whale icon to settle.", tone: "err" });
    else checks.push({ label: "Docker is running", detail: p.docker_version ?? undefined, tone: "ok" });
  } else {
    if (p.provider_problem) checks.push({ label: p.provider_problem.message, tone: "err" });
    else checks.push({ label: `${provider === "vmware" ? "VMware" : "VirtualBox"} is ready`, tone: "ok" });
    if (!p.vagrant_available) checks.push({ label: "Vagrant is not installed", detail: "VM providers need Vagrant 2.4 or newer.", tone: "err" });
    for (const w of p.provider_warnings ?? []) checks.push({ label: w, tone: "warn" });
  }
  if (provider !== "docker" && freeMb != null && totalRam > 0) {
    if (totalRam > freeMb) checks.push({ label: `Needs ${formatSize(totalRam)} of RAM, only ${formatSize(freeMb)} is free`, detail: "Close other apps or lower the machine sizes.", tone: "err" });
    else if (totalRam > freeMb * 0.8) checks.push({ label: `Needs ${formatSize(totalRam)} of RAM, ${formatSize(freeMb)} is free`, detail: "Tight. The host may feel slow.", tone: "warn" });
    else checks.push({ label: `RAM fits: ${formatSize(totalRam)} of ${formatSize(freeMb)} free`, tone: "ok" });
  }
  if (host.data?.disk.free_gb != null && host.data.disk.free_gb < 40 && missing.length > 0) {
    checks.push({ label: `Only ${host.data.disk.free_gb.toFixed(0)} GB of disk is free`, detail: "Downloads may not fit.", tone: "warn" });
  }

  const blocked = checks.some((c) => c.tone === "err") || !topology || topology.nodes.length === 0;

  const start = useMutation<Awaited<ReturnType<typeof api.buildLab>>, ApiError>({
    mutationFn: () => api.buildLabConfirmed(toTopology()),
    onSuccess: (result) => {
      void qc.invalidateQueries({ queryKey: ["labs"] });
      setOpen(false);
      toast.success("Lab is starting", { description: "Opening the live view." });
      router.push(`/monitor/${result.lab_id}`);
    },
    onError: (err) => toast.error("The lab did not start", { description: err.detail ?? "Check the API log." }),
  });

  const exportZip = useMutation<Blob, ApiError>({
    mutationFn: () =>
      api.generateZip(toTopology(), { target: provider === "docker" ? "docker-compose" : "vagrant" }),
    onSuccess: (blob) => {
      const name = `labforge-${(meta.name || "lab").toLowerCase().replace(/\s+/g, "-")}.zip`;
      downloadBlob(blob, name);
      toast.success("Package downloaded", { description: name });
    },
    onError: (err) => toast.error("Export failed", { description: err.detail ?? "Check the API log." }),
  });

  const setNum = (id: string, key: "memory_mb" | "cpus", value: number, min: number, max: number): void => {
    const v = Math.min(max, Math.max(min, Math.round(value)));
    updateNodeConfig(id, (n) => ({ ...n, config: { ...n.config, [key]: v } }));
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-h-[88vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Launch {meta.name || "lab"}</DialogTitle>
          <DialogDescription>
            Pick where it runs, check the machines, and start. No zip files needed.
          </DialogDescription>
        </DialogHeader>

        <section aria-label="Provider" className="grid gap-2 sm:grid-cols-3">
          {PROVIDERS.map((p) => {
            const active = provider === p.id;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => setMeta({ provider: p.id })}
                aria-pressed={active}
                className={cn(
                  "rounded-xl border p-3 text-left transition-colors",
                  active ? "border-foreground bg-muted" : "border-border hover:bg-muted/60",
                )}
              >
                <div className="flex items-center gap-2 text-sm font-semibold">
                  {p.vm ? <Boxes className="h-4 w-4" aria-hidden /> : <Container className="h-4 w-4" aria-hidden />}
                  {p.name}
                  {p.id === "docker" && (
                    <span className="ml-auto rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
                      Recommended
                    </span>
                  )}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">{p.hint}</div>
              </button>
            );
          })}
        </section>

        <section aria-label="Machines">
          <div className="mb-2 flex items-baseline justify-between">
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Machines</h3>
            <span className="text-xs text-muted-foreground">
              {topology?.nodes.length ?? 0} machines · {formatSize(totalRam)} RAM · {totalCpu} CPU
            </span>
          </div>
          <div className="overflow-hidden rounded-xl border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted/60 text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">Name</th>
                  <th className="px-3 py-2 font-medium">System</th>
                  <th className="px-3 py-2 font-medium">RAM (MB)</th>
                  <th className="px-3 py-2 font-medium">CPU</th>
                </tr>
              </thead>
              <tbody>
                {(topology?.nodes ?? []).map((n) => (
                  <tr key={n.id} className="border-t border-border">
                    <td className="px-3 py-2 font-medium">{n.config.hostname}</td>
                    <td className="px-3 py-2 text-muted-foreground">{String(n.config.os).replace(/_/g, " ")}</td>
                    <td className="px-3 py-2">
                      <input
                        type="number"
                        min={256}
                        step={256}
                        value={n.config.memory_mb}
                        onChange={(e) => setNum(n.id, "memory_mb", Number(e.target.value), 256, 65536)}
                        className="h-8 w-24 rounded-md border border-input bg-background px-2 text-sm"
                        aria-label={`${n.config.hostname} RAM in MB`}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="number"
                        min={1}
                        max={32}
                        value={n.config.cpus}
                        onChange={(e) => setNum(n.id, "cpus", Number(e.target.value), 1, 32)}
                        className="h-8 w-16 rounded-md border border-input bg-background px-2 text-sm"
                        aria-label={`${n.config.hostname} CPUs`}
                      />
                    </td>
                  </tr>
                ))}
                {(topology?.nodes.length ?? 0) === 0 && (
                  <tr><td colSpan={4} className="px-3 py-4 text-center text-muted-foreground">The canvas is empty. Add a machine or load a template first.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section aria-label="Images">
          <div className="mb-2 flex items-baseline justify-between">
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Images</h3>
            <a href="/images" className="text-xs text-muted-foreground underline underline-offset-2">Open image library</a>
          </div>
          <ul className="grid gap-1.5">
            {imageRows.map(({ r, state }) => (
              <li key={r.key} className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm">
                <span className="font-medium">{r.label}</span>
                <span className="truncate text-xs text-muted-foreground">{r.nodes.join(", ")}</span>
                <span className={cn("ml-auto rounded-full px-2 py-0.5 text-[11px] font-semibold", READY_STYLE[state])}>
                  {state === "unknown" ? "not checked" : state}
                </span>
              </li>
            ))}
          </ul>
          {missing.length > 0 && (
            <p className="mt-2 text-xs text-muted-foreground">
              {missing.length} image{missing.length === 1 ? "" : "s"} will download first. Prepare them ahead of time in the image library to start faster.
            </p>
          )}
        </section>

        <section aria-label="Checks">
          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Before you start</h3>
          <ul className="grid gap-1.5">
            {checks.map((c, i) => (
              <li key={i} className="flex items-start gap-2 text-sm">
                <span className="mt-0.5"><Icon tone={c.tone} /></span>
                <span>
                  {c.label}
                  {c.detail && <span className="block text-xs text-muted-foreground">{c.detail}</span>}
                </span>
              </li>
            ))}
          </ul>
        </section>

        <DialogFooter className="gap-2 sm:justify-between">
          <Button variant="ghost" size="sm" onClick={() => exportZip.mutate()} disabled={exportZip.isPending || blocked && !topology?.nodes.length}>
            {exportZip.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Download className="mr-1 h-4 w-4" />}
            Export package
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setOpen(false)}>Cancel</Button>
            <Button size="sm" onClick={() => start.mutate()} disabled={blocked || start.isPending}>
              {start.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Play className="mr-1 h-4 w-4" />}
              {start.isPending ? "Starting" : "Start lab"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
