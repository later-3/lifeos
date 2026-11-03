import test from "node:test";
import assert from "node:assert/strict";
import { decideRestoreModel, decideRestoreThinking } from "../src/model-follow.ts";

const m = (provider, id) => ({ provider, id });

test("显式 /model 覆盖过：一律保留（默认怎么变都不动）", () => {
  assert.equal(decideRestoreModel({ stored: m("p", "c"), agentDefault: m("p", "b"), overridden: true }), "keep");
});

test("存的就是默认：不需要动", () => {
  assert.equal(decideRestoreModel({ stored: m("p", "b"), agentDefault: m("p", "b"), overridden: false }), "keep");
});

test("没覆盖过、模型不是默认了：跟随（用户规则：没用 /model 就跟默认）", () => {
  assert.equal(decideRestoreModel({ stored: m("p", "a"), agentDefault: m("p", "b"), overridden: false }), "follow");
});

test("旧会话（早期逻辑打过 legacy 标记 → 视为未覆盖）：模型与默认不同就跟随", () => {
  // legacy 标记在 hasOverrideIn 里被忽略，所以这里等价于 overridden=false
  assert.equal(decideRestoreModel({ stored: m("command", "z-ai/glm-5.3-flash"), agentDefault: m("home-flashnext", "qwen"), overridden: false }), "follow");
});

test("没有默认模型/没有存过：保持原样", () => {
  assert.equal(decideRestoreModel({ stored: undefined, agentDefault: m("p", "b"), overridden: false }), "keep");
  assert.equal(decideRestoreModel({ stored: m("p", "c"), agentDefault: undefined, overridden: false }), "keep");
});

test("思考级别：没 /thinking 覆盖过 → 跟随 Agent 默认（lifeosagent max 的会话不再停在 medium）", () => {
  assert.equal(decideRestoreThinking({ stored: "medium", agentDefault: "max", overridden: false }), "follow");
});

test("思考级别：显式 /thinking 覆盖过 → 保留；相同 → 不动", () => {
  assert.equal(decideRestoreThinking({ stored: "low", agentDefault: "max", overridden: true }), "keep");
  assert.equal(decideRestoreThinking({ stored: "max", agentDefault: "max", overridden: false }), "keep");
  assert.equal(decideRestoreThinking({ stored: undefined, agentDefault: "max", overridden: false }), "keep");
});

// Task 0017 · 回归：静默换模型的根因不在 decideRestoreModel 本身，而在于
// "判了 keep 就什么都不做" 会漏掉「Pi 已经把 session.model 换成别的模型」这件事。
// 这两条测试锁定 keep 的两种合法含义，防止以后有人把"实际模型校验"塞进纯判定里，
// 或误以为 keep == "实际模型一定对"。
test("Task 0017：stored == agentDefault → keep（值相同不必跟随）", () => {
  assert.equal(decideRestoreModel({
    stored: m("amr-link", "deepseek-v4.1-flash"),
    agentDefault: m("amr-link", "deepseek-v4.1-flash"),
    overridden: false,
  }), "keep");
});

test("Task 0017：keep 不等于『实际模型正确』—— 调用方必须另外校验 session.model", () => {
  // 本次事故的形状：文件与默认都是 amr-link（判 keep），但 amr-link 缺凭据，
  // Pi 的 findInitialModel 把实际模型换成了 deepseek-v4-pro（sdk.ts:224-249）。
  // decideRestoreModel 看不到 session.model，所以它必须返回 keep —— 校验是调用方的责任。
  const stored = m("amr-link", "deepseek-v4.1-flash");
  const actual = m("deepseek", "deepseek-v4-pro");
  assert.equal(decideRestoreModel({ stored, agentDefault: stored, overridden: false }), "keep");
  assert.notDeepEqual(actual, stored, "实际模型已经不等于期望模型，只有调用方能发现");
});
