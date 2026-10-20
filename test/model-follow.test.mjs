import test from "node:test";
import assert from "node:assert/strict";
import { decideRestoreModel } from "../src/model-follow.ts";

const m = (provider, id) => ({ provider, id });

test("显式覆盖过：一律保留（默认怎么变都不动）", () => {
  assert.equal(decideRestoreModel({ stored: m("p", "c"), recordedDefault: m("p", "a"), agentDefault: m("p", "b"), overridden: true }), "keep");
});

test("存的就是默认：不需要动", () => {
  assert.equal(decideRestoreModel({ stored: m("p", "b"), recordedDefault: m("p", "a"), agentDefault: m("p", "b"), overridden: false }), "keep");
});

test("曾跟随默认、默认变了：跟随（重开会话也要跟）", () => {
  assert.equal(decideRestoreModel({ stored: m("p", "a"), recordedDefault: m("p", "a"), agentDefault: m("p", "b"), overridden: false }), "follow");
});

test("旧会话（没有默认记录）且模型与当前默认不同：视为覆盖，补标记保护", () => {
  assert.equal(decideRestoreModel({ stored: m("p", "c"), agentDefault: m("p", "b"), overridden: false }), "mark_override");
});

test("有记录但对不上（用户可能在别的客户端换过）：视为覆盖", () => {
  assert.equal(decideRestoreModel({ stored: m("p", "c"), recordedDefault: m("p", "a"), agentDefault: m("p", "b"), overridden: false }), "mark_override");
});

test("没有默认模型可用：保持原样", () => {
  assert.equal(decideRestoreModel({ stored: m("p", "c"), overridden: false }), "keep");
});
