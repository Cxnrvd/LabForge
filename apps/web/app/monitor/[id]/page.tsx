"use client";

import * as React from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import type { LabConfig } from "@labforge/schema";
import { cn } from "@/lib/utils/cn";
import { api, type ApiError, type BuildPhasesPayload, type BuildStatusPayload } from "@/lib/api/client";
import { useLiveBus, type LiveBusEvent } from "@/lib/api/live-bus";
import { LiveTopologyView } from "@/components/monitor/LiveTopologyView";
import { TimeScrubber, type ScrubberSample } from "@/components/monitor/TimeScrubber";

interface Lab {
  id: number;
  name: string;
  topology_slug: string;
  provider: string;
  status: string;
  workspace_path?: string | null;
  updated_at: string;
}

interface HeartbeatVm {
  hostname: string;
  state: string;
  ip?: string | null;
  os?: string | null;
  type?: string | null;
  roles?: string[];
}

interface HeartbeatPayload {
  lab_status?: string;
  vms?: HeartbeatVm[];
  log_tail?: string[];
  captured_at?: string | null;
}

interface FeedRow {
  id: string;
  t: string;
  src: string;
  level: "" | "op" | "warn" | "err";
  message: string;
}

type ViewTab = "live" | "topology" | "events" | "timeline" | "network" | "logs";

const TABS: { id: ViewTab; label: string }[] = [
  { id: "live", label: "Live" },
  { id: "topology", label: "Topology" },
  { id: "events", label: "Events" },
  { id: "timeline", label: "Timeline" },
  { id: "network", label: "Network" },
  { id: "logs", label: "Logs" },
];

function parseLogLevel(line: string): { level: FeedRow["level"]; src: string } {
  const lower = line.toLowerCase();
  if (/\b(error|fail|critical|alert)\b/.test(lower)) return { level: "err", src: "log" };
  if (/\bwarn(ing)?\b/.test(lower)) return { level: "warn", src: "log" };
  if (/==> .*: Running provisioner/.test(line)) return { level: "op", src: "prov" };
  if (line.startsWith("==>")) return { level: "op", src: "vagrant" };
  return { level: "", src: "log" };
}

function shortTime(iso?: string | null): string {
  if (!iso) {
    const d = new Date();
    return d.toTimeString().slice(0, 8);
  }
  try {
    return new Date(iso).toTimeString().slice(0, 8);
  } catch {
    return iso.slice(11, 19);
  }
}

function parseViewParam(raw: string | null): ViewTab {
  switch (raw) {
    case "live":
    case "topology":
    case "events":
    case "timeline":
    case "network":
    case "logs":
      return raw;
    default:
      return "live";
  }
}

