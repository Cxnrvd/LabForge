"use client";

import * as React from "react";
import { toast } from "sonner";

interface CuratedCve {
  cveId: string;
  cvss: string;
  severity: "crit" | "high" | "med" | "low";
  title: string;
  description: string;
}

const CURATED: CuratedCve[] = [
  {
    cveId: "CVE-2021-44228",
    cvss: "10.0",
    severity: "crit",
    title: "Log4Shell",
    description:
      "Apache log4j2 ${jndi:} JNDI injection. Bundled with vulnerable Tomcat app.",
  },
  {
    cveId: "CVE-2017-0144",
    cvss: "9.8",
    severity: "crit",
    title: "EternalBlue · MS17-010",
    description: "SMBv1 RCE. Pre-configured Win7 target.",
  },
  {
    cveId: "CVE-2019-0708",
    cvss: "9.8",
    severity: "crit",
    title: "BlueKeep",
    description: "RDP pre-auth RCE in Win7. Includes Metasploit module.",
  },
  {
    cveId: "CVE-2024-3400",
    cvss: "8.8",
    severity: "high",
    title: "PAN-OS GlobalProtect",
    description: "Command injection in GlobalProtect feature.",
  },
  {
    cveId: "CVE-2024-21887",
    cvss: "7.5",
    severity: "high",
    title: "Ivanti Connect Secure",
    description: "Command injection on VPN appliances.",
  },
  {
    cveId: "CVE-2014-6271",
    cvss: "10.0",
    severity: "crit",
    title: "Shellshock",
    description: "Bash environment variable injection. Pre-fitted CGI demo.",
  },
];

export function CuratedCveGrid(): React.ReactElement {
  const handleSpin = (cveId: string): void => {
    toast.info("Feature coming", {
      description: `Spinning a curated lab for ${cveId} is on the roadmap.`,
    });
  };

  return (
    <div className="grid12">
      <div className="card s12">
        <div className="card-h">
          <h3>Curated CVE labs</h3>
          <div className="sub">
            CVEs with bundled provisioner scripts · ready to spin up
          </div>
          <div className="grow" />
          <span className="badge">{CURATED.length} curated</span>
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, 1fr)",
            gap: "1px",
            background: "var(--line)",
          }}
        >
          {CURATED.map((c) => (
            <div
              key={c.cveId}
              style={{ background: "var(--bg)", padding: "16px" }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  marginBottom: "6px",
                }}
              >
                <span className={`sev ${c.severity}`}>
                  <span className="d" />
                  {c.cvss}
                </span>
                <span
                  className="mono"
                  style={{ fontSize: "12.5px", color: "var(--blue)" }}
                >
                  {c.cveId}
                </span>
              </div>
              <div
                style={{
                  fontWeight: 600,
                  fontSize: "14px",
                  marginBottom: "4px",
                }}
              >
                {c.title}
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
              <button
                type="button"
                className="btn sm"
                onClick={() => handleSpin(c.cveId)}
              >
                Pin to lab →
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
