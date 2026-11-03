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

test("鉴权 / 限流 / 额度 / 服务端", () => {
  assert.equal(classify("401 Unauthorized"), "auth");
  // 2026-11-03（Task 0017）契约变更："key 压根没给" 从 auth 拆出来成 model_not_configured。
  // 依据：Pi 在 models.json 用 `${VAR}` 引用环境变量，变量缺失时抛的是**本地解析失败**
  // （`Failed to resolve API key … from environment variable: AMR_LINK_API_KEY`），
  // 不是 HTTP 401。两种病的下一步不同：auth＝“key 错了”；model_not_configured＝“没给 key”。
  assert.equal(classify("No API key for local-flashnext/x"), "model_not_configured");
  assert.equal(classify('Failed to resolve API key for provider "amr-link" from environment variable: AMR_LINK_API_KEY'), "model_not_configured");
  assert.equal(classify("No API key found for amr-link."), "model_not_configured");
  assert.equal(classify("Provider is not configured: amr-link"), "model_not_configured");
  assert.equal(classify("429 Too Many Requests"), "rate_limit");
  // 2026-11-03（Task 0007 · B）契约变更：额度耗尽从 rate_limit 拆出来成 quota。
  // 依据 Pi 的 NON_RETRYABLE_PROVIDER_LIMIT_ERROR_PATTERN（ai/src/utils/retry.ts:7-28）：
  // 这类错误 Pi 明确不重试；与"限流等一会儿就好"是两种处置（充值/换模型 vs 稍后重试）。
  assert.equal(classify("insufficient_quota"), "quota");
  assert.equal(classify("quota exceeded"), "quota");
  assert.equal(classify("Monthly usage limit reached"), "quota");
  assert.equal(classify("out of budget"), "quota");
  assert.equal(classify("503 Service Unavailable"), "server");
  assert.equal(classify("provider returned error"), "server");
});

// Task 0007 · B：补齐 Pi 可重试清单里我们此前落进 unknown 的网络类错误。
// 依据 pi/packages/ai/src/utils/retry.ts:60-96（RETRYABLE_PROVIDER_ERROR_PATTERN）。
test("网络类：Pi 认为可重试的传输错误都要归到 network（不能落进 unknown）", () => {
  const networkMessages = [
    "Connection error.",
    "connection lost",
    "stream ended before message_stop",
    "ended without",
    "http2 request did not get a response",
    "reset before headers",
    "websocket closed",
    "socket hang up",
    "fetch failed",
    "getaddrinfo ENOTFOUND api.deepseek.com",
    "other side closed",
  ];
  for (const message of networkMessages) {
    assert.equal(classify(message), "network", message);
  }
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

test("请求体过大（Task 0012）：真实 413 报文归到 payload_too_large，而不是 server（报文里带 server_error）", () => {
  const real = [
    '413: {"message":"{\\"error\\":{\\"message\\":\\"Payload too large. The maximum request body is 3.5 MB,',
    'which is a limit on the encoded request and is separate from the model context window.\\",',
    '\\"code\\":\\"payload_too_large\\"}","type":"server_error"}',
  ].join(" ");
  assert.equal(classify(real), "payload_too_large");
  assert.equal(classify("Payload too large"), "payload_too_large");
  assert.equal(classify("413 Payload Too Large"), "payload_too_large");
  // 不能误伤 5xx 与普通超时
  assert.equal(classify("503 Service Unavailable"), "server");
  assert.equal(classify("Request timed out."), "timeout");
  // 前端文案必须覆盖新种类
  assert.match(failureLabel("payload_too_large"), /重试没有用/);
});
