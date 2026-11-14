#!/usr/bin/env node
/**
 * composer 输入上下文的作用域契约（Task 0019）：
 *   · 附件（图片）按会话归属：切走不跟随、切回还在（与文字草稿同一套语义）；
 *   · 评论引用/命令面板切会话即清（评论引用用例在 review-contract.mjs §3.19）；
 *   · 程序聚焦（新建会话草稿路径）后光标在文字末尾，不在最前。
 *
 * 需要 dev server：
 *   APP_URL=http://localhost:5178 node frontend/test/composer-scope.mjs
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const APP_URL = process.env.APP_URL ?? "http://localhost:5173";

const PLAYWRIGHT_CANDIDATES = [
  process.env.PLAYWRIGHT_CORE,
  join(HERE, "../node_modules/playwright-core/index.js"),
  join(HERE, "../../node_modules/playwright/index.js"),
  join(homedir(), ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.js"),
  join(homedir(), ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright-core/index.js"),
].filter(Boolean);

async function loadPlaywright() {
  for (const candidate of PLAYWRIGHT_CANDIDATES) {
    if (!existsSync(candidate)) continue;
    const module = await import(candidate);
    return module.default ?? module;
  }
  throw new Error("找不到 playwright：设置 PLAYWRIGHT_CORE=/path/to/playwright-core/index.js");
}

const failures = [];
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "✔" : "✖"} ${name}${detail === "" ? "" : `  → ${detail}`}`);
  if (!ok) failures.push(name);
};

// 1×1 PNG（最小合法图片，写入走前端 collectImages 的真实校验路径）
const PNG_1PX = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const TA = "textarea[aria-label='输入消息']";
const ATTACHMENTS = '[data-testid="composer-attachments"]';

const { chromium } = await loadPlaywright();
const browser = await chromium.launch({ headless: true });
const created = [];
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(APP_URL, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(TA, { timeout: 15000 });
  await page.waitForTimeout(900);
  const params = new URL(page.url()).searchParams;
  const agentId = params.get("agent");
  const projectId = params.get("project");
  if (!agentId || !projectId) throw new Error(`页面 URL 缺 agent/project 参数：${page.url()}`);

  const mkSession = async (name) => {
    const sid = await page.evaluate(async ({ agentId, projectId, name }) => {
      const res = await fetch(`/api/agents/${agentId}/projects/${projectId}/sessions`, { method: "POST" });
      const body = await res.json();
      if (body.sessionId) {
        await fetch(`/api/agents/${agentId}/sessions/${body.sessionId}`, {
          method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ name }),
        });
      }
      return body.sessionId;
    }, { agentId, projectId, name });
    created.push(sid);
    // API 直建不走 UI 的 reloadGroups，整页重载让侧栏拿到新会话（草稿在 localStorage，不受影响）
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector(TA, { timeout: 15000 });
    await page.waitForSelector(`[data-shot-mask="session-rows"] [data-testid="${sid}"]`, { timeout: 10000 });
    return sid;
  };
  const clickSession = async (sid) => {
    await page.locator(`[data-shot-mask="session-rows"] [data-testid="${sid}"]`).first().click();
    await page.waitForTimeout(700);
  };
  const attachCount = () => page.locator(`${ATTACHMENTS} img`).count();
  const caret = () => page.evaluate(() => {
    const el = document.querySelector("textarea[aria-label='输入消息']");
    return { start: el.selectionStart, end: el.selectionEnd, len: el.value.length, focused: document.activeElement === el, value: el.value };
  });

  // ── T1/T2：附件按会话归属 ────────────────────────────────────────────
  const sidA = await mkSession("scope-A");
  const sidB = await mkSession("scope-B");
  await clickSession(sidA);
  await page.setInputFiles('input[type="file"]', { name: "t.png", mimeType: "image/png", buffer: PNG_1PX });
  await page.waitForSelector(ATTACHMENTS, { timeout: 5000 });
  check("T0·会话 A 加图后附件可见", (await attachCount()) === 1);

  await clickSession(sidB);
  // 修复目标：切走即不跟随（此前 =1，跨会话残留）
  check("T1·切到会话 B 后输入框没有 A 的图片", (await attachCount()) === 0, `count=${await attachCount()}`);
  await clickSession(sidA);
  // 缓存语义（对齐文字草稿）：切回原会话图片还在
  check("T2·切回会话 A 后图片仍在（按会话缓存）", (await attachCount()) === 1, `count=${await attachCount()}`);
  // 发送后清空当前会话的附件（既有语义，换作用域实现后必须保持）
  const sent = [];
  await page.route(/\/sessions\/[^/]+\/messages$/, async (route) => {
    sent.push(route.request().postDataJSON());
    await route.fulfill({ status: 202, contentType: "application/json", body: JSON.stringify({ accepted: true }) });
  });
  await page.locator(TA).fill("带图消息");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(900);
  check("T2b·发送后附件清空（当前会话）", (await attachCount()) === 0, `count=${await attachCount()}`);
  check("T2b·发送请求带上了图片", (sent.at(-1)?.images?.length ?? 0) === 1, JSON.stringify(sent.at(-1)?.images?.length));
  await page.unroute(/\/sessions\/[^/]+\/messages$/);

  // ── T4：程序聚焦（新建会话草稿路径）光标在末尾 ────────────────────────
  // 先在草稿态写草稿 → 切到会话 → 点「新建会话」回到草稿（自动聚焦 + 草稿恢复）
  await clickSession(sidB);
  await page.locator(TA).click();
  await page.evaluate(() => { document.querySelector("textarea[aria-label='输入消息']").value = ""; });
  // 清掉会话草稿，避免 T4 断言串到其他文字（只动内存草稿：发送路径会写回，这里直接 fill("") 由草稿机制落盘）
  await page.locator(TA).fill("");
  await page.locator(TA).press("Backspace");
  await page.waitForTimeout(200);
  // 点「新建会话」进入草稿态，写入草稿
  const groupNames = await page.evaluate(() =>
    [...document.querySelectorAll('[data-testid="group-header"]')].map((e) => e.getAttribute("data-group-name")).filter(Boolean));
  await page.locator(`button[aria-label="在 ${groupNames[0]} 新建会话"]`).first().click();
  await page.waitForFunction(() => {
    const el = document.querySelector("textarea[aria-label='输入消息']");
    return el !== null && document.activeElement === el;
  }, { timeout: 5000 });
  await page.locator(TA).type("composer scope draft text");
  await page.waitForTimeout(200);
  // 切到已有会话再切回草稿：自动聚焦时应把光标放到文字末尾
  await clickSession(sidB);
  await page.locator(`button[aria-label="在 ${groupNames[0]} 新建会话"]`).first().click();
  await page.waitForFunction((text) => {
    const el = document.querySelector("textarea[aria-label='输入消息']");
    return el !== null && el.value === text;
  }, "composer scope draft text", { timeout: 5000 });
  await page.waitForTimeout(400);   // rAF focus 完成后再读 caret
  const c = await caret();
  check("T4·草稿恢复后输入框聚焦", c.focused, `focused=${c.focused}`);
  check("T4·程序聚焦后光标在文字末尾", c.start === c.len && c.end === c.len, `caret=${c.start}/${c.end} len=${c.len}`);
  await page.keyboard.type("X");
  const c2 = await caret();
  check("T4·接着打字追加在末尾（不插到最前）", c2.value === "composer scope draft textX", `value="${c2.value}"`);

  // ── T5：鼠标点回输入框（用户报的原始场景："重新点击输入光标跑到最前"）──────
  // 实测根因（evidence/probe-caret）：鼠标聚焦发生在 mousedown，浏览器在 mouseup 才按
  // 点击位置设 selection；点在左侧 padding / 首行上方空白 → 浏览器把 caret 放到 0（行首）。
  // 所以断言"点这些位置后 caret 在末尾"，同时断言"点文字中间仍在点击处"（不破坏原生语义）。
  const taBox = await page.locator(TA).boundingBox();
  const composerBox = await page.locator('[data-testid="composer"]').boundingBox();
  const blurComposer = async () => {
    await page.mouse.click(composerBox.x + composerBox.width / 2, composerBox.y - 150);
    await page.waitForTimeout(150);
  };
  await blurComposer();
  await page.mouse.click(taBox.x + 3, taBox.y + 24);           // 左侧 padding（浏览器原生 = 行首）
  await page.waitForTimeout(200);
  const c3 = await caret();
  check("T5·点输入框左侧 padding 后光标在末尾（不是最前）", c3.start === c3.len && c3.end === c3.len, `caret=${c3.start}/${c3.end} len=${c3.len}`);
  await blurComposer();
  await page.mouse.click(taBox.x + 60, taBox.y + 24);          // 文字中间 → 原生语义：caret 在点击处
  await page.waitForTimeout(200);
  const c4 = await caret();
  check("T5·点文字中间仍落在点击位置（原生语义不变）", c4.start > 0 && c4.start < c4.len, `caret=${c4.start} len=${c4.len}`);
  await page.keyboard.type("Q");
  const c5 = await caret();
  check("T5·点中间后接着打字插在点击处（不是末尾也不是最前）", c5.start === c4.start + 1 && c5.value[c4.start] === "Q", `value="${c5.value}"`);
} finally {
  try {
    const context = browser.contexts()[0];
    if (context !== undefined) {
      const cleanup = await context.newPage();
      await cleanup.goto(`${APP_URL}/?agent=probe-agent&project=0019-probe-repo`, { waitUntil: "domcontentloaded" }).catch(() => undefined);
      // 按 URL 上的真实 agent/project 清理本轮会话与草稿
      const params = new URL(cleanup.url()).searchParams;
      const agentId = params.get("agent");
      const projectId = params.get("project");
      if (agentId !== undefined && projectId !== undefined) {
        for (const sid of created) {
          await cleanup.evaluate(async ({ agentId, sid }) => {
            await fetch(`/api/agents/${agentId}/sessions/${sid}`, { method: "DELETE" }).catch(() => {});
          }, { agentId, sid }).catch(() => undefined);
        }
        await cleanup.evaluate(() => {
          for (const key of [...localStorage.keys()]) {
            if (key.startsWith("lifeos.draft.") || key.startsWith("lifeos.input-history.")) localStorage.removeItem(key);
          }
        }).catch(() => undefined);
      }
      await cleanup.close();
    }
  } catch { /* 清理失败不掩盖主结果 */ }
  await browser.close();
}

const failed = failures.length;
console.log(failed === 0 ? "\ncomposer 作用域契约通过。" : `\n${failed} 项失败：${failures.join("；")}`);
process.exit(failed === 0 ? 0 : 1);
