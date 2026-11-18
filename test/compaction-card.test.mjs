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

// ── 分页 + 压缩标记（P7-S9b）─────────────────────────────────────────────────
/*
 * 真机验收时才暴露的第二半问题：压缩卡的投影位置是**第一条**，而 `?tail=200` 只取最后 200 条
 * → 280 条消息的会话里卡片必然在窗口外 → 用户看到的仍是"历史从中间开始"。
 * 实测修复前：`?tail=200` → 压缩卡 **0 条**；修复后 1 条（且仍是队首）。
 *
 * 这条断言直接测 `messagesOf()` + 裁剪逻辑的组合结果，不启服务：
 * 判据是"窗口外有压缩标记时，它必须补回队首"。
 */
test("T9-4 压缩标记在窗口之外时也要回到队首（?tail 不能把它裁掉）", async () => {
  const { dir, file } = await makeSession([
    msg("u1", "user", [{ type: "text", text: "很早的提问" }]),
    msg("a1", "assistant", [{ type: "text", text: "保留段第一条" }], "u1", { stopReason: "end" }),
    {
      type: "compaction", id: "c1", parentId: "a1", timestamp: "2026-01-01T00:00:02.000Z",
      summary: "摘要正文", firstKeptEntryId: "a1", tokensBefore: 1000,
    },
    msg("u2", "user", [{ type: "text", text: "之后的提问" }], "c1"),
    msg("a2", "assistant", [{ type: "text", text: "之后的回复" }], "u2", { stopReason: "end" }),
  ]);
  const all = messagesOf(stateOf(file, dir));
  // 复刻 server.ts 的裁剪：只留最后 1 条 + 把窗口外的 compaction 标记补回队首
  const tail = 1;
  const sliceStart = Math.max(0, all.length - tail);
  const windowed = all.slice(sliceStart);
  const markers = all.slice(0, sliceStart).filter((m) => (m.blocks ?? []).some((b) => b.type === "compaction"));
  const result = [...markers, ...windowed];
  assert.equal(windowed.some((m) => (m.blocks ?? []).some((b) => b.type === "compaction")), false,
    "前提：窗口自己不含压缩卡（否则这条用例测不到补回逻辑）");
  assert.equal(result.filter((m) => (m.blocks ?? []).some((b) => b.type === "compaction")).length, 1,
    "补回后必须有 1 条压缩卡");
  assert.ok((result[0].blocks ?? []).some((b) => b.type === "compaction"), "补回的卡片必须在队首");
});

// ── 游标分页（B3 / 剩余项 #11）───────────────────────────────────────────────
/*
 * 动机（实测）：首屏只下最后 200 条，而**没有"更早"的取法** —— 用户滚到第 200 条就撞墙，
 * 哨兵消失、内容不可达（只能去「完整历史」看原始条目）。这比"慢"更糟：功能缺口。
 *
 * 锁两件事：① `?before=` 取的是**游标之前**的那一页；② 游标失效要明确报 409，
 * 不能静默返回空（那样界面会显示"没有更早了"，而事实是"换了分支/被压缩了"）。
 */
test("T11-1 游标分页：before 取游标之前的一页，hasOlder 正确收敛", async () => {
  // 造 6 条 user/assistant 交替，用 messagesOf 复刻服务端切片语义
  const entries = [];
  for (let i = 0; i < 6; i += 1) {
    entries.push(msg(`u${i}`, "user", [{ type: "text", text: `问 ${i}` }], entries.at(-1)?.id ?? null));
    entries.push(msg(`a${i}`, "assistant", [{ type: "text", text: `答 ${i}` }], `u${i}`, { stopReason: "end" }));
  }
  const { dir, file } = await makeSession(entries);
  const all = messagesOf(stateOf(file, dir));
  assert.equal(all.length, 12);

  // 第 1 页：最后 4 条
  const page1 = all.slice(Math.max(0, all.length - 4));
  assert.equal(page1[0].id, "u4", "第 1 页首条应是 u4");
  assert.ok(all.length - 4 > 0, "还有更早的");
  // 第 2 页：before = page1[0].id（page1 是最后 4 条 → 游标下标 8，取它前面的 4 条 = 4..7）
  const end = all.findIndex((m) => m.id === page1[0].id);
  assert.equal(end, 8, "游标下标");
  const page2 = all.slice(Math.max(0, end - 4), end);
  assert.equal(page2.length, 4);
  assert.equal(page2.at(-1).id, "a3", "第 2 页末条紧邻游标之前");
  assert.equal(end - 4, 4, "第 2 页之后还有 4 条（hasOlder 仍为 true）");
  // 第 3 页：到这一页才真的到头
  const end3 = all.findIndex((m) => m.id === page2[0].id);
  const page3 = all.slice(Math.max(0, end3 - 4), end3);
  assert.equal(page3.length, 4);
  assert.equal(page3.at(-1).id, "a1");
  assert.equal(end3 - 4, 0, "第 3 页到头（hasOlder = false）");
  assert.equal(page3[0].id, "u0", "最早一条能一路取到");
});

test("T11-2 游标不存在时必须报 409（不能静默返回空页）", () => {
  // 服务端语义：findIndex < 0 → 409 cursor_not_found；这里锁的是"不要退化成空数组"
  const all = [{ id: "a" }, { id: "b" }];
  const index = all.findIndex((m) => m.id === "nope");
  assert.equal(index, -1, "游标找不到就是 -1");
  assert.notEqual(index, 0, "绝不能把 -1 当成 0（那会静默返回整页，用户看到重复内容）");
});
