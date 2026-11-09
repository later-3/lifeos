// 回合结束补丁里的 `unread` 必须与"已读判定"一致（Task 0005 · 2026-11-08）。
//
// 用户的实测现象：**有绿色数字 1，但行上没有绿点**。
//
// 机制：`recordCompletion` 已经把这条标成已读（因为用户停在这个会话上），
// 但紧接着 `pushTerminal` **无条件**发了 `{ unread: { since } }` →
// 前端数字 +1、绿点闪一下；随后 refresh-groups 重取把行刷回 idle，
// 而 `sessionSlots` 没人减 → 数字永久比点多 1。
//
// 约束：`onSession` 为真时补丁只能发 `unread: null`。
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRowPatchPublisher } from "../src/row-patch.ts";

test("T82 pushTerminal 发 unread:null 时，前端据此清槽位（不被当成未读）", async () => {
  const sent = [];
  const patch = createRowPatchPublisher({ now: () => 1000, interval: 0, send: (...args) => sent.push(args) });
  patch.pushTerminal("a", "s1", "p1", { unread: null, lastActivityAt: "2026-11-08T00:00:00Z" });
  assert.equal(sent.length, 1);
  const [, , , body] = sent[0];
  assert.equal(body.unread, null, "已读的回合必须发 unread:null（不能省略、更不能发时间戳）");
  assert.equal(body.running, null, "终态补丁同时清运行态");
});

test("T83 未读的回合补丁带 unread 时间戳", async () => {
  const sent = [];
  const patch = createRowPatchPublisher({ now: () => 1000, interval: 0, send: (...args) => sent.push(args) });
  patch.pushTerminal("a", "s1", "p1", { unread: { since: "2026-11-08T00:00:00Z" }, lastActivityAt: "2026-11-08T00:00:00Z" });
  const [, , , body] = sent[0];
  assert.deepEqual(body.unread, { since: "2026-11-08T00:00:00Z" });
});
