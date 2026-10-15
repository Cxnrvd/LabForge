import * as React from "react";
import {
  SiAlpinelinux,
  SiAnsible,
  SiAnthropic,
  SiApache,
  SiAuth0,
  SiBurpsuite,
  SiCentos,
  SiCisco,
  SiClickhouse,
  SiCloudflare,
  SiDebian,
  SiDocker,
  SiElastic,
  SiElasticstack,
  SiFalco,
  SiGithub,
  SiGitlab,
  SiGoogle,
  SiGooglegemini,
  SiGrafana,
  SiHackthebox,
  SiHuggingface,
  SiInfluxdb,
  SiJenkins,
  SiKalilinux,
  SiKeras,
  SiKeycloak,
  SiKibana,
  SiKubernetes,
  SiLangchain,
  SiLogstash,
  SiMeta,
  SiMetasploit,
  SiMitsubishi,
  SiMongodb,
  SiMysql,
  SiNeo4j,
  SiNginx,
  SiOkta,
  SiOllama,
  SiOpenai,
  SiOpnsense,
  SiPfsense,
  SiPodman,
  SiPostgresql,
  SiPrometheus,
  SiPytorch,
  SiRedis,
  SiRockwellautomation,
  SiSchneiderelectric,
  SiScikitlearn,
  SiSiemens,
  SiSnort,
  SiSplunk,
  SiTensorflow,
  SiTerraform,
  SiTrivy,
  SiTryhackme,
  SiUbuntu,
  SiVault,
  SiWireshark,
} from "@icons-pack/react-simple-icons";
import {
  Activity,
  Box,
  BrainCircuit,
  Camera as CameraIcon,
  Cog,
  Cpu,
  Eye,
  Factory,
  Network,
  Radio,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Squirrel,
  Wand2,
  Workflow,
  type LucideIcon,
} from "lucide-react";

export type IconCategory =
  | "SIEM"
  | "EDR"
  | "Host Monitoring"
  | "IDS/NSM"
  | "Web Server"
  | "Database"
  | "Container"
  | "DevOps"
  | "Identity"
  | "Network"
  | "Offensive"
  | "OS"
  | "ICS / SCADA"
  | "AI / ML"
  | "Camera / IoT"
  | "Observability";

type SimpleIconComponent = React.ComponentType<{
  color?: string;
  size?: number | string;
  title?: string;
  className?: string;
}>;

type IconRenderer =
  | { kind: "simple"; component: SimpleIconComponent }
  | { kind: "lucide"; component: LucideIcon };

export interface VendorEntry {
  id: string;
  label: string;
  category: IconCategory;
  description: string;
  color: string;
  renderer: IconRenderer;
  /** Optional aliases users might type in search. */
  aliases?: string[];
  /** Selectable versions for this product, most recent first. */
  versions?: string[];
}

/** Parse a stored role string of form `id@version` into its parts. */
export function parseRole(role: string): { id: string; version: string | null } {
  const idx = role.indexOf("@");
  if (idx < 0) return { id: role, version: null };
  return { id: role.slice(0, idx), version: role.slice(idx + 1) };
}

export function encodeRole(id: string, version: string | null | undefined): string {
  return version ? `${id}@${version}` : id;
}

const si = (component: SimpleIconComponent): IconRenderer => ({
  kind: "simple",
  component,
});
const lu = (component: LucideIcon): IconRenderer => ({
  kind: "lucide",
  component,
});

