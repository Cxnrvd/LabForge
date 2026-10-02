"use client";

/**
 * Settings > General > Workspace location.
 *
 * Where lab folders are stored. Changing it takes effect at once (no API restart). A browser cannot
 * open a native folder picker that returns a full path, so this is a path field with a Test path
 * button that asks the API to check the folder before anything is saved.
 */

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import {
  api,
  type ApiError,
  type WorkspaceExisting,
  type WorkspaceStatus,
  type WorkspaceValidation,
} from "@/lib/api/client";

export function useWorkspace() {
  return useQuery<WorkspaceStatus>({
    queryKey: ["workspace"],
    queryFn: () => api.workspace(),
    refetchInterval: 15_000,
    retry: 1,
  });
}

function examplePath(): string {
  const ua = typeof navigator === "undefined" ? "" : navigator.userAgent;
  if (/Windows/i.test(ua)) return "D:\\LabForge";
  if (/Mac/i.test(ua)) return "/Volumes/Data/LabForge";
  return "/mnt/data/labforge";
}

function sourceLabel(source: WorkspaceStatus["source"]): string {
  if (source === "settings") return "chosen here";
  if (source === "environment") return "set by LABFORGE_WORKSPACE_ROOT";
  return "default, next to the LabForge code";
}

interface Pending {
  path: string | null;
  existing: WorkspaceExisting;
}

export function WorkspaceLocation(): React.JSX.Element {
  const qc = useQueryClient();
  const q = useWorkspace();
  const [draft, setDraft] = React.useState("");
  const [test, setTest] = React.useState<WorkspaceValidation | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState<Pending | null>(null);
  const placeholder = React.useMemo(examplePath, []);

  const save = useMutation<WorkspaceStatus, ApiError, { path: string | null; existing?: "move" | "leave" }>({
    mutationFn: ({ path, existing }) => api.setWorkspace(path, existing),
    onSuccess: (res) => {
      setPending(null);
      setError(null);
      setTest(null);
      setDraft("");
      toast.success(
        res.moved
          ? `Workspace moved to ${res.path} (${res.moved.entries} item${res.moved.entries === 1 ? "" : "s"})`
          : `Labs will be stored in ${res.path}`,
      );
      void qc.invalidateQueries();
    },
    onError: (err, vars) => {
      if (err.code === "existing_data" && err.extra?.existing) {
        setPending({ path: vars.path, existing: err.extra.existing as WorkspaceExisting });
        setError(null);
        return;
      }
      setPending(null);
      setError(err.detail);
    },
  });

  const check = useMutation<WorkspaceValidation, ApiError, string>({
    mutationFn: (path) => api.validateWorkspace(path),
    onSuccess: (res) => setTest(res),
    onError: (err) => setTest({ ok: false, path: null, code: err.code, error: err.detail, writable: false, free_gb: null, total_gb: null, existing: null }),
  });

  const ws = q.data;
  const busy = save.isPending || check.isPending;

  return (
    <div className="field" style={{ marginTop: 14 }}>
      <div className="l">Workspace location</div>

      {q.isError && <div className="home-sub">The API is offline, so the workspace folder cannot be read.</div>}

      {ws && (
        <div className="rows" style={{ marginBottom: 8 }}>
          <div className="r"><span className="k">Current folder</span><span className="v mono" data-testid="workspace-path">{ws.path}</span></div>
          <div className="r"><span className="k">Set by</span><span className="v">{sourceLabel(ws.source)}</span></div>
          <div className="r"><span className="k">Free space</span>
            <span className="v">{ws.free_gb != null ? `${ws.free_gb.toFixed(0)} GB of ${ws.total_gb?.toFixed(0) ?? "?"} GB` : "n/a"}</span></div>
          <div className="r"><span className="k">Writable</span>
            <span className="v"><span className={`chip ${ws.writable ? "ok" : "err"}`}>{ws.writable ? "yes" : "no"}</span></span></div>
        </div>
      )}

      {ws && ws.state !== "ok" && (
        <div className="home-sub" role="alert" style={{ color: "var(--d10-danger, #e5484d)", marginBottom: 8 }}>
          {ws.error} Labs are not built anywhere else until this is fixed.
        </div>
      )}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <input
          className="mono"
          style={{ flex: 1, minWidth: 220 }}
          value={draft}
          placeholder={`Full path, for example ${placeholder}`}
          aria-label="New workspace folder"
          onChange={(e) => {
            setDraft(e.target.value);
            setTest(null);
            setError(null);
          }}
        />
        <button className="btn" type="button" disabled={busy || !draft.trim()} onClick={() => check.mutate(draft)}>
          Test path
        </button>
        <button
          className="btn primary"
          type="button"
          disabled={busy || !draft.trim()}
          onClick={() => save.mutate({ path: draft })}
        >
          Save
        </button>
        {ws && ws.source === "settings" && (
          <button className="btn" type="button" disabled={busy} onClick={() => save.mutate({ path: null })}>
            Use default
          </button>
        )}
      </div>
      <div className="home-sub" style={{ marginTop: 6 }}>
        The folder must already exist and be one you can write to. Pick a drive with plenty of room; it cannot be inside the
        LabForge source folder or an operating system folder. Docker keeps its own images in Docker&apos;s data folder, which is
        shown on Home and set in Docker&apos;s settings.
      </div>

      {test && (
        <div className="home-sub" role="status" style={{ marginTop: 6 }}>
          {test.ok
            ? `Looks good: ${test.path} is writable, ${test.free_gb?.toFixed(0) ?? "?"} GB free.${
                test.existing && test.existing.entries > 0 ? ` It already contains ${test.existing.entries} item(s).` : ""
              }`
            : test.error}
        </div>
      )}
      {error && (
        <div className="home-sub" role="alert" style={{ marginTop: 6, color: "var(--d10-danger, #e5484d)" }}>
          {error}
        </div>
      )}

      {pending && (
        <div className="scard" role="alertdialog" aria-label="Existing labs found" style={{ marginTop: 10 }}>
          <div className="eyebrow">Existing labs found</div>
          <p style={{ margin: "6px 0" }}>
            {pending.existing.path} holds {pending.existing.labs} lab(s) and {pending.existing.entries} item(s)
            (about {Math.round(pending.existing.size_mb)} MB). Move them to the new folder, or leave them where they are and
            start fresh? Labs that are running or building must be stopped before a move.
          </p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button className="btn primary" type="button" disabled={busy}
              onClick={() => save.mutate({ path: pending.path, existing: "move" })}>Move them</button>
            <button className="btn" type="button" disabled={busy}
              onClick={() => save.mutate({ path: pending.path, existing: "leave" })}>Leave them, start fresh</button>
            <button className="btn" type="button" disabled={busy} onClick={() => setPending(null)}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
