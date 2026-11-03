// 回合终态的**唯一判据**（Task 0007）。前后端共用：后端兜底对账与前端"要不要给重新发送"都调它。
//
// 为什么必须只有一处：同一个问题"这一轮算不算失败"曾有两份实现——
//   后端 `src/turn-verdict.ts` 按 stopReason 终态判；
//   前端 `frontend/src/resend.ts` 按"尾部文本为空或带 error"猜。
// 口径不一致就会出现「提示条说可以点重新发送、按钮不出现」（实测 01a19770：stopReason=toolUse 但那轮有文本）。
//
// 判据照抄 Pi 的语义，不自己发明（pi/packages/ai/src/types.ts:474）：
//   终态：stop / length / error / aborted
//   中间态：pending / toolUse / deferred
// 只有终态才代表这一轮结束；文件停在中间态 = 被中断。
//
// 共用先例：`src/session-title.ts`（`src/agent-host.ts` 与 `frontend/src/App.tsx` 同时 import）。

export type TurnOutcome = "done" | "lost";

/** 终态集合：这一轮已经结束（不论成没成）。 */
const TERMINAL_STOPS = new Set(["stop", "length", "error", "aborted"]);

/**
 * 终态且算"正常结束"的集合。
 *
 * - `length`（被截断）仍算完成：这一轮确实结束了，重发不会得到不同的结果，可操作性由
 *   `classifyFailure` 的 `truncated` 单独表达（另一条链路）；
 * - `error`（模型报错）也算完成：失败原因已经在助手消息里显示，它属于"这一轮有结论地结束了"；
 * - `aborted`（用户打断）**不算**完成：中断不是完成，且重发一条自己刚打断的消息是合理动作。
 */
const COMPLETED_STOPS = new Set(["stop", "length", "error"]);

/** 这个 stopReason 是不是"这一轮结束了"（终态）。无字段/空串 = 不确定，由调用方按兼容规则处理。 */
export function isStopTerminal(stop: string | undefined): boolean {
  return stop !== undefined && TERMINAL_STOPS.has(stop);
}

/**
 * 一轮的结局。
 *
 * @param sawAssistant 最后一条 user 之后有没有出现过 assistant
 * @param lastStop     最后一条 assistant 的 stopReason（可为空：老条目没有这个字段）
 */
export function turnOutcomeOf(input: { sawAssistant: boolean; lastStop?: string }): TurnOutcome {
  if (!input.sawAssistant) return "lost";                              // 只有 user → 没跑起来/被掐断
  if (input.lastStop === undefined || input.lastStop === "") return "done";  // 老条目无字段：保守视为完成（兼容）
  return COMPLETED_STOPS.has(input.lastStop) ? "done" : "lost";
}
