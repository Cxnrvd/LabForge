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

async function main() {
  let spec;
  try {
    const res = await fetch(specUrl);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    spec = await res.text();
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
  const result = spawnSync(
    "npx",
    ["--yes", "openapi-typescript@^7", "-", "-o", outPath],
    { input: spec, stdio: ["pipe", "inherit", "inherit"] },
  );
  if (result.status !== 0) {
    console.error("[generate-api-types] openapi-typescript failed");
    process.exit(result.status ?? 1);
  }
  console.log(`[generate-api-types] wrote ${outPath}`);
}

main();
