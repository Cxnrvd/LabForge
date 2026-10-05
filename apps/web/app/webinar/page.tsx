"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { api } from "@/lib/api/client";
import { cn } from "@/lib/utils/cn";

/**
 * The WiFi Lab run-sheet: one card per segment, built from
 * docs/labs/wifi-pentest-webinar.md's segment table. Status is a judgement
 * call fixed by the lab setup (real hostapd AP, no injection-capable
 * tooling bundled), not something the API reports — so it's data here, not
 * derived.
 */

interface Lab {
  id: number;
  name: string;
  topology_slug: string;
  provider: string;
  status: string;
}

type SegmentStatus = "live" | "narrated";

// Approximate MITRE ATT&CK (Enterprise) mapping for discussion purposes —
// there's no official dedicated wifi matrix, so these are the closest
// tactic/technique for framing each segment, not a certified mapping.
interface AttackTag {
  tactic: string;
  technique: string;
}

interface Segment {
  id: string;
  title: string;
  status: SegmentStatus;
  statusNote?: string;
  target: "ap-target" | "kali-wifi" | "flipper" | "-";
  steps: string[];
  // Case-insensitive substrings that, when seen in the AP's hostapd
  // journal tail, mean "this segment's traffic just showed up".
  logMarkers: string[];
  attack?: AttackTag;
  // If set, the "Set scenario" buttons can jump ap-target straight into
  // this hostapd security mode for this segment.
  scenario?: "open" | "wep" | "wpa2" | "wpa3";
}

const SEGMENTS: Segment[] = [
  {
    id: "recon",
    title: "1. Recon / monitor mode",
    status: "live",
    target: "kali-wifi",
    steps: ["iw dev", "airmon-ng start <iface>", "iw dev  # confirm *mon interface"],
    logMarkers: [],
    attack: { tactic: "Reconnaissance", technique: "T1595" },
  },
  {
    id: "wep",
    title: "2. WEP crack",
    status: "live",
    target: "ap-target",
    steps: [
      "Set scenario: WEP (button below, or edit hostapd.conf by hand)",
      "On kali-wifi: airodump-ng, aireplay-ng --arpreplay, aircrack-ng",
    ],
    logMarkers: ["wep"],
    attack: { tactic: "Credential Access", technique: "T1110.002" },
    scenario: "wep",
  },
  {
    id: "wpa2",
    title: "3. WPA2 handshake + crack",
    status: "live",
    statusNote: "Centerpiece — seed the wordlist with the real passphrase (LabForgeDemo123 by default)",
    target: "ap-target",
    steps: [
      "Set scenario: WPA2 (button below)",
      "airodump-ng --bssid <ap-mac> -c 6 -w cap <iface>",
      "aireplay-ng --deauth 5 -a <ap-mac> <iface>  # force a reassociation",
      "aircrack-ng -w wordlist.txt cap-01.cap",
    ],
    logMarkers: ["wpa", "4-way", "eapol", "handshake"],
    attack: { tactic: "Credential Access", technique: "T1110.002" },
    scenario: "wpa2",
  },
  {
    id: "pmkid",
    title: "4. PMKID capture",
    status: "live",
    statusNote: "No deauth needed — contrast with segment 3",
    target: "ap-target",
    steps: ["hcxdumptool -o pmkid.pcapng -i <iface> --enable_status=1", "hcxpcapngtool -o hashes.22000 pmkid.pcapng", "hashcat -m 22000 hashes.22000 wordlist.txt"],
    logMarkers: ["eapol"],
    attack: { tactic: "Credential Access", technique: "T1110.002" },
  },
  {
    id: "wps",
    title: "5. WPS process",
    status: "narrated",
    statusNote: "Pixie-Dust won't fire against stock hostapd — no vulnerable nonce bug. Show the process, say why it stalls.",
    target: "ap-target",
    steps: ["wash -i <iface>", "reaver -i <iface> -b <ap-mac> -vv"],
    logMarkers: ["wps"],
    attack: { tactic: "Credential Access", technique: "T1110.001" },
  },
  {
    id: "eviltwin",
    title: "6. Evil twin / captive portal",
    status: "narrated",
    statusNote: "Needs a Flipper Zero + Marauder — standalone, handheld, not part of this topology",
    target: "flipper",
    steps: ["Run from the Flipper's Marauder app, not from a lab node"],
    logMarkers: ["deauth"],
    attack: { tactic: "Credential Access", technique: "T1557" },
  },
  {
    id: "deauth",
    title: "7. Deauth-based DoS",
    status: "live",
    statusNote: "A real technique, not RF jamming",
    target: "ap-target",
    steps: ["aireplay-ng --deauth 0 -a <ap-mac> <iface>  # continuous"],
    logMarkers: ["deauth", "disassoc"],
    attack: { tactic: "Impact", technique: "T1498" },
  },
  {
    id: "wpa3",
    title: "8. WPA3 / SAE",
    status: "narrated",
    statusNote: "SAE resists offline dictionary attacks by design. On the cheap Realtek adapter specifically, hostapd refuses to even start in WPA3 mode — that driver doesn't advertise 802.11w (management frame protection), which SAE requires. Worth narrating as its own finding, not just the crypto argument.",
    target: "ap-target",
    steps: ["Set scenario: WPA3 (button below)", "Show a capture attempt failing, then explain why"],
    logMarkers: ["sae"],
    attack: { tactic: "Credential Access", technique: "T1110.002 (resisted by design)" },
    scenario: "wpa3",
  },
];

