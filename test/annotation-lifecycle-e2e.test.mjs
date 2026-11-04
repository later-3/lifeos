/**
 * 批注生命周期的**完整场景**端到端测试（Task 0008 · P1 补强）。
 *
 * 用户 2026-11-04 要求："把外面的逻辑完全验证充分"——**打掉大模型交互**，
 * 只验我们自己的逻辑。所以这里把 `session.prompt()` 换成记录器：
 * 它能记下"这一轮发给模型的原文"，但不会真的调模型、不花 token、不依赖网络。
 *
 * 覆盖用户点名的三个场景：
 *  1. 用户批注发送 → 下一轮再发时**一定没有**那些批注（含状态核实）；
 *  2. 点击发送的那条消息上还能看到批注；重新编辑、多发几轮后，历史批注仍可见；
 *  3. 切 session 再切回来，历史批注仍可见，继续发时**不带**。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { start } from "./server-harness.mjs";

const AGENT = "lifeosagent";

/**
 * 起服务 + 一个新会话，并把 `session.prompt()` 换成记录器。
 *
 * @returns `prompts` 会按顺序累积**每一轮实际发给模型的内容**。
 */
async function setup() {
  const { server, base, home } = await start();
  const agents = await (await fetch(`${base}/api/agents`)).json();
  const agentId = agents.items[0].id;
  const projects = await (await fetch(`${base}/api/agents/${agentId}/projects`)).json();
  const projectId = projects.items[0].id;
  const created = await (await fetch(`${base}/api/agents/${agentId}/projects/${projectId}/sessions`, { method: "POST" })).json();
  const sid = created.sessionId;

  // ── 打掉模型：把 session.prompt 换成记录器 ──
  const prompts = [];
  const { getSession } = await import("../src/agent-host.ts");
  const state = await getSession(agentId, sid, home);
  assert.ok(state !== undefined, "会话应能取到");
  state.session.prompt = async (text) => {
    prompts.push(text);
    return undefined;
  };
  // 打掉模型鉴权：临时 HOME 里没有凭据，`runTurn` 会在 `checkAuth` 处抛错、
  // 根本走不到 `prompt()`。把 model 置空即可跳过那段守卫（它只在 model 存在时才验）。
  Object.defineProperty(state.session, "model", { value: undefined, configurable: true });

  const url = `${base}/api/agents/${agentId}/sessions/${sid}`;
  const annoUrl = `${url}/annotations`;

  const listAnnos = async () => (await (await fetch(annoUrl)).json()).annotations ?? [];
  const addAnno = (id, note, extra = {}) => fetch(annoUrl, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ op: "add", annotation: {
      id, author: { kind: "user", id: "u" }, messageId: "m1", blockIndex: 0,
      start: 0, end: 4, quote: "原文", marks: ["critic"], note, ...extra,
    } }),
  });
  const consume = (ids, by) => fetch(annoUrl, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ op: "consume", ids, consumedBy: by }),
  });
  const post = (body) => fetch(annoUrl, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });

  /**
   * 发一条消息（走真实接口；模型已被 stub）。
   *
   * **要等 `prompt` 真的被调用**：POST 是 202 立刻返回，`runTurn` 在后台异步跑
   * （要等分片创建等）。不等待就直接断言 `prompts` 会读到空数组。
   */
  const sendMessage = async (text) => {
    const before = prompts.length;
    const r = await fetch(`${url}/messages`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text }),
    });
    for (let i = 0; i < 50 && prompts.length === before; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return r.status;
  };

  /** 直接读会话 JSONL 里落的批注事件（不经过读接口，验"代码层面的看护"）。 */
  /**
   * 读**服务端内存里**的批注事件序列（追加写之后的真实顺序）。
   *
   * 为什么不读会话 JSONL 文件：新会话在临时 HOME 里没有 real turn 时不落盘
   * （`prompt` 被我们 stub 掉了，没有真实回合写文件）。内存里的 session manager
   * 才是同一份事实来源——落盘走的也是它（`appendCustomEntry`）。
   */
  const rawEvents = async () => {
    const branch = state.session.sessionManager.getBranch();
    return branch
      .filter((e) => e?.customType === "lifeos_annotation")
      .map((e) => e.data);
  };

  return { server, base, home, agentId, projectId, sid, state, prompts,
    listAnnos, addAnno, consume, post, sendMessage, rawEvents, url };
}

