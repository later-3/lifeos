/**
 * 决定性实验：把「会话详情」响应**压住不返回**（模拟 turns 还没到），看 composer 里是否出现那个图标。
 *
 * 若出现 → `empty.png` 的 119 px 差异是**加载竞态**（截图时 sessionTotals.turns 是 0 还是 >0），
 * 不是任何一次视觉改动；门禁该修的是"等一个确定状态"，不是刷基线。
 */
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { pixelDiff } from "/Users/xulater/.lifeos/agents/frontend-developer/projects/lifeos/tasks/0023-用户工作台前端：demo-适配当前标准（S1-形态+真数据-→-S4-收口）/repo/frontend/test/png.mjs";

const REPO = process.cwd();
const APP_URL = process.env.APP_URL ?? "http://127.0.0.1:5180";
async function loadPlaywright() {
  for (const c of [process.env.PLAYWRIGHT_CORE, join(REPO,"node_modules/playwright-core/index.js"), join(REPO,"node_modules/playwright/index.js"), join(homedir(),".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright-core/index.js")].filter(Boolean)) {
    if (!existsSync(c)) continue; const m = await import(c); return m.default ?? m;
  }
  throw new Error("no pw");
}
const pw = await loadPlaywright();
const browser = await pw.chromium.launch({ headless: true, executablePath: pw.chromium.executablePath(), args:["--no-proxy-server","--font-render-hinting=none","--disable-lcd-text"] });
const list = await (await fetch(`${APP_URL}/api/agents/lifeosagent/projects/workspace/sessions`)).json();
const t=(i)=>i.counts?.total??0;
const sid=[...(list.items??[])].filter(i=>i.isDefault!==true&&t(i)>0).sort((a,b)=>t(b)-t(a))[0]?.sessionId;

async function shot({ stallDetail }) {
  const ctx = await browser.newContext({ viewport:{width:1600,height:900}, deviceScaleFactor:1 });
  await ctx.route("**/api/ui-prefs", async (route) => {
    if (route.request().method() !== "GET") return route.fulfill({status:200,contentType:"application/json",body:"{}"});
    try { const res = await route.fetch(); const body = await res.json().catch(()=>({})); delete body.theme; delete body.display; await route.fulfill({response:res, body: JSON.stringify(body)}); } catch {}
  });
  if (stallDetail) {
    // 会话详情**永远不返回**：turns 停在 0 → composer 里应保留"添加图片"
    await ctx.route(/\/api\/agents\/[^/]+\/sessions\/[^/]+(\?.*)?$/, (route) => { void route; /* 不 fulfill，挂住 */ });
  }
  await ctx.addInitScript(() => {
    localStorage.setItem("lifeos.theme", JSON.stringify({preset:"cool",mode:"light",accentH:221,accentC:0,lockNeutral:true,neutralC:4,lSurface:100,lNav:96.9,lRail:93,lLine:89.4,hoverD:4.2,selRatio:2}));
    localStorage.removeItem("lifeos.themePackActive");
    localStorage.setItem("lifeos.displayPrefs", JSON.stringify({width:{mode:"limited",value:860},font:{scale:1}}));
  });
  const page = await ctx.newPage();
  await page.clock.install({ time: new Date("2026-10-18T12:00:00+08:00") });
  await page.goto(`${APP_URL}/?agent=lifeosagent&project=workspace&session=${sid}`, { waitUntil:"domcontentloaded" });
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    document.querySelector('nav[aria-label="左侧图标轨"] button[aria-label="收起助手"]')?.click();
    document.querySelector('nav[aria-label="左侧图标轨"] button[aria-label="收起对话"]')?.click();
  });
  await page.waitForTimeout(600);
  const st = await page.evaluate(() => {
    const c = document.querySelector('[data-testid="composer"]');
    const a = c?.querySelector('[data-testid="attach-image"]');
    const bar = document.querySelector('[data-testid="session-bar"]');
    const r = a?.getBoundingClientRect();
    return { inComposer: a !== null, box: r ? `${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}x${Math.round(r.height)}` : null, hasBar: bar !== null };
  });
  const buf = await page.screenshot({ animations:"disabled", caret:"hide", mask:[page.locator("[data-shot-mask]")], maskColor:"#fafafa" });
  await ctx.close();
  return { st, buf };
}

const base = await shot({ stallDetail:false });
const stalled = await shot({ stallDetail:true });
console.log("正常加载  :", JSON.stringify(base.st));
console.log("详情挂住  :", JSON.stringify(stalled.st));
const acc = (await import("node:fs")).readFileSync(`${REPO}/.ui-shots/b6-old-empty.png`);
console.log("vs acc1480 基线 → 正常:", (pixelDiff(acc, base.buf).ratio*100).toFixed(3)+"%", "· 详情挂住:", (pixelDiff(acc, stalled.buf).ratio*100).toFixed(3)+"%");
writeFileSync(`${REPO}/.ui-shots/probe-causal-stalled.png`, stalled.buf);
await browser.close();
