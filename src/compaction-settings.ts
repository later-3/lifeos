// 压缩阈值契约（Task 0041 · D4）：把「上下文窗口 → reserveTokens」变成一处可测试的纯函数。
//
// 为什么需要它（01-background §9）：Pi 的 `reserveTokens` 默认固定 **16384**，占窗口的比例
// 从 76,800 窗口的 **21.3%** 到 1,000,000 窗口的 **1.6%** —— 两端都不合适：
//   · 小窗口：21% 被白留，可用预算不足一半；
//   · 大窗口：1.6% 完全挡不住估算误差（实测该会话低估 8.2%，即 81,279 token），
//     于是"该压缩时没压缩"，输出上限被 `clampMaxTokensToContext` 压到 641，回复必然截断。
//
// 为什么是 15%（D4 拍板，用户 2026-11-26）：
//   1. 成本已排除：实测摘要成本 $0.1688/次，而真实每轮只增长中位 535 token
//      （59,764 个真实轮次），跑 100 轮也只压缩 0.4–4 次 → 100 轮成本 $0.06–0.68（01-background §10.9）；
//   2. 摘要质量：余量越小，摘要请求越容易被 `clampMaxTokensToContext` 压小；
//   3. 失败风险：余量越小，越容易撞上估算误差；
//   4. 与 opencode 的 `RESERVE_SHARE = 0.15` 一致（`packages/core/src/session/compaction.ts:135`），
//      它那条常数有 p99 实测支撑（单步最多增 22k），而我们实测 max 达 237,240 —— 更需要余量。
//
// 为什么有 32,000 的下限：76,800 窗口的 15% 只有 11,520，挡不住实测的 8–10% 估算误差
// （同一份背景文档 §8）。下限保证小窗口模型也有可用的安全垫。
//
// 硬规则：本文件不出现 provider 名、不出现具体窗口数值（数值只出现在常量与断言里）。

/**
 * 预留比例（对应 opencode 的 `RESERVE_SHARE`，见文件头）。
 * 15% ⇒ 上下文用到 85% 时压缩。
 */
export const RESERVE_SHARE = 0.15;

/**
 * 预留下限（token）。
 *
 * 32,000 的来历：实测估算误差 p90 约 8–10%（01-background §8），而 76,800 窗口的 15% 只有 11,520，
 * 不足以覆盖；32,000 在 76,800 窗口上余 41.7%，在 262,144 上余 12.2%（此时 15% = 39,321 已经更大）。
 * 该下限只在**小窗口**生效，不影响大窗口（大窗口取 15%）。
 */
export const RESERVE_FLOOR = 32_000;

/** 一个模型的最小描述：只关心算阈值需要的两个字段。 */
export type CompactionModelInput = {
  /** `<provider>/<modelId>` 之外的部分：Pi 的 `modelOverrides` 键是 `${provider}/${id}`。 */
  provider: string;
  id: string;
  /** 上下文窗口（token）。<= 0 或缺失表示未知，不生成覆盖（回落 Pi 默认）。 */
  contextWindow?: number;
};

/** `settings.json` 里 `compaction` 段的形状（只写我们拥有的部分）。 */
export type CompactionSettingsPatch = {
  modelOverrides: Record<string, { reserveTokens: number }>;
};

/**
 * 窗口 → 预留 token 数。
 *
 * 公式：`max(round(window × 0.15), 32000)`（D4）。
 * 窗口未知（<= 0 / 非有限数）时返回 `undefined` —— 由调用方决定回落 Pi 默认，
 * 不在这里编一个数字（`backend/code.md` 2.9：不静默编造）。
 */
export function reserveTokensOf(contextWindow: number | undefined): number | undefined {
  if (contextWindow === undefined) return undefined;
  if (!Number.isFinite(contextWindow)) return undefined;
  if (contextWindow <= 0) return undefined;
  const share = Math.round(contextWindow * RESERVE_SHARE);
  return Math.max(share, RESERVE_FLOOR);
}

/**
 * 模型的 `modelOverrides` 键。
 *
 * 必须与 Pi 一致：`settings-manager.js:660` 是 `` `${model.provider}/${model.id}` ``。
 * 写错这个键不会报错，只会**静默不生效**（回到默认 16384）——所以单独抽出来并有测试。
 */
export function modelOverrideKeyOf(model: CompactionModelInput): string {
  return `${model.provider}/${model.id}`;
}

/**
 * 为一批模型生成 `compaction.modelOverrides` 补丁。
 *
 * 边界：
 * · 窗口未知的模型**不生成**条目（回落 Pi 默认，而不是猜一个）；
 * · 同一键重复出现时后者覆盖前者（与 Pi 的合并顺序一致：列表靠后的定义生效）；
 * · 空列表 → 空对象（调用方据此跳过写盘）。
 */
export function compactionOverridesOf(models: readonly CompactionModelInput[]): CompactionSettingsPatch {
  const modelOverrides: Record<string, { reserveTokens: number }> = {};
  for (const model of models) {
    const reserveTokens = reserveTokensOf(model.contextWindow);
    if (reserveTokens === undefined) continue;
    modelOverrides[modelOverrideKeyOf(model)] = { reserveTokens };
  }
  return { modelOverrides };
}

/**
 * 合并一个补丁到已有的 `settings.json` 内容。
 *
 * 目的（`backend/code.md` 2.4「不覆盖已有」）：用户可能在 `settings.json` 里手改过别的字段
 * （主题、retry、branchSummary…），我们**只接管 `compaction.modelOverrides`**，其余原样保留。
 *
 * 注意：`compaction` 里的**其他字段**（`enabled` / 通用 `reserveTokens` / `keepRecentTokens`）
 * 也原样保留 —— 用户可能显式设过通用值，我们不应该抹掉它。
 */
export function mergeCompactionOverrides(
  existing: unknown,
  patch: CompactionSettingsPatch,
): Record<string, unknown> {
  const base: Record<string, unknown> =
    typeof existing === "object" && existing !== null && !Array.isArray(existing)
      ? { ...(existing as Record<string, unknown>) }
      : {};

  const currentCompaction =
    typeof base.compaction === "object" && base.compaction !== null && !Array.isArray(base.compaction)
      ? { ...(base.compaction as Record<string, unknown>) }
      : {};

  return {
    ...base,
    compaction: {
      ...currentCompaction,
      modelOverrides: patch.modelOverrides,
    },
  };
}

/**
 * 是否需要写盘：补丁为空且文件里也没有这一段时跳过（避免每次启动都改文件 mtime）。
 */
export function shouldWriteOverrides(patch: CompactionSettingsPatch): boolean {
  return Object.keys(patch.modelOverrides).length > 0;
}
