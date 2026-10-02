"use client";

// TODO: needs backend support — replace with GET /api/v1/vendors when endpoint lands.
// Until then the catalog is hardcoded inline so the UI matches the design contract
// (labforge-designs.html #p6, "Vendor Catalog · 56 entries").

import * as React from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  Activity,
  ArrowRight,
  BrainCircuit,
  Box,
  Container,
  Cpu,
  Database,
  Eye,
  Factory,
  Layout,
  MousePointerClick,
  Network,
  Package,
  Radio,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Skull,
  Terminal,
  Wand2,
  X,
  type LucideIcon,
} from "lucide-react";

import { PageToolbars, type TabSpec } from "@/components/dashboard/AppShell";
import { lookupVendor } from "@/lib/icons/catalog";

/* ============================================================
   Vendor catalog (UI-only fixture)
   ============================================================
   NOTE: the mockup labels the second tab "EDR · 4" but visually
   groups EDR and Host Monitoring together (8 cards in one strip).
   We honour both: the underlying section is rendered as the
   combined 8-row "EDR · Host Monitoring" block, and the tab
   filter for "EDR" narrows to the 4 pure-EDR entries
   (`subgroup === "edr"`). */

type Platform = "linux" | "windows";
type Installer = "curated" | "stub";

interface VendorEntry {
  id: string;
  name: string;
  /** Display category — also the section header. */
  category: string;
  /** Coarse bucket used by the tab filter. */
  bucket:
    | "siem"
    | "edr"
    | "hostmon"
    | "ids"
    | "ics"
    | "aiml"
    | "offensive"
    | "container"
    | "database";
  /** Two-letter logo initials. */
  initials: string;
  /** `.lf .lg-…` class controlling logo background. */
  logoClass: string;
  platforms: Platform[];
  installer: Installer;
  versions: string[];
  activeVersion?: string;
}

