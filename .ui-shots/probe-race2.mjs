/**
 * 复刻 ui-contract 的 capture 时序，量「composer 里那个添加图片按钮」在**截图那一刻**在不在。
 * 若多次运行有时在有时不在 → empty.png 是个竞态基线（不是"我改了视觉"）。
 */
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
const browser = await pw.chromium.launch({ headless: true, args:["--no-proxy-server","--font-render-hinting=none","--disable-lcd-text"] });
const list = await (await fetch(`${APP_URL}/api/agents/lifeosagent/projects/workspace/sessions`)).json();
const t=(i)=>i.counts?.total??0;
const sid=[...(list.items??[])].filter(i=>i.isDefault!==true&&t(i)>0).sort((a,b)=>t(b)-t(a))[0]?.sessionId;

for (let run = 1; run <= 6; run += 1) {
  const ctx = await browser.newContext({ viewport:{width:1600,height:900}, deviceScaleFactor:1 });
  await ctx.route("**/api/ui-prefs", async (route) => {
    if (route.request().method() !== "GET") return route.fulfill({status:200,contentType:"application/json",body:"{}"});
    try { const res = await route.fetch(); const body = await res.json().catch(()=>({})); delete body.theme; delete body.display; await route.fulfill({response:res, body: JSON.stringify(body)}); } catch {}
  });
  await ctx.addInitScript(() => {
    localStorage.setItem("lifeos.theme", JSON.stringify({preset:"cool",mode:"light",accentH:221,accentC:0,lockNeutral:true,neutralC:4,lSurface:100,lNav:96.9,lRail:93,lLine:89.4,hoverD:4.2,selRatio:2}));
    localStorage.removeItem("lifeos.themePackActive");
    localStorage.setItem("lifeos.displayPrefs", JSON.stringify({width:{mode:"limited",value:860},font:{scale:1}}));
  });
  const page = await ctx.newPage();
  await page.clock.install({ time: new Date("2026-10-18T12:00:00+08:00") });
  const t0 = Date.now();
  await page.goto(`${APP_URL}/?agent=lifeosagent&project=workspace&session=${sid}`, { waitUntil:"networkidle" });
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    document.querySelector('nav[aria-label="左侧图标轨"] button[aria-label="收起助手"]')?.click();
    document.querySelector('nav[aria-label="左侧图标轨"] button[aria-label="收起对话"]')?.click();
  });
  await page.waitForTimeout(300);   // settle 的 300ms
  const state = await page.evaluate(() => {
    const c = document.querySelector('[data-testid="composer"]');
    const attach = c?.querySelector('[data-testid="attach-image"]');
    const bar = document.querySelector('[data-testid="session-bar"]');
    return { inComposer: attach !== null, hasBar: bar !== null };
  });
  console.log(`run ${run}: 截图时刻=${Date.now()-t0}ms · composer 内有添加图片=${state.inComposer} · SessionBar 已渲染=${state.hasBar}`);
  await ctx.close();
}
await browser.close();
