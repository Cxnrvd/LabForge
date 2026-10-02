import { NextResponse, type NextRequest } from "next/server";

/**
 * Runs in front of the /api/v1 proxy.
 *
 * 1. Host check. A hostile page can point its own domain at 127.0.0.1 ("DNS rebinding") and
 *    then talk to this server as if it were same-origin. Only names we expect get through.
 * 2. Token injection. When LABFORGE_AGENT_TOKEN is set (the Docker setup sets it) the server adds
 *    the bearer header itself, so the secret never reaches the browser and nobody has to paste it
 *    into Settings. Requests that already carry an Authorization header are left alone.
 */
const DEFAULT_HOSTS = ["127.0.0.1", "localhost", "[::1]", "::1"];

function allowedHosts(): string[] {
  const extra = (process.env.LABFORGE_ALLOWED_HOSTS ?? "")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  return [...DEFAULT_HOSTS, ...extra];
}

export function middleware(req: NextRequest): NextResponse {
  const host = (req.headers.get("host") ?? "").toLowerCase();
  const name = host.startsWith("[") ? host.slice(0, host.indexOf("]") + 1) : host.split(":")[0];
  if (name && !allowedHosts().includes(name)) {
    return NextResponse.json({ detail: { detail: `Host ${host} is not allowed`, code: "host_not_allowed" } }, { status: 400 });
  }

  const token = process.env.LABFORGE_AGENT_TOKEN;
  if (!token || req.headers.get("authorization")) return NextResponse.next();
  const headers = new Headers(req.headers);
  headers.set("authorization", `Bearer ${token}`);
  return NextResponse.next({ request: { headers } });
}

export const config = { matcher: "/api/v1/:path*" };
