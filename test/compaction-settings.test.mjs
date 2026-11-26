// 压缩阈值契约（Task 0041 · D4）。纯函数，不碰网络、不读盘、不依赖真模型。
//
// 覆盖：
//   · 公式 max(round(窗口 × 0.15), 32000) 在真实模型清单的窗口上逐个核对；
//   · `modelOverrides` 的键必须与 Pi 一致（写错会静默不生效）；
//   · 合并进 settings.json 时只接管 compaction.modelOverrides，其余原样保留；
//   · 边界：窗口未知 / 0 / 负数 / 非有限数 → 不生成条目（回落 Pi 默认，不猜）。
import assert from "node:assert/strict";
import test from "node:test";
import {
  compactionOverridesOf,
  mergeCompactionOverrides,
  modelOverrideKeyOf,
  reserveTokensOf,
  shouldWriteOverrides,
  RESERVE_FLOOR,
  RESERVE_SHARE,
} from "../src/compaction-settings.ts";

test("公式：窗口 × 15%，低于 32000 时取 32000", () => {
  // 常量自检（改常量必须同时改这里，否则测试变红）
  assert.equal(RESERVE_SHARE, 0.15);
  assert.equal(RESERVE_FLOOR, 32_000);

  assert.equal(reserveTokensOf(1_000_000), 150_000);
  assert.equal(reserveTokensOf(1_050_000), 157_500);
  assert.equal(reserveTokensOf(500_000), 75_000);
  assert.equal(reserveTokensOf(262_144), 39_322); // 39321.6 → round
  // 小窗口：15% 只有 11,520，被 32,000 下限接管
  assert.equal(reserveTokensOf(76_800), 32_000);
  assert.equal(reserveTokensOf(200_000), 32_000); // 15% = 30,000 < 32,000
  assert.equal(reserveTokensOf(213_334), 32_000); // 15% = 32,000.1 → 32000
  assert.equal(reserveTokensOf(240_000), 36_000); // 15% > 下限，取下限以外的值
});

test("窗口未知时不编造数字（回落 Pi 默认，而不是猜）", () => {
  assert.equal(reserveTokensOf(undefined), undefined);
  assert.equal(reserveTokensOf(0), undefined);
  assert.equal(reserveTokensOf(-1), undefined);
  assert.equal(reserveTokensOf(Number.NaN), undefined);
  assert.equal(reserveTokensOf(Number.POSITIVE_INFINITY), undefined);
});

test("modelOverrides 的键必须与 Pi 一致（写错只静默不生效）", () => {
  // 依据：pi settings-manager.js:660 → `${model.provider}/${model.id}`
  assert.equal(modelOverrideKeyOf({ provider: "amr-link-joey", id: "deepseek-v4.1-flash" }),
    "amr-link-joey/deepseek-v4.1-flash");
});

test("生成补丁：真实模型清单的窗口逐个核对", () => {
  const patch = compactionOverridesOf([
    { provider: "local-3090", id: "coder390-27b", contextWindow: 76_800 },
    { provider: "local-flashnext", id: "qwen3.8-flash-next-iq3_s", contextWindow: 262_144 },
    { provider: "xai", id: "grok-4.7", contextWindow: 500_000 },
    { provider: "amr-link-joey", id: "deepseek-v4.1-flash", contextWindow: 1_000_000 },
    { provider: "command", id: "gpt-6-luna", contextWindow: 1_050_000 },
  ]);
  assert.deepEqual(patch.modelOverrides, {
    "local-3090/coder390-27b": { reserveTokens: 32_000 },
    "local-flashnext/qwen3.8-flash-next-iq3_s": { reserveTokens: 39_322 },
    "xai/grok-4.7": { reserveTokens: 75_000 },
    "amr-link-joey/deepseek-v4.1-flash": { reserveTokens: 150_000 },
    "command/gpt-6-luna": { reserveTokens: 157_500 },
  });
});

test("生成补丁：窗口未知的模型被跳过，不产出条目", () => {
  const patch = compactionOverridesOf([
    { provider: "p", id: "unknown-window" },
    { provider: "p", id: "zero-window", contextWindow: 0 },
    { provider: "p", id: "ok", contextWindow: 1_000_000 },
  ]);
  assert.deepEqual(Object.keys(patch.modelOverrides), ["p/ok"]);
});

