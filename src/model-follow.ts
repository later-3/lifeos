// "会话模型是否跟随 Agent 默认"的判定（纯函数）。
//
// 用户规则（2026-10-20）：**没用过 `/model` 的会话，模型就是默认模型；默认变了必须跟着变。**
// 判定只认**显式覆盖标记**（`/model` 写入的 `lifeos_model_override`，不含 legacy 标记）：
// - 有显式标记 → 保留用户选择；
// - 没有 → 一律跟随当前默认（Pi 的 `model_change` 本身不区分"默认/用户换过"，不能拿值去猜）。
//
// 曾尝试"旧会话模型 != 默认就当成用户覆盖"来保护旧选择——实测直接违背用户预期：
// 改默认后旧会话被打了 legacy 标记，永远不再跟随。已删除。
import type { ModelRef } from "./model-follow-types.ts";

export type { ModelRef } from "./model-follow-types.ts";

export type RestoreDecision = "keep" | "follow";

const same = (a: ModelRef, b: ModelRef): boolean => a.provider === b.provider && a.id === b.id;

export function decideRestoreModel(input: {
  /** 会话文件里最后一次 model_change */
  stored: ModelRef | undefined;
  /** 当前 Agent 默认 */
  agentDefault: ModelRef | undefined;
  /** 用户是否用 `/model` 显式覆盖过 */
  overridden: boolean;
}): RestoreDecision {
  if (input.overridden) return "keep";                                    // 用户显式换过 → 不动
  if (input.stored === undefined || input.agentDefault === undefined) return "keep";
  return same(input.stored, input.agentDefault) ? "keep" : "follow";       // 没换过 → 跟随默认
}