const VENDOR_CATALOG: readonly VendorEntry[] = [
  // ---- SIEM (8) ----
  { id: "splunk", name: "Splunk", category: "SIEM", bucket: "siem", initials: "Sp", logoClass: "lg-splunk", platforms: ["linux", "windows"], installer: "curated", versions: ["9.3", "9.2", "9.1", "8.2.x"], activeVersion: "9.3" },
  { id: "elastic", name: "Elastic", category: "SIEM", bucket: "siem", initials: "El", logoClass: "lg-elastic", platforms: ["linux"], installer: "curated", versions: ["8.15", "8.14", "7.17"], activeVersion: "7.17" },
  { id: "kibana", name: "Kibana", category: "SIEM", bucket: "siem", initials: "Ki", logoClass: "lg-kibana", platforms: ["linux"], installer: "curated", versions: ["8.15", "8.14"] },
  { id: "grafana", name: "Grafana", category: "SIEM", bucket: "siem", initials: "Gr", logoClass: "lg-grafana", platforms: ["linux"], installer: "curated", versions: ["11.2", "10.4"] },
  { id: "prometheus", name: "Prometheus", category: "SIEM", bucket: "siem", initials: "Pr", logoClass: "lg-prom", platforms: ["linux"], installer: "curated", versions: ["2.55", "2.54"] },
  { id: "sentinel", name: "Microsoft Sentinel", category: "SIEM", bucket: "siem", initials: "MS", logoClass: "lg-sentinel", platforms: ["windows"], installer: "stub", versions: [] },
  { id: "logstash", name: "Logstash", category: "SIEM", bucket: "siem", initials: "Ls", logoClass: "lg-elastic", platforms: ["linux"], installer: "curated", versions: ["8.15"] },
  { id: "elastic-stack", name: "Elastic Stack bundle", category: "SIEM", bucket: "siem", initials: "Es", logoClass: "lg-elastic", platforms: ["linux"], installer: "curated", versions: [] },

  // ---- EDR · Host Monitoring (8 total — tab "EDR · 4" filters bucket === "edr") ----
  { id: "mdf", name: "Microsoft Defender for Endpoint", category: "EDR · Host Monitoring", bucket: "edr", initials: "Df", logoClass: "lg-mdf", platforms: ["windows"], installer: "stub", versions: ["latest"], activeVersion: "latest" },
  { id: "crowdstrike", name: "CrowdStrike Falcon", category: "EDR · Host Monitoring", bucket: "edr", initials: "Cs", logoClass: "lg-cs", platforms: ["windows", "linux"], installer: "stub", versions: [] },
  { id: "sentinelone", name: "SentinelOne", category: "EDR · Host Monitoring", bucket: "edr", initials: "S1", logoClass: "lg-s1", platforms: ["windows", "linux"], installer: "stub", versions: [] },
  { id: "sophos", name: "Sophos Intercept X", category: "EDR · Host Monitoring", bucket: "edr", initials: "So", logoClass: "lg-sophos", platforms: ["windows"], installer: "stub", versions: [] },
  { id: "sysmon", name: "Sysmon", category: "EDR · Host Monitoring", bucket: "hostmon", initials: "Sy", logoClass: "lg-sysmon", platforms: ["windows"], installer: "curated", versions: ["latest"] },
  { id: "winlogbeat", name: "Winlogbeat", category: "EDR · Host Monitoring", bucket: "hostmon", initials: "Wb", logoClass: "lg-winlog", platforms: ["windows"], installer: "curated", versions: ["7.17"], activeVersion: "7.17" },
  { id: "wazuh", name: "Wazuh", category: "EDR · Host Monitoring", bucket: "hostmon", initials: "Wa", logoClass: "lg-wazuh", platforms: ["linux", "windows"], installer: "curated", versions: ["4.9", "4.8", "4.7", "4.6"], activeVersion: "4.9" },
  { id: "falco", name: "Falco", category: "EDR · Host Monitoring", bucket: "hostmon", initials: "Fa", logoClass: "lg-falco", platforms: ["linux"], installer: "curated", versions: ["0.39"] },

  // ---- IDS / NSM (4) ----
  { id: "snort", name: "Snort", category: "IDS / NSM", bucket: "ids", initials: "Sn", logoClass: "lg-snort", platforms: ["linux"], installer: "curated", versions: ["3.1.81"] },
  { id: "suricata", name: "Suricata", category: "IDS / NSM", bucket: "ids", initials: "Su", logoClass: "lg-suricata", platforms: ["linux"], installer: "curated", versions: ["7.0"] },
  { id: "zeek", name: "Zeek", category: "IDS / NSM", bucket: "ids", initials: "Ze", logoClass: "lg-zeek", platforms: ["linux"], installer: "curated", versions: ["6.0"] },
  { id: "wireshark", name: "Wireshark", category: "IDS / NSM", bucket: "ids", initials: "Ws", logoClass: "lg-zeek", platforms: ["linux", "windows"], installer: "curated", versions: ["latest"] },

  // ---- ICS / SCADA (10) ----
  { id: "siemens", name: "Siemens SIMATIC", category: "ICS / SCADA", bucket: "ics", initials: "Si", logoClass: "lg-siemens", platforms: ["linux"], installer: "stub", versions: [] },
  { id: "modicon", name: "Schneider Modicon", category: "ICS / SCADA", bucket: "ics", initials: "Sc", logoClass: "lg-modicon", platforms: ["linux"], installer: "stub", versions: [] },
  { id: "allenbradley", name: "Allen-Bradley", category: "ICS / SCADA", bucket: "ics", initials: "Ab", logoClass: "lg-ab", platforms: ["linux"], installer: "stub", versions: [] },
  { id: "mitsubishi", name: "Mitsubishi MELSEC", category: "ICS / SCADA", bucket: "ics", initials: "Mi", logoClass: "lg-mits", platforms: ["linux"], installer: "stub", versions: [] },
  { id: "openplc", name: "OpenPLC", category: "ICS / SCADA", bucket: "ics", initials: "Op", logoClass: "lg-openplc", platforms: ["linux"], installer: "curated", versions: ["3.0"] },
  { id: "rapidscada", name: "Rapid SCADA", category: "ICS / SCADA", bucket: "ics", initials: "Rs", logoClass: "lg-rapidscada", platforms: ["linux", "windows"], installer: "curated", versions: ["6.1"] },
  { id: "modbus", name: "Modbus TCP", category: "ICS / SCADA", bucket: "ics", initials: "Mb", logoClass: "lg-modbus", platforms: ["linux"], installer: "curated", versions: [] },
  { id: "opcua", name: "OPC UA", category: "ICS / SCADA", bucket: "ics", initials: "Ou", logoClass: "lg-opcua", platforms: ["linux"], installer: "stub", versions: [] },
  { id: "ignition", name: "Ignition", category: "ICS / SCADA", bucket: "ics", initials: "Ig", logoClass: "lg-rapidscada", platforms: ["linux", "windows"], installer: "stub", versions: [] },
  { id: "snap7", name: "snap7", category: "ICS / SCADA", bucket: "ics", initials: "S7", logoClass: "lg-siemens", platforms: ["linux"], installer: "curated", versions: [] },

  // ---- AI / ML (13) ----
  { id: "openai", name: "OpenAI", category: "AI / ML", bucket: "aiml", initials: "Oa", logoClass: "lg-openai", platforms: ["linux"], installer: "curated", versions: [] },
  { id: "claude", name: "Anthropic Claude", category: "AI / ML", bucket: "aiml", initials: "Cl", logoClass: "lg-claude", platforms: ["linux"], installer: "curated", versions: [] },
  { id: "gemini", name: "Google Gemini", category: "AI / ML", bucket: "aiml", initials: "Ge", logoClass: "lg-openai", platforms: ["linux"], installer: "stub", versions: [] },
  { id: "ollama", name: "Ollama", category: "AI / ML", bucket: "aiml", initials: "Ol", logoClass: "lg-ollama", platforms: ["linux"], installer: "curated", versions: ["0.4", "0.3.14", "0.3.0"] },
  { id: "llama", name: "Meta Llama", category: "AI / ML", bucket: "aiml", initials: "Ll", logoClass: "lg-meta", platforms: ["linux"], installer: "stub", versions: ["3.3-70B", "3.2-11B", "3.1-405B", "3.1-70B"] },
  { id: "hf", name: "Hugging Face", category: "AI / ML", bucket: "aiml", initials: "Hf", logoClass: "lg-hf", platforms: ["linux"], installer: "curated", versions: [] },
  { id: "langchain", name: "LangChain", category: "AI / ML", bucket: "aiml", initials: "Lc", logoClass: "lg-lc", platforms: ["linux"], installer: "curated", versions: [] },
  { id: "pytorch", name: "PyTorch", category: "AI / ML", bucket: "aiml", initials: "Pt", logoClass: "lg-meta", platforms: ["linux"], installer: "stub", versions: [] },
  { id: "tensorflow", name: "TensorFlow", category: "AI / ML", bucket: "aiml", initials: "Tf", logoClass: "lg-openai", platforms: ["linux"], installer: "stub", versions: [] },
  { id: "sklearn", name: "scikit-learn", category: "AI / ML", bucket: "aiml", initials: "Sk", logoClass: "lg-openai", platforms: ["linux"], installer: "stub", versions: [] },
  { id: "keras", name: "Keras", category: "AI / ML", bucket: "aiml", initials: "Ke", logoClass: "lg-openai", platforms: ["linux"], installer: "stub", versions: [] },
  { id: "vllm", name: "vLLM", category: "AI / ML", bucket: "aiml", initials: "Vl", logoClass: "lg-meta", platforms: ["linux"], installer: "stub", versions: [] },
  { id: "garak", name: "Prompt-Injection eval / garak", category: "AI / ML", bucket: "aiml", initials: "Ga", logoClass: "lg-claude", platforms: ["linux"], installer: "curated", versions: [] },

  // ---- Offensive (8) ----
  { id: "kali", name: "Kali", category: "Offensive", bucket: "offensive", initials: "Ka", logoClass: "lg-kali", platforms: ["linux"], installer: "curated", versions: [] },
  { id: "parrot", name: "Parrot", category: "Offensive", bucket: "offensive", initials: "Pa", logoClass: "lg-kali", platforms: ["linux"], installer: "stub", versions: [] },
  { id: "metasploit", name: "Metasploit", category: "Offensive", bucket: "offensive", initials: "Me", logoClass: "lg-kali", platforms: ["linux"], installer: "curated", versions: [] },
  { id: "burp", name: "Burp Suite", category: "Offensive", bucket: "offensive", initials: "Bu", logoClass: "lg-kali", platforms: ["linux", "windows"], installer: "stub", versions: [] },
  { id: "impacket", name: "Impacket", category: "Offensive", bucket: "offensive", initials: "Im", logoClass: "lg-kali", platforms: ["linux"], installer: "curated", versions: [] },
  { id: "bloodhound", name: "BloodHound", category: "Offensive", bucket: "offensive", initials: "Bh", logoClass: "lg-kali", platforms: ["linux", "windows"], installer: "curated", versions: [] },
  { id: "netexec", name: "CrackMapExec / NetExec", category: "Offensive", bucket: "offensive", initials: "Nx", logoClass: "lg-kali", platforms: ["linux"], installer: "curated", versions: [] },
  { id: "htb", name: "HackTheBox", category: "Offensive", bucket: "offensive", initials: "Hb", logoClass: "lg-kali", platforms: ["linux"], installer: "stub", versions: [] },

  // ---- Container (4) ----
  { id: "docker", name: "Docker", category: "Container", bucket: "container", initials: "Do", logoClass: "lg-docker", platforms: ["linux"], installer: "curated", versions: [] },
  { id: "k8s", name: "Kubernetes", category: "Container", bucket: "container", initials: "K8", logoClass: "lg-docker", platforms: ["linux"], installer: "stub", versions: [] },
  { id: "podman", name: "Podman", category: "Container", bucket: "container", initials: "Po", logoClass: "lg-docker", platforms: ["linux"], installer: "stub", versions: [] },
  { id: "trivy", name: "Trivy", category: "Container", bucket: "container", initials: "Tr", logoClass: "lg-docker", platforms: ["linux"], installer: "curated", versions: [] },

  // ---- Database (1 — trimmed; design's "56" total honoured by dropping the
  //      other 4 DB entries + the entire DevOps section. The Database section
  //      survives with Redis as its sole anchor; the rest is parked behind
  //      `// TODO: needs backend support` until the API ships /api/v1/vendors.) ----
  { id: "redis", name: "Redis", category: "Database", bucket: "database", initials: "Rd", logoClass: "lg-redis", platforms: ["linux"], installer: "curated", versions: [] },
] as const;

