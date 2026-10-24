// T14/T15：会话文件引用完整性（断裂分支必须被检测出来，不能静默变成 0 条消息）
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { start } from "./server-harness.mjs";

test("T14：含悬空 parentId 的会话 → 详情接口返回 integrity.orphanParents，不静默", async () => {
  const { home, base, server } = await start();
  try {
    const dir = join(home, "agents", "lifeosagent", "projects", "workspace", "sessions");
    await mkdir(dir, { recursive: true });
    const sid = "f-orphan-session";
    const file = join(dir, `2026-10-24T00-00-00-000Z_${sid}.jsonl`);
    await writeFile(file, [
      JSON.stringify({ type: "session", version: 3, id: sid, timestamp: "2026-10-24T00:00:00.000Z", cwd: home }),
      JSON.stringify({ type: "message", id: "aaaa1111", parentId: sid, timestamp: "2026-10-24T00:00:01.000Z", message: { role: "user", content: [{ type: "text", text: "hi" }] } }),
      JSON.stringify({ type: "model_change", id: "bbbb2222", parentId: "missing999", timestamp: "2026-10-24T00:00:02.000Z", provider: "x", modelId: "y" }),
    ].join("\n") + "\n");
    const res = await fetch(`${base}/api/agents/lifeosagent/sessions/${sid}`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.integrity?.orphanParents, 1, "必须报告 1 个悬空 parent");
  } finally { server.close(); }
});

test("T15：引用完整的会话 → 能读到消息，且 integrity.orphanParents=0", async () => {
  const { home, base, server } = await start();
  try {
    const dir = join(home, "agents", "lifeosagent", "projects", "workspace", "sessions");
    await mkdir(dir, { recursive: true });
    const sid = "f-good-session";
    await writeFile(join(dir, `2026-10-24T00-00-00-000Z_${sid}.jsonl`), [
      JSON.stringify({ type: "session", version: 3, id: sid, timestamp: "2026-10-24T00:00:00.000Z", cwd: home }),
      JSON.stringify({ type: "message", id: "aaaa1111", parentId: sid, timestamp: "2026-10-24T00:00:01.000Z", message: { role: "user", content: [{ type: "text", text: "hi" }] } }),
      JSON.stringify({ type: "message", id: "bbbb2222", parentId: "aaaa1111", timestamp: "2026-10-24T00:00:02.000Z", message: { role: "assistant", content: [{ type: "text", text: "hello" }], stopReason: "stop" } }),
    ].join("\n") + "\n");
    const res = await fetch(`${base}/api/agents/lifeosagent/sessions/${sid}`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(body.messages.length >= 2, "应读到 user + assistant");
    assert.equal(body.integrity?.orphanParents ?? 0, 0);
  } finally { server.close(); }
});
