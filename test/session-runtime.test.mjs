// T42：跨 Agent 运行注册表（任务 0007 P2）——一次取到所有 Agent 正在跑的会话。
import { test } from "node:test";
import assert from "node:assert/strict";
import { markRunning, clearRunning, runningAll, isRunning } from "../src/session-runtime.ts";

test("T42 runningAll 跨 Agent 返回所有在跑会话，清除后不再出现", async () => {
  markRunning("alpha", { sessionId: "a1", startedAt: "2026-10-25T01:00:00Z" });
  markRunning("beta", { sessionId: "b1", startedAt: "2026-10-25T01:00:01Z" });
  const all = runningAll().filter((r) => r.sessionId === "a1" || r.sessionId === "b1");
  assert.deepEqual(all.map((r) => `${r.agentId}/${r.sessionId}`).sort(), ["alpha/a1", "beta/b1"]);
  clearRunning("alpha", "a1");
  assert.equal(isRunning("alpha", "a1"), false);
  assert.equal(runningAll().some((r) => r.sessionId === "a1"), false);
  clearRunning("beta", "b1");
});
