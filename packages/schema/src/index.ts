import { z } from "zod";

export const NodeType = z.enum([
  "workstation",
  "server",
  "domain_controller",
  "router",
  "firewall",
  "attacker",
  "target",
  "database",
  "ics_plc",
  "ics_hmi",
  "camera",
  "internet",
]);
export type NodeType = z.infer<typeof NodeType>;

export const OsType = z.enum([
  // Windows desktop
  "windows_10",
  "windows_11",
  // Windows server
  "windows_server_2019",
  "windows_server_2022",
  // Mainstream Linux server
  "ubuntu_2204",
  "ubuntu_2404",
  "debian_12",
  "centos_stream_9",
  "rhel_9",
  "fedora_40",
  "opensuse_tumbleweed",
  "arch_rolling",
  "alpine_latest",
  // BSDs
  "freebsd_14",
  // macOS
  "macos_sonoma",
  "macos_sequoia",
  // Offensive / privacy
  "kali_rolling",
  "parrot_security",
  "blackarch_rolling",
  "tails_6",
  "whonix_17",
  // Router / switch OS
  "openwrt_23",
  "vyos_1_4",
  "routeros_7",
  "cisco_ios_xe",
  "juniper_junos_22",
  // Firewall appliance OS
  "pfsense_2_7",
  "opnsense_24",
  "fortios_7",
  "panos_11",
  "sophos_xg_19",
  // Embedded / ICS
  "vxworks_7",
  "siemens_simatic",
  "schneider_modicon",
  "raspbian_12",
  "qnx_neutrino",
  // Camera
  "ip_camera_firmware",
]);
export type OsType = z.infer<typeof OsType>;

export const Protocol = z.enum([
  "tcp",
  "udp",
  "icmp",
  "http",
  "https",
  "ssh",
  "rdp",
  "smb",
  "ldap",
  "kerberos",
  "modbus",
  "dnp3",
  "opcua",
  "rtsp",
  "mqtt",
  "custom",
]);
export type Protocol = z.infer<typeof Protocol>;

export const Provider = z.enum(["virtualbox", "vmware", "libvirt", "docker"]);
export type Provider = z.infer<typeof Provider>;

/**
 * The 14 MITRE ATT&CK enterprise tactics. Used to tag nodes and edges
 * by attack phase so the canvas can colour or filter by intent. The set
 * here is a closed enum because we colour-code each one in the UI.
 */
export const AttackTactic = z.enum([
  "reconnaissance",
  "resource_development",
  "initial_access",
  "execution",
  "persistence",
  "privilege_escalation",
  "defense_evasion",
  "credential_access",
  "discovery",
  "lateral_movement",
  "collection",
  "command_and_control",
  "exfiltration",
  "impact",
]);
export type AttackTactic = z.infer<typeof AttackTactic>;

const techniqueRegex = /^T\d{4}(\.\d{3})?$/;

export const AttackTag = z.object({
  tactic: AttackTactic,
  technique: z
    .string()
    .max(16)
    .regex(techniqueRegex, "Technique must look like T1234 or T1234.001")
    .nullable()
    .optional(),
  note: z.string().max(256).nullable().optional(),
});
export type AttackTag = z.infer<typeof AttackTag>;

export const ATTACK_TACTIC_LABELS: Record<AttackTactic, string> = {
  reconnaissance: "Reconnaissance",
  resource_development: "Resource Development",
  initial_access: "Initial Access",
  execution: "Execution",
  persistence: "Persistence",
  privilege_escalation: "Privilege Escalation",
  defense_evasion: "Defense Evasion",
  credential_access: "Credential Access",
  discovery: "Discovery",
  lateral_movement: "Lateral Movement",
  collection: "Collection",
  command_and_control: "Command & Control",
  exfiltration: "Exfiltration",
  impact: "Impact",
};

/** Hex colours so dashboards and the canvas share one source of truth. */
export const ATTACK_TACTIC_COLORS: Record<AttackTactic, string> = {
  reconnaissance: "#8b5cf6",
  resource_development: "#a855f7",
  initial_access: "#ef4444",
  execution: "#f97316",
  persistence: "#f59e0b",
  privilege_escalation: "#eab308",
  defense_evasion: "#84cc16",
  credential_access: "#10b981",
  discovery: "#14b8a6",
  lateral_movement: "#06b6d4",
  collection: "#0ea5e9",
  command_and_control: "#3b82f6",
  exfiltration: "#6366f1",
  impact: "#dc2626",
};

