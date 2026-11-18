/**
 * 一轮对话的耗时（Task 0015 · P4）—— 纯函数，不碰 DOM、不碰 React。
 *
 * ## 口径来源（不是我们自创，每条都能核）
 *
 * 1. **Pi 官方** `pi/packages/ai/src/types.ts:616-624`：
 *    - `AssistantMessage.timestamp` = "Unix timestamp in milliseconds when the **request started**"
 *    - `durationMs` = "Milliseconds from `timestamp` until the response ended, measured with a monotonic clock"
 *    → 所以 `durationMs` 是**纯模型时间**，**不含工具执行**。
 * 2. **pi-web 上游** `lib/turn-duration.ts`（`upstream/main@f130910`）的 `getTurnDurationMs`：
 *    一轮耗时 = 该轮**用户消息的 timestamp** → 该轮**最后一条 response / toolResult 的 timestamp**。
 *    这是**墙钟**（含工具执行、含网络空档）。
 * 3. **实测补一条我们自己的事实**：session entry 的 `timestamp` 就是「这条消息**结束**的时刻」——
 *    实测某条 assistant：`entry.timestamp = 2026-10-25T11:17:07.689Z` 而
 *    `message.timestamp + durationMs = …:07.688Z`，差 1ms。
 *    （`messagesOf()` 把 entry 时间透出成 `at`，所以 `at` 可以直接当"这条消息结束于何时"。）
 *
 * ## 为什么必须分成两个数
 *
 * 以前我们用 `Σ assistant.durationMs` 当"耗时"，那是**模型时间**，不是墙钟。实测一个含
 * `sleep 6` 的回合：墙钟 34417ms、ΣdurationMs 28323ms —— 差的正是工具执行时间。
 * 于是"跑的时候显示 20s、结束后摘要变 11 秒"，数字往回跳（案例 C004）。
 *
 * 现在只有一个「耗时」= **墙钟**（`turnWallMsOf`），任何地方显示"多久"都用它；
 * 模型时间单独算（`turnModelMsOf`），**只**用于 ⚡ 速度的分母，tooltip 写明"仅模型生成时间"。
 *
 * ## 为什么"进行中"和"完成后"能对上
 *
 * 两者用**同一个锚点**：该轮 user 消息的 `at`。进行中终点取 `now`，完成后终点取该轮最后一条
 * 消息的 `at`（≈ 回合结束时刻）。所以"跑完那一刻看到的秒数"与"摘要里的秒数"必然一致。
 */

/** 块的最小形状：只读 `resultAt`；带索引签名，别的块（text/thinking/image）也能直接传进来。 */
export type TimedBlock = { readonly resultAt?: number | undefined; readonly [key: string]: unknown };

/** 计算只需要这几个字段（不绑前端 Message 类型，便于单测传字面量）。 */
export type TimedMessage = {
  role: string;
  /** 该条消息**结束**的时刻（ms）——来自 session entry 的 timestamp */
  at?: number | undefined;
  /** 该条 assistant 消息的**纯模型时间**（ms） */
  durationMs?: number | undefined;
  /** 块数组：只关心 toolCall 块上挂的"工具结果产生时刻"（后端 `resultAt`），其余块不参与 */
  blocks?: readonly TimedBlock[] | undefined;
};

export type TurnSpanLike = { userIndex: number; replyIndexes: readonly number[] };

/** 时刻（允许 0：epoch 起点在单测里是合法输入；真实时间戳不会是 0）。 */
const timeMs = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;

/** 时长（必须 > 0：0 毫秒与"没有记录"在语义上等价，不该出现在合计里）。 */
const durationMs = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;

const startOf = (message: TimedMessage | undefined): number | undefined => timeMs(message?.at);

/** 该轮内所有消息（含工具结果）里最晚的时刻。 */
function endOf(messages: readonly TimedMessage[], span: TurnSpanLike): number | undefined {
  let end: number | undefined;
  const bump = (value: number | undefined): void => {
    if (value === undefined) return;
    end = end === undefined ? value : Math.max(end, value);
  };
  for (const index of span.replyIndexes) {
    const message = messages[index];
    bump(timeMs(message?.at));
    for (const block of message?.blocks ?? []) bump(timeMs(block.resultAt));
  }
  return end;
}

/**
 * 一轮的墙钟耗时（ms）——**唯一**的"这一轮花了多久"。
 *
 * @param nowMs 进行中的那一轮传 `Date.now()`（终点取现在）；已完成不传（终点取最后一条消息的 at）
 * @returns 该轮没有可用的起点/终点时 `undefined`（老会话缺时间就不编数字）
 */
export function turnWallMsOf(
  messages: readonly TimedMessage[],
  span: TurnSpanLike,
  nowMs?: number,
): number | undefined {
  const startMs = startOf(messages[span.userIndex]);
  if (startMs === undefined) return undefined;
  const end = nowMs ?? endOf(messages, span);
  if (end === undefined) return undefined;
  return Math.max(0, end - startMs);
}

/**
 * 一轮的**模型时间**（ms）= Σ 该轮 assistant 消息的 `durationMs`。
 * **只**给 ⚡ 速度当分母；不要拿它当"耗时"（见文件头）。
 */
export function turnModelMsOf(messages: readonly TimedMessage[], span: TurnSpanLike): number {
  let total = 0;
  for (const index of span.replyIndexes) {
    total += durationMs(messages[index]?.durationMs) ?? 0;
  }
  return total;
}



/**
 * 最后一个用户消息的 `at`（ms）——进行中那一轮的**起点锚点**。
 *
 * 为什么不用服务端 `running[].startedAt`：那个是"受理时刻"，与本轮 user 消息的 `at`
 * 实测差 ~15ms。凑合能用，但"进行中"与"完成后的摘要"必须用**同一个**锚点才不会出现
 * 1 秒的跳变，所以优先取这个。
 */
export function lastUserAtMs(messages: readonly TimedMessage[]): number | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === "user") return timeMs(message.at);
  }
  return undefined;
}
