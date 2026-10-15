"use client";

import * as React from "react";
import type { NodeType, OsType } from "@labforge/schema";

import {
  pickCameraVariant,
  pickDatabaseVariant,
  pickDomainControllerVariant,
  pickFirewallVariant,
  pickIcsPlcVariant,
  pickRouterVariant,
  pickServerVariant,
  pickWorkstationVariant,
} from "./illustration-variants";

export interface IllustrationProps {
  className?: string;
  accent?: string;
  size?: number;
  /** Drives variant selection (Windows flag, Postgres elephant, …). */
  os?: OsType;
  /** Drives variant selection (mysql/postgres/mongodb, pfsense/opnsense, …). */
  roles?: readonly string[];
}

/* ------------------------------------------------------------- helpers */

/** Plinth — colored isometric platform that all illustrations sit on. */
function Plinth({
  width = 110,
  cx = 60,
  cy = 110,
  color = "#fbbf24",
  shadow = true,
}: {
  width?: number;
  cx?: number;
  cy?: number;
  color?: string;
  shadow?: boolean;
}) {
  const rx = width / 2;
  return (
    <g>
      {shadow && (
        <ellipse cx={cx} cy={cy + 4} rx={rx * 0.85} ry={3} fill="black" opacity={0.25} />
      )}
      <ellipse cx={cx} cy={cy} rx={rx} ry={rx * 0.18} fill={color} opacity={0.85} />
      <ellipse
        cx={cx}
        cy={cy - 2}
        rx={rx * 0.92}
        ry={rx * 0.14}
        fill={color}
        opacity={0.55}
      />
    </g>
  );
}

/** Small brand-colored badge in the top-right of an illustration. */
function CornerBadge({
  cx = 96,
  cy = 26,
  r = 9,
  fill = "#0078D4",
  children,
}: {
  cx?: number;
  cy?: number;
  r?: number;
  fill?: string;
  children?: React.ReactNode;
}) {
  return (
    <g>
      <circle cx={cx} cy={cy} r={r + 1} fill="white" />
      <circle cx={cx} cy={cy} r={r} fill={fill} />
      {children}
    </g>
  );
}

/** Microsoft Windows 4-pane flag glyph. */
function WindowsFlag({ cx, cy, scale = 1 }: { cx: number; cy: number; scale?: number }) {
  const s = scale;
  return (
    <g transform={`translate(${cx} ${cy})`} fill="#fff">
      <rect x={-4 * s} y={-4 * s} width={3.5 * s} height={3.5 * s} />
      <rect x={0.5 * s} y={-4 * s} width={3.5 * s} height={3.5 * s} />
      <rect x={-4 * s} y={0.5 * s} width={3.5 * s} height={3.5 * s} />
      <rect x={0.5 * s} y={0.5 * s} width={3.5 * s} height={3.5 * s} />
    </g>
  );
}

/** Apple silhouette glyph. */
function AppleGlyph({ cx, cy, scale = 1, color = "#fff" }: { cx: number; cy: number; scale?: number; color?: string }) {
  return (
    <g transform={`translate(${cx} ${cy}) scale(${scale * 0.5})`} fill={color}>
      <path d="M5,-9 C5,-7 3,-5 1,-5 C2,-7 4,-9 5,-9 Z" />
      <path d="M-8,0 C-8,-4 -4,-6 -1,-5 C-1,-6 1,-7 3,-6 C7,-6 9,-2 8,2 C7,7 4,10 0,9 C-2,8 -3,8 -5,9 C-8,10 -10,6 -10,2 C-10,-1 -9,-1 -8,0 Z" />
    </g>
  );
}

/** Small text emblem like "PG", "WIN", "SIE". */
function TextEmblem({
  cx,
  cy,
  text,
  fill = "white",
  fontSize = 6,
}: {
  cx: number;
  cy: number;
  text: string;
  fill?: string;
  fontSize?: number;
}) {
  return (
    <text
      x={cx}
      y={cy + fontSize / 3}
      textAnchor="middle"
      fontFamily="ui-sans-serif, system-ui"
      fontWeight="700"
      fontSize={fontSize}
      fill={fill}
    >
      {text}
    </text>
  );
}

/* ============================================================== SERVER */

