#!/usr/bin/env node
/**
 * Dump the Zod LabConfig schema as JSON Schema.
 *
 * Used by the CI sync check: this file's output is diffed against the
 * Pydantic export (`python -m labforge_schema.export_json_schema`). If
 * they diverge the build fails — that's the safety net that catches
 * "someone updated Zod but not Pydantic" before it ships.
 *
 * Run:
 *   node scripts/export-zod-schema.mjs > zod-schema.json
 */
import { zodToJsonSchema } from "zod-to-json-schema";
import { LabConfig } from "../src/index.ts";

const schema = zodToJsonSchema(LabConfig, {
  $refStrategy: "none",
});
process.stdout.write(JSON.stringify(schema, null, 2) + "\n");
