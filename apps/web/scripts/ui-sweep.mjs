#!/usr/bin/env node
/**
 * Visit every sidebar route (and a few more) in light and dark at two sizes.
 * Fails on console errors, failed requests, HTTP errors, horizontal page scroll, a missing
 * sidebar highlight, or a missing page heading. Screenshots go to .audit-shots/ui/<theme>-<width>/.
 *
 *   pnpm ui:sweep                       (web on http://127.0.0.1:3000)
 *   WEB=http://127.0.0.1:3100 LAB_ID=2 pnpm ui:sweep
 *   CHROME=C:/path/to/chrome.exe pnpm ui:sweep    (otherwise Playwright's own browser is used)
 */
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const WEB = process.env.WEB ?? "http://127.0.0.1:3000";
const OUT = process.env.OUT ?? path.join(root, ".audit-shots", "ui");

const SIDEBAR = [
  ["/", "Home"],
  ["/build", "Canvas"],
  ["/labs", "Labs"],
  ["/monitor", "Monitor"],
  ["/templates", "Templates"],
  ["/vendors", "Vendors"],
  ["/images", "Images"],
  ["/cves", "CVEs"],
  ["/build/validate", "Validation"],
  ["/build/generate", "Launch"],
  ["/settings", "Settings"],
  ["/onboard", "CLI Agent"],
  ["/doctor", "API Docs"],
];
const EXTRA = ["/learn", "/design-system", "/states", "/this-page-does-not-exist"];

function findChrome() {
  if (process.env.CHROME) return process.env.CHROME;
  const base = path.join(process.env.LOCALAPPDATA ?? path.join(homedir(), ".cache"), "ms-playwright");
  if (!existsSync(base)) return undefined;
  const dir = readdirSync(base).filter((d) => d.startsWith("chromium_headless_shell-")).sort().pop();
  if (!dir) return undefined;
  for (const sub of ["chrome-headless-shell-win64/chrome-headless-shell.exe", "chrome-headless-shell-linux/chrome-headless-shell"]) {
    const p = path.join(base, dir, sub);
    if (existsSync(p)) return p;
  }
  return undefined;
}

async function labId() {
  if (process.env.LAB_ID) return process.env.LAB_ID;
  try {
    const labs = await (await fetch(`${WEB}/api/v1/labs`)).json();
    return labs[0]?.id ? String(labs[0].id) : null;
  } catch {
    return null;
  }
}

const failures = [];
const browser = await chromium.launch({ executablePath: findChrome() });
const id = await labId();
const routes = [...SIDEBAR.map(([p, l]) => ({ path: p, label: l, sidebar: true })), ...EXTRA.map((p) => ({ path: p }))];
if (id) routes.push({ path: `/labs/${id}` }, { path: `/monitor/${id}` });

for (const theme of ["light", "dark"]) {
  for (const [w, h] of [[1440, 900], [1024, 768]]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h } });
    await ctx.addInitScript((t) => {
      try {
        localStorage.setItem("theme", t);
        localStorage.setItem("labforge.tour.done", "1");
      } catch {
        /* storage blocked */
      }
    }, theme);
    const dir = path.join(OUT, `${theme}-${w}`);
    mkdirSync(dir, { recursive: true });
    for (const r of routes) {
      const page = await ctx.newPage();
      const problems = [];
      page.on("console", (m) => m.type() === "error" && !/404 \(Not Found\)/.test(m.text()) && problems.push(`console: ${m.text().slice(0, 160)}`));
      page.on("pageerror", (e) => problems.push(`pageerror: ${String(e).slice(0, 160)}`));
      page.on("requestfailed", (q) => {
        const why = q.failure()?.errorText ?? "";
        if (!/ERR_ABORTED/.test(why)) problems.push(`request failed: ${q.method()} ${q.url()} ${why}`);
      });
      page.on("response", (q) => {
        if (q.status() >= 400 && !r.path.includes("does-not-exist")) problems.push(`HTTP ${q.status()}: ${q.url()}`);
      });
      const resp = await page.goto(WEB + r.path, { waitUntil: "networkidle", timeout: 60000 }).catch((e) => {
        problems.push(`goto: ${String(e).slice(0, 120)}`);
        return null;
      });
      await page.waitForTimeout(1200);
      const dismiss = page.locator('button:has-text("Skip tour")').first();
      if (await dismiss.count()) await dismiss.click().catch(() => {});
      const info = await page.evaluate(() => ({
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        theme: document.querySelector(".lf")?.getAttribute("data-theme"),
        heading: document.querySelector("h1")?.textContent?.trim() ?? null,
        active: [...document.querySelectorAll(".sidebar a")]
          .filter((a) => a.classList.contains("act") || a.classList.contains("active") || a.getAttribute("aria-current") === "page")
          .map((a) => a.getAttribute("href")),
      }));
      if (info.overflow > 1) problems.push(`horizontal scroll of ${info.overflow}px`);
      if (info.theme && info.theme !== theme) problems.push(`theme is ${info.theme}, wanted ${theme}`);
      if (r.sidebar && !info.active.includes(r.path)) problems.push(`sidebar highlight is ${JSON.stringify(info.active)}, wanted ${r.path}`);
      if (resp && resp.status() >= 500) problems.push(`status ${resp.status()}`);
      const name = (r.path === "/" ? "home" : r.path.slice(1).replace(/\//g, "_")) + ".png";
      await page.screenshot({ path: path.join(dir, name), fullPage: false }).catch(() => {});
      for (const p of [...new Set(problems)]) failures.push(`${theme} ${w} ${r.path}: ${p}`);
      console.log(`${problems.length ? "FAIL" : "ok  "} ${theme} ${w} ${r.path}`);
      await page.close();
    }
    await ctx.close();
  }
}
await browser.close();
if (failures.length) {
  console.error(`\n${failures.length} problem(s):\n` + failures.map((f) => ` - ${f}`).join("\n"));
  process.exit(1);
}
console.log("\nall routes clean");
