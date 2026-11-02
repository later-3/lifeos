// Task 0015 · T7 / T8：完成回流与重入守卫（离线可验的部分，不调模型）。
// 守护点：登记 → 去重 → 投递确认后才清；同一回合只打扰一次；投递失败保留登记。
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  clearPendingPeer, completionAlreadySent, markCompletionSent, notifyPeerTurnFinished,
  pendingPeerOf, registerPendingPeer, resetPeerCompletionState, setPeerDeliverer,
} from "../src/peer-completion.ts";

beforeEach(() => resetPeerCompletionState());

const entry = {
  initiatorAgentId: "lifeosagent",
  initiatorSessionId: "0199aaaa-0000-7000-8000-000000000001",
  peerName: "Coder",
  initiatorTaskId: "0015",
  projectId: "lifeos",
};

test("登记后可读到；清掉后读不到", () => {
  registerPendingPeer("coder", "0199bbbb-0000-7000-8000-000000000002", entry);
  assert.deepEqual(pendingPeerOf("coder", "0199bbbb-0000-7000-8000-000000000002"), entry);
  assert.equal(pendingPeerOf("coder", "other"), undefined, "键要带 session，不能串会话");
  clearPendingPeer("coder", "0199bbbb-0000-7000-8000-000000000002");
  assert.equal(pendingPeerOf("coder", "0199bbbb-0000-7000-8000-000000000002"), undefined);
});

test("没有登记 → 不投递、不报错", async () => {
  let called = 0;
  setPeerDeliverer(async () => { called += 1; return true; });
  const result = await notifyPeerTurnFinished("coder", "no-such-session", "turn-1", "done");
  assert.equal(result, false);
  assert.equal(called, 0, "没登记就不该打扰发起方");
});

test("投递成功 → 返回 true、清登记、标记已发；同回合第二次不再投递", async () => {
  const sessionId = "0199cccc-0000-7000-8000-000000000003";
  registerPendingPeer("coder", sessionId, entry);
  const seen = [];
  setPeerDeliverer(async (input) => { seen.push(input); return true; });

  assert.equal(await notifyPeerTurnFinished("coder", sessionId, "turn-1", "done"), true);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].peerName, "Coder");
  assert.equal(seen[0].initiatorTaskId, "0015");
  assert.equal(pendingPeerOf("coder", sessionId), undefined, "成功投递后清登记");
  assert.equal(completionAlreadySent("coder", sessionId, "turn-1"), true);

  // 同一回合再来一次：不投递
  assert.equal(await notifyPeerTurnFinished("coder", sessionId, "turn-1", "done"), false);
  assert.equal(seen.length, 1, "同一 turnId 只打扰一次");
});

test("投递失败 → 保留登记（下次回合再试），且不算已发", async () => {
  const sessionId = "0199dddd-0000-7000-8000-000000000004";
  registerPendingPeer("coder", sessionId, entry);
  setPeerDeliverer(async () => false);

  assert.equal(await notifyPeerTurnFinished("coder", sessionId, "turn-1", "done"), false);
  assert.deepEqual(pendingPeerOf("coder", sessionId), entry, "失败不能丢登记");
  assert.equal(completionAlreadySent("coder", sessionId, "turn-1"), false);

  // 换成能成功的投递器：同一 turnId 这次要能发出去
  setPeerDeliverer(async () => true);
  assert.equal(await notifyPeerTurnFinished("coder", sessionId, "turn-1", "done"), true);
});

test("投递器抛异常 → 不抛给调用方（回合收尾不能被通知失败拖垮）", async () => {
  const sessionId = "0199eeee-0000-7000-8000-000000000005";
  registerPendingPeer("coder", sessionId, entry);
  setPeerDeliverer(async () => { throw new Error("boom"); });
  assert.equal(await notifyPeerTurnFinished("coder", sessionId, "turn-1", "done"), false);
  assert.deepEqual(pendingPeerOf("coder", sessionId), entry, "抛异常也算投递失败，保留登记");
});

test("失败回合也回流（state=error 照常投递）", async () => {
  const sessionId = "0199ffff-0000-7000-8000-000000000006";
  registerPendingPeer("coder", sessionId, entry);
  let received;
  setPeerDeliverer(async (input) => { received = input; return true; });
  assert.equal(await notifyPeerTurnFinished("coder", sessionId, "turn-2", "error"), true);
  assert.equal(received.state, "error");
});

test("去重表可手动标记（TTL 语义由实现保证；这里只验接口）", () => {
  markCompletionSent("coder", "s", "turn-9");
  assert.equal(completionAlreadySent("coder", "s", "turn-9"), true);
  assert.equal(completionAlreadySent("coder", "s", "turn-10"), false, "不同回合互不影响");
  assert.equal(completionAlreadySent("coder", "s2", "turn-9"), false, "不同会话互不影响");
});