const ipv4Regex =
  /^(?:(?:25[0-5]|2[0-4]\d|[01]?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d?\d)$/;
const cveRegex = /^CVE-\d{4}-\d{4,7}$/i;
const cidrRegex =
  /^(?:(?:25[0-5]|2[0-4]\d|[01]?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d?\d)\/(3[0-2]|[12]?\d)$/;
const hostnameRegex = /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/;

// Defence-in-depth alongside the shlex.quote/ps_q escaping in the generator:
// reject the shell metacharacters that would otherwise let a password
// break out of a bash double-quoted string, a PowerShell SecureString
// argument, or a SQL string literal nested inside one of those.
const passwordRegex = /^[^"'`$;\\\r\n]+$/;

// topology.name lands in Vagrantfile string literals, generated
// filenames, slugs, and lab labels. Restrict to printable ASCII minus
// quoting and Ruby-interpolation metas so the value is safe across
// every downstream consumer.
const topologyNameRegex = /^[A-Za-z0-9 \-_.,!?():]+$/;

// Defence-in-depth, same reasoning as passwordRegex: a role string reaches a provisioner
// script's shell/PowerShell text (the bare role name and a free-text "@version" suffix, e.g.
// "siemens-simatic@TIA Portal V19") and must not be able to break out of the double-quoted lines
// it's spliced into. Version suffixes in the bundled templates use spaces (vendor/product
// names), so those stay allowed; shell and PowerShell metacharacters do not.
const roleRegex = /^[A-Za-z0-9][A-Za-z0-9._-]*(@[A-Za-z0-9][A-Za-z0-9._ -]*)?$/;

export const Credentials = z.object({
  username: z.string().min(1).max(64),
  password: z
    .string()
    .min(1)
    .max(128)
    .regex(passwordRegex, "Password must not contain shell metacharacters: \" ' ` $ ; \\ or newlines"),
});
export type Credentials = z.infer<typeof Credentials>;

export const NodeConfig = z.object({
  os: OsType,
  ip: z.string().regex(ipv4Regex, "Must be a valid IPv4 address"),
  hostname: z
    .string()
    .min(1)
    .max(63)
    .regex(hostnameRegex, "Invalid hostname"),
  cves: z.array(z.string().regex(cveRegex, "Must be CVE-YYYY-NNNN")).default([]),
  roles: z.array(z.string().regex(roleRegex, "Invalid role: use letters, digits, '.', '_', '-', and an optional '@version'")).default([]),
  memory_mb: z.number().int().min(256).max(65536).default(2048),
  cpus: z.number().int().min(1).max(32).default(2),
  credentials: Credentials,
  vlan: z.number().int().min(1).max(4094).nullable().default(null),
  gateway: z
    .string()
    .regex(ipv4Regex)
    .nullable()
    .default(null),
  // Optional Docker image hint used by the docker-compose generator.
  // When set, the compose target runs the node as a container.
  compose_image: z.string().max(256).nullable().optional(),
  // Optional host USB device to pass through to this VM (VirtualBox only).
  // Four hex digits each, as reported by GET /api/v1/host/usb-devices or
  // lsusb/Device Manager. Identifies the device only — no attack tooling
  // or network config is implied by setting this.
  usb_vendor_id: z.string().regex(/^[0-9a-fA-F]{4}$/).nullable().optional(),
  usb_product_id: z.string().regex(/^[0-9a-fA-F]{4}$/).nullable().optional(),
});
export type NodeConfig = z.infer<typeof NodeConfig>;

export const Position = z.object({
  x: z.number(),
  y: z.number(),
});
export type Position = z.infer<typeof Position>;

export const TopologyNode = z.object({
  id: z.string().min(1),
  type: NodeType,
  label: z.string().min(1).max(64),
  position: Position,
  config: NodeConfig,
  attack_tags: z.array(AttackTag).default([]),
});
export type TopologyNode = z.infer<typeof TopologyNode>;

export const TopologyEdge = z.object({
  id: z.string().min(1),
  source: z.string().min(1),
  target: z.string().min(1),
  protocol: Protocol.default("tcp"),
  port: z.number().int().min(1).max(65535).nullable().default(null),
  label: z.string().max(64).nullable().default(null),
  attack_tags: z.array(AttackTag).default([]),
});
export type TopologyEdge = z.infer<typeof TopologyEdge>;

export const ZoneShape = z.enum(["rectangle", "ellipse", "triangle", "cloud"]);
export type ZoneShape = z.infer<typeof ZoneShape>;

export const Zone = z.object({
  id: z.string().min(1),
  label: z.string().max(64).default(""),
  shape: ZoneShape,
  position: Position,
  size: z.object({
    width: z.number().min(40),
    height: z.number().min(40),
  }),
  color: z.string().min(1).default("#fbbf24"),
  opacity: z.number().min(0).max(1).default(0.15),
});
export type Zone = z.infer<typeof Zone>;

export const LabConfig = z.object({
  id: z.string().min(1).default(() => crypto.randomUUID()),
  name: z
    .string()
    .min(1)
    .max(128)
    .regex(
      topologyNameRegex,
      "Name must be ASCII-safe (letters, digits, spaces, and -_.,!?():)",
    ),
  description: z.string().max(2048).default(""),
  network_cidr: z.string().regex(cidrRegex, "Invalid CIDR notation"),
  provider: Provider.default("virtualbox"),
  // Upper bound is a safety net for the generator (memory, build time);
  // 500 nodes is well past anything a single host can actually `vagrant up`.
  nodes: z.array(TopologyNode).min(1).max(500),
  edges: z.array(TopologyEdge).default([]),
  zones: z.array(Zone).default([]),
  version: z.literal("1.0").default("1.0"),
});
export type LabConfig = z.infer<typeof LabConfig>;

export const TopologySchema = LabConfig;
export type TopologySchema = LabConfig;

export const ValidationIssue = z.object({
  node_id: z.string().nullable(),
  edge_id: z.string().nullable(),
  field: z.string().nullable(),
  message: z.string(),
  severity: z.enum(["error", "warning"]),
});
export type ValidationIssue = z.infer<typeof ValidationIssue>;

export const ValidationResult = z.object({
  valid: z.boolean(),
  issues: z.array(ValidationIssue),
});
export type ValidationResult = z.infer<typeof ValidationResult>;

export const CVEEntry = z.object({
  id: z.string(),
  description: z.string(),
  severity: z.enum(["CRITICAL", "HIGH", "MEDIUM", "LOW", "NONE"]),
  cvss_score: z.number().nullable(),
  published: z.string().nullable(),
  affected_products: z.array(z.string()).default([]),
  references: z.array(z.string()).default([]),
});
export type CVEEntry = z.infer<typeof CVEEntry>;

export const NODE_TYPE_ACCENT: Record<NodeType, string> = {
  workstation: "blue",
  server: "slate",
  domain_controller: "purple",
  router: "orange",
  firewall: "red",
  attacker: "rose",
  target: "amber",
  database: "green",
  ics_plc: "yellow",
  ics_hmi: "teal",
  camera: "violet",
  internet: "sky",
};

export const DEFAULT_OS_PER_NODE_TYPE: Record<NodeType, OsType> = {
  workstation: "windows_10",
  server: "ubuntu_2204",
  domain_controller: "windows_server_2019",
  router: "openwrt_23",
  firewall: "pfsense_2_7",
  attacker: "kali_rolling",
  target: "ubuntu_2204",
  database: "ubuntu_2204",
  ics_plc: "siemens_simatic",
  ics_hmi: "windows_10",
  camera: "ip_camera_firmware",
  internet: "ubuntu_2204",
};

export const OS_LABELS: Record<OsType, string> = {
  windows_10: "Windows 10",
  windows_11: "Windows 11",
  windows_server_2019: "Windows Server 2019",
  windows_server_2022: "Windows Server 2022",
  ubuntu_2204: "Ubuntu 22.04 LTS",
  ubuntu_2404: "Ubuntu 24.04 LTS",
  debian_12: "Debian 12",
  centos_stream_9: "CentOS Stream 9",
  rhel_9: "Red Hat Enterprise Linux 9",
  fedora_40: "Fedora 40",
  opensuse_tumbleweed: "openSUSE Tumbleweed",
  arch_rolling: "Arch Linux",
  alpine_latest: "Alpine Linux",
  freebsd_14: "FreeBSD 14",
  macos_sonoma: "macOS 14 Sonoma",
  macos_sequoia: "macOS 15 Sequoia",
  kali_rolling: "Kali Linux Rolling",
  parrot_security: "Parrot Security OS",
  blackarch_rolling: "BlackArch Linux",
  tails_6: "Tails 6",
  whonix_17: "Whonix 17",
  openwrt_23: "OpenWrt 23.05",
  vyos_1_4: "VyOS 1.4",
  routeros_7: "MikroTik RouterOS 7",
  cisco_ios_xe: "Cisco IOS-XE",
  juniper_junos_22: "Juniper Junos 22",
  pfsense_2_7: "pfSense 2.7 CE",
  opnsense_24: "OPNsense 24",
  fortios_7: "Fortinet FortiOS 7",
  panos_11: "Palo Alto PAN-OS 11",
  sophos_xg_19: "Sophos XG 19",
  vxworks_7: "VxWorks 7",
  siemens_simatic: "Siemens SIMATIC (S7)",
  schneider_modicon: "Schneider Modicon",
  raspbian_12: "Raspberry Pi OS 12",
  qnx_neutrino: "QNX Neutrino RTOS",
  ip_camera_firmware: "IP Camera Firmware",
};

export const NODE_TYPE_LABELS: Record<NodeType, string> = {
  workstation: "Workstation",
  server: "Server",
  domain_controller: "Domain Controller",
  router: "Router",
  firewall: "Firewall",
  attacker: "Attacker",
  target: "Target",
  database: "Database",
  ics_plc: "PLC",
  ics_hmi: "HMI / SCADA",
  camera: "IP Camera",
  internet: "Internet",
};
