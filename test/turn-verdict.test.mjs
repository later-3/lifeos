// `src/turn-verdict.ts` 的**行为锁**（Task 0007 重构前写）。
//
// 它从 JSONL 文件尾条判定"最后一回合完成了吗"，是后端兜底对账的唯一来源
// （内存账本 miss 时以它为准）。重构它复用 `src/turn-state.ts` 之前，先用这组用例把现有行为钉住：
// 改完必须仍然全绿，一条都不能变。
//
// 用例里的 stopReason 取值来自 Pi（pi/packages/ai/src/types.ts:474）：
//   终态 stop/length/error/aborted；中间态 pending/toolUse/deferred。
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readTurnVerdict } from "../src/turn-verdict.ts";

/** 写一个临时会话文件；entries 用简写数组描述（[角色, stopReason] 或自定义条目）。 */
async function sessionFile(entries) {
  const dir = await mkdtemp(join(tmpdir(), "turn-verdict-"));
  const path = join(dir, "s.jsonl");
  const lines = entries.map((entry) => JSON.stringify(entry));
  await writeFile(path, `${lines.join("\n")}\n`, "utf8");
  return path;
}

const user = (text = "hi") => ({ type: "message", message: { role: "user", content: [{ type: "text", text }] } });
const asst = (stopReason, text = "") => ({
  type: "message",
  message: { role: "assistant", stopReason, content: text === "" ? [] : [{ type: "text", text }] },
});
const toolResult = () => ({ type: "message", message: { role: "toolResult", content: [] } });
const custom = () => ({ type: "custom", customType: "lifeos_active_task", data: { taskId: "0001" } });

test("空文件 / 没有 user：null（没有可判定的回合）", async () => {
  assert.equal(await readTurnVerdict(await sessionFile([])), null);
  assert.equal(await readTurnVerdict(await sessionFile([custom()])), null);
});

test("只有 user，没有任何 assistant：lost", async () => {
  const path = await sessionFile([user()]);
  const verdict = await readTurnVerdict(path);
  assert.equal(verdict?.state, "lost");
  assert.equal(typeof verdict?.turnId, "string");
});

test("user 之后只有 toolResult（没有 assistant）：lost", async () => {
  const path = await sessionFile([user(), toolResult()]);
  assert.equal((await readTurnVerdict(path))?.state, "lost");
});

test("stop：done", async () => {
  const path = await sessionFile([user(), asst("stop", "好了")]);
  assert.equal((await readTurnVerdict(path))?.state, "done");
});

test("length（被截断）：done —— 这一轮确实结束了", async () => {
  const path = await sessionFile([user(), asst("length", "说到一半")]);
  assert.equal((await readTurnVerdict(path))?.state, "done");
});

test("error（模型报错）：done —— 有结论地结束了，原因在助手消息里", async () => {
  const path = await sessionFile([user(), asst("error")]);
  assert.equal((await readTurnVerdict(path))?.state, "done");
});

test("aborted（用户打断）：lost —— 中断不是完成", async () => {
  const path = await sessionFile([user(), asst("aborted")]);
  assert.equal((await readTurnVerdict(path))?.state, "lost");
});

test("toolUse（中间态）：lost —— 还要继续却没了", async () => {
  const path = await sessionFile([user(), asst("toolUse"), toolResult()]);
  assert.equal((await readTurnVerdict(path))?.state, "lost");
});

test("pending / deferred（中间态）：lost", async () => {
  assert.equal((await readTurnVerdict(await sessionFile([user(), asst("pending")])))?.state, "lost");
  assert.equal((await readTurnVerdict(await sessionFile([user(), asst("deferred")])))?.state, "lost");
});

test("回归：toolUse 但那一轮有正文，仍然 lost（前端旧判据在这里判 done，正是 bug 根源）", async () => {
  const path = await sessionFile([user(), asst("toolUse", "定位本身完全正确")]);
  assert.equal((await readTurnVerdict(path))?.state, "lost");
});

test("老条目没有 stopReason 字段：done（兼容）", async () => {
  const path = await sessionFile([user(), { type: "message", message: { role: "assistant", content: [] } }]);
  assert.equal((await readTurnVerdict(path))?.state, "done");
});

test("取**最后一条** assistant 的终态：中途 toolUse、末尾 stop → done", async () => {
  const path = await sessionFile([user(), asst("toolUse"), toolResult(), asst("stop", "完成")]);
  assert.equal((await readTurnVerdict(path))?.state, "done");
});

test("只看最后一条 user 之后：上一轮失败、这一轮成功 → done", async () => {
  const path = await sessionFile([
    user("第一轮"), asst("error"),
    user("第二轮"), asst("stop", "好"),
  ]);
  assert.equal((await readTurnVerdict(path))?.state, "done");
});

test("最后一条 user 之后的 custom 条目不算收尾信号", async () => {
  const path = await sessionFile([user(), asst("toolUse"), custom()]);
  assert.equal((await readTurnVerdict(path))?.state, "lost");
});

test("坏行跳过，不影响判定", async () => {
  const dir = await mkdtemp(join(tmpdir(), "turn-verdict-"));
  const path = join(dir, "s.jsonl");
  await writeFile(path, `${JSON.stringify(user())}\n{坏行\n${JSON.stringify(asst("stop", "好"))}\n`, "utf8");
  assert.equal((await readTurnVerdict(path))?.state, "done");
});

test("turnId 可回查：形如 jsonl-<该 user 所在行号>", async () => {
  const path = await sessionFile([custom(), user(), asst("stop")]);
  // user 在第 2 行（1-based）→ turnId = jsonl-2
  assert.equal((await readTurnVerdict(path))?.turnId, "jsonl-2");
});
