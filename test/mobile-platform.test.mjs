/**
 * 手机平台层三条判定（Task 0016 · P2-S2）。
 *
 * 依据与实测见 `frontend/src/mobile-platform.ts` 头注与 `knowledge/reference-mobile.md`：
 *  - `resolveAppHeight`：双指放大时不能用 visualViewport 高度（否则整页缩水）
 *  - `mobileQueryOf`：横屏手机（844×390）必须留在移动布局
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { MOBILE_QUERY, mobileQueryOf, resolveAppHeight } from "../frontend/src/mobile-platform.ts";

// ── resolveAppHeight ────────────────────────────────────────────────────────

test("键盘弹起（未放大）→ 跟随可见区域高度", () => {
  assert.equal(resolveAppHeight({ innerHeight: 844, visualHeight: 500, visualScale: 1 }), 500);
});

test("键盘收起（未放大）→ 用布局高度", () => {
  assert.equal(resolveAppHeight({ innerHeight: 844, visualHeight: 844, visualScale: 1 }), 844);
});

test("**双指放大** → 不跟着缩（这是本函数存在的唯一理由）", () => {
  assert.equal(resolveAppHeight({ innerHeight: 844, visualHeight: 400, visualScale: 2 }), 844);
  assert.equal(resolveAppHeight({ innerHeight: 844, visualHeight: 300, visualScale: 1.5 }), 844);
});

test("放大且键盘也弹起 → 仍用布局高度（放大优先，避免缩水叠缩水）", () => {
  assert.equal(resolveAppHeight({ innerHeight: 844, visualHeight: 260, visualScale: 2.2 }), 844);
});

test("scale 在抖动范围内（1.02）→ 仍按未放大处理", () => {
  assert.equal(resolveAppHeight({ innerHeight: 844, visualHeight: 500, visualScale: 1.02 }), 500);
});

test("visualHeight 非法（0 / NaN / 大于 innerHeight）→ 退回布局高度，不写脏值", () => {
  assert.equal(resolveAppHeight({ innerHeight: 844, visualHeight: 0, visualScale: 1 }), 844);
  assert.equal(resolveAppHeight({ innerHeight: 844, visualHeight: Number.NaN, visualScale: 1 }), 844);
  assert.equal(resolveAppHeight({ innerHeight: 844, visualHeight: 900, visualScale: 1 }), 844);
});

// ── 断点 ────────────────────────────────────────────────────────────────────

test("MOBILE_QUERY 保留我们自己的 639 宽度断点", () => {
  assert.ok(MOBILE_QUERY.startsWith("(max-width: 639px)"), `宽度断点变了：${MOBILE_QUERY}`);
});

test("MOBILE_QUERY 含'粗指针 + 矮视口'那一支（横屏手机）", () => {
  assert.ok(/\(hover: none\)/.test(MOBILE_QUERY), "缺 hover:none");
  assert.ok(/\(pointer: coarse\)/.test(MOBILE_QUERY), "缺 pointer:coarse");
  assert.ok(/\(max-height: 500px\)/.test(MOBILE_QUERY), "缺 max-height（横屏判据）");
});

test("MOBILE_QUERY 不含 768（那是参考项目的宽度，套到我们会让 700px 丢三列）", () => {
  assert.ok(!/max-width: 768px/.test(MOBILE_QUERY), "宽度断点被改成了 768——640–768 的三列会消失");
});

test("mobileQueryOf 换宽度时仍保留横屏那一支", () => {
  const query = mobileQueryOf(700);
  assert.ok(query.startsWith("(max-width: 700px)"));
  assert.ok(/\(hover: none\) and \(pointer: coarse\) and \(max-height: 500px\)/.test(query));
});

test("活性验证：若去掉横屏那一支，本文件的横屏断言必须失败", () => {
  const broken = "(max-width: 639px)";
  assert.ok(!/\(hover: none\)/.test(broken), "探测规则失效");
  assert.ok(/\(hover: none\)/.test(MOBILE_QUERY), "真实常量里也没有这一支");
});
