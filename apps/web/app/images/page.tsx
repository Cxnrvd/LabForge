"use client";

/**
 * Image library: every Docker image, Windows base image, golden image and
 * Vagrant box the templates need, with status and actions.
 */

import * as React from "react";
import { toast } from "sonner";

import { useTemplates } from "@/lib/api/hooks";
import {
  formatSize,
  useImageActions,
  useImages,
  type ImageEntry,
  type ImageKind,
  type ImageStatus,
} from "@/lib/api/images";

const KIND_LABEL: Record<ImageKind, string> = {
  docker: "Container",
  "windows-base": "Windows base",
  golden: "Golden image",
  "vagrant-box": "Vagrant box",
};

const STATUS_CHIP: Record<ImageStatus, { cls: string; text: string }> = {
  ready: { cls: "ok", text: "Ready" },
  missing: { cls: "warn", text: "Not downloaded" },
  pulling: { cls: "info", text: "Downloading" },
  outdated: { cls: "warn", text: "Update available" },
};

function ago(iso?: string | null): string {
  if (!iso) return "never";
  const ms = Date.now() - new Date(iso).getTime();
  if (isNaN(ms)) return "n/a";
  const d = Math.floor(ms / 86_400_000);
  if (d >= 1) return `${d}d ago`;
  const h = Math.floor(ms / 3_600_000);
  return h >= 1 ? `${h}h ago` : "just now";
}

export default function ImagesPage(): React.ReactElement {
  const imagesQ = useImages();
  const templatesQ = useTemplates();
  const { pull, remove, prepare, golden } = useImageActions();
  const [kind, setKind] = React.useState<ImageKind | "all">("all");
  const [tpl, setTpl] = React.useState("");

  const data = imagesQ.data;
  const all = data?.images ?? [];
  const rows = all.filter((i) => kind === "all" || i.kind === kind);
  const ready = all.filter((i) => i.status === "ready").length;
  const missing = all.filter((i) => i.status === "missing").length;
  const updates = all.filter((i) => i.status === "outdated").length;
  const sizeOnDisk = all.filter((i) => i.status !== "missing").reduce((a, i) => a + i.size_mb, 0);

  const fail = (e: Error): void => void toast.error("That did not work", { description: e.message });
  const run = (fn: () => void): void => fn();

  const counts: Record<string, number> = { all: all.length };
  for (const i of all) counts[i.kind] = (counts[i.kind] ?? 0) + 1;

  return (
    <div className="home">
      <div className="home-head">
        <div style={{ flex: 1 }}>
          <h1 className="home-title">Images</h1>
          <div className="home-sub">Download once, launch fast. Labs reuse everything listed here.</div>
        </div>
      </div>

      {data?.sample && (
        <div className="scard" style={{ padding: "12px 18px", flexDirection: "row", gap: 10, alignItems: "center" }}>
          <span className="chip warn">Sample data</span>
          <span className="home-sub" style={{ margin: 0 }}>
            The image service is not running on this API yet, so these rows are examples and the buttons will report that.
          </span>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 14 }}>
        <div className="scard"><div className="eyebrow">Ready</div><div className="big">{ready}</div></div>
        <div className="scard"><div className="eyebrow">Not downloaded</div><div className="big">{missing}</div></div>
        <div className="scard"><div className="eyebrow">Updates</div><div className="big">{updates}</div></div>
        <div className="scard"><div className="eyebrow">On disk</div><div className="big">{formatSize(sizeOnDisk)}</div></div>
      </div>

      <div className="scard">
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
          <div className="eyebrow" style={{ flex: 1, minWidth: 160 }}>Prepare a template ahead of time</div>
          <select
            className="field"
            value={tpl}
            onChange={(e) => setTpl(e.target.value)}
            aria-label="Template"
            style={{ minWidth: 240, padding: "8px 10px" }}
          >
            <option value="">Choose a template</option>
            {(templatesQ.data ?? []).map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
          <button
            type="button"
            className="btn primary"
            disabled={!tpl || prepare.isPending}
            onClick={() =>
              prepare.mutate(tpl, {
                onSuccess: () => toast.success("Downloading what is missing", { description: "Watch progress below." }),
                onError: fail,
              })
            }
          >
            {prepare.isPending ? "Queuing" : "Download missing images"}
          </button>
        </div>
      </div>

      <div className="scard" style={{ padding: 0 }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, padding: "18px 22px 10px" }}>
          {(["all", "docker", "windows-base", "golden", "vagrant-box"] as const).map((k) => (
            <button
              key={k}
              type="button"
              className={`chip ${kind === k ? "info" : ""}`}
              onClick={() => setKind(k)}
              style={{ border: 0, cursor: "pointer" }}
            >
              {k === "all" ? "All" : KIND_LABEL[k]} · {counts[k] ?? 0}
            </button>
          ))}
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="mtable">
            <thead>
              <tr><th>Image</th><th>Type</th><th>Size</th><th>Status</th><th>Used by</th><th>Updated</th><th /></tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr><td colSpan={7} style={{ color: "var(--d10-fg-dim)" }}>Nothing here yet.</td></tr>
              )}
              {rows.map((i: ImageEntry) => {
                const chip = STATUS_CHIP[i.status];
                return (
                  <tr key={i.id}>
                    <td className="nm">
                      {i.name}
                      {i.tag && <span className="mono" style={{ color: "var(--d10-fg-dim)", marginLeft: 6 }}>{i.tag}</span>}
                      {i.note && <div className="home-sub" style={{ fontWeight: 400, maxWidth: 360 }}>{i.note}</div>}
                    </td>
                    <td>{KIND_LABEL[i.kind]}</td>
                    <td>{formatSize(i.size_mb)}</td>
                    <td>
                      <span className={`chip ${chip.cls}`}>{chip.text}{i.status === "pulling" && i.progress != null ? ` ${Math.round(i.progress)}%` : ""}</span>
                    </td>
                    <td>{i.used_by.join(", ") || "none"}</td>
                    <td>{ago(i.updated_at)}</td>
                    <td style={{ whiteSpace: "nowrap", textAlign: "right" }}>
                      {(i.status === "missing" || i.status === "outdated") && (
                        <button type="button" className="btn" onClick={() => run(() => pull.mutate(i.id, { onError: fail }))}>
                          {i.status === "missing" ? "Download" : "Update"}
                        </button>
                      )}{" "}
                      {i.kind === "windows-base" && i.status === "ready" && (
                        <button
                          type="button"
                          className="btn"
                          onClick={() => run(() => golden.mutate({ source_id: i.id, name: `${i.name} golden` }, {
                            onSuccess: () => toast.success("Saving a golden image"),
                            onError: fail,
                          }))}
                        >
                          Save as golden
                        </button>
                      )}{" "}
                      {i.status === "ready" && (
                        <button type="button" className="btn danger" onClick={() => run(() => remove.mutate(i.id, { onError: fail }))}>
                          Remove
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="scard">
        <div className="eyebrow">About Windows images</div>
        <p className="home-sub" style={{ marginTop: 6, maxWidth: 720 }}>
          A Windows base image is downloaded from Microsoft the first time a Windows machine boots. A golden image is a saved copy of that
          machine after setup, so later labs start in minutes instead of reinstalling. Windows images stay on this computer and are not
          meant to be shared or uploaded anywhere.
        </p>
      </div>
    </div>
  );
}
