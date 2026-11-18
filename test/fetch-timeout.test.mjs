/**
 * 加载闸（Task 0028 · P2 / 缺陷 D2）。
 *
 * ## 缺陷（Task 0027 · E6 / R3-2③）
 *
 * 会话加载链路**没有超时**（全 `frontend/src` 里 `AbortController|AbortSignal.timeout` = 0 处），
 * 且失败时没有出口：打桩 500 或断网 → 聊天区空白 + `pageerror: TypeError: Failed to fetch`，
 * 前端日志零记录。用户在"永久骨架"与"一片空白"之间，无法判断该等还是该刷新。
 *
 * ## 本文件锁什么
 *
 * 一次请求只有四种结局，四种都必须被**显式表达**（`specs/code/backend/code.md` 2.9）：
 * 成功 / 超时 / 网络错 / http 错。任何"既不是成功也没人管"的状态都不允许存在。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { withTimeout, fetchJsonWithTimeout, failureTextOf } from "../frontend/src/api/fetch-timeout.ts";
import { chatSurfaceOf } from "../frontend/src/api/boot-state.ts";

const never = () => new Promise(() => {});
const okResponse = () => new Response("{}", { status: 200, headers: { "content-type": "application/json" } });

test("T28-5 成功路径：原样返回 value，且不触发 abort", async () => {
  let aborted = false;
  const result = await withTimeout(async (signal) => {
    signal.addEventListener("abort", () => { aborted = true; });
    return okResponse();
  }, 1000, "session");
  assert.equal(result.ok, true);
  assert.equal(result.value.status, 200);
  assert.equal(aborted, false, "成功路径不得 abort");
});

test("T28-6 超时：到点返回 timeout，并已 abort 底层请求", async () => {
  let aborted = false;
  const started = Date.now();
  const result = await withTimeout(async (signal) => {
    signal.addEventListener("abort", () => { aborted = true; });
    return never();
  }, 60, "session");
  const elapsed = Date.now() - started;
  assert.equal(result.ok, false);
  assert.equal(result.failure.kind, "timeout");
  assert.ok(elapsed >= 50 && elapsed < 1000, `应在约 60ms 返回（实得 ${elapsed}ms）`);
  assert.equal(aborted, true, "超时必须 abort 底层请求（否则连接一直被占着）");
});

test("T28-7 网络错：归成 network，而不是 timeout", async () => {
  const result = await withTimeout(async () => { throw new TypeError("Failed to fetch"); }, 1000, "session");
  assert.equal(result.ok, false);
  assert.equal(result.failure.kind, "network");
});

/** 临时替换全局 fetch（`fetchJsonWithTimeout` 走的就是它）——用完必须还原。 */
async function withFetch(stub, run) {
  const original = globalThis.fetch;
  globalThis.fetch = stub;
  try { return await run(); } finally { globalThis.fetch = original; }
}

test("T28-8 http 错：保留状态码；文案不得把 5xx 说成「找不到」", async () => {
  const result = await withFetch(async () => new Response("boom", { status: 500 }),
    () => fetchJsonWithTimeout("/api/x", 1000, "session"));
  assert.equal(result.ok, false);
  assert.equal(result.failure.kind, "http");
  assert.equal(result.failure.status, 500);
  const text = failureTextOf(result.failure);
  assert.doesNotMatch(text, /找不到/, "5xx 不能说成「找不到」（api 规范 2.3）");
  assert.match(text, /后端|失败/, "文案要说清是哪一类问题");
});

test("T28-8a ms 是真实耗时，不是超时阈值（曾经把 15s 记成耗时）", async () => {
  const result = await withFetch(async () => new Response("boom", { status: 500 }),
    () => fetchJsonWithTimeout("/api/x", 15_000, "session"));
  assert.equal(result.ok, false);
  assert.ok(result.failure.ms < 1000, `立即返回的 500 不该记成 ${result.failure.ms}ms`);
});

test("T28-8b 404 与 500 的文案不同（不把「资源在、失败在别处」归成 404）", async () => {
  const notFound = await withFetch(async () => new Response("{}", { status: 404 }),
    () => fetchJsonWithTimeout("/api/x", 1000, "session"));
  const serverErr = await withFetch(async () => new Response("{}", { status: 500 }),
    () => fetchJsonWithTimeout("/api/x", 1000, "session"));
  assert.notEqual(failureTextOf(notFound.failure), failureTextOf(serverErr.failure));
  assert.match(failureTextOf(notFound.failure), /不存在/, "404 才可以说「不存在」");
});

test("T28-8c 200 但不是 JSON（被代理换成 HTML 登录页）：算失败，不能当数据用", async () => {
  const result = await withFetch(async () => new Response("<html>login</html>", { status: 200, headers: { "content-type": "text/html" } }),
    () => fetchJsonWithTimeout("/api/x", 1000, "session"));
  assert.equal(result.ok, false);
  assert.match(String(result.failure.detail), /非 JSON/);
});

test("T28-8d 超时会 abort 真实 fetch（signal 传给 fetch，连接才不会被一直占着）", async () => {
  let seenSignal;
  const result = await withFetch((_input, init) => {
    seenSignal = init?.signal;
    return new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
    });
  }, () => fetchJsonWithTimeout("/api/x", 50, "session"));
  assert.equal(result.ok, false);
  assert.equal(result.failure.kind, "timeout");
  assert.equal(seenSignal?.aborted, true, "把 signal 传进 fetch，超时才真的断开连接");
});

test("T28-9 聊天区表面：有加载失败时必须出 error，不能继续宣称 loading", () => {
  const base = { resolving: false, sessionId: "s1", selectedProjectId: "p1", messagesLoading: true, messageCount: 0 };
  // 现状（未实现前）：只能 loading——这正是"永久骨架"的表现
  assert.equal(chatSurfaceOf(base), "loading");
  // 失败已明确：必须能说"出错了"，否则用户永远等下去
  const failed = chatSurfaceOf({ ...base, loadFailure: { kind: "timeout" } });
  assert.equal(failed, "error");
});

test("T28-9b 有内容时优先显示内容（失败提示不盖掉已渲染的消息）", () => {
  const surface = chatSurfaceOf({
    resolving: false, sessionId: "s1", selectedProjectId: "p1",
    messagesLoading: false, messageCount: 5, loadFailure: { kind: "timeout" },
  });
  assert.equal(surface, "content", "内容优先：一次失败的刷新不该把已有对话换成错误页");
});
