/**
 * 一轮的定义与分组（2026-11-02）。
 *
 * 为什么需要这个纯函数：折叠的粒度是**一轮**，而界面上拿到的是**一条条扁平的 message**。
 * 而"一轮"在我们的数据里不是"一条 assistant 消息"——实测本会话：
 * 每轮 assistant 消息数 中位 6、平均 12.7、**最大 198**。
 * 按消息折叠会折出 198 个碎块，比不折更乱。所以必须先分组。
 *
 * 分组的唯一依据是**用户消息的边界**：你发一句话 → 到下一句话之前，全部是同一轮。
 * 这条规则来自 chat.md §3.3「一轮可有多条 assistant message（工具调用前后各一段）」，
 * 不是新发明的语义。
 *
 * 消息块只带 `role`（"user" | "assistant"）与非 assistant 的其他角色（Pi 的 toolResult 已经在
 * messagesOf 里挂回 toolCall，不出现在顶层），所以这里只需要认 user。
 */

/** 分组所需的最小形状（只读 role，避免绑死前端 Message 类型）。 */
export type TurnGrouping = { role: string };

export type TurnSpan = {
  /** 这条用户消息的下标 */
  userIndex: number;
  /** 紧随其后的助手消息下标（可能为空：发完还没回） */
  replyIndexes: number[];
};

/**
 * 按用户消息切轮。
 *
 * @returns 每个用户消息一条 TurnSpan。
 *          用户消息之前的助手消息（异常数据）不会丢——它们挂到"第一个用户消息"之前的一个隐式轮里，
 *          但那个隐式轮没有 userIndex，所以用 `-1` 表示（调用方按"没有用户消息的孤儿"处理，不折叠）。
 */
export function groupIntoSpans<T extends TurnGrouping>(messages: readonly T[]): TurnSpan[] {
  const spans: TurnSpan[] = [];
  let current: TurnSpan | undefined;
  messages.forEach((message, index) => {
    if (message.role === "user") {
      current = { userIndex: index, replyIndexes: [] };
      spans.push(current);
      return;
    }
    if (current === undefined) {
      // 开头的孤儿助手消息：单独成轮，userIndex = -1
      current = { userIndex: -1, replyIndexes: [index] };
      spans.push(current);
      return;
    }
    current.replyIndexes.push(index);
  });
  return spans;
}

/**
 * 该轮的"过程块起止"：把这一轮所有回复消息摊平后交给 ProcessBar 统计。
 *
 * 返回的是下标数组（不是块），因为分块渲染仍由 MessageView 负责——
 * 折叠只决定"哪些 assistant 消息渲染成过程条"，不改内容。
 */
export function replyIndexesOf(spans: readonly TurnSpan[], userMessageIndex: number): number[] {
  const span = spans.find((candidate) => candidate.userIndex === userMessageIndex);
  return span === undefined ? [] : span.replyIndexes;
}
