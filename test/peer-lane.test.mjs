// Task 0015：lane（会话通道）与默认接管、显式新开、查历史、状态快照。
// 守护点（02-design §L1/§L2）：同一 Task 内复用；不同 Task 各自一条；新开真的新开；
// 指定 sessionId 不存在/不属于该 lane 必须报错而不是静默新建。
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installHome } from "../src/home.ts";
import { createAgent } from "../src/agents.ts";
import { getSession } from "../src/agent-host.ts";
import { listPeerSessions, peerSnapshot, peerConversation, resolvePeer } from "../src/peer.ts";

const setup = async () => {
  const home = await mkdtemp(join(tmpdir(), "lifeos-lane-"));
  process.env.LIFEOS_HOME = home;
  await installHome(process.cwd(), home);
  const created = await createAgent({ name: "Lane Target" });
  assert.ok("id" in created);
  // 让会话落盘（Pi 对没有对话的会话延迟落盘；落盘后 listPeerSessions 才能扫到）
  const flush = async (sessionId) => {
    const state = await getSession(created.id, sessionId, home);
    state.session.sessionManager.flush?.();
  };
  return { home, target: created.id, flush };
};

test("lane：同一 Task 内复用同一条会话", async () => {
  const { home, target, flush } = await setup();
  try {
    const a = await peerConversation("lifeosagent", target, "workspace", home, { taskId: "0001" });
    assert.ok(a.ok);
    assert.equal(a.conversation.created, true);
    assert.equal(a.conversation.initiatorTaskId, "0001");
    await flush(a.conversation.sessionId);

    const b = await peerConversation("lifeosagent", target, "workspace", home, { taskId: "0001" });
    assert.ok(b.ok);
    assert.equal(b.conversation.created, false, "同 Task 第二次复用");
    assert.equal(b.conversation.sessionId, a.conversation.sessionId);
  } finally { await rm(home, { recursive: true, force: true }); }
});

test("lane：不同 Task 是不同的会话（用户的核心诉求）", async () => {
  const { home, target, flush } = await setup();
  try {
    const t1 = await peerConversation("lifeosagent", target, "workspace", home, { taskId: "0001" });
    assert.ok(t1.ok);
    await flush(t1.conversation.sessionId);

    const t2 = await peerConversation("lifeosagent", target, "workspace", home, { taskId: "0002" });
    assert.ok(t2.ok);
    assert.equal(t2.conversation.created, true, "另一个 Task → 新的一条");
    assert.notEqual(t2.conversation.sessionId, t1.conversation.sessionId);
    assert.equal(t2.conversation.initiatorTaskId, "0002");
    await flush(t2.conversation.sessionId);

    // 回到 task-1 → 接回原来那条（S5）
    const back = await peerConversation("lifeosagent", target, "workspace", home, { taskId: "0001" });
    assert.ok(back.ok);
    assert.equal(back.conversation.sessionId, t1.conversation.sessionId, "回到 task-1 接回 task-1 那条");
  } finally { await rm(home, { recursive: true, force: true }); }
});

test("lane：显式 newSession 真的新开一条，且仍在同一 lane", async () => {
  const { home, target, flush } = await setup();
  try {
    const first = await peerConversation("lifeosagent", target, "workspace", home, { taskId: "0001" });
    assert.ok(first.ok);
    await flush(first.conversation.sessionId);

    const second = await peerConversation("lifeosagent", target, "workspace", home, { taskId: "0001", newSession: true });
    assert.ok(second.ok);
    assert.equal(second.conversation.created, true, "显式新开就是新建");
    assert.notEqual(second.conversation.sessionId, first.conversation.sessionId);
    await flush(second.conversation.sessionId);

    const lane = await listPeerSessions("lifeosagent", target, "workspace");
    assert.equal(lane.length, 2, "同一 lane 现在有两条实例");
    assert.ok(lane.every((entry) => entry.marker.initiatorTaskId === "0001"));
  } finally { await rm(home, { recursive: true, force: true }); }
});

