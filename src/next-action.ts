// 「这一轮之后能做什么」的**唯一判据**（Task 0007 · 阶段一 C+D）。
//
// 为什么单独一个文件、为什么不是 `turnOutcomeOf` 的分支：
// 它们是**两个正交的问题**，挤进一个判断必然出特例。
//   - `turnOutcomeOf()`（src/turn-state.ts）回答"这一轮跑完了吗" → done / lost
//   - `nextActionOf()`   （本文件）      回答"接下来能做什么"     → resend / fix-* / none
// 一轮可以"跑完了（done）但失败了（error）"：跑完不等于失败可忽略，能重来就重来。
//
// 判据来源（全部可核）：
// 1. **Pi 已经自动重试过**：`settings-defaults.ts:20` maxRetries=3，退避 baseDelayMs=2000（约 14 秒总计）；
//    只有 Pi 判定"可重试"的错误才会走到这里（`ai/src/utils/retry.ts:7-96`：
//    可重试 = 5xx/429/网络/超时/流中断；**不可重试** = 额度耗尽/鉴权/413）。
// 2. **Pi 不可重试的那几类，重发也没用**：`NON_RETRYABLE_PROVIDER_LIMIT_ERROR_PATTERN`（retry.ts:7-28）。
// 3. **我们比 Pi CLI 多做一步的理由**：Pi CLI 里用户在终端，重新输入成本≈0；
//    网页里要滚回去找原话、复制、粘贴，成本高一个数量级。所以能救的情况给一键动作。
//
// 为什么"缺某类就给 resend"是安全的：Pi 只在"它认为可重试"时才重试，所以能到我们这里的
// `error` 要么是"可重试但试完了"（重发有意义），要么是"不可重试"（下面单列）。
// 判不出来（unknown/空）时给 resend：宁可让用户试一次，也不要让他没有出口。
import type { FailureKind } from "./failure.ts";
import type { TurnOutcome } from "./turn-state.ts";

/** 接下来该给用户哪个动作。 */
export type NextAction =
  /** 给「重新发送」：这一次重来有意义（网络/超时/中断/空回复…）。 */
  | { kind: "resend"; reason: NextActionReason }
  /** 不给重发，给一条可执行的出口（文案来自 failure-text.ts，这里只给分类）。 */
  | { kind: "fix"; fix: FixKind; reason: NextActionReason }
  /** 什么都不给：这一轮正常完成，或者没有可做的（truncated 走"继续"语义，不在动作条里）。 */
  | { kind: "none" };

export type NextActionReason =
  /** 自动重试已用尽 —— 值得再试一次（Pi 认为这类错误本来就可重试）。 */
  | "retries-exhausted"
  /** 这类错误重发一定没用（Pi 自己都不重试它）。 */
  | "not-retryable"
  /** 用户自己打断的。 */
  | "user-aborted"
  /** 这一轮根本没跑完（进程死/断线/只有 user）。 */
  | "turn-lost"
  /** 正常结束。 */
  | "completed";

export type FixKind = "fix-auth" | "fix-payload" | "fix-quota";

/**
 * Pi **明确不重试**的错误（`ai/src/utils/retry.ts:7-28` NON_RETRYABLE_PROVIDER_LIMIT_ERROR_PATTERN
 * 与 `provider-retry.ts:29-40`：非 408/409/429/5xx 的状态码不重试）。
 * 对这些错误重发 100 次结果一样，给按钮就是"点了白点"。
 */
const NOT_RETRYABLE: Partial<Record<FailureKind, FixKind>> = {
  auth: "fix-auth",
  quota: "fix-quota",
  payload_too_large: "fix-payload",
};

/**
 * 一轮结束之后给用户什么。
 *
 * @param outcome 这一轮跑完了吗（`turnOutcomeOf` 的结果）
 * @param failure 失败归类（`classifyFailure` 的结果；正常完成时为空）
 */
export function nextActionOf(input: { outcome: TurnOutcome; failure?: FailureKind }): NextAction {
  // 1) 没跑完：重发是唯一恢复手段（进程死了/断线/只发了 user）。
  //    参考项目里没有对应场景（Pi CLI 是单机终端，dsh 是托管服务），这一条是我们自己的判断。
  if (input.outcome === "lost") {
    if (input.failure === "aborted") return { kind: "resend", reason: "user-aborted" };
    return { kind: "resend", reason: "turn-lost" };
  }

  // 2) 跑完了但没有失败：不需要动作。
  if (input.failure === undefined) return { kind: "none" };

  // 3) 跑完了但失败了：先排除"重发一定没用"的几类（Pi 自己都不重试它们）。
  const fix = NOT_RETRYABLE[input.failure];
  if (fix !== undefined) return { kind: "fix", fix, reason: "not-retryable" };

  // 4) 输出被 max tokens 截断：这一轮正常结束了，重发会再撞同一个上限。
  //    （它有单独的出口："继续"，不放在动作条里 —— 见 failure-text 的 truncated 文案）
  if (input.failure === "truncated") return { kind: "none" };

  // 5) 其余（network / timeout / server / rate_limit / empty / unknown）：
  //    Pi 认为这些可重试、且它已经试过 3 次仍失败 → 让用户再试一次是合理的。
  return { kind: "resend", reason: "retries-exhausted" };
}
