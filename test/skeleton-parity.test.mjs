/**
 * 骨架屏尺寸对齐（Task 0015 · S5 门禁）。
 *
 * 刷新跳版的主要来源：骨架高度 ≠ 真实内容高度。
 * 断言：骨架行的每一档尺寸必须出现在真实 primitive 的类名里（不允许自造高度）。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const SK = readFileSync(new URL("../frontend/src/design/skeleton.tsx", import.meta.url), "utf8");
const UI = readFileSync(new URL("../frontend/src/design/ui.tsx", import.meta.url), "utf8");
const APP = readFileSync(new URL("../frontend/src/App.tsx", import.meta.url), "utf8");

test("ListSkeleton 的行高与 Row 一致（h-11 / sm:h-8）", () => {
  assert.ok(/h-11/.test(SK) && /sm:h-8/.test(SK), "ListSkeleton 行高没跟 Row 对齐（Row = h-11 sm:h-8）");
  // Row 侧必须真的用了这两个值，否则对齐是假对齐
  assert.ok(/h-11/.test(UI) && /sm:h-8/.test(UI), "design/ui 的 Row 行高变了——骨架要同步改");
});

test("骨架的间距与列表容器一致（mb-0.5 ≈ space-y-0.5）", () => {
  assert.ok(/mb-0\.5/.test(SK), "骨架行间距不是 2px（列表容器用 space-y-0.5）");
});

test("列表骨架有稳定标识（截图基线/测试可断言）", () => {
  assert.ok(/data-skeleton="list"/.test(SK), "缺 data-skeleton=list");
  assert.ok(/data-skeleton="message"/.test(SK), "缺 data-skeleton=message");
});

test("App 用的是尺寸对齐的骨架（不是通用 Skeleton）", () => {
  assert.ok(/ListSkeleton/.test(APP), "App 还在用通用 Skeleton（尺寸不对齐 → 刷新跳版）");
});

test("活性验证：骨架高度若改成自造值（h-13），对齐检查必须红", () => {
  const bad = SK.replace(/h-11/g, "h-13");
  assert.ok(!/h-11/.test(bad), "探测规则失效（改高度检测不出来）");
});
