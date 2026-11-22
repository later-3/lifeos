/**
 * E2E 探针：在真实浏览器里制造主线程冻结，验证冻结观测真的会记下来（Task 0033 · 验收 #1/#2）。
 *
 * 用法：
 *   APP_URL=http://localhost:5183 node scripts/probe-freeze-e2e.mjs
 *   FREEZE_MS=5000  # 冻结时长，默认 5000（阈值 3000，必须大于它才有记录）
 *
 * 只读：不改任何产品状态，只在一个临时页里忙等。
 */

import { join } from "node:path";
import { homedir } from "node:os";

const PW = join(homedir(), ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright-core/index.js");
const mod = await import(PW);
const playwright = mod.default ?? mod;

const APP_URL = process.env.APP_URL ?? "http://localhost:5183";
const FREEZE_MS = Number(process.env.FREEZE_MS ?? 5000);

const browser = await playwright.chromium.launch({ headless: true, executablePath: playwright.chromium.executablePath() });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });

const consoleLines = [];
page.on("console", (message) => consoleLines.push(`${message.type()}: ${message.text()}`));

/** 记录所有 /api/logs 请求（含请求体），用来断言"冻结记录真的发出去了"。 */
const uploads = [];
page.on("request", (request) => {
  if (!request.url().includes("/api/logs")) return;
  uploads.push({ at: Date.now(), body: request.postData() ?? "" });
});

await page.goto(APP_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
await page.waitForTimeout(4_000);   // 让观测装好、beat 跑几拍

console.log(`制造主线程冻结 ${FREEZE_MS}ms（忙等，不让出线程）…`);
const frozenAt = Date.now();
await page.evaluate((ms) => {
  const start = Date.now();
  while (Date.now() - start < ms) { /* busy wait：主线程完全不返回事件循环 */ }
}, FREEZE_MS);
const freedAt = Date.now();
console.log(`主线程已恢复（冻结 ${freedAt - frozenAt}ms）`);

await page.waitForTimeout(4_000);   // 等 Worker 判定 + 上报往返
await browser.close();

/* ── 断言 ── */
const freezeUploads = uploads
  .map((upload) => {
    try { return { ...upload, events: (JSON.parse(upload.body)?.events ?? []) }; } catch { return { ...upload, events: [] }; }
  })
  .filter((upload) => upload.events.some((event) => event.module === "freeze"));

console.log(`\n/api/logs 请求数：${uploads.length}；其中含 freeze 的：${freezeUploads.length}`);

const freezeEvents = freezeUploads.flatMap((upload) => upload.events.filter((event) => event.module === "freeze"));
for (const event of freezeEvents) {
  console.log(`  [${event.level}] ${event.module} · ${event.msg} · durationMs=${event.details?.durationMs} · snapshot=${event.details?.snapshot === undefined ? "无" : JSON.stringify(event.details.snapshot)}`);
}

const frozen = freezeEvents.find((event) => event.msg === "主线程冻结");
const passed = frozen !== undefined && Number(frozen.details?.durationMs ?? 0) >= 3000;

console.log(`\n结果：${passed ? "✅ 已记录冻结" : "❌ 没有记录到冻结"}`);
if (frozen !== undefined) {
  const firstUploadAt = freezeUploads[0]?.at ?? 0;
  console.log(`冻结记录上报时刻 vs 恢复时刻：上报 ${new Date(firstUploadAt).toISOString()} / 恢复 ${new Date(freedAt).toISOString()}`);
  console.log(`  差 ${firstUploadAt - freedAt}ms（负 = 在恢复之前就发出去了，这是验收 #2）`);
}
if (consoleLines.length > 0) {
  console.log("\n控制台（前 10 条）：");
  console.log(consoleLines.slice(0, 10).join("\n"));
}
process.exit(passed ? 0 : 1);
