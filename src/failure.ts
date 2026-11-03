// 失败原因分类：把 Pi 给的 `stopReason` + `errorMessage` 归到能显示、能区分的种类。
//
// 依据（照 Pi 的语义，不自己发明）：pi/packages/ai/src/types.ts 的 StopReason
// （pending/stop/length/toolUse/error/aborted/deferred）与 pi/packages/ai/src/utils/retry.ts
// 的可重试错误模式（network/connection/fetch failed/getaddrinfo/ENOTFOUND/timed out/...）。
//
// 为什么要分类：用户看到的"没回复"其实是不同的病——端点没连上、等待超时、鉴权失败、
// 限流、服务端 5xx、模型返回空、被中断、被截断。笼统一句"模型调用失败"等于没解释。

export const FAILURE_KINDS = [
  "aborted", "truncated", "empty", "timeout", "network", "auth", "rate_limit", "quota", "server", "payload_too_large", "unknown",
] as const;
export type FailureKind = (typeof FAILURE_KINDS)[number];

const AUTH = /(401|403|unauthorized|forbidden|invalid api key|no api key|authentication|permission denied)/i;
// 额度/计费耗尽：**确定性失败**，Pi 明确不重试（pi/packages/ai/src/utils/retry.ts:7-28
// NON_RETRYABLE_PROVIDER_LIMIT_ERROR_PATTERN：insufficient_quota / out of budget / quota exceeded /
// billing / GoUsageLimitError / FreeUsageLimitError / Monthly usage limit reached …）。
// 必须与"限流"分开：限流等一会儿就好（可重发），额度耗尽要充值或换模型（重发无用）。
const QUOTA = /(insufficient_quota|quota.?exceed|out of budget|billing|GoUsageLimitError|FreeUsageLimitError|Monthly usage limit reached|available balance|subscription_sharing_usage_limit_exceeded)/i;
const RATE_LIMIT = /(429|rate.?limit|too many requests)/i;
// 请求体过大（Task 0012）：**确定性失败**，重试无意义。必须在 SERVER 之前判——
// 网关的 413 报文里带 `"type":"server_error"`，否则会被归成"服务端错误"并触发 Pi 的自动重试。
/** 供 agent-host（记账）与 assembly（回合内自救）共用；单一事实源，避免两处漂移。 */
export const PAYLOAD_TOO_LARGE = /(\b413\b|payload.?too.?large|maximum request body|request body.{0,24}(too large|exceed))/i;
// 网络层：连不上 / 连上被断。放在 timeout 前面判——"connection timed out" 属于连不上，
// 而 Pi 自己的 "Request timed out." 才属于"等回复超时"。
// 网络层：连不上 / 连上被断。放在 timeout 前面判——"connection timed out" 属于连不上，
// 而 Pi 自己的 "Request timed out." 才属于"等回复超时"。
// 2026-11-03（Task 0007 · B）补齐 Pi 可重试清单里我们漏掉的几条，它们此前全落进 unknown
// （界面显示"模型调用失败"，用户看不出是网络问题）：见 pi/packages/ai/src/utils/retry.ts:60-96
//   connection.?error / stream ended before message_stop / ended without /
//   http2 request did not get a response / reset before headers / websocket closed|error
const NETWORK = /(ECONNREFUSED|ECONNRESET|ENOTFOUND|EAI_AGAIN|ENETUNREACH|EHOSTUNREACH|fetch failed|getaddrinfo|socket hang up|connection (refused|reset|closed|lost|error|timed out)|network.?error|upstream.?connect|other side closed|reset before headers|stream ended before|ended without|http2 request did not get a response|pending stream has been canceled|websocket.?(closed|error))/i;
const TIMEOUT = /(timed?\s?out|timeout|ETIMEDOUT|deadline exceeded)/i;
const SERVER = /(\b5\d\d\b|internal server error|bad gateway|service unavailable|overloaded|provider returned (an )?error|unable to forward upstream)/i;

/** 归因：没有失败返回 undefined（正常回复）。 */
export function classifyFailure(input: { stopReason?: string; errorMessage?: string; hasContent: boolean }): FailureKind | undefined {
  if (input.stopReason === "aborted") return "aborted";
  if (input.stopReason === "length") return "truncated";
  const message = (input.errorMessage ?? "").trim();
  if (message !== "") {
    if (AUTH.test(message)) return "auth";
    if (QUOTA.test(message)) return "quota";
    if (RATE_LIMIT.test(message)) return "rate_limit";
    if (PAYLOAD_TOO_LARGE.test(message)) return "payload_too_large";
    if (NETWORK.test(message)) return "network";
    if (TIMEOUT.test(message)) return "timeout";
    if (SERVER.test(message)) return "server";
    return "unknown";
  }
  if (input.stopReason === "error") return "unknown";
  // 跑完了但什么都没产出（重试留下的空 assistant / 模型空回复）
  if (!input.hasContent) return "empty";
  return undefined;
}
