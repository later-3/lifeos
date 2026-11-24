import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
const REPO = process.cwd();
const APP_URL = process.env.APP_URL ?? "http://127.0.0.1:5180";
async function loadPlaywright() {
  for (const c of [process.env.PLAYWRIGHT_CORE, join(REPO,"node_modules/playwright-core/index.js"), join(REPO,"node_modules/playwright/index.js"), join(homedir(),".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright-core/index.js")].filter(Boolean)) {
    if (!existsSync(c)) continue; const m = await import(c); return m.default ?? m;
  }
  throw new Error("no pw");
}
const pw = await loadPlaywright();
const b = await pw.chromium.launch({ headless: true, args:["--no-proxy-server"] });
const ctx = await b.newContext({ viewport:{width:1600,height:900} });
const page = await ctx.newPage();
const list = await (await fetch(`${APP_URL}/api/agents/lifeosagent/projects/workspace/sessions`)).json();
const t=(i)=>i.counts?.total??0;
const sid=[...(list.items??[])].filter(i=>i.isDefault!==true&&t(i)>0).sort((a,b)=>t(b)-t(a))[0]?.sessionId;
await page.goto(`${APP_URL}/?agent=lifeosagent&project=workspace&session=${sid}`, {waitUntil:"networkidle"});
await page.waitForTimeout(1500);
const s = await page.evaluate(() => {
  const bar = document.querySelector('[data-testid="session-bar"]');
  const r = bar?.getBoundingClientRect();
  const attach = bar?.querySelector('[data-testid="attach-image"]');
  const ar = attach?.getBoundingClientRect();
  return {
    barBox: r ? `${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}x${Math.round(r.height)}` : null,
    barHTML: bar ? [...bar.querySelectorAll("button,span,p")].map(e => { const b2=e.getBoundingClientRect(); return `${e.tagName}:${e.getAttribute("aria-label")??e.textContent?.trim().slice(0,10)} ${Math.round(b2.x)},${Math.round(b2.y)} ${Math.round(b2.width)}x${Math.round(b2.height)}`; }) : null,
    attachBox: ar ? `${Math.round(ar.x)},${Math.round(ar.y)} ${Math.round(ar.width)}x${Math.round(ar.height)}` : null,
    turns: null,
  };
});
console.log(JSON.stringify(s, null, 1));
await b.close();
