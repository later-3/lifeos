/**
 * 阅读位置与高亮锁定（Task 0020 · P5）。
 *
 * 取最近的算法看着简单，但它有两个真实的错法：
 *  - 焦点线用 `scrollTop + clientHeight`（底部）会让高亮永远停在"下一行"；
 *  - 平滑滚动期间不锁，高亮在动画里连环跳（用户看到的是"抖"）。
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  RAIL_ACTIVE_LOCK_MS, RAIL_EDGE_TOLERANCE, RAIL_FOCUS_RATIO, railActiveIndexOf, railActivePick, railAnchorIndexAt, railLockActive,
} from "../frontend/src/api/rail-anchor.ts";

const anchors = [
  { id: "u1", top: 0 }, { id: "a1", top: 200 }, { id: "u2", top: 800 },
  { id: "a2", top: 1200 }, { id: "u3", top: 2000 },
];

test("焦点线在视口正中（与「滚到中央」的跳转落点一致）", () => {
  // 初版取 0.3（照 pi-web），但我们的跳转是 block:center —— 两者不一致会让
  // "点这条、亮上一条"（2026-11-19 实测）。焦点线必须与落点同值。
  assert.equal(RAIL_FOCUS_RATIO, 0.5);
});

test("顶在最上面 → 焦点线（正中）落在第二条上（不是机械地钉第一条）", () => {
  // focus = 0 + 600*0.5 = 300；a1 在 200、u2 在 800 → 离 a1 更近（100 vs 500）。
  assert.equal(railAnchorIndexAt(anchors, 0, 600), 1);
});

test("滚到某条消息位于视口正中 → 选它", () => {
  // scrollTop=700, clientHeight=600 → focus = 700 + 300 = 1000 → 离 a2(1200) 与 u2(800) 等距
  // 严格小于才替换 → 保留先出现的 u2；再往下一点就该选 a2
  assert.equal(railAnchorIndexAt(anchors, 700, 600), 2);
  assert.equal(railAnchorIndexAt(anchors, 900, 600), 3);
});

test("滚到最底 → 最后一条（不会因为焦点线超出内容而越界）", () => {
  assert.equal(railAnchorIndexAt(anchors, 1900, 600), 4);
});

test("空锚点 → undefined，不返回 0（0 会假装「在第一条」）", () => {
  assert.equal(railAnchorIndexAt([], 0, 600), undefined);
});

test("单条锚点 → 它自己", () => {
  assert.equal(railAnchorIndexAt([{ id: "only", top: 100 }], 500, 600), 0);
});

test("等距时保留先出现的那条（严格小于才替换，结果与顺序一致）", () => {
  // scrollTop=0, h=600 → focus=300；放 200 与 400 → 等距 100
  const even = [{ id: "a", top: 200 }, { id: "b", top: 400 }];
  assert.equal(railAnchorIndexAt(even, 0, 600), 0, "等距时保留先出现的那条");
  assert.equal(railAnchorIndexAt([{ id: "a", top: 0 }, { id: "b", top: 200 }], 0, 600), 1, "非等距按距离走");
});

test("锁定期间高亮不跟中线走", () => {
  const lock = { index: 4, until: 1000 };
  assert.equal(railLockActive(lock, 500), true, "锁定中");
  assert.equal(railLockActive(lock, 1000), false, "到期即失效（不是 <=");
  assert.equal(railLockActive(undefined, 500), false, "没锁过");
});

test("锁定窗口与 pi-web 同值（1600ms）", () => {
  assert.equal(RAIL_ACTIVE_LOCK_MS, 1600);
});

/* ── 渲染窗口没覆盖视口时不能瞎选（实测缺陷）───────────────── */

test("锚点全在视口外（渲染窗口只覆盖尾部）→ 退回比例估算，不把高亮定到看不见的尾部", () => {
  // 实测场景：560 条刻度的会话滚到 50%，可见区根本没渲染，唯一量到的锚点在尾部
  const tailOnly = [{ id: "u256", top: 8800 }, { id: "a280", top: 9200 }];
  const band = { top: 4724, bottom: 5568 };
  const picked = railActiveIndexOf(tailOnly, band, 4724, 844, 140);
  assert.deepEqual(picked, { index: 140, source: "fraction" });
});

test("有锚点落在可见区附近 → 用锚点（更准）", () => {
  const near = [{ id: "u140", top: 4700 }, { id: "a141", top: 5000 }, { id: "u256", top: 8800 }];
  const band = { top: 4724, bottom: 5568 };
  const picked = railActiveIndexOf(near, band, 4724, 844, 999);
  assert.equal(picked.source, "anchor");
  assert.ok(picked.index < 3, "选中的应是可见区里的那两条之一，不是尾部那条");
});

test("视口上下各留一个视口高度作为容差（贴近边缘的锚点仍然可用）", () => {
  const justAbove = [{ id: "x", top: 4724 - 800 }];
  const band = { top: 4724, bottom: 5568 };
  assert.equal(railActiveIndexOf(justAbove, band, 4724, 844, 7).source, "anchor");
  const farAbove = [{ id: "x", top: 4724 - 2000 }];
  assert.equal(railActiveIndexOf(farAbove, band, 4724, 844, 7).source, "fraction");
});

/* ── 三来源选择（组件实际调用的是这个）────────────────────── */

test("有锚点 → 用锚点（最准）", () => {
  // scrollTop=400, clientHeight=600 → focus = 400 + 180 = 580；离 b(500) 更近 → 1
  const anchors = [{ id: "a", top: 100 }, { id: "b", top: 500 }];
  assert.deepEqual(railActivePick(anchors, 400, 600, 9, 42), { index: 1, source: "anchor" });
});

test("没有锚点 → 用兜底下标（已下载里最后一条可见刻度），不是比例", () => {
  assert.deepEqual(railActivePick([], 5000, 600, 77, 200), { index: 77, source: "fallback" });
});

test("两者都没有 → 比例兜底；返回 undefined 只在三样全无时", () => {
  assert.deepEqual(railActivePick([], 0, 600, undefined, 13), { index: 13, source: "fraction" });
});

/* ── 两端吸附 ─────────────────────────────────────────────── */

test("贴顶 → 第一条；贴底 → 最后一条（会话末尾是最常停留的位置）", () => {
  const bounds = { lastIndex: 559, scrollHeight: 96265, loadedFrom: 0 };
  assert.deepEqual(railActivePick([], 0, 804, 300, 300, bounds), { index: 0, source: "edge" });
  assert.deepEqual(railActivePick([], 96265 - 804, 804, 300, 300, bounds), { index: 559, source: "edge" });
});

test("还有更早的没下载时，贴顶**不**吸附到第 0 条（用户贴的是已下载部分的顶）", () => {
  const bounds = { lastIndex: 559, scrollHeight: 96265, loadedFrom: 460 };
  const picked = railActivePick([], 0, 804, 470, 470, bounds);
  assert.notEqual(picked.source, "edge");
});

test("离端点超过容差就不吸附，回到常规判定", () => {
  const bounds = { lastIndex: 559, scrollHeight: 96265, loadedFrom: 0 };
  const picked = railActivePick([{ id: "a", top: 5000 }], 5000, 804, 7, 7, bounds);
  assert.notEqual(picked.source, "edge");
  assert.equal(RAIL_EDGE_TOLERANCE, 8);
});
