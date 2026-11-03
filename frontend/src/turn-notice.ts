// 进入会话时的回合提示（任务 0006 B2）：最近一轮没正常完成时，给出原因与下一步。
//
// 2026-11-03 改（Task 0007）：**判据与动作条同源**。
//
// 改前的问题：这个提示由 `turns/last` 的 `state === "lost"` 决定，只设一次、不被 `busy` 清；
// 而"重新发送"按钮由 `resendPlan()` 每次渲染按 `busy` 现算。于是生成中会出现
// "提示条说『可以点重新发送』、按钮却不存在"（用户实测报告）。
//
// 现在两者都问同一个 `turnOutcomeOf()`，并且都受同一个 `busy` 约束：
// - 生成中（busy）：提示只说"正在生成中…"，**不提重新发送**（因为按钮此时确实不出现）；
// - 空闲 + lost：提示原文案，此时按钮一定在（同一 outcome、同一 busy=false）。
//
// 参数用 outcome 而不是后端语义里的 state，是为了让这里不可能出现"第二种判据"。
import type { TurnOutcome } from "../../src/turn-state.ts";

export type TurnSummary = { state: string } | null | undefined;

/** hint：把后端的 `state` 归一成 outcome（只有 "lost" 与 "done" 两种，其他值一律当作 done）。 */
export function outcomeOfTurn(turn: TurnSummary): TurnOutcome {
  return turn?.state === "lost" ? "lost" : "done";
}

export function turnNoticeOf(input: { outcome: TurnOutcome; busy: boolean }): { text: string } | undefined {
  if (input.busy) {
    // 生成中一律不提"重新发送"：按钮此刻不存在（resendPlan 在 busy 时返回 undefined）
    return input.outcome === "lost" ? { text: "正在生成中…（上一轮曾被中断，本轮结束前不提供重新发送）" } : undefined;
  }
  if (input.outcome !== "lost") return undefined;
  return { text: "上一轮没有完成：后端在回复前中断（例如服务重启或开发热重载）。你的消息已保留，可以点「重新发送」。" };
}