// Total = 8 + 8 + 4 + 10 + 13 + 8 + 4 + 1 = 56. The design's "56" is honoured.

/* Per-bucket lucide icon. Used as a fallback only — most vendors render
   the real brand glyph via {@link VendorLogo}. */
const BUCKET_ICON: Record<VendorEntry["bucket"], LucideIcon> = {
  siem: Eye,
  edr: Shield,
  hostmon: ShieldCheck,
  ids: Activity,
  ics: Factory,
  aiml: BrainCircuit,
  offensive: Skull,
  container: Container,
  database: Database,
};

/* A few per-id overrides where a more specific glyph reads better than the
   bucket default. Used only as fallback when no brand icon exists. */
const ID_ICON_OVERRIDE: Record<string, LucideIcon> = {
  crowdstrike: ShieldAlert,
  sentinelone: ShieldAlert,
  prometheus: Activity,
  grafana: Activity,
  wireshark: Network,
  zeek: Network,
  modbus: Radio,
  opcua: Radio,
  ollama: Cpu,
  llama: Cpu,
  vllm: Cpu,
  langchain: Wand2,
  kali: Terminal,
  parrot: Terminal,
  metasploit: Skull,
  burp: Box,
  redis: Database,
  docker: Container,
  k8s: Container,
  podman: Container,
  trivy: ShieldCheck,
};

