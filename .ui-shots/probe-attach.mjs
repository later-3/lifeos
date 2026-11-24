import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
const REPO = process.cwd();
const APP_URL = process.env.APP_URL ?? "http://127.0.0.1:5180";
async function loadPlaywright() {
  for (const c of [process.env.PLAYWRIGHT_CORE, join(REPO,"node_modules/playwright-core/index.js"), join(REPO,"node_modules/playwright/index.js"), join(homedir(), ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright-core/index.js")].filter(Boolean)) {
    if (!existsSync(c)) continue; const m = await import(c); return m.default ?? m;
  }
  throw new Error("no pw");
}
const pw = await loadPlaywright();
const b = await pw.chromium.launch({ headless: true, args:["--no-proxy-server"] });
const ctx = await b.newContext({ viewport: { width: 1600, height: 900 } });
const page = await ctx.newPage();
const t0 = Date.now();
await page.goto(`${APP_URL}/?agent=lifeosagent&project=workspace&session=01a18f2f-4a49-7467-abca-49a3be1fffa2`, { waitUntil: "networkidle" });
const marks = [];
for (const wait of [0, 100, 300, 600, 1000, 2000, 4000]) {
  if (wait > 0) await page.waitForTimeout(wait - (Date.now() - t0 > 0 ? 0 : 0));
  const s = await page.evaluate(() => {
    const c = document.querySelector('[data-testid="composer"]');
    const attach = c?.querySelector('[data-testid="attach-image"]');
    const bar = document.querySelector('[data-testid="session-bar"]');
    const r = attach?.getBoundingClientRect();
    return { attachInComposer: attach !== null, attachBox: r ? `${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}x${Math.round(r.height)}` : null, sessionBar: bar !== null };
  });
  marks.push({ ms: Date.now() - t0, ...s });
}
console.log(JSON.stringify(marks, null, 1));
await b.close();
