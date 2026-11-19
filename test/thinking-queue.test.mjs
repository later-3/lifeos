/**
 * 思考取数的并发闸与去重（Task 0028 · P7）。
 *
 * 缺陷现场（用户 2026-11-19 截图"一屏正在取思考正文 + 页面卡死"）：
 * 执行中的会话里有 82 个 deferred 思考块，进入会话时**同时**发出 9 条
 * `…/thinking` 请求（峰值并发 9）。每条在后端都要重读解析整个会话文件
 * （实测 4.2MB 会话单条 21–23ms），而浏览器同源只有 6 条连接 →
 * 切会话的详情请求排在后面 → 页面像卡死。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { THINKING_LIMIT, thinkingQueueState, withThinkingSlot } from "../frontend/src/api/thinking-queue.ts";

const tick = (ms = 5) => new Promise((resolve) => setTimeout(resolve, ms));

test("T28-22 并发上限：同时在飞不超过 THINKING_LIMIT", async () => {
  let running = 0;
  let peak = 0;
  const jobs = Array.from({ length: 12 }, (_, i) => withThinkingSlot(`k${i}`, async () => {
    running += 1;
    peak = Math.max(peak, running);
    await tick(10);
    running -= 1;
    return String(i);
  }));
  const results = await Promise.all(jobs);
  assert.equal(results.length, 12);
  assert.ok(peak <= THINKING_LIMIT, `峰值并发 ${peak} 不得超过 ${THINKING_LIMIT}`);
  assert.deepEqual(thinkingQueueState(), { running: 0, queued: 0 }, "结束后必须归零");
});

test("T28-22b 去重：同一个 key 同时被两处请求，只发一次", async () => {
  let calls = 0;
  const task = async () => { calls += 1; await tick(10); return "正文"; };
  const [a, b] = await Promise.all([withThinkingSlot("same", task), withThinkingSlot("same", task)]);
  assert.equal(calls, 1, "同 key 必须复用同一个 Promise");
  assert.equal(a, "正文");
  assert.equal(b, "正文");
  // 完成后同 key 再来一次 → 重新发（不缓存结果，避免拿到过期正文）
  await withThinkingSlot("same", task);
  assert.equal(calls, 2);
});

test("T28-22c 失败也释放槽位（否则一次失败会永久占住一条额度）", async () => {
  await assert.rejects(withThinkingSlot("bad", async () => { await tick(5); throw new Error("boom"); }));
  assert.deepEqual(thinkingQueueState(), { running: 0, queued: 0 });
  // 之后仍能满额工作
  let peak = 0;
  let running = 0;
  await Promise.all(Array.from({ length: 6 }, (_, i) => withThinkingSlot(`after${i}`, async () => {
    running += 1; peak = Math.max(peak, running); await tick(5); running -= 1;
  })));
  assert.ok(peak <= THINKING_LIMIT);
  assert.deepEqual(thinkingQueueState(), { running: 0, queued: 0 });
});
