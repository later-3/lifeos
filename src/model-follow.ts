// "会话模型是否跟随 Agent 默认"的判定（纯函数，便于穷举测试）。
//
// 事实与约束：
// - Pi 让 `model_change` 持久化在会话里，但**不区分**"这是默认"还是"用户显式换过"；
// - `/model` 会写自定义条目 `lifeos_model_override` 作为显式标记；
// - 新会话创建时写 `lifeos_default_model`（记录"当时的默认"），用来区分
//   "默认后来变了"（应跟随）与"用户自己换过"（应保留）。

export type ModelRef = { provider: string; id: string };
export type RestoreDecision = "keep" | "follow" | "mark_override";

const same = (a: ModelRef | undefined, b: ModelRef | undefined): boolean =>
  a !== undefined && b !== undefined && a.provider === b.provider && a.id === b.id;

export function decideRestoreModel(input: {
  /** 会话文件里最后一次 model_change */
  stored?: ModelRef;
  /** 创建/上次跟随时记录的默认模型 */
  recordedDefault?: ModelRef;
  /** 当前 Agent 默认 */
  agentDefault?: ModelRef;
  /** 用户是否用 `/model` 显式覆盖过 */
  overridden: boolean;
}): RestoreDecision {
  if (input.overridden) return "keep";
  if (input.stored === undefined || input.agentDefault === undefined) return "keep";   // 没有默认可用 → 不动
  if (same(input.stored, input.agentDefault)) return "keep";          // 已经就是默认
  if (same(input.stored, input.recordedDefault)) return "follow";     // 曾跟随默认，默认变了
  if (input.recordedDefault === undefined && input.agentDefault !== undefined) return "mark_override"; // 旧会话：保护旧选择
  return "mark_override";                                            // 与记录不符：视为覆盖
}