const SCENARIOS: Array<{ id: "open" | "wep" | "wpa2" | "wpa3"; label: string }> = [
  { id: "open", label: "Open" },
  { id: "wep", label: "WEP" },
  { id: "wpa2", label: "WPA2" },
  { id: "wpa3", label: "WPA3" },
];

// Structured events parsed out of the raw hostapd journal tail — reading
// "STA aa:bb:.. associated" off the screen is a better visual for an
// audience than scrolling syslog text.
interface ParsedEvent {
  id: string;
  time: string;
  type: "ap-enabled" | "associated" | "disassociated" | "deauth" | "handshake" | "eapol" | "other";
  mac: string | null;
  raw: string;
}

function parseEvents(lines: string[]): ParsedEvent[] {
  const macRe = /STA ([0-9a-f]{2}(?::[0-9a-f]{2}){5})/i;
  const timeRe = /^(\w+\s+\d+\s+[\d:]+)/;
  const out: ParsedEvent[] = [];
  lines.forEach((raw, i) => {
    const lower = raw.toLowerCase();
    let type: ParsedEvent["type"] | null = null;
    if (lower.includes("ap-enabled")) type = "ap-enabled";
    else if (lower.includes("disassociat")) type = "disassociated";
    else if (lower.includes("deauth")) type = "deauth";
    else if (lower.includes("pairwise key handshake completed") || lower.includes("4-way")) type = "handshake";
    else if (lower.includes("eapol")) type = "eapol";
    else if (/\bassociated\b/.test(lower)) type = "associated";
    if (!type) return;
    const time = timeRe.exec(raw)?.[1] ?? "";
    const mac = macRe.exec(raw)?.[1] ?? null;
    out.push({ id: `${i}-${raw.slice(0, 20)}`, time, type, mac, raw });
  });
  return out;
}

const EVENT_LABEL: Record<ParsedEvent["type"], string> = {
  "ap-enabled": "AP enabled",
  associated: "Client associated",
  disassociated: "Client disassociated",
  deauth: "Deauth frame",
  handshake: "4-way handshake complete",
  eapol: "EAPOL activity",
  other: "Event",
};

const EVENT_TONE: Record<ParsedEvent["type"], Parameters<typeof cn>[1]> = {
  "ap-enabled": "live",
  associated: "live",
  disassociated: "warn",
  deauth: "warn",
  handshake: "live",
  eapol: "",
  other: "",
};

function StatusBadge({ status }: { status: SegmentStatus }) {
  return (
    <span className={cn("badge", status === "live" ? "live" : "warn")}>
      <span className="d" />
      {status === "live" ? "Live" : "Narrated"}
    </span>
  );
}

