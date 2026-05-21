/**
 * Turn raw heartbeat data into a chronological, severity-tagged event list
 * the monitor view can render. v2 will accept structured events from the
 * agent; today we parse the `log_tail` strings and synthesise events from
 * VM state transitions.
 */

export type EventSeverity = "info" | "ok" | "warn" | "alert";

export type EventCategory =
  | "system"
  | "vm"
  | "network"
  | "auth"
  | "threat"
  | "service"
  | "provision";

export interface MonitorEvent {
  id: string;
  capturedAt: string;
  hostname?: string;
  severity: EventSeverity;
  category: EventCategory;
  message: string;
  details?: string;
}

interface VmState {
  hostname: string;
  state: string;
}

interface HeartbeatLike {
  captured_at?: string;
  log_tail: string[];
  vms: VmState[];
  lab_status: string;
}

// Heuristics — substrings that hint at severity / category.
const ALERT_PATTERNS = [
  /denied/i,
  /unauthori[sz]ed/i,
  /failed login/i,
  /authentication failed/i,
  /exploit/i,
  /injection/i,
  /malware/i,
  /CVE-\d{4}-\d+/,
  /attack/i,
  /backdoor/i,
];

const WARN_PATTERNS = [
  /error/i,
  /fail/i,
  /warn/i,
  /timeout/i,
  /retry/i,
  /not found/i,
];

const AUTH_PATTERNS = [/login/i, /auth/i, /password/i, /ssh/i, /kerberos/i, /ldap/i];
const NETWORK_PATTERNS = [
  /connection/i,
  /tcp/i,
  /udp/i,
  /port/i,
  /firewall/i,
  /modbus/i,
  /rtsp/i,
  /http/i,
];
const SERVICE_PATTERNS = [
  /systemd/i,
  /service/i,
  /started/i,
  /stopped/i,
  /restart/i,
  /apt-get/i,
  /pip/i,
];

function classify(line: string): { severity: EventSeverity; category: EventCategory } {
  let severity: EventSeverity = "info";
  if (ALERT_PATTERNS.some((re) => re.test(line))) severity = "alert";
  else if (WARN_PATTERNS.some((re) => re.test(line))) severity = "warn";
  else if (/\bok\b|success|installed|enable/i.test(line)) severity = "ok";

  let category: EventCategory = "system";
  if (AUTH_PATTERNS.some((re) => re.test(line))) category = "auth";
  else if (NETWORK_PATTERNS.some((re) => re.test(line))) category = "network";
  else if (SERVICE_PATTERNS.some((re) => re.test(line))) category = "service";
  if (severity === "alert") category = "threat";

  return { severity, category };
}

const HOSTNAME_PROVISION = /^provision_([^.]+)\.(sh|ps1):/;

function parseLogLine(raw: string, idx: number, capturedAt: string): MonitorEvent {
  let hostname: string | undefined;
  let body = raw;
  const m = raw.match(HOSTNAME_PROVISION);
  if (m) {
    hostname = m[1];
    body = raw.slice(m[0].length).trim();
  }
  const { severity, category } = classify(body);
  return {
    id: `log-${capturedAt}-${idx}`,
    capturedAt,
    hostname,
    severity,
    category: hostname ? "provision" : category,
    message: body,
  };
}

interface ParseInput {
  heartbeats: HeartbeatLike[];
  previousVms?: Map<string, string>; // hostname → state
}

/**
 * Walk a list of heartbeats (oldest → newest) and produce events. Adds VM
 * state-transition events when the same host's state changes between
 * heartbeats.
 */
export function eventsFromHeartbeats({ heartbeats, previousVms }: ParseInput): MonitorEvent[] {
  const events: MonitorEvent[] = [];
  let prev: Map<string, string> = previousVms ?? new Map();

  for (const hb of heartbeats) {
    const at = hb.captured_at ?? new Date().toISOString();

    // VM state transitions
    for (const vm of hb.vms) {
      const wasIn = prev.get(vm.hostname);
      if (wasIn && wasIn !== vm.state) {
        const severity: EventSeverity =
          vm.state === "running" ? "ok" : vm.state === "aborted" ? "alert" : "warn";
        events.push({
          id: `vm-${at}-${vm.hostname}-${vm.state}`,
          capturedAt: at,
          hostname: vm.hostname,
          severity,
          category: "vm",
          message: `VM state ${wasIn} → ${vm.state}`,
        });
      }
      prev.set(vm.hostname, vm.state);
    }

    // Log-tail lines
    hb.log_tail.forEach((line, idx) => {
      events.push(parseLogLine(line, idx, at));
    });
  }

  // Most recent first
  events.sort((a, b) => (a.capturedAt < b.capturedAt ? 1 : -1));
  return events;
}

/** Bucket events by severity for the threat strip. */
export function summariseSeverity(
  events: MonitorEvent[],
): Record<EventSeverity, number> {
  const totals: Record<EventSeverity, number> = { info: 0, ok: 0, warn: 0, alert: 0 };
  for (const e of events) totals[e.severity] += 1;
  return totals;
}

/** Hosts that have any alert-level event right now — used to red-line the
 *  canvas edges and node halos. */
export function hostsWithAlerts(events: MonitorEvent[]): Set<string> {
  const out = new Set<string>();
  for (const e of events) {
    if (e.severity === "alert" && e.hostname) out.add(e.hostname);
  }
  return out;
}

/** A single src→dst flow sample carried in a heartbeat. */
export interface FlowSample {
  src_ip: string;
  dst_ip: string;
  packets?: number;
  bytes_estimate?: number;
  protocol?: string | null;
}

interface EdgeIpPair {
  edgeId: string;
  sourceIp: string;
  targetIp: string;
}

/**
 * Map heartbeat flow samples onto canvas edges.
 *
 * For each edge with source/target IPs known, sum the packet counts of any
 * flow whose endpoints match (either direction — IP-level flows are
 * bidirectional in practice). Returns a Map keyed by edge id so the
 * LiveCanvas can stamp per-edge density.
 */
export function edgeFlowRates(
  flows: FlowSample[] | undefined,
  edges: EdgeIpPair[],
): Map<string, number> {
  const out = new Map<string, number>();
  if (!flows || flows.length === 0 || edges.length === 0) return out;
  // Pre-index flows for O(1) lookup.
  const byPair = new Map<string, number>();
  for (const f of flows) {
    const key = `${f.src_ip}|${f.dst_ip}`;
    byPair.set(key, (byPair.get(key) ?? 0) + (f.packets ?? 0));
  }
  for (const e of edges) {
    if (!e.sourceIp || !e.targetIp) continue;
    const a = byPair.get(`${e.sourceIp}|${e.targetIp}`) ?? 0;
    const b = byPair.get(`${e.targetIp}|${e.sourceIp}`) ?? 0;
    const total = a + b;
    if (total > 0) out.set(e.edgeId, total);
  }
  return out;
}