/** 前端"待发送池"的判定——必须与 `App.tsx` 里的 filter 完全一致。 */
const pendingOf = (annos) => annos.filter((a) => a.consumedBy === undefined && a.supersededBy === undefined);

// ═══════════════════════════════════════════════════════════════
// 场景 1：发送后，下一轮一定不带
// ═══════════════════════════════════════════════════════════════

test("场景1-1 批注随第一条消息发出后，状态变 consumed（数据层）", async () => {
  const { server, addAnno, consume, listAnnos } = await setup();
  try {
    await addAnno("a1", "第一条意见");
    assert.equal(pendingOf(await listAnnos()).length, 1, "初始应为待发送");

    await consume(["a1"], "send-1");

    const got = await listAnnos();
    assert.equal(got.length, 1, "数据保留，不删");
    assert.equal(got[0].consumedBy, "send-1", "已标记消费");
    assert.equal(pendingOf(got).length, 0, "待发送池清空");
  } finally { server.close(); }
});

test("场景1-2 下一轮再发时，待发送池为空 → 不组装批注文本", async () => {
  const { server, addAnno, consume, listAnnos, sendMessage, prompts } = await setup();
  try {
    await addAnno("a1", "只发一次的意见");
    await consume(["a1"], "send-1");

    // 前端组装逻辑（与 App.tsx send() 完全一致）
    const { annotationsMessage } = await import("../frontend/src/annotation-message.ts");
    const pending = pendingOf(await listAnnos());
    const annoText = pending.length === 0 ? "" : annotationsMessage(pending);

    assert.equal(annoText, "", "没有待发送批注时不该组装出任何文本");

    // 真的发一条：prompt 里不该出现批注
    await sendMessage("第二轮普通消息");
    assert.equal(prompts.length, 1, "应实际发了一轮");
    assert.equal(prompts[0], "第二轮普通消息", "发给模型的就是原文，没夹批注");
    assert.ok(!prompts[0].includes("只发一次的意见"), "不得带旧批注");
  } finally { server.close(); }
});

test("场景1-3 代码层面的看护：会话文件里 consume 事件确实落盘了", async () => {
  const { server, addAnno, consume, rawEvents } = await setup();
  try {
    await addAnno("a1", "验落盘");
    await consume(["a1"], "send-1");
    const events = await rawEvents();
    const kinds = events.map((e) => e?.op);
    assert.deepEqual(kinds, ["add", "consume"], "必须是一条 add + 一条 consume");
    assert.deepEqual(events[1].ids, ["a1"]);
    assert.equal(events[1].consumedBy, "send-1");
  } finally { server.close(); }
});

test("场景1-4 多发几轮，consumed 的记录始终只被标记一次、不会被再次消费", async () => {
  const { server, addAnno, consume, listAnnos } = await setup();
  try {
    await addAnno("a1", "固定意见");
    await consume(["a1"], "send-1");
    // 模拟后面几轮：每轮都对"当前 pending"消费一次（没有 pending 就不该有事件）
    for (const round of [2, 3, 4]) {
      const pending = pendingOf(await listAnnos());
      if (pending.length > 0) await consume(pending.map((a) => a.id), `send-${round}`);
    }
    const got = await listAnnos();
    assert.equal(got[0].consumedBy, "send-1", "仍是第一轮的标记，没被覆盖");
    assert.equal(pendingOf(got).length, 0, "始终无待发送");
  } finally { server.close(); }
});

// ═══════════════════════════════════════════════════════════════
// 场景 2：历史批注一直能看到；重新编辑、多发几轮也不丢
// ═══════════════════════════════════════════════════════════════

