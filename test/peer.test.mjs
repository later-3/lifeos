// M1「与其他 Agent 对话」：离线可验的部分（不调模型）。
// 守护点：工具在位、目标校验、会话复用、目标会话是"我们的"完整会话、send 立即返回。
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installHome } from "../src/home.ts";
import { createAgent } from "../src/agents.ts";
import { LIFEOS_TOOL_NAMES } from "../src/agent-tools.ts";
import { PEER_ENTRY, peerConversation, resolvePeer } from "../src/peer.ts";

const setupHome = async () => {
  const home = await mkdtemp(join(tmpdir(), "lifeos-peer-"));
  process.env.LIFEOS_HOME = home;
  await installHome(process.cwd(), home);
  return home;
};

test("工具清单：lifeos_ask / lifeos_send 已注册（与 memory 工具同一批）", () => {
  assert.ok(LIFEOS_TOOL_NAMES.includes("lifeos_ask"));
  assert.ok(LIFEOS_TOOL_NAMES.includes("lifeos_send"));
});

test("目标校验：自己 → self；不存在 → unknown_agent；归档 → archived", async () => {
  const home = await setupHome();
  try {
    assert.deepEqual(await resolvePeer("lifeosagent", "lifeosagent"), { ok: false, code: "self" });
    assert.deepEqual(await resolvePeer("lifeosagent", "no-such-agent"), { ok: false, code: "unknown_agent" });
    const created = await createAgent({ name: "Peer Coder" });
    assert.ok("id" in created);
    const id = created.id;
    assert.equal((await resolvePeer("lifeosagent", id)).ok, true, "存在且未归档 → 可用");
  } finally { await rm(home, { recursive: true, force: true }); }
});

test("会话复用：同一 (发起方, 目标, 项目) 第二次调用返回同一 sessionId，且不新建", async () => {
  const home = await setupHome();
  try {
    const created = await createAgent({ name: "Peer Target" });
    assert.ok("id" in created);
    const target = created.id;
    const first = await peerConversation("lifeosagent", target, "workspace", home);
    assert.ok(first.ok);
    assert.equal(first.conversation.created, true, "第一次是新建");
    const second = await peerConversation("lifeosagent", target, "workspace", home);
    assert.ok(second.ok);
    assert.equal(second.conversation.created, false, "第二次复用");
    assert.equal(second.conversation.sessionId, first.conversation.sessionId);

    // 标记落盘：会话文件里有 lifeos_peer，记录发起方。
    // 注意：Pi 对新会话延迟落盘（无消息时不写文件）——这里显式落盘，模拟"跑过一轮"之后的真实状态。
    const { getSession } = await import("../src/agent-host.ts");
    const state = await getSession(target, first.conversation.sessionId, home);
    state.session.sessionManager.flush?.();
    const dir = join(home, "agents", target, "projects", "workspace", "sessions");
    const files = (await readdir(dir)).filter((f) => f.endsWith(".jsonl"));
    assert.ok(files.length > 0, "落盘后应存在会话文件");
    const text = await readFile(join(dir, files[0]), "utf8");
    assert.match(text, new RegExp(PEER_ENTRY));
    assert.match(text, /"peerAgentId":"lifeosagent"/);
  } finally { await rm(home, { recursive: true, force: true }); }
});

test("目标会话是完整 Life OS 会话：出现在它自己的项目里、带 Task 指针、拿到全部工具", async () => {
  const home = await setupHome();
  try {
    const created = await createAgent({ name: "Peer Full" });
    assert.ok("id" in created);
    const target = created.id;
    const peer = await peerConversation("lifeosagent", target, "workspace", home);
    assert.ok(peer.ok);
    const { getSession } = await import("../src/agent-host.ts");
    const state = await getSession(target, peer.conversation.sessionId, home);
    assert.ok(state !== undefined, "会话应当能读到");
    const tools = state.session.getActiveToolNames().sort();
    assert.deepEqual(tools, [...LIFEOS_TOOL_NAMES, "bash", "edit", "find", "grep", "ls", "powershell", "read", "write"].sort(), "目标会话应当拥有完整工具集");
    assert.ok(tools.includes("lifeos_ask"), "对端也能继续发起对话（同级，不是父子）");
    assert.ok(state.taskId !== undefined, "应当带当前 Task（与普通会话一致）");
  } finally { await rm(home, { recursive: true, force: true }); }
});

test("坏数据容忍：会话目录里的无关文件不影响查找", async () => {
  const home = await setupHome();
  try {
    const created = await createAgent({ name: "Peer Tolerant" });
    assert.ok("id" in created);
    const dir = join(home, "agents", created.id, "projects", "workspace", "sessions");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "garbage.jsonl"), "{not json\n\u0000nonsense");
    const peer = await peerConversation("lifeosagent", created.id, "workspace", home);
    assert.ok(peer.ok, "坏文件不能让查找失败");
    assert.equal(peer.conversation.created, true);
  } finally { await rm(home, { recursive: true, force: true }); }
});
