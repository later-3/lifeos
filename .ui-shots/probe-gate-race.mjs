/**
 * empty.png 到底在比什么：**同一份代码，两种时间点**。
 *
 * 假设：`composer` 里那个「添加图片」按钮只在 `sessionTotals.turns === 0` 时渲染
 *（`App.tsx:5137` `{(isMobile || sessionTotals.turns === 0) && …}`），turns 一到它就去 SessionBar。
 * 那么 empty.png 截到的是"turns 还没到"还是"turns 已经到"，取决于**截图时机** —— 这是个竞态。
 *
 * 做法：完全复刻 ui-contract 的 shotPageFor + empty 用例，只改一件事——
 * 采样时刻（多次截图 + 每次记录 attach 按钮在不在 composer 里、turns 是多少）。
 */
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
const browser = await pw.chromium.launch({ headless: true, executablePath: pw.chromium.executablePath(), args: ["--no-proxy-server","--font-render-hinting=none","--disable-lcd-text"] });

const list = await (await fetch(`${APP_URL}/api/agents/lifeosagent/projects/workspace/sessions`)).json();
const totalOf = (i) => i.counts?.total ?? 0;
const sid = [...(list.items ?? [])].filter((i) => i.isDefault !== true && totalOf(i) > 0).sort((a,b)=>totalOf(b)-totalOf(a))[0]?.sessionId;

const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
await ctx.route("**/api/ui-prefs", async (route) => {
  if (route.request().method() !== "GET") return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  try {
    const res = await route.fetch();
    const body = await res.json().catch(() => ({}));
    delete body.theme; delete body.display;
    await route.fulfill({ response: res, body: JSON.stringify(body) });
  } catch { /* 关页 */ }
});
await ctx.addInitScript(() => {
  localStorage.setItem("lifeos.theme", JSON.stringify({ preset:"cool", mode:"light", accentH:221, accentC:0, lockNeutral:true, neutralC:4, lSurface:100, lNav:96.9, lRail:93, lLine:89.4, hoverD:4.2, selRatio:2 }));
  localStorage.removeItem("lifeos.themePackActive");
  localStorage.setItem("lifeos.displayPrefs", JSON.stringify({ width:{mode:"limited",value:860}, font:{scale:1} }));
});
const page = await ctx.newPage();
await page.clock.install({ time: new Date("2026-10-18T12:00:00+08:00") });
await page.goto(`${APP_URL}/?agent=lifeosagent&project=workspace&session=${sid}`, { waitUntil: "networkidle" });
await page.waitForTimeout(500);
// 与 empty 用例同款：两列都收起
await page.evaluate(() => {
  document.querySelector('nav[aria-label="左侧图标轨"] button[aria-label="收起助手"]')?.click();
  document.querySelector('nav[aria-label="左侧图标轨"] button[aria-label="收起对话"]')?.click();
});
// 采样：从这一刻起，每 50ms 记一次"attach 在不在 composer 里"
const t0 = Date.now();
const samples = [];
for (let i = 0; i < 40; i += 1) {
  const s = await page.evaluate(() => {
    const c = document.querySelector('[data-testid="composer"]');
    const attach = c?.querySelector('[data-testid="attach-image"]');
    const bar = document.querySelector('[data-testid="session-bar"]');
    const r = attach?.getBoundingClientRect();
    return { inComposer: attach !== null, box: r ? `${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}x${Math.round(r.height)}` : null, hasBar: bar !== null };
  });
  samples.push({ ms: Date.now() - t0, ...s });
  await page.waitForTimeout(50);
}
const flips = [];
for (let i = 1; i < samples.length; i += 1) {
  if (samples[i].inComposer !== samples[i - 1].inComposer) flips.push(`@${samples[i].ms}ms → inComposer=${samples[i].inComposer} (bar=${samples[i].hasBar})`);
}
console.log("采样点:", samples.length, "· 区间:", samples[0].ms, "→", samples[samples.length-1].ms, "ms");
console.log("翻转:", flips.length === 0 ? "(全程稳定)" : flips.join(" | "));
console.log("首帧:", JSON.stringify(samples[0]));
console.log("末帧:", JSON.stringify(samples[samples.length-1]));
const inC = samples.filter((s) => s.inComposer).map((s) => s.ms);
console.log("attach 在 composer 里的时刻:", inC.length ? `${Math.min(...inC)}..${Math.max(...inC)}ms` : "(无)");
await browser.close();
