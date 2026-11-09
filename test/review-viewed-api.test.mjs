// G10 已看进度的接口：失败路径先写（backend 2.5）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { start } from "./server-harness.mjs";

const TASK_DIR = "/tmp/g10-viewed-task";
const post = (base, payload) => fetch(`${base}/api/review/viewed`, {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload),
});

test("G10API·1 GET 空 → { items: [] }（列表统一包 items）", async () => {
  const { server, base } = await start();
  try {
    const r = await fetch(`${base}/api/review/viewed?taskDir=${encodeURIComponent(TASK_DIR)}`);
    assert.equal(r.status, 200);
    assert.deepEqual((await r.json()).items, []);
  } finally { server.close(); }
});

test("G10API·2 GET 缺 taskDir → 400 invalid_request", async () => {
  const { server, base } = await start();
  try {
    const r = await fetch(`${base}/api/review/viewed`);
    assert.equal(r.status, 400);
    assert.equal((await r.json()).error.code, "invalid_request");
  } finally { server.close(); }
});

test("G10API·3 POST set 单个 → 200，返回带 hash 的记录", async () => {
  const { server, base } = await start();
  const dir = `${TASK_DIR}-one`;
  try {
    const r = await post(base, { taskDir: dir, op: "set", paths: [{ path: "src/a.ts", hash: "h1" }], viewed: true });
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.equal(body.items.length, 1);
    assert.equal(body.items[0].path, "src/a.ts");
    assert.equal(body.items[0].hash, "h1");
  } finally { server.close(); }
});

test("G10API·4 POST set 批量 → 一次写多个；viewed:false → 取消", async () => {
  const { server, base } = await start();
  const dir = `${TASK_DIR}-many`;
  try {
    const added = await (await post(base, { taskDir: dir, op: "set", paths: [{ path: "a.ts", hash: "h" }, { path: "b.ts", hash: "h" }], viewed: true })).json();
    assert.equal(added.items.length, 2);
    const removed = await (await post(base, { taskDir: dir, op: "set", paths: [{ path: "a.ts", hash: "h" }], viewed: false })).json();
    assert.deepEqual(removed.items.map((record) => record.path), ["b.ts"]);
  } finally { server.close(); }
});

test("G10API·5 参数病三条各一个 400：缺 taskDir / 非法 op / paths 为空或全非法", async () => {
  const { server, base } = await start();
  const dir = `${TASK_DIR}-bad`;
  try {
    assert.equal((await post(base, { op: "set", paths: [{ path: "a", hash: "h" }] })).status, 400);
    assert.equal((await post(base, { taskDir: dir, op: "explode" })).status, 400);
    assert.equal((await post(base, { taskDir: dir, op: "set", paths: [] })).status, 400);
    assert.equal((await post(base, { taskDir: dir, op: "set", paths: [{ path: "" }] })).status, 400, "全非法项要 400，不能静默成功");
  } finally { server.close(); }
});

test("G10API·6 POST clear → 清空（进度可重建）", async () => {
  const { server, base } = await start();
  const dir = `${TASK_DIR}-clear`;
  try {
    await post(base, { taskDir: dir, op: "set", paths: [{ path: "a.ts", hash: "h" }], viewed: true });
    const cleared = await post(base, { taskDir: dir, op: "clear" });
    assert.equal(cleared.status, 200);
    const after = await (await fetch(`${base}/api/review/viewed?taskDir=${encodeURIComponent(dir)}`)).json();
    assert.deepEqual(after.items, []);
  } finally { server.close(); }
});
