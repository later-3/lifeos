/**
 * 失败原因 → 界面文案（后端只传种类，前端决定怎么说）。
 * 种类与 `src/failure.ts` 的 FAILURE_KINDS 对齐（test/failure.test.mjs 会检查两边不漏项）。
 */
export type FailureKind =
  | "aborted" | "truncated" | "empty" | "timeout" | "network" | "auth" | "rate_limit" | "server" | "unknown";

const LABELS: Record<FailureKind, string> = {
  aborted: "本轮已中断",
  truncated: "回复被截断（达到输出上限）",
  empty: "模型没有返回内容",
  timeout: "模型服务响应超时（时限内没有返回）",
  network: "连不上模型服务：网络或端点不可达",
  auth: "模型服务拒绝鉴权：检查 API key 或该模型的访问权限",
  rate_limit: "模型服务限流或额度不足",
  server: "模型服务内部错误",
  unknown: "模型调用失败",
};

export function failureLabel(kind: FailureKind | undefined): string {
  return kind === undefined ? LABELS.unknown : LABELS[kind];
}