export default function BuildMonitorPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const id = Number(params?.id);
  const enabled = Number.isFinite(id);

  const [lines, setLines] = React.useState<string[]>([]);
  const offsetRef = React.useRef(0);
  const [autoScroll, setAutoScroll] = React.useState(true);
  const scrollRef = React.useRef<HTMLPreElement | null>(null);

  // Tab state, persisted in ?view= so refresh keeps the selection.
  const initialView = React.useMemo(
    () => parseViewParam(searchParams?.get("view") ?? null),
    // run once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const [view, setView] = React.useState<ViewTab>(initialView);
  const setViewPersist = React.useCallback(
    (next: ViewTab) => {
      setView(next);
      try {
        const sp = new URLSearchParams(window.location.search);
        if (next === "live") sp.delete("view");
        else sp.set("view", next);
        const qs = sp.toString();
        router.replace(qs ? `?${qs}` : "?", { scroll: false });
      } catch {
        // best-effort URL sync; non-fatal.
      }
    },
    [router],
  );

  // SSH modal + Events filter local state.
  const [sshOpen, setSshOpen] = React.useState(false);
  const [eventsFilter, setEventsFilter] = React.useState<"" | "op" | "warn" | "err">("");

  // Heartbeat-derived feed (live event log) — populated from WS.
  const [feed, setFeed] = React.useState<FeedRow[]>([]);
  const [latestHb, setLatestHb] = React.useState<HeartbeatPayload | null>(null);

  // Rolling heartbeat history for the Timeline scrubber. Capped to 120
  // samples (~10 min at default 5s heartbeat cadence) to bound memory.
  const HISTORY_CAP = 120;
  const [hbSamples, setHbSamples] = React.useState<
    ScrubberSample<HeartbeatPayload>[]
  >([]);
  const [scrubbedSample, setScrubbedSample] = React.useState<
    ScrubberSample<HeartbeatPayload> | null
  >(null);

  // Tail-of-build-log polling for the Logs tab embed (every 2s).
  const logsTabActive = view === "logs";
  const tailQ = useQuery<string[]>({
    queryKey: ["lab-log-tail", id],
    queryFn: () => api.getLabLog(id, 400),
    enabled: enabled && logsTabActive,
    refetchInterval: logsTabActive ? 2000 : false,
  });

  const labQ = useQuery<Lab>({
    queryKey: ["lab", id],
    queryFn: () => fetch(`/api/v1/labs/${id}`).then((r) => r.json()),
    enabled,
    refetchInterval: 6000,
  });

  // Topology is needed by the SSH / Network tabs and by the Live
  // topology view (which fetches it independently — both queries share
  // the cache via the same key).
  const topologyQ = useQuery<LabConfig>({
    queryKey: ["lab-topology", id],
    queryFn: () => api.getLabTopology(id),
    enabled,
    staleTime: Infinity,
  });

  const statusQ = useQuery<BuildStatusPayload>({
    queryKey: ["build-status", id],
    queryFn: () => api.buildStatus(id),
    enabled,
    refetchInterval: 3000,
  });

  const phasesQ = useQuery<BuildPhasesPayload>({
    queryKey: ["build-phases", id],
    queryFn: () => api.buildPhases(id),
    enabled,
    refetchInterval: 4000,
  });

  const phase = statusQ.data?.phase ?? "running";
  const isTerminal = phase === "succeeded" || phase === "failed" || phase === "aborted";

  // ----- live bus: build the rolling event feed
  const onLiveEvent = React.useCallback((ev: LiveBusEvent) => {
    if (ev.type !== "heartbeat" || !ev.data) return;
    const hb = ev.data as HeartbeatPayload;
    setLatestHb(hb);
    const capturedAt = hb.captured_at ?? new Date().toISOString();
    setHbSamples((prev) => {
      const last = prev[prev.length - 1];
      if (last && last.capturedAt === capturedAt) return prev;
      const next = [...prev, { capturedAt, data: hb }];
      return next.length > HISTORY_CAP ? next.slice(-HISTORY_CAP) : next;
    });
    if (!hb.log_tail || hb.log_tail.length === 0) return;
    const at = hb.captured_at ?? new Date().toISOString();
    const stamp = shortTime(at);
    setFeed((prev) => {
      const rows: FeedRow[] = hb.log_tail!.map((ln, i) => {
        const { level, src } = parseLogLevel(ln);
        return {
          id: `${at}-${i}-${ln.slice(0, 24)}`,
          t: stamp,
          src,
          level,
          message: ln,
        };
      });
      const merged = [...rows.reverse(), ...prev];
      // de-dupe by id, cap 30
      const seen = new Set<string>();
      const out: FeedRow[] = [];
      for (const r of merged) {
        if (seen.has(r.id)) continue;
        seen.add(r.id);
        out.push(r);
        if (out.length >= 30) break;
      }
      return out;
    });
  }, []);

  const { status: wsStatus } = useLiveBus(enabled ? id : null, { onEvent: onLiveEvent });

  const qc = useQueryClient();
  const stopMut = useMutation<BuildStatusPayload, ApiError>({
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

  // ----- Stop / Start: Docker labs stop their containers and keep the data,
  // then start again from the same workspace. Other providers keep the old
  // behaviour (signal the build process).
  const haltMut = useMutation<unknown, ApiError>({
    mutationFn: () => api.haltLab(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["lab", id] });
      qc.invalidateQueries({ queryKey: ["labs"] });
      toast.success("Lab stopped", { description: "Containers are stopped. Data is kept; press Start to run it again." });
    },
    onError: (err) => {
      toast.error("Could not stop the lab", { description: err.detail });
    },
  });
  const resumeMut = useMutation<unknown, ApiError>({
    mutationFn: () => api.resumeLab(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["lab", id] });
      qc.invalidateQueries({ queryKey: ["labs"] });
      qc.invalidateQueries({ queryKey: ["build-status", id] });
      toast.success("Starting the lab", { description: "Containers are coming back up." });
    },
    onError: (err) => {
      toast.error("Could not start the lab", { description: err.detail });
    },
  });

  const handleHalt = (): void => {
    if (haltMut.isPending || stopMut.isPending) return;
    const isDocker = labQ.data?.provider === "docker";
    const ok = window.confirm(
      isDocker
        ? "Stop this lab?\n\nThe containers are stopped. Your data and the workspace are kept, " +
            "and you can start it again later."
        : "Halt this lab?\n\nThe vagrant subprocess will be signalled. " +
            "Running VMs and the workspace will be left intact so you can " +
            "resume or destroy later.",
    );
    if (!ok) return;
    if (isDocker) haltMut.mutate();
    else stopMut.mutate();
  };

  // ----- Destroy action: DELETE /labs/{id} (the only backend route
  // that tears a lab down). On success we navigate to /labs.
  const destroyMut = useMutation<void, ApiError>({
    mutationFn: () => api.destroyLab(id),
    onSuccess: () => {
      toast.success("Lab destroyed");
      qc.invalidateQueries({ queryKey: ["labs"] });
      router.push("/labs");
    },
    onError: (err) => {
      toast.error("Could not destroy lab", { description: err.detail });
    },
  });

  const handleDestroy = (): void => {
    if (destroyMut.isPending) return;
    const ok = window.confirm(
      "Destroy this lab?\n\nAll VMs/containers, their data and the workspace " +
        "directory will be removed. This cannot be undone.",
    );
    if (!ok) return;
    destroyMut.mutate();
  };

  // ----- Reload: invalidate lab + topology + heartbeat queries.
  const handleReload = (): void => {
    qc.invalidateQueries({ queryKey: ["lab", id] });
    qc.invalidateQueries({ queryKey: ["lab-topology", id] });
    qc.invalidateQueries({ queryKey: ["build-status", id] });
    qc.invalidateQueries({ queryKey: ["build-phases", id] });
    qc.invalidateQueries({ queryKey: ["lab-log-tail", id] });
    toast.success("Reloaded");
  };

  const logQ = useQuery({
    queryKey: ["build-log", id, offsetRef.current],
    queryFn: async () => {
      const res = await api.buildLog(id, offsetRef.current);
      if (res.lines.length > 0) {
        setLines((prev) => {
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
    return (
      <main className="page">
        <div className="banner err">Invalid lab id.</div>
      </main>
    );
  }

  const lab = labQ.data;
  const vms = latestHb?.vms ?? [];
  const runningVms = vms.filter((v) => v.state === "running").length;
  const totalVms = vms.length;
  const overall = phasesQ.data?.overall ?? "unknown";
  const buildFailed = phase === "failed";
  const wsHealthy = wsStatus === "open";

  return (
    <main className="page">
      {/* ---- top strip: title + status badges + actions ---- */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          paddingBottom: 14,
          marginBottom: 18,
          borderBottom: "1px solid var(--line)",
          flexWrap: "wrap",
        }}
      >
        <Link href="/monitor" className="mono" style={{ color: "var(--ink-mute)" }}>
          labs
        </Link>
        <span className="mono" style={{ color: "var(--ink-faint)" }}>/</span>
        <b style={{ fontWeight: 500 }}>{lab?.name ?? `lab #${id}`}</b>
        {lab?.provider && <span className="badge mono">{lab.provider}</span>}
        <span className={cn("badge", wsHealthy ? "live" : "warn")}>
          <span className="d" />
          {wsHealthy ? "Live · WebSocket" : `WS · ${wsStatus}`}
        </span>
        <span className="badge mono">lab #{id}</span>

        <div style={{ flex: 1 }} />

        <button
          className="btn sm"
          type="button"
          onClick={() => setSshOpen(true)}
          aria-label="Show SSH commands"
        >
          SSH
        </button>
        <button
          className="btn"
          type="button"
          onClick={handleReload}
          aria-label="Reload lab data"
        >
          Reload
        </button>
        {lab?.status === "stopped" ? (
          <button
            className="btn primary"
            type="button"
            onClick={() => resumeMut.mutate()}
            disabled={resumeMut.isPending}
            aria-label="Start lab"
          >
            {resumeMut.isPending ? "Starting�" : "Start"}
          </button>
        ) : (
          <button
            className="btn"
            type="button"
            onClick={phase === "running" ? handleStop : handleHalt}
            disabled={stopMut.isPending || haltMut.isPending}
            aria-label={phase === "running" ? "Cancel build" : "Stop lab"}
          >
            {phase === "running"
              ? stopMut.isPending ? "Cancelling�" : "Cancel build"
              : haltMut.isPending || stopMut.isPending ? "Stopping�" : "Stop"}
          </button>
        )}
        <button
          className="btn danger"
          type="button"
          onClick={handleDestroy}
          disabled={destroyMut.isPending}
          aria-label="Destroy lab"
        >
          {destroyMut.isPending ? "Destroying…" : "Destroy"}
        </button>
      </div>

      {sshOpen && (
        <SshModal
          vms={vms}
          topologyHostnames={
            topologyQ.data?.nodes.map((n) => n.config.hostname) ?? []
          }
          onClose={() => setSshOpen(false)}
        />
      )}

      {buildFailed && (
        <div className="banner err" style={{ marginBottom: 18 }}>
          <span>
            <b>Build failed.</b> Inspect the log tail — common causes are missing Vagrant boxes
            or insufficient host RAM.
          </span>
        </div>
      )}
      {!wsHealthy && wsStatus === "error" && (
        <div className="banner warn" style={{ marginBottom: 18 }}>
          <span>
            <b>No heartbeats.</b> WebSocket disconnected; polling fallback in effect.
          </span>
        </div>
      )}

      {/* ---- pagehead: title + meta + tab row ---- */}
      <div className="pagehead">
        <div className="grow">
          <h1 className="h1">{lab?.name ?? `lab #${id}`}</h1>
          <div className="meta mono">
            {latestHb?.captured_at ? `last heartbeat ${shortTime(latestHb.captured_at)} · ` : ""}
            {runningVms}/{totalVms || "?"} healthy
            {lab?.provider ? ` · ${lab.provider}` : ""}
            {lab?.topology_slug ? ` · ${lab.topology_slug}` : ""}
          </div>
        </div>
        <div style={{ display: "flex", gap: 4 }}>
          {TABS.map((t) => {
            const active = view === t.id;
            return (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setViewPersist(t.id)}
                className={cn("btn sm", active && "act primary")}
              >
                {t.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* ---- KPI strip (Live view only) ---- */}
      {view === "live" && (
        <div className="stats" style={{ marginBottom: 18 }}>
          <div className="stat">
            <div className="l">Hosts up</div>
            <div className="v">
              {runningVms}
              <span style={{ color: "var(--ink-faint)", fontSize: 18 }}>/{totalVms || 0}</span>
            </div>
            <div className="d">
              <span className="mono" style={{ color: "var(--ink-mute)" }}>
                {latestHb?.captured_at ? shortTime(latestHb.captured_at) : "—"}
              </span>
            </div>
          </div>
          <div className="stat">
            <div className="l">Alerts</div>
            <div className="v">0</div>
            <div className="d">
              <span className="mono" style={{ color: "var(--ink-mute)" }}>none</span>
            </div>
          </div>
          <div className="stat">
            <div className="l">Warnings</div>
            <div className="v">0</div>
            <div className="d">
              <span className="mono" style={{ color: "var(--ink-mute)" }}>none</span>
            </div>
          </div>
          <div className="stat">
            <div className="l">Build phase</div>
            <div className="v" style={{ fontSize: 22 }}>
              {overall}
            </div>
            <div className="d">
              <span className="mono" style={{ color: "var(--ink-mute)" }}>{phase}</span>
            </div>
          </div>
        </div>
      )}

      {/* ---- main content row (per tab) ---- */}
      {view === "live" && (
        <>
          <div className="grid12">
            <div className="card s8">
              <div className="card-h">
                <h3>Live topology</h3>
                <div className="sub mono">
                  {latestHb?.captured_at ? `last ${shortTime(latestHb.captured_at)}` : "awaiting heartbeat"}
                </div>
                <div className="grow" />
                <span className={cn("badge", wsHealthy ? "live" : "warn")}>
                  <span className="d" />
                  {wsStatus}
                </span>
              </div>
              <div style={{ height: 540, position: "relative" }}>
                <LiveTopologyView labId={id} />
              </div>
            </div>

            <div className="card s4">
              <div className="card-h">
                <h3>Event log</h3>
                <div className="sub mono">heartbeat tail · {feed.length} rows</div>
                <div className="grow" />
                <span className={cn("badge", wsHealthy ? "live" : "warn")}>
                  <span className="d" />
                  {wsHealthy ? "live" : "idle"}
                </span>
              </div>
              <div className="feed" style={{ maxHeight: 540 }}>
                {feed.length === 0 ? (
                  <div className="ev">
                    <span className="t">—</span>
                    <span className="src">waiting</span>
                    <span className="m" style={{ color: "var(--ink-mute)" }}>
                      No heartbeats received yet.
                    </span>
                  </div>
                ) : (
                  feed.map((row) => (
                    <div key={row.id} className="ev">
                      <span className="t">{row.t}</span>
                      <span className={cn("src", row.level && row.level)}>{row.src}</span>
                      <span className="m">{row.message}</span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          <div className="card s12" style={{ marginTop: 18 }}>
            <div className="card-h">
              <h3>VMs · {totalVms}</h3>
              <div className="sub">click to SSH / RDP</div>
              <div className="grow" />
              <button className="btn sm" type="button" disabled>
                Compact
              </button>
            </div>
            {vms.length === 0 ? (
              <div className="card-b" style={{ color: "var(--ink-mute)", fontSize: 13 }}>
                No VMs reported yet. They will appear here once the agent sends a heartbeat.
              </div>
            ) : (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(3, 1fr)",
                  gap: 1,
                  background: "var(--line)",
                }}
              >
                {vms.map((vm) => (
                  <VmCard key={vm.hostname} vm={vm} />
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {view === "topology" && (
        <div className="card s12">
          <div className="card-h">
            <h3>Topology</h3>
            <div className="sub mono">
              {latestHb?.captured_at ? `last ${shortTime(latestHb.captured_at)}` : "awaiting heartbeat"}
            </div>
            <div className="grow" />
            <span className={cn("badge", wsHealthy ? "live" : "warn")}>
              <span className="d" />
              {wsStatus}
            </span>
          </div>
          <div style={{ height: 720, position: "relative" }}>
            <LiveTopologyView labId={id} />
          </div>
        </div>
      )}

      {view === "events" && (
        <div className="card s12">
          <div className="card-h">
            <h3>Events</h3>
            <div className="sub mono">{feed.length} rows · heartbeat-derived</div>
            <div className="grow" />
            <div style={{ display: "flex", gap: 4 }}>
              {(["", "op", "warn", "err"] as const).map((lv) => (
                <button
                  key={lv || "all"}
                  type="button"
                  className={cn("btn sm", eventsFilter === lv && "act primary")}
                  onClick={() => setEventsFilter(lv)}
                >
                  {lv === "" ? "all" : lv}
                </button>
              ))}
            </div>
          </div>
          <div className="feed" style={{ maxHeight: 720 }}>
            {feed.filter((r) => !eventsFilter || r.level === eventsFilter).length === 0 ? (
              <div className="ev">
                <span className="t">—</span>
                <span className="src">empty</span>
                <span className="m" style={{ color: "var(--ink-mute)" }}>
                  No events match the current filter.
                </span>
              </div>
            ) : (
              feed
                .filter((r) => !eventsFilter || r.level === eventsFilter)
                .map((row) => (
                  <div key={row.id} className="ev">
                    <span className="t">{row.t}</span>
                    <span className={cn("src", row.level && row.level)}>{row.src}</span>
                    <span className="m">{row.message}</span>
                  </div>
                ))
            )}
          </div>
        </div>
      )}

      {view === "timeline" && (
        <div className="card s12">
          <div className="card-h">
            <h3>Timeline</h3>
            <div className="sub mono">{hbSamples.length} samples</div>
            <div className="grow" />
          </div>
          <div style={{ padding: 16 }}>
            {hbSamples.length === 0 ? (
              <div style={{ color: "var(--ink-mute)", fontSize: 13 }}>
                No recorded samples yet. Heartbeats will start populating
                once the lab agent reports in.
              </div>
            ) : (
              <>
                <TimeScrubber
                  samples={hbSamples}
                  onSelect={setScrubbedSample}
                />
                <div style={{ marginTop: 18 }}>
                  <div
                    className="mono"
                    style={{ fontSize: 12, color: "var(--ink-mute)", marginBottom: 8 }}
                  >
                    Snapshot {scrubbedSample
                      ? new Date(scrubbedSample.capturedAt).toLocaleString()
                      : "—"}
                  </div>
                  {(() => {
                    const snap = scrubbedSample?.data ?? hbSamples[hbSamples.length - 1]?.data;
                    const snapVms = snap?.vms ?? [];
                    if (snapVms.length === 0) {
                      return (
                        <div style={{ color: "var(--ink-mute)", fontSize: 13 }}>
                          No VMs in this sample.
                        </div>
                      );
                    }
                    return (
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "repeat(3, 1fr)",
                          gap: 1,
                          background: "var(--line)",
                        }}
                      >
                        {snapVms.map((vm) => (
                          <VmCard key={vm.hostname} vm={vm} />
                        ))}
                      </div>
                    );
                  })()}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {view === "network" && (
        <NetworkView topology={topologyQ.data} vms={vms} />
      )}

      {view === "logs" && (
        <div className="grid12">
          <div className="card s8">
            <div className="card-h">
              <h3>Build log</h3>
              <div className="sub mono">{lines.length} lines</div>
              <div className="grow" />
              <button
                className="btn sm"
                type="button"
                onClick={() => setAutoScroll((v) => !v)}
              >
                {autoScroll ? "Auto-scroll on" : "Auto-scroll off"}
              </button>
            </div>
            <pre
              ref={scrollRef}
              className="mono"
              style={{
                margin: 0,
                padding: 14,
                fontSize: 11.5,
                lineHeight: 1.5,
                maxHeight: 540,
                minHeight: 380,
                overflowY: "auto",
                background: "var(--bg-1)",
                color: "var(--ink-dim)",
              }}
            >
              {lines.length === 0 ? (
                <span style={{ color: "var(--ink-faint)" }}>
                  {logQ.isLoading ? "Connecting…" : "Waiting for vagrant up to start…"}
                </span>
              ) : (
                lines.map((ln, idx) => {
                  const lower = ln.toLowerCase();
                  let color: string | undefined;
                  if (lower.includes("error")) color = "var(--red)";
                  else if (/\bwarn(?:ing)?\b/i.test(ln)) color = "var(--amber)";
                  else if (/==> .*: Running provisioner/.test(ln)) color = "var(--green)";
                  else if (ln.startsWith("==>")) color = "var(--blue)";
                  return (
                    <div key={idx} style={{ color }}>
                      {ln || " "}
                    </div>
                  );
                })
              )}
            </pre>
          </div>
          <SidePanel
            lab={lab}
            status={statusQ.data}
            phase={phase}
            lines={lines.length}
          />
          <div className="card s12" style={{ marginTop: 18 }}>
            <div className="card-h">
              <h3>Lab log tail</h3>
              <div className="sub mono">polls every 2s · {tailQ.data?.length ?? 0} lines</div>
            </div>
            <pre
              className="mono"
              style={{
                margin: 0,
                padding: 14,
                fontSize: 11.5,
                lineHeight: 1.5,
                maxHeight: 320,
                overflowY: "auto",
                background: "var(--bg-1)",
                color: "var(--ink-dim)",
              }}
            >
              {tailQ.isLoading
                ? "Loading…"
                : !tailQ.data || tailQ.data.length === 0
                  ? "No log lines yet."
                  : tailQ.data.join("\n")}
            </pre>
          </div>
        </div>
      )}
    </main>
  );
}

function VmCard({ vm }: { vm: HeartbeatVm }) {
  const up = vm.state === "running";
  return (
    <div style={{ background: "var(--bg)", padding: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: up ? "var(--green)" : "var(--ink-faint)",
            boxShadow: up ? "0 0 8px rgba(10,124,74,0.6)" : undefined,
          }}
        />
        <div style={{ fontWeight: 600, fontSize: 14 }}>{vm.hostname}</div>
        <div style={{ flex: 1 }} />
        <span className={cn("badge", up ? "live" : "warn")}>
          <span className="d" />
          {vm.state}
        </span>
      </div>
      <div className="meta-line">
        {vm.ip ?? "no-ip"}
        {vm.os ? ` · ${vm.os}` : ""}
        {vm.type ? ` · ${vm.type}` : ""}
      </div>
      {vm.roles && vm.roles.length > 0 && (
        <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
          {vm.roles.slice(0, 4).map((r) => (
            <span key={r} className="tag">
              {r}
            </span>
          ))}
        </div>
      )}
      <div style={{ display: "flex", gap: 4, marginTop: 10 }}>
        <button className="btn sm" type="button" disabled style={{ flex: 1, justifyContent: "center" }}>
          SSH
        </button>
        <button className="btn sm" type="button" disabled style={{ flex: 1, justifyContent: "center" }}>
          Web
        </button>
        <button className="btn sm" type="button" disabled style={{ flex: 1, justifyContent: "center" }}>
          Logs
        </button>
      </div>
    </div>
  );
}

function SidePanel({
  lab,
  status,
  phase,
  lines,
}: {
  lab: Lab | undefined;
  status: BuildStatusPayload | undefined;
  phase: BuildStatusPayload["phase"];
  lines: number;
}) {
  return (
    <div className="card s4">
      <div className="card-h">
        <h3>Build</h3>
        <div className="sub mono">{phase}</div>
      </div>
      <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <SidePanelRow label="Lab status" value={lab?.status ?? "—"} />
        <SidePanelRow label="PID" value={status?.pid != null ? String(status.pid) : "—"} mono />
        <SidePanelRow
          label="Exit code"
          value={status?.exit_code != null ? String(status.exit_code) : "—"}
          mono
        />
        <SidePanelRow label="Workspace" value={lab?.workspace_path ?? "—"} mono small />
        <SidePanelRow label="Lines" value={String(lines)} mono />
        {phase === "failed" && (
          <div className="banner err">
            <span>Build failed. Inspect the log tail.</span>
          </div>
        )}
        {phase === "aborted" && (
          <div className="banner warn">
            <span>Build stopped. Re-run Build to retry, or delete the lab to clean up.</span>
          </div>
        )}
        {phase === "succeeded" && lab && (
          <div className="banner" style={{ borderColor: "rgba(10,124,74,0.25)", background: "rgba(10,124,74,0.05)" }}>
            <span>
              Build succeeded.{" "}
              <Link href={`/labs/${lab.id}`} style={{ color: "var(--green)", fontWeight: 500 }}>
                Open live lab →
              </Link>
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

function SshModal({
  vms,
  topologyHostnames,
  onClose,
}: {
  vms: HeartbeatVm[];
  topologyHostnames: string[];
  onClose: () => void;
}) {
  // Prefer running VMs; if none are up yet, fall back to topology
  // hostnames so the user at least sees what the lab WILL expose.
  const upHosts = vms.filter((v) => v.state === "running").map((v) => v.hostname);
  const hosts = upHosts.length > 0 ? upHosts : topologyHostnames;
  const stillBuilding = upHosts.length === 0;

  const copy = React.useCallback((cmd: string) => {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(cmd).then(
        () => toast.success("Copied", { description: cmd }),
        () => toast.error("Copy failed"),
      );
    }
  }, []);

  // Close on Escape.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="SSH commands"
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.45)",
        zIndex: 1000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--bg)",
          border: "1px solid var(--line)",
          borderRadius: 6,
          maxWidth: 560,
          width: "100%",
          maxHeight: "80vh",
          overflowY: "auto",
        }}
      >
        <div className="card-h" style={{ borderBottom: "1px solid var(--line)" }}>
          <h3>SSH commands</h3>
          <div className="sub mono">{hosts.length} VM(s)</div>
          <div className="grow" />
          <button className="btn sm" type="button" onClick={onClose}>
            Close
          </button>
        </div>
        <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
          {stillBuilding && (
            <div className="banner warn">
              <span>Lab is still building.</span>
            </div>
          )}
          {hosts.length === 0 ? (
            <div style={{ color: "var(--ink-mute)", fontSize: 13 }}>
              No hostnames available yet.
            </div>
          ) : (
            hosts.map((h) => {
              const cmd = `vagrant ssh ${h}`;
              return (
                <div
                  key={h}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    border: "1px solid var(--line)",
                    borderRadius: 4,
                    padding: "8px 10px",
                  }}
                >
                  <code
                    className="mono"
                    style={{
                      flex: 1,
                      fontSize: 12,
                      userSelect: "all",
                      wordBreak: "break-all",
                    }}
                  >
                    {cmd}
                  </code>
                  <button
                    className="btn sm"
                    type="button"
                    onClick={() => copy(cmd)}
                    aria-label={`Copy ssh command for ${h}`}
                  >
                    Copy
                  </button>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

function NetworkView({
  topology,
  vms,
}: {
  topology: LabConfig | undefined;
  vms: HeartbeatVm[];
}) {
  const vmByHost = React.useMemo(() => {
    const m = new Map<string, HeartbeatVm>();
    for (const v of vms) m.set(v.hostname, v);
    return m;
  }, [vms]);

  // Aggregate the open-port set per node by walking topology edges.
  const portsByNodeId = React.useMemo(() => {
    const m = new Map<string, string[]>();
    if (!topology) return m;
    for (const e of topology.edges) {
      if (e.port == null) continue;
      const proto = e.protocol ?? "tcp";
      const label = `${e.port}/${proto}`;
      // Target node hosts the listening port; tag both ends so the
      // operator can see both sides of the conversation in the table.
      for (const id of [e.target, e.source]) {
        const cur = m.get(id) ?? [];
        if (!cur.includes(label)) cur.push(label);
        m.set(id, cur);
      }
    }
    return m;
  }, [topology]);

  if (!topology) {
    return (
      <div className="card s12">
        <div className="card-h">
          <h3>Network</h3>
        </div>
        <div className="card-b" style={{ color: "var(--ink-mute)", fontSize: 13 }}>
          Topology not yet available for this lab.
        </div>
      </div>
    );
  }

  return (
    <div className="card s12">
      <div className="card-h">
        <h3>Network</h3>
        <div className="sub mono">{topology.nodes.length} nodes</div>
      </div>
      <div style={{ overflowX: "auto" }}>
        <table className="mono" style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr style={{ textAlign: "left", color: "var(--ink-mute)", borderBottom: "1px solid var(--line)" }}>
              <th style={{ padding: "8px 12px" }}>Hostname</th>
              <th style={{ padding: "8px 12px" }}>IP</th>
              <th style={{ padding: "8px 12px" }}>VLAN</th>
              <th style={{ padding: "8px 12px" }}>OS</th>
              <th style={{ padding: "8px 12px" }}>Ports</th>
              <th style={{ padding: "8px 12px" }}>State</th>
            </tr>
          </thead>
          <tbody>
            {topology.nodes.map((n) => {
              const hb = vmByHost.get(n.config.hostname);
              const ports = portsByNodeId.get(n.id) ?? [];
              const state = hb?.state ?? "—";
              return (
                <tr key={n.id} style={{ borderBottom: "1px solid var(--line)" }}>
                  <td style={{ padding: "8px 12px", color: "var(--ink)" }}>{n.config.hostname}</td>
                  <td style={{ padding: "8px 12px" }}>{hb?.ip ?? n.config.ip}</td>
                  <td style={{ padding: "8px 12px" }}>{n.config.vlan ?? "—"}</td>
                  <td style={{ padding: "8px 12px" }}>{n.config.os}</td>
                  <td style={{ padding: "8px 12px" }}>
                    {ports.length === 0 ? "—" : ports.join(", ")}
                  </td>
                  <td style={{ padding: "8px 12px" }}>
                    <span className={cn("badge", state === "running" ? "live" : "warn")}>
                      <span className="d" />
                      {state}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SidePanelRow({
  label,
  value,
  mono,
  small,
}: {
  label: string;
  value: string;
  mono?: boolean;
  small?: boolean;
}) {
  return (
    <div>
      <div style={{ fontSize: 11, color: "var(--ink-mute)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
        {label}
      </div>
      <div
        className={mono ? "mono" : undefined}
        style={{
          marginTop: 4,
          fontSize: small ? 11 : 13,
          color: "var(--ink)",
          wordBreak: "break-all",
        }}
      >
        {value}
      </div>
    </div>
  );
}