export function ServerIllustration({
  className,
  accent = "#22d3ee",
  os = "ubuntu_2204",
  roles = [],
}: IllustrationProps) {
  const id = React.useId();
  const variant = pickServerVariant(os, roles);
  // Per-variant accent + plinth tone.
  const accentByVariant: Record<string, string> = {
    windows: "#0078D4",
    linux: "#22d3ee",
    bsd: "#990000",
    macos: "#B4B5BA",
    default: accent,
  };
  const useAccent = accentByVariant[variant] ?? accent;

  return (
    <svg viewBox="0 0 120 120" className={className} xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <defs>
        <linearGradient id={`${id}-rack`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={variant === "windows" ? "#1e3a8a" : "#475569"} />
          <stop offset="100%" stopColor="#1e293b" />
        </linearGradient>
        <linearGradient id={`${id}-top`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="#94a3b8" />
          <stop offset="100%" stopColor="#475569" />
        </linearGradient>
      </defs>
      <Plinth color={variant === "windows" ? "#bfdbfe" : "#fbbf24"} />
      <polygon points="28,28 92,28 88,22 32,22" fill={`url(#${id}-top)`} />
      <rect x="28" y="28" width="64" height="76" rx="3" fill={`url(#${id}-rack)`} stroke="#0f172a" strokeWidth="0.6" />
      {[0, 1, 2, 3].map((i) => {
        const y = 36 + i * 16;
        return (
          <g key={i}>
            <rect x="32" y={y} width="56" height="11" rx="1.5" fill="#0f172a" />
            <circle cx="36.5" cy={y + 5.5} r="1.5" fill={useAccent} />
            <circle cx="41" cy={y + 5.5} r="1.5" fill="#22c55e" />
            <rect x="46" y={y + 4} width="36" height="3" rx="0.5" fill="#334155" />
            <rect x="46" y={y + 4} width={6 + i * 5} height="3" rx="0.5" fill={useAccent} opacity="0.6" />
          </g>
        );
      })}
      <rect x="28" y="28" width="64" height="2" fill={useAccent} opacity="0.85" />

      {/* OS family badge in top-right */}
      {variant === "windows" && (
        <CornerBadge fill="#0078D4">
          <WindowsFlag cx={96} cy={26} scale={0.9} />
        </CornerBadge>
      )}
      {variant === "linux" && (
        <CornerBadge fill="#FCC624">
          <TextEmblem cx={96} cy={26} text="LX" fill="#1f2937" fontSize={6} />
        </CornerBadge>
      )}
      {variant === "bsd" && (
        <CornerBadge fill="#AB2B28">
          <TextEmblem cx={96} cy={26} text="BSD" fontSize={5} />
        </CornerBadge>
      )}
      {variant === "macos" && (
        <CornerBadge fill="#1d1d1f">
          <AppleGlyph cx={96} cy={26} scale={1.1} color="#fff" />
        </CornerBadge>
      )}
    </svg>
  );
}

/* ============================================================ WORKSTATION */

export function WorkstationIllustration({
  className,
  accent = "#3b82f6",
  os = "windows_10",
  roles = [],
}: IllustrationProps) {
  const id = React.useId();
  const variant = pickWorkstationVariant(os, roles);

  // Choose the on-screen content per variant.
  const screenGradient: Record<string, [string, string]> = {
    windows: ["#0078D4", "#0a2540"],
    macos: ["#cbd5e1", "#475569"],
    tails: ["#56347C", "#1f1234"],
    kali: ["#557C94", "#0f172a"],
    linux: ["#0ea5e9", "#1e3a8a"],
    default: ["#0ea5e9", "#1e3a8a"],
  };
  const [c0, c1] = screenGradient[variant] ?? screenGradient.default!;

  return (
    <svg viewBox="0 0 120 120" className={className} xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <defs>
        <linearGradient id={`${id}-screen`} x1="0" x2="1" y1="0" y2="1">
          <stop offset="0%" stopColor={c0} />
          <stop offset="100%" stopColor={c1} />
        </linearGradient>
      </defs>
      <Plinth color="#a3a3a3" />
      <rect x="22" y="20" width="76" height="52" rx="3" fill={variant === "macos" ? "#94a3b8" : "#1f2937"} />
      <rect x="26" y="24" width="68" height="44" rx="2" fill={`url(#${id}-screen)`} />

      {/* Screen content per variant */}
      {variant === "windows" && (
        <g>
          <WindowsFlag cx={60} cy={46} scale={1.8} />
          {/* taskbar */}
          <rect x="26" y="62" width="68" height="6" fill="#0a2540" />
          <circle cx="32" cy="65" r="1.5" fill="#fff" />
          <rect x="36" y="64" width="6" height="2" fill="#fff" opacity="0.4" />
        </g>
      )}
      {variant === "macos" && (
        <g>
          <AppleGlyph cx={60} cy={42} scale={2.5} color="#fff" />
          {/* dock */}
          <rect x="32" y="62" width="56" height="4" rx="2" fill="#fff" opacity="0.3" />
        </g>
      )}
      {variant === "tails" && (
        <g>
          {/* onion silhouette */}
          <ellipse cx="60" cy="44" rx="9" ry="11" fill="#fff" opacity="0.85" />
          <path d="M51,40 Q60,28 69,40" fill="none" stroke="#fff" strokeWidth="1.5" />
          <text x="60" y="62" textAnchor="middle" fontFamily="ui-monospace, monospace" fontSize="5" fill="#fff">
            tails
          </text>
        </g>
      )}
      {variant === "kali" && (
        <g>
          {/* stylized dragon outline */}
          <path d="M40,46 C46,38 60,40 60,46 C60,52 70,52 78,44" stroke="#fff" strokeWidth="1.5" fill="none" />
          <text x="60" y="60" textAnchor="middle" fontFamily="ui-monospace, monospace" fontSize="5" fill="#fff">
            kali
          </text>
        </g>
      )}
      {(variant === "linux" || variant === "default") && (
        <g opacity="0.9">
          <rect x="30" y="30" width="14" height="2.5" rx="0.5" fill="#22d3ee" />
          <rect x="30" y="35" width="32" height="2" rx="0.5" fill="#f8fafc" opacity="0.7" />
          <rect x="30" y="40" width="22" height="2" rx="0.5" fill="#f8fafc" opacity="0.5" />
          <rect x="30" y="45" width="28" height="2" rx="0.5" fill="#f8fafc" opacity="0.6" />
          <rect x="30" y="50" width="18" height="2" rx="0.5" fill="#22c55e" />
        </g>
      )}

      <rect x="52" y="72" width="16" height="6" fill="#334155" />
      <rect x="40" y="78" width="40" height="4" rx="1.5" fill="#475569" />
      <rect x="86" y="58" width="14" height="32" rx="2" fill="#1f2937" />
      <circle cx="93" cy="64" r="1.2" fill={accent} />
      <rect x="89" y="68" width="8" height="1.5" fill="#475569" />
      <rect x="89" y="72" width="8" height="1.5" fill="#475569" />
    </svg>
  );
}

/* ======================================================= DOMAIN CONTROLLER */

export function DomainControllerIllustration({
  className,
  accent = "#a855f7",
  os = "windows_server_2019",
  roles = [],
}: IllustrationProps) {
  const id = React.useId();
  const variant = pickDomainControllerVariant(os, roles);
  const diamondColor = variant === "server2022" ? "#0078D4" : accent;

  return (
    <svg viewBox="0 0 120 120" className={className} xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <defs>
        <linearGradient id={`${id}-rack`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="#475569" />
          <stop offset="100%" stopColor="#1e293b" />
        </linearGradient>
      </defs>
      <Plinth color="#c4b5fd" />
      <rect x="28" y="32" width="64" height="72" rx="3" fill={`url(#${id}-rack)`} />
      <polygon points="28,32 92,32 88,26 32,26" fill="#64748b" />
      {[0, 1, 2].map((i) => (
        <g key={i}>
          <rect x="32" y={40 + i * 15} width="56" height="10" rx="1" fill="#0f172a" />
          <circle cx="36" cy={45 + i * 15} r="1.4" fill="#22c55e" />
          <rect x="42" y={43 + i * 15} width="38" height="3" rx="0.5" fill="#334155" />
        </g>
      ))}
      {/* AD diamond */}
      <g transform="translate(60 22)">
        <polygon points="0,-14 14,0 0,14 -14,0" fill={diamondColor} stroke="#581c87" strokeWidth="1" />
        <polygon points="0,-9 9,0 0,9 -9,0" fill="#f3e8ff" opacity="0.9" />
        <polygon points="0,-5 5,0 0,5 -5,0" fill={diamondColor} />
      </g>
      {/* Server2019 vs 2022 tiny year badge */}
      {variant !== "default" && (
        <CornerBadge cx={96} cy={32} r={9} fill="#0078D4">
          <TextEmblem cx={96} cy={32} text={variant === "server2022" ? "22" : "19"} fontSize={6} />
        </CornerBadge>
      )}
    </svg>
  );
}

/* ============================================================== ROUTER */

export function RouterIllustration({
  className,
  accent = "#f97316",
  os = "openwrt_23",
  roles = [],
}: IllustrationProps) {
  const id = React.useId();
  const variant = pickRouterVariant(os, roles);
  const bodyAccent: Record<string, string> = {
    openwrt: "#F36F25",
    vyos: "#2563EB",
    cisco: "#1BA0D7",
    mikrotik: "#293239",
    juniper: "#84B135",
    default: accent,
  };
  const useAccent = bodyAccent[variant] ?? accent;

  return (
    <svg viewBox="0 0 120 120" className={className} xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <defs>
        <linearGradient id={`${id}-body`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="#1e293b" />
          <stop offset="100%" stopColor="#020617" />
        </linearGradient>
      </defs>
      <Plinth color="#fed7aa" />
      <line x1="38" y1="20" x2="34" y2="46" stroke="#0f172a" strokeWidth="2.5" strokeLinecap="round" />
      <circle cx="38" cy="20" r="2.5" fill={useAccent} />
      <line x1="58" y1="14" x2="58" y2="46" stroke="#0f172a" strokeWidth="2.5" strokeLinecap="round" />
      <circle cx="58" cy="14" r="2.5" fill={useAccent} />
      <line x1="78" y1="20" x2="82" y2="46" stroke="#0f172a" strokeWidth="2.5" strokeLinecap="round" />
      <circle cx="78" cy="20" r="2.5" fill={useAccent} />
      <rect x="22" y="46" width="76" height="44" rx="6" fill={`url(#${id}-body)`} />
      <rect x="22" y="46" width="76" height="4" fill={useAccent} opacity="0.9" />
      <g>
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <rect key={i} x={28 + i * 11} y="72" width="8" height="6" rx="1" fill="#0f172a" />
        ))}
      </g>
      <g>
        {[0, 1, 2, 3, 4].map((i) => (
          <circle key={i} cx={32 + i * 12} cy="58" r="1.4" fill={i === 0 ? useAccent : "#22c55e"} />
        ))}
      </g>
      {variant !== "default" && (
        <CornerBadge cx={96} cy={56} fill={useAccent}>
          <TextEmblem
            cx={96}
            cy={56}
            text={variant === "openwrt" ? "WRT" : variant === "mikrotik" ? "MK" : variant.toUpperCase().slice(0, 3)}
            fontSize={5}
          />
        </CornerBadge>
      )}
    </svg>
  );
}

/* ============================================================ FIREWALL */

export function FirewallIllustration({
  className,
  accent = "#ef4444",
  os = "pfsense_2_7",
  roles = [],
}: IllustrationProps) {
  const id = React.useId();
  const variant = pickFirewallVariant(os, roles);
  const stripeColor: Record<string, string> = {
    pfsense: "#212121",
    opnsense: "#D94F00",
    fortios: "#EE3124",
    panos: "#FA582D",
    sophos: "#0a5e9c",
    default: "#fde047",
  };
  const stripe = stripeColor[variant] ?? "#fde047";

  return (
    <svg viewBox="0 0 120 120" className={className} xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <defs>
        <linearGradient id={`${id}-brick`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="#dc2626" />
          <stop offset="100%" stopColor="#991b1b" />
        </linearGradient>
        <linearGradient id={`${id}-flame`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="#fde047" />
          <stop offset="55%" stopColor="#f97316" />
          <stop offset="100%" stopColor="#dc2626" />
        </linearGradient>
      </defs>
      <Plinth color="#fecaca" />
      <g transform="translate(60 16)">
        <path
          d="M0,-14 C 8,-6 14,-2 8,8 C 12,4 14,2 14,8 C 14,18 6,22 0,22 C -6,22 -14,18 -14,8 C -14,2 -12,4 -8,8 C -14,-2 -8,-6 0,-14 Z"
          fill={`url(#${id}-flame)`}
        />
        <path
          d="M0,-4 C 4,0 6,2 4,8 C 6,6 8,4 8,8 C 8,14 4,18 0,18 C -4,18 -8,14 -8,8 C -8,4 -6,6 -4,8 C -8,2 -4,0 0,-4 Z"
          fill="#fef3c7"
          opacity="0.85"
        />
      </g>
      <g fill={`url(#${id}-brick)`} stroke="#7f1d1d" strokeWidth="0.8">
        <rect x="24" y="44" width="20" height="10" rx="1" />
        <rect x="46" y="44" width="20" height="10" rx="1" />
        <rect x="68" y="44" width="20" height="10" rx="1" />
        <rect x="90" y="44" width="6" height="10" rx="1" />
        <rect x="24" y="56" width="10" height="10" rx="1" />
        <rect x="36" y="56" width="20" height="10" rx="1" />
        <rect x="58" y="56" width="20" height="10" rx="1" />
        <rect x="80" y="56" width="16" height="10" rx="1" />
        <rect x="24" y="68" width="20" height="10" rx="1" />
        <rect x="46" y="68" width="20" height="10" rx="1" />
        <rect x="68" y="68" width="20" height="10" rx="1" />
        <rect x="90" y="68" width="6" height="10" rx="1" />
        <rect x="24" y="80" width="10" height="10" rx="1" />
        <rect x="36" y="80" width="20" height="10" rx="1" />
        <rect x="58" y="80" width="20" height="10" rx="1" />
        <rect x="80" y="80" width="16" height="10" rx="1" />
        <rect x="24" y="92" width="20" height="10" rx="1" />
        <rect x="46" y="92" width="20" height="10" rx="1" />
        <rect x="68" y="92" width="20" height="10" rx="1" />
        <rect x="90" y="92" width="6" height="10" rx="1" />
      </g>
      {/* Vendor stripe across the middle row */}
      {variant !== "default" && (
        <g>
          <rect x="24" y="66" width="72" height="2" fill={stripe} />
          <CornerBadge cx={96} cy={44} r={9} fill={stripe}>
            <TextEmblem
              cx={96}
              cy={44}
              text={
                variant === "pfsense"
                  ? "PF"
                  : variant === "opnsense"
                    ? "OPN"
                    : variant === "fortios"
                      ? "FG"
                      : variant === "panos"
                        ? "PAN"
                        : variant === "sophos"
                          ? "SX"
                          : ""
              }
              fontSize={5}
            />
          </CornerBadge>
        </g>
      )}
      {/* keep accent prop referenced */}
      <rect width="0" height="0" fill={accent} />
    </svg>
  );
}

/* ============================================================ ATTACKER */

export function AttackerIllustration({
  className,
  accent = "#f43f5e",
  os = "kali_rolling",
  roles = [],
}: IllustrationProps) {
  const id = React.useId();
  void os;
  void roles;
  return (
    <svg viewBox="0 0 120 120" className={className} xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <defs>
        <linearGradient id={`${id}-hood`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="#27272a" />
          <stop offset="100%" stopColor="#0a0a0a" />
        </linearGradient>
      </defs>
      <Plinth color="#fca5a5" />
      <path d="M30,90 C 30,68 42,54 60,54 C 78,54 90,68 90,90 L 90,98 L 30,98 Z" fill={`url(#${id}-hood)`} />
      <path d="M36,60 C 36,38 48,28 60,28 C 72,28 84,38 84,60 C 78,52 70,46 60,46 C 50,46 42,52 36,60 Z" fill={`url(#${id}-hood)`} />
      <ellipse cx="60" cy="56" rx="14" ry="11" fill="#0a0a0a" />
      <circle cx="55" cy="55" r="1.6" fill={accent} />
      <circle cx="65" cy="55" r="1.6" fill={accent} />
      <g>
        <rect x="34" y="84" width="52" height="4" rx="1" fill="#3f3f46" />
        <rect x="38" y="72" width="44" height="12" rx="1" fill="#18181b" />
        <rect x="40" y="74" width="40" height="8" fill="#1e293b" />
        <text x="60" y="80" textAnchor="middle" fontFamily="ui-monospace, monospace" fontSize="6" fill={accent}>
          {">_"}
        </text>
      </g>
    </svg>
  );
}

/* ============================================================== TARGET */

export function TargetIllustration({
  className,
  accent = "#f59e0b",
  os = "ubuntu_2204",
  roles = [],
}: IllustrationProps) {
  const id = React.useId();
  void os;
  void roles;
  return (
    <svg viewBox="0 0 120 120" className={className} xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <defs>
        <linearGradient id={`${id}-rack`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="#475569" />
          <stop offset="100%" stopColor="#1e293b" />
        </linearGradient>
      </defs>
      <Plinth color="#fde68a" />
      <rect x="28" y="32" width="64" height="72" rx="3" fill={`url(#${id}-rack)`} />
      <polygon points="28,32 92,32 88,26 32,26" fill="#64748b" />
      {[0, 1, 2].map((i) => (
        <g key={i}>
          <rect x="32" y={40 + i * 15} width="56" height="10" rx="1" fill="#0f172a" />
          <circle cx="36" cy={45 + i * 15} r="1.4" fill={accent} />
          <rect x="42" y={43 + i * 15} width="38" height="3" rx="0.5" fill="#334155" />
        </g>
      ))}
      <g transform="translate(86 28)">
        <circle r="14" fill="#fff" />
        <circle r="13" fill="none" stroke={accent} strokeWidth="2.5" />
        <circle r="6" fill="none" stroke={accent} strokeWidth="1.5" />
        <circle r="1.5" fill={accent} />
        <line x1="-14" y1="0" x2="-7" y2="0" stroke={accent} strokeWidth="2" />
        <line x1="14" y1="0" x2="7" y2="0" stroke={accent} strokeWidth="2" />
        <line x1="0" y1="-14" x2="0" y2="-7" stroke={accent} strokeWidth="2" />
        <line x1="0" y1="14" x2="0" y2="7" stroke={accent} strokeWidth="2" />
      </g>
    </svg>
  );
}

/* ============================================================ DATABASE */

export function DatabaseIllustration({
  className,
  accent = "#10b981",
  os = "ubuntu_2204",
  roles = [],
}: IllustrationProps) {
  const id = React.useId();
  const variant = pickDatabaseVariant(os, roles);
  const diskGradient: Record<string, [string, string]> = {
    mysql: ["#00758F", "#003545"],
    postgresql: ["#5093C5", "#1d4f78"],
    mongodb: ["#4DB33D", "#1a4716"],
    redis: ["#DC382D", "#751510"],
    mssql: ["#A91D22", "#5a0c10"],
    default: ["#34d399", "#047857"],
  };
  const [stop0, stop1] = diskGradient[variant] ?? diskGradient.default!;
  const emblem: Record<string, string> = {
    mysql: "SQL",
    postgresql: "PG",
    mongodb: "MGO",
    redis: "RD",
    mssql: "MS",
    default: "",
  };

  return (
    <svg viewBox="0 0 120 120" className={className} xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <defs>
        <linearGradient id={`${id}-disk`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={stop0} />
          <stop offset="100%" stopColor={stop1} />
        </linearGradient>
      </defs>
      <Plinth color="#a7f3d0" />
      {(() => {
        const cx = 60;
        const rx = 28;
        const ry = 7;
        const rows = [22, 48, 74];
        return (
          <g>
            {rows.map((y, i) => (
              <g key={i}>
                <rect x={cx - rx} y={y + ry} width={rx * 2} height="14" fill={`url(#${id}-disk)`} />
                <path
                  d={`M ${cx - rx},${y + ry} A ${rx},${ry} 0 0 0 ${cx + rx},${y + ry} L ${cx + rx},${y + ry + 14} A ${rx},${ry} 0 0 1 ${cx - rx},${y + ry + 14} Z`}
                  fill={`url(#${id}-disk)`}
                />
                <ellipse cx={cx} cy={y + ry} rx={rx} ry={ry} fill={stop0} stroke={stop1} strokeWidth="0.6" opacity="0.65" />
                <rect x={cx - rx + 4} y={y + ry + 5} width="6" height="2" rx="1" fill={accent} opacity="0.9" />
                <rect x={cx - rx + 14} y={y + ry + 5} width="14" height="2" rx="1" fill={stop1} opacity="0.7" />
              </g>
            ))}
            {emblem[variant] && (
              <CornerBadge cx={96} cy={26} fill={stop1}>
                <TextEmblem cx={96} cy={26} text={emblem[variant]!} fontSize={5} />
              </CornerBadge>
            )}
          </g>
        );
      })()}
    </svg>
  );
}

/* =============================================================== ICS PLC */

export function IcsPlcIllustration({
  className,
  accent = "#eab308",
  os = "siemens_simatic",
  roles = [],
}: IllustrationProps) {
  const id = React.useId();
  const variant = pickIcsPlcVariant(os, roles);
  const vendorStripe: Record<string, string> = {
    siemens: "#009999",
    schneider: "#3DCD58",
    rockwell: "#CC0000",
    mitsubishi: "#E60012",
    default: "#a16207",
  };
  const stripe = vendorStripe[variant] ?? "#a16207";
  const emblem: Record<string, string> = {
    siemens: "SIE",
    schneider: "SE",
    rockwell: "AB",
    mitsubishi: "MIT",
    default: "",
  };

  return (
    <svg viewBox="0 0 120 120" className={className} xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <defs>
        <linearGradient id={`${id}-body`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="#fde047" />
          <stop offset="100%" stopColor="#a16207" />
        </linearGradient>
      </defs>
      <Plinth color="#fde68a" />
      <rect x="22" y="30" width="76" height="68" rx="4" fill={`url(#${id}-body)`} stroke="#713f12" strokeWidth="1" />
      <rect x="26" y="34" width="68" height="6" rx="1" fill={stripe} />
      {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => (
        <rect key={i} x={28 + i * 6.6} y="35" width="3" height="4" fill="#a16207" opacity="0.55" />
      ))}
      <g>
        {[
          ["#22c55e"],
          ["#facc15"],
          ["#ef4444"],
          ["#3b82f6"],
        ].map(([c], i) => (
          <g key={i} transform={`translate(${28 + i * 14}, 50)`}>
            <circle cx="0" cy="0" r="2.5" fill={c as string} />
            <circle cx="0" cy="0" r="1.2" fill="white" opacity="0.4" />
          </g>
        ))}
      </g>
      <rect x="28" y="58" width="64" height="14" rx="1" fill="#451a03" />
      <text x="60" y="68" textAnchor="middle" fontFamily="ui-monospace, monospace" fontSize="7" fill={accent}>
        CPU 1500
      </text>
      <g>
        {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
          <g key={i} transform={`translate(${26 + i * 9}, 80)`}>
            <rect x="0" y="0" width="6" height="12" rx="0.5" fill="#27272a" />
            <circle cx="3" cy="4" r="1" fill="#a16207" />
            <circle cx="3" cy="8" r="1" fill="#a16207" />
          </g>
        ))}
      </g>
      {emblem[variant] && (
        <CornerBadge cx={96} cy={26} fill={stripe}>
          <TextEmblem cx={96} cy={26} text={emblem[variant]!} fontSize={5} />
        </CornerBadge>
      )}
    </svg>
  );
}

/* ================================================================ ICS HMI */

export function IcsHmiIllustration({
  className,
  accent = "#14b8a6",
  os = "windows_10",
  roles = [],
}: IllustrationProps) {
  const id = React.useId();
  void os;
  void roles;
  return (
    <svg viewBox="0 0 120 120" className={className} xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <defs>
        <linearGradient id={`${id}-screen`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="#0f766e" />
          <stop offset="100%" stopColor="#042f2e" />
        </linearGradient>
      </defs>
      <Plinth color="#99f6e4" />
      <rect x="14" y="20" width="92" height="70" rx="4" fill="#1f2937" stroke="#0f172a" strokeWidth="1" />
      <rect x="20" y="26" width="80" height="58" rx="2" fill={`url(#${id}-screen)`} />
      <g opacity="0.95">
        <rect x="26" y="42" width="14" height="22" rx="1" fill="none" stroke={accent} strokeWidth="1.2" />
        <rect x="27" y={42 + 22 - 10} width="12" height="10" fill={accent} opacity="0.5" />
        <line x1="40" y1="50" x2="58" y2="50" stroke={accent} strokeWidth="1.4" />
        <circle cx="64" cy="50" r="6" fill="none" stroke={accent} strokeWidth="1.4" />
        <path d="M62,48 L66,50 L62,52 Z" fill={accent} />
        <line x1="70" y1="50" x2="80" y2="50" stroke={accent} strokeWidth="1.4" />
        <rect x="80" y="42" width="14" height="22" rx="1" fill="none" stroke={accent} strokeWidth="1.2" />
        <rect x="26" y="32" width="68" height="6" rx="1" fill="#022c22" />
        <text x="30" y="37" fontFamily="ui-monospace, monospace" fontSize="4.5" fill={accent}>
          PLANT01 · RUN · 14.6 bar
        </text>
        <text x="33" y="72" fontFamily="ui-monospace, monospace" fontSize="4.5" fill="#5eead4">
          T1: 62%
        </text>
        <text x="83" y="72" fontFamily="ui-monospace, monospace" fontSize="4.5" fill="#5eead4">
          T2: 41%
        </text>
      </g>
      <rect x="52" y="90" width="16" height="6" fill="#334155" />
      <rect x="38" y="96" width="44" height="4" rx="1" fill="#475569" />
    </svg>
  );
}

/* ================================================================= CAMERA */

export function CameraIllustration({
  className,
  accent = "#8b5cf6",
  os = "ip_camera_firmware",
  roles = [],
}: IllustrationProps) {
  const id = React.useId();
  const variant = pickCameraVariant(os, roles);
  const brand: Record<string, string> = {
    hikvision: "#D60000",
    dahua: "#005BAA",
    frigate: "#06B6D4",
    default: accent,
  };
  const brandColor = brand[variant] ?? accent;
  return (
    <svg viewBox="0 0 120 120" className={className} xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <defs>
        <linearGradient id={`${id}-body`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="#e2e8f0" />
          <stop offset="100%" stopColor="#94a3b8" />
        </linearGradient>
        <radialGradient id={`${id}-lens`} cx="0.4" cy="0.35">
          <stop offset="0%" stopColor="#60a5fa" />
          <stop offset="100%" stopColor="#0f172a" />
        </radialGradient>
      </defs>
      <Plinth color="#ddd6fe" />
      <rect x="56" y="14" width="8" height="14" fill="#475569" />
      <rect x="48" y="26" width="24" height="4" rx="1" fill="#1f2937" />
      <rect x="18" y="36" width="74" height="38" rx="14" fill={`url(#${id}-body)`} stroke="#475569" strokeWidth="1" />
      <rect x="86" y="42" width="14" height="26" rx="6" fill="#1e293b" />
      <circle cx="93" cy="55" r="8" fill={`url(#${id}-lens)`} stroke="#0f172a" strokeWidth="1.2" />
      <circle cx="90" cy="52" r="2.5" fill="#bfdbfe" opacity="0.85" />
      {[
        [86, 47],
        [100, 47],
        [86, 63],
        [100, 63],
        [93, 45],
        [93, 65],
      ].map(([cx, cy], i) => (
        <circle key={i} cx={cx} cy={cy} r="1" fill="#dc2626" opacity="0.85" />
      ))}
      <circle cx="78" cy="44" r="1.6" fill={brandColor} />
      <rect x="24" y="50" width="40" height="10" rx="2" fill="#1f2937" />
      <text x="44" y="58" textAnchor="middle" fontFamily="ui-monospace, monospace" fontSize="6" fill={brandColor}>
        {variant === "hikvision"
          ? "HIK"
          : variant === "dahua"
            ? "DH"
            : variant === "frigate"
              ? "FRG"
              : "IP-CAM"}
      </text>
      <path d="M22,72 C 18,82 14,90 18,98" fill="none" stroke="#475569" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

/* =============================================================== INTERNET */

export function InternetIllustration({
  className,
  accent = "#0ea5e9",
  os,
  roles,
}: IllustrationProps) {
  void os;
  void roles;
  const id = React.useId();
  return (
    <svg viewBox="0 0 120 120" className={className} xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <defs>
        <linearGradient id={`${id}-cloud`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="#f8fafc" />
          <stop offset="100%" stopColor="#cbd5e1" />
        </linearGradient>
        <radialGradient id={`${id}-globe`} cx="0.35" cy="0.3">
          <stop offset="0%" stopColor="#7dd3fc" />
          <stop offset="100%" stopColor="#0c4a6e" />
        </radialGradient>
      </defs>
      <Plinth color="#bae6fd" />
      <g stroke="#94a3b8" strokeWidth="1.2">
        <circle cx="32" cy="58" r="16" fill={`url(#${id}-cloud)`} />
        <circle cx="50" cy="44" r="20" fill={`url(#${id}-cloud)`} />
        <circle cx="76" cy="40" r="22" fill={`url(#${id}-cloud)`} />
        <circle cx="96" cy="58" r="16" fill={`url(#${id}-cloud)`} />
        <ellipse cx="62" cy="66" rx="50" ry="18" fill={`url(#${id}-cloud)`} />
      </g>
      <ellipse cx="62" cy="68" rx="48" ry="14" fill={`url(#${id}-cloud)`} />
      <g transform="translate(62 52)">
        <circle r="15" fill={`url(#${id}-globe)`} stroke="#0c4a6e" strokeWidth="1" />
        <ellipse cx="0" cy="0" rx="15" ry="5" fill="none" stroke="#bae6fd" strokeWidth="0.8" opacity="0.85" />
        <ellipse cx="0" cy="0" rx="6.5" ry="15" fill="none" stroke="#bae6fd" strokeWidth="0.8" opacity="0.85" />
        <line x1="-15" y1="0" x2="15" y2="0" stroke="#bae6fd" strokeWidth="0.8" opacity="0.9" />
        <line x1="0" y1="-15" x2="0" y2="15" stroke="#bae6fd" strokeWidth="0.8" opacity="0.9" />
        <ellipse cx="-4" cy="-5" rx="3.5" ry="2.5" fill="#e0f2fe" opacity="0.8" />
      </g>
      <g fill={accent}>
        <circle cx="22" cy="84" r="1.8" />
        <circle cx="62" cy="92" r="1.8" />
        <circle cx="102" cy="84" r="1.8" />
      </g>
    </svg>
  );
}

/* ============================================================== REGISTRY */

export const ILLUSTRATIONS: Record<
  NodeType,
  React.ComponentType<IllustrationProps>
> = {
  workstation: WorkstationIllustration,
  server: ServerIllustration,
  domain_controller: DomainControllerIllustration,
  router: RouterIllustration,
  firewall: FirewallIllustration,
  attacker: AttackerIllustration,
  target: TargetIllustration,
  database: DatabaseIllustration,
  ics_plc: IcsPlcIllustration,
  ics_hmi: IcsHmiIllustration,
  camera: CameraIllustration,
  internet: InternetIllustration,
};
