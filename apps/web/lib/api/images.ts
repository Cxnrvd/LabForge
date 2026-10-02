"use client";

/**
 * Image library: client types, hooks and helpers.
 *
 * Backend contract (to be implemented by the API):
 *   GET    /api/v1/images                  -> ImagesResponse
 *   POST   /api/v1/images/{id}/pull        -> ImageEntry   (starts a pull/download)
 *   DELETE /api/v1/images/{id}             -> 204
 *   POST   /api/v1/images/{id}/export      -> archive download
 *   POST   /api/v1/images/golden           -> ImageEntry   body: { source_id, name }
 *   POST   /api/v1/images/prepare          -> { queued: string[] } body: { template_id }
 *
 * Until the API exposes /images, `useImages` serves a clearly flagged sample
 * catalog (`sample: true`) so the UI can be reviewed end to end.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { LabConfig, TopologyNode } from "@labforge/schema";

export type ImageKind = "docker" | "windows-base" | "golden" | "vagrant-box";
export type ImageStatus = "ready" | "missing" | "pulling" | "outdated";

export interface ImageEntry {
  id: string;
  kind: ImageKind;
  name: string;
  tag?: string;
  size_mb: number;
  status: ImageStatus;
  /** 0..100 while status is "pulling". */
  progress?: number;
  used_by: string[];
  updated_at?: string | null;
  note?: string;
}

export interface ImagesResponse {
  images: ImageEntry[];
  total_mb: number;
  disk_free_gb?: number | null;
}

export interface ImagesResult extends ImagesResponse {
  /** True when the API has no /images endpoint yet and sample rows are shown. */
  sample: boolean;
}

const SAMPLE: ImageEntry[] = [
  { id: "elasticsearch", kind: "docker", name: "elasticsearch", tag: "8.15", size_mb: 1320, status: "ready", used_by: ["ransomware-intrusion-lab"], updated_at: "2026-09-28T09:10:00Z" },
  { id: "kibana", kind: "docker", name: "kibana", tag: "8.15", size_mb: 1090, status: "ready", used_by: ["ransomware-intrusion-lab"], updated_at: "2026-09-28T09:12:00Z" },
  { id: "log-replay", kind: "docker", name: "labforge/log-replay", tag: "local", size_mb: 210, status: "ready", used_by: ["ransomware-intrusion-lab"], updated_at: "2026-09-30T14:02:00Z" },
  { id: "kali", kind: "docker", name: "kalilinux/kali-rolling", tag: "latest", size_mb: 3200, status: "missing", used_by: ["ransomware-intrusion-lab"] },
  { id: "windows-10", kind: "windows-base", name: "Windows 10 base", tag: "dockurr/windows", size_mb: 22000, status: "missing", used_by: ["ransomware-intrusion-lab"], note: "Downloaded from Microsoft on first boot, then kept in a local volume." },
  { id: "win10-golden", kind: "golden", name: "win10-finance-victim", tag: "golden", size_mb: 18400, status: "ready", used_by: ["ransomware-intrusion-lab"], updated_at: "2026-10-01T16:40:00Z", note: "Local only. Windows images must not be shared." },
  { id: "ubuntu-2204-box", kind: "vagrant-box", name: "ubuntu/jammy64", tag: "virtualbox", size_mb: 640, status: "outdated", used_by: ["basic-ad"], updated_at: "2026-07-02T08:00:00Z" },
];

export function useImages() {
  return useQuery<ImagesResult>({
    queryKey: ["images"],
    queryFn: async () => {
      try {
        const res = await fetch("/api/v1/images");
        if (!res.ok) throw new Error(String(res.status));
        const body = (await res.json()) as ImagesResponse;
        return { ...body, sample: false };
      } catch {
        return {
          images: SAMPLE,
          total_mb: SAMPLE.filter((i) => i.status !== "missing").reduce((a, i) => a + i.size_mb, 0),
          disk_free_gb: null,
          sample: true,
        };
      }
    },
    refetchInterval: (q) => (q.state.data?.images.some((i) => i.status === "pulling") ? 2000 : 20_000),
    staleTime: 5000,
  });
}