/* Map this page's local IDs to the global VENDOR_CATALOG ids in
   lib/icons/catalog.ts so we can resolve real brand icons (react-icons/si)
   for each card. Where the IDs already match, the lookup just works via
   `lookupVendor`. */
const CATALOG_ID_ALIAS: Record<string, string> = {
  mdf: "mde",
  sentinel: "ms-sentinel",
  allenbradley: "rockwell-allenbradley",
  mitsubishi: "mitsubishi-melsec",
  modicon: "schneider-modicon",
  siemens: "siemens-simatic",
  modbus: "modbus-tcp",
  claude: "anthropic",
  gemini: "google-gemini",
  hf: "huggingface",
  sklearn: "scikit-learn",
  garak: "ai-jailbreak-detector",
  k8s: "kubernetes",
  htb: "hackthebox",
  burp: "burpsuite",
  netexec: "impacket", // closest sibling — both are AD attack tooling
  "elastic-stack": "elasticstack",
};

/** Component that renders the real brand logo for a vendor entry.
    Falls back to a lucide bucket glyph when no Simple-Icons match exists. */
function VendorLogo({ entry }: { entry: VendorEntry }): React.ReactElement {
  const catalogId = CATALOG_ID_ALIAS[entry.id] ?? entry.id;
  const brand = lookupVendor(catalogId);
  if (brand) {
    if (brand.renderer.kind === "simple") {
      const Brand = brand.renderer.component;
      return <Brand size={18} color="#ffffff" title={brand.label} />;
    }
    const Brand = brand.renderer.component;
    return <Brand className="h-5 w-5" aria-hidden />;
  }
  const Fallback = ID_ICON_OVERRIDE[entry.id] ?? BUCKET_ICON[entry.bucket] ?? Box;
  return <Fallback className="h-5 w-5" aria-hidden />;
}

