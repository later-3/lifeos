// 失败原因分类：把 Pi 给的 `stopReason` + `errorMessage` 归到能显示、能区分的种类。
//
// 依据（照 Pi 的语义，不自己发明）：pi/packages/ai/src/types.ts 的 StopReason
// （pending/stop/length/toolUse/error/aborted/deferred）与 pi/packages/ai/src/utils/retry.ts
// 的可重试错误模式（network/connection/fetch failed/getaddrinfo/ENOTFOUND/timed out/...）。
//
// 为什么要分类：用户看到的"没回复"其实是不同的病——端点没连上、等待超时、鉴权失败、
// 限流、服务端 5xx、模型返回空、被中断、被截断。笼统一句"模型调用失败"等于没解释。

export const FAILURE_KINDS = [
  "aborted", "truncated", "empty", "timeout", "network", "auth", "rate_limit", "server", "unknown",
] as const;
export type FailureKind = (typeof FAILURE_KINDS)[number];

const AUTH = /(401|403|unauthorized|forbidden|invalid api key|no api key|authentication|permission denied)/i;
const RATE_LIMIT = /(429|rate.?limit|too many requests|quota|insufficient_quota)/i;
// 网络层：连不上 / 连上被断。放在 timeout 前面判——"connection timed out" 属于连不上，
// 而 Pi 自己的 "Request timed out." 才属于"等回复超时"。
const NETWORK = /(ECONNREFUSED|ECONNRESET|ENOTFOUND|EAI_AGAIN|ENETUNREACH|EHOSTUNREACH|fetch failed|getaddrinfo|socket hang up|connection (refused|reset|closed|timed out)|network.?error|upstream.?connect|other side closed)/i;
const TIMEOUT = /(timed?\s?out|timeout|ETIMEDOUT|deadline exceeded)/i;
const SERVER = /(\b5\d\d\b|internal server error|bad gateway|service unavailable|overloaded|provider returned (an )?error|unable to forward upstream)/i;

/** 归因：没有失败返回 undefined（正常回复）。 */
export function classifyFailure(input: { stopReason?: string; errorMessage?: string; hasContent: boolean }): FailureKind | undefined {
  if (input.stopReason === "aborted") return "aborted";
  if (input.stopReason === "length") return "truncated";
  const message = (input.errorMessage ?? "").trim();
  if (message !== "") {
    if (AUTH.test(message)) return "auth";
    if (RATE_LIMIT.test(message)) return "rate_limit";
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