export const VENDOR_CATALOG: VendorEntry[] = [
  // SIEM / Observability
  {
    id: "splunk",
    label: "Splunk Enterprise",
    category: "SIEM",
    description: "Log search and SIEM platform",
    color: "#000000",
    renderer: si(SiSplunk),
    aliases: ["splunk-enterprise", "splunk-uf-receiver"],
    versions: ["9.3.0", "9.2.2", "9.1.5", "8.2.x"],
  },
  {
    id: "elastic",
    label: "Elastic",
    category: "SIEM",
    description: "Elastic Security / ELK stack",
    color: "#005571",
    renderer: si(SiElastic),
    aliases: ["elk", "elasticsearch"],
    versions: ["8.15.0", "8.14.3", "8.13.4", "7.17.x"],
  },
  {
    id: "elasticstack",
    label: "Elastic Stack",
    category: "SIEM",
    description: "Full ELK observability stack",
    color: "#005571",
    renderer: si(SiElasticstack),
    aliases: ["elk-stack"],
  },
  {
    id: "kibana",
    label: "Kibana",
    category: "SIEM",
    description: "Elastic visualisation and dashboards",
    color: "#F04E98",
    renderer: si(SiKibana),
  },
  {
    id: "logstash",
    label: "Logstash",
    category: "SIEM",
    description: "Log ingest pipeline",
    color: "#005571",
    renderer: si(SiLogstash),
  },
  {
    id: "grafana",
    label: "Grafana",
    category: "SIEM",
    description: "Time-series dashboards",
    color: "#F46800",
    renderer: si(SiGrafana),
    versions: ["11.2.0", "11.0.0", "10.4.5", "9.5.x"],
  },
  {
    id: "prometheus",
    label: "Prometheus",
    category: "SIEM",
    description: "Metrics scraper and TSDB",
    color: "#E6522C",
    renderer: si(SiPrometheus),
  },
  {
    id: "ms-sentinel",
    label: "Microsoft Sentinel",
    category: "SIEM",
    description: "Cloud-native SIEM/SOAR",
    color: "#0078D4",
    renderer: lu(Eye),
    aliases: ["azure-sentinel", "sentinel"],
  },

  // EDR / AV
  {
    id: "mde",
    label: "Microsoft Defender for Endpoint",
    category: "EDR",
    description: "Microsoft enterprise EDR",
    color: "#0078D4",
    renderer: lu(Shield),
    aliases: ["defender", "msdefender", "microsoft-defender"],
    versions: ["P2-2024.09", "P2-2024.06", "P1-2024.04"],
  },
  {
    id: "crowdstrike",
    label: "CrowdStrike Falcon",
    category: "EDR",
    description: "CrowdStrike Falcon EDR",
    color: "#FA0F00",
    renderer: lu(ShieldAlert),
    aliases: ["falcon"],
  },
  {
    id: "sentinelone",
    label: "SentinelOne",
    category: "EDR",
    description: "SentinelOne Singularity agent",
    color: "#6B0AEA",
    renderer: lu(Shield),
    aliases: ["s1"],
  },
  {
    id: "sophos",
    label: "Sophos Intercept X",
    category: "EDR",
    description: "Sophos endpoint protection",
    color: "#0a5e9c",
    renderer: lu(Shield),
  },

  // Host monitoring
  {
    id: "sysmon",
    label: "Sysmon",
    category: "Host Monitoring",
    description: "Sysinternals system activity monitor",
    color: "#7E22CE",
    renderer: lu(Eye),
  },
  {
    id: "winlogbeat",
    label: "Winlogbeat",
    category: "Host Monitoring",
    description: "Elastic Windows event log shipper",
    color: "#005571",
    renderer: si(SiElastic),
    aliases: ["beats"],
  },
  {
    id: "wazuh",
    label: "Wazuh",
    category: "Host Monitoring",
    description: "Open-source XDR/SIEM agent",
    color: "#005baa",
    renderer: lu(ShieldCheck),
    versions: ["4.9.0", "4.8.2", "4.7.5", "4.6.0"],
  },
  {
    id: "ossec",
    label: "OSSEC",
    category: "Host Monitoring",
    description: "Host intrusion detection",
    color: "#0066b3",
    renderer: lu(Shield),
  },
  {
    id: "falco",
    label: "Falco",
    category: "Host Monitoring",
    description: "Runtime kernel-event detection",
    color: "#00B4A0",
    renderer: si(SiFalco),
  },

  // IDS / NSM
  {
    id: "snort",
    label: "Snort",
    category: "IDS/NSM",
    description: "Cisco Snort IDS/IPS",
    color: "#FF1F1F",
    renderer: si(SiSnort),
  },
  {
    id: "suricata",
    label: "Suricata",
    category: "IDS/NSM",
    description: "Multi-threaded IDS/IPS",
    color: "#E74C3C",
    renderer: lu(Squirrel),
  },
  {
    id: "zeek",
    label: "Zeek",
    category: "IDS/NSM",
    description: "Bro/Zeek network analysis framework",
    color: "#F39200",
    renderer: lu(Activity),
    aliases: ["bro"],
  },
  {
    id: "wireshark",
    label: "Wireshark",
    category: "IDS/NSM",
    description: "Packet analyser",
    color: "#1679A7",
    renderer: si(SiWireshark),
  },

  // Web servers
  {
    id: "apache",
    label: "Apache HTTP Server",
    category: "Web Server",
    description: "Apache 2 web server",
    color: "#D22128",
    renderer: si(SiApache),
  },
  {
    id: "nginx",
    label: "nginx",
    category: "Web Server",
    description: "Reverse proxy / web server",
    color: "#009639",
    renderer: si(SiNginx),
  },

  // Databases
  {
    id: "mysql",
    label: "MySQL",
    category: "Database",
    description: "MySQL relational database",
    color: "#4479A1",
    renderer: si(SiMysql),
  },
  {
    id: "postgresql",
    label: "PostgreSQL",
    category: "Database",
    description: "PostgreSQL relational database",
    color: "#4169E1",
    renderer: si(SiPostgresql),
    aliases: ["postgres"],
  },
  {
    id: "mssql",
    label: "Microsoft SQL Server",
    category: "Database",
    description: "Microsoft SQL Server",
    color: "#CC2927",
    renderer: lu(Box),
    aliases: ["sql-server"],
  },
  {
    id: "mongodb",
    label: "MongoDB",
    category: "Database",
    description: "Document database",
    color: "#47A248",
    renderer: si(SiMongodb),
  },
  {
    id: "redis",
    label: "Redis",
    category: "Database",
    description: "In-memory data store",
    color: "#DC382D",
    renderer: si(SiRedis),
  },

  // Containers
  {
    id: "docker",
    label: "Docker",
    category: "Container",
    description: "Container runtime",
    color: "#2496ED",
    renderer: si(SiDocker),
  },
  {
    id: "kubernetes",
    label: "Kubernetes",
    category: "Container",
    description: "Container orchestrator",
    color: "#326CE5",
    renderer: si(SiKubernetes),
    aliases: ["k8s"],
  },
  {
    id: "podman",
    label: "Podman",
    category: "Container",
    description: "Daemonless container engine",
    color: "#892CA0",
    renderer: si(SiPodman),
  },
  {
    id: "trivy",
    label: "Trivy",
    category: "Container",
    description: "Container vulnerability scanner",
    color: "#1904DA",
    renderer: si(SiTrivy),
  },

  // DevOps / SCM
  {
    id: "github",
    label: "GitHub",
    category: "DevOps",
    description: "Source control hosting",
    color: "#181717",
    renderer: si(SiGithub),
  },
  {
    id: "gitlab",
    label: "GitLab",
    category: "DevOps",
    description: "Self-hosted GitLab",
    color: "#FC6D26",
    renderer: si(SiGitlab),
  },
  {
    id: "jenkins",
    label: "Jenkins",
    category: "DevOps",
    description: "CI/CD orchestrator",
    color: "#D24939",
    renderer: si(SiJenkins),
  },
  {
    id: "ansible",
    label: "Ansible",
    category: "DevOps",
    description: "Config management",
    color: "#EE0000",
    renderer: si(SiAnsible),
  },
  {
    id: "terraform",
    label: "Terraform",
    category: "DevOps",
    description: "Infra-as-code",
    color: "#7B42BC",
    renderer: si(SiTerraform),
  },

  // Identity / secrets
  {
    id: "active-directory",
    label: "Active Directory",
    category: "Identity",
    description: "Microsoft AD DS",
    color: "#0078D4",
    renderer: lu(Shield),
    aliases: ["ad-domain-services", "ad", "addc"],
  },
  {
    id: "keycloak",
    label: "Keycloak",
    category: "Identity",
    description: "Open-source identity provider",
    color: "#4D4D4D",
    renderer: si(SiKeycloak),
  },
  {
    id: "okta",
    label: "Okta",
    category: "Identity",
    description: "Hosted identity provider",
    color: "#007DC1",
    renderer: si(SiOkta),
  },
  {
    id: "auth0",
    label: "Auth0",
    category: "Identity",
    description: "Auth-as-a-service",
    color: "#EB5424",
    renderer: si(SiAuth0),
  },
  {
    id: "vault",
    label: "HashiCorp Vault",
    category: "Identity",
    description: "Secrets management",
    color: "#FFEC6E",
    renderer: si(SiVault),
  },

  // Network
  {
    id: "cisco",
    label: "Cisco IOS",
    category: "Network",
    description: "Cisco routing/switching",
    color: "#1BA0D7",
    renderer: si(SiCisco),
  },
  {
    id: "pfsense",
    label: "pfSense",
    category: "Network",
    description: "FreeBSD-based firewall",
    color: "#212121",
    renderer: si(SiPfsense),
  },
  {
    id: "opnsense",
    label: "OPNsense",
    category: "Network",
    description: "OPNsense firewall",
    color: "#D94F00",
    renderer: si(SiOpnsense),
  },
  {
    id: "frr",
    label: "FRRouting",
    category: "Network",
    description: "OSPF / BGP routing suite",
    color: "#EF4136",
    renderer: lu(Network),
    aliases: ["ospf", "bgp"],
  },

  // Offensive
  {
    id: "kali",
    label: "Kali Linux",
    category: "Offensive",
    description: "Offensive security distro",
    color: "#557C94",
    renderer: si(SiKalilinux),
    aliases: ["kali-rolling"],
  },
  {
    id: "metasploit",
    label: "Metasploit",
    category: "Offensive",
    description: "Exploitation framework",
    color: "#2596CD",
    renderer: si(SiMetasploit),
  },
  {
    id: "burpsuite",
    label: "Burp Suite",
    category: "Offensive",
    description: "Web pentest proxy",
    color: "#FF6633",
    renderer: si(SiBurpsuite),
    aliases: ["burp"],
  },
  {
    id: "impacket",
    label: "Impacket",
    category: "Offensive",
    description: "Python network protocol toolkit",
    color: "#3776AB",
    renderer: lu(ShieldAlert),
  },
  {
    id: "bloodhound",
    label: "BloodHound",
    category: "Offensive",
    description: "AD attack-path mapper",
    color: "#7A1F1F",
    renderer: lu(Activity),
  },
  {
    id: "hackthebox",
    label: "Hack The Box",
    category: "Offensive",
    description: "HTB-style scenario",
    color: "#9FEF00",
    renderer: si(SiHackthebox),
    aliases: ["htb"],
  },
  {
    id: "tryhackme",
    label: "TryHackMe",
    category: "Offensive",
    description: "THM-style scenario",
    color: "#212C42",
    renderer: si(SiTryhackme),
    aliases: ["thm"],
  },

  // OS
  {
    id: "ubuntu",
    label: "Ubuntu",
    category: "OS",
    description: "Ubuntu Linux",
    color: "#E95420",
    renderer: si(SiUbuntu),
  },
  {
    id: "debian",
    label: "Debian",
    category: "OS",
    description: "Debian Linux",
    color: "#A81D33",
    renderer: si(SiDebian),
  },
  {
    id: "centos",
    label: "CentOS",
    category: "OS",
    description: "CentOS Stream",
    color: "#262577",
    renderer: si(SiCentos),
  },
  {
    id: "alpine",
    label: "Alpine Linux",
    category: "OS",
    description: "Musl-based minimal Linux",
    color: "#0D597F",
    renderer: si(SiAlpinelinux),
    aliases: ["alpinelinux"],
  },
  {
    id: "windows",
    label: "Windows",
    category: "OS",
    description: "Microsoft Windows",
    color: "#0078D4",
    renderer: lu(Box),
    aliases: ["windows-10", "windows-11", "windows-server"],
    versions: ["11 24H2", "11 23H2", "10 22H2", "Server 2022", "Server 2019"],
  },

  // ============================================================ ICS / SCADA
  {
    id: "siemens-simatic",
    label: "Siemens SIMATIC",
    category: "ICS / SCADA",
    description: "S7-1200 / S7-1500 PLC family",
    color: "#009999",
    renderer: si(SiSiemens),
    aliases: ["s7-1500", "s7-1200", "simatic"],
    versions: ["TIA Portal V19", "TIA Portal V18", "TIA Portal V17"],
  },
  {
    id: "schneider-modicon",
    label: "Schneider Modicon",
    category: "ICS / SCADA",
    description: "Schneider Electric M580/M340 PLCs",
    color: "#3DCD58",
    renderer: si(SiSchneiderelectric),
    aliases: ["modicon", "schneider"],
    versions: ["EcoStruxure 15.x", "EcoStruxure 14.x"],
  },
  {
    id: "rockwell-allenbradley",
    label: "Rockwell Allen-Bradley",
    category: "ICS / SCADA",
    description: "ControlLogix / CompactLogix PLCs",
    color: "#CC0000",
    renderer: si(SiRockwellautomation),
    aliases: ["controllogix", "compactlogix", "rockwell"],
    versions: ["Studio 5000 v36", "v35", "v34"],
  },
  {
    id: "mitsubishi-melsec",
    label: "Mitsubishi MELSEC",
    category: "ICS / SCADA",
    description: "MELSEC iQ-R / iQ-F PLC family",
    color: "#E60012",
    renderer: si(SiMitsubishi),
    versions: ["GX Works3 1.090", "1.085"],
  },
  {
    id: "openplc",
    label: "OpenPLC",
    category: "ICS / SCADA",
    description: "Open-source IEC 61131-3 PLC runtime",
    color: "#FF6F00",
    renderer: lu(Cog),
    versions: ["v3", "v2"],
  },
  {
    id: "rapidscada",
    label: "Rapid SCADA",
    category: "ICS / SCADA",
    description: "Open-source SCADA HMI",
    color: "#00897B",
    renderer: lu(Workflow),
    versions: ["6.1", "6.0", "5.8"],
  },
  {
    id: "modbus-tcp",
    label: "Modbus TCP",
    category: "ICS / SCADA",
    description: "Industrial fieldbus protocol",
    color: "#1565C0",
    renderer: lu(Radio),
    aliases: ["modbus", "modbus-master"],
  },
  {
    id: "opcua",
    label: "OPC UA",
    category: "ICS / SCADA",
    description: "OPC Unified Architecture",
    color: "#5C6BC0",
    renderer: lu(Workflow),
    aliases: ["opc-ua"],
  },
  {
    id: "snap7",
    label: "snap7 Server",
    category: "ICS / SCADA",
    description: "Siemens S7 emulator for testing",
    color: "#009999",
    renderer: lu(Cpu),
  },
  {
    id: "ignition",
    label: "Ignition SCADA",
    category: "ICS / SCADA",
    description: "Inductive Automation Ignition",
    color: "#F37021",
    renderer: lu(Factory),
    versions: ["8.1.40", "8.1.35", "8.1.30"],
  },

  // ============================================================== AI / ML
  {
    id: "openai",
    label: "OpenAI API",
    category: "AI / ML",
    description: "GPT-4o / o-series API endpoint",
    color: "#412991",
    renderer: si(SiOpenai),
    aliases: ["gpt-4", "chatgpt"],
    versions: ["o1-preview", "gpt-4o", "gpt-4o-mini", "gpt-3.5-turbo"],
  },
  {
    id: "anthropic",
    label: "Anthropic Claude API",
    category: "AI / ML",
    description: "Claude 3.5 family API",
    color: "#D97757",
    renderer: si(SiAnthropic),
    aliases: ["claude"],
    versions: ["claude-3-5-sonnet", "claude-3-opus", "claude-3-haiku"],
  },
  {
    id: "google-gemini",
    label: "Google Gemini API",
    category: "AI / ML",
    description: "Gemini Pro / Flash family",
    color: "#4285F4",
    renderer: si(SiGooglegemini),
    aliases: ["gemini"],
    versions: ["1.5-pro", "1.5-flash", "1.0-pro"],
  },
  {
    id: "ollama",
    label: "Ollama",
    category: "AI / ML",
    description: "Local LLM runner",
    color: "#000000",
    renderer: si(SiOllama),
    versions: ["0.4.0", "0.3.14", "0.3.0"],
  },
  {
    id: "llama",
    label: "Meta Llama",
    category: "AI / ML",
    description: "Open-weight Llama family",
    color: "#0668E1",
    renderer: si(SiMeta),
    aliases: ["llama3", "meta-llama"],
    versions: ["3.3-70B", "3.2-11B", "3.1-405B", "3.1-70B", "3-8B"],
  },
  {
    id: "huggingface",
    label: "Hugging Face",
    category: "AI / ML",
    description: "Model hub / inference endpoints",
    color: "#FFD21E",
    renderer: si(SiHuggingface),
    aliases: ["hf"],
  },
  {
    id: "langchain",
    label: "LangChain",
    category: "AI / ML",
    description: "LLM application framework",
    color: "#1C3C3C",
    renderer: si(SiLangchain),
    versions: ["0.3.x", "0.2.x", "0.1.x"],
  },
  {
    id: "pytorch",
    label: "PyTorch",
    category: "AI / ML",
    description: "Deep learning framework",
    color: "#EE4C2C",
    renderer: si(SiPytorch),
    versions: ["2.5", "2.4", "2.3"],
  },
  {
    id: "tensorflow",
    label: "TensorFlow",
    category: "AI / ML",
    description: "Google ML framework",
    color: "#FF6F00",
    renderer: si(SiTensorflow),
    versions: ["2.18", "2.17", "2.16"],
  },
  {
    id: "scikit-learn",
    label: "scikit-learn",
    category: "AI / ML",
    description: "Classical ML toolkit",
    color: "#F7931E",
    renderer: si(SiScikitlearn),
    versions: ["1.5.x", "1.4.x"],
  },
  {
    id: "keras",
    label: "Keras",
    category: "AI / ML",
    description: "High-level neural-net API",
    color: "#D00000",
    renderer: si(SiKeras),
    versions: ["3.6", "3.5"],
  },
  {
    id: "vllm",
    label: "vLLM",
    category: "AI / ML",
    description: "High-throughput LLM inference",
    color: "#7C3AED",
    renderer: lu(Wand2),
    versions: ["0.6.x", "0.5.x"],
  },
  {
    id: "ai-jailbreak-detector",
    label: "Prompt-Injection Detector",
    category: "AI / ML",
    description: "LLM red-team eval suite",
    color: "#DC2626",
    renderer: lu(BrainCircuit),
    aliases: ["garak", "prompt-injection"],
  },

  // ====================================================== Camera / IoT
  {
    id: "mediamtx",
    label: "MediaMTX",
    category: "Camera / IoT",
    description: "RTSP / RTMP / WebRTC server",
    color: "#1D4ED8",
    renderer: lu(CameraIcon),
    aliases: ["rtsp-simple-server", "rtsp-server"],
    versions: ["1.9.x", "1.8.x"],
  },
  {
    id: "motion",
    label: "Motion",
    category: "Camera / IoT",
    description: "Linux motion-detection CCTV daemon",
    color: "#0EA5E9",
    renderer: lu(CameraIcon),
    versions: ["4.6.x", "4.5.x"],
  },
  {
    id: "frigate",
    label: "Frigate NVR",
    category: "Camera / IoT",
    description: "ML-aware home/SMB NVR",
    color: "#06B6D4",
    renderer: lu(CameraIcon),
    versions: ["0.14", "0.13"],
  },
  {
    id: "hikvision",
    label: "Hikvision",
    category: "Camera / IoT",
    description: "Hikvision IP camera firmware",
    color: "#D60000",
    renderer: lu(CameraIcon),
  },
  {
    id: "dahua",
    label: "Dahua",
    category: "Camera / IoT",
    description: "Dahua IP camera firmware",
    color: "#005BAA",
    renderer: lu(CameraIcon),
  },
  {
    id: "mqtt",
    label: "MQTT Broker",
    category: "Camera / IoT",
    description: "Mosquitto / EMQX MQTT broker",
    color: "#660066",
    renderer: lu(Radio),
    aliases: ["mosquitto", "emqx"],
  },

  // ====================================================== Observability
  {
    id: "influxdb",
    label: "InfluxDB",
    category: "Observability",
    description: "Time-series database",
    color: "#22ADF6",
    renderer: si(SiInfluxdb),
    versions: ["3.0", "2.7", "1.11"],
  },
  {
    id: "clickhouse",
    label: "ClickHouse",
    category: "Observability",
    description: "Column store analytics DB",
    color: "#FFCC01",
    renderer: si(SiClickhouse),
    versions: ["24.10", "24.8"],
  },
  {
    id: "neo4j",
    label: "Neo4j",
    category: "Observability",
    description: "Graph DB (BloodHound backend)",
    color: "#008CC1",
    renderer: si(SiNeo4j),
    versions: ["5.x", "4.4"],
  },
  {
    id: "cloudflare",
    label: "Cloudflare",
    category: "Observability",
    description: "Edge / WAF",
    color: "#F38020",
    renderer: si(SiCloudflare),
  },
  {
    id: "google-cloud",
    label: "Google Cloud",
    category: "Observability",
    description: "GCP project / VPC",
    color: "#4285F4",
    renderer: si(SiGoogle),
    aliases: ["gcp"],
  },
];

