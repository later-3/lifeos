// 打桩验证 2：目标 Agent 自动拥有同名项目 + 对话会话拒绝直接发言。
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installHome } from "../src/home.ts";
import { createAgent } from "../src/agents.ts";
import { bindProject, listAgentProjects } from "../src/projects.ts";
import { ensurePeerProject, peerConversation, peerMarkerOf } from "../src/peer.ts";

const setup = async () => {
  const home = await mkdtemp(join(tmpdir(), "lifeos-peer-proj-"));
  process.env.LIFEOS_HOME = home;
  await installHome(process.cwd(), home);
  const dir = await mkdtemp(join(tmpdir(), "lifeos-ext-project-"));
  return { home, dir };
};

test("目标 Agent 没有该项目时：会被绑定同一个项目目录（不是建孤儿目录）", async () => {
  const { home, dir } = await setup();
  try {
    const target = await createAgent({ name: "Peer Projected" });
    assert.ok("id" in target);
    // 发起方先绑一个外部项目
    const bound = await bindProject("lifeosagent", dir);
    assert.ok(!("code" in bound), "发起方绑定外部项目应成功");
    const projectId = bound.project.id;

    const before = await listAgentProjects(target.id);
    assert.ok(!before.some((item) => item.id === projectId), "目标 Agent 起初没有这个项目");

    const ensured = await ensurePeerProject("lifeosagent", target.id, projectId);
    assert.ok(ensured.ok);
    assert.equal(ensured.bound, true, "应当新建绑定");

    const after = await listAgentProjects(target.id);
    const shared = after.find((item) => item.id === projectId);
    assert.ok(shared !== undefined, "目标 Agent 现在有同名项目");
    assert.equal(shared.path, dir, "绑定的是同一个目录（不是新建目录）");
  } finally { await rm(home, { recursive: true, force: true }); await rm(dir, { recursive: true, force: true }); }
});

test("目标 Agent 已有该项目时：不重复绑定（幂等）", async () => {
  const { home, dir } = await setup();
  try {
    const target = await createAgent({ name: "Peer Idem" });
    assert.ok("id" in target);
    const bound = await bindProject("lifeosagent", dir);
    assert.ok(!("code" in bound));
    const projectId = bound.project.id;
    const first = await ensurePeerProject("lifeosagent", target.id, projectId);
    assert.ok(first.ok && first.bound);
    const second = await ensurePeerProject("lifeosagent", target.id, projectId);
    assert.ok(second.ok);
    assert.equal(second.bound, false, "第二次不再绑定");
  } finally { await rm(home, { recursive: true, force: true }); await rm(dir, { recursive: true, force: true }); }
});

test("对话会话带 peer 标记（发言拦截的依据）", async () => {
  const { home } = await setup();
  try {
    const target = await createAgent({ name: "Peer Marked" });
    assert.ok("id" in target);
    const peer = await peerConversation("lifeosagent", target.id, "workspace", home);
    assert.ok(peer.ok);
    const { getSession } = await import("../src/agent-host.ts");
    const state = await getSession(target.id, peer.conversation.sessionId, home);
    assert.equal(peerMarkerOf(state.session.sessionManager), "lifeosagent", "标记里是发起方 agentId");
  } finally { await rm(home, { recursive: true, force: true }); }
});

test("普通会话没有 peer 标记（不会被误拦）", async () => {
  const { home } = await setup();
  try {
    const { createSession, getSession } = await import("../src/agent-host.ts");
    const sid = await createSession("lifeosagent", home, "workspace");
    const state = await getSession("lifeosagent", sid, home);
    assert.equal(peerMarkerOf(state.session.sessionManager), undefined);
  } finally { await rm(home, { recursive: true, force: true }); }
});
