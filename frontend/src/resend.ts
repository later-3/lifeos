import type { Message } from "./Message.tsx";
import { turnOutcomeOf, type TurnOutcome } from "../../src/turn-state.ts";

/**
 * "这一轮没跑出结果"的判定（渲染决策，纯函数）。
 *
 * **判据不在本文件**：是否失败只看 `turnOutcomeOf()`（`src/turn-state.ts`，与后端兜底对账
 * `src/turn-verdict.ts` 共用同一张 stopReason 表）。本文件只回答"动作挂在哪条消息上"。
 *
 * 改前（2026-11-03 之前）这里自己猜：`tail.text === "" || tail.error !== undefined`。
 * 它与后端口径不等价 —— 实测 `stopReason=toolUse` 但那轮有正文的会话
 * （`01a19770-9d9d-77b3-8259-16b54cd4b4ff`）后端判 lost（提示条说"可以点重新发送"），
 * 这里判"有回复、不算失败"（不给按钮）。同一个问题两份实现，必然对不上。
 *
 * **动作挂在最后一条用户消息上**（要重发的是这条消息；挂在助手的错误提示下面，会让人以为
 * 要重发"错误文本"）。助手的失败原因留在助手消息里，不搬走。
 */
export type ResendPlan = { index: number; text: string };


export function resendPlan(messages: Message[], busy: boolean): ResendPlan | undefined {
  if (busy) return undefined;                       // 生成中不给"重发"（与动作条规则一致）
  const tail = messages[messages.length - 1];
  if (tail === undefined) return undefined;
  const index = messages.map((message) => message.role).lastIndexOf("user");
  const lastUser = messages[index];
  if (lastUser === undefined || lastUser.role !== "user" || lastUser.text.trim() === "") return undefined;
  // 最后一轮是否 lost：只看终态（与后端同源）。
  if (turnOutcomeOfMessages(messages) !== "lost") return undefined;
  // 只给"重发哪条消息"；失败说明属于左侧本轮槽（不属于用户消息）
  return { index, text: lastUser.text };
}

/**
 * 当前消息列表里"最后一轮"的结局（Task 0007）。
 *
 * 提示条与重发按钮都从这里取，保证两者永远同一口径：按钮出现⇔提示提"可以点重新发送"。
 * 取"最后一条 assistant"而不是尾条：一轮可以有多条 assistant（工具往返），
 * 与 `src/turn-verdict.ts` 扫文件时"取最后一条 assistant 的终态"同规则。
 */
export function turnOutcomeOfMessages(messages: Message[]): TurnOutcome {
  const lastAssistant = [...messages].reverse().find((message) => message.role === "assistant");
  return turnOutcomeOf({
    sawAssistant: lastAssistant !== undefined,
    ...(lastAssistant?.stopReason !== undefined ? { lastStop: lastAssistant.stopReason } : {}),
  });
}
