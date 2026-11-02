// 回合分组（2026-11-02）：折叠粒度的地基。
// 断言集基于真实数据：本会话每轮 assistant 消息数中位 6、最大 198，
// 所以"按消息折叠"会碎成上百块 —— 必须按用户消息切轮。
import assert from "node:assert/strict";
import test from "node:test";
import { groupIntoSpans, replyIndexesOf } from "../frontend/src/turn-group.ts";

const u = { role: "user" };
const a = { role: "assistant" };

test("一句话 → 多条助手消息 = 同一轮（chat.md §3.3 的既有语义）", () => {
  const spans = groupIntoSpans([u, a, a, a]);
  assert.equal(spans.length, 1);
  assert.deepEqual(spans[0], { userIndex: 0, replyIndexes: [1, 2, 3] });
});

test("多轮各自独立，互不串味", () => {
  const spans = groupIntoSpans([u, a, a, u, a, u, a, a]);
  assert.deepEqual(spans, [
    { userIndex: 0, replyIndexes: [1, 2] },
    { userIndex: 3, replyIndexes: [4] },
    { userIndex: 5, replyIndexes: [6, 7] },
  ]);
});

test("真实极端回合：198 条助手消息仍是 1 轮（不碎成 198 块）", () => {
  const messages = [u, ...Array.from({ length: 198 }, () => a)];
  const spans = groupIntoSpans(messages);
  assert.equal(spans.length, 1);
  assert.equal(spans[0].replyIndexes.length, 198);
});

test("发完还没回：这一轮的 replyIndexes 为空（不是断链）", () => {
  const spans = groupIntoSpans([u, a, u]);
  assert.deepEqual(spans, [
    { userIndex: 0, replyIndexes: [1] },
    { userIndex: 2, replyIndexes: [] },
  ]);
});

test("开头的孤儿助手消息不丢，也不并进下一轮", () => {
  const spans = groupIntoSpans([a, a, u, a]);
  assert.deepEqual(spans, [
    { userIndex: -1, replyIndexes: [0, 1] },
    { userIndex: 2, replyIndexes: [3] },
  ]);
});

test("空会话 / 空数组不炸", () => {
  assert.deepEqual(groupIntoSpans([]), []);
});

test("按用户消息下标取该轮回复（渲染时按这条索引决定折哪几条）", () => {
  const spans = groupIntoSpans([u, a, a, u, a]);
  assert.deepEqual(replyIndexesOf(spans, 0), [1, 2]);
  assert.deepEqual(replyIndexesOf(spans, 3), [4]);
  assert.deepEqual(replyIndexesOf(spans, 99), [], "不存在的下标给空数组，不抛");
});
