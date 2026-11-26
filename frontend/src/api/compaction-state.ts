/**
 * 压缩状态派生（Task 0041 · P2 / S5）。
 *
 * ## 为什么要有这个模块
 *
 * Pi 会发 `compaction_start` / `compaction_end`（`agent-session.d.ts:62-82`），但 Life OS 此前
 * **完全没接**——压缩对用户不可见。实测代价（Task 0041 `01-background.md` §2）：
 * 一个会话因为该压不压，连续 6 轮回复被截断（`write` 工具参数被切、界面显示"0 字符"），
 * 而用户唯一看到的是"回复被截断（达到输出上限）"，**完全不知道是压缩没发生**。
 *
 * ## 为什么是纯函数
 *
 * 呈现层只消费派生事实（`specs/code/frontend/code.md` 2.10 / 2.13）：组件不判断事件语义。
 * 这个模块回答唯一一个问题：**现在该显示什么压缩状态**。
 *
 * ## 三态（`frontend/code.md` 2.32 的同一条道理）
 *
 * - `idle`：没有压缩在跑，也没有刚失败（什么都不显示）
 * - `running`：正在压缩（显示"正在压缩上下文…"，带 reason）
 * - `failed`：上一次压缩失败（显示原因 + 重试出口）
 *
 * **成功不单独成为一态**：压缩成功后 Pi 会在会话里落一条 compaction entry，
 * 历史里由 `CompactionCard` 呈现（`views/Message.tsx:523`）。状态条只负责"正在发生/刚失败"，
 * 两者职责不重叠——避免同一件事在一屏里说两遍。
 */

/** 压缩原因，与 Pi 的 `compaction_start.reason` 一致（不做我们自己的一套词）。 */
export type CompactionReason = "manual" | "threshold" | "overflow";

/** 进入这个模块的事件形状（由 `stream-events.ts` 的 `toStreamEvent` 产出）。 */
export type CompactionEvent = {
  type: "compaction";
  phase: "start" | "end";
  reason: CompactionReason;
  overflow?: boolean | undefined;
  ok?: boolean | undefined;
  aborted?: boolean | undefined;
  errorMessage?: string | undefined;
  tokensBefore?: number | undefined;
};

export type CompactionState =
  | { kind: "idle" }
  | { kind: "running"; reason: CompactionReason; overflow: boolean }
  | { kind: "failed"; reason: CompactionReason; message: string };

/** 初始状态（组件挂载时用它，不要用 `undefined` 兼作"未就绪"）。 */
export const IDLE_COMPACTION: CompactionState = { kind: "idle" };

/**
 * 一条压缩事件 → 新状态。
 *
 * 规则：
 * - `start` → `running`（带 reason；overflow 单独标记，因为那意味着"前面已经出过问题"）
 * - `end` + ok → **`idle`**（成功不常显；结果在历史卡片里）
 * - `end` + aborted → **`idle`**（用户主动打断不是失败，不该报错——与 `failure.ts` 的 aborted 同口径）
 * - `end` + 失败 → `failed`（带原因；没有原因时给一句可行动的兜底）
 *
 * 幂等：重复收到同一事件结果不变（重连重放是常态，`testing.md` 2.8）。
 */
export function applyCompactionEvent(previous: CompactionState, event: CompactionEvent): CompactionState {
  if (event.phase === "start") {
    return { kind: "running", reason: event.reason, overflow: event.overflow === true };
  }
  // phase === "end"
  if (event.ok === true) return IDLE_COMPACTION;
  if (event.aborted === true) return IDLE_COMPACTION;
  const message = typeof event.errorMessage === "string" && event.errorMessage.trim() !== ""
    ? event.errorMessage.trim()
    : FALLBACK_FAILURE_MESSAGE;
  return { kind: "failed", reason: event.reason, message };
}

/**
 * 失败但没有原因时的兜底文案。
 *
 * 为什么要有：Pi 的 `compaction_end` 在 `aborted` 时不给 `errorMessage`，
 * 而某些异常路径也可能漏给。此时不能显示空白（`frontend/code.md` 2.32：未就绪/失败都要有话说）。
 */
export const FALLBACK_FAILURE_MESSAGE = "压缩失败，但没有返回原因";

/** 原因 → 用户能读懂的一句话（不暴露 Pi 的内部枚举名）。 */
export function reasonTextOf(reason: CompactionReason): string {
  switch (reason) {
    case "manual": return "手动触发";
    case "threshold": return "上下文接近上限";
    case "overflow": return "上一轮已溢出";
  }
}

/** 状态条要显示的主文案；`idle` 返回 undefined（调用方据此不渲染）。 */
export function compactionLabelOf(state: CompactionState): string | undefined {
  if (state.kind === "idle") return undefined;
  if (state.kind === "running") {
    return state.overflow
      ? "正在压缩上下文（上一轮已溢出）…"
      : "正在压缩上下文…";
  }
  return `压缩失败：${state.message}`;
}

/**
 * 批量套用事件（流式消费用）。
 *
 * 只处理 `type === "compaction"` 的事件，其余原样跳过 —— 调用方可以把整条事件流丢进来。
 */
export function reduceCompactionEvents(events: readonly unknown[]): CompactionState {
  let state: CompactionState = IDLE_COMPACTION;
  for (const event of events) {
    if (!isCompactionEvent(event)) continue;
    state = applyCompactionEvent(state, event);
  }
  return state;
}

function isCompactionEvent(value: unknown): value is CompactionEvent {
  if (typeof value !== "object" || value === null) return false;
  const event = value as { type?: unknown; phase?: unknown; reason?: unknown };
  if (event.type !== "compaction") return false;
  if (event.phase !== "start" && event.phase !== "end") return false;
  return event.reason === "manual" || event.reason === "threshold" || event.reason === "overflow";
}
