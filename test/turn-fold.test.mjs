// 回合结论的**挂点**与"过程折叠"判据（Task 0040）。
//
// 用户 2026-11-25 报障：同一句「正在生成中…（上一轮曾被中断，本轮结束前不提供重新发送）」
// 在一轮回复里被重复打印了上百次（截图 `evidence/screenshot-notice-repeat.png`）。
//
// 判据本身（`turnOutcomeOf`）在 `test/turn-state.test.mjs`，文案在 `test/turn-notice.test.mjs`。
// **本文件只测"挂在哪、挂几条"**——那是这次事故里真正错的那一层：
//   旧实现按 `messageLive`（**轮级** live）把结论挂到这一轮的每一条消息上；
//   折叠恰好把整轮收成一条时只看得见一次，折叠失效时按段数放大（实测 200 份，
//   `evidence/probe-duplication.out.txt`）。
import test from "node:test";
import assert from "node:assert/strict";
import { conclusionHostOf, foldDecisionOf, hostReplyOf, isCardMessage } from "../frontend/src/api/turn-fold.ts";

const user = () => ({ role: "user", blocks: [{ type: "text" }] });
const text = () => ({ role: "assistant", blocks: [{ type: "text" }] });
const tool = () => ({ role: "assistant", blocks: [{ type: "toolCall" }, { type: "text" }] });
const think = () => ({ role: "assistant", blocks: [{ type: "thinking" }] });
const card = () => ({ role: "assistant", blocks: [{ type: "compaction" }] });
const aborted = () => ({ role: "assistant", blocks: [], failure: "aborted", error: "aborted" });

// ── 折叠判据 ────────────────────────────────────────────────────────────────
test("T0040-1 有过程块的一轮折叠到首条回复上，其余回复隐藏", () => {
  const messages = [user(), tool(), text(), tool()];
  const decision = foldDecisionOf(messages, { replyIndexes: [1, 2, 3] });
  assert.equal(decision.kind, "folded");
  assert.equal(decision.hostIndex, 1);
  assert.deepEqual(decision.hidden, [2, 3]);
});

test("T0040-2 纯聊天（无工具无思考）不折：两个人都各自渲染", () => {
  const messages = [user(), text(), text()];
  const decision = foldDecisionOf(messages, { replyIndexes: [1, 2] });
  assert.deepEqual(decision, { kind: "none", reason: "no-process" });
});

test("T0040-3 失败/中断的一轮不折（用户要看它做过什么）", () => {
  const messages = [user(), tool(), aborted()];
  const decision = foldDecisionOf(messages, { replyIndexes: [1, 2] });
  assert.deepEqual(decision, { kind: "none", reason: "failed" });
});

test("T0040-4 还没回复的一轮：无可折（no-reply）", () => {
  assert.deepEqual(foldDecisionOf([user()], { replyIndexes: [] }), { kind: "none", reason: "no-reply" });
});

test("T0040-5 首条是压缩卡时**照样折叠** —— 宿主取卡片之后的第一条回复（本次故障的放大因子）", () => {
  // 服务端把窗口外的压缩卡补回窗口首条（src/server.ts 的 markersBeforeWindow），
  // 而 `?tail=200` 可以整段落在一轮内部（实测某轮 292 段）。
  // 旧规则「首条是卡 → 整轮不折叠」把 200 段全部单独渲染，于是结论被挂 200 次。
  const messages = [card(), tool(), tool(), tool()];
  const decision = foldDecisionOf(messages, { replyIndexes: [0, 1, 2, 3] });
  assert.equal(decision.kind, "folded");
  assert.equal(decision.hostIndex, 1, "宿主必须是第一条真回复，不是卡片");
  assert.deepEqual(decision.hidden, [2, 3], "卡片不在 hidden 里（它要留在原位），真回复被折进去");
});

test("T0040-6 折叠永远不隐藏压缩卡（卡片必须留在原位，Task 0016 P7-S9b）", () => {
  const messages = [user(), card(), tool(), card(), tool()];
  const decision = foldDecisionOf(messages, { replyIndexes: [1, 2, 3, 4] });
  assert.equal(decision.kind, "folded");
  assert.equal(decision.hostIndex, 2);
  assert.deepEqual(decision.hidden, [4], "两张卡都不在 hidden 里");
  assert.equal(isCardMessage(messages[3]), true);
});

test("T0040-7 整轮只有压缩卡（异常数据）：不折，也不崩", () => {
  assert.deepEqual(foldDecisionOf([card()], { replyIndexes: [0] }), { kind: "none", reason: "only-card" });
});

// ── 结论挂点（这次事故的核心）──────────────────────────────────────────────
test("T0040-8 一轮 200 段 → 结论只挂 1 条（不能按段数放大）", () => {
  const messages = [user(), ...Array.from({ length: 200 }, () => tool())];
  const host = conclusionHostOf(messages);
  assert.equal(host, 1, "折叠后宿主是首条回复，全对话只有这一个");
});

test("T0040-9 首条是压缩卡的一轮 200 段 → 结论仍然只挂 1 条（修前这里挂 200 条）", () => {
  const messages = [card(), ...Array.from({ length: 200 }, () => tool())];
  const host = conclusionHostOf(messages);
  assert.equal(host, 1, "卡不是宿主，第一条真回复才是");
});

test("T0040-10 纯聊天的一轮：结论挂在最后一条回复上（不折叠时一轮只渲染一条结论）", () => {
  const messages = [user(), text(), text()];
  assert.equal(conclusionHostOf(messages), 2);
});

test("T0040-11 还没有回复（刚发出）：没有挂点 —— 不渲染任何结论，也不退回逐条挂", () => {
  assert.equal(conclusionHostOf([user()]), undefined);
});

test("T0040-12 多轮对话：结论只挂最后那一轮，历史轮不重复", () => {
  const messages = [user(), tool(), tool(), user(), tool(), tool()];
  assert.equal(conclusionHostOf(messages), 4);
  // 历史轮自己的宿主仍然能被问到（MarkBar 用它），但它不持有"最新结论"
  assert.equal(hostReplyOf(messages, { replyIndexes: [1, 2] }), 1);
});

test("T0040-13 失败轮（不折叠）里也有一个宿主：最后一条非卡片回复", () => {
  const messages = [user(), tool(), aborted()];
  assert.equal(conclusionHostOf(messages), 2);
});

test("T0040-14 只有压缩卡的会话：没有挂点（不渲染、不崩）", () => {
  assert.equal(conclusionHostOf([card()]), undefined);
  assert.equal(conclusionHostOf([]), undefined);
});

test("T0040-15 真实现场回放：压缩卡 + 200 段工具回复 → 恰好 1 个结论宿主（修前 200 个）", () => {
  // 现场：`~/.lifeos/agents/frontend-developer/.../01a1f269-…jsonl` 那一轮 292 段；
  // `?tail=200` 取回 201 条（1 张补回的压缩卡 + 200 段），客户端分组为单个 userIndex=-1 的隐式轮。
  const messages = [card(), ...Array.from({ length: 200 }, () => tool())];
  const decision = foldDecisionOf(messages, { replyIndexes: messages.map((_, i) => i) });
  assert.equal(decision.kind, "folded");
  const hosted = new Set();
  const host = conclusionHostOf(messages);
  if (host !== undefined) hosted.add(host);
  assert.equal(hosted.size, 1, "一条结论、一个宿主");
  // 对照：修前按 messageLive 逐条挂 → 200 个宿主。这里显式写出来，防止"改回去也绿"。
  assert.equal(messages.length - 1, 200, "对照：200 条真回复");
});
