/**
 * 批注按"轮"分组（Task 0008 · P2 修订）—— 决定每条 Agent 回复下面的 MarkBar 显示哪些批注。
 *
 * 用户 2026-11-04 的规则：
 *
 *  1. **未发送**（pending：`consumedBy` 为空且未被取代）→ 显示在【最新一轮】Agent 回复的
 *     MarkBar 下，**不管它标的是哪一轮的文字**。理由：它们语义上属于"下一次要发出的消息"，
 *     与发送时机对齐；用户在旧轮次上标，也是想让它随下一次发送走。
 *  2. **已发送**（`consumedBy` = 该轮用户消息 id）→ 显示在**被发送那一轮**的 MarkBar。
 *     理由：那是历史记录，"Agent 当初收到的是什么"，留在原地不动。
 *
 * 为什么锚点必须是**用户消息 id**：轮的定义就是"用户消息切分"（`turn-group.ts`）。
 * `turnId` 不落盘（内存账本、重启即丢），无法承担这个职责。
 */

import type { Annotation } from "./annotations.ts";
import { groupIntoSpans, type TurnSpan } from "./turn-group.ts";

/** 分组输入里消息的最小形状（与 turn-group 的 TurnGrouping 一致再要 id）。 */
type Msg = { role: string; id?: string };

/** 一条回复该显示的批注集合。 */
export type ReplyMarkGroup = ReadonlyMap<string, readonly Annotation[]>;

/**
 * 把批注分派到各条回复上。
 *
 * @param annotations    全部批注
 * @param messages       当前会话的消息（顺序即对话顺序）
 * @param latestReplyId  最新一轮"最后一条回复"的消息 id（没有回复时为 undefined → pending 无处可挂，
 *                       调用方要兜底，见返回值说明）
 * @returns messageId → 该回复的 MarkBar 应显示的批注。
 *          **注意**：pending 的批注落在 `latestReplyId` 名下；若 `latestReplyId` 为 undefined
 *          （会话里一条回复都没有），pending 不出现在结果里——调用方此时不该渲染任何 MarkBar，
 *          但批注数据仍在，下一轮出现回复后自然挂上。
 */
export function groupAnnotationsByReply(
  annotations: readonly Annotation[],
  messages: readonly Msg[],
  latestReplyId: string | undefined,
  /** 各轮"轮末回复 id"的修正表：折叠的回复不算，取该轮最后一条**可见**回复。 */
  visibleLastReplyByUserMessageId?: ReadonlyMap<string, string>,
): ReplyMarkGroup {
  const groups = new Map<string, Annotation[]>();
  const push = (id: string, anno: Annotation) => {
    const list = groups.get(id);
    if (list === undefined) groups.set(id, [anno]);
    else list.push(anno);
  };

  // 轮次：用户消息 id → 轮（用于"已发送"按 consumedBy 反查归属轮）
  const spans: TurnSpan[] = groupIntoSpans(messages);
  const userMessageIdBySpan = new Map<number, string>();
  for (const span of spans) {
    const user = span.userIndex >= 0 ? messages[span.userIndex] : undefined;
    if (user?.id !== undefined) userMessageIdBySpan.set(span.userIndex, user.id);
  }
  /** consumedBy（用户消息 id）→ 该轮 MarkBar 应挂的回复 id（默认轮末；调用方可传"可见轮末"修正表） */
  const replyIdByUserMessageId = new Map<string, string>();
  for (const span of spans) {
    const userId = span.userIndex >= 0 ? userMessageIdBySpan.get(span.userIndex) : undefined;
    if (userId === undefined) continue;
    const replies = span.replyIndexes
      .map((i) => messages[i])
      .filter((m): m is Msg & { id: string } => m !== undefined && m.role === "assistant" && m.id !== undefined);
    const last = replies[replies.length - 1];
    if (last !== undefined) {
      replyIdByUserMessageId.set(userId, visibleLastReplyByUserMessageId?.get(userId) ?? last.id);
    }
  }

  for (const anno of annotations) {
    // 被取代的旧版本：不显示（同一段文字只显示最新那条，用户 2026-11-04）
    if (anno.supersededBy !== undefined) continue;

    if (anno.consumedBy === undefined) {
      // 未发送 → 最新一轮的 MarkBar（latestReplyId 为 undefined 时无处挂，先不显示）
      if (latestReplyId !== undefined) push(latestReplyId, anno);
      continue;
    }

    // 已发送 → 它被发送那一轮的最后一条回复
    const replyId = replyIdByUserMessageId.get(anno.consumedBy);
    if (replyId !== undefined) push(replyId, anno);
    else push(latestReplyId ?? anno.messageId, /* 兜底 */ anno);
  }

  return groups;
}
