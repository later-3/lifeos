/**
 * 工具块的展示状态（纯函数，便于单测）。
 *
 * 关键区分：`result === undefined` 有两种含义——
 * - 这一轮**正在跑**（live）：真正的"执行中"；
 * - 这一轮**已经结束**（非 live）：没有拿到结果 = 未完成（被中断/失败），不能继续转圈。
 * 之前只按 `result === undefined` 判断，历史里没配到结果的调用会永远"执行中"（实测的 bug）。
 */
export type ToolState = "running" | "error" | "done" | "missing";

export function toolState(input: { hasResult: boolean; isError?: boolean; live: boolean }): ToolState {
  if (input.hasResult) return input.isError === true ? "error" : "done";
  return input.live ? "running" : "missing";
}