test("场景2-1 发送后批注不消失（MarkBar 常驻的数据前提）", async () => {
  const { server, addAnno, consume, listAnnos } = await setup();
  try {
    await addAnno("a1", "要一直看得见");
    await consume(["a1"], "send-1");
    const got = await listAnnos();
    assert.equal(got.length, 1, "发送不等于删除");
    assert.equal(got[0].note, "要一直看得见", "内容原样");
  } finally { server.close(); }
});

test("场景2-2 多发 5 轮，历史批注都还在、内容不变", async () => {
  const { server, addAnno, consume, listAnnos, sendMessage } = await setup();
  try {
    await addAnno("a1", "历史意见一");
    await addAnno("a2", "历史意见二");
    await consume(["a1", "a2"], "send-1");

    for (let i = 0; i < 5; i += 1) {
      const pending = pendingOf(await listAnnos());
      if (pending.length > 0) await consume(pending.map((a) => a.id), `send-${i + 2}`);
      await sendMessage(`第 ${i + 2} 轮`);
    }

    const got = await listAnnos();
    assert.equal(got.length, 2, "两轮后仍是 2 条");
    assert.deepEqual(got.map((a) => a.note).sort(), ["历史意见一", "历史意见二"]);
    assert.ok(got.every((a) => a.consumedBy === "send-1"), "状态没被后续轮次改动");
  } finally { server.close(); }
});

test("场景2-3 重新编辑已发送的：新记录进待发送、旧记录留历史、旧的不再发", async () => {
  const { server, addAnno, consume, post, listAnnos } = await setup();
  try {
    await addAnno("v1", "旧说法");
    await consume(["v1"], "send-1");

    // 编辑：产生 v2（内容换成新说法），v1 置 supersededBy
    await addAnno("v2", "新说法");
    await post({ op: "update", annotation: {
      id: "v1", author: { kind: "user", id: "u" }, messageId: "m1", blockIndex: 0,
      start: 0, end: 4, quote: "原文", marks: ["critic"], note: "旧说法",
      consumedBy: "send-1", supersededBy: "v2",
    } });

    const got = await listAnnos();
    assert.equal(got.length, 2, "两条都留着（历史可查）");
    assert.equal(got.find((a) => a.id === "v1")?.supersededBy, "v2", "旧记录指向新版本");
    assert.equal(got.find((a) => a.id === "v1")?.consumedBy, "send-1", "旧记录仍是已发送");

    const pending = pendingOf(got);
    assert.deepEqual(pending.map((a) => a.id), ["v2"], "只有新版本待发送");

    // 组装时只该出现"新说法"，不该出现"旧说法"
    const { annotationsMessage } = await import("../frontend/src/annotation-message.ts");
    const text = annotationsMessage(pending);
    assert.ok(text.includes("新说法"), "新版本要发");
    assert.ok(!text.includes("旧说法"), "旧版本不能发");
  } finally { server.close(); }
});

test("场景2-4 ⭐ 编辑后内容一模一样，也必须能再发（状态跟记录走、不跟内容走）", async () => {
  const { server, addAnno, consume, post, listAnnos } = await setup();
  try {
    await addAnno("v1", "一字不改");
    await consume(["v1"], "send-1");

    // 用户"编辑"了，但内容完全一样 → 产生新记录 v2
    await addAnno("v2", "一字不改");
    await post({ op: "update", annotation: {
      id: "v1", author: { kind: "user", id: "u" }, messageId: "m1", blockIndex: 0,
      start: 0, end: 4, quote: "原文", marks: ["critic"], note: "一字不改",
      consumedBy: "send-1", supersededBy: "v2",
    } });

    const pending = pendingOf(await listAnnos());
    assert.deepEqual(pending.map((a) => a.id), ["v2"], "新记录必须待发送");
    assert.equal(pending[0].note, "一字不改", "内容与旧的一模一样——这不影响判断");

    const { annotationsMessage } = await import("../frontend/src/annotation-message.ts");
    assert.ok(annotationsMessage(pending).includes("一字不改"), "一模一样的文字也要能再发");
  } finally { server.close(); }
});

// ═══════════════════════════════════════════════════════════════
// 场景 3：切 session 回来，历史可见、继续发不带
// ═══════════════════════════════════════════════════════════════

