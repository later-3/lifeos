/** 重试倒计时的剩余秒数（Pi CLI 的 RetryStatusIndicator 也是逐秒倒数）。 */
export function retryRemainingSeconds(delayMs: number, elapsedMs: number): number {
  return Math.max(0, Math.ceil((delayMs - elapsedMs) / 1000));
}

/** 一轮对话固定 4 个大步骤：发送 → 受理 → 模型处理 → 完成。工具调用属于第 3 步的子状态。 */
export const TURN_STEP_TOTAL = 4;
export type TurnStep = 1 | 2 | 3 | 4;
export const TURN_STEP_LABEL: Record<TurnStep, string> = {
  1: "发送消息",
  2: "受理请求",
  3: "模型处理",
  4: "完成",
};

export function turnStepText(step: TurnStep): string {
  return `${step}/${TURN_STEP_TOTAL} · ${TURN_STEP_LABEL[step]}`;
}

/** 状态条的 token 数字：保持短，不挤占状态条。 */
export function compactTokens(count: number): string {
  if (count < 1000) return String(count);
  if (count < 10_000) return `${(count / 1000).toFixed(1)}k`;
  if (count < 1_000_000) return `${Math.round(count / 1000)}k`;
  if (count < 10_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  return `${Math.round(count / 1_000_000)}M`;
}

/**
 * 本轮已用秒数（Task 0015 · P3）—— 纯函数，可以单测。
 *
 * `startedAtMs` = 本轮的**开始时刻**（服务端 `running[].startedAt` 或本会话发起时的时刻）。
 * 为什么不用"组件挂载时刻"：切会话再切回来，秒数会从 0 重数 —— 同一个回合两个数字。
 * 时钟回拨（`nowMs < startedAtMs`）夹到 0，不显示负数。
 */
export function elapsedSeconds(startedAtMs: number, nowMs: number = Date.now()): number {
  return Math.max(0, Math.round((nowMs - startedAtMs) / 1000));
}
