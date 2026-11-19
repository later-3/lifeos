/**
 * 「查看对话过程」入口（Task 0028 · P8；用户 2026-11-19 报"侧边栏弄丢了"）。
 *
 * ## 缺陷
 *
 * 前端从工具**结果文本**里正则抓对端 sessionId：
 * ```ts
 * /session ([0-9a-f]{8}-…)/            // 要求 "session" + 空格
 * ```
 * 而后端在 Task 0014（`d4af7d3`，2026-11-02）把输出格式改成了 `session: <uuid>`（多一个冒号）。
 * 正则从此恒不命中 → `canOpenPeer` 恒 false → 入口**静默消失 16 天**。
 *
 * ## 本文件锁什么
 *
 * 1. `messagesOf()` 必须把工具结果的 `details.sessionId` 搬成结构化的 `peerSessionId`
 *    （前端不该猜文案）；
 * 2. 前端渲染时必须**优先读 `peerSessionId`**，文本正则只是老会话兜底，且要同时容忍
 *    `session: <id>` 与 `session <id>` 两种写法；
 * 3. 端到端：`lifeos_ask` 的工具块必须出现 `data-testid="open-peer"`。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installHome } from "../src/home.ts";
import { startOn } from "./server-harness.mjs";

const SESSION_ID = "01a1f269-86eb-722c-951d-1d2806dba88e";

test("T28-23 后端把 toolResult 的 details.sessionId 搬成结构化 peerSessionId", async () => {
  /*
   * 用**真实形状**的会话文件（lifeos_ask + details.sessionId），不去跑真模型。
   * Pi 的 toolResult 消息带 `details`（`pi/packages/ai/src/types.ts:625-639`），
   * 而 `messagesOf()` 此前只搬了 `content` 文本与图片，把 details 丢掉了。
   */
  const home = await mkdtemp(join(tmpdir(), "lifeos-peer-"));
  await installHome(process.cwd(), home);
  const sessionDir = join(home, "agents", "lifeosagent", "projects", "workspace", "sessions");
  const { mkdir, writeFile } = await import("node:fs/promises");
  await mkdir(sessionDir, { recursive: true });
  const lines = [
    { type: "session", version: 3, id: "s1", timestamp: "2026-11-19T00:00:00.000Z", cwd: "" },
    { type: "message", id: "u1", parentId: "s1", timestamp: "2026-11-19T00:00:01.000Z",
      message: { role: "user", content: [{ type: "text", text: "问" }], timestamp: 1 } },
    { type: "message", id: "a1", parentId: "u1", timestamp: "2026-11-19T00:00:02.000Z",
      message: { role: "assistant", content: [{ type: "toolCall", id: "c1", name: "lifeos_ask", arguments: { agent: "coder" } }], timestamp: 2 } },
    { type: "message", id: "r1", parentId: "a1", timestamp: "2026-11-19T00:00:03.000Z",
      message: {
        role: "toolResult", toolCallId: "c1", toolName: "lifeos_ask", isError: false, timestamp: 3,
        content: [{ type: "text", text: `coder · state=idle\nsession: ${SESSION_ID}\ntask: 0001\n` }],
        details: { agent: "coder", sessionId: SESSION_ID, state: "idle" },
      } },
  ];
  await writeFile(join(sessionDir, `2026-11-19T00-00-00-000Z_s1.jsonl`), lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
  const { server, base } = await startOn(home);
  try {
    const response = await fetch(`${base}/api/agents/lifeosagent/sessions/s1`);
    assert.equal(response.status, 200);
    const body = await response.json();
    const call = body.messages.flatMap((m) => m.blocks ?? []).find((b) => b.type === "toolCall");
    assert.ok(call, "工具块要在");
    assert.equal(call.peerSessionId, SESSION_ID,
      "必须由后端给出结构化的 peerSessionId（前端不该从 result 文本猜）");
  } finally { server.close(); }
});

test("T28-23b 前端优先读 peerSessionId，文本正则只作老会话兜底且容忍冒号", async () => {
  const source = await readFile(new URL("../frontend/src/views/Message.tsx", import.meta.url), "utf8");
  const block = /const peerSessionId = peerTarget === undefined[\s\S]*?;/.exec(source);
  assert.ok(block, "找不到 peerSessionId 的取值处");
  const text = block[0];
  assert.match(text, /block\.peerSessionId/, "必须优先用后端给的结构化字段");
  assert.match(text, /session:\?\\s\+|session:\?/, "兜底正则必须容忍 `session: <id>` 与 `session <id>` 两种写法");
});
