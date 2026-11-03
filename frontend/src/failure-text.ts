/**
 * 失败原因 → 界面文案（后端只传种类，前端决定怎么说）。
 * 种类与 `src/failure.ts` 的 FAILURE_KINDS 对齐（test/failure.test.mjs 会检查两边不漏项）。
 */
export type FailureKind =
  | "aborted" | "truncated" | "empty" | "timeout" | "network" | "auth" | "rate_limit" | "quota" | "server"
  | "payload_too_large" | "unknown";

const LABELS: Record<FailureKind, string> = {
  aborted: "本轮已中断",
  truncated: "回复被截断（达到输出上限）",
  empty: "模型没有返回内容",
  timeout: "模型服务响应超时（时限内没有返回）",
  network: "连不上模型服务：网络或端点不可达",
  auth: "模型服务拒绝鉴权：检查 API key 或该模型的访问权限",
  rate_limit: "模型服务限流（请求太频繁）：等一会儿再试",
  quota: "模型额度已用尽：需要充值或换一个模型（重试没有用）",
  server: "模型服务内部错误",
  payload_too_large: "请求体太大被网关拒绝：历史图片过多，删掉一些或新建会话（重试没有用）",
  unknown: "模型调用失败",
};

export function failureLabel(kind: FailureKind | undefined): string {
  return kind === undefined ? LABELS.unknown : LABELS[kind];
}

/**
 * 不可重试错误的**下一步怎么做**（Task 0007 · 阶段一）。
 *
 * 为什么需要它：对 auth / quota / payload_too_large 这三类，重发 100 次结果一样
 * （Pi 自己都不重试它们：pi/packages/ai/src/utils/retry.ts:7-28 的
 * NON_RETRYABLE_PROVIDER_LIMIT_ERROR_PATTERN）。不给按钮是对的，但不能让用户没方向 ——
 * 这三个出口是**可执行**的，而不是"失败了"。
 */
export type FixKind = "fix-auth" | "fix-payload" | "fix-quota";

const FIX_HINTS: Record<FixKind, string> = {
  "fix-auth": "下一步：打开助手配置检查默认模型的 API key 与访问权限，改好后重新发送这句话。",
  "fix-payload": "下一步：删掉这条消息里的部分图片，或用「新建会话」重新开始（上下文已经太大，重发会再被拒）。",
  "fix-quota": "下一步：在助手配置里换一个还有额度的模型，或给当前服务商充值。",
};

export function fixHint(kind: FixKind): string {
  return FIX_HINTS[kind];
}
