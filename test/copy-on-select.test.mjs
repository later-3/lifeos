/**
 * 「选中即复制」的纯函数契约（Task 0013 · P2）。
 *
 * 只测能脱 DOM 的三件事：该不该复制、成功文案、胶囊位置。
 * 真实交互（剪贴板、拖选、聚焦）靠 `frontend/test/copy-on-select.mjs`（真实浏览器 + pbpaste 等价校验）。
 *
 * 每个用例都对应 `02-design.md` §2.1/§2.2/§2.4 的一条决定，注释里写明对应哪条。
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  COPY_EDGE_MARGIN, COPY_FEEDBACK_MS, COPY_GAP,
  copyFeedbackPosition, copyLabel, shouldCopy,
} from "../frontend/src/copy-on-select.ts";

/** @typedef {import("../frontend/src/copy-on-select.ts").CopyDecisionFacts} CopyDecisionFacts */

/** @param {Partial<CopyDecisionFacts>} over */
const facts = (over = {}) => ({
  insideZone: true,
  collapsed: false,
  text: "一段被选中的文字",
  inFormField: false,
  ...over,
});

/* ---------- shouldCopy：四条判据逐条穷举 ---------- */

test("触发：对话区内的非空选区 → 复制", () => {
  assert.equal(shouldCopy(facts()), true);
});

test("不触发：选区在对话区外（左三列 / 输入框 / 抽屉）", () => {
  assert.equal(shouldCopy(facts({ insideZone: false })), false);
});

test("不触发：单击（选区塌缩）—— 用户只是想点高亮展开批注", () => {
  assert.equal(shouldCopy(facts({ collapsed: true })), false);
});

test("不触发：空选区但未塌缩（拖过去没选中字符）", () => {
  assert.equal(shouldCopy(facts({ text: "" })), false);
});

test("不触发：纯空白选区（拖过消息之间的空隙）", () => {
  assert.equal(shouldCopy(facts({ text: "   \n\t\n " })), false);
});

test("不触发：选区落在 input / textarea / contenteditable 里", () => {
  // 选字是为了替换（批注备注框就在 <main> 里）
  assert.equal(shouldCopy(facts({ inFormField: true })), false);
});

test("触发：对话区里有内容的选区（多行也算）", () => {
  assert.equal(shouldCopy(facts({ text: "第一行\n第二行\n第三行" })), true);
});

test("不触发：文本只有零宽字符以外的空白组合", () => {
  assert.equal(shouldCopy(facts({ text: "\u00a0\u3000" })), false);
});

/* ---------- copyLabel：用户 2026-11-07 拍板带字数 ---------- */

test("文案：按字符数（不是 UTF-16 码元）—— 中文与 emoji 各算 1", () => {
  assert.equal(copyLabel("你好"), "已复制 · 2 字");
  assert.equal(copyLabel("😀"), "已复制 · 1 字", "emoji 是一个码点，不是两个");
});

test("文案：先 trim 再计数（拖选常带首尾空格）", () => {
  assert.equal(copyLabel("  abc  "), "已复制 · 3 字");
});

test("文案：多行按实际字符数（含换行）", () => {
  assert.equal(copyLabel("a\nb"), "已复制 · 3 字", "换行也计入，与选区长度一致");
});

/* ---------- copyFeedbackPosition：LibreChat 几何 ---------- */

const viewport = { width: 1200, height: 800 };
const capsule = { width: 120, height: 28 };

test("几何：默认放在选区上方 8px、水平居中（用户 2026-11-07 拍板上方居中）", () => {
  // 选区：x 400~600（中心 500），y 300~340
  const pos = copyFeedbackPosition({ top: 300, bottom: 340, left: 400, right: 600 }, capsule, viewport);
  assert.equal(pos.top, 300 - COPY_GAP - capsule.height, "top = 选区上边 - 8 - 胶囊高");
  assert.equal(pos.left, 500 - capsule.width / 2, "水平居中");
});

test("几何：上方放不下（会顶进 16px 边缘）→ 翻到下方", () => {
  const pos = copyFeedbackPosition({ top: 20, bottom: 60, left: 400, right: 600 }, capsule, viewport);
  assert.equal(pos.top, 60 + COPY_GAP, "翻到选区下方 8px");
});

test("几何：两边都放不下 → 夹进视口，取上方那个值（与 LibreChat 一致）", () => {
  // 视口只有 80px 高：胶囊 28 + 上下各 16 = 60，可用区间 [16, 36]
  // 选区 y 10~60 → above = 10-8-28 = -26（<16 放不下）、below = 68（>36 放不下）
  const pos = copyFeedbackPosition(
    { top: 10, bottom: 60, left: 100, right: 300 },
    capsule,
    { width: 1200, height: 80 },
  );
  // LibreChat 的第三分支是 `Math.min(Math.max(preferred, EDGE), maxTop)`，preferred = above
  assert.equal(pos.top, COPY_EDGE_MARGIN, "above=-26 被夹到下限 16");
});

test("几何：上方放得下时上方优先（下方即使放得下也不用）", () => {
  const pos = copyFeedbackPosition({ top: 400, bottom: 440, left: 400, right: 600 }, capsule, viewport);
  assert.equal(pos.top, 400 - COPY_GAP - capsule.height);
});

test("几何：水平不越界（左贴边）", () => {
  const pos = copyFeedbackPosition({ top: 300, bottom: 340, left: 0, right: 30 }, capsule, viewport);
  assert.equal(pos.left, COPY_EDGE_MARGIN);
});

test("几何：水平不越界（右贴边）", () => {
  const pos = copyFeedbackPosition({ top: 300, bottom: 340, left: 1170, right: 1200 }, capsule, viewport);
  assert.equal(pos.left, viewport.width - capsule.width - COPY_EDGE_MARGIN);
});

test("几何：胶囊比视口还宽时仍从左边起（不产生负的 left）", () => {
  const pos = copyFeedbackPosition({ top: 300, bottom: 340, left: 0, right: 1200 }, { width: 2000, height: 28 }, viewport);
  assert.equal(pos.left, COPY_EDGE_MARGIN, "夹取下限优先于\"贴右边\"");
});

test("几何：左右居中在边缘附近不会抖动（矩形顺序无关，取中心）", () => {
  const a = copyFeedbackPosition({ top: 300, bottom: 340, left: 500, right: 700 }, capsule, viewport);
  assert.equal(a.left, 600 - capsule.width / 2);
});

/* ---------- 常量与出处 ---------- */

test("常量：间距/边缘/时长与设计文档的出处一致", () => {
  assert.equal(COPY_GAP, 8, "LibreChat QuoteButton.tsx POPUP_OFFSET");
  assert.equal(COPY_EDGE_MARGIN, 16, "LibreChat QuoteButton.tsx EDGE_MARGIN");
  assert.equal(COPY_FEEDBACK_MS, 1000, "用户 2026-11-07 拍板 1000ms（Zulip/Pi 同值）");
});
