"use client";

import * as React from "react";
import Link from "next/link";

/**
 * Learning paths — three curated curricula rendered with the LabForge
 * design-system classes (apps/web/styles/labforge-ds.css). Progress
 * is tracked per-user in localStorage under `labforge.learn-progress`
 * as `{ [pathId]: doneCount }`.
 *
 * The page renders inside the global AppShell — do NOT wrap it in a
 * sidebar or topbar here.
 */

const PROGRESS_KEY = "labforge.learn-progress";

type Track = "blue" | "red" | "amber";

type LessonKind = "reading" | "workshop" | "template";

interface Lesson {
  title: string;
  kind: LessonKind;
  /** Template id when kind === "template" — opens /canvas?template=… */
  templateId?: string;
}

interface LearningPath {
  id: string;
  title: string;
  track: Track;
  audience: string;
  blurb: string;
  lessons: Lesson[];
}

const PATHS: LearningPath[] = [
  {
    id: "blue-team",
    title: "Blue Team Defense",
    track: "blue",
    audience: "SOC analyst · Detection engineer",
    blurb:
      "SIEM, EDR, and detection engineering — investigate real incidents inside a contained lab.",
    lessons: [
      { title: "Why detection beats prevention", kind: "reading" },
      { title: "Spin up Splunk + Wazuh", kind: "template", templateId: "dfir-lab" },
      { title: "Generate Sysmon events", kind: "workshop" },
      { title: "Write your first detection", kind: "workshop" },
      { title: "Tune false positives", kind: "workshop" },
      { title: "Threat hunting with KQL", kind: "workshop" },
      { title: "MITRE ATT&CK mapping", kind: "reading" },
      {
        title: "Final exercise: Active intrusion",
        kind: "template",
        templateId: "red-team-range",
      },
    ],
  },
  {
    id: "offensive-red-team",
    title: "Offensive Red Team",
    track: "red",
    audience: "Red teamer · Pentester",
    blurb:
      "Walk an ATT&CK chain end-to-end: recon, initial access, lateral movement, exfil.",
    lessons: [
      { title: "Recon basics with nmap", kind: "reading" },
      { title: "Active Directory enumeration", kind: "template", templateId: "basic-ad" },
      { title: "Kerberoasting", kind: "workshop" },
      { title: "Lateral movement via SMB", kind: "workshop" },
      { title: "Persistence + cleanup", kind: "workshop" },
      {
        title: "Log4Shell exploitation",
        kind: "template",
        templateId: "cve-lab-log4shell",
      },
      {
        title: "Final exercise: Pivot to crown jewels",
        kind: "template",
        templateId: "red-team-range",
      },
    ],
  },
  {
    id: "ot-ics-defense",
    title: "OT/ICS Defense",
    track: "amber",
    audience: "ICS security · OT engineer",
    blurb:
      "Modbus, OpenPLC, SCADA hardening — defend an industrial environment end-to-end.",
    lessons: [
      { title: "How OT networks differ from IT", kind: "reading" },
      { title: "Modbus protocol basics", kind: "reading" },
      {
        title: "Spin up OpenPLC + SCADA",
        kind: "template",
        templateId: "smart-factory",
      },
      { title: "Detect Modbus tampering", kind: "workshop" },
      { title: "Camera + IP feed monitoring", kind: "workshop" },
      {
        title: "Final exercise: Plant intrusion",
        kind: "template",
        templateId: "smart-factory",
      },
    ],
  },
];

const TRACK_BG: Record<Track, string> = {
  blue: "linear-gradient(135deg, rgba(0,112,243,0.06), transparent)",
  red: "linear-gradient(135deg, rgba(204,0,0,0.06), transparent)",
  amber: "linear-gradient(135deg, rgba(200,122,0,0.06), transparent)",
};

const TRACK_ACCENT: Record<Track, string> = {
  blue: "var(--blue)",
  red: "var(--red)",
  amber: "var(--amber)",
};

const TRACK_BADGE: Record<Track, "info" | "err" | "warn"> = {
  blue: "info",
  red: "err",
  amber: "warn",
};

const KIND_LABEL: Record<LessonKind, string> = {
  reading: "reading",
  workshop: "workshop",
  template: "template",
};

type ProgressMap = Record<string, number>;

function readProgress(): ProgressMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(PROGRESS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object") {
      const out: ProgressMap = {};
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
      }
      return out;
    }
    return {};
  } catch {
    return {};
  }
}

function writeProgress(value: ProgressMap): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PROGRESS_KEY, JSON.stringify(value));
  } catch {
    /* ignore quota / disabled storage */
  }
}

