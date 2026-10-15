"use client";

import * as React from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { api, type ApiError } from "@/lib/api/client";
import { cn } from "@/lib/utils/cn";
import { LiveTopologyView } from "@/components/monitor/LiveTopologyView";

/**
 * WiFi Lab architecture landing page — the stop before the run sheet
 * (/webinar). Shows the four-node topology (kali-wifi / ap-target / radius /
 * siem), lets you spawn or resume the lab, and hands off into the walkthrough
 * once it's up. Deliberately thinner than /monitor/[id] (no SSH modal, no
 * Events/Timeline/Network/Logs tabs) — this page answers exactly two
 * questions: "is it built, and how is it wired", then gets out of the way.
 */

interface Lab {
  id: number;
  name: string;
  topology_slug: string;
  provider: string;
  status: string;
}

const STATUS_BADGE: Record<string, "live" | "warn" | "err"> = {
  running: "live",
  building: "warn",
  paused: "warn",
  stopped: "warn",
  partial: "warn",
  unknown: "warn",
  failed: "err",
};

const NODE_LEGEND: { hostname: string; role: string; note: string }[] = [
  { hostname: "kali-wifi", role: "Attacker (GUI VM)", note: "Kali desktop with a passed-through USB WiFi adapter — monitor mode, injection, cracking." },
  { hostname: "ap-target", role: "Target AP (hostapd)", note: "Real hostapd access point. Scenario buttons on the run sheet rewrite its config and restart the service." },
  { hostname: "radius", role: "FreeRADIUS", note: "Backs the WPA2/WPA3-Enterprise and 802.1x scenarios — only used once a scenario needs it." },
  { hostname: "siem", role: "Wazuh manager", note: "Ingests ap-target's hostapd journal over the agent and raises alerts with MITRE ATT&CK tags." },
];

export default function WifiLabPage(): React.ReactElement {
  const qc = useQueryClient();
  const { data: allLabs = [], isLoading } = useQuery<Lab[]>({
    queryKey: ["labs"],
    queryFn: () => fetch("/api/v1/labs").then((r) => r.json()),
    refetchInterval: 8000,
  });
  const lab = React.useMemo(() => allLabs.find((l) => l.topology_slug === "wifi-lab") ?? null, [allLabs]);

  const resumeMut = useMutation<unknown, ApiError>({
    mutationFn: () => api.resumeLab(lab!.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["labs"] });
      toast.success("Starting the WiFi lab", {
        description:
          lab?.status === "paused"
            ? "Resuming from suspend — restores saved RAM state, no reboot."
            : "Booting the VMs (vagrant up). Nothing is re-provisioned if they already exist.",
      });
    },
    onError: (err) => {
      toast.error("Could not start the lab", { description: err.detail });
    },
  });

  const canResume = lab !== null && ["stopped", "paused", "failed", "partial", "unknown"].includes(lab.status);
  const badge = lab ? (STATUS_BADGE[lab.status] ?? "warn") : "warn";

  return (
    <main className="page">
      <div className="pagehead">
        <div className="grow">
          <h1 className="h1">WiFi Lab</h1>
          <div className="meta mono">
            kali-wifi · ap-target · radius · siem — real hostapd AP, no simulated traffic
          </div>
        </div>
        {lab && (
          <span className={cn("badge", badge)}>
            <span className="d" />
            {lab.status}
          </span>
        )}
      </div>

      {isLoading ? (
        <div className="card s12">
          <div className="card-b" style={{ color: "var(--ink-mute)", fontSize: 13 }}>
            Loading…
          </div>
        </div>
      ) : lab === null ? (
        <div className="card s12">
          <div className="card-h">
            <h3>No WiFi lab built yet</h3>
          </div>
          <div className="card-b" style={{ fontSize: 13, display: "flex", flexDirection: "column", gap: 12 }}>
            <p style={{ color: "var(--ink-mute)", margin: 0 }}>
              This page tracks the lab whose topology is <code>wifi-lab</code>. None exists in this
              workspace yet — build it from the WiFi Lab template, then this page will show its
              architecture and let you spawn/resume it without rebuilding.
            </p>
            <div>
              <Link href="/templates" className="btn primary">
                Go to Templates
              </Link>
            </div>
          </div>
        </div>
      ) : (
        <>
          <div className="card s12">
            <div className="card-h">
              <h3>Architecture</h3>
              <div className="sub mono">live topology — reflects actual VM state, not just the stored config</div>
            </div>
            <div style={{ height: 480, position: "relative" }}>
              <LiveTopologyView labId={lab.id} />
            </div>
          </div>

          <div className="card s12" style={{ marginTop: 18 }}>
            <div className="card-h">
              <h3>What each node is</h3>
            </div>
            <div className="card-b" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 14 }}>
              {NODE_LEGEND.map((n) => (
                <div key={n.hostname}>
                  <div className="mono" style={{ fontSize: 12.5, fontWeight: 600 }}>
                    {n.hostname} <span style={{ color: "var(--ink-mute)", fontWeight: 400 }}>— {n.role}</span>
                  </div>
                  <div style={{ fontSize: 12.5, color: "var(--ink-mute)", marginTop: 2 }}>{n.note}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="card s12" style={{ marginTop: 18 }}>
            <div
              className="card-b"
              style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}
            >
              <div style={{ fontSize: 12.5, color: "var(--ink-mute)", maxWidth: 480 }}>
                {lab.status === "running"
                  ? "The lab is up — watch it boot in Monitor, or jump straight into the walkthrough."
                  : "Spawn (or resume) the lab, then watch it boot in Monitor — the run sheet's scenario buttons and live log need the VMs actually running."}
              </div>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <button
                  type="button"
                  className="btn primary"
                  disabled={!canResume || resumeMut.isPending}
                  onClick={() => resumeMut.mutate()}
                >
                  {resumeMut.isPending ? "Starting…" : lab.status === "paused" ? "Resume Lab" : "Spawn / Resume Lab"}
                </button>
                <Link href={`/monitor/${lab.id}`} className="btn">
                  Monitor &amp; Logs
                </Link>
                <Link href="/webinar" className="btn">
                  ▶ Launch Walkthrough
                </Link>
              </div>
            </div>
          </div>
        </>
      )}
    </main>
  );
}
