/**
 * 会话累计事实（Task 0008 · P3 修订）—— 纯函数，不碰 DOM。
 *
 * 用户 2026-11-05："现在的 turnstat bar，就可以把一些信息换为累计的信息，比如
 * **共计多少轮次，共计多少工具调用，时间，token 消耗，平均速度**"。
 *
 * 为什么单独成文件：这些数字要能被单测锁住（口径一旦漂，界面上没人看得出对错），
 * 而后端 `sessionMeta` 的 usage 与消息列表是两份来源，合算规则只能有一处。
 *
 * **口径**（每个数字怎么来的，写死在测试里；Task 0015 · P4 修正过「时长」一栏）：
 *
 * | 项 | 来源 | 口径 |
 * |---|---|---|
 * | 轮次 | 消息列表 | `role === "user"` 的条数（一条用户消息 = 一轮） |
 * | 工具调用 | 消息块的 `type === "toolCall"` | 全部轮的合计（含正在跑的那一轮） |
 * | **时长** | 每轮 `turnWallMsOf()` | **墙钟合计**：每轮从它的用户消息到该轮最后一条消息。含工具执行，不含轮与轮之间的挂机 |
 * | token | `meta.usage`（后端 `sessionUsage`） | 会话累计，含 cacheRead/cacheWrite 与压缩条目 |
 * | 平均速度 | usage.output ÷ **模型时间** | 分母是 `turnModelMsOf()`（纯模型），不是墙钟 |
 *
 * **为什么「时长」与「速度」的分母不同**（2026-11-07 用户报"两个 bar 时间不一样"后定）：
 * Pi 的 `AssistantMessage.durationMs` 官方定义是"从请求开始到响应结束"的**纯模型时间**
 *（`pi/packages/ai/src/types.ts:616-624`），不含工具执行。以前我们拿它的合计当"耗时"，
 * 实测一个含 `sleep 6` 的回合：墙钟 34417ms、ΣdurationMs 28323ms —— 差的 6 秒正是工具执行，
 * 于是"跑的时候显示 20s、结束后变 11 秒"，数字往回跳（案例 C004）。
 * 现在「时长」只有一个值 = 墙钟；模型时间只用来算 ⚡ 速度（tooltip 写明"仅模型生成时间"）。
 */
import type { Block } from "./Message";
import { turnModelMsOf, turnWallMsOf, type TimedMessage, type TurnSpanLike } from "./turn-duration.ts";

export type SessionTotals = {
  /** 轮次 = 用户消息数 */
  turns: number;
  /** 工具调用总数（全部轮） */
  toolCalls: number;
  /** **墙钟**耗时合计（毫秒）；0 = 没有可统计的耗时 */
  durationMs: number;
  /** 会话累计输入 token（含重发的历史） */
  input: number;
  /** 会话累计输出 token */
  output: number;
  /** 会话累计 token（= 后端 usage.totalTokens，含 cache 与压缩条目） */
  tokens: number;
  /** 平均输出速度（tok/s）：输出 tokens ÷ **纯模型**秒数；无法计算时 undefined */
  avgTokPerSecond?: number;
};

type TotalsInput = TimedMessage & {
  role: "user" | "assistant";
  blocks?: readonly Block[] | undefined;
};

/** 按用户消息切轮（与 `turn-group.ts` 同一规则：用户消息的边界就是轮界）。 */
function spansOf(messages: readonly TotalsInput[]): TurnSpanLike[] {
  const spans: TurnSpanLike[] = [];
  let current: { userIndex: number; replyIndexes: number[] } | undefined;
  messages.forEach((message, index) => {
    if (message.role === "user") {
      current = { userIndex: index, replyIndexes: [] };
      spans.push(current);
      return;
    }
    if (current === undefined) {
      current = { userIndex: -1, replyIndexes: [index] };
      spans.push(current);
      return;
    }
    current.replyIndexes.push(index);
  });
  return spans;
}

/**
 * @param messages 当前会话的全部消息（后端 `messagesOf` 的原样投影）
 * @param usage    后端 `sessionMeta().usage`；没有就只算消息可推导的部分
 */
export function sessionTotalsOf(
  messages: readonly TotalsInput[],
  usage?: { input: number; output: number; totalTokens: number } | undefined,
): SessionTotals {
  let turns = 0;
  let toolCalls = 0;
  for (const message of messages) {
    if (message.role === "user") turns += 1;
    if (message.blocks !== undefined) {
      for (const block of message.blocks) if (block.type === "toolCall") toolCalls += 1;
    }
  }
  const spans = spansOf(messages).filter((span) => span.userIndex >= 0);
  // 墙钟：只累计**已完成**的轮（进行中那轮没有终点，由「当前回合」那一行单独显示），
  // 这样这个数字在跑的过程中不会每秒抖动，且与完成后的一致性不需要额外推理。
  const durationMs = spans.reduce((sum, span) => sum + (turnWallMsOf(messages, span) ?? 0), 0);
  const modelMs = spans.reduce((sum, span) => sum + turnModelMsOf(messages, span), 0);

  const input = usage?.input ?? 0;
  const output = usage?.output ?? 0;
  const tokens = usage?.totalTokens ?? 0;
  const seconds = modelMs / 1000;
  // 平均速度用**输出** tokens（输入是重发历史，和"生成有多快"无关）。
  // 分母是**纯模型时间**（不含工具执行）：否则跑一次 `sleep 20` 会让速度掉到 0.5 tok/s，
  // 那个数字描述的不是模型快慢，是工具快慢。
  // 少于 1 秒不计算：除出来的数字没有意义（会把"0.3 秒写 200 tokens"算成 666 tok/s）。
  const avgTokPerSecond = usage !== undefined && seconds >= 1 && output > 0
    ? output / seconds
    : undefined;
  return {
    turns,
    toolCalls,
    durationMs,
    input,
    output,
    tokens,
    ...(avgTokPerSecond !== undefined ? { avgTokPerSecond } : {}),
  };
}