export default function LearnPage(): React.ReactElement {
  const [progress, setProgress] = React.useState<ProgressMap>({});
  const [hydrated, setHydrated] = React.useState(false);

  React.useEffect(() => {
    setProgress(readProgress());
    setHydrated(true);
  }, []);

  const advance = React.useCallback((pathId: string, lessonIndex: number): void => {
    setProgress((prev) => {
      const current = prev[pathId] ?? 0;
      const next = Math.max(current, lessonIndex + 1);
      if (next === current) return prev;
      const updated: ProgressMap = { ...prev, [pathId]: next };
      writeProgress(updated);
      return updated;
    });
  }, []);

  const resetAll = (): void => {
    setProgress({});
    writeProgress({});
  };

  return (
    <main className="page">
      <div className="pagehead">
        <div className="grow">
          <h1 className="h1">Learning paths</h1>
          <div className="meta mono">
            3 curated curricula · localStorage-tracked · pick a track and spin up the lab
          </div>
        </div>
        <button type="button" className="btn" onClick={resetAll}>
          Reset progress
        </button>
      </div>

      <div className="grid12">
        {PATHS.map((path) => {
          const done = hydrated ? progress[path.id] ?? 0 : 0;
          const total = path.lessons.length;
          const pct = Math.round((done / total) * 100);
          return (
            <div key={path.id} className="card s4" style={{ display: "flex", flexDirection: "column" }}>
              <div
                style={{
                  padding: "20px 22px",
                  borderBottom: "1px solid var(--line)",
                  background: TRACK_BG[path.track],
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                  <span className={`badge ${TRACK_BADGE[path.track]}`}>
                    <span className="d" style={{ background: TRACK_ACCENT[path.track] }} />
                    {path.track === "blue"
                      ? "Defensive"
                      : path.track === "red"
                      ? "Offensive"
                      : "OT / ICS"}
                  </span>
                  <div style={{ flex: 1 }} />
                  <span className="mono" style={{ fontSize: 11, color: "var(--ink-mute)" }}>
                    {done} of {total} lessons
                  </span>
                </div>
                <h2
                  style={{
                    margin: "0 0 6px",
                    fontSize: 18,
                    fontWeight: 600,
                    letterSpacing: "-0.015em",
                  }}
                >
                  {path.title}
                </h2>
                <div className="meta-line" style={{ marginBottom: 8 }}>
                  {path.audience}
                </div>
                <p
                  style={{
                    margin: 0,
                    color: "var(--ink-mute)",
                    fontSize: 13.5,
                    lineHeight: 1.55,
                  }}
                >
                  {path.blurb}
                </p>
                <div className="prog" style={{ marginTop: 14 }}>
                  <i style={{ width: `${pct}%`, background: TRACK_ACCENT[path.track] }} />
                </div>
              </div>

              <div style={{ padding: "8px 0" }}>
                {path.lessons.map((lesson, idx) => {
                  const isDone = idx < done;
                  const isCurrent = idx === done;
                  const accent = TRACK_ACCENT[path.track];

                  const indicator = isDone ? (
                    <div
                      style={{
                        width: 22,
                        height: 22,
                        borderRadius: "50%",
                        background: "var(--green)",
                        color: "#fff",
                        display: "grid",
                        placeItems: "center",
                      }}
                      aria-label="completed"
                    >
                      <svg
                        width="11"
                        height="11"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="3"
                      >
                        <path d="M5 12l5 5L20 7" />
                      </svg>
                    </div>
                  ) : isCurrent ? (
                    <div
                      style={{
                        width: 22,
                        height: 22,
                        borderRadius: "50%",
                        background: "var(--bg)",
                        border: `2px solid ${accent}`,
                        color: accent,
                        display: "grid",
                        placeItems: "center",
                        fontFamily: "'Geist Mono', 'JetBrains Mono', monospace",
                        fontSize: 11,
                        fontWeight: 700,
                      }}
                    >
                      {idx + 1}
                    </div>
                  ) : (
                    <div
                      style={{
                        width: 22,
                        height: 22,
                        borderRadius: "50%",
                        background: "var(--bg)",
                        border: "1px solid var(--line-2)",
                        color: "var(--ink-faint)",
                        display: "grid",
                        placeItems: "center",
                        fontFamily: "'Geist Mono', 'JetBrains Mono', monospace",
                        fontSize: 11,
                      }}
                    >
                      {idx + 1}
                    </div>
                  );

                  const rowBg = isCurrent
                    ? path.track === "blue"
                      ? "rgba(0,112,243,0.04)"
                      : path.track === "red"
                      ? "rgba(204,0,0,0.04)"
                      : "rgba(200,122,0,0.04)"
                    : "transparent";

                  const titleColor = isDone || isCurrent ? "var(--ink)" : "var(--ink-mute)";

                  const action = isDone ? (
                    <span
                      className="mono"
                      style={{ color: "var(--green)", fontSize: 11 }}
                    >
                      DONE
                    </span>
                  ) : lesson.kind === "template" && lesson.templateId ? (
                    <Link
                      className={`btn sm ${isCurrent ? "primary" : "ghost"}`}
                      href={`/canvas?template=${encodeURIComponent(lesson.templateId)}`}
                      onClick={() => advance(path.id, idx)}
                    >
                      Open
                    </Link>
                  ) : (
                    <button
                      type="button"
                      className={`btn sm ${isCurrent ? "primary" : "ghost"}`}
                      onClick={() => advance(path.id, idx)}
                    >
                      Open
                    </button>
                  );

                  return (
                    <div
                      key={`${path.id}-${idx}`}
                      style={{
                        padding: "10px 22px",
                        display: "grid",
                        gridTemplateColumns: "22px 1fr auto",
                        gap: 10,
                        alignItems: "center",
                        background: rowBg,
                      }}
                    >
                      {indicator}
                      <div style={{ minWidth: 0 }}>
                        <div
                          style={{
                            fontWeight: 500,
                            fontSize: 13.5,
                            color: titleColor,
                          }}
                        >
                          {lesson.title}
                        </div>
                        <div className="meta-line">
                          {KIND_LABEL[lesson.kind]}
                          {lesson.templateId ? ` · ${lesson.templateId}` : ""}
                        </div>
                      </div>
                      {action}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      <div className="banner info" style={{ marginTop: 22 }}>
        <svg
          className="ico"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <circle cx="12" cy="12" r="10" />
          <path d="M12 16v-4M12 8h.01" />
        </svg>
        <div className="grow">
          Looking for the full catalogue? Every lesson here maps to a bundled template you
          can fork.
        </div>
        <Link className="btn sm" href="/templates">
          Browse templates
        </Link>
      </div>
    </main>
  );
}
