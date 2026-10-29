// 请求体上限解析（Task 0012 · P1）。纯函数，不碰网络、不读盘。
// 覆盖 02-design §3.4 的四层解析顺序 + 已拍板的 2.5MB/1.2MB 推导 + 防过拟合硬规则。
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  BAND_BYTES, deriveBudget, observedLimit, parseConfig, parseState, readLimits, recordObservation,
  resolveBudget, resolveLimit, RESERVE_BYTES, SLACK_BYTES,
} from "../src/payload-limit.ts";

test("3.5MB 上限推导出已拍板的 2.5MB / 1.2MB（D4）", () => {
  const budget = resolveBudget({ providerId: "p1", config: { schemaVersion: 1, providers: { p1: { maxRequestBytes: 3_500_000 } } } });
  assert.ok(budget !== undefined);
  assert.equal(budget.triggerBytes, 2_500_000);
  assert.equal(budget.targetBytes, 1_200_000);
  assert.equal(budget.source, "provider");
  assert.equal(budget.keepRecent, 2);
  assert.equal(budget.undersized, false);
  // 公式自检：trigger = limit − reserve − slack；target = trigger − band
  assert.equal(budget.triggerBytes, 3_500_000 - RESERVE_BYTES - SLACK_BYTES);
  assert.equal(budget.targetBytes, budget.triggerBytes - BAND_BYTES);
});

test("解析顺序：**事实（新鲜拒绝）优先于声明**；声明之间 model > provider", () => {
  const config = { schemaVersion: 1, providers: { p1: { maxRequestBytes: 3_500_000 } } };
  const state = { schemaVersion: 1, observed: { p1: { minRejectedBytes: 3_600_000 } } };
  // 三层都在 → 拒绝观测（3.6MB × 0.8）胜过 model 的 10M（事实 > 声明）
  assert.deepEqual(resolveLimit({ modelLimit: 10_000_000, providerId: "p1", config, state }), { maxRequestBytes: 2_880_000, source: "observed" });
  // 去掉 model → 观测仍胜 provider
  assert.deepEqual(resolveLimit({ providerId: "p1", config, state }), { maxRequestBytes: 2_880_000, source: "observed" });
  // 去掉 provider 配置 → 观测自己就是来源
  assert.deepEqual(resolveLimit({ providerId: "p1", config: { schemaVersion: 1, providers: {} }, state }), { maxRequestBytes: 2_880_000, source: "observed" });
  // 没有观测 → 恢复 model > provider
  const empty = { schemaVersion: 1, observed: {} };
  assert.deepEqual(resolveLimit({ modelLimit: 10_000_000, providerId: "p1", config, state: empty }), { maxRequestBytes: 10_000_000, source: "model" });
  assert.deepEqual(resolveLimit({ providerId: "p1", config, state: empty }), { maxRequestBytes: 3_500_000, source: "provider" });
});

test("没有任何来源 → undefined（不猜数字）", () => {
  assert.equal(resolveLimit({ providerId: "unknown" }), undefined);
  assert.equal(resolveBudget({ providerId: "unknown" }), undefined);
  // 非法值也算未声明
  assert.equal(resolveLimit({ providerId: "unknown", modelLimit: 0 }), undefined);
  assert.equal(resolveLimit({ providerId: "unknown", modelLimit: Number.NaN }), undefined);
});

test("换 provider 只是数据变，公式不变（网关更大 → 淘汰更少）", () => {
  const cases = [
    { limit: 3_500_000, trigger: 2_500_000, target: 1_200_000 },
    { limit: 10_000_000, trigger: 9_000_000, target: 7_700_000 },
    { limit: 26_214_400, trigger: 25_214_400, target: 23_914_400 },
  ];
  for (const item of cases) {
    const budget = deriveBudget({ maxRequestBytes: item.limit, source: "provider" });
    assert.equal(budget.triggerBytes, item.trigger, `limit ${item.limit}`);
    assert.equal(budget.targetBytes, item.target, `limit ${item.limit}`);
    assert.equal(budget.undersized, false);
  }
});

test("上限小到装不下 reserve+slack+band → undersized（要告警，不静默）", () => {
  const budget = deriveBudget({ maxRequestBytes: 1_000_000, source: "provider" });
  assert.equal(budget.triggerBytes, 0);
  assert.equal(budget.targetBytes, 0);
  assert.equal(budget.undersized, true);
});

test("坏 config/state 一律当空，不抛", () => {
  for (const bad of [undefined, null, 0, "x", [], { providers: [] }, { providers: { p1: 1 } }]) {
    assert.deepEqual(parseConfig(bad), { schemaVersion: 1, providers: {} });
  }
  for (const bad of [undefined, null, 0, "x", [], { observed: [] }, { observed: { p1: { minRejectedBytes: -1 } } }]) {
    assert.deepEqual(parseState(bad), { schemaVersion: 1, observed: {} });
  }
  // 合法输入保留
  assert.deepEqual(parseConfig({ providers: { p1: { maxRequestBytes: 123 } } }), { schemaVersion: 1, providers: { p1: { maxRequestBytes: 123 } } });
});