async function call(path: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(`/api/v1${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`;
    try {
      const b = (await res.json()) as { detail?: string | { detail?: string } };
      if (typeof b.detail === "string") detail = b.detail;
      else if (b.detail?.detail) detail = b.detail.detail;
    } catch {
      /* keep default */
    }
    throw new Error(res.status === 404 ? "The image service is not available on this API yet." : detail);
  }
  return res;
}

export function useImageActions() {
  const qc = useQueryClient();
  const refresh = (): void => void qc.invalidateQueries({ queryKey: ["images"] });
  const pull = useMutation<unknown, Error, string>({
    mutationFn: async (id) => (await call(`/images/${encodeURIComponent(id)}/pull`, { method: "POST" })).json(),
    onSuccess: refresh,
  });
  const remove = useMutation<unknown, Error, string>({
    mutationFn: async (id) => call(`/images/${encodeURIComponent(id)}`, { method: "DELETE" }),
    onSuccess: refresh,
  });
  const prepare = useMutation<unknown, Error, string>({
    mutationFn: async (templateId) =>
      (await call("/images/prepare", { method: "POST", body: JSON.stringify({ template_id: templateId }) })).json(),
    onSuccess: refresh,
  });
  const golden = useMutation<unknown, Error, { source_id: string; name: string }>({
    mutationFn: async (body) =>
      (await call("/images/golden", { method: "POST", body: JSON.stringify(body) })).json(),
    onSuccess: refresh,
  });
  return { pull, remove, prepare, golden };
}

/* ---------------- Required images for a topology ---------------- */

export interface RequiredImage {
  key: string;
  label: string;
  kind: ImageKind;
  nodes: string[];
}

const WINDOWS_KEY: Record<string, string> = {
  windows_10: "windows-10",
  windows_11: "windows-11",
  windows_server_2019: "windows-2019",
  windows_server_2022: "windows-2022",
};

function requirementFor(node: TopologyNode, provider: string): { key: string; label: string; kind: ImageKind } {
  const os = node.config.os as string;
  if (WINDOWS_KEY[os]) {
    const key = WINDOWS_KEY[os];
    return { key, label: `Windows ${key.replace("windows-", "")} base`, kind: "windows-base" };
  }
  if (provider === "docker" && node.config.compose_image) {
    return { key: node.config.compose_image, label: node.config.compose_image, kind: "docker" };
  }
  if (provider === "docker") {
    return { key: os, label: os.replace(/_/g, " "), kind: "docker" };
  }
  return { key: os, label: `${os.replace(/_/g, " ")} box`, kind: "vagrant-box" };
}

export function requiredImages(topology: LabConfig, provider: string): RequiredImage[] {
  const map = new Map<string, RequiredImage>();
  for (const n of topology.nodes) {
    const r = requirementFor(n, provider);
    const hit = map.get(r.key);
    if (hit) hit.nodes.push(n.config.hostname);
    else map.set(r.key, { ...r, nodes: [n.config.hostname] });
  }
  return [...map.values()];
}

export type Readiness = "ready" | "missing" | "pulling" | "outdated" | "unknown";

export function readinessOf(req: RequiredImage, images: ImageEntry[] | undefined, sample: boolean): Readiness {
  if (!images || sample) return "unknown";
  const k = req.key.toLowerCase();
  const hit = images.find((i) => i.id.toLowerCase() === k || i.name.toLowerCase().includes(k) || k.includes(i.name.toLowerCase()));
  return hit ? hit.status : "missing";
}

export function formatSize(mb: number): string {
  if (mb >= 1024) return `${(mb / 1024).toFixed(mb >= 10240 ? 0 : 1)} GB`;
  return `${mb} MB`;
}