test("生成补丁：空列表 → 空对象，调用方据此跳过写盘", () => {
  const patch = compactionOverridesOf([]);
  assert.deepEqual(patch.modelOverrides, {});
  assert.equal(shouldWriteOverrides(patch), false);
  assert.equal(shouldWriteOverrides(compactionOverridesOf([{ provider: "p", id: "m", contextWindow: 1_000_000 }])), true);
});

test("生成补丁：同键重复时后者覆盖（与 Pi 合并顺序一致）", () => {
  const patch = compactionOverridesOf([
    { provider: "p", id: "m", contextWindow: 200_000 },
    { provider: "p", id: "m", contextWindow: 1_000_000 },
  ]);
  assert.deepEqual(patch.modelOverrides, { "p/m": { reserveTokens: 150_000 } });
});

test("合并：只接管 compaction.modelOverrides，其余字段原样保留", () => {
  const existing = {
    theme: "dark",
    retry: { enabled: true, maxRetries: 3 },
    compaction: {
      enabled: true,
      keepRecentTokens: 20_000,
      reserveTokens: 16_384,
      modelOverrides: { "old/model": { reserveTokens: 9_999 } },
    },
    unrelated: [1, 2, 3],
  };
  const merged = mergeCompactionOverrides(existing, {
    modelOverrides: { "new/model": { reserveTokens: 150_000 } },
  });

  // 顶层其他字段全部保留
  assert.equal(merged.theme, "dark");
  assert.deepEqual(merged.retry, { enabled: true, maxRetries: 3 });
  assert.deepEqual(merged.unrelated, [1, 2, 3]);
  // compaction 里的其他字段也保留（用户可能显式设过通用值）
  const compaction = merged.compaction;
  assert.equal(compaction.enabled, true);
  assert.equal(compaction.keepRecentTokens, 20_000);
  assert.equal(compaction.reserveTokens, 16_384);
  // modelOverrides 被整体替换（我们的补丁是"当前模型清单的完整集合"）
  assert.deepEqual(compaction.modelOverrides, { "new/model": { reserveTokens: 150_000 } });
});

test("合并：输入不是对象时不崩，产出最小结构", () => {
  for (const bad of [undefined, null, 42, "x", [1, 2]]) {
    const merged = mergeCompactionOverrides(bad, { modelOverrides: { "p/m": { reserveTokens: 150_000 } } });
    assert.deepEqual(merged.compaction, { modelOverrides: { "p/m": { reserveTokens: 150_000 } } });
  }
});

test("合并：已有 compaction 不是对象时也不崩", () => {
  const merged = mergeCompactionOverrides({ compaction: "broken" }, { modelOverrides: { "p/m": { reserveTokens: 1 } } });
  assert.deepEqual(merged.compaction.modelOverrides, { "p/m": { reserveTokens: 1 } });
});

test("合并是纯函数：不修改传入对象", () => {
  const existing = { compaction: { enabled: true, modelOverrides: { "a/b": { reserveTokens: 1 } } } };
  const snapshot = JSON.parse(JSON.stringify(existing));
  mergeCompactionOverrides(existing, { modelOverrides: { "c/d": { reserveTokens: 2 } } });
  assert.deepEqual(existing, snapshot);
});

// 活性自检（testing.md 2.4）：把实现改回"固定 16384"必须让本文件变红。
// 这条断言的作用是：如果哪天有人把 reserveTokensOf 改成返回常量，上面的公式测试会先红；
// 而这条额外锁住"大窗口的余量必须随窗口增长"这个语义。
test("活性：大窗口的余量必须随窗口增长（不能是固定值）", () => {
  const small = reserveTokensOf(1_000_000);
  const large = reserveTokensOf(2_000_000);
  assert.ok(small !== undefined && large !== undefined);
  assert.ok(large > small, "窗口翻倍时余量必须增长，固定值实现会在这里变红");
  assert.equal(large - small, 150_000);
});
