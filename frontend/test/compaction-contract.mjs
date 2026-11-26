#!/usr/bin/env node
/**
 * 压缩状态条的界面契约（Task 0041 · P2 / S7）。
 *
 * ## 要证明什么
 *
 * 压缩在 Life OS 里此前**完全不可见**（Pi 发了 `compaction_start`/`compaction_end`，我们没接）。
 * 实测代价（Task 0041 `01-background.md` §2）：一个会话因为该压不压，连续 6 轮回复被截断
 * （`write` 参数被切、界面显示"0 字符"），用户唯一看到的是"达到输出上限"，无法知道是压缩问题。
 *
 * 所以这条契约守三件事：
 *   1. `start` → 出现状态条，且**写明原因**（不是只有一个转圈）；
 *   2. 成功 `end` → 状态条消失（结果在历史的 CompactionCard 里，不在状态条常显）；
 *   3. 失败 `end` → 状态条变成失败态并**显示原因**。
 *
 * 外加：`aborted` 不得显示成失败（用户主动打断不是错误）。
 *
 * ## 怎么打桩
 *
 * 用 `event-channel-stub.mjs` 的假 WebSocket（`testing.md` 2.20：不用 route.fulfill 流），
 * 由测试按时序推 `compaction` 帧。**不需要真模型**（`testing.md` 2.25）。
 *
 * ## 几何断言（`testing.md` 2.15）
 *
 * 不只看"元素在 DOM 里"：断言它**有布局盒**（宽高 > 0、`offsetParent !== null`），
 * 并先打印命中数——**命中 0 个的断言是恒绿的假断言**。
 */
import pw from "/Users/xulater/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright-core/index.js";
import { EVENT_CHANNEL_STUB } from "./event-channel-stub.mjs";

const V = process.env.APP_URL ?? "http://127.0.0.1:5222";
const AGENT = process.env.AGENT ?? "coder";
const PROJECT = process.env.PROJECT ?? "lifeos";
const SESSION = process.env.SESSION;

if (SESSION === undefined) {
  console.error("需要 SESSION=<会话 id>（或改成你自己实例里的一个会话）");
  process.exit(2);
}

