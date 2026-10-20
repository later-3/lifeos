/** 重试倒计时的剩余秒数（Pi CLI 的 RetryStatusIndicator 也是逐秒倒数）。 */
export function retryRemainingSeconds(delayMs: number, elapsedMs: number): number {
  return Math.max(0, Math.ceil((delayMs - elapsedMs) / 1000));
}
