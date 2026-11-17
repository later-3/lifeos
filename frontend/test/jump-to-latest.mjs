#!/usr/bin/env node
/**
 * “回到底部”契约：桌面与手机都要有；离开底部时出现，点击后回到最新。
 * 需要 dev server（默认 http://localhost:5173）。
 */
import pw from "/Users/xulater/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright-core/index.js";
const { chromium } = pw;
const APP_URL = process.env.APP_URL ?? "http://localhost:5173";
const failures = [];
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "✔" : "✖"} ${name}${detail === "" ? "" : `  → ${detail}`}`);
  if (!ok) failures.push(name);
};
const browser = await chromium.launch({ headless: true });
for (const [name, width, height, isMobile] of [["桌面", 1280, 800, false], ["手机", 390, 844, true]]) {
  const context = await browser.newContext({ viewport: { width, height }, isMobile, hasTouch: isMobile });
  const page = await context.newPage();
  await page.goto(APP_URL, { waitUntil: "networkidle" });
  await page.waitForTimeout(350);
  const setup = await page.evaluate(() => {
    const main = document.querySelector("main");
    if (main === null) return { error: "no main" };
    const spacer = document.createElement("div");
    spacer.id = "jump-spacer";
    spacer.style.height = "2400px";
    spacer.style.flexShrink = "0";
    main.querySelector("div")?.appendChild(spacer);
    main.scrollTop = 0;
    main.dispatchEvent(new Event("scroll", { bubbles: true }));
    return { scrollHeight: main.scrollHeight, clientHeight: main.clientHeight };
  });
  check(`[${name}] 消息区可滚动`, setup.error === undefined && setup.scrollHeight > setup.clientHeight, JSON.stringify(setup));
  const button = page.locator('[data-testid="jump-to-latest"]');
  await button.waitFor({ state: "visible", timeout: 2000 }).catch(() => {});
  check(`[${name}] 离开底部出现向下箭头`, await button.isVisible().catch(() => false), await button.getAttribute("aria-label").catch(() => ""));
  /*
   * 2026-11-16（Task 0017 · P5/P6）：拆 hook + 目录分层后，箭头出现可能晚一帧
   * （滚动事件触发 React 更新 → 再挂载）。原来直接 `boundingBox()` 会拿到 `null`。
   * 等它真的**有布局盒**再量（`testing.md` 2.15：0 个 = 没测）。
   */
  /*
   * 用**页面内**的 getBoundingClientRect 量，不用 locator.boundingBox()。
   * 2026-11-16（Task 0017 · P5/P6）实测：`boundingBox()` 返回 `null`（Playwright 认为元素
   * 不"可见"——它把 `pointer-events-none` 的父容器也算进去），而元素实际有 36×36 的盒子。
   * 几何断言要量的是**真实盒子**，所以直接用 getBoundingClientRect（并且等它有尺寸再取）。
   */
  const box = await page.waitForFunction(() => {
    const el = document.querySelector('[data-testid="jump-to-latest"]');
    if (el === null) return null;
    const b = el.getBoundingClientRect();
    return b.width > 0 && b.height > 0 ? { width: Math.round(b.width), height: Math.round(b.height) } : null;
  }, undefined, { timeout: 8000 }).then((h) => h.jsonValue(), () => null);
  check(`[${name}] 箭头触控目标 ≥44（手机）/ ≥32（桌面）`, box !== null && (isMobile ? box.width >= 44 && box.height >= 44 : box.width >= 32 && box.height >= 32), JSON.stringify(box));
  /*
   * 用**页面内 click()**，不用 Playwright 的 actionability 点击。
   * 2026-11-16（Task 0017）实测：按钮在 `atBottom=false` 时挂载、点击后立刻卸载（`atBottom=true`），
   * Playwright 的"点击前重新检查元素仍挂着"会撞上 `element was detached from the DOM`。
   * 这正是这个按钮**正常工作**的表现 —— 被测行为是"点了会滚到底"，不是"按钮会留在原地"。
   */
  if (box !== null) await page.evaluate(() => document.querySelector('[data-testid="jump-to-latest"]')?.click());
  const reached = await page.waitForFunction(() => {
    const main = document.querySelector("main");
    return main !== null && main.scrollHeight - main.scrollTop - main.clientHeight < 2;
  }, undefined, { timeout: 5000 }).then(() => true).catch(() => false);
  check(`[${name}] 点击后回到最新`, reached, await page.evaluate(() => { const m = document.querySelector("main"); return m === null ? "" : `${Math.round(m.scrollTop)}/${m.scrollHeight - m.clientHeight}`; }));
  check(`[${name}] 回到底部后箭头消失`, !(await page.locator('[data-testid="jump-to-latest"]').isVisible().catch(() => false)));
  await context.close();
}
await browser.close();
if (failures.length > 0) {
  console.error(`回到底部契约失败 ${failures.length} 项`);
  process.exit(1);
}
console.log("回到底部契约通过（桌面 + 手机）");