const Q = `?agent=${AGENT}&project=${PROJECT}&session=${SESSION}`;

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "✔" : "✖"} ${name}${detail === "" ? "" : `  → ${detail}`}`);
};

const browser = await pw.chromium.launch();

async function open() {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on("pageerror", (e) => console.log("  [pageerror]", e.message.slice(0, 140)));
  await page.addInitScript(EVENT_CHANNEL_STUB);
  await page.goto(V + "/" + Q, { waitUntil: "domcontentloaded" });
  // 等已知元素出现，而不是等固定时间（`testing.md` 2.17 第 3 条）
  await page.waitForSelector('[data-testid="composer-dock"]', { timeout: 30_000 });
  await page.waitForTimeout(800);
  return page;
}

/**
 * 推一条压缩事件。
 *
 * **必须带 agentId / sessionId**：`routeEvent` 的细节级事件按"焦点会话"分流
 * （`event-router.ts:80` `matchesFocus = focus.agentId === agentId && focus.sessionId === sessionId`），
 * 不带这两个字段会被当成"其他会话的细节"直接 drop —— 页面照常渲染但状态条永不出现，
 * 正是 `testing.md` 2.15 说的"夹具注入到没人读的地方"。
 */
async function pushCompaction(page, data) {
  // 焦点从**页面 URL** 读，而不是命令行传入的 SESSION：
  // 实测（2026-11-26）服务端会把 URL 里的 session 改写成"实有会话"（传入一个刚创建、
  // 还没落盘的 id 时会被换成最近一条），于是用命令行那个 id 推帧永远对不上焦点，
  // 状态条永不出现——而"未出现"类断言会恒绿（testing.md 2.15 的假断言）。
  const focus = await page.evaluate(() => {
    const url = new URL(location.href);
    return {
      agentId: url.searchParams.get("agent") ?? "",
      sessionId: url.searchParams.get("session") ?? "",
      seq: (window.__probeSeq = (window.__probeSeq ?? 1000000) + 1),
    };
  });
  const payload = { ...data, agentId: focus.agentId, sessionId: focus.sessionId, seq: focus.seq };
  await page.evaluate((p) => window.__ssePush("compaction", p), payload);
  await page.waitForTimeout(220);   // 给 React 一次渲染
}

const status = (page) => page.evaluate(() => {
  const el = document.querySelector('[data-testid="compaction-status"]');
  if (el === null) return { present: false };
  const rect = el.getBoundingClientRect();
  return {
    present: true,
    text: el.textContent ?? "",
    role: el.getAttribute("role"),
    ariaLive: el.getAttribute("aria-live"),
    rw: rect.width,
    rh: rect.height,
    mounted: el.offsetParent !== null,
    // 失败态看是否用了危险语义色（不是靠文字判断）
    dangerClass: el.className.includes("danger"),
  };
});

function boxOk(s) {
  return s.rw > 0 && s.rh > 0 && s.mounted === true;
}

// ===== 1) 初始：没有压缩时不渲染状态条 =====
{
  const page = await open();
  const s = await status(page);
  check("初始（无压缩）不渲染状态条", s.present === false, s.present ? `不该出现：${s.text}` : "未出现，符合预期");
  await page.close();
}

// ===== 2) start → 状态条出现、可访问名正确、有布局盒 =====
{
  const page = await open();
  await pushCompaction(page, { type: "compaction", phase: "start", reason: "threshold" });
  const s = await status(page);
  check("start 后状态条出现", s.present === true);
  if (s.present) {
    check("start 状态条有布局盒（不是 0×0）", boxOk(s), `${Math.round(s.rw)}×${Math.round(s.rh)}`);
    check("start 状态条写明原因（不是只有一个转圈）", s.text.includes("上下文接近上限"), s.text.trim().slice(0, 60));
    check("start 状态条是 status 语义（读屏可感知）", s.role === "status" && s.ariaLive === "polite", `role=${s.role} aria-live=${s.ariaLive}`);
    check("start 状态条不是失败色", s.dangerClass === false);
  }
  await page.close();
}

// ===== 3) 成功 end → 状态条消失 =====
{
  const page = await open();
  await pushCompaction(page, { type: "compaction", phase: "start", reason: "threshold" });
  const before = await status(page);
  check("（前置）start 后确实出现了状态条", before.present === true);
  await pushCompaction(page, { type: "compaction", phase: "end", reason: "threshold", ok: true, tokensBefore: 900000 });
  const after = await status(page);
  check("成功 end 后状态条消失", after.present === false, after.present ? `仍在：${after.text}` : "已消失");
  await page.close();
}

// ===== 4) 失败 end → 失败态 + 原因 =====
{
  const page = await open();
  await pushCompaction(page, { type: "compaction", phase: "start", reason: "overflow", overflow: true });
  const running = await status(page);
  check("overflow 的 start 会说明「上一轮已溢出」", running.present && running.text.includes("上一轮已溢出"), running.text?.trim().slice(0, 60) ?? "未出现");

  await pushCompaction(page, {
    type: "compaction", phase: "end", reason: "overflow", ok: false, aborted: false,
    errorMessage: "Summarization failed: generation hit the token cap and the summary is incomplete",
  });
  const failed = await status(page);
  check("失败 end 后仍是状态条（不消失）", failed.present === true);
  if (failed.present) {
    check("失败态显示原因原文", failed.text.includes("Summarization failed"), failed.text.trim().slice(0, 80));
    check("失败态用危险语义色（不靠文字判断）", failed.dangerClass === true);
    check("失败态有布局盒", boxOk(failed), `${Math.round(failed.rw)}×${Math.round(failed.rh)}`);
  }
  await page.close();
}

// ===== 5) aborted 不得显示成失败 =====
{
  const page = await open();
  await pushCompaction(page, { type: "compaction", phase: "start", reason: "manual" });
  await pushCompaction(page, { type: "compaction", phase: "end", reason: "manual", ok: false, aborted: true });
  const s = await status(page);
  check("aborted 后状态条消失（用户打断不是失败）", s.present === false, s.present ? `仍显示失败：${s.text}` : "已消失");
  await page.close();
}

// ===== 6) 失败没有原因时给兜底文案，不留空白 =====
{
  const page = await open();
  await pushCompaction(page, { type: "compaction", phase: "start", reason: "threshold" });
  await pushCompaction(page, { type: "compaction", phase: "end", reason: "threshold", ok: false, aborted: false });
  const s = await status(page);
  check("失败但无原因时不留空白（用兜底文案）", s.present === true && s.text.trim().length > 0, s.text?.trim().slice(0, 60) ?? "未出现");
  await page.close();
}

// ===== 7) 重放幂等：同一 start 推 5 次，仍然只有一条 =====
{
  const page = await open();
  for (let i = 0; i < 5; i += 1) {
    await pushCompaction(page, { type: "compaction", phase: "start", reason: "threshold" });
  }
  const count = await page.evaluate(() => document.querySelectorAll('[data-testid="compaction-status"]').length);
  check("同一 start 重放 5 次 → 仍只有 1 条状态条", count === 1, `实际 ${count} 条`);
  await page.close();
}

await browser.close();

const failedCount = results.filter((r) => !r.ok).length;
console.log("");
console.log(`压缩状态条契约：${results.length - failedCount}/${results.length} 通过`);
if (failedCount > 0) {
  console.error(`✖ ${failedCount} 条未通过`);
  process.exit(1);
}
