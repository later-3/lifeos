/**
 * messagesOf 透出消息 id（Task 0003 · P1-1）。
 *
 * 为什么必须测：批注要挂到"哪条消息"上。没有稳定 id 就只能挂 index，
 * 而 index 会随重渲染/切换漂移。实测事实：一个 session entry 恰好对应一条消息，
 * entry.id 全局唯一（398 条消息 / 0 个多产出 / 398 个唯一 id）。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { messagesOf } from "../src/agent-host.ts";

/** 造一个最小会话文件：header + 几条 message entry。 */
async function makeSession(entries) {
  const dir = await mkdtemp(join(tmpdir(), "anno-session-"));
  const file = join(dir, "2026-01-01T00-00-00-000Z_test.jsonl");
  const lines = [
    { type: "session", version: 3, id: "test-session", timestamp: "2026-01-01T00:00:00.000Z", cwd: dir },
    ...entries,
  ];
  await writeFile(file, lines.map((l) => JSON.stringify(l)).join("\n") + "\n", "utf8");
  return { dir, file };
}

/** 造一条 message entry。parentId 必须串成一条链——否则分支投影只留叶子路径，前面的消息会消失。 */
const msg = (id, role, content, prevId = null, extra = {}) => ({
  type: "message", id, parentId: prevId, timestamp: "2026-01-01T00:00:01.000Z",
  message: { role, content, timestamp: 1, ...extra },
});

/** 把 messagesOf 需要的 state 造出来（只需要 sessionManager.buildSessionProjection）。 */
function stateOf(file, dir) {
  const manager = SessionManager.open(file, dir, dir);
  return { session: { sessionManager: manager } };
}

test("T1-1 每条消息都带非空 id", async () => {
  const { dir, file } = await makeSession([
    msg("id-user-1", "user", [{ type: "text", text: "用户说的话" }]),
    msg("id-assistant-1", "assistant", [{ type: "text", text: "助手回复" }], "id-user-1", { stopReason: "end" }),
  ]);
  const out = messagesOf(stateOf(file, dir));
  assert.ok(out.length >= 2, `至少要 2 条消息，实际 ${out.length}`);
  for (const m of out) {
    assert.equal(typeof m.id, "string", `role=${m.role} 的 id 必须是字符串`);
    assert.notEqual(m.id, "", `role=${m.role} 的 id 不能为空`);
    assert.notEqual(m.id, "undefined", "id 不能是字符串 'undefined'");
  }
});

test("T1-2 id 与 JSONL 里对应 entry 的 id 一致", async () => {
  const ids = ["aaa111", "bbb222", "ccc333"];
  const { dir, file } = await makeSession([
    msg(ids[0], "user", [{ type: "text", text: "一" }]),
    msg(ids[1], "assistant", [{ type: "text", text: "二" }], ids[0], { stopReason: "end" }),
    msg(ids[2], "user", [{ type: "text", text: "三" }], ids[1]),
  ]);
  const out = messagesOf(stateOf(file, dir));
  const got = out.map((m) => m.id);

  // 从原始文件读一遍 entry id，作为独立事实源比对（不信任 messagesOf 自己）
  const raw = await readFile(file, "utf8");
  const fileIds = raw.trim().split("\n")
    .map((line) => JSON.parse(line))
    .filter((e) => e.type === "message")
    .map((e) => e.id);

  for (const id of got) {
    assert.ok(fileIds.includes(id), `messagesOf 给的 ${id} 不在 JSONL 的 entry id 里`);
  }
  assert.equal(new Set(got).size, got.length, "id 之间不能重复");
});

test("T1-3 同一会话读两次，id 序列完全相同", async () => {
  const { dir, file } = await makeSession([
    msg("x1", "user", [{ type: "text", text: "A" }]),
    msg("x2", "assistant", [{ type: "text", text: "B" }], "x1", { stopReason: "end" }),
  ]);
  const first = messagesOf(stateOf(file, dir)).map((m) => m.id);
  const second = messagesOf(stateOf(file, dir)).map((m) => m.id);
  assert.deepEqual(second, first, "同一文件读两次，id 序列必须一致");
});

test("T1-4 既有字段未被破坏（role/text/blocks 仍在）", async () => {
  const { dir, file } = await makeSession([
    msg("y1", "user", [{ type: "text", text: "原文" }]),
    msg("y2", "assistant", [{ type: "text", text: "回应" }], "y1", { stopReason: "end" }),
  ]);
  const out = messagesOf(stateOf(file, dir));
  const user = out.find((m) => m.role === "user");
  const assistant = out.find((m) => m.role === "assistant");
  assert.equal(user?.text, "原文");
  assert.deepEqual(user?.blocks.map((b) => b.type), ["text"]);
  assert.equal(assistant?.text, "回应");
  // 原有可选字段仍在（不是被 id 挤掉）
  assert.ok("at" in (assistant ?? {}), "at 字段应仍存在");
});