export const CATEGORY_ORDER: IconCategory[] = [
  "SIEM",
  "EDR",
  "Host Monitoring",
  "IDS/NSM",
  "ICS / SCADA",
  "AI / ML",
  "Camera / IoT",
  "Web Server",
  "Database",
  "Container",
  "DevOps",
  "Identity",
  "Network",
  "Offensive",
  "Observability",
  "OS",
];

const ID_INDEX = new Map<string, VendorEntry>();
for (const entry of VENDOR_CATALOG) {
  ID_INDEX.set(entry.id, entry);
  for (const alias of entry.aliases ?? []) {
    if (!ID_INDEX.has(alias)) ID_INDEX.set(alias, entry);
  }
}

export function lookupVendor(id: string): VendorEntry | undefined {
  const { id: bareId } = parseRole(id);
  return (
    ID_INDEX.get(bareId) ??
    ID_INDEX.get(bareId.toLowerCase()) ??
    ID_INDEX.get(id) ??
    ID_INDEX.get(id.toLowerCase())
  );
}

export function searchVendors(query: string): VendorEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return VENDOR_CATALOG;
  return VENDOR_CATALOG.filter((entry) => {
    const haystack = [
      entry.id,
      entry.label,
      entry.category,
      entry.description,
      ...(entry.aliases ?? []),
    ]
      .join(" ")
      .toLowerCase();
    return haystack.includes(q);
  });
}

export function vendorsByCategory(): Record<IconCategory, VendorEntry[]> {
  const grouped = Object.fromEntries(
    CATEGORY_ORDER.map((c) => [c, [] as VendorEntry[]]),
  ) as Record<IconCategory, VendorEntry[]>;
  for (const entry of VENDOR_CATALOG) {
    grouped[entry.category].push(entry);
  }
  return grouped;
}