test("lane：指定不存在的 sessionId → 报错并列出可用的（不静默新建）", async () => {
  const { home, target, flush } = await setup();
  try {
    const first = await peerConversation("lifeosagent", target, "workspace", home, { taskId: "0001" });
    assert.ok(first.ok);
    await flush(first.conversation.sessionId);

    const bogus = await peerConversation("lifeosagent", target, "workspace", home, {
      taskId: "0001", sessionId: "01999999-0000-7000-8000-000000000000",
    });
    assert.equal(bogus.ok, false);
    assert.equal(bogus.code, "session_not_found");
    assert.deepEqual(bogus.available, [first.conversation.sessionId], "要列出这条 lane 现有的会话");

    const again = await listPeerSessions("lifeosagent", target, "workspace");
    assert.equal(again.length, 1, "报错不能留下新会话");
  } finally { await rm(home, { recursive: true, force: true }); }
});

test("lane：指定的 sessionId 属于别的 Task → 报 session_not_in_lane", async () => {
  const { home, target, flush } = await setup();
  try {
    const t1 = await peerConversation("lifeosagent", target, "workspace", home, { taskId: "0001" });
    assert.ok(t1.ok);
    await flush(t1.conversation.sessionId);

    const wrongLane = await peerConversation("lifeosagent", target, "workspace", home, {
      taskId: "0002", sessionId: t1.conversation.sessionId,
    });
    assert.equal(wrongLane.ok, false);
    assert.equal(wrongLane.code, "session_not_in_lane");
    assert.deepEqual(wrongLane.available, [], "task-2 这条 lane 还没有会话");
  } finally { await rm(home, { recursive: true, force: true }); }
});

test("老会话（没有 initiatorTaskId）仍然可复用，不被 lane 过滤掉", async () => {
  const { home, target, flush } = await setup();
  try {
    // 模拟 M1 时代建的会话：不传 taskId
    const legacy = await peerConversation("lifeosagent", target, "workspace", home);
    assert.ok(legacy.ok);
    await flush(legacy.conversation.sessionId);
    const lane = await listPeerSessions("lifeosagent", target, "workspace");
    assert.equal(lane[0]?.marker.initiatorTaskId, undefined, "老会话没有 task 字段");

    // 现在带 taskId 调用：老会话视为匹配，仍然复用它（增量迁移，不打断）
    const withTask = await peerConversation("lifeosagent", target, "workspace", home, { taskId: "0009" });
    assert.ok(withTask.ok);
    assert.equal(withTask.conversation.sessionId, legacy.conversation.sessionId);
  } finally { await rm(home, { recursive: true, force: true }); }
});

test("状态快照：未跑过 → idle 且给得出 next；会话不存在 → missing", async () => {
  const { home, target } = await setup();
  try {
    const peer = await peerConversation("lifeosagent", target, "workspace", home, { taskId: "0001" });
    assert.ok(peer.ok);
    const snap = await peerSnapshot(target, peer.conversation.sessionId, "0001");
    assert.equal(snap.state, "idle");
    assert.equal(snap.messages, 0);
    assert.ok(snap.next.length > 0, "next 必填（否则模型会自己编循环）");
    assert.equal(snap.canWaitMore, true);

    const missing = await peerSnapshot(target, "01999999-0000-7000-8000-000000000000", "0001");
    assert.equal(missing.state, "missing");
    assert.equal(missing.canWaitMore, false);
  } finally { await rm(home, { recursive: true, force: true }); }
});

test("目标校验在 lane 之前生效（自己 / 不存在）", async () => {
  const { home } = await setup();
  try {
    assert.deepEqual(await resolvePeer("lifeosagent", "lifeosagent"), { ok: false, code: "self" });
    const bogus = await peerConversation("lifeosagent", "no-such-agent", "workspace", home, { taskId: "0001" });
    assert.equal(bogus.ok, false);
    assert.equal(bogus.code, "unknown_agent");
  } finally { await rm(home, { recursive: true, force: true }); }
});
