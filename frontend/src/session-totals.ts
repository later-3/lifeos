/**
 * 会话累计事实（Task 0008 · P3 修订）—— 纯函数，不碰 DOM。
 *
 * 用户 2026-11-05："现在的 turnstat bar，就可以把一些信息换为累计的信息，比如
 * **共计多少轮次，共计多少工具调用，时间，token 消耗，平均速度**"。
 *
 * 为什么单独成文件：这些数字要能被单测锁住（口径一旦漂，界面上没人看得出对错），
 * 而后端 `sessionMeta` 的 usage 与消息列表是两份来源，合算规则只能有一处。
 *
 * **口径**（每个数字怎么来的，写死在测试里）：
 * | 项 | 来源 | 口径 |
 * |---|---|---|
 * | 轮次 | 消息列表 | `role === "user"` 的条数（一条用户消息 = 一轮） |
 * | 工具调用 | 消息块的 `type === "toolCall"` | 全部轮的合计（含正在跑的那一轮） |
 * | 时长 | 每条 assistant 消息的 `durationMs` | **生成耗时合计**，不是墙钟跨度（挂机时间不算） |
 * | token | `meta.usage`（后端 `sessionUsage`） | 会话累计，含 cacheRead/cacheWrite 与压缩条目 |
 * | 平均速度 | usage.output / 时长秒 | 会话级平均，与"上一轮速度"不同口径 |
 */
import type { Block } from "./Message";

export type SessionTotals = {
  /** 轮次 = 用户消息数 */
  turns: number;
  /** 工具调用总数（全部轮） */
  toolCalls: number;
  /** 生成耗时合计（毫秒）；0 = 没有可统计的耗时 */
  durationMs: number;
  /** 会话累计输入 token（含重发的历史） */
  input: number;
  /** 会话累计输出 token */
  output: number;
  /** 会话累计 token（= 后端 usage.totalTokens，含 cache 与压缩条目） */
  tokens: number;
  /** 平均输出速度（tok/s）：输出 tokens ÷ 生成秒数；无法计算时 undefined */
  avgTokPerSecond?: number;
};

type TotalsInput = {
  role: "user" | "assistant";
  blocks?: readonly Block[] | undefined;
  durationMs?: number | undefined;
};

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
  let durationMs = 0;
  for (const message of messages) {
    if (message.role === "user") turns += 1;
    if (message.blocks !== undefined) {
      for (const block of message.blocks) if (block.type === "toolCall") toolCalls += 1;
    }
    if (typeof message.durationMs === "number" && Number.isFinite(message.durationMs) && message.durationMs > 0) {
      durationMs += message.durationMs;
    }
  }
  const input = usage?.input ?? 0;
  const output = usage?.output ?? 0;
  const tokens = usage?.totalTokens ?? 0;
  const seconds = durationMs / 1000;
  // 平均速度用**输出** tokens（输入是重发历史，和"生成有多快"无关）。
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
