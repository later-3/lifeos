/**
 * 会话区四态穷举（Task 0016 · P1-S1）。
 *
 * 门禁要证明的事：**加载中永远不等于空**。
 * 历史教训（本轮实测）：切到 322 条消息的会话时，中间 1.4 秒显示"发一条消息开始对话"，
 * 因为界面用 `messages.length === 0` 判空——而加载中的 messages 也是空。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { viewStateOf } from "../frontend/src/session-view-state.ts";

test("无会话（草稿）→ empty（不管加载态）", () => {
  for (const sessionLoading of [false, true]) {
    for (const messageCount of [0, 1, 322]) {
      assert.equal(viewStateOf({ sessionId: undefined, sessionLoading, messageCount }), "empty");
    }
  }
});

test("有会话 + 加载中 → loading，即便消息为空", () => {
  assert.equal(viewStateOf({ sessionId: "s1", sessionLoading: true, messageCount: 0 }), "loading");
});

test("有会话 + 加载中 → loading，即便已有旧消息（切会话瞬间的残留）", () => {
  assert.equal(viewStateOf({ sessionId: "s1", sessionLoading: true, messageCount: 5 }), "loading");
});

test("有会话 + 不在加载 + 无消息 → empty（真·空会话）", () => {
  assert.equal(viewStateOf({ sessionId: "s1", sessionLoading: false, messageCount: 0 }), "empty");
});

test("有会话 + 不在加载 + 有消息 → list", () => {
  assert.equal(viewStateOf({ sessionId: "s1", sessionLoading: false, messageCount: 1 }), "list");
  assert.equal(viewStateOf({ sessionId: "s1", sessionLoading: false, messageCount: 322 }), "list");
});

test("不变式：sessionLoading 为真时，结果永远不是 empty（活性断言）", () => {
  for (const sessionId of [undefined, "s1"]) {
    for (const messageCount of [0, 1, 322]) {
      const state = viewStateOf({ sessionId, sessionLoading: true, messageCount });
      if (sessionId === undefined) {
        // 无会话时 loading 无意义，允许 empty（草稿不加载）
        assert.equal(state, "empty");
        continue;
      }
      assert.notEqual(state, "empty", `加载中却判成空会话（sessionId=${sessionId}, count=${messageCount}）`);
    }
  }
});

test("活性验证：判空改成只看 messageCount 时，本用例必须失败", () => {
  // 复刻"错误实现"，确认它确实违反上面那条不变式
  const naive = (input) =>
    input.sessionId === undefined || input.messageCount === 0 ? "empty" : "list";
  assert.equal(naive({ sessionId: "s1", messageCount: 0 }), "empty");
  // 正确实现对同一输入给 loading —— 两者不同，说明断言有效
  assert.equal(viewStateOf({ sessionId: "s1", sessionLoading: true, messageCount: 0 }), "loading");
});
