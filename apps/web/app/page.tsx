"use client";

/**
 * LabForge Home (Soft Cards).
 *
 * Left: this computer (memory, CPU, disk, headroom) and the engines.
 * Middle: your labs and the machines that are up.
 * Right: a floating "Live now" card for the first running lab.
 * Styles live in styles/labforge-soft.css.
 */

import * as React from "react";
import Link from "next/link";
import { useQuery, useQueries } from "@tanstack/react-query";

import { api } from "@/lib/api/client";
import type { HostMetrics, LabEndpoint, PreflightReport, TemplateSummary } from "@/lib/api/client";
import { formatSize, resolveRequirements, useImages, useRequiredImages } from "@/lib/api/images";
import { useLaunchStore } from "@/lib/store/launch-store";
import { useTopologyStore } from "@/lib/store/topology-store";
import { OS_LABELS } from "@labforge/schema";
import { toast } from "sonner";

interface Lab {
  id: number;
  name: string;
  status: string;
  template_id?: string | null;
  provider?: string | null;
  updated_at?: string | null;
}

interface ActivityEntry {
  lab_id: number;
  lab_name: string;
  captured_at: string;
  lab_status: string;
  running_vms: number;
  total_vms: number;
  log_snippet: string | null;
}

const WINDOWS_GUEST_MB = 4096;
const HISTORY = 24;

function gb(mb: number | null | undefined, digits = 1): string {
  if (mb == null) return "n/a";
  return (mb / 1024).toFixed(digits);
}

function hms(iso: string): string {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "--:--:--" : d.toLocaleTimeString([], { hour12: false });
}

function chipFor(status: string): { cls: string; text: string } {
  const s = (status ?? "").toLowerCase();
  if (s === "running") return { cls: "ok", text: "Running" };
  if (s === "partial" || s === "building" || s === "provisioning") return { cls: "info", text: "Starting" };
  if (s === "failed" || s === "error") return { cls: "err", text: "Failed" };
  if (s === "draft" || s === "created") return { cls: "", text: "Draft" };
  return { cls: "", text: "Stopped" };
}

function Svg({ d, size = 18 }: { d: string; size?: number }): React.ReactElement {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}
const FLASK = "M9 3h6M10 3v6L4.5 19a1.5 1.5 0 0 0 1.3 2h12.4a1.5 1.5 0 0 0 1.3-2L14 9V3M7.5 15h9";
const PLUS = "M12 5v14M5 12h14";

function PreflightCard({
  linux,
  windows,
  loading,
}: {
  linux?: PreflightReport;
  windows?: PreflightReport;
  loading: boolean;
}): React.ReactElement {
  const problems = (linux?.checks ?? []).filter((c) => c.status !== "ok");
  // Windows guests need more (KVM, a big disk). Show only what is different from the Linux report.
  const winOnly = (windows?.checks ?? []).filter(
    (c) => c.status !== "ok" && (c.id === "kvm" || (c.id === "disk" && !problems.some((p) => p.id === "disk"))),
  );
  const chip = loading || !linux
    ? { cls: "", text: "Checking" }
    : linux.status === "fail"
      ? { cls: "err", text: "Blocked" }
      : linux.status === "warn"
        ? { cls: "info", text: "Heads up" }
        : { cls: "ok", text: "Ready" };
  return (
    <div className="scard">
      <div style={{ display: "flex", alignItems: "center" }}>
        <div className="eyebrow" style={{ flex: 1 }}>Preflight</div>
        <span className={`chip ${chip.cls}`}>{chip.text}</span>
      </div>
      {linux && problems.length === 0 && (
        <div className="home-sub" style={{ marginTop: 8 }}>
          Docker, memory, disk and ports are fine for Linux labs like the ransomware hunt.
        </div>
      )}
      {problems.map((c) => (
        <div key={c.id} style={{ marginTop: 10 }}>
          <div style={{ fontWeight: 600 }}>{c.title}</div>
          <div className="home-sub">{c.detail}</div>
          {c.fix && <div className="home-sub" style={{ color: "var(--d10-fg)" }}><b>Fix:</b> {c.fix}</div>}
        </div>
      ))}
      <div className="rows" style={{ marginTop: 10 }}>
        <div className="r"><span className="k">Windows guests</span>
          <span className="v">
            {!windows ? "checking" : winOnly.length === 0 ? <span className="chip ok">Ready</span> : <span className="chip err">Not ready</span>}
          </span></div>
      </div>
      {winOnly.map((c) => (
        <div key={c.id} style={{ marginTop: 8 }}>
          <div style={{ fontWeight: 600 }}>{c.title}</div>
          <div className="home-sub">{c.detail}</div>
          {c.fix && <div className="home-sub" style={{ color: "var(--d10-fg)" }}><b>Fix:</b> {c.fix}</div>}
        </div>
      ))}
    </div>
  );
}

