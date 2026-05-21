"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  CheckCircle2,
  Loader2,
  Octagon,
  RadioTower,
  Server,
  Terminal,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/ui/status-badge";
import { cn } from "@/lib/utils/cn";
import { api, type ApiError } from "@/lib/api/client";

interface Lab {
  id: number;
  name: string;
  topology_slug: string;
  provider: string;
  status: string;
  workspace_path?: string | null;
  updated_at: string;
}

interface BuildStatus {
  phase: "running" | "succeeded" | "failed" | "aborted" | "unknown";
  exit_code: number | null;
  finished_at: string | null;
  pid: number | null;
}

/* phase tone now resolved through <StatusBadge>'s shared vocabulary */

export default function BuildMonitorPage() {
  const params = useParams<{ id: string }>();
  const id = Number(params?.id);
  const enabled = Number.isFinite(id);

  const [lines, setLines] = React.useState<string[]>([]);
  const offsetRef = React.useRef(0);
  const [autoScroll, setAutoScroll] = React.useState(true);
  const scrollRef = React.useRef<HTMLPreElement | null>(null);

  const labQ = useQuery<Lab>({
    queryKey: ["lab", id],
    queryFn: () => fetch(`/api/v1/labs/${id}`).then((r) => r.json()),
    enabled,
    refetchInterval: 6000,
  });

  const statusQ = useQuery<BuildStatus>({
    queryKey: ["build-status", id],
    queryFn: () => api.buildStatus(id),
    enabled,
    refetchInterval: 3000,
  });

  // Stop polling logs once the build is over AND we've consumed the
  // whole file (next_offset == bytes_total).
  const phase = statusQ.data?.phase ?? "running";
  const isTerminal =
    phase === "succeeded" || phase === "failed" || phase === "aborted";

  const qc = useQueryClient();
  const stopMut = useMutation<BuildStatus, ApiError>({
    mutationFn: () => api.buildStop(id),
    onSuccess: (data) => {
      qc.setQueryData(["build-status", id], data);
      qc.invalidateQueries({ queryKey: ["lab", id] });
      qc.invalidateQueries({ queryKey: ["labs"] });
      toast.success("Build stopped", {
        description:
          data.phase === "aborted"
            ? "Vagrant subprocess signalled; workspace preserved."
            : `Phase: ${data.phase}`,
      });
    },
    onError: (err) => {
      toast.error("Could not stop build", { description: err.detail });
    },
  });

  const handleStop = (): void => {
    if (stopMut.isPending) return;
    const ok = window.confirm(
      "Stop this build?\n\nVagrant will be signalled (SIGTERM then SIGKILL). " +
        "The workspace and any VMs already created will be left in place — " +
        "you can re-run Build to retry or delete the lab to clean up.",
    );
    if (!ok) return;
    stopMut.mutate();
  };

  const logQ = useQuery({
    queryKey: ["build-log", id, offsetRef.current],
    queryFn: async () => {
      const res = await api.buildLog(id, offsetRef.current);
      if (res.lines.length > 0) {
        setLines((prev) => {
          // Cap at 5,000 lines so the DOM doesn't explode on long builds.
          const merged = [...prev, ...res.lines];
          return merged.length > 5000 ? merged.slice(-5000) : merged;
        });
      }
      offsetRef.current = res.next_offset;
      return res;
    },
    enabled,
    refetchInterval: isTerminal ? false : 1500,
  });

  // Always also do one final fetch right after the build flips to terminal,
  // in case the last log lines arrived between polls.
  React.useEffect(() => {
    if (isTerminal) {
      logQ.refetch();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isTerminal]);

  React.useEffect(() => {
    if (!autoScroll) return;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines, autoScroll]);

  if (!enabled) {
    return <div className="p-6 text-sm text-destructive">Invalid lab id.</div>;
  }

  const lab = labQ.data;

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b bg-card/60 px-3">
        <Button asChild variant="ghost" size="sm" className="h-8">
          <Link href="/monitor">
            <ArrowLeft className="mr-1 h-4 w-4" />
            Builds
          </Link>
        </Button>

        <Terminal className="h-4 w-4 text-muted-foreground" />
        {lab ? (
          <div className="flex min-w-0 items-center gap-2">
            <p className="truncate text-sm font-semibold">{lab.name}</p>
            <Badge variant="outline" className="text-[10px]">
              {lab.provider}
            </Badge>
          </div>
        ) : (
          <Skeleton className="h-4 w-32" />
        )}

        <div className="ml-auto flex items-center gap-2">
          <PhaseBadge phase={phase} />
          {phase === "running" && (
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              <RadioTower className="h-3 w-3 animate-pulse text-emerald-500" />
              streaming
            </span>
          )}
          <Button
            variant={autoScroll ? "secondary" : "outline"}
            size="sm"
            className="h-8"
            onClick={() => setAutoScroll((v) => !v)}
          >
            {autoScroll ? "Auto-scroll on" : "Auto-scroll off"}
          </Button>
          {phase === "running" && (
            <Button
              variant="destructive"
              size="sm"
              className="h-8"
              onClick={handleStop}
              disabled={stopMut.isPending}
              aria-label="Stop build"
            >
              {stopMut.isPending ? (
                <>
                  <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                  Stopping…
                </>
              ) : (
                <>
                  <Octagon className="mr-1 h-3.5 w-3.5" />
                  Stop
                </>
              )}
            </Button>
          )}
          {(phase === "succeeded" || lab?.status === "running") && lab && (
            <Button asChild variant="default" size="sm" className="h-8">
              <Link href={`/labs/${lab.id}`}>
                <Server className="mr-1 h-3.5 w-3.5" />
                Live lab
              </Link>
            </Button>
          )}
        </div>
      </header>

      <div className="grid grid-cols-12 gap-3 p-3" style={{ minHeight: 0, flex: 1 }}>
        <pre
          ref={scrollRef}
          className={cn(
            "col-span-9 m-0 min-h-0 overflow-y-auto rounded-lg border bg-zinc-950 p-3 font-mono text-[11px] leading-snug text-zinc-200 shadow-inner",
            "selection:bg-zinc-700/50",
          )}
        >
          {lines.length === 0 ? (
            <span className="text-zinc-500">
              {logQ.isLoading ? "Connecting…" : "Waiting for vagrant up to start…"}
            </span>
          ) : (
            lines.map((ln, idx) => (
              <div
                key={idx}
                className={cn(
                  ln.toLowerCase().includes("error") && "text-red-400",
                  /\bwarn(?:ing)?\b/i.test(ln) && "text-amber-300",
                  ln.startsWith("==>") && "text-cyan-300",
                  /==> .*: Running provisioner/.test(ln) &&
                    "font-semibold text-emerald-300",
                )}
              >
                {ln || " "}
              </div>
            ))
          )}
        </pre>

        <aside className="col-span-3 space-y-3">
          <SummaryCard label="Phase">
            <PhaseBadge phase={phase} />
          </SummaryCard>
          <SummaryCard label="Lab status">
            {lab ? <StatusBadge state={lab.status} /> : <span className="text-xs">—</span>}
          </SummaryCard>
          <SummaryCard label="PID">
            <code className="rounded bg-muted px-1.5 py-0.5 text-[11px]">
              {statusQ.data?.pid ?? "—"}
            </code>
          </SummaryCard>
          <SummaryCard label="Exit code">
            <code className="rounded bg-muted px-1.5 py-0.5 text-[11px]">
              {statusQ.data?.exit_code ?? "—"}
            </code>
          </SummaryCard>
          <SummaryCard label="Workspace">
            <code className="block break-all rounded bg-muted px-1.5 py-0.5 text-[10px]">
              {lab?.workspace_path ?? "—"}
            </code>
          </SummaryCard>
          <SummaryCard label="Lines">
            <span className="tabular-nums">{lines.length}</span>
          </SummaryCard>
          {phase === "failed" && (
            <p className="rounded-md border border-red-500/40 bg-red-500/10 p-2 text-[11px] text-red-700 dark:text-red-300">
              <XCircle className="mr-1 inline h-3 w-3" />
              Build failed. Inspect the tail of the log; common causes are missing Vagrant boxes
              or insufficient host RAM.
            </p>
          )}
          {phase === "aborted" && (
            <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-[11px] text-amber-700 dark:text-amber-300">
              <Octagon className="mr-1 inline h-3 w-3" />
              Build stopped by user. Any VMs already created remain — re-run Build to retry or
              delete the lab to clean up.
            </p>
          )}
          {phase === "succeeded" && (
            <p className="rounded-md border border-emerald-500/40 bg-emerald-500/10 p-2 text-[11px] text-emerald-700 dark:text-emerald-300">
              <CheckCircle2 className="mr-1 inline h-3 w-3" />
              Build succeeded. Switch to the live lab view for VM telemetry.
            </p>
          )}
        </aside>
      </div>
    </div>
  );
}

function PhaseBadge({ phase }: { phase: BuildStatus["phase"] }) {
  // The build phase reuses the lab-lifecycle vocabulary. "running" here is
  // semantically `building` — the build is still in flight, not the lab.
  const state = phase === "running" ? "building" : phase;
  return <StatusBadge state={state} />;
}

function SummaryCard({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-md border bg-card p-2.5">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <div className="mt-1 text-sm">{children}</div>
    </div>
  );
}
