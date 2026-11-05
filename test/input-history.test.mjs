// Task 0012 · 输入历史（↑/↓）的纯函数契约。
//
// 为什么抽成纯函数：这四个缺陷（不分会话 / 方向反 / 只能走一步 / 索引不复位）
// 全是**逻辑层**的，浏览器里测一次的成本高、组合多。纯函数一次穷举，
// 界面层只负责把 keydown 与 messages 喂进来（frontend/test/ui-contract.mjs 另有真键路契约）。
//
// 依据：frontend/src/input-history.ts 头注；pi-web upstream/main@f130910 ChatWindow.tsx:822-833
// （从当前会话 messages 派生）与 Pi TUI editor.ts:456-486（↑ = 下标 +1）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { historyNavigate, inputHistoryOf, NO_HISTORY_CURSOR } from "../frontend/src/input-history.ts";

const user = (text) => ({ role: "user", text });
const assistant = (text) => ({ role: "assistant", text });

/** 模拟界面：按一次键 → 返回输入框的值（undefined = 这次按键不处理）。 */
function press(state, history, key, scope = "s1") {
  const step = historyNavigate({
    cursor: state.cursor,
    scope,
    history,
    direction: key === "ArrowUp" ? "older" : "newer",
    inputEmpty: state.input === "",
  });
  if (step === undefined) return undefined;
  state.cursor = step.cursor;
  state.input = step.text;
  return step.text;
}

const conversation = [user("第一条"), assistant("好的"), user("第二条"), assistant("好的"), user("第三条")];

// T1 派生：只取 user、最近一条在前
test("T1 inputHistoryOf：只取用户消息，最近一条最先", () => {
  assert.deepEqual(inputHistoryOf(conversation), ["第三条", "第二条", "第一条"]);
});

// T2 跳过没有文字的用户消息（纯图片）与空白，去重（全局，同 pi-web）
test("T2 inputHistoryOf：跳过空文本、按内容去重（保留最近一条的位置）", () => {
  const list = [user("同一句"), assistant("x"), user(""), user("   "), user("另一句"), user("同一句")];
  assert.deepEqual(inputHistoryOf(list), ["同一句", "另一句"]);
});

// T3 上限：默认 50 条，取最近的那 50 条
test("T3 inputHistoryOf：默认上限 50，超出取最近的", () => {
  const list = Array.from({ length: 80 }, (_, i) => user(`m${i}`));
  const history = inputHistoryOf(list);
  assert.equal(history.length, 50);
  assert.equal(history[0], "m79");
  assert.equal(history[49], "m30");
});

// T4 连按 ↑：最近 → 更早，到顶停住（不是只走一步）
test("T4 连按 ↑：第三条 → 第二条 → 第一条，到顶停住", () => {
  const history = inputHistoryOf(conversation);
  const state = { cursor: NO_HISTORY_CURSOR, input: "" };
  assert.equal(press(state, history, "ArrowUp"), "第三条");
  assert.equal(press(state, history, "ArrowUp"), "第二条");
  assert.equal(press(state, history, "ArrowUp"), "第一条");
  assert.equal(press(state, history, "ArrowUp"), "第一条");   // 到顶：停住，不回绕
});

// T5 ↓ 回退：往上一条条回来，最后回到空输入
test("T5 连按 ↓：回到更新的一条，最后清空", () => {
  const history = inputHistoryOf(conversation);
  const state = { cursor: NO_HISTORY_CURSOR, input: "" };
  press(state, history, "ArrowUp");
  press(state, history, "ArrowUp");            // "第二条"
  assert.equal(press(state, history, "ArrowDown"), "第三条");
  assert.equal(press(state, history, "ArrowDown"), "");
  assert.equal(press(state, history, "ArrowDown"), undefined);   // 已经是空输入：不抢 ↓
  assert.equal(state.input, "");
});