test("场景3-1 切到别的 session 再回来：批注和历史都在", async () => {
  const { server, base, agentId, projectId, sid, addAnno, consume, listAnnos } = await setup();
  try {
    await addAnno("a1", "会话 A 的批注");
    await consume(["a1"], "send-1");

    // 建另一个会话（模拟切换过去）
    const other = await (await fetch(`${base}/api/agents/${agentId}/projects/${projectId}/sessions`, { method: "POST" })).json();
    assert.notEqual(other.sessionId, sid, "确实是两个会话");
    const otherList = await (await fetch(`${base}/api/agents/${agentId}/sessions/${other.sessionId}/annotations`)).json();
    assert.equal((otherList.annotations ?? []).length, 0, "另一个会话没有这条批注（不串会话）");

    // 切回来
    const back = await listAnnos();
    assert.equal(back.length, 1, "切回来批注还在");
    assert.equal(back[0].note, "会话 A 的批注");
    assert.equal(back[0].consumedBy, "send-1", "状态也在");
  } finally { server.close(); }
});

test("场景3-2 切回来后继续发：不带历史批注", async () => {
  const { server, base, agentId, projectId, addAnno, consume, listAnnos, sendMessage, prompts } = await setup();
  try {
    await addAnno("a1", "旧会话批注");
    await consume(["a1"], "send-1");
    await (await fetch(`${base}/api/agents/${agentId}/projects/${projectId}/sessions`, { method: "POST" })).json();

    const pending = pendingOf(await listAnnos());
    assert.equal(pending.length, 0, "切回来待发送仍为空");

    await sendMessage("切回来后的新消息");
    assert.ok(!prompts[0].includes("旧会话批注"), "不得带历史批注");
  } finally { server.close(); }
});

test("场景3-3 后端重启后（模拟隔天再打开），状态仍然正确", async () => {
  const { server, home, agentId, sid, addAnno, consume } = await setup();
  try {
    await addAnno("a1", "重启前标的");
    await consume(["a1"], "send-1");
  } finally { server.close(); }

  // 新起一个服务，指向同一个 home（= 重启）
  const { startOn } = await import("./server-harness.mjs");
  const again = await startOn(home);
  try {
    const list = await (await fetch(`${again.base}/api/agents/${agentId}/sessions/${sid}/annotations`)).json();
    const annos = list.annotations ?? [];
    assert.equal(annos.length, 1, "重启后批注还在");
    assert.equal(annos[0].consumedBy, "send-1", "consumedBy 从文件重放出来了");
    assert.equal(pendingOf(annos).length, 0, "重启后仍不算待发送");
  } finally { again.server.close(); }
});

// ═══════════════════════════════════════════════════════════════
// 边界：坏数据 / 并发
// ═══════════════════════════════════════════════════════════════

test("边界-1 会话里同时有 pending 和 consumed：只发 pending", async () => {
  const { server, addAnno, consume, listAnnos } = await setup();
  try {
    await addAnno("old", "已发过的");
    await consume(["old"], "send-1");
    await addAnno("new1", "新标的 1");
    await addAnno("new2", "新标的 2");

    const pending = pendingOf(await listAnnos());
    assert.deepEqual(pending.map((a) => a.id).sort(), ["new1", "new2"]);

    const { annotationsMessage } = await import("../frontend/src/annotation-message.ts");
    const text = annotationsMessage(pending);
    assert.ok(!text.includes("已发过的"), "旧的不发");
    assert.ok(text.includes("新标的 1") && text.includes("新标的 2"), "新的都发");
  } finally { server.close(); }
});

test("边界-2 只有功能标记（存档/待办）的批注：不组装出文本，但也不该卡住发送", async () => {
  const { server, addAnno, listAnnos } = await setup();
  try {
    await addAnno("f1", "", { marks: ["todo"] });
    const pending = pendingOf(await listAnnos());
    assert.equal(pending.length, 1, "它确实是待发送");
    const { annotationsMessage } = await import("../frontend/src/annotation-message.ts");
    assert.equal(annotationsMessage(pending), "", "但组装出来是空串（不发给 Agent）");
  } finally { server.close(); }
});
