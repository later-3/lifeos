/**
 * 压缩摘要必须出现在会话消息里（Task 0016 · P7-S9）。
 *
 * 用户 2026-11-17 实测：「怎么感觉 session 被截断了呢？Session 历史消息看不到了」。
 * 根因：`messagesOf()` 读的是 Pi 的**模型上下文投影**，压缩之后 `firstKeptEntryId` 之前的
 * 条目不再出现在投影里，而投影里的 `compactionSummary` 消息此前**没有分支处理** → 被静默丢弃。
 * 于是磁盘上 22 条提问，界面上只剩 1 条，且没有任何提示。
 *
 * 这几条断言锁的是"用户能看见压缩发生过"：
 *  - 压缩后仍有一条 compaction 块，且摘要正文与 Pi 落的摘要一致；
 *  - 它排在压缩点保留段之前（第一条），不是被折叠进某轮过程里；
 *  - 没有压缩的会话**不**出现 compaction 块（不误报）。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { messagesOf } from "../src/agent-host.ts";

const msg = (id, role, content, prevId = null, extra = {}) => ({
  type: "message", id, parentId: prevId, timestamp: "2026-01-01T00:00:01.000Z",
  message: { role, content, timestamp: 1, ...extra },
});

async function makeSession(entries) {
  const dir = await mkdtemp(join(tmpdir(), "compaction-"));
  const file = join(dir, "2026-01-01T00-00-00-000Z_test.jsonl");
  const lines = [
    { type: "session", version: 3, id: "test-session", timestamp: "2026-01-01T00:00:00.000Z", cwd: dir },
    ...entries,
  ];
  await writeFile(file, lines.map((l) => JSON.stringify(l)).join("\n") + "\n", "utf8");
  return { dir, file };
}

function stateOf(file, dir) {
  return { session: { sessionManager: SessionManager.open(file, dir, dir) } };
}

test("T9-1 有压缩 → 消息里出现一条 compaction 块，摘要正文一致", async () => {
  const summary = "## Goal\n把手机端性能做完。";
  const { dir, file } = await makeSession([
    msg("u1", "user", [{ type: "text", text: "很早的提问" }]),
    msg("a1", "assistant", [{ type: "text", text: "很早的回复" }], "u1", { stopReason: "end" }),
    // 压缩点：firstKeptEntryId 指向上面的 a1 —— 也就是说 u1 会被丢掉、a1 起保留
    {
      type: "compaction", id: "c1", parentId: "a1", timestamp: "2026-01-01T00:00:02.000Z",
      summary, firstKeptEntryId: "a1", tokensBefore: 984407,
    },
    msg("u2", "user", [{ type: "text", text: "压缩之后的提问" }], "c1"),
    msg("a2", "assistant", [{ type: "text", text: "压缩之后的回复" }], "u2", { stopReason: "end" }),
  ]);
  const out = messagesOf(stateOf(file, dir));
  const cards = out.filter((m) => (m.blocks ?? []).some((b) => b.type === "compaction"));
  assert.equal(cards.length, 1, `应当恰好 1 条压缩卡，实际 ${cards.length}（消息总数 ${out.length}）`);
  const block = cards[0].blocks.find((b) => b.type === "compaction");
  assert.equal(block.summary, summary, "摘要正文必须与 Pi 落的一致（不改写、不截断）");
  assert.equal(block.tokensBefore, 984407, "压缩前 token 数原样透出");
});

test("T9-2 压缩卡排在保留段之前（读起来就是「从这里开始压缩的」）", async () => {
  const { dir, file } = await makeSession([
    msg("u1", "user", [{ type: "text", text: "很早的提问" }]),
    msg("a1", "assistant", [{ type: "text", text: "保留段第一条" }], "u1", { stopReason: "end" }),
    {
      type: "compaction", id: "c1", parentId: "a1", timestamp: "2026-01-01T00:00:02.000Z",
      summary: "摘要", firstKeptEntryId: "a1", tokensBefore: 1000,
    },
    msg("u2", "user", [{ type: "text", text: "之后的提问" }], "c1"),
  ]);
  const out = messagesOf(stateOf(file, dir));
  const cardIndex = out.findIndex((m) => (m.blocks ?? []).some((b) => b.type === "compaction"));
  assert.ok(cardIndex >= 0, "压缩卡必须存在");
  assert.equal(cardIndex, 0, `压缩卡应是第一条（pi 把 compaction 放在投影第一位），实际下标 ${cardIndex}`);
});

test("T9-3 没有压缩的会话 → 不出现 compaction 块（不误报）", async () => {
  const { dir, file } = await makeSession([
    msg("u1", "user", [{ type: "text", text: "提问" }]),
    msg("a1", "assistant", [{ type: "text", text: "回复" }], "u1", { stopReason: "end" }),
  ]);
  const out = messagesOf(stateOf(file, dir));
  const cards = out.filter((m) => (m.blocks ?? []).some((b) => b.type === "compaction"));
  assert.equal(cards.length, 0, "没有 compaction 条目就不该有压缩卡");
  assert.equal(out.length, 2, "两条消息原样返回");
});
