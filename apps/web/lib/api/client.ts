import type {
  CVEEntry,
  LabConfig,
  ValidationResult,
} from "@labforge/schema";

export interface TemplateSummary {
  id: string;
  name: string;
  description: string;
  node_count: number;
  edge_count: number;
}

export interface ApiError {
  detail: string;
  code: string;
}

const API_PREFIX = "/api/v1";

export function getStoredToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem("labforge.token");
  } catch {
    return null;
  }
}

function authHeaders(): Record<string, string> {
  const token = getStoredToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_PREFIX}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(),
      ...(init.headers ?? {}),
    },
  });
  if (!response.ok) {
    let detail = `${response.status} ${response.statusText}`;
    let code = "request_failed";
    try {
      const body = (await response.json()) as {
        detail?: string | { detail?: string; code?: string };
        code?: string;
      };
      if (typeof body.detail === "string") detail = body.detail;
      else if (body.detail && typeof body.detail === "object") {
        // The API nests structured errors: {"detail": {"detail": "...", "code": "lab_exists"}}
        if (typeof body.detail.detail === "string") detail = body.detail.detail;
        else detail = JSON.stringify(body.detail);
        if (body.detail.code) code = body.detail.code;
      }
      if (body.code) code = body.code;
    } catch {
      // ignore parse failure
    }
    const err: ApiError = { detail, code };
    throw err;
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

async function requestZip(path: string, body: unknown): Promise<Blob> {
  const response = await fetch(`${API_PREFIX}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    let detail = `${response.status} ${response.statusText}`;
    let code = "request_failed";
    try {
      const data = (await response.json()) as { detail?: string; code?: string };
      if (data.detail) detail = data.detail;
      if (data.code) code = data.code;
    } catch {
      // ignore
    }
    throw { detail, code } satisfies ApiError;
  }
  return await response.blob();
}

export interface HostMetrics {
  memory: { total_mb: number | null; used_mb: number | null; percent: number | null };
  cpu: { percent: number | null; cores: number | null };
  disk: { path: string | null; total_gb: number | null; used_gb: number | null; free_gb: number | null };
  sampled_at: string;
  engine: {
    docker_daemon: boolean;
    docker_version: string | null;
    compose_version: string | null;
    docker_memory_mb?: number | null;
    docker_disk?: { path: string | null; free_gb: number | null; total_gb: number | null } | null;
    vagrant_version: string | null;
    virtualbox_version: string | null;
    hypervisor_present: boolean | null;
  };
}

export interface LabEndpoint {
  host: string;
  label: string;
  url: string | null;
  address: string;
  kind: "web" | "rdp" | "tcp";
  host_port: number;
}

export interface PreflightCheck {
  id: string;
  status: "ok" | "warn" | "fail";
  title: string;
  detail: string;
  fix: string | null;
}

export interface PreflightReport {
  status: "ok" | "warn" | "fail";
  ready: boolean;
  checks: PreflightCheck[];
}

export const api = {
  labEndpoints: (labId: number) => request<LabEndpoint[]>(`/labs/${labId}/endpoints`),
  preflight: (opts: { windowsGuests?: number; memoryMb?: number; recheck?: boolean } = {}) => {
    const q = new URLSearchParams();
    if (opts.windowsGuests) q.set("windows_guests", String(opts.windowsGuests));
    if (opts.memoryMb) q.set("memory_mb", String(opts.memoryMb));
    if (opts.recheck) q.set("recheck", "true");
    const qs = q.toString();
    return request<PreflightReport>(`/host/preflight${qs ? `?${qs}` : ""}`);
  },
  hostMetrics: () => request<HostMetrics>("/host/metrics"),
  listTemplates: () => request<TemplateSummary[]>("/templates"),
  getTemplate: (id: string) => request<LabConfig>(`/templates/${id}`),
  validateTopology: (topology: LabConfig) =>
    request<ValidationResult>("/topologies/validate", {
      method: "POST",
      body: JSON.stringify(topology),
    }),
  saveTopology: (topology: LabConfig) =>
    request<LabConfig>("/topologies", {
      method: "POST",
      body: JSON.stringify(topology),
    }),
  searchCves: (query: string, limit = 10) =>
    request<CVEEntry[]>(
      `/cves/search?q=${encodeURIComponent(query)}&limit=${limit}`,
    ),
  getCve: (id: string) => request<CVEEntry>(`/cves/${encodeURIComponent(id)}`),
  generateZip: (
    topology: LabConfig,
    options: { target?: "vagrant" | "docker-compose" } = {},
  ) =>
    requestZip(
      options.target ? `/generate?target=${options.target}` : "/generate",
      {
        topology,
        include_readme: true,
        include_hosts_file: true,
      },
    ),
  getLabHeartbeat: (labId: number) =>
    request<{
      lab_status: string;
      vms: { hostname: string; state: string; ip?: string | null }[];
      log_tail: string[];
      flows: { src_ip: string; dst_ip: string; packets: number; bytes_estimate: number; protocol?: string | null }[];
      captured_at?: string | null;
    }>(`/labs/${labId}/heartbeat`),
  getLabLog: (labId: number, lines = 200) =>
    request<string[]>(`/labs/${labId}/log?lines=${lines}`),
  getRecentActivity: () =>
    request<
      Array<{
        lab_id: number;
        lab_name: string;
        captured_at: string;
        lab_status: string;
        running_vms: number;
        total_vms: number;
        log_snippet: string | null;
      }>
    >("/labs/activity/recent"),
  buildLab: (topology: LabConfig, options: { replace?: boolean } = {}) =>
    request<{ lab_id: number; workspace_path: string; pid: number | null }>(
      "/labs/build",
      {
        method: "POST",
        body: JSON.stringify({ topology, replace: options.replace ?? false }),
      },
    ),
  /**
   * Build, and if a lab with the same name is already running ask before
   * tearing it down and starting over (the API answers 409 lab_exists).
   */
  buildLabConfirmed: async (topology: LabConfig) => {
    try {
      return await api.buildLab(topology);
    } catch (err) {
      const e = err as ApiError;
      if (e?.code !== "lab_exists") throw err;
      const ok =
        typeof window !== "undefined" &&
        window.confirm(
          `${e.detail}\n\nReplace it? The running lab, its containers/VMs and its data will be destroyed first.`,
        );
      if (!ok) throw err;
      return await api.buildLab(topology, { replace: true });
    }
  },
  destroyLab: (labId: number, options: { force?: boolean } = {}) =>
    request<void>(`/labs/${labId}${options.force ? "?force=true" : ""}`, {
      method: "DELETE",
    }),
  buildPreflight: (provider?: string) =>
    request<{
      vagrant_available: boolean;
      vagrant_version?: string | null;
      default_provider?: string | null;
      virtualbox_version?: string | null;
      vmware_available?: boolean;
      vmware_plugin?: boolean;
      hypervisor_present?: boolean | null;
      host_os?: string;
      host_arch?: string;
      host_memory_mb?: number | null;
      provider_problem?: { code: string; message: string } | null;
      provider_warnings?: string[];
      docker_available?: boolean;
      docker_daemon?: boolean;
      docker_version?: string | null;
      compose_version?: string | null;
      compose_supported?: boolean;
      detail?: string | null;
    }>(
      provider
        ? `/labs/build/preflight?provider=${encodeURIComponent(provider)}`
        : "/labs/build/preflight",
    ),
  buildLog: (labId: number, since: number) =>
    request<{ lines: string[]; next_offset: number; bytes_total: number }>(
      `/labs/${labId}/build/log?since=${since}`,
    ),
  buildStatus: (labId: number) =>
    request<BuildStatusPayload>(`/labs/${labId}/build/status`),
  buildStop: (labId: number) =>
    request<BuildStatusPayload>(`/labs/${labId}/build/stop`, { method: "POST" }),
  haltLab: (labId: number) =>
    request<{ id: number; status: string; provider: string }>(`/labs/${labId}/halt`, { method: "POST" }),
  resumeLab: (labId: number) =>
    request<{ id: number; status: string; provider: string }>(`/labs/${labId}/resume`, { method: "POST" }),
  buildPhases: (labId: number) =>
    request<BuildPhasesPayload>(`/labs/${labId}/build/phases`),
  getLabTopology: (labId: number) =>
    request<LabConfig>(`/labs/${labId}/topology`),
  listStoredTopologies: () =>
    request<
      Array<{ slug: string; name: string; description?: string | null; updated_at: string }>
    >("/topologies"),
  getStoredTopology: (slug: string) =>
    request<LabConfig>(`/topologies/${slug}`),
};

export interface BuildStatusPayload {
  phase: "running" | "succeeded" | "failed" | "aborted" | "unknown";
  exit_code: number | null;
  finished_at: string | null;
  pid: number | null;
}

export type BuildPhase =
  | "defined"
  | "downloading"
  | "importing"
  | "booting"
  | "network"
  | "provisioning"
  | "ready"
  | "failed";

export interface BuildPhasesPayload {
  per_vm: Record<string, BuildPhase>;
  overall: "running" | "succeeded" | "failed" | "aborted" | "unknown";
}
