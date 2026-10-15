/**
 * Variant pickers for node illustrations.
 *
 * Each `pick*` function reads the node's OS and role list and returns a
 * discriminated tag the corresponding illustration uses to decide which
 * emblem / accent to render. All pickers default to a safe value so an
 * unmatched node still renders with the original look.
 */

import type { OsType } from "@labforge/schema";

import { parseRole } from "@/lib/icons/catalog";

const WINDOWS_OS: ReadonlySet<OsType> = new Set([
  "windows_10",
  "windows_11",
  "windows_server_2019",
  "windows_server_2022",
]);

const MACOS_OS: ReadonlySet<OsType> = new Set([
  "macos_sonoma",
  "macos_sequoia",
]);

const LINUX_OS: ReadonlySet<OsType> = new Set([
  "ubuntu_2204",
  "ubuntu_2404",
  "debian_12",
  "centos_stream_9",
  "rhel_9",
  "fedora_40",
  "opensuse_tumbleweed",
  "arch_rolling",
  "alpine_latest",
  "raspbian_12",
  "kali_rolling",
  "parrot_security",
  "blackarch_rolling",
  "tails_6",
  "whonix_17",
]);

/** Iterate roles' bare ids (strip @version suffix). */
function bareRoles(roles: readonly string[]): string[] {
  return roles.map((r) => parseRole(r).id.toLowerCase());
}

function rolesContain(roles: readonly string[], targets: readonly string[]): boolean {
  const bare = bareRoles(roles);
  return targets.some((t) => bare.includes(t));
}

/* ============================================================ Server */

export type ServerVariant =
  | "linux"
  | "windows"
  | "bsd"
  | "macos"
  | "default";

export function pickServerVariant(
  os: OsType,
  _roles: readonly string[] = [],
): ServerVariant {
  if (WINDOWS_OS.has(os)) return "windows";
  if (os === "freebsd_14") return "bsd";
  if (MACOS_OS.has(os)) return "macos";
  if (LINUX_OS.has(os)) return "linux";
  return "default";
}

/* ============================================================ Database */

export type DatabaseVariant =
  | "mysql"
  | "postgresql"
  | "mongodb"
  | "redis"
  | "mssql"
  | "default";

export function pickDatabaseVariant(
  _os: OsType,
  roles: readonly string[] = [],
): DatabaseVariant {
  const bare = bareRoles(roles);
  if (bare.includes("postgresql") || bare.includes("postgres")) return "postgresql";
  if (bare.includes("mysql")) return "mysql";
  if (bare.includes("mongodb")) return "mongodb";
  if (bare.includes("redis")) return "redis";
  if (bare.includes("mssql") || bare.includes("sql-server")) return "mssql";
  return "default";
}

/* ============================================================ Workstation */

export type WorkstationVariant =
  | "windows"
  | "macos"
  | "tails"
  | "kali"
  | "linux"
  | "default";

export function pickWorkstationVariant(
  os: OsType,
  _roles: readonly string[] = [],
): WorkstationVariant {
  if (WINDOWS_OS.has(os)) return "windows";
  if (MACOS_OS.has(os)) return "macos";
  if (os === "tails_6") return "tails";
  if (os === "kali_rolling") return "kali";
  if (LINUX_OS.has(os)) return "linux";
  return "default";
}

/* ============================================================ Firewall */

export type FirewallVariant =
  | "pfsense"
  | "opnsense"
  | "fortios"
  | "panos"
  | "sophos"
  | "default";

export function pickFirewallVariant(
  os: OsType,
  roles: readonly string[] = [],
): FirewallVariant {
  if (rolesContain(roles, ["pfsense"])) return "pfsense";
  if (rolesContain(roles, ["opnsense"])) return "opnsense";
  if (rolesContain(roles, ["fortios"])) return "fortios";
  if (rolesContain(roles, ["panos", "palo-alto"])) return "panos";
  if (rolesContain(roles, ["sophos"])) return "sophos";
  if (os === "pfsense_2_7") return "pfsense";
  if (os === "opnsense_24") return "opnsense";
  if (os === "fortios_7") return "fortios";
  if (os === "panos_11") return "panos";
  if (os === "sophos_xg_19") return "sophos";
  return "default";
}

/* ============================================================ Router */

export type RouterVariant =
  | "openwrt"
  | "vyos"
  | "cisco"
  | "mikrotik"
  | "juniper"
  | "default";

export function pickRouterVariant(
  os: OsType,
  _roles: readonly string[] = [],
): RouterVariant {
  if (os === "openwrt_23") return "openwrt";
  if (os === "vyos_1_4") return "vyos";
  if (os === "cisco_ios_xe") return "cisco";
  if (os === "routeros_7") return "mikrotik";
  if (os === "juniper_junos_22") return "juniper";
  return "default";
}

/* ============================================================ ICS PLC */

export type IcsPlcVariant =
  | "siemens"
  | "schneider"
  | "rockwell"
  | "mitsubishi"
  | "default";

export function pickIcsPlcVariant(
  _os: OsType,
  roles: readonly string[] = [],
): IcsPlcVariant {
  if (rolesContain(roles, ["siemens-simatic", "siemens"])) return "siemens";
  if (rolesContain(roles, ["schneider-modicon", "schneider"])) return "schneider";
  if (rolesContain(roles, ["rockwell-allenbradley", "rockwell"])) return "rockwell";
  if (rolesContain(roles, ["mitsubishi-melsec", "mitsubishi"])) return "mitsubishi";
  return "default";
}

/* ============================================================ Camera */

export type CameraVariant = "hikvision" | "dahua" | "frigate" | "default";

export function pickCameraVariant(
  _os: OsType,
  roles: readonly string[] = [],
): CameraVariant {
  if (rolesContain(roles, ["hikvision"])) return "hikvision";
  if (rolesContain(roles, ["dahua"])) return "dahua";
  if (rolesContain(roles, ["frigate"])) return "frigate";
  return "default";
}

/* ============================================================ Domain Controller */

export type DomainControllerVariant = "server2019" | "server2022" | "default";

export function pickDomainControllerVariant(
  os: OsType,
  _roles: readonly string[] = [],
): DomainControllerVariant {
  if (os === "windows_server_2019") return "server2019";
  if (os === "windows_server_2022") return "server2022";
  return "default";
}
