import type { NodeType } from "@labforge/schema";

export interface NodeStyle {
  accent: string;
  border: string;
  iconBg: string;
  iconColor: string;
  miniMapColor: string;
}

export const NODE_STYLES: Record<NodeType, NodeStyle> = {
  workstation: {
    accent: "bg-blue-500/10",
    border: "border-blue-500/40",
    iconBg: "bg-blue-500/15",
    iconColor: "text-blue-600 dark:text-blue-400",
    miniMapColor: "#3b82f6",
  },
  server: {
    accent: "bg-slate-500/10",
    border: "border-slate-500/40",
    iconBg: "bg-slate-500/15",
    iconColor: "text-slate-700 dark:text-slate-300",
    miniMapColor: "#64748b",
  },
  domain_controller: {
    accent: "bg-purple-500/10",
    border: "border-purple-500/40",
    iconBg: "bg-purple-500/15",
    iconColor: "text-purple-600 dark:text-purple-400",
    miniMapColor: "#a855f7",
  },
  router: {
    accent: "bg-orange-500/10",
    border: "border-orange-500/40",
    iconBg: "bg-orange-500/15",
    iconColor: "text-orange-600 dark:text-orange-400",
    miniMapColor: "#f97316",
  },
  firewall: {
    accent: "bg-red-500/10",
    border: "border-red-500/40",
    iconBg: "bg-red-500/15",
    iconColor: "text-red-600 dark:text-red-400",
    miniMapColor: "#ef4444",
  },
  attacker: {
    accent: "bg-rose-500/10",
    border: "border-rose-500/40",
    iconBg: "bg-rose-500/15",
    iconColor: "text-rose-600 dark:text-rose-400",
    miniMapColor: "#f43f5e",
  },
  target: {
    accent: "bg-amber-500/10",
    border: "border-amber-500/40",
    iconBg: "bg-amber-500/15",
    iconColor: "text-amber-600 dark:text-amber-400",
    miniMapColor: "#f59e0b",
  },
  database: {
    accent: "bg-emerald-500/10",
    border: "border-emerald-500/40",
    iconBg: "bg-emerald-500/15",
    iconColor: "text-emerald-600 dark:text-emerald-400",
    miniMapColor: "#10b981",
  },
  ics_plc: {
    accent: "bg-yellow-500/10",
    border: "border-yellow-500/40",
    iconBg: "bg-yellow-500/15",
    iconColor: "text-yellow-700 dark:text-yellow-300",
    miniMapColor: "#eab308",
  },
  ics_hmi: {
    accent: "bg-teal-500/10",
    border: "border-teal-500/40",
    iconBg: "bg-teal-500/15",
    iconColor: "text-teal-700 dark:text-teal-300",
    miniMapColor: "#14b8a6",
  },
  camera: {
    accent: "bg-violet-500/10",
    border: "border-violet-500/40",
    iconBg: "bg-violet-500/15",
    iconColor: "text-violet-600 dark:text-violet-400",
    miniMapColor: "#8b5cf6",
  },
  internet: {
    accent: "bg-sky-500/10",
    border: "border-sky-500/40",
    iconBg: "bg-sky-500/15",
    iconColor: "text-sky-600 dark:text-sky-400",
    miniMapColor: "#0ea5e9",
  },
};
