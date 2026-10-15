#!/usr/bin/env node
/**
 * Generate TypeScript types for the LabForge API from its OpenAPI spec.
 *
 * Runs as part of ``pnpm postinstall`` (see ``apps/web/package.json``)
 * so every dev gets fresh types after a checkout. Reads the spec from
 * a running uvicorn instance; falls back gracefully if the API isn't
 * up (so the install doesn't fail when the user hasn't started the
 * backend yet).
 *
 * Output: ``apps/web/lib/api/generated.ts`` — DO NOT EDIT BY HAND.
 *
 * Usage:
 *   node scripts/generate-api-types.mjs               # default URL
 *   API=http://localhost:8000 node scripts/generate-api-types.mjs
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outPath = resolve(__dirname, "..", "lib", "api", "generated.ts");
const apiBase = process.env.API ?? "http://127.0.0.1:8000";
const specUrl = `${apiBase}/openapi.json`;

// Never fail an install because of this step. It runs through cmd.exe on
// Windows, where the old `|| true` in package.json is not a command.
async function main() {
  let spec;
  try {
    const res = await fetch(specUrl, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    spec = await res.text();
    // Something else may be listening on the port (other dev servers do).
    const doc = JSON.parse(spec);
    if (!doc.openapi) throw new Error("not an OpenAPI document");
    // Port 8000 is often taken by an unrelated service that also serves /openapi.json.
    if (doc.info?.title !== "LabForge API") throw new Error(`not the LabForge API (${doc.info?.title})`);
  } catch (err) {
    console.warn(
      `[generate-api-types] skipped — could not fetch ${specUrl}: ${err.message}`,
    );
    console.warn(
      "  Start the API (pnpm dev:api) then re-run: node scripts/generate-api-types.mjs",
    );
    return;
  }

  mkdirSync(dirname(outPath), { recursive: true });
  // On Windows npx is npx.cmd, which spawn() only finds through a shell, so the
  // path needs quoting there (it can contain spaces).
  const isWin = process.platform === "win32";
  const result = spawnSync(
    "npx",
    ["--yes", "openapi-typescript@^7", "-o", isWin ? `"${outPath}"` : outPath],
    {
      input: spec,
      stdio: ["pipe", "inherit", "inherit"],
      shell: isWin,
    },
  );
  if (result.status !== 0) {
    console.warn(
      "[generate-api-types] openapi-typescript failed; keeping the existing types. " +
        "Re-run: node scripts/generate-api-types.mjs",
    );
    return;
  }
  console.log(`[generate-api-types] wrote ${outPath}`);
}

main().catch((err) => {
  console.warn(`[generate-api-types] skipped: ${err?.message ?? err}`);
});
