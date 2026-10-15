import type { LabConfig } from "@labforge/schema";

/**
 * The first-visit canvas. Three nodes — attacker, firewall, target — wired
 * across one perimeter zone so a brand-new user immediately sees what a
 * topology looks like instead of an empty canvas.
 *
 * Coordinates are picked so it fits centered on a 1200x700 viewport with
 * the zone framing all three nodes.
 */
export const SAMPLE_TOPOLOGY: LabConfig = {
  id: "sample-quickstart",
  name: "Quickstart",
  description: "Sample lab pre-loaded on your first visit. Edit it freely.",
  network_cidr: "192.168.56.0/24",
  provider: "virtualbox",
  version: "1.0",
  zones: [
    {
      id: "z-perimeter",
      label: "Perimeter",
      shape: "rectangle",
      position: { x: 60, y: 60 },
      size: { width: 820, height: 320 },
      color: "#22d3ee",
      opacity: 0.12,
    },
  ],
  nodes: [
    {
      id: "n-kali",
      type: "attacker",
      label: "Attacker",
      position: { x: 130, y: 180 },
      config: {
        os: "kali_rolling",
        ip: "192.168.56.10",
        hostname: "kali",
        cves: [],
        roles: ["nmap", "metasploit"],
        memory_mb: 2048,
        cpus: 2,
        credentials: { username: "kali", password: "kali" },
        vlan: null,
        gateway: null,
      },
      attack_tags: [],
    },
    {
      id: "n-fw",
      type: "firewall",
      label: "Firewall",
      position: { x: 430, y: 180 },
      config: {
        os: "pfsense_2_7",
        ip: "192.168.56.11",
        hostname: "fw01",
        cves: [],
        roles: ["pfsense-emulator"],
        memory_mb: 1024,
        cpus: 2,
        credentials: { username: "admin", password: "Pf!Lab2025" },
        vlan: null,
        gateway: null,
      },
      attack_tags: [],
    },
    {
      id: "n-target",
      type: "target",
      label: "Target",
      position: { x: 730, y: 180 },
      config: {
        os: "ubuntu_2204",
        ip: "192.168.56.20",
        hostname: "target01",
        cves: [],
        roles: ["apache"],
        memory_mb: 2048,
        cpus: 2,
        credentials: { username: "vagrant", password: "vagrant" },
        vlan: null,
        gateway: null,
      },
      attack_tags: [],
    },
  ],
  edges: [
    {
      id: "e-kali-fw",
      source: "n-kali",
      target: "n-fw",
      protocol: "tcp",
      port: null,
      label: "TCP",
      attack_tags: [],
    },
    {
      id: "e-fw-target",
      source: "n-fw",
      target: "n-target",
      protocol: "http",
      port: 80,
      label: "HTTP",
      attack_tags: [],
    },
  ],
};

const SEEN_KEY = "labforge.seen-build";

export function markBuildSeen(): void {
  try {
    window.localStorage.setItem(SEEN_KEY, "1");
  } catch {
    /* ignore */
  }
}

export function hasSeenBuild(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem(SEEN_KEY) === "1";
  } catch {
    return true;
  }
}
