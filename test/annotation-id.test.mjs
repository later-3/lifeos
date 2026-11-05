// 批注 id 生成（Task 0008 修复）：锁"新 id 不与已有 id 相交"。
//
// 事故：旧实现模块级 `seq` 每次刷新从 0 重计 → 刷新后新建的第一条永远叫 `a1`，
// 与服务端已有 `a1` 撞车 → 同 id 两张卡一起拖/一起删 + 落盘重放时静默覆盖旧批注。
// 这组测试把"不可能撞车"锁死。
import { test } from "node:test";
import assert from "node:assert/strict";
import { nextAnnotationId, uniqueAnnotationId } from "../frontend/src/annotation-id.ts";

test("同一毫秒内连续创建：序号递增，互不相同", () => {
  const now = 1_700_000_000_000;
  const a = nextAnnotationId(1, now);
  const b = nextAnnotationId(2, now);
  assert.notEqual(a, b);
  assert.match(a, /^a1/);
  assert.match(b, /^a2/);
});

test("跨刷新（seq 归零）也不撞：时间戳部分不同", () => {
  const first = nextAnnotationId(1, 1_700_000_000_000);
  const afterReload = nextAnnotationId(1, 1_700_000_001_000);
  assert.notEqual(first, afterReload, "刷新后第一条不能与上一轮第一条同 id");
});

test("撞了已知 id 时换下一个：uniqueAnnotationId 避开 taken", () => {
  const now = 1_700_000_000_000;
  const taken = new Set([nextAnnotationId(1, now)]);
  const id = uniqueAnnotationId(taken, 1, now);
  assert.equal(taken.has(id), false, "返回的 id 必须不在 taken 里");
});

test("连续多次撞车也能找到空位（guard 上限内）", () => {
  const now = 1_700_000_000_000;
  const taken = new Set();
  for (let s = 1; s <= 50; s++) taken.add(nextAnnotationId(s, now));
  const id = uniqueAnnotationId(taken, 1, now);
  assert.equal(taken.has(id), false);
});

test("id 形态保持 a 开头（可读、能看出是批注）", () => {
  assert.match(uniqueAnnotationId(new Set(), 7, 1_700_000_000_000), /^a7/);
});
