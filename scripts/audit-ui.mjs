#!/usr/bin/env node
/**
 * UI 体检报告（前端开发路径 · 定期节奏用）。
 * 契约测试拦"改坏"，这个报告看"有没有悄悄长出新花样"：
 * 字号种类、圆角种类、颜色种类、图标尺寸种类、小命中区、最差对比度、聊天列宽度、折叠成本。
 *
 * 用法：pnpm audit:ui            # 默认 1600，可 APP_URL=... pnpm audit:ui
 * 判据（数量只能降不能涨）：字号 ≤ 5、圆角 ≤ 5（inner/control/panel/bubble/full）、文字色 ≤ 6、图标尺寸 ≤ 4（14/16/18/22）、小命中区 = 0。
 */
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const APP_URL = process.env.APP_URL ?? "http://localhost:5173";
const CANDIDATES = [
  process.env.PLAYWRIGHT_CORE,
  join(HERE, "../frontend/node_modules/playwright-core/index.js"),
  "/Users/xulater/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright-core/index.js",
].filter(Boolean);

let playwright;
for (const candidate of CANDIDATES) {
  if (!existsSync(candidate)) continue;
  const module = await import(candidate);
  playwright = module.default ?? module;
  break;
}
if (playwright === undefined) throw new Error("找不到 playwright-core：设置 PLAYWRIGHT_CORE=...");

const browser = await playwright.chromium.launch({
  headless: true, executablePath: playwright.chromium.executablePath(), args: ["--no-proxy-server"],
});

const report = {};
for (const viewport of [1024, 1280, 1440, 1600]) {
  const page = await browser.newPage({ viewport: { width: viewport, height: 900 }, deviceScaleFactor: 1 });
  await page.clock.install({ time: new Date("2026-10-18T12:00:00+08:00") });
  await page.goto(APP_URL, { waitUntil: "networkidle" });
  await page.waitForTimeout(600);
  const data = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const ctx = canvas.getContext("2d");
    const toRgb = (color) => {
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = "#fff"; ctx.fillStyle = color; ctx.fillRect(0, 0, 1, 1);
      const d = ctx.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2]];
    };
    const lum = (rgb) => rgb.map((v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; })
      .reduce((sum, c, index) => sum + c * [0.2126, 0.7152, 0.0722][index], 0);
    const ratio = (a, b) => { const x = lum(toRgb(a)), y = lum(toRgb(b)); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
    const bgOf = (el) => { for (let node = el; node !== null; node = node.parentElement) { const v = getComputedStyle(node).backgroundColor; if (v !== "rgba(0, 0, 0, 0)") return v; } return "rgb(255,255,255)"; };

    const fontSizes = new Set(), radii = new Set(), textColors = new Set(), borderColors = new Set(), iconSizes = new Set();
    const contrastPairs = [];
    for (const el of document.querySelectorAll("body *")) {
      const style = getComputedStyle(el);
      const box = el.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) continue;
      if (style.borderRadius !== "0px") radii.add(style.borderRadius);
      if (style.borderTopWidth === "1px" && style.borderTopStyle === "solid") borderColors.add(style.borderTopColor);
      if (el.tagName === "svg") iconSizes.add(`${Math.round(box.width)}×${Math.round(box.height)}`);
      if (el.children.length === 0 && (el.textContent ?? "").trim() !== "") {
        fontSizes.add(style.fontSize);
        textColors.add(style.color);
        contrastPairs.push({ text: (el.textContent ?? "").trim().slice(0, 10), value: ratio(style.color, bgOf(el)) });
      }
    }
    const small = [...document.querySelectorAll("button, [role=button], a[href]")]
      .filter((el) => { const b = el.getBoundingClientRect(); return b.width > 0 && b.height > 0 && (b.width < 28 || b.height < 28); }).length;
    const rail = [...document.querySelectorAll('nav[aria-label="收起的列"]')].reduce((sum, el) => sum + Math.round(el.getBoundingClientRect().width), 0);
    const chat = Math.round(document.querySelector("header").parentElement.getBoundingClientRect().width);
    contrastPairs.sort((a, b) => a.value - b.value);
    return {
      fontSizes: [...fontSizes].sort(), radii: [...radii].sort(), textColorCount: textColors.size,
      borderColorCount: borderColors.size, iconSizes: [...iconSizes].sort(), smallTargets: small,
      rail, chat, worstContrast: contrastPairs[0] ?? null,
    };
  });
  report[viewport] = data;
  await page.close();
}
await browser.close();

const LIMITS = { fontSizes: 5, radii: 5, textColorCount: 6, iconSizes: 4, smallTargets: 0 };
let violations = 0;
console.log("UI 体检报告（数量只应下降）\n");
for (const [viewport, data] of Object.entries(report)) {
  console.log(`视口 ${viewport}：聊天列 ${data.chat}px · 折叠轨 ${data.rail}px · 最差对比度 ${data.worstContrast === null ? "—" : `${data.worstContrast.value.toFixed(2)}:1（${data.worstContrast.text}）`}`);
  console.log(`  字号 ${data.fontSizes.length} 种 ${data.fontSizes.join(" / ")}`);
  console.log(`  圆角 ${data.radii.length} 种 ${data.radii.join(" / ")}`);
  console.log(`  文字色 ${data.textColorCount} 种 · 边框色 ${data.borderColorCount} 种 · 图标尺寸 ${data.iconSizes.length} 种 ${data.iconSizes.join(" ")}`);
  console.log(`  小命中区 ${data.smallTargets} 个`);
}
const first = report["1600"];
for (const [key, limit] of Object.entries(LIMITS)) {
  const value = Array.isArray(first[key]) ? first[key].length : first[key];
  if (value > limit) { violations += 1; console.log(`\n✖ ${key} = ${value} > 上限 ${limit}`); }
}
if (violations > 0) { console.log("\n出现新花样：先归并进 token/primitive，再继续开发。"); process.exit(1); }
console.log("\n风格收敛：所有计数在上限内。");