function SegmentCard({
  seg,
  active,
  onSelect,
  hit,
}: {
  seg: Segment;
  active: boolean;
  onSelect: () => void;
  hit: boolean;
}) {
  return (
    <div
      className="card s12"
      style={{
        cursor: "pointer",
        borderColor: active ? "var(--accent, #3b82f6)" : undefined,
        marginBottom: 10,
      }}
      onClick={onSelect}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") onSelect();
      }}
    >
      <div className="card-h">
        <h3>{seg.title}</h3>
        <div className="grow" />
        {seg.attack && (
          <span className="badge mono" title="Approximate MITRE ATT&CK mapping, for discussion">
            {seg.attack.tactic} · {seg.attack.technique}
          </span>
        )}
        {hit && (
          <span className="badge live" title="Matching activity just seen in the AP log">
            <span className="d" />
            matched
          </span>
        )}
        <StatusBadge status={seg.status} />
      </div>
      <div className="card-b" style={{ fontSize: 13 }}>
        {seg.statusNote && (
          <div style={{ color: "var(--ink-mute)", marginBottom: 8, fontStyle: "italic" }}>{seg.statusNote}</div>
        )}
        <div style={{ marginBottom: 6 }}>
          <span className="mono" style={{ color: "var(--ink-mute)" }}>
            target: {seg.target}
          </span>
        </div>
        {active && (
          <ol style={{ margin: 0, paddingLeft: 20, display: "flex", flexDirection: "column", gap: 4 }}>
            {seg.steps.map((s, i) => (
              <li key={i} className="mono" style={{ fontSize: 12.5 }}>
                {s}
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}

export default function WebinarPage() {
  const qc = useQueryClient();
  const { data: labs = [] } = useQuery<Lab[]>({
    queryKey: ["labs"],
    queryFn: () => fetch("/api/v1/labs").then((r) => r.json()),
    refetchInterval: 8000,
  });

  const [labId, setLabId] = React.useState<number | null>(null);
  React.useEffect(() => {
    if (labId === null && labs.length > 0) setLabId(labs[0]!.id);
  }, [labs, labId]);

  const [activeSegment, setActiveSegment] = React.useState<string>(SEGMENTS[0]!.id);

  const apLogQ = useQuery<string[]>({
    queryKey: ["node-log", labId, "ap-target", "hostapd"],
    queryFn: () => api.getNodeLog(labId as number, "ap-target", "hostapd", 150),
    enabled: labId !== null,
    // Each call pays vagrant ssh's own Ruby/Vagrant startup cost (observed
    // ~35-40s on Windows) on top of the journalctl itself — polling faster
    // than that just piles up overlapping subprocess calls, not fresher data.
    refetchInterval: 20000,
  });

  const scenarioMut = useMutation({
    mutationFn: (scenario: string) => api.setWifiScenario(labId as number, "ap-target", scenario),
    onSuccess: (res) => {
      if (res.ok) {
        toast.success("Scenario applied", { description: res.message });
        void qc.invalidateQueries({ queryKey: ["node-log", labId, "ap-target", "hostapd"] });
      } else {
        toast.error("Could not switch scenario", { description: res.message });
      }
    },
    onError: (err: Error) => toast.error("Could not switch scenario", { description: err.message }),
  });

  const lines = apLogQ.data ?? [];
  const active = SEGMENTS.find((s) => s.id === activeSegment) ?? SEGMENTS[0]!;
  const events = React.useMemo(() => parseEvents(lines), [lines]);

  // Which segments have matching lines anywhere in the current tail — lets
  // the whole run-sheet light up, not just the one currently expanded.
  const hits = React.useMemo(() => {
    const lower = lines.map((l) => l.toLowerCase());
    const out = new Set<string>();
    for (const seg of SEGMENTS) {
      if (seg.logMarkers.length === 0) continue;
      if (lower.some((l) => seg.logMarkers.some((m) => l.includes(m)))) out.add(seg.id);
    }
    return out;
  }, [lines]);

  return (
    <main className="page">
      <div className="pagehead">
        <div className="grow">
          <h1 className="h1">WiFi Lab — run sheet</h1>
          <div className="meta mono">
            {SEGMENTS.length} segments · {SEGMENTS.filter((s) => s.status === "live").length} live ·{" "}
            {SEGMENTS.filter((s) => s.status === "narrated").length} narrated
          </div>
        </div>
        <select
          className="h-8 rounded-md border border-input bg-background px-2 text-sm"
          value={labId ?? ""}
          onChange={(e) => setLabId(e.target.value ? Number(e.target.value) : null)}
          aria-label="Lab to watch"
        >
          <option value="">No lab selected</option>
          {labs.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name} (#{l.id}, {l.status})
            </option>
          ))}
        </select>
      </div>

      <div className="card s12" style={{ marginTop: 18, marginBottom: 18 }}>
        <div className="card-h">
          <h3>ap-target scenario</h3>
          <div className="sub mono">rewrites hostapd.conf and restarts hostapd — no SSH needed</div>
          <div className="grow" />
          {lines.length > 0 && labId !== null && (
            <a
              className="btn sm"
              href={api.nodeFileUrl(labId, "ap-target", "capture.pcap")}
              title="Download the rolling capture from ap-target"
            >
              Download capture.pcap
            </a>
          )}
        </div>
        <div className="card-b" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {SCENARIOS.map((s) => (
            <button
              key={s.id}
              type="button"
              className="btn sm"
              disabled={labId === null || scenarioMut.isPending}
              onClick={() => scenarioMut.mutate(s.id)}
            >
              {scenarioMut.isPending && scenarioMut.variables === s.id ? "Applying…" : `Set ${s.label}`}
            </button>
          ))}
        </div>
      </div>

      <div className="grid12">
        <div className="s8">
          {SEGMENTS.map((seg) => (
            <SegmentCard
              key={seg.id}
              seg={seg}
              active={seg.id === activeSegment}
              onSelect={() => setActiveSegment(seg.id)}
              hit={hits.has(seg.id)}
            />
          ))}

          <div className="card s12" style={{ marginTop: 10 }}>
            <div className="card-h">
              <h3>Parsed events</h3>
              <div className="sub mono">{events.length} of {lines.length} lines understood</div>
            </div>
            <div style={{ maxHeight: 280, overflowY: "auto" }}>
              {events.length === 0 ? (
                <div className="card-b" style={{ color: "var(--ink-mute)", fontSize: 13 }}>
                  No associations, deauths, or handshakes seen yet in the current tail.
                </div>
              ) : (
                <table className="mono" style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                  <thead>
                    <tr style={{ textAlign: "left", color: "var(--ink-mute)", borderBottom: "1px solid var(--line)" }}>
                      <th style={{ padding: "6px 10px" }}>Time</th>
                      <th style={{ padding: "6px 10px" }}>Event</th>
                      <th style={{ padding: "6px 10px" }}>Client MAC</th>
                    </tr>
                  </thead>
                  <tbody>
                    {events.slice().reverse().map((ev) => (
                      <tr key={ev.id} style={{ borderBottom: "1px solid var(--line)" }}>
                        <td style={{ padding: "6px 10px", color: "var(--ink-mute)" }}>{ev.time}</td>
                        <td style={{ padding: "6px 10px" }}>
                          <span className={cn("badge", EVENT_TONE[ev.type])}>
                            <span className="d" />
                            {EVENT_LABEL[ev.type]}
                          </span>
                        </td>
                        <td style={{ padding: "6px 10px" }}>{ev.mac ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          <div className="card s12" style={{ marginTop: 10 }}>
            <div className="card-h">
              <h3>Extending this lab</h3>
            </div>
            <div className="card-b" style={{ fontSize: 12.5, color: "var(--ink-mute)", display: "flex", flexDirection: "column", gap: 6 }}>
              <div>
                <b style={{ color: "var(--ink)" }}>wifi-client role</b> — add a node with roles{" "}
                <code className="mono">[&quot;wifi-client&quot;]</code> and its own passed-through USB adapter to get a
                station that auto-associates to this AP, so deauth/handshake demos always have a real client even
                without an audience volunteer.
              </div>
              <div>
                <b style={{ color: "var(--ink)" }}>Pair with an IDS</b> — add the <code className="mono">suricata</code>{" "}
                or <code className="mono">zeek</code> role to a node on the same network to show network-layer
                detection alongside hostapd&apos;s own log — two different &quot;how does the defender see this&quot;
                stories in the same segment.
              </div>
            </div>
          </div>
        </div>

        <div className="card s4" style={{ position: "sticky", top: 16, alignSelf: "flex-start" }}>
          <div className="card-h">
            <h3>ap-target · hostapd log</h3>
            <div className="sub mono">polls every 20s · {lines.length} lines</div>
          </div>
          <div style={{ padding: "0 4px" }}>
            <div
              className="mono"
              style={{
                margin: 0,
                padding: 10,
                fontSize: 11,
                lineHeight: 1.5,
                maxHeight: 520,
                overflowY: "auto",
                background: "var(--bg-1)",
                color: "var(--ink-dim)",
              }}
            >
              {labId === null ? (
                <span style={{ color: "var(--ink-faint)" }}>Pick a lab above to watch its AP log.</span>
              ) : lines.length === 0 ? (
                <span style={{ color: "var(--ink-faint)" }}>
                  {apLogQ.isLoading ? "Connecting…" : "No log lines yet."}
                </span>
              ) : (
                lines.map((ln, idx) => {
                  const lower = ln.toLowerCase();
                  const isMarker = active.logMarkers.some((m) => lower.includes(m));
                  return (
                    <div key={idx} style={{ color: isMarker ? "var(--green)" : undefined }}>
                      {ln || " "}
                    </div>
                  );
                })
              )}
            </div>
          </div>
          <div className="card-b" style={{ fontSize: 11.5, color: "var(--ink-mute)" }}>
            Lines matching the selected segment&apos;s markers (
            {active.logMarkers.join(", ") || "none for this segment"}) are highlighted. This reads the guest&apos;s
            own <code className="mono">journalctl -u hostapd</code> over <code className="mono">vagrant ssh</code> —
            it needs the lab actually built and running.
          </div>
        </div>
      </div>
    </main>
  );
}
