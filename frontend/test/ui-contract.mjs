#!/usr/bin/env node
/**
 * 视觉契约测试（前端开发路径 · 闸 3 + 闸 4）。
 *
 * 为什么存在：2026-10-18 之前，"丑"只能靠人眼发现——聊天列被压到 252px、输入框占位被裁、
 * 文本对比度 2.58:1、hover 时行内容位移、模态键盘逃逸……全部靠人工复查，一开发就回潮。
 * 这里把当时的手工体检固化成断言：改坏了就红，红了必须给理由。
 *
 * 用法：
 *   node frontend/test/ui-contract.mjs                 # 需要 dev server（默认 http://localhost:5173）
 *   APP_URL=http://127.0.0.1:5173 node ...             # 换地址
 *   node frontend/test/ui-contract.mjs --update-baseline   # 人眼确认后更新截图基线
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pixelDiff } from "./png.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASELINE_DIR = join(HERE, "ui-baseline");
const SHOT_DIR = join(HERE, "../../.ui-shots");
const APP_URL = process.env.APP_URL ?? "http://localhost:5173";
const UPDATE_BASELINE = process.argv.includes("--update-baseline");

const PLAYWRIGHT_CANDIDATES = [
  process.env.PLAYWRIGHT_CORE,
  join(HERE, "../../frontend/node_modules/playwright-core/index.js"),
  "/Users/xulater/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright-core/index.js",
].filter(Boolean);

const MIN_CHAT = 420;
const MIN_HIT = 28;
const MIN_CONTRAST = 4.5;

async function loadPlaywright() {
  for (const candidate of PLAYWRIGHT_CANDIDATES) {
    if (!existsSync(candidate)) continue;
    const module = await import(candidate);
    return module.default ?? module;
  }
  throw new Error("找不到 playwright-core：设置 PLAYWRIGHT_CORE=/path/to/playwright-core/index.js");
}

const results = [];
async function settle(page) {
  // 截图前把滚动位置归位（挂载时的 smooth scrollIntoView 会造成像素级抖动）
  await page.evaluate(() => {
    document.documentElement.style.scrollBehavior = "auto";
    const main = document.querySelector("main");
    if (main !== null) main.scrollTop = main.scrollHeight;
  });
  await page.waitForTimeout(300);
}

function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
}

async function measure(page) {
  return await page.evaluate(({ MIN_HIT, MIN_CONTRAST }) => {
    const rect = (el) => el.getBoundingClientRect();
    const visible = (el) => { const box = rect(el); return box.width > 0 && box.height > 0; };

    // 有效背景：向上找到第一个非透明背景
    const bgOf = (el) => {
      for (let node = el; node !== null; node = node.parentElement) {
        const value = getComputedStyle(node).backgroundColor;
        if (value !== "rgba(0, 0, 0, 0)" && value !== "transparent") return value;
      }
      return "rgb(255, 255, 255)";
    };
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const ctx = canvas.getContext("2d");
    const toRgb = (color) => {
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = "#fff";
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, 1, 1);
      const data = ctx.getImageData(0, 0, 1, 1).data;
      return [data[0], data[1], data[2]];
    };
    const lum = (rgb) => {
      const [r, g, b] = rgb.map((value) => {
        const channel = value / 255;
        return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const ratio = (a, b) => {
      const x = lum(toRgb(a));
      const y = lum(toRgb(b));
      return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
    };

    const chat = document.querySelector("header")?.parentElement;
    const body = document.body;
    const overflow = document.documentElement.scrollWidth > window.innerWidth + 1;
    // 折叠成本 = 导航轨容器宽度之和（不是轨上按钮之和）
    const rail = [...document.querySelectorAll('nav[aria-label="收起的列"]')]
      .reduce((sum, el) => sum + Math.round(rect(el).width), 0);

    // 竖向裁切（横向截断是 ellipsis 的正常表现，不算）
    const clipped = [];
    for (const el of document.querySelectorAll("body *")) {
      if (!visible(el)) continue;
      const style = getComputedStyle(el);
      if (style.overflowY === "auto" || style.overflowY === "scroll") continue;
      if (el.closest("[data-no-clip-check]") !== null) continue;
      // 只看"承载文字的元素"（叶子节点或输入类控件）：容器裁切是布局手段，不是缺陷
      const isTextLeaf = el.children.length === 0 && (el.textContent ?? "").trim() !== "";
      const isField = el.tagName === "TEXTAREA" || el.tagName === "INPUT";
      if (!isTextLeaf && !isField) continue;
      if (el.scrollHeight > el.clientHeight + 2 && el.clientHeight > 0) {
        clipped.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 28)}`);
      }
    }

    // 对比度
    const lowContrast = [];
    for (const el of document.querySelectorAll("body *")) {
      if (!visible(el) || el.children.length > 0) continue;
      const text = (el.textContent ?? "").trim();
      if (text === "") continue;
      const style = getComputedStyle(el);
      if (style.visibility === "hidden" || Number(style.opacity) < 0.9) continue;
      const size = Number.parseFloat(style.fontSize);
      const need = size >= 22 ? 3 : MIN_CONTRAST;
      const value = ratio(style.color, bgOf(el));
      if (value < need) lowContrast.push(`${text.slice(0, 12)} (${value.toFixed(2)}:1)`);
    }

    // 命中区
    const smallTargets = [];
    for (const el of document.querySelectorAll("button, [role=button], a[href]")) {
      if (!visible(el)) continue;
      const box = rect(el);
      if (box.width < MIN_HIT || box.height < MIN_HIT) {
        smallTargets.push(`${(el.getAttribute("aria-label") ?? el.textContent ?? "").trim().slice(0, 14)} ${Math.round(box.width)}×${Math.round(box.height)}`);
      }
    }

    return {
      viewport: window.innerWidth,
      chatWidth: chat === undefined || chat === null ? 0 : Math.round(rect(chat).width),
      overflow,
      rail,
      clipped,
      lowContrast,
      smallTargets,
      dialogCount: document.querySelectorAll('[role="dialog"][aria-modal="true"]').length,
      bodyFont: getComputedStyle(body).fontFamily.split(",")[0],
    };
  }, { MIN_HIT, MIN_CONTRAST });
}

const playwright = await loadPlaywright();
const browser = await playwright.chromium.launch({
  headless: true,
  executablePath: playwright.chromium.executablePath(),
  args: ["--no-proxy-server", "--font-render-hinting=none", "--disable-lcd-text"],
});

mkdirSync(SHOT_DIR, { recursive: true });
mkdirSync(BASELINE_DIR, { recursive: true });

const FROZEN_TIME = new Date("2026-10-18T12:00:00+08:00");   // 冻结时钟：相对时间文案（"4小时前"）否则会让截图基线抖动

for (const viewport of [1024, 1280, 1440, 1600]) {
  const page = await browser.newPage({ viewport: { width: viewport, height: 900 }, deviceScaleFactor: 1 });
  await page.clock.install({ time: FROZEN_TIME });
  await page.goto(APP_URL, { waitUntil: "networkidle" });
  await page.waitForTimeout(700);
  const data = await measure(page);
  check(`[${viewport}] 聊天列 ≥ ${MIN_CHAT}px`, data.chatWidth >= MIN_CHAT, `实际 ${data.chatWidth}px`);
  check(`[${viewport}] 无横向溢出`, data.overflow === false);
  check(`[${viewport}] 无竖向文本裁切`, data.clipped.length === 0, data.clipped.slice(0, 3).join(" | "));
  check(`[${viewport}] 文本对比度 ≥ 4.5:1`, data.lowContrast.length === 0, data.lowContrast.slice(0, 3).join(" | "));
  check(`[${viewport}] 命中区 ≥ ${MIN_HIT}×${MIN_HIT}`, data.smallTargets.length === 0, data.smallTargets.slice(0, 3).join(" | "));
  await settle(page);
  await page.screenshot({ path: join(SHOT_DIR, `viewport-${viewport}.png`), animations: "disabled", caret: "hide" });   // 仅产物，不参与基线
  await page.close();
}

// 交互态：折叠 / 面板 / 模态 / hover
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
await page.clock.install({ time: FROZEN_TIME });
await page.goto(APP_URL, { waitUntil: "networkidle" });
await page.waitForTimeout(700);

// 折叠成本常数化
const hideButtons = page.locator('[aria-label="收起此列"]');
while (await hideButtons.count() > 0) { await hideButtons.first().click(); await page.waitForTimeout(120); }
const folded = await measure(page);
check("收起三列后成本 = 一条 44px 轨", folded.rail === 44, `实际 ${folded.rail}px`);
check("收起后聊天列仍 ≥ MIN_CHAT", folded.chatWidth >= MIN_CHAT, `实际 ${folded.chatWidth}px`);
await settle(page);
for (const label of ["助手", "项目", "会话"]) {
  const railButton = page.locator(`[aria-label="展开${label}"]`);
  if (await railButton.count() > 0) { await railButton.first().click(); await page.waitForTimeout(120); }
}

// hover 不位移（会话行：时间 ↔ 图标切换后行内元素不得移动）
const rowBox = async () => await page.evaluate(() => {
  const row = [...document.querySelectorAll('[role="button"]')].find((el) => el.className.includes("h-8") && el.textContent.includes("welcome"));
  if (row === undefined) return null;
  const box = row.getBoundingClientRect();
  return { x: Math.round(box.x), w: Math.round(box.width), h: Math.round(box.height), children: [...row.children].map((child) => Math.round(child.getBoundingClientRect().x)) };
});
const before = await rowBox();
if (before !== null) {
  await page.locator('[role="button"]').filter({ hasText: "welcome" }).first().hover();
  await page.waitForTimeout(260);
  const after = await rowBox();
  check("hover 不改变行几何（无抖动）", JSON.stringify(before) === JSON.stringify(after), `${JSON.stringify(before)} → ${JSON.stringify(after)}`);
} else {
  check("hover 不改变行几何（无抖动）", false, "找不到会话行样本");
}

// 模态：语义 + Esc + 焦点归位
const avatarTrigger = page.locator('button[aria-label^="配置 "]').first();
if (await avatarTrigger.count() > 0) {
  await avatarTrigger.click();
  await page.waitForTimeout(500);
  const opened = await measure(page);
  check("模态具备 role=dialog + aria-modal", opened.dialogCount === 1, `dialog=${opened.dialogCount}`);

  const focusTrapped = await page.evaluate(() => document.querySelector('[role="dialog"]')?.contains(document.activeElement) === true);
  check("模态打开后焦点在对话框内", focusTrapped);
  for (let index = 0; index < 12; index += 1) await page.keyboard.press("Tab");
  const stillTrapped = await page.evaluate(() => document.querySelector('[role="dialog"]')?.contains(document.activeElement) === true);
  check("Tab 12 次不逃出对话框（焦点陷阱）", stillTrapped);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  const closed = await page.evaluate(() => document.querySelectorAll('[role="dialog"]').length === 0);
  check("Esc 关闭模态", closed);
} else {
  check("模态可打开", false, "找不到头像入口");
}

// 会话区头部：必须写「Agent · 项目目录名」，且项目名与 /api 返回一致（防"工作区"这类展示名回流）
const headerMeta = await page.evaluate(async () => {
  const line = document.querySelector("header p")?.textContent?.trim() ?? "";
  const data = await (await fetch("/api/agents/lifeosagent/projects")).json();
  return { line, projectName: data.items?.[0]?.name ?? "" };
});
check("会话区头部显示「Agent · 项目目录名」且与接口一致",
  headerMeta.projectName !== "" && headerMeta.line.endsWith(headerMeta.projectName) && headerMeta.line.includes(" · "),
  `${headerMeta.line}（接口 name=${headerMeta.projectName}）`);

// 列头语义：列头只写"这一列是什么"，"默认"这类徽标属于行内数据，不许重复出现在列头
const headerTexts = await page.evaluate(() => [...document.querySelectorAll("aside > div:first-child")]
  .map((el) => (el.textContent ?? "").trim()));
check("列头不重复行内徽标（无“默认”）", headerTexts.every((text) => !text.includes("默认")), headerTexts.join(" | "));

// 列内文本噪音：项目/会话行不再出现"默认"这类文字徽标（默认项目改用 6px 点 + title）
const bodyText = await page.evaluate(() => document.body.innerText);
check("界面不再出现“默认”文字徽标", !bodyText.includes("默认"), bodyText.includes("默认") ? "仍有“默认”字样" : "");

// 键盘焦点可见（全局 :focus-visible 兜底）
await page.keyboard.press("Tab");
const focusRing = await page.evaluate(() => {
  const el = document.activeElement;
  if (el === null) return { ok: false, detail: "无焦点元素" };
  const style = getComputedStyle(el);
  return { ok: style.outlineStyle !== "none" && Number.parseFloat(style.outlineWidth) > 0, detail: `${el.tagName} ${style.outlineStyle} ${style.outlineWidth}` };
});
check("键盘 Tab 后焦点可见（outline）", focusRing.ok, String(focusRing.detail));

// ---- 截图基线（闸 4）----
// 关键点：独立浏览器 + 每张图一个新页面 + 冻结时钟。
// 否则同一 context 里页面的先后顺序、以及"4小时前"这类相对时间文案，会让基线随机抖动（实测 66457 vs 66460 字节）。
const shotBrowser = await playwright.chromium.launch({
  headless: true, executablePath: playwright.chromium.executablePath(),
  args: ["--no-proxy-server", "--font-render-hinting=none", "--disable-lcd-text"],
});
async function capture(width, setup) {
  const shotPage = await shotBrowser.newPage({ viewport: { width, height: 900 }, deviceScaleFactor: 1 });
  await shotPage.clock.install({ time: FROZEN_TIME });
  await shotPage.goto(APP_URL, { waitUntil: "networkidle" });
  await shotPage.waitForTimeout(500);
  if (setup !== undefined) await setup(shotPage);
  await settle(shotPage);
  const buffer = await shotPage.screenshot({ animations: "disabled", caret: "hide" });
  await shotPage.close();
  return buffer;
}
const SHOTS = [
  ["viewport-1280.png", 1280, undefined],
  ["viewport-1600.png", 1600, undefined],
  ["folded.png", 1600, async (shotPage) => {
    const buttons = shotPage.locator('[aria-label="收起此列"]');
    while (await buttons.count() > 0) { await buttons.first().click(); await shotPage.waitForTimeout(100); }
  }],
  ["modal.png", 1600, async (shotPage) => {
    await shotPage.locator('button[aria-label^="配置 "]').first().click();
    await shotPage.waitForTimeout(400);
  }],
];
for (const [name, width, setup] of SHOTS) {
  const buffer = await capture(width, setup);
  writeFileSync(join(SHOT_DIR, name), buffer);
  const basePath = join(BASELINE_DIR, name);
  if (UPDATE_BASELINE || !existsSync(basePath)) {
    writeFileSync(basePath, buffer);
    check(`截图基线 ${name}`, true, UPDATE_BASELINE ? "已更新" : "首次写入");
    continue;
  }
  // 像素容差比较（不是字节相等）：抗锯齿抖动容忍 8/255，差异像素 > 0.05% 才算视觉变化
  const diff = pixelDiff(readFileSync(basePath), buffer);
  const same = diff.ratio <= 0.0002;   // 0.02%：实测抗锯齿抖动 0.0000%，而"删掉一个小徽标"约 0.03%
  check(`截图基线 ${name} 未变化`, same,
    same ? `差异像素 ${(diff.ratio * 100).toFixed(3)}%` : `差异像素 ${(diff.ratio * 100).toFixed(2)}%（最大通道差 ${diff.maxDelta}）：人眼确认后 pnpm test:ui:update`);
}
await shotBrowser.close();

await browser.close();

// 门禁自检：防止某段检查被删掉却依然"全绿"（本次就发生过一次基线检查块被整体删掉）
const REQUIRED = ["聊天列 ≥", "无横向溢出", "无竖向文本裁切", "文本对比度", "命中区", "成本 = 一条 44px 轨", "hover 不改变行几何", "焦点陷阱", "Esc 关闭模态", "截图基线"];
const missing = REQUIRED.filter((needle) => !results.some((item) => item.name.includes(needle)));
check("门禁自检：所有检查项都在（防静默删除）", missing.length === 0 && results.length >= 24,
  missing.length > 0 ? `缺失 ${missing.join(" / ")}` : `共 ${results.length} 项`);

const failed = results.filter((item) => !item.ok);
for (const item of results) console.log(`${item.ok ? "✔" : "✖"} ${item.name}${item.detail === "" ? "" : `  → ${item.detail}`}`);
console.log(`\n${results.length - failed.length}/${results.length} 通过${failed.length === 0 ? "" : `；${failed.length} 项失败`}`);
if (failed.length > 0) process.exit(1);
