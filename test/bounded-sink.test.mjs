// T37–T38：有界发送（任务 0007 P1）——按字节积压、写失败即视为过载，绝不静默丢事件。
import { test } from "node:test";
import assert from "node:assert/strict";
import { createBoundedSink } from "../src/bounded-sink.ts";

test("T37 按字节积压计数：写完才释放；超过上限 offer 返回 false", async () => {
  const pending = [];
  const sink = createBoundedSink({ write: (event) => new Promise((resolve) => pending.push(resolve)), limitBytes: 200 });
  const big = { seq: 1, agentId: "a", type: "delta", text: "x".repeat(120) };
  assert.equal(sink.offer(big), true);
  assert.ok(sink.pendingBytes() > 120);
  assert.equal(sink.offer(big), false, "第二条超过 200 字节上限 → 过载");
  pending[0]();                                  // 第一条写完
  await new Promise((r) => setImmediate(r));
  assert.equal(sink.pendingBytes(), 0);
  assert.equal(sink.offer(big), true, "释放后可以继续投递");
});

test("T38 写失败（连接已断）→ 视为过载：offer 返回 false，并标记 closed", async () => {
  const sink = createBoundedSink({ write: () => Promise.reject(new Error("socket closed")), limitBytes: 10_000 });
  assert.equal(sink.offer({ seq: 1, agentId: "a", type: "turn" }), true);
  await new Promise((r) => setImmediate(r));
  assert.equal(sink.closed(), true);
  assert.equal(sink.offer({ seq: 2, agentId: "a", type: "turn" }), false);
});
