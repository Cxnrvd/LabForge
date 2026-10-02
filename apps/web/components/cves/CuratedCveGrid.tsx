"use client";

/**
 * Every CVE LabForge actually has a provisioner script for, read live from the API via the
 * shared useCuratedCves() hook (lib/api/hooks.ts) — the same one NodeCvePopover and the CVE
 * library page use, so there is exactly one place that knows the shape of GET /cves/curated.
 */

import * as React from "react";
import { toast } from "sonner";

import type { CuratedCve } from "@/lib/api/client";
import { useCuratedCves } from "@/lib/api/hooks";

function severityGuess(cveId: string): "crit" | "high" {
  // The curated endpoint doesn't carry a CVSS score (that's NVD's job, see /cves/search); these
  // are all well-known critical/high RCEs, so this is cosmetic only, not a claim about exploitability.
  return cveId.startsWith("CVE-2014") || cveId.startsWith("CVE-2021-44228") ? "crit" : "high";
}

export function CuratedCveGrid(): React.ReactElement {
  const q = useCuratedCves();

  const handlePin = (cveId: string): void => {
    toast.info("Attach this from the canvas", {
      description: `Open a node's CVE panel on the Canvas and pin ${cveId} there. This card is reference only.`,
    });
  };

  return (
    <div className="grid12">
      <div className="card s12">
        <div className="card-h">
          <h3>Curated CVE labs</h3>
          <div className="sub">
            CVEs with a bundled provisioner script, read from the API
          </div>
          <div className="grow" />
          <span className="badge">{q.data?.length ?? 0} curated</span>
        </div>

        {q.isLoading && (
          <div style={{ padding: 16, fontSize: 12.5, color: "var(--ink-mute)" }}>Loading…</div>
        )}
        {q.isError && (
          <div style={{ padding: 16, fontSize: 12.5, color: "var(--ink-mute)" }}>
            Could not reach the API.
          </div>
        )}

        {q.data && (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(3, 1fr)",
              gap: "1px",
              background: "var(--line)",
            }}
          >
            {q.data.map((c: CuratedCve) => (
              <div key={c.cve_id} style={{ background: "var(--bg)", padding: "16px" }}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    marginBottom: "6px",
                  }}
                >
                  <span className={`sev ${severityGuess(c.cve_id)}`}>
                    <span className="d" />
                  </span>
                  <span className="mono" style={{ fontSize: "12.5px", color: "var(--blue)" }}>
                    {c.cve_id}
                  </span>
                </div>
                <div
                  style={{
                    fontWeight: 600,
                    fontSize: "12px",
                    marginBottom: "4px",
                    color: c.fully_provisioned ? "var(--green, #22c55e)" : "var(--amber, #f59e0b)",
                  }}
                >
                  {c.fully_provisioned ? "Runs a real vulnerable target" : "Notes only, nothing is set up"}
                </div>
                <p
                  style={{
                    margin: "0 0 10px",
                    color: "var(--ink-mute)",
                    fontSize: "12.5px",
                    lineHeight: 1.5,
                  }}
                >
                  {c.description}
                </p>
                <button type="button" className="btn sm" onClick={() => handlePin(c.cve_id)}>
                  Pin to lab →
                </button>
              </div>
            ))}
          </div>
        )}

        <p style={{ padding: "10px 16px", margin: 0, fontSize: "11px", color: "var(--ink-faint)" }}>
          Applies to the Vagrant/VirtualBox build only — a Docker build does not read a node&apos;s
          CVE list.
        </p>
      </div>
    </div>
  );
}