// T6 会话隔离：历史随会话派生，切到没有历史的会话就什么都取不到（绝不回落到上一个会话）
test("T6 切会话：只取新会话自己的历史，取不到就是取不到", () => {
  const a = inputHistoryOf([user("A 的第一条"), user("A 的第二条")]);
  const b = inputHistoryOf([user("B 的第一条")]);
  const empty = inputHistoryOf([assistant("这个会话还没有用户消息")]);

  // A 里浏览到一半 → 切到 B（输入框是 B 的空草稿）：第一下就是 B 自己的最新一条
  const state = { cursor: NO_HISTORY_CURSOR, input: "" };
  press(state, a, "ArrowUp");
  press(state, a, "ArrowUp");
  state.input = "";                            // 切会话换草稿（B 是空草稿）
  assert.equal(press(state, b, "ArrowUp", "s2"), "B 的第一条");

  // 切到没有任何用户消息的会话：不处理（不会把 A 的内容再拿出来）
  const state2 = { cursor: NO_HISTORY_CURSOR, input: "" };
  assert.equal(press(state2, empty, "ArrowUp", "s3"), undefined);
  assert.equal(state2.input, "");
});

// T7 有草稿时 ↑/↓ 是光标移动，不抢
test("T7 输入框有内容且不在浏览状态时，↑ 不处理", () => {
  const history = inputHistoryOf(conversation);
  const state = { cursor: NO_HISTORY_CURSOR, input: "我正在写字" };
  assert.equal(press(state, history, "ArrowUp"), undefined);
  assert.equal(state.input, "我正在写字");
});

// T8 浏览中手动编辑（含清空）会让游标作废；再按 ↑ 回到最新那条，而不是跳过它
test("T8 浏览中手动清空输入框后再按 ↑：回到最新一条（游标随编辑作废）", () => {
  const history = inputHistoryOf(conversation);
  const state = { cursor: NO_HISTORY_CURSOR, input: "" };
  press(state, history, "ArrowUp");
  press(state, history, "ArrowUp");            // "第二条"
  // 用户在 textarea 里键入/清空 → 组件把游标置为 NO_HISTORY_CURSOR（input-history.ts 头注最后一段）
  state.cursor = NO_HISTORY_CURSOR;
  state.input = "";
  assert.equal(press(state, history, "ArrowUp"), "第三条");
});

// T8b ↓ 走过最新一条后退出浏览；再按 ↑ 从最新一条重新开始（不回绕）
test("T8b ↓ 越过最新一条即退出浏览，再按 ↑ 从最新一条开始", () => {
  const history = inputHistoryOf(conversation);
  const state = { cursor: NO_HISTORY_CURSOR, input: "" };
  press(state, history, "ArrowUp");            // "第三条"
  assert.equal(press(state, history, "ArrowDown"), "");
  assert.equal(state.cursor, NO_HISTORY_CURSOR);
  assert.equal(press(state, history, "ArrowUp"), "第三条");
});

// T9 没有历史：↑ 不处理（不 preventDefault，交给浏览器）
test("T9 没有历史时 ↑ 不处理", () => {
  const state = { cursor: NO_HISTORY_CURSOR, input: "" };
  assert.equal(press(state, [], "ArrowUp"), undefined);
  assert.equal(press(state, inputHistoryOf([assistant("只有回复")]), "ArrowUp"), undefined);
  assert.equal(state.input, "");
});

// T10 纯回复会话派生为空
test("T10 inputHistoryOf：只有助手消息时为空", () => {
  assert.deepEqual(inputHistoryOf([assistant("你好"), assistant("在的")]), []);
});

// T11 trim：取回的是去掉首尾空白的文本（发送时也 trim，两者一致）
test("T11 inputHistoryOf：文本按 trim 后比较与返回", () => {
  assert.deepEqual(inputHistoryOf([user("  带空格  ")]), ["带空格"]);
});

// T12 游标越界（历史变短，比如切换后重新派生）：钳到有效范围，不返回 undefined 内容
test("T12 历史变短时游标钳制（不回绕、不给空串当命中）", () => {
  const short = inputHistoryOf([user("唯一一条")]);
  const state = { cursor: 2, input: "" };      // 模拟上一个会话留下的越界游标
  const step = historyNavigate({ cursor: state.cursor, scope: "s1", history: short, direction: "older", inputEmpty: true });
  assert.equal(step?.text, "唯一一条");
});