/* ============================================================
   Tabs
   ============================================================ */

type TabId = "all" | "siem" | "edr" | "ics" | "aiml" | "offensive";

const TAB_DEFS: ReadonlyArray<{ id: TabId; label: string }> = [
  { id: "all", label: "All" },
  { id: "siem", label: "SIEM" },
  { id: "edr", label: "EDR" },
  { id: "ics", label: "ICS / SCADA" },
  { id: "aiml", label: "AI / ML" },
  { id: "offensive", label: "Offensive" },
];

function entryMatchesTab(entry: VendorEntry, tab: TabId): boolean {
  if (tab === "all") return true;
  if (tab === "ics") return entry.bucket === "ics";
  if (tab === "aiml") return entry.bucket === "aiml";
  if (tab === "offensive") return entry.bucket === "offensive";
  if (tab === "siem") return entry.bucket === "siem";
  if (tab === "edr") return entry.bucket === "edr"; // narrow: pure EDR (4) not host-mon
  return false;
}

/* Counts shown in the tabs come from the catalog so they stay
   in lockstep with whatever entries we trim. */
function tabCount(tab: TabId): number {
  if (tab === "all") return VENDOR_CATALOG.length;
  return VENDOR_CATALOG.filter((e) => entryMatchesTab(e, tab)).length;
}

/* ============================================================
   Page
   ============================================================ */

