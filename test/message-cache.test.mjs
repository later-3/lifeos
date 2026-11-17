/**
 * 会话消息内存缓存（Task 0016 · B1）的契约。
 *
 * 这一组锁的是**三条硬规则**（`message-cache.ts` 头注里写的）：
 *  ① 键带 agentId —— 同一个 sessionId 在两个 Agent 下是不同的事实；
 *  ② 正在跑的会话不进缓存 —— 否则切回来看到"半句话"；
 *  ③ 过期时间 + 上限淘汰 —— 不能无限增长，也不能永久陈旧。
 *
 * 为什么这些规则要测：它们不会报错，只会静默给出错的内容
 * （跨 Agent 串消息、流式被冻住、内存涨）。这类"静默错"是本轮反复出现的形态。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { cacheableOf, createMessageCache, messageCacheKey } from "../frontend/src/message-cache.ts";

const msg = (id) => ({ role: "user", text: id, blocks: [] });

test("键带 agentId：同一 sessionId 在两个 Agent 下互不干扰", () => {
  const cache = createMessageCache();
  cache.set("agentA", "s1", { messages: [msg("A")] });
  cache.set("agentB", "s1", { messages: [msg("B")] });
  assert.equal(cache.get("agentA", "s1")?.messages[0].text, "A");
  assert.equal(cache.get("agentB", "s1")?.messages[0].text, "B");
  // 清掉一个不影响另一个
  cache.invalidate("agentA", "s1");
  assert.equal(cache.get("agentA", "s1"), undefined);
  assert.equal(cache.get("agentB", "s1")?.messages[0].text, "B");
});

test("agentId 与 sessionId 里含分隔符也不会串键", () => {
  // NUL 不可能出现在 id 里，所以 (a, b) 与 (a\0b, "") 不会撞键
  assert.notEqual(messageCacheKey("a", "b"), messageCacheKey("a\u0000b", ""));
});

test("TTL：过期后取不到（并且顺手清掉）", () => {
  const cache = createMessageCache({ ttlMs: 1000 });
  cache.set("a", "s", { messages: [msg("x")] }, 1_000);
  assert.ok(cache.get("a", "s", 1_500) !== undefined, "未过期应命中");
  assert.equal(cache.get("a", "s", 2_500), undefined, "过期应不命中");
  assert.equal(cache.size(), 0, "过期条目应被清掉（不留垃圾）");
});

test("上限：超过 max 时淘汰最旧的", () => {
  const cache = createMessageCache({ max: 3, ttlMs: 60_000 });
  cache.set("a", "s1", { messages: [msg("1")] }, 100);
  cache.set("a", "s2", { messages: [msg("2")] }, 200);
  cache.set("a", "s3", { messages: [msg("3")] }, 300);
  cache.set("a", "s4", { messages: [msg("4")] }, 400);
  assert.equal(cache.size(), 3);
  assert.equal(cache.get("a", "s1", 500), undefined, "最旧的应被淘汰");
  assert.ok(cache.get("a", "s4", 500) !== undefined, "最新的一定在");
});

test("patchMeta 只改 meta，不动 messages", () => {
  const cache = createMessageCache();
  cache.set("a", "s", { messages: [msg("x")], meta: { running: false } }, 1_000);
  cache.patchMeta("a", "s", { running: true }, 1_100);
  const hit = cache.get("a", "s", 1_200);
  assert.deepEqual(hit?.messages.map((m) => m.text), ["x"]);
  assert.equal(hit?.meta?.running, true);
});

test("patchMeta 对过期条目无效（不会把已过期的复活）", () => {
  const cache = createMessageCache({ ttlMs: 100 });
  cache.set("a", "s", { messages: [msg("x")] }, 0);
  cache.patchMeta("a", "s", { running: true }, 1_000);
  assert.equal(cache.get("a", "s", 1_000), undefined);
});

test("cacheableOf：正在跑的会话不进缓存（否则切回来是半句话）", () => {
  assert.equal(cacheableOf({ running: true }), false);
  assert.equal(cacheableOf({ running: false }), true);
  assert.equal(cacheableOf(undefined), true, "没有 meta 时按可缓存处理（老数据/边界）");
});

test("clear 清空全部（切 Agent 整体失效用）", () => {
  const cache = createMessageCache();
  cache.set("a", "s1", { messages: [] });
  cache.set("b", "s2", { messages: [] });
  assert.equal(cache.size(), 2);
  cache.clear();
  assert.equal(cache.size(), 0);
});
