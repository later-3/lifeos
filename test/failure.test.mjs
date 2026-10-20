import test from "node:test";
import assert from "node:assert/strict";
import { FAILURE_KINDS, classifyFailure } from "../src/failure.ts";
import { failureLabel } from "../frontend/src/failure-text.ts";

const classify = (errorMessage, extra = {}) => classifyFailure({ errorMessage, hasContent: true, ...extra });

test("正常回复不归类", () => {
  assert.equal(classifyFailure({ hasContent: true }), undefined);
  assert.equal(classifyFailure({ stopReason: "stop", hasContent: true }), undefined);
});

test("超时 vs 连不上：Pi 自己的 Request timed out 是超时；connection timed out / ECONNREFUSED 是网络", () => {
  assert.equal(classify("Request timed out."), "timeout");
  assert.equal(classify("ETIMEDOUT"), "timeout");
  assert.equal(classify("connection timed out"), "network");
  assert.equal(classify("connect ECONNREFUSED 127.0.0.1:8095"), "network");
  assert.equal(classify("getaddrinfo ENOTFOUND api.example.com"), "network");
  assert.equal(classify("fetch failed"), "network");
});

test("鉴权 / 限流 / 服务端", () => {
  assert.equal(classify("401 Unauthorized"), "auth");
  assert.equal(classify("No API key for local-flashnext/x"), "auth");
  assert.equal(classify("429 Too Many Requests"), "rate_limit");
  assert.equal(classify("insufficient_quota"), "rate_limit");
  assert.equal(classify("503 Service Unavailable"), "server");
  assert.equal(classify("provider returned error"), "server");
});

test("stopReason：中断 / 截断 / 空回复 / 未知错误", () => {
  assert.equal(classifyFailure({ stopReason: "aborted", hasContent: false }), "aborted");
  assert.equal(classifyFailure({ stopReason: "length", hasContent: true }), "truncated");
  assert.equal(classifyFailure({ hasContent: false }), "empty");
  assert.equal(classifyFailure({ stopReason: "error", hasContent: false }), "unknown", "有 error 没原因 → 未知（不是空回复）");
  assert.equal(classify("something odd happened"), "unknown");
});

test("前后端不漏项：每个后端种类都有界面文案", () => {
  for (const kind of FAILURE_KINDS) {
    const label = failureLabel(kind);
    assert.ok(label.length > 0, `${kind} 缺少文案`);
    // unknown 与"没有分类"共用通用文案是设计；其余种类必须有各自的说法
    if (kind !== "unknown") assert.notEqual(label, failureLabel(undefined), `${kind} 不应回落到通用文案`);
  }
  assert.equal(failureLabel(undefined), "模型调用失败");
});