test("观测记账：成功涨下界、被拒压上界、可重复", () => {
  let state = parseState({});
  state = recordObservation(state, { providerId: "p1", bodyBytes: 2_400_000, outcome: "ok", at: "2026-10-28T00:00:00Z" });
  state = recordObservation(state, { providerId: "p1", bodyBytes: 2_000_000, outcome: "ok", at: "2026-10-28T00:01:00Z" });
  assert.equal(state.observed.p1?.maxBodyBytes, 2_400_000);   // 不被更小的成功覆盖
  state = recordObservation(state, { providerId: "p1", bodyBytes: 3_600_000, outcome: "too_large", at: "2026-10-28T00:02:00Z" });
  state = recordObservation(state, { providerId: "p1", bodyBytes: 9_000_000, outcome: "too_large", at: "2026-10-28T00:03:00Z" });
  assert.equal(state.observed.p1?.minRejectedBytes, 3_600_000); // 取更小的"被拒字节"
  assert.equal(observedLimit(state.observed.p1), 2_880_000);
  // 非法字节数不写入
  assert.deepEqual(recordObservation(state, { providerId: "p1", bodyBytes: 0, outcome: "ok" }), state);
});

test("防过拟合：源码里不出现 provider 名与具体网关数值", () => {
  const source = readFileSync(new URL("../src/payload-limit.ts", import.meta.url), "utf8");
  // 允许出现在注释里解释"不要写"，所以只在赋值/字面量上下文里查
  assert.equal(/3_?500_?000/.test(source), false, "320/3.5MB 这类网关数值不得写进代码");
  assert.equal(/\bcommand\b/.test(source), false, "不得出现 provider 名");
  assert.equal(/\bdeepseek\b|\bglm\b|\bcommandcode\b/i.test(source), false, "不得出现 provider 名");
});

test("readLimits：读家目录两个文件；缺失/坏文件当空（配置缺失不能让会话不可用）", async () => {
  const home = mkdtempSync(join(tmpdir(), "lifeos-limits-"));
  // 什么都还没有 → 空
  const empty = await readLimits(home);
  assert.deepEqual(empty, { config: { schemaVersion: 1, providers: {} }, state: { schemaVersion: 1, observed: {} } });

  mkdirSync(join(home, "config"), { recursive: true });
  mkdirSync(join(home, "state"), { recursive: true });
  writeFileSync(join(home, "config", "payload-limits.json"), JSON.stringify({ providers: { p1: { maxRequestBytes: 3_500_000 } } }));
  writeFileSync(join(home, "state", "payload-limits.json"), JSON.stringify({ observed: { p1: { minRejectedBytes: 3_600_000 } } }));
  const loaded = await readLimits(home);
  assert.equal(loaded.config.providers.p1?.maxRequestBytes, 3_500_000);
  assert.equal(loaded.state.observed.p1?.minRejectedBytes, 3_600_000);

  // 坏 JSON → 当空，不抛
  writeFileSync(join(home, "config", "payload-limits.json"), "{ not json");
  assert.deepEqual((await readLimits(home)).config, { schemaVersion: 1, providers: {} });
});

test("事实优先于声明：新鲜的 413 观测会把已声明的上限收紧", () => {
  const now = Date.parse("2026-10-29T00:00:00Z");
  const state = { schemaVersion: 1, observed: { p1: { minRejectedBytes: 4_000_000, updatedAt: "2026-10-28T12:00:00Z" } } };
  const config = { schemaVersion: 1, providers: { p1: { maxRequestBytes: 3_500_000 } } };
  // 观测 4M ×0.8 = 3.2M < 声明 3.5M → 用 3.2M，来源标 observed
  const tightened = resolveLimit({ providerId: "p1", config, state, now });
  assert.deepEqual(tightened, { maxRequestBytes: 3_200_000, source: "observed" });
  // 曾拒过 2M → 墙 ≤2M → 有效上限 1.6M（更紧）。拒绝只会收紧，永远不会把上限放大
  const tighter = resolveLimit({ providerId: "p1", config, state: { schemaVersion: 1, observed: { p1: { minRejectedBytes: 2_000_000, updatedAt: "2026-10-28T12:00:00Z" } } }, now });
  assert.deepEqual(tighter, { maxRequestBytes: 1_600_000, source: "observed" });
  // 观测过期（网关可能已升级）→ 不再用它收紧
  const stale = resolveLimit({ providerId: "p1", config, state, now: Date.parse("2026-11-29T00:00:00Z") });
  assert.deepEqual(stale, { maxRequestBytes: 3_500_000, source: "provider" });
});

test("成功越过曾经的拒绝值 → 拒绝记录作废（墙变了）", () => {
  let state = parseState({ observed: { p1: { minRejectedBytes: 4_000_000, maxBodyBytes: 3_900_000, updatedAt: "2026-10-28T12:00:00Z" } } });
  state = recordObservation(state, { providerId: "p1", bodyBytes: 5_000_000, outcome: "ok" });
  assert.equal(state.observed.p1.minRejectedBytes, undefined, "成功发出去 5MB > 曾拒的 4MB → 墙不在了");
  assert.equal(state.observed.p1.maxBodyBytes, 5_000_000);
});
