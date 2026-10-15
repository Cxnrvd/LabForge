#!/usr/bin/env node
// Start the API and the web app together on a port that is actually free.
// Windows (Hyper-V / WSL2 / Docker Desktop) reserves ranges of ports, and binding
// one fails with WinError 10013, so port 8000 is not always usable.
//   LABFORGE_API_PORT=8010 pnpm dev     to force a port
import { spawn, spawnSync } from "node:child_process";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const isWin = process.platform === "win32";

function canBind(port) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once("error", () => resolve(false));
    srv.listen(port, "127.0.0.1", () => srv.close(() => resolve(true)));
  });
}

async function pickPort() {
  const wanted = process.env.LABFORGE_API_PORT;
  if (wanted) return Number(wanted);
  for (const port of [8000, 8010, 8080, 8765, 18000, 28000]) {
    if (await canBind(port)) return port;
    console.log(`[dev] port ${port} is not available, trying the next one`);
  }
  throw new Error("no free port found for the API; set LABFORGE_API_PORT");
}

const port = await pickPort();
const apiUrl = `http://127.0.0.1:${port}`;
console.log(`[dev] API ${apiUrl}   web http://127.0.0.1:3000`);

const env = { ...process.env, LABFORGE_API_PORT: String(port), LABFORGE_API_URL: apiUrl };
const children = [];

function start(name, cmd, args, cwd) {
  const child = spawn(cmd, args, { cwd, env, stdio: "inherit", shell: isWin });
  children.push(child);
  child.on("exit", (code) => {
    console.log(`[dev] ${name} exited with code ${code}`);
    shutdown(code ?? 1);
  });
}

let stopping = false;
function shutdown(code) {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (child.exitCode !== null || !child.pid) continue;
    if (isWin) spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    else child.kill("SIGTERM");
  }
  setTimeout(() => process.exit(code), 500);
}
process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

// uvicorn --reload on Windows can hang on "Reloading..." forever while a keep-alive connection
// (the browser, the heartbeat daemon) is open, so code changes silently stop applying.
// Reload is opt-in:  LABFORGE_API_RELOAD=1 pnpm dev
const reload = process.env.LABFORGE_API_RELOAD === "1" ? ["--reload"] : [];
start("api", "uv", ["run", "uvicorn", "labforge_core.api.main:app", ...reload, "--timeout-graceful-shutdown", "2", "--port", String(port)], path.join(root, "apps", "api"));
start("web", "pnpm", ["--filter", "@labforge/web", "dev"], root);
