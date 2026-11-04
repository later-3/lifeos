/**
 * 批注的落盘与接口（Task 0003 · P5）。
 *
 * 覆盖两条纪律（`specs/review/review.md` §5）：
 *  - 新接口必须写失败路径（404 / 400），只测成功路径等于没验证；
 *  - 坏数据不能拖垮读接口（批注丢失可接受，会话读不出来不可接受）。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { start } from "./server-harness.mjs";

const AGENT = "lifeosagent";

/** 造一条合法批注。 */
const anno = (over = {}) => ({
  id: "a1", author: { kind: "user", id: "xu-later" },
  messageId: "seed-asis-0001", blockIndex: 0, start: 6, end: 11,
  quote: "加粗的重点", marks: ["critic"], note: "这里有问题",
  ...over,
});

test("T5-1 写 3 条 → 读出 3 条（顺序一致）", async () => {
  const { server, base } = await start();
  try {
    const agents = await (await fetch(`${base}/api/agents`)).json();
    const agentId = agents.items[0].id;
    const projects = await (await fetch(`${base}/api/agents/${agentId}/projects`)).json();
    const projectId = projects.items[0].id;
    const created = await (await fetch(`${base}/api/agents/${agentId}/projects/${projectId}/sessions`, { method: "POST" })).json();
    const sid = created.sessionId;

    const post = (op, annotation) => fetch(`${base}/api/agents/${agentId}/sessions/${sid}/annotations`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ op, annotation }),
    });
    for (const i of [1, 2, 3]) {
      const r = await post("add", anno({ id: `a${i}`, start: i, end: i + 2, quote: `q${i}` }));
      assert.equal(r.status, 200, `add a${i} 应 200`);
    }
    const got = await (await fetch(`${base}/api/agents/${agentId}/sessions/${sid}/annotations`)).json();
    assert.deepEqual(got.annotations.map((a) => a.id), ["a1", "a2", "a3"]);
    assert.equal(got.annotations[0].author.id, "xu-later", "author.id 必须原样保存");
  } finally { server.close(); }
});

test("T5-2 remove 生效；update 覆盖同 id", async () => {
  const { server, base } = await start();
  try {
    const agents = await (await fetch(`${base}/api/agents`)).json();
    const agentId = agents.items[0].id;
    const projects = await (await fetch(`${base}/api/agents/${agentId}/projects`)).json();
    const sid = (await (await fetch(`${base}/api/agents/${agentId}/projects/${projects.items[0].id}/sessions`, { method: "POST" })).json()).sessionId;
    const post = (op, annotation) => fetch(`${base}/api/agents/${agentId}/sessions/${sid}/annotations`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ op, annotation }),
    });

    await post("add", anno({ id: "a1" }));
    await post("add", anno({ id: "a2", quote: "第二" }));
    await post("update", anno({ id: "a1", note: "改过了" }));
    let got = await (await fetch(`${base}/api/agents/${agentId}/sessions/${sid}/annotations`)).json();
    assert.equal(got.annotations.length, 2, "update 不应增加条目");
    assert.equal(got.annotations[0].note, "改过了");

    await post("remove", { id: "a1" });
    got = await (await fetch(`${base}/api/agents/${agentId}/sessions/${sid}/annotations`)).json();
    assert.deepEqual(got.annotations.map((a) => a.id), ["a2"]);
  } finally { server.close(); }
});

test("T5-4 旧会话（没有批注条目）→ 空集合，不是 500", async () => {
  const { server, base } = await start();
  try {
    const agents = await (await fetch(`${base}/api/agents`)).json();
    const agentId = agents.items[0].id;
    const projects = await (await fetch(`${base}/api/agents/${agentId}/projects`)).json();
    const sid = (await (await fetch(`${base}/api/agents/${agentId}/projects/${projects.items[0].id}/sessions`, { method: "POST" })).json()).sessionId;
    const r = await fetch(`${base}/api/agents/${agentId}/sessions/${sid}/annotations`);
    assert.equal(r.status, 200);
    assert.deepEqual((await r.json()).annotations, []);
  } finally { server.close(); }
});

test("T5-5 失败路径：会话不存在 404 / op 不合法 400 / 字段缺失 400", async () => {
  const { server, base } = await start();
  try {
    const agents = await (await fetch(`${base}/api/agents`)).json();
    const agentId = agents.items[0].id;

    const missingAgent = await fetch(`${base}/api/agents/nobody/sessions/x/annotations`);
    assert.equal(missingAgent.status, 404, "未知 Agent");

    const missingSession = await fetch(`${base}/api/agents/${agentId}/sessions/not-a-session/annotations`);
    assert.equal(missingSession.status, 404, "未知会话");

    const projects = await (await fetch(`${base}/api/agents/${agentId}/projects`)).json();
    const sid = (await (await fetch(`${base}/api/agents/${agentId}/projects/${projects.items[0].id}/sessions`, { method: "POST" })).json()).sessionId;
    const url = `${base}/api/agents/${agentId}/sessions/${sid}/annotations`;
    const post = (body) => fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

    assert.equal((await post({ op: "nope", annotation: anno() })).status, 400, "op 不合法");
    assert.equal((await post({ op: "add" })).status, 400, "缺 annotation");
    assert.equal((await post({ op: "add", annotation: { id: "" } })).status, 400, "id 为空");
    assert.equal((await post({ op: "add", annotation: anno({ messageId: "" }) })).status, 400, "messageId 为空");
    assert.equal((await post({ op: "add", annotation: anno({ start: 5, end: 5 }) })).status, 400, "空区间");
    assert.equal((await post({ op: "add", annotation: anno({ marks: [] }) })).status, 400, "marks 为空");
  } finally { server.close(); }
});

test("T5-6 remove 只需要 id（不需要完整字段）", async () => {
  const { server, base } = await start();
  try {
    const agents = await (await fetch(`${base}/api/agents`)).json();
    const agentId = agents.items[0].id;
    const projects = await (await fetch(`${base}/api/agents/${agentId}/projects`)).json();
    const sid = (await (await fetch(`${base}/api/agents/${agentId}/projects/${projects.items[0].id}/sessions`, { method: "POST" })).json()).sessionId;
    const url = `${base}/api/agents/${agentId}/sessions/${sid}/annotations`;
    const post = (body) => fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    await post({ op: "add", annotation: anno({ id: "a1" }) });
    const r = await post({ op: "remove", annotation: { id: "a1" } });
    assert.equal(r.status, 200, "remove 只给 id 也应成功");
    assert.deepEqual((await (await fetch(url)).json()).annotations, []);
  } finally { server.close(); }
});
