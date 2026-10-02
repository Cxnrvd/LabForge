"use client";

/**
 * Launch page (Build > Launch).
 *
 * The primary action opens the Launch dialog: choose a provider, check the
 * machines and images, and start the lab. Packaging it as a zip is a
 * secondary action for people who want to run it by hand elsewhere.
 */

import * as React from "react";
import Link from "next/link";
import { Download, Loader2, Play } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";

import { PageToolbars, type TabSpec } from "@/components/dashboard/AppShell";
import { api, type ApiError } from "@/lib/api/client";
import { formatSize, requiredImages } from "@/lib/api/images";
import { useLaunchStore } from "@/lib/store/launch-store";
import { useTopologyStore } from "@/lib/store/topology-store";
import { downloadBlob } from "@/lib/utils/download";
import { useHydrated } from "@/lib/utils/use-hydrated";

const TABS: TabSpec[] = [
  { id: "canvas", label: "Canvas", href: "/build" },
  { id: "validate", label: "Validate", href: "/build/validate" },
  { id: "generate", label: "Launch", active: true, href: "/build/generate" },
];

const EMPTY_TOPOLOGY = { id: "empty", name: "", description: "", network_cidr: "192.168.56.0/24", provider: "docker", version: "1.0", nodes: [], edges: [], zones: [] } as unknown as ReturnType<ReturnType<typeof useTopologyStore.getState>["toTopology"]>;

export default function LaunchPage(): React.ReactElement {
  const toTopology = useTopologyStore((s) => s.toTopology);
  const storeMeta = useTopologyStore((s) => s.meta);
  const nodes = useTopologyStore((s) => s.nodes);
  const show = useLaunchStore((s) => s.show);

  // The persisted canvas only exists in the browser; show the empty form until it has loaded.
  const hydrated = useHydrated();
  const meta = hydrated ? storeMeta : { ...storeMeta, name: "", description: "", provider: "docker" as const };
  const topology = React.useMemo(() => (hydrated ? toTopology() : EMPTY_TOPOLOGY), [hydrated, toTopology, nodes, storeMeta]); // eslint-disable-line react-hooks/exhaustive-deps
  const ram = topology.nodes.reduce((a, n) => a + (n.config.memory_mb ?? 0), 0);
  const cpu = topology.nodes.reduce((a, n) => a + (n.config.cpus ?? 0), 0);
  const images = requiredImages(topology, meta.provider);

  const exportZip = useMutation<Blob, ApiError>({
    mutationFn: () =>
      api.generateZip(toTopology(), { target: meta.provider === "docker" ? "docker-compose" : "vagrant" }),
    onSuccess: (blob) => {
      const name = `labforge-${(meta.name || "lab").toLowerCase().replace(/\s+/g, "-")}.zip`;
      downloadBlob(blob, name);
      toast.success("Package downloaded", { description: name });
    },
    onError: (err) => toast.error("Export failed", { description: err.detail ?? "Check the API log." }),
  });

  const empty = topology.nodes.length === 0;

  const actions = (
    <>
      <button type="button" className="btn primary" onClick={show} disabled={empty} style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <Play style={{ width: 14, height: 14 }} />
        Launch lab
      </button>
      <div className="right">
        <Link className="btn" href="/build">Back to canvas</Link>
      </div>
    </>
  );

  return (
    <>
      <PageToolbars tabs={TABS} actions={actions} />
      <div style={{ padding: "8px 32px 32px", maxWidth: 760, display: "flex", flexDirection: "column", gap: 14 }}>
        <div className="scard">
          <div className="eyebrow">Ready to launch</div>
          <div style={{ fontSize: 22, fontWeight: 600, margin: "6px 0 2px" }}>{meta.name || "Untitled lab"}</div>
          {meta.description && <div className="home-sub">{meta.description}</div>}
          <div className="rows" style={{ marginTop: 10 }}>
            <div className="r"><span className="k">Runs on</span><span className="v">{meta.provider === "docker" ? "Docker" : meta.provider}</span></div>
            <div className="r"><span className="k">Machines</span><span className="v">{topology.nodes.length}</span></div>
            <div className="r"><span className="k">Memory</span><span className="v">{formatSize(ram)}</span></div>
            <div className="r"><span className="k">CPUs</span><span className="v">{cpu}</span></div>
            <div className="r"><span className="k">Images needed</span><span className="v">{images.length}</span></div>
          </div>
          <button type="button" className="btn primary btn-block" style={{ marginTop: 14 }} onClick={show} disabled={empty}>
            Choose where to run and start
          </button>
          {empty && <div className="home-sub" style={{ marginTop: 8 }}>The canvas is empty. Add machines or load a template first.</div>}
        </div>

        <div className="scard">
          <div className="eyebrow">Export package</div>
          <p className="home-sub" style={{ marginTop: 6 }}>
            Only needed if you want to run the lab by hand on another computer. It is a zip with{" "}
            {meta.provider === "docker" ? "a docker-compose.yml, init scripts and a README" : "a Vagrantfile, provisioners and a README"}.
          </p>
          <div>
            <button type="button" className="btn" style={{ marginTop: 10, display: "inline-flex", gap: 6, alignItems: "center" }}
              onClick={() => exportZip.mutate()} disabled={empty || exportZip.isPending}>
              {exportZip.isPending ? <Loader2 style={{ width: 14, height: 14 }} className="animate-spin" /> : <Download style={{ width: 14, height: 14 }} />}
              Download .zip
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
