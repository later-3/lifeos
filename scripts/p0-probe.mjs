#!/usr/bin/env node
// P0 探针：ui-contract 的 red 有多少来自「环境主题」，有多少是真缺陷。
// 只读：不点任何会改状态的东西（不 hover 会话行、不发送）。
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const APP_URL = process.env.APP_URL ?? "http://localhost:5176";
const CANDIDATES = [
  process.env.PLAYWRIGHT_CORE,
  join(process.cwd(), "frontend/node_modules/playwright-core/index.js"),
  join(homedir(), ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright-core/index.js"),
].filter(Boolean);
let pw;
for (const c of CANDIDATES) { if (existsSync(c)) { const m = await import(c); pw = m.default ?? m; break; } }
if (!pw) throw new Error("找不到 playwright-core");
const browser = await pw.chromium.launch({ headless: true, executablePath: pw.chromium.executablePath(), args: ["--no-proxy-server"] });

const report = {};
for (const mode of ["light", "dark"]) {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  // 摘掉服务端 theme：ui.json 的 dark 会盖掉 localStorage 预置
  await ctx.route("**/api/ui-prefs", (r) => r.fulfill({
    status: 200, contentType: "application/json",
    body: JSON.stringify({ display: {}, badges: {}, selection: { copyOnSelect: true } }),
  }));
  await ctx.addInitScript((m) => {
    localStorage.setItem("lifeos.theme", JSON.stringify({ mode: m, preset: "cool", accentH: 221, accentC: 62, lockNeutral: true, neutralC: 10, lSurface: 100, lNav: 96.9, lRail: 93, lLine: 89.4, hoverD: 4.2, selRatio: 2 }));
    localStorage.removeItem("lifeos.themePackActive");
  }, mode);
  const page = await ctx.newPage();
  await page.goto(APP_URL, { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  const data = await page.evaluate(() => {
    const canvas = document.createElement("canvas"); canvas.width = canvas.height = 1;
    const ctx2 = canvas.getContext("2d");
    const toRgb = (color) => { ctx2.clearRect(0, 0, 1, 1); ctx2.fillStyle = "#fff"; ctx2.fillStyle = color; ctx2.fillRect(0, 0, 1, 1); const d = ctx2.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2]]; };
    const lum = (rgb) => rgb.map((v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }).reduce((s, c, i) => s + c * [0.2126, 0.7152, 0.0722][i], 0);
    const ratio = (a, b) => { const x = lum(toRgb(a)), y = lum(toRgb(b)); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
    const bgOf = (el) => { for (let n = el; n !== null; n = n.parentElement) { const v = getComputedStyle(n).backgroundColor; if (v !== "rgba(0, 0, 0, 0)") return v; } return "rgb(255,255,255)"; };
    const L = (c) => { const [r, g, b] = toRgb(c).map((v) => v / 255); const f = (v) => v <= 0.04039 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; const Y = 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); return Y > 0.008856 ? 116 * Math.cbrt(Y) - 16 : 903.3 * Y; };

    // 文本对比度：复刻 ui-contract 的口径
    const low = [];
    const clipped = [];
    for (const el of document.querySelectorAll("body *")) {
      const box = el.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) continue;
      if (el.children.length === 0 && (el.textContent ?? "").trim() !== "") {
        const st = getComputedStyle(el);
        const r = ratio(st.color, bgOf(el));
        if (r < 4.5) low.push({ text: el.textContent.trim().slice(0, 12), ratio: Math.round(r * 100) / 100, cls: el.className?.toString().slice(0, 60) });
        if (el.scrollHeight > box.height + 1 && st.overflow === "hidden") clipped.push({ text: el.textContent.trim().slice(0, 12), cls: el.className?.toString().slice(0, 60) });
      }
    }
    // rail 三件
    let railEl = document.querySelector('nav[aria-label="左侧图标轨"]');
    const navBg = railEl === null ? null : (() => { for (let n = railEl; n !== null; n = n.parentElement) { const v = getComputedStyle(n).backgroundColor; if (v !== "rgba(0, 0, 0, 0)") return v; } return null; })();
    const buttons = railEl === null ? [] : [...railEl.querySelectorAll("button")].map((b) => ({ label: b.getAttribute("aria-label"), active: b.getAttribute("data-active") === "true" || b.className.includes("bg-nav-selected"), bg: getComputedStyle(b).backgroundColor, fg: getComputedStyle(b).color }));
    return {
      mode: document.documentElement.dataset.themeMode,
      lowContrast: low.slice(0, 8),
      clipped: clipped.slice(0, 8),
      navBg, navBgL: navBg === null ? null : L(navBg),
      railButtons: buttons.slice(0, 6).map((b) => ({ ...b, L: L(b.bg), fgL: L(b.fg) })),
    };
  });
  report[mode] = data;
  await page.close();
  await ctx.close();
}
await browser.close();
console.log(JSON.stringify(report, null, 2));
