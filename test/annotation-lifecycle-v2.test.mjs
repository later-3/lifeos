/**
 * 批注生命周期：pending → consumed（Task 0008 · P1）。
 *
 * 用户 2026-11-04 定的规则（`02-design.md` §3.3）：
 *  1. 发送成功的批注打 `consumedBy`，**这条记录**完成生命周期，不再重发；
 *  2. **状态跟记录走、不跟内容走**——重新编辑产生**新记录**，哪怕文字一模一样也能再发；
 *  3. 编辑已发送的 = 产生新记录，旧记录置 `supersededBy` 留历史；
 *  4. 标记一批时**一次落盘**（consume 事件），不是 N 次 update。
 *
 * 这个文件专门锁住"两条内容相同但状态不同"这个最容易写错的地方——
 * 它是用户反复强调的："这俩其实是不等价的。"
 */
import test from "node:test";
import assert from "node:assert/strict";
import { start } from "./server-harness.mjs";

const anno = (over = {}) => ({
  id: "a1", author: { kind: "user", id: "xu-later" },
  messageId: "seed-asis-0001", blockIndex: 0, start: 6, end: 11,
  quote: "加粗的重点", marks: ["critic"], note: "这里有问题",
  ...over,
});

/** 起一个带新会话的 server，返回 post/get 帮助函数。 */
async function setup() {
  const { server, base } = await start();
  const agents = await (await fetch(`${base}/api/agents`)).json();
  const agentId = agents.items[0].id;
  const projects = await (await fetch(`${base}/api/agents/${agentId}/projects`)).json();
  const projectId = projects.items[0].id;
  const created = await (await fetch(`${base}/api/agents/${agentId}/projects/${projectId}/sessions`, { method: "POST" })).json();
  const sid = created.sessionId;
  const url = `${base}/api/agents/${agentId}/sessions/${sid}/annotations`;
  const send = (body) => fetch(url, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
  const list = async () => (await (await fetch(url)).json()).annotations ?? [];
  return { server, base, url, sid, agentId, projectId, send, list };
}

test("P1-1 新加的批注没有 consumedBy（= pending）", async () => {
  const { server, send, list } = await setup();
  try {
    await send({ op: "add", annotation: anno() });
    const [a] = await list();
    assert.equal(a.consumedBy, undefined, "新批注必须是待发送");
  } finally { server.close(); }
});

test("P1-2 consume 打标记：一次事件标记一批，全部变已发送", async () => {
  const { server, send, list } = await setup();
  try {
    for (const i of [1, 2, 3]) await send({ op: "add", annotation: anno({ id: `a${i}` }) });
    const r = await send({ op: "consume", ids: ["a1", "a2", "a3"], consumedBy: "u-turn-1" });
    assert.equal(r.status, 200);
    assert.equal((await r.json()).consumed, 3);

    const got = await list();
    assert.equal(got.length, 3, "标记不删数据");
    for (const a of got) assert.equal(a.consumedBy, "u-turn-1", `${a.id} 应已消费`);
  } finally { server.close(); }
});

test("P1-3 consume 只标记指定 id，不碰别的", async () => {
  const { server, send, list } = await setup();
  try {
    for (const i of [1, 2, 3]) await send({ op: "add", annotation: anno({ id: `a${i}` }) });
    await send({ op: "consume", ids: ["a2"], consumedBy: "u1" });
    const got = await list();
    assert.equal(got.find((a) => a.id === "a1")?.consumedBy, undefined, "a1 仍待发送");
    assert.equal(got.find((a) => a.id === "a2")?.consumedBy, "u1");
    assert.equal(got.find((a) => a.id === "a3")?.consumedBy, undefined, "a3 仍待发送");
  } finally { server.close(); }
});

test("P1-4 ⭐ 状态跟记录走、不跟内容走：两条内容完全相同，只有未消费的该发", async () => {
  const { server, send, list } = await setup();
  try {
    // 同内容、不同 id：一条已发送，一条待发送
    await send({ op: "add", annotation: anno({ id: "old" }) });
    await send({ op: "consume", ids: ["old"], consumedBy: "u1" });
    await send({ op: "add", annotation: anno({ id: "fresh" }) });   // 文字一模一样

    const got = await list();
    const pending = got.filter((a) => a.consumedBy === undefined);
    assert.equal(pending.length, 1, "应有且仅有一条待发送");
    assert.equal(pending[0].id, "fresh");
    // 关键：内容相同不构成"已发送"，状态只看记录
    assert.equal(pending[0].note, "这里有问题", "内容和 old 完全一样");
  } finally { server.close(); }
});

test("P1-5 编辑已发送的 = 新记录进 pending + 旧记录留历史（supersededBy）", async () => {
  const { server, send, list } = await setup();
  try {
    await send({ op: "add", annotation: anno({ id: "v1", note: "旧说法" }) });
    await send({ op: "consume", ids: ["v1"], consumedBy: "u1" });

    // 产生新版本 v2，并把 v1 标记为被取代
    await send({ op: "add", annotation: anno({ id: "v2", note: "新说法" }) });
    await send({ op: "update", annotation: anno({ id: "v1", note: "旧说法", consumedBy: "u1", supersededBy: "v2" }) });

    const got = await list();
    const v1 = got.find((a) => a.id === "v1");
    const v2 = got.find((a) => a.id === "v2");
    assert.equal(v1?.supersededBy, "v2", "旧记录指向新版本");
    assert.equal(v1?.consumedBy, "u1", "旧记录仍是已发送（历史可查）");
    assert.equal(v2?.consumedBy, undefined, "新记录待发送");
    assert.equal(v2?.supersededBy, undefined, "新记录是最新");

    // 只有未被取代的 pending 才该发
    const pending = got.filter((a) => a.consumedBy === undefined && a.supersededBy === undefined);
    assert.deepEqual(pending.map((a) => a.id), ["v2"]);
  } finally { server.close(); }
});

test("P1-6 consume 不存在的 id：忽略，不报错、不拖垮整批", async () => {
  const { server, send, list } = await setup();
  try {
    await send({ op: "add", annotation: anno({ id: "a1" }) });
    const r = await send({ op: "consume", ids: ["a1", "nope", "also-nope"], consumedBy: "u1" });
    assert.equal(r.status, 200, "不存在的 id 不该让整批失败");
    assert.equal((await list())[0].consumedBy, "u1", "存在的仍然被标记");
  } finally { server.close(); }
});

test("P1-7 consume 的失败路径：缺 ids / ids 空 / 非字符串 / 缺 consumedBy 都 400", async () => {
  const { server, send } = await setup();
  try {
    const cases = [
      [{ op: "consume", consumedBy: "u1" }, "缺 ids"],
      [{ op: "consume", ids: [], consumedBy: "u1" }, "ids 为空"],
      [{ op: "consume", ids: [1, 2], consumedBy: "u1" }, "ids 非字符串"],
      [{ op: "consume", ids: ["a1"] }, "缺 consumedBy"],
      [{ op: "consume", ids: ["a1"], consumedBy: "" }, "consumedBy 为空"],
    ];
    for (const [body, label] of cases) {
      const r = await send(body);
      assert.equal(r.status, 400, `${label} 应 400`);
    }
  } finally { server.close(); }
});

test("P1-8 已消费的批注仍能删（删了不影响历史，只是记录没了）", async () => {
  const { server, send, list } = await setup();
  try {
    await send({ op: "add", annotation: anno({ id: "a1" }) });
    await send({ op: "consume", ids: ["a1"], consumedBy: "u1" });
    await send({ op: "remove", annotation: { id: "a1" } });
    assert.equal((await list()).length, 0);
  } finally { server.close(); }
});

test("P1-9 consume 是追加事件：重放顺序正确（先 add 后 consume 才有 consumedBy）", async () => {
  const { server, send, list } = await setup();
  try {
    // 先 consume 一个还不存在的 id → 应被忽略
    await send({ op: "consume", ids: ["late"], consumedBy: "u1" });
    assert.equal((await list()).length, 0, "对不存在的 id 消费不产生记录");

    // 之后再 add → 它是 pending（consume 在前，不该生效到后来才出现的记录）
    await send({ op: "add", annotation: anno({ id: "late" }) });
    const [a] = await list();
    assert.equal(a.consumedBy, undefined, "先 consume 后 add：新记录仍是待发送");
  } finally { server.close(); }
});

test("P1-10 坏数据不拖垮读接口：consumedBy 非字符串按未消费处理", async () => {
  const { server, send, list } = await setup();
  try {
    await send({ op: "add", annotation: anno({ id: "a1" }) });
    // 直接塞一条脏数据（模拟旧版本/手改文件）
    await send({ op: "update", annotation: anno({ id: "a1", consumedBy: 12345 }) });
    const got = await list();
    assert.equal(got.length, 1, "脏字段不该让整条批注消失");
    assert.equal(got[0].consumedBy, undefined, "非字符串当没有");
  } finally { server.close(); }
});
