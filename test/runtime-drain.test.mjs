// T55：排空（任务 0006 A2 的竞态封口）——排空期间拒绝新回合，让正在跑的回合自然结束，再由 supervisor 重启。
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installHome } from "../src/home.ts";
import { startOn } from "./server-harness.mjs";

test("T55 POST /api/runtime/drain 之后，新消息被 503 拒绝（不会在重启瞬间开新回合）；running 计数可读", async () => {
  const home = await mkdtemp(join(tmpdir(), "lifeos-drain-"));
  await installHome(process.cwd(), home);
  const { server, base } = await startOn(home);
  try {
    const before = await fetch(`${base}/api/runtime`).then((r) => r.json());
    assert.ok(Array.isArray(before.running));
    const drained = await fetch(`${base}/api/runtime/drain`, { method: "POST" });
    assert.equal(drained.status, 200);
    const body = await drained.json();
    assert.equal(body.draining, true);
    const sent = await fetch(`${base}/api/agents/lifeosagent/sessions/any/messages`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: "hi" }),
    });
    assert.equal(sent.status, 503, "排空期间不受理新回合");
    assert.equal((await sent.json()).error.code, "backend_draining");
  } finally {
    server.close();
  }
});
