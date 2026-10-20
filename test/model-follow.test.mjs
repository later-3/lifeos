import test from "node:test";
import assert from "node:assert/strict";
import { decideRestoreModel } from "../src/model-follow.ts";

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
