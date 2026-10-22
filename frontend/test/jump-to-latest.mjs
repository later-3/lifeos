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
  const box = await button.boundingBox().catch(() => null);
  check(`[${name}] 箭头触控目标 ≥44（手机）/ ≥32（桌面）`, box !== null && (isMobile ? box.width >= 44 && box.height >= 44 : box.width >= 32 && box.height >= 32), JSON.stringify(box));
  if (box !== null) await button.click();
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
