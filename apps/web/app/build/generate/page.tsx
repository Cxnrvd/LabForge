"use client";

/**
 * Generate page — LabForge Dashboard 10 / Build › Generate.
 *
 * Lets the user choose a provisioner target (Vagrant or Docker Compose),
 * then calls POST /api/v1/generate to download the resulting zip.
 * The "Build Lab" shortcut kicks off vagrant up via the API and redirects
 * to the monitor page.
 */

import * as React from "react";
import Link from "next/link";
import { Download, Loader2, Play } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { PageToolbars, type TabSpec } from "@/components/dashboard/AppShell";
import { api, type ApiError } from "@/lib/api/client";
import { useTopologyStore } from "@/lib/store/topology-store";
import { downloadBlob } from "@/lib/utils/download";

/* ============================================================
   Tabs
   ============================================================ */

const TABS: TabSpec[] = [
  { id: "canvas", label: "Canvas", href: "/build" },
  { id: "validate", label: "Validate", href: "/build/validate" },
  { id: "generate", label: "Generate", active: true, href: "/build/generate" },
];

type Target = "vagrant" | "docker-compose";

/* ============================================================
   Page
   ============================================================ */

export default function GeneratePage(): React.ReactElement {
  const toTopology = useTopologyStore((s) => s.toTopology);
  const meta = useTopologyStore((s) => s.meta);
  const [target, setTarget] = React.useState<Target>("vagrant");
  const router = useRouter();
  const qc = useQueryClient();

  const generate = useMutation<Blob, ApiError>({
    mutationFn: () => api.generateZip(toTopology(), { target }),
    onSuccess: (blob) => {
      const filename = `labforge-${meta.name.toLowerCase().replace(/\s+/g, "-")}.zip`;
      downloadBlob(blob, filename);
      toast.success("Lab package downloaded", { description: filename });
    },
    onError: (err) => {
      toast.error("Generation failed", { description: err.detail ?? "Check API logs." });
    },
  });

  const build = useMutation<
    Awaited<ReturnType<typeof api.buildLab>>,
    ApiError
  >({
    mutationFn: () => api.buildLab(toTopology()),
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ["labs"] });
      toast.success("Build started", {
        description: `vagrant up running in ${result.workspace_path}`,
      });
      router.push(`/monitor/${result.lab_id}`);
    },
    onError: (err) => {
      const description =
        err.code === "vagrant_missing"
          ? "Install Vagrant 2.4+ on the API host, then retry."
          : err.detail ?? "Check API logs.";
      toast.error("Build failed to start", { description });
    },
  });

  const handleGenerate = (): void => {
    const topology = toTopology();
    if (topology.nodes.length === 0) {
      toast.error("Canvas is empty", { description: "Add at least one node first." });
      return;
    }
    generate.mutate();
  };

  const handleBuild = (): void => {
    const topology = toTopology();
    if (topology.nodes.length === 0) {
      toast.error("Canvas is empty", { description: "Add at least one node first." });
      return;
    }
    build.mutate();
  };

  const actions = (
    <>
      <button
        type="button"
        className="btn primary"
        onClick={handleGenerate}
        disabled={generate.isPending}
        style={{ display: "flex", alignItems: "center", gap: 6 }}
      >
        {generate.isPending ? (
          <Loader2 style={{ width: 14, height: 14, animation: "spin 1s linear infinite" }} />
        ) : (
          <Download style={{ width: 14, height: 14 }} />
        )}
        {generate.isPending ? "Generating…" : "Download .zip"}
      </button>
      <button
        type="button"
        className="btn"
        onClick={handleBuild}
        disabled={build.isPending}
        style={{ display: "flex", alignItems: "center", gap: 6 }}
      >
        {build.isPending ? (
          <Loader2 style={{ width: 14, height: 14, animation: "spin 1s linear infinite" }} />
        ) : (
          <Play style={{ width: 14, height: 14 }} />
        )}
        {build.isPending ? "Starting…" : "Build Lab"}
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

      <div style={{ padding: 24, maxWidth: 620 }}>
        {/* Topology summary */}
        <div
          style={{
            padding: "14px 16px",
            borderRadius: 8,
            background: "var(--d10-bg-card)",
            border: "1px solid var(--d10-border)",
            marginBottom: 24,
          }}
        >
          <div style={{ fontSize: 12, color: "var(--d10-fg-faint)", marginBottom: 4 }}>
            Active topology
          </div>
          <div style={{ fontWeight: 600, fontSize: 15, color: "var(--d10-fg)" }}>
            {meta.name || "Untitled"}
          </div>
          {meta.description && (
            <div style={{ fontSize: 12, color: "var(--d10-fg-mute)", marginTop: 4 }}>
              {meta.description}
            </div>
          )}
          <div style={{ display: "flex", gap: 16, marginTop: 8, fontSize: 12, color: "var(--d10-fg-mute)" }}>
            <span>Provider: <strong style={{ color: "var(--d10-fg)" }}>{meta.provider}</strong></span>
            <span>CIDR: <strong style={{ color: "var(--d10-fg)" }}>{meta.network_cidr}</strong></span>
          </div>
        </div>

        {/* Target selector */}
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--d10-fg)", marginBottom: 12 }}>
            Provisioner target
          </div>
          <div style={{ display: "flex", gap: 12 }}>
            {(["vagrant", "docker-compose"] as Target[]).map((t) => (
              <label
                key={t}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "12px 16px",
                  borderRadius: 8,
                  border: `1px solid ${target === t ? "var(--d10-accent)" : "var(--d10-border)"}`,
                  background: target === t ? "var(--d10-accent-dim, rgba(99,102,241,0.08))" : "var(--d10-bg-card)",
                  cursor: "pointer",
                  flex: 1,
                  transition: "border-color 120ms",
                }}
              >
                <input
                  type="radio"
                  name="target"
                  value={t}
                  checked={target === t}
                  onChange={() => setTarget(t)}
                  style={{ accentColor: "var(--d10-accent)" }}
                />
                <div>
                  <div style={{ fontWeight: 600, fontSize: 13, color: "var(--d10-fg)" }}>
                    {t === "vagrant" ? "Vagrant" : "Docker Compose"}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--d10-fg-mute)", marginTop: 2 }}>
                    {t === "vagrant"
                      ? "Vagrantfile + shell provisioners"
                      : "docker-compose.yml + Dockerfiles"}
                  </div>
                </div>
              </label>
            ))}
          </div>
        </div>

        {/* What you get */}
        <div
          style={{
            padding: "14px 16px",
            borderRadius: 8,
            background: "var(--d10-bg-card)",
            border: "1px solid var(--d10-border)",
            fontSize: 13,
            color: "var(--d10-fg-mute)",
            marginBottom: 24,
          }}
        >
          <div style={{ fontWeight: 600, color: "var(--d10-fg)", marginBottom: 8 }}>
            What&apos;s in the zip
          </div>
          <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.9 }}>
            {target === "vagrant" ? (
              <>
                <li><code>Vagrantfile</code> — full multi-machine definition</li>
                <li><code>provision/</code> — per-node shell provisioners</li>
                <li><code>hosts</code> — /etc/hosts entries for every VM</li>
                <li><code>README.md</code> — quickstart and topology overview</li>
              </>
            ) : (
              <>
                <li><code>docker-compose.yml</code> — service definitions</li>
                <li><code>provision/</code> — per-service init scripts</li>
                <li><code>hosts</code> — /etc/hosts entries</li>
                <li><code>README.md</code> — quickstart and topology overview</li>
              </>
            )}
          </ul>
        </div>

        <p style={{ fontSize: 12, color: "var(--d10-fg-faint)", lineHeight: 1.6 }}>
          <strong>Build Lab</strong> skips the download and runs{" "}
          <code>vagrant up</code> directly on the API host, then redirects you
          to the Monitor page. Requires Vagrant 2.4+ installed on the server.
        </p>
      </div>
    </>
  );
}