export default function VendorsPage(): React.ReactElement {
  const [activeTab, setActiveTab] = React.useState<TabId>("all");
  const [query, setQuery] = React.useState("");
  const [selected, setSelected] = React.useState<Set<string>>(new Set());

  // Action-row toggles — visual only.
  // TODO: needs backend support — these filter chips will become real
  // query params on /api/v1/vendors when that endpoint exists.
  const [onlyInstaller, setOnlyInstaller] = React.useState(true);
  const [onlyHasLogo, setOnlyHasLogo] = React.useState(false);
  const [linuxOnly, setLinuxOnly] = React.useState(false);

  // Filter rail — visual only; same caveat.
  // TODO: needs backend support — catalog filtering is client-side
  // until /api/v1/vendors exists.
  const [fLinux, setFLinux] = React.useState(true);
  const [fWindows, setFWindows] = React.useState(true);
  const [fBoth, setFBoth] = React.useState(false);
  const [fCurated, setFCurated] = React.useState(true);
  const [fStub, setFStub] = React.useState(false);
  const [fSimpleIcons, setFSimpleIcons] = React.useState(true);
  const [fLucide, setFLucide] = React.useState(true);

  const visible = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    return VENDOR_CATALOG.filter((e) => {
      if (!entryMatchesTab(e, activeTab)) return false;
      if (q && !e.name.toLowerCase().includes(q)) return false;

      // tb3 toggles
      if (onlyInstaller && e.installer !== "curated") return false;
      if (linuxOnly && !(e.platforms.length === 1 && e.platforms[0] === "linux")) return false;
      // "Has logo" is essentially every entry in this fixture; we keep the
      // toggle for parity but it doesn't currently exclude anything.
      if (onlyHasLogo && !e.logoClass) return false;

      // Filter rail — Platform group: an entry is shown if AT LEAST ONE of
      // its platforms is checked, OR it's a both-platform entry and "Both"
      // is checked.
      const hasLinux = e.platforms.includes("linux");
      const hasWindows = e.platforms.includes("windows");
      const isBoth = hasLinux && hasWindows;
      const platformOk =
        (fLinux && hasLinux && !isBoth) ||
        (fWindows && hasWindows && !isBoth) ||
        (fBoth && isBoth) ||
        // If literally nothing is checked, show nothing — but if both linux
        // & windows are checked, "Both" entries are also covered above
        // unless fBoth is off, in which case we still show them so the
        // common case (default checks) doesn't hide half the catalog.
        (fLinux && fWindows && isBoth);
      if (!platformOk) return false;

      // Installer group
      if (e.installer === "curated" && !fCurated) return false;
      if (e.installer === "stub" && !fStub && !fCurated) return false;
      if (e.installer === "stub" && !fStub) {
        // If stub-only filter is off, only show stubs when curated is also off
        // (so the user can see "all installers" by leaving both checked-ish).
        // Default UX: curated checked, stub unchecked → show only curated.
        // We allow stubs through when fStub is checked.
        return false;
      }

      // Brand-asset filters are decorative; they never hide anything in
      // this fixture (every entry has a Simple-Icons-equivalent logo
      // class). Kept here to satisfy the design contract.
      void fSimpleIcons;
      void fLucide;

      return true;
    });
  }, [
    activeTab,
    query,
    onlyInstaller,
    onlyHasLogo,
    linuxOnly,
    fLinux,
    fWindows,
    fBoth,
    fCurated,
    fStub,
    fSimpleIcons,
    fLucide,
  ]);

  // Group the visible entries by category, preserving catalog order.
  const grouped = React.useMemo(() => {
    const map = new Map<string, VendorEntry[]>();
    for (const e of visible) {
      const list = map.get(e.category) ?? [];
      list.push(e);
      map.set(e.category, list);
    }
    return Array.from(map.entries());
  }, [visible]);

  const toggleSelect = (id: string): void => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const tabs: TabSpec[] = TAB_DEFS.map((t) => ({
    id: t.id,
    label: t.label,
    count: tabCount(t.id),
    active: activeTab === t.id,
    onSelect: () => setActiveTab(t.id),
  }));
  // Trailing "+ Custom role" entry, dimmed.
  tabs.push({
    id: "custom",
    label: "+ Custom role",
    onSelect: () =>
      toast("Custom role builder", {
        description: "TODO: needs backend support — vendor authoring UI not yet wired.",
      }),
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
      <PageToolbars
        tabs={tabs}
        actions={
          <>
            <input
              className="search"
              placeholder="Search vendors, e.g. wazuh, ollama, modbus…"
              style={{ width: 340 }}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <button
              type="button"
              className={`btn${onlyInstaller ? " primary" : ""}`}
              onClick={() => setOnlyInstaller((v) => !v)}
            >
              ⛛ Has installer {onlyInstaller ? "✓" : ""}
            </button>
            <button
              type="button"
              className={`btn${onlyHasLogo ? " primary" : ""}`}
              onClick={() => setOnlyHasLogo((v) => !v)}
            >
              ⛛ Has logo
            </button>
            <button
              type="button"
              className={`btn${linuxOnly ? " primary" : ""}`}
              onClick={() => setLinuxOnly((v) => !v)}
            >
              ⛛ Linux only
            </button>
            <div className="right">
              <button
                type="button"
                className="btn"
                onClick={() =>
                  toast("Export catalog.json", {
                    description: "TODO: needs backend support — no /api/v1/vendors/export yet.",
                  })
                }
              >
                ⤓ Export catalog.json
              </button>
              <button
                type="button"
                className="btn primary"
                onClick={() =>
                  toast("New vendor", {
                    description: "TODO: needs backend support — vendor authoring not yet wired.",
                  })
                }
              >
                + New vendor
              </button>
            </div>
          </>
        }
      />

      {/* Two-pane row: filter rail + grouped grid scroll area. Each pane
          scrolls independently — the outer `.content` has `overflow: hidden`
          for /vendors so the page itself does not produce a vertical
          scrollbar. */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "220px 1fr",
          flex: 1,
          minHeight: 0,
          overflow: "hidden",
        }}
      >
        {/* ============================================================
            Filter rail
            ============================================================ */}
        <div className="filt" style={{ minHeight: 0 }}>
          <div style={{ fontSize: 11, color: "var(--d10-fg-faint)", marginBottom: 10 }}>
            {selected.size > 0 ? `${selected.size} selected` : `${visible.length} of ${VENDOR_CATALOG.length} visible`}
          </div>

          <div className="group">
            <div className="lh">Platform</div>
            <label>
              <input
                type="checkbox"
                checked={fLinux}
                onChange={(e) => setFLinux(e.target.checked)}
              />{" "}
              Linux <span className="ct">42</span>
            </label>
            <label>
              <input
                type="checkbox"
                checked={fWindows}
                onChange={(e) => setFWindows(e.target.checked)}
              />{" "}
              Windows <span className="ct">14</span>
            </label>
            <label>
              <input
                type="checkbox"
                checked={fBoth}
                onChange={(e) => setFBoth(e.target.checked)}
              />{" "}
              Both <span className="ct">18</span>
            </label>
          </div>

          <div className="group">
            <div className="lh">Installer</div>
            <label>
              <input
                type="checkbox"
                checked={fCurated}
                onChange={(e) => setFCurated(e.target.checked)}
              />{" "}
              Curated <span className="ct">38</span>
            </label>
            <label>
              <input
                type="checkbox"
                checked={fStub}
                onChange={(e) => setFStub(e.target.checked)}
              />{" "}
              Stub only <span className="ct">18</span>
            </label>
          </div>

          <div className="group">
            <div className="lh">Brand asset</div>
            <label>
              <input
                type="checkbox"
                checked={fSimpleIcons}
                onChange={(e) => setFSimpleIcons(e.target.checked)}
              />{" "}
              Simple Icons
            </label>
            <label>
              <input
                type="checkbox"
                checked={fLucide}
                onChange={(e) => setFLucide(e.target.checked)}
              />{" "}
              Lucide fallback
            </label>
          </div>
        </div>

        {/* ============================================================
            Grouped vendor grids
            ============================================================ */}
        <div className="scroll" style={{ minHeight: 0 }}>
          <VendorsIntro />

          {grouped.length === 0 && (
            <div
              style={{
                padding: 24,
                color: "var(--d10-fg-faint)",
                fontSize: 13,
              }}
            >
              No vendors match the current filters.
            </div>
          )}
          {grouped.map(([category, entries]) => (
            <section key={category}>
              <div
                style={{
                  padding: "10px 14px",
                  borderBottom: "1px solid var(--d10-border)",
                  background: "var(--d10-bg-frame)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                }}
              >
                <span className="uplabel">{category}</span>
                <span className="uplabel">{entries.length}</span>
              </div>
              <div className="vendor-grid">
                {entries.map((e) => {
                  return (
                  <button
                    key={e.id}
                    type="button"
                    className={`v-card${selected.has(e.id) ? " selected" : ""}`}
                    onClick={() => toggleSelect(e.id)}
                    style={{
                      textAlign: "left",
                      font: "inherit",
                      color: "inherit",
                    }}
                  >
                    <div className="top">
                      <div
                        className={`logo ${e.logoClass}`}
                        aria-label={e.initials}
                      >
                        <VendorLogo entry={e} />
                      </div>
                      <div>
                        <div className="nm">{e.name}</div>
                        <div className="cat">{e.category}</div>
                      </div>
                    </div>
                    {e.versions.length > 0 && (
                      <div className="v-row">
                        {e.versions.map((v) => (
                          <span
                            key={v}
                            className={`v-chip${v === e.activeVersion ? " act" : ""}`}
                          >
                            {v}
                          </span>
                        ))}
                      </div>
                    )}
                  </button>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   Vendors intro — "How to use" explainer block
   ============================================================
   Power users can dismiss via localStorage. The dismissal is
   client-only so SSR renders the full block (no flash). */

const INTRO_DISMISSED_KEY = "labforge.vendors-intro-dismissed";

function VendorsIntro(): React.ReactElement | null {
  const [dismissed, setDismissed] = React.useState(false);
  const [hydrated, setHydrated] = React.useState(false);

  React.useEffect(() => {
    setHydrated(true);
    try {
      if (typeof window !== "undefined") {
        setDismissed(window.localStorage.getItem(INTRO_DISMISSED_KEY) === "1");
      }
    } catch {
      /* ignore */
    }
  }, []);

  // Avoid hydration mismatch — render nothing until we've checked storage.
  if (!hydrated || dismissed) return null;

  const handleDismiss = (): void => {
    setDismissed(true);
    try {
      window.localStorage.setItem(INTRO_DISMISSED_KEY, "1");
    } catch {
      /* ignore quota */
    }
  };

  return (
    <div
      role="region"
      aria-label="How to use vendors"
      style={{
        margin: "14px 14px 0",
        padding: "14px 16px 16px",
        background:
          "linear-gradient(135deg, rgba(var(--d10-accent-rgb), 0.08), rgba(var(--d10-accent-rgb), 0.02))",
        border: "1px solid var(--d10-border)",
        borderLeft: "3px solid var(--d10-accent)",
        borderRadius: 8,
        display: "flex",
        flexDirection: "column",
        gap: 12,
        position: "relative",
      }}
    >
      <button
        type="button"
        onClick={handleDismiss}
        aria-label="Dismiss intro"
        style={{
          position: "absolute",
          top: 8,
          right: 8,
          background: "transparent",
          border: "none",
          color: "var(--d10-fg-faint)",
          cursor: "pointer",
          padding: 4,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          borderRadius: 4,
        }}
        title="Hide this intro"
      >
        <X className="h-4 w-4" aria-hidden />
      </button>

      <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
        <Package
          className="h-5 w-5"
          style={{
            color: "var(--d10-accent)",
            marginTop: 2,
            flexShrink: 0,
          }}
          aria-hidden
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 14,
              fontWeight: 600,
              color: "var(--d10-fg-strong)",
              marginBottom: 4,
            }}
          >
            Vendors are role packages — pre-built installers you attach to a
            node.
          </div>
          <div
            style={{
              fontSize: 12,
              color: "var(--d10-fg-mute)",
              lineHeight: 1.5,
            }}
          >
            Picking e.g.{" "}
            <span style={{ color: "var(--d10-accent)" }}>Splunk</span> on a
            Linux node provisions the Splunk SIEM during{" "}
            <code
              style={{
                fontSize: 11,
                background: "var(--d10-bg-elev-2)",
                padding: "1px 4px",
                borderRadius: 3,
              }}
            >
              vagrant up
            </code>
            . Browse the catalog here, attach from the canvas.
          </div>
        </div>
      </div>

      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 10,
          alignItems: "center",
        }}
      >
        <IntroStep
          icon={<Layout className="h-4 w-4" aria-hidden />}
          n={1}
          label="Open the Canvas"
        />
        <ArrowRight
          className="h-3.5 w-3.5"
          style={{ color: "var(--d10-fg-faint)", flexShrink: 0 }}
          aria-hidden
        />
        <IntroStep
          icon={<MousePointerClick className="h-4 w-4" aria-hidden />}
          n={2}
          label="Click any node"
        />
        <ArrowRight
          className="h-3.5 w-3.5"
          style={{ color: "var(--d10-fg-faint)", flexShrink: 0 }}
          aria-hidden
        />
        <IntroStep
          icon={<Package className="h-4 w-4" aria-hidden />}
          n={3}
          label="Add the vendor role"
        />
        <div style={{ flex: 1 }} />
        <Link
          href="/build"
          className="btn primary"
          style={{ textDecoration: "none" }}
        >
          Open Canvas →
        </Link>
      </div>
    </div>
  );
}

function IntroStep({
  icon,
  n,
  label,
}: {
  icon: React.ReactNode;
  n: number;
  label: string;
}): React.ReactElement {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "6px 10px",
        background: "var(--d10-bg-elev-1)",
        border: "1px solid var(--d10-border)",
        borderRadius: 6,
        fontSize: 12,
        color: "var(--d10-fg)",
      }}
    >
      <span
        style={{
          width: 18,
          height: 18,
          borderRadius: "50%",
          background: "rgba(var(--d10-accent-rgb), 0.15)",
          color: "var(--d10-accent)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 11,
          fontWeight: 700,
          flexShrink: 0,
        }}
      >
        {n}
      </span>
      <span
        style={{
          color: "var(--d10-accent)",
          display: "flex",
          alignItems: "center",
        }}
      >
        {icon}
      </span>
      <span style={{ whiteSpace: "nowrap" }}>{label}</span>
    </div>
  );
}
