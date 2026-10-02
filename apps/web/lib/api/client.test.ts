import { afterEach, describe, expect, it, vi } from "vitest";

import { api, type ApiError } from "./client";

/**
 * Regression test for the error-parsing branch added alongside the roles schema-validation fix.
 * FastAPI's own request-validation 422s shape `detail` as an array of {loc, msg} objects, not
 * the string or {detail, code} object LabForge's own HTTPExceptions use — before this fix that
 * array landed in a toast as a raw JSON blob via JSON.stringify.
 */
describe("request() error parsing", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubFetchWith(status: number, body: unknown): void {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status,
        statusText: "Unprocessable Entity",
        json: async () => body,
      })),
    );
  }

  it("turns a FastAPI validation-error array into a readable message", async () => {
    stubFetchWith(422, {
      detail: [
        {
          loc: ["body", "topology", "nodes", 0, "config", "roles", 0],
          msg: "Value error, Invalid role 'a\"b': use letters, digits, '.', '_', '-', and an optional '@version'",
          type: "value_error",
        },
      ],
    });
    await expect(api.getCve("CVE-2021-44228")).rejects.toMatchObject({
      code: "validation_error",
      detail: "body.topology.nodes.config.roles: Invalid role 'a\"b': use letters, digits, '.', '_', '-', and an optional '@version'",
    } satisfies Partial<ApiError>);
  });

  it("joins multiple validation errors and never leaks a raw JSON blob", async () => {
    stubFetchWith(422, {
      detail: [
        { loc: ["body", "topology", "nodes", 0, "config", "ip"], msg: "Must be a valid IPv4 address" },
        { loc: ["body", "topology", "nodes", 1, "config", "hostname"], msg: "Invalid hostname" },
      ],
    });
    try {
      await api.getCve("CVE-2021-44228");
      expect.unreachable();
    } catch (err) {
      const e = err as ApiError;
      expect(e.detail).not.toMatch(/^\[/);
      expect(e.detail).toContain("Must be a valid IPv4 address");
      expect(e.detail).toContain("Invalid hostname");
    }
  });

  it("still handles LabForge's own structured {detail, code} error shape", async () => {
    stubFetchWith(409, { detail: { detail: "Lab already exists", code: "lab_exists" } });
    await expect(api.getCve("CVE-2021-44228")).rejects.toMatchObject({
      detail: "Lab already exists",
      code: "lab_exists",
    } satisfies Partial<ApiError>);
  });

  it("still handles a plain string detail", async () => {
    stubFetchWith(404, { detail: "Not found" });
    await expect(api.getCve("CVE-2021-44228")).rejects.toMatchObject({
      detail: "Not found",
    } satisfies Partial<ApiError>);
  });
});
