// T70：标题在首条消息发出时就生效（任务 0010）——不等 Pi 把会话落盘（落盘要等助手回复）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installHome } from "../src/home.ts";
import { startOn } from "./server-harness.mjs";
import { titleFromFirstMessage } from "../src/session-title.ts";

test("T70a 标题规则：第一条用户消息压成一行、去首尾空白、过长截断（与会话列表展示口径一致）", async () => {
  assert.equal(titleFromFirstMessage("  你好\n世界  "), "你好 世界");
  assert.equal(titleFromFirstMessage(""), "");
  assert.equal(titleFromFirstMessage("字".repeat(200)).length, 60);
});

test("T70b 首条消息发出后、回合结束前，会话列表里已经有标题（模型不可用导致回合失败也一样）", async () => {
  const home = await mkdtemp(join(tmpdir(), "lifeos-title-"));
  await installHome(process.cwd(), home);
  const { server, base } = await startOn(home);
  try {
    const created = await (await fetch(`${base}/api/agents/lifeosagent/projects/workspace/sessions`, { method: "POST" })).json();
    const sid = created.sessionId;
    const before = await (await fetch(`${base}/api/agents/lifeosagent/projects/workspace/sessions`)).json();
    assert.equal(before.items.find((i) => i.sessionId === sid)?.title ?? "", "", "未发消息：没有标题");
    await fetch(`${base}/api/agents/lifeosagent/sessions/${sid}/messages`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: "帮我规划下周的设备巡检" }),
    });
    const after = await (await fetch(`${base}/api/agents/lifeosagent/projects/workspace/sessions`)).json();
    assert.equal(after.items.find((i) => i.sessionId === sid)?.title, "帮我规划下周的设备巡检", "发出即生效");
  } finally {
    server.close();
  }
});
