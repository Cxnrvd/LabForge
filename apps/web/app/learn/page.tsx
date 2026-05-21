"use client";

import * as React from "react";
import Link from "next/link";
import {
  BookOpen,
  CheckCircle2,
  ChevronRight,
  Circle,
  GraduationCap,
  ShieldAlert,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

/**
 * Learning paths — curriculum mode.
 *
 * A learning path is an ordered list of bundled templates, each tagged
 * with the ATT&CK tactic it covers. The user's progress is stored in
 * localStorage (no auth yet) so they can resume across sessions.
 *
 * This scaffold ships three opinionated paths — Defender / Red-Teamer /
 * OT Engineer — pointing at templates that already exist in
 * ``packages/schema/templates``. Adding a new path is a single object
 * in ``PATHS`` below.
 */
const PROGRESS_KEY = "labforge.learn.progress.v1";

interface PathStep {
  templateId: string;
  title: string;
  blurb: string;
  attack: string;
}

interface LearningPath {
  id: string;
  title: string;
  audience: string;
  icon: React.ComponentType<{ className?: string }>;
  blurb: string;
  steps: PathStep[];
}

const PATHS: LearningPath[] = [
  {
    id: "defender",
    title: "Blue Team Foundations",
    audience: "SOC analyst / Threat hunter",
    icon: ShieldAlert,
    blurb:
      "Build the muscle to triage AD attacks, write detection content, and survive a tabletop with a vendor.",
    steps: [
      {
        templateId: "basic-ad",
        title: "Stand up an AD forest",
        blurb: "Get comfortable with Kerberos, RDP, and AS-REP roasting in a 3-node lab.",
        attack: "credential_access",
      },
      {
        templateId: "dfir-lab",
        title: "Wire up Sysmon + Splunk",
        blurb: "Stream Windows endpoint telemetry, then run an adversary emulator and confirm the alert.",
        attack: "execution",
      },
      {
        templateId: "red-team-range",
        title: "Defend a full DMZ",
        blurb: "Eight nodes, mixed Windows + Linux, a firewall, and a Kali attacker. Catch the chain.",
        attack: "lateral_movement",
      },
    ],
  },
  {
    id: "red",
    title: "Offensive Operator",
    audience: "Red teamer / Pentester",
    icon: GraduationCap,
    blurb: "Walk through the chain from initial access to data exfil in a permissioned lab.",
    steps: [
      {
        templateId: "cve-lab-log4shell",
        title: "Pop a Log4Shell host",
        blurb: "Get the JNDI callback right, escalate, and pivot.",
        attack: "initial_access",
      },
      {
        templateId: "red-team-range",
        title: "Multi-stage AD attack",
        blurb: "Phish, Kerberoast, lateral-move, dump LSASS.",
        attack: "lateral_movement",
      },
      {
        templateId: "llm-red-team-range",
        title: "Prompt-injection range",
        blurb: "Test garak probes against a real local LLM stack.",
        attack: "impact",
      },
    ],
  },
  {
    id: "ot",
    title: "OT / ICS Engineer",
    audience: "ICS security",
    icon: BookOpen,
    blurb: "Bridge IT and OT — bring up a factory floor, then explore the protocol attack surface.",
    steps: [
      {
        templateId: "smart-factory",
        title: "Spin up a smart factory",
        blurb: "Two PLCs (OpenPLC), an HMI (Rapid SCADA), cameras, Wazuh.",
        attack: "discovery",
      },
      {
        templateId: "wan-sim",
        title: "Model a multi-site WAN",
        blurb: "Add OSPF to understand how routing changes the attack surface.",
        attack: "lateral_movement",
      },
    ],
  },
];

function readProgress(): Record<string, string[]> {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(window.localStorage.getItem(PROGRESS_KEY) ?? "{}");
  } catch {
    return {};
  }
}

function writeProgress(value: Record<string, string[]>): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PROGRESS_KEY, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}

export default function LearnPage() {
  const [progress, setProgress] = React.useState<Record<string, string[]>>({});

  React.useEffect(() => {
    setProgress(readProgress());
  }, []);

  const toggle = (pathId: string, stepId: string): void => {
    setProgress((prev) => {
      const taken = new Set(prev[pathId] ?? []);
      if (taken.has(stepId)) taken.delete(stepId);
      else taken.add(stepId);
      const next = { ...prev, [pathId]: Array.from(taken) };
      writeProgress(next);
      return next;
    });
  };

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold">Learning paths</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Opinionated curricula stitched out of the bundled templates. Local progress is
          saved per browser. Add your own paths in
          <code className="mx-1">apps/web/app/learn/page.tsx</code>.
        </p>
      </header>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {PATHS.map((path) => {
          const taken = new Set(progress[path.id] ?? []);
          const pct = Math.round((taken.size / path.steps.length) * 100);
          const Icon = path.icon;
          return (
            <Card key={path.id} className="flex flex-col">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Icon className="h-4 w-4" />
                  {path.title}
                </CardTitle>
                <CardDescription>{path.audience}</CardDescription>
                <p className="mt-1 text-xs text-muted-foreground">{path.blurb}</p>
              </CardHeader>
              <CardContent className="flex flex-1 flex-col gap-2">
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full bg-emerald-500 transition-all"
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  {taken.size} / {path.steps.length} completed
                </p>
                <ol className="mt-1 space-y-1">
                  {path.steps.map((step) => {
                    const done = taken.has(step.templateId);
                    return (
                      <li
                        key={step.templateId}
                        className="flex items-start gap-2 rounded-md border bg-card/40 p-2"
                      >
                        <button
                          aria-label={done ? "Mark incomplete" : "Mark complete"}
                          onClick={() => toggle(path.id, step.templateId)}
                          className="mt-0.5 shrink-0"
                        >
                          {done ? (
                            <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                          ) : (
                            <Circle className="h-4 w-4 text-muted-foreground" />
                          )}
                        </button>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <p className="truncate text-xs font-medium">{step.title}</p>
                            <Badge variant="outline" className="text-[10px] capitalize">
                              {step.attack.replace(/_/g, " ")}
                            </Badge>
                          </div>
                          <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                            {step.blurb}
                          </p>
                        </div>
                        <Button asChild size="sm" variant="ghost" className="h-7 shrink-0">
                          <Link href={`/build?template=${step.templateId}`}>
                            <ChevronRight className="h-3.5 w-3.5" />
                          </Link>
                        </Button>
                      </li>
                    );
                  })}
                </ol>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
