"use client";

/**
 * Validation page — LabForge Dashboard 10 / Build › Validation.
 *
 * Reads the current topology from the store, POSTs it to
 * /api/v1/topologies/validate, and surfaces the results as a
 * sortable issue list. Click any row to jump back to the canvas
 * with the issue pre-highlighted.
 */

import * as React from "react";
import Link from "next/link";
import { AlertOctagon, CheckCircle2, Loader2, TriangleAlert } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";

import { PageToolbars, type TabSpec } from "@/components/dashboard/AppShell";
import { api, type ApiError } from "@/lib/api/client";
import { useTopologyStore } from "@/lib/store/topology-store";
import type { ValidationIssue } from "@labforge/schema";

/* ============================================================
   Tabs — shared with /build and /build/generate
   ============================================================ */

const TABS: TabSpec[] = [
  { id: "canvas", label: "Canvas", href: "/build" },
  { id: "validate", label: "Validate", active: true, href: "/build/validate" },
  { id: "generate", label: "Launch", href: "/build/generate" },
];

/* ============================================================
   Page
   ============================================================ */

export default function ValidatePage(): React.ReactElement {
  const toTopology = useTopologyStore((s) => s.toTopology);
  const setValidationIssues = useTopologyStore((s) => s.setValidationIssues);
  const storedIssues = useTopologyStore((s) => s.validationIssues);

  const [issues, setIssues] = React.useState<ValidationIssue[]>(storedIssues);
  const [ran, setRan] = React.useState(storedIssues.length > 0);

  const validate = useMutation<
    Awaited<ReturnType<typeof api.validateTopology>>,
    ApiError
  >({
    mutationFn: () => api.validateTopology(toTopology()),
    onSuccess: (result) => {
      setIssues(result.issues);
      setValidationIssues(result.issues);
      setRan(true);
      if (result.valid) {
        toast.success("Topology is valid", {
          description:
            result.issues.length > 0
              ? `${result.issues.length} warning(s) found.`
              : "No issues found.",
        });
      } else {
        toast.error(`${result.issues.length} issue(s) found`);
      }
    },
    onError: (err) => {
      toast.error("Validation failed", { description: err.detail });
    },
  });

  const errors = issues.filter((i) => i.severity === "error");
  const warnings = issues.filter((i) => i.severity === "warning");

  const actions = (
    <>
      <button
        type="button"
        className="btn primary"
        onClick={() => validate.mutate()}
        disabled={validate.isPending}
        style={{ display: "flex", alignItems: "center", gap: 6 }}
      >
        {validate.isPending && (
          <Loader2 style={{ width: 14, height: 14, animation: "spin 1s linear infinite" }} />
        )}
        {validate.isPending ? "Validating…" : "▶ Run Validation"}
      </button>
      <div className="right">
        <Link className="btn" href="/build">
          ← Back to Canvas
        </Link>
      </div>
    </>
  );

  return (
    <>
      <PageToolbars tabs={TABS} actions={actions} />

      <div style={{ padding: 24, maxWidth: 860 }}>
        {/* Summary strip */}
        {ran && (
          <div
            style={{
              display: "flex",
              gap: 16,
              marginBottom: 20,
              padding: "12px 16px",
              borderRadius: 8,
              background: "var(--d10-bg-card)",
              border: "1px solid var(--d10-border)",
            }}
          >
            {issues.length === 0 ? (
              <span style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--d10-fg-ok, #22c55e)" }}>
                <CheckCircle2 style={{ width: 16, height: 16 }} />
                <strong>No issues</strong> — topology is valid
              </span>
            ) : (
              <>
                {errors.length > 0 && (
                  <span style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--d10-fg-err, #ef4444)" }}>
                    <AlertOctagon style={{ width: 15, height: 15 }} />
                    <strong>{errors.length}</strong> error{errors.length !== 1 ? "s" : ""}
                  </span>
                )}
                {warnings.length > 0 && (
                  <span style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--d10-fg-warn, #f59e0b)" }}>
                    <TriangleAlert style={{ width: 15, height: 15 }} />
                    <strong>{warnings.length}</strong> warning{warnings.length !== 1 ? "s" : ""}
                  </span>
                )}
              </>
            )}
          </div>
        )}

        {/* Issue list */}
        {!ran && (
          <div
            style={{
              textAlign: "center",
              padding: "48px 24px",
              color: "var(--d10-fg-faint)",
              fontSize: 14,
            }}
          >
            <CheckCircle2 style={{ width: 36, height: 36, margin: "0 auto 12px", opacity: 0.35 }} />
            <p>Click <strong>Run Validation</strong> to check your topology against the API schema.</p>
          </div>
        )}

        {ran && issues.length === 0 && (
          <div
            style={{
              textAlign: "center",
              padding: "48px 24px",
              color: "var(--d10-fg-faint)",
              fontSize: 14,
            }}
          >
            <CheckCircle2 style={{ width: 36, height: 36, margin: "0 auto 12px", color: "var(--d10-fg-ok, #22c55e)", opacity: 0.8 }} />
            <p>All clear — no issues detected.</p>
          </div>
        )}

        {issues.length > 0 && (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--d10-border)", color: "var(--d10-fg-faint)", textAlign: "left" }}>
                <th style={{ padding: "6px 12px 6px 0", fontWeight: 600 }}>Severity</th>
                <th style={{ padding: "6px 12px", fontWeight: 600 }}>Message</th>
                <th style={{ padding: "6px 0 6px 12px", fontWeight: 600 }}>Node / Field</th>
              </tr>
            </thead>
            <tbody>
              {[...errors, ...warnings].map((issue, idx) => (
                <tr
                  key={`${issue.node_id ?? "x"}-${issue.field ?? "x"}-${idx}`}
                  style={{ borderBottom: "1px solid var(--d10-border)" }}
                >
                  <td style={{ padding: "8px 12px 8px 0", verticalAlign: "top" }}>
                    {issue.severity === "error" ? (
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 5, color: "var(--d10-fg-err, #ef4444)" }}>
                        <AlertOctagon style={{ width: 13, height: 13 }} />
                        error
                      </span>
                    ) : (
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 5, color: "var(--d10-fg-warn, #f59e0b)" }}>
                        <TriangleAlert style={{ width: 13, height: 13 }} />
                        warning
                      </span>
                    )}
                  </td>
                  <td style={{ padding: "8px 12px", verticalAlign: "top", color: "var(--d10-fg)" }}>
                    {issue.message}
                  </td>
                  <td style={{ padding: "8px 0 8px 12px", verticalAlign: "top", color: "var(--d10-fg-mute)", fontFamily: "monospace", fontSize: 11 }}>
                    {issue.node_id && <div>{issue.node_id}</div>}
                    {issue.field && <div style={{ opacity: 0.7 }}>.{issue.field}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
