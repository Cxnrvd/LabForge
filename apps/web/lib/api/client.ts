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
      const body = (await response.json()) as { detail?: string | object; code?: string };
      if (typeof body.detail === "string") detail = body.detail;
      else if (body.detail) detail = JSON.stringify(body.detail);
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

export const api = {
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
  buildLab: (topology: LabConfig) =>
    request<{ lab_id: number; workspace_path: string; pid: number | null }>(
      "/labs/build",
      { method: "POST", body: JSON.stringify({ topology }) },
    ),
  buildPreflight: () =>
    request<{
      vagrant_available: boolean;
      vagrant_version?: string | null;
      default_provider?: string | null;
    }>("/labs/build/preflight"),
  buildLog: (labId: number, since: number) =>
    request<{ lines: string[]; next_offset: number; bytes_total: number }>(
      `/labs/${labId}/build/log?since=${since}`,
    ),
  buildStatus: (labId: number) =>
    request<BuildStatusPayload>(`/labs/${labId}/build/status`),
  buildStop: (labId: number) =>
    request<BuildStatusPayload>(`/labs/${labId}/build/stop`, { method: "POST" }),
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