export default function Home(): React.ReactElement {
  const metricsQ = useQuery<HostMetrics>({
    queryKey: ["host-metrics"],
    queryFn: () => api.hostMetrics(),
    refetchInterval: 5000,
    retry: 0,
  });
  const preflightQ = useQuery<PreflightReport>({
    queryKey: ["preflight"],
    queryFn: () => api.preflight(),
    refetchInterval: 30_000,
    retry: 0,
  });
  const windowsQ = useQuery<PreflightReport>({
    queryKey: ["preflight-windows"],
    queryFn: () => api.preflight({ windowsGuests: 1, memoryMb: 4096 }),
    refetchInterval: 60_000,
    retry: 0,
  });
  const labsQ = useQuery<Lab[]>({
    queryKey: ["labs"],
    queryFn: () => fetch("/api/v1/labs").then((r) => r.json()),
    refetchInterval: 8000,
  });
  const activityQ = useQuery<ActivityEntry[]>({
    queryKey: ["activity"],
    queryFn: () => fetch("/api/v1/labs/activity/recent").then((r) => r.json()),
    refetchInterval: 15_000,
  });

  const templatesQ = useQuery<TemplateSummary[]>({
    queryKey: ["templates"],
    queryFn: () => api.listTemplates(),
    staleTime: 5 * 60_000,
  });
  const imagesQ = useImages();
  const loadTopology = useTopologyStore((st) => st.loadTopology);
  const showLaunch = useLaunchStore((st) => st.show);
  const [launching, setLaunching] = React.useState(false);

  const featured =
    (templatesQ.data ?? []).find((t) => t.id === "ransomware-intrusion-lab") ?? (templatesQ.data ?? [])[0];
  const launchFeatured = async (): Promise<void> => {
    if (!featured) return;
    setLaunching(true);
    try {
      loadTopology(await api.getTemplate(featured.id));
      showLaunch();
    } catch (e) {
      toast.error("Could not load the template", { description: (e as { detail?: string }).detail ?? "Check the API log." });
    } finally {
      setLaunching(false);
    }
  };

  const labs = Array.isArray(labsQ.data) ? labsQ.data : [];
  const running = labs.filter((l) => l.status === "running" || l.status === "partial");
  const live = running[0];

  const topoQs = useQueries({
    queries: running.map((l) => ({
      queryKey: ["lab-topology", l.id],
      queryFn: () => api.getLabTopology(l.id),
      staleTime: 60_000,
      retry: 0,
    })),
  });
  const beatQs = useQueries({
    queries: running.map((l) => ({
      queryKey: ["heartbeat", l.id],
      queryFn: () => api.getLabHeartbeat(l.id),
      enabled: l.status === "running",
      // Poll quickly until the first heartbeat lands, then relax.
      refetchInterval: (q: { state: { data?: { vms?: unknown[] } } }) =>
        q.state.data?.vms?.length ? 15_000 : 3_000,
      retry: 0,
    })),
  });

  // Client-side memory history for the sparkline.
  const [hist, setHist] = React.useState<number[]>([]);
  const sampledAt = metricsQ.data?.sampled_at;
  React.useEffect(() => {
    const pct = metricsQ.data?.memory.percent;
    if (pct == null) return;
    setHist((h) => [...h, pct].slice(-HISTORY));
  }, [sampledAt]); // eslint-disable-line react-hooks/exhaustive-deps

  const m = metricsQ.data;
  const totalMb = m?.memory.total_mb ?? null;
  const usedMb = m?.memory.used_mb ?? null;
  const freeMb = totalMb != null && usedMb != null ? totalMb - usedMb : null;
  const labMb = topoQs.reduce((acc, q, i) => {
    const l = running[i];
    if (!q.data || !l) return acc;
    return acc + q.data.nodes.reduce((a, n) => a + (n.config.memory_mb ?? 0), 0);
  }, 0);
  // Containers can only use what Docker itself was given, which is often less than the whole computer.
  const dockerMb = m?.engine.docker_memory_mb ?? null;
  const guestRoomMb = freeMb != null ? Math.min(freeMb, dockerMb != null ? Math.max(0, dockerMb - labMb) : freeMb) : null;
  const guests = guestRoomMb != null ? Math.max(0, Math.floor(guestRoomMb / WINDOWS_GUEST_MB)) : null;
  const dockerDisk = m?.engine.docker_disk?.free_gb ?? null;

  // Machines table rows.
  const machines: Array<{ lab: string; host: string; os: string; ip: string; mb: number; state: string }> = [];
  running.forEach((l, i) => {
    const topo = topoQs[i]?.data;
    const beat = beatQs[i]?.data;
    if (!topo) return;
    for (const n of topo.nodes) {
      const vm = beat?.vms.find((v) => v.hostname === n.config.hostname);
      machines.push({
        lab: l.name,
        host: n.config.hostname,
        os: OS_LABELS[n.config.os] ?? n.config.os,
        ip: n.config.ip,
        mb: n.config.memory_mb ?? 0,
        state: vm?.state ?? (l.status === "running" ? "running" : "starting"),
      });
    }
  });
  const machinesUp = machines.filter((x) => x.state === "running").length;

  const events = (activityQ.data ?? []).filter((a) => !live || a.lab_id === live.id).slice(0, 4);
  const liveTopo = live ? topoQs[0]?.data : undefined;
  const liveBeat = live ? beatQs[0]?.data : undefined;
  const endpointsQ = useQuery<LabEndpoint[]>({
    queryKey: ["lab-endpoints", live?.id],
    queryFn: () => api.labEndpoints(live!.id),
    enabled: !!live && live.provider === "docker",
    staleTime: 60_000,
    retry: 0,
  });
  const liveEndpoints = endpointsQ.data;

  const imgs = imagesQ.data;
  const imgSample = imgs?.sample ?? true;
  const imgMissing = (imgs?.images ?? []).filter((i) => i.status === "missing").length;
  const imgReady = (imgs?.images ?? []).filter((i) => i.status === "ready").length;
  const imgUpdates = (imgs?.images ?? []).filter((i) => i.status === "outdated").length;

  const featuredTopoQ = useQuery({
    queryKey: ["template", featured?.id],
    queryFn: () => api.getTemplate(featured!.id),
    enabled: !!featured,
    staleTime: 5 * 60_000,
    retry: 0,
  });
  const featuredReqQ = useRequiredImages(featuredTopoQ.data, "docker");
  const featuredStates = resolveRequirements(featuredTopoQ.data, "docker", featuredReqQ.data, imgs?.images, imgSample).map((x) => x.state);
  const featuredMissing = featuredStates.filter((x) => x === "missing").length;
  const featuredRam = featuredTopoQ.data?.nodes.reduce((a, n) => a + (n.config.memory_mb ?? 0), 0) ?? 0;

  const eng = m?.engine;

  const steps = [
    { done: !!eng?.docker_daemon, label: "Docker is running" },
    { done: !imgSample && imgMissing === 0 && imgReady > 0, label: "Images are downloaded" },
    { done: labs.length > 0, label: "Build your first lab" },
    { done: running.length > 0, label: "See a lab running" },
  ];
  const stepsDone = steps.filter((x) => x.done).length;
  const histBars = hist.length ? hist : [];

  return (
    <div className="home">
      <div className="home-head">
        <div style={{ flex: 1 }}>
          <h1 className="home-title">Home</h1>
          <div className="home-sub">
            {running.length > 0
              ? `${running.length} lab${running.length === 1 ? "" : "s"} running on this computer`
              : "Nothing is running right now"}
          </div>
        </div>
        <button
          type="button"
          className="btn"
          onClick={() => {
            void metricsQ.refetch();
            void api.preflight({ recheck: true }).then(() => {
              void preflightQ.refetch();
              void windowsQ.refetch();
            });
          }}
        >
          Re-check host
        </button>
        <Link href="/settings" className="btn">Host settings</Link>
        <Link href="/build" className="btn primary">New lab</Link>
      </div>

      {featured && (
        <div className="scard" style={{ flexDirection: "row", flexWrap: "wrap", gap: 24, alignItems: "center" }}>
          <div style={{ flex: "1 1 340px", minWidth: 0 }}>
            <div className="eyebrow">Featured lab</div>
            <div style={{ fontSize: 22, fontWeight: 600, margin: "6px 0 4px" }}>{featured.name}</div>
            <div className="home-sub" style={{ maxWidth: 560 }}>
              {featured.description.length > 170 ? `${featured.description.slice(0, 170)}...` : featured.description}
            </div>
          </div>
          <div style={{ display: "flex", gap: 28 }}>
            <div><div className="eyebrow">Machines</div><div style={{ fontSize: 20, fontWeight: 600 }}>{featured.node_count}</div></div>
            <div><div className="eyebrow">Memory</div><div style={{ fontSize: 20, fontWeight: 600 }}>{featuredRam ? formatSize(featuredRam) : "n/a"}</div></div>
            <div><div className="eyebrow">Images</div>
              <div style={{ fontSize: 20, fontWeight: 600 }}>
                {imgSample ? "not checked" : featuredMissing === 0 ? "ready" : `${featuredMissing} to download`}
              </div></div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <Link href="/images" className="btn">Prepare images</Link>
            <button type="button" className="btn primary" onClick={() => void launchFeatured()} disabled={launching}>
              {launching ? "Loading" : "Launch lab"}
            </button>
          </div>
        </div>
      )}

      <div className="home-grid">
        {/* Column 1 */}
        <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
          <div className="scard">
            <div className="eyebrow">Host memory</div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 8 }}>
              <span className="big">{gb(usedMb)}</span>
              <span style={{ color: "var(--d10-fg-dim)" }}>/ {gb(totalMb, 0)} GB</span>
            </div>
            <div className="hist" style={{ margin: "16px 0 8px" }} aria-label="Memory history">
              {Array.from({ length: HISTORY }, (_, i) => {
                const v = histBars[i - (HISTORY - histBars.length)];
                return (
                  <i key={i} className={v != null && i === HISTORY - 1 ? "hot" : undefined}
                    style={{ height: v != null ? `${Math.max(6, v)}%` : 6 }} />
                );
              })}
            </div>
            <div className="rows">
              <div className="r"><span className="k">CPU</span>
                <span className="v">{m?.cpu.percent != null ? `${m.cpu.percent.toFixed(0)}%` : "n/a"}{m?.cpu.cores ? ` of ${m.cpu.cores} threads` : ""}</span></div>
              <div className="r"><span className="k">{dockerDisk != null ? "Disk free (Docker)" : "Disk free"}</span>
                <span className="v">{dockerDisk != null ? `${dockerDisk.toFixed(0)} GB` : m?.disk.free_gb != null ? `${m.disk.free_gb.toFixed(0)} GB` : "n/a"}</span></div>
              <div className="r"><span className="k">Used by labs</span>
                <span className="v">{labMb > 0 ? `${gb(labMb)} GB` : "none"}</span></div>
              <div className="r"><span className="k">Room for Windows guests</span>
                <span className="v">{guests != null ? `${guests} (4 GB each)` : "n/a"}</span></div>
            </div>
            {metricsQ.isError && (
              <div className="home-sub" style={{ marginTop: 8 }}>Host metrics unavailable. Is the API running?</div>
            )}
          </div>

          <PreflightCard linux={preflightQ.data} windows={windowsQ.data} loading={preflightQ.isLoading} />

          <div className="scard">
            <div className="eyebrow">Engines</div>
            <div className="rows" style={{ marginTop: 6 }}>
              <div className="r"><span className="k">Docker</span>
                <span className="v">
                  <span className={`chip ${eng?.docker_daemon ? "ok" : "err"}`}>
                    {eng ? (eng.docker_daemon ? eng.docker_version ?? "running" : "not running") : "checking"}
                  </span></span></div>
              <div className="r"><span className="k">Compose</span><span className="v">{eng?.compose_version ?? "n/a"}</span></div>
              <div className="r"><span className="k">Docker memory</span>
                <span className="v">{eng?.docker_memory_mb != null ? `${(eng.docker_memory_mb / 1024).toFixed(0)} GB` : "n/a"}</span></div>
              <div className="r"><span className="k">Virtualization (host)</span>
                <span className="v">{eng?.hypervisor_present == null ? "n/a" : eng.hypervisor_present ? "available" : "missing"}</span></div>
              <div className="r"><span className="k">Vagrant (optional)</span><span className="v">{eng?.vagrant_version ?? "not installed"}</span></div>
              <div className="r"><span className="k">VirtualBox (optional)</span><span className="v">{eng?.virtualbox_version ?? "not installed"}</span></div>
            </div>
          </div>
        </div>

        {/* Column 2 */}
        <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
          <div className="scard">
            <div style={{ display: "flex", alignItems: "center" }}>
              <div className="eyebrow" style={{ flex: 1 }}>Your labs</div>
              <Link href="/labs" className="eyebrow" style={{ color: "var(--d10-accent)" }}>See all</Link>
            </div>
            <div style={{ marginTop: 6 }}>
              {labs.slice(0, 6).map((l) => {
                const c = chipFor(l.status);
                return (
                  <Link key={l.id} href={`/labs/${l.id}`} className="lab-row">
                    <div className="ico"><Svg d={FLASK} /></div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="nm">{l.name}</div>
                      <div className="sb">{l.template_id ?? "custom"} · {l.provider ?? "docker"}</div>
                    </div>
                    <span className={`chip ${c.cls}`}>{c.text}</span>
                  </Link>
                );
              })}
              <Link href="/templates" className="lab-row">
                <div className="ico"><Svg d={PLUS} /></div>
                <div style={{ flex: 1 }}>
                  <div className="nm">New lab from a template</div>
                  <div className="sb">Ransomware range, AD, DFIR and more</div>
                </div>
              </Link>
            </div>
          </div>

          <div className="scard" style={{ padding: 0 }}>
            <div style={{ padding: "22px 22px 14px", display: "flex", gap: 28, alignItems: "flex-end" }}>
              <div style={{ flex: 1 }}>
                <div className="eyebrow">Running machines</div>
                <div className="big" style={{ fontSize: 34, marginTop: 6 }}>{machinesUp}</div>
              </div>
              <div>
                <div className="eyebrow">Lab memory</div>
                <div style={{ fontSize: 18, fontWeight: 600 }}>{labMb > 0 ? `${gb(labMb)} GB` : "0 GB"}</div>
              </div>
            </div>
            <div style={{ overflowX: "auto" }}>
              <table className="mtable">
                <thead>
                  <tr><th>Machine</th><th>IP</th><th>RAM</th><th>State</th></tr>
                </thead>
                <tbody>
                  {machines.length === 0 && (
                    <tr><td colSpan={4} style={{ color: "var(--d10-fg-dim)" }}>No machines up. Start a lab to see them here.</td></tr>
                  )}
                  {machines.slice(0, 8).map((x) => (
                    <tr key={`${x.lab}-${x.host}`}>
                      <td className="nm">{x.host}<div style={{ fontWeight: 400, fontSize: 11, color: "var(--d10-fg-dim)" }}>{x.os}</div></td>
                      <td className="mono">{x.ip}</td>
                      <td>{gb(x.mb)} GB</td>
                      <td><span className={`chip ${x.state === "running" ? "ok" : "info"}`}>{x.state}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div className="scard">
            <div className="eyebrow">Recent activity</div>
            <div className="rows" style={{ marginTop: 6 }}>
              {(activityQ.data ?? []).slice(0, 6).length === 0 && <div className="home-sub">No activity yet. Launch a lab and it will show up here.</div>}
              {(activityQ.data ?? []).slice(0, 6).map((e, i) => (
                <div key={i} className="r">
                  <span className="k"><span className="mono">{hms(e.captured_at)}</span> &nbsp; {e.lab_name}</span>
                  <span className="v" style={{ fontWeight: 400 }}>{e.log_snippet ? e.log_snippet.slice(0, 48) : `${e.running_vms}/${e.total_vms} up`}</span>
                </div>
              ))}
            </div>
          </div>
        </div>


        {/* Column 3 */}
        <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
        <div className="scard float-card" style={{ gridRow: "auto", gridColumn: "auto" }}>
          <div style={{ display: "flex", alignItems: "center" }}>
            <div className="eyebrow" style={{ flex: 1 }}>Live now</div>
            {live && <span className={`chip ${chipFor(live.status).cls}`}>{chipFor(live.status).text}</span>}
          </div>
          {!live ? (
            <div style={{ marginTop: 14 }}>
              <div className="home-sub" style={{ marginBottom: 14 }}>
                No lab is running. Start one from your labs list or the canvas.
              </div>
              <Link href="/templates" className="btn primary btn-block">Pick a template</Link>
            </div>
          ) : (
            <>
              <div style={{ fontSize: 18, fontWeight: 600, margin: "8px 0 12px" }}>{live.name}</div>
              <MiniTopology topo={liveTopo} />
              <div className="rows" style={{ marginTop: 10 }}>
                <div className="r"><span className="k">Machines up</span>
                  <span className="v">{liveBeat && liveBeat.vms.length > 0 ? `${liveBeat.vms.filter((v) => v.state === "running").length} / ${liveBeat.vms.length}` : "waiting for first heartbeat"}</span></div>
                <div className="r"><span className="k">Provider</span><span className="v">{live.provider ?? "docker"}</span></div>
              </div>
              <div className="eyebrow" style={{ margin: "12px 0 4px" }}>Latest events</div>
              <div className="rows">
                {events.length === 0 && <div className="home-sub">Nothing yet.</div>}
                {events.map((e, i) => (
                  <div key={i} className="r" style={{ padding: "6px 0" }}>
                    <span className="k mono">{hms(e.captured_at)}</span>
                    <span className="v" style={{ fontWeight: 400, fontSize: 12 }}>
                      {e.log_snippet ? e.log_snippet.slice(0, 40) : `${e.running_vms}/${e.total_vms} up`}
                    </span>
                  </div>
                ))}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 14 }}>
                {(liveEndpoints ?? []).filter((ep) => ep.url).map((ep) => (
                  <a key={`${ep.host}-${ep.host_port}`} href={ep.url ?? "#"} target="_blank" rel="noreferrer" className="btn primary btn-block">
                    Open {ep.label}
                  </a>
                ))}
                <Link href={`/monitor/${live.id}`} className="btn btn-block">Open live view</Link>
                <Link href={`/labs/${live.id}`} className="btn btn-block">Lab details</Link>
              </div>
            </>
          )}
        </div>

        <div className="scard">
          <div style={{ display: "flex", alignItems: "center" }}>
            <div className="eyebrow" style={{ flex: 1 }}>Images</div>
            <Link href="/images" className="eyebrow" style={{ color: "var(--d10-accent)" }}>Library</Link>
          </div>
          {imgSample ? (
            <div className="home-sub" style={{ marginTop: 8 }}>The image library is not connected yet.</div>
          ) : (
            <div className="rows" style={{ marginTop: 6 }}>
              <div className="r"><span className="k">Ready</span><span className="v">{imgReady}</span></div>
              <div className="r"><span className="k">Not downloaded</span><span className="v">{imgMissing}</span></div>
              <div className="r"><span className="k">Updates</span><span className="v">{imgUpdates}</span></div>
              <div className="r"><span className="k">On disk</span><span className="v">{formatSize(imgs?.total_mb ?? 0)}</span></div>
            </div>
          )}
        </div>

        {stepsDone < steps.length && (
          <div className="scard">
            <div style={{ display: "flex" }}>
              <div className="eyebrow" style={{ flex: 1 }}>Getting started</div>
              <div className="eyebrow">{stepsDone} of {steps.length}</div>
            </div>
            <div className="rows" style={{ marginTop: 6 }}>
              {steps.map((st, i) => (
                <div key={i} className="r">
                  <span className="k" style={{ color: st.done ? "var(--d10-fg-strong)" : undefined }}>{st.label}</span>
                  <span className={`chip ${st.done ? "ok" : ""}`}>{st.done ? "Done" : "To do"}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        </div>
      </div>
    </div>
  );
}

function MiniTopology({ topo }: { topo: import("@labforge/schema").LabConfig | undefined }): React.ReactElement {
  if (!topo || topo.nodes.length === 0) return <div className="topo-mini" />;
  const xs = topo.nodes.map((n) => n.position.x);
  const ys = topo.nodes.map((n) => n.position.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const px = (x: number): number => 12 + ((x - minX) / Math.max(1, maxX - minX)) * 76;
  const py = (y: number): number => 16 + ((y - minY) / Math.max(1, maxY - minY)) * 68;
  const pos = new Map(topo.nodes.map((n) => [n.id, { x: px(n.position.x), y: py(n.position.y) }]));
  return (
    <div className="topo-mini">
      <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none"
        style={{ position: "absolute", inset: 0 }}>
        {topo.edges.map((e) => {
          const a = pos.get(e.source), b = pos.get(e.target);
          if (!a || !b) return null;
          return <line key={e.id} x1={a.x} y1={a.y} x2={b.x} y2={b.y}
            stroke="var(--d10-border-strong)" strokeWidth={0.8} vectorEffect="non-scaling-stroke" />;
        })}
      </svg>
      {topo.nodes.slice(0, 8).map((n) => {
        const p = pos.get(n.id)!;
        return <div key={n.id} className="n" style={{ left: `${p.x}%`, top: `${p.y}%` }}>{n.label}</div>;
      })}
    </div>
  );
}
