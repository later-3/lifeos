// T54：开发 supervisor 的重启决策（任务 0006 A2）——有改动但有回合在跑时必须等待，回合结束后再重启。
import { test } from "node:test";
import assert from "node:assert/strict";
import { decideRestart } from "../scripts/dev-supervisor-core.mjs";

test("T54 无改动 → none；有改动且空闲 → restart；有改动但有回合在跑 → wait（不得重启）", async () => {
  assert.equal(decideRestart({ changed: false, running: 0 }), "none");
  assert.equal(decideRestart({ changed: true, running: 0 }), "restart");
  assert.equal(decideRestart({ changed: true, running: 2 }), "wait");
  assert.equal(decideRestart({ changed: false, running: 3 }), "none");
});
