import type { Message } from "./Message.tsx";
import { nextActionOf } from "../../src/next-action.ts";
import { turnOutcomeOf as outcomeOf, type TurnOutcome } from "../../src/turn-state.ts";
import type { FailureKind } from "./failure-text.ts";

/**
 * "这一轮没跑出结果"的判定（渲染决策，纯函数）。
 *
 * **两个问题分开回答**（Task 0007）：
 * - `turnOutcomeOfMessages()` → 这一轮跑完了吗（done / lost）。判据在 `src/turn-state.ts`，
 *   与后端兜底对账 `src/turn-verdict.ts` 共用同一张 stopReason 表。
 * - `nextActionOf()`（`src/next-action.ts`）→ 接下来能做什么（resend / fix / none）。
 *   把它塞进 turnOutcome 会逼出一个语义特例（`error` 属终态却要算"可重发"），
 *   而它们本来就是两个正交的问题。
 *
 * **动作挂在最后一条用户消息上**（要重发的是这条消息；挂在助手的错误提示下面，会让人以为
 * 要重发"错误文本"）。助手的失败原因留在助手消息里，不搬走。
 */
export type ResendPlan = { index: number; text: string };

/** 这一轮是否"没跑完"（唯一判据，前后端共用）。 */
export function turnOutcomeOfMessages(messages: Message[]): TurnOutcome {
  // 取"最后一条 assistant"而不是尾条：一轮可以有多条 assistant（工具往返），
  // 与 `src/turn-verdict.ts` 扫文件时"取最后一条 assistant 的终态"同规则。
  const lastAssistant = [...messages].reverse().find((message) => message.role === "assistant");
  return outcomeOf({
    sawAssistant: lastAssistant !== undefined,
    ...(lastAssistant?.stopReason !== undefined ? { lastStop: lastAssistant.stopReason } : {}),
  });
}

/** 最后一条 assistant 的失败归类（"接下来能做什么"判据的输入之一）。 */
function lastFailureOf(messages: Message[]): FailureKind | undefined {
  const lastAssistant = [...messages].reverse().find((message) => message.role === "assistant");
  return lastAssistant?.failure;
}

/**
 * 这一轮之后该给用户什么动作（`src/next-action.ts` 的判据 + 本文件提供"挂在哪条消息上"）。
 * 返回 `undefined` 表示不给动作（与 `nextActionOf().kind === "none"` 等价）。
 */
export function resendPlan(messages: Message[], busy: boolean): ResendPlan | undefined {
  if (busy) return undefined;                       // 生成中不给"重发"（与动作条规则一致）
  const tail = messages[messages.length - 1];
  if (tail === undefined) return undefined;
  const index = messages.map((message) => message.role).lastIndexOf("user");
  const lastUser = messages[index];
  if (lastUser === undefined || lastUser.role !== "user" || lastUser.text.trim() === "") return undefined;

  const action = nextActionOf({
    outcome: turnOutcomeOfMessages(messages),
    ...(lastFailureOf(messages) !== undefined ? { failure: lastFailureOf(messages) } : {}),
  });
  // 只有"给重发"时才有动作条按钮；fix 类出口走失败块文案（它挂在助手的失败块里，不在动作条）
  if (action.kind !== "resend") return undefined;
  return { index, text: lastUser.text };
}

/** 这一轮该给的完整动作（含"不给重发但给出口"的情况），供失败块渲染出口文案。 */
export function nextActionOfMessages(messages: Message[]) {
  return nextActionOf({
    outcome: turnOutcomeOfMessages(messages),
    ...(lastFailureOf(messages) !== undefined ? { failure: lastFailureOf(messages) } : {}),
  });
}
