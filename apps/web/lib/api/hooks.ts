"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { api, type ApiError } from "@/lib/api/client";
import type { LabConfig } from "@labforge/schema";

export function useTemplates() {
  return useQuery({
    queryKey: ["templates"],
    queryFn: () => api.listTemplates(),
  });
}

export function useTemplate(id: string | null) {
  return useQuery({
    queryKey: ["template", id],
    queryFn: () => api.getTemplate(id!),
    enabled: !!id,
  });
}

export function useCveSearch(query: string) {
  return useQuery({
    queryKey: ["cve-search", query],
    queryFn: () => api.searchCves(query),
    enabled: query.length >= 4,
    staleTime: 60_000,
  });
}

/**
 * CVEs associated with a specific role string (e.g. `apache@2.4.49`).
 * Only fires when the role carries an `@version` suffix — generic roles
 * like `apache` would flood NVD with broad matches.
 */
export function useRoleCves(role: string, enabled: boolean) {
  const at = role.indexOf("@");
  const id = at < 0 ? role : role.slice(0, at);
  const version = at < 0 ? "" : role.slice(at + 1);
  const query = `${id} ${version}`.trim();
  return useQuery({
    queryKey: ["role-cves", id, version],
    queryFn: () => api.searchCves(query, 5),
    enabled: enabled && version.length > 0,
    staleTime: 60 * 60_000, // 1 hour — NVD data doesn't shift on the minute
    retry: 0,
  });
}

export function useValidateTopology() {
  return useMutation<
    Awaited<ReturnType<typeof api.validateTopology>>,
    ApiError,
    LabConfig
  >({
    mutationFn: (topology) => api.validateTopology(topology),
  });
}

export function useGenerateZip() {
  return useMutation<Blob, ApiError, LabConfig>({
    mutationFn: (topology) => api.generateZip(topology),
  });
}
