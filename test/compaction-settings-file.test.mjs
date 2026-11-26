// 压缩阈值写盘（Task 0041 · S2）。只读临时家目录，不碰真实用户数据。
//
// 覆盖：
//   · 文件不存在时创建，内容是 compact 的最小结构；
//   · 已存在且有用户字段时，只接管 compaction.modelOverrides，其余原样保留；
//   · 重复调用幂等（第二次不写盘）；
//   · models.json 缺失 / 坏 JSON / 无窗口模型 → 报错但不抛、不写盘；
//   · settings.json 坏 JSON → 拒绝改写（不能弄丢用户配置）；
//   · 只写有窗口的模型。
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { modelsWithWindowOf, settingsPathOf, syncCompactionSettings } from "../src/compaction-settings-file.ts";

/** 造一个临时家目录，config/ 下写入给定的 models.json */
function makeHome(models, settings) {
  const home = mkdtempSync(join(tmpdir(), "lifeos-compaction-"));
  mkdirSync(join(home, "config"), { recursive: true });
  if (models !== undefined) {
    writeFileSync(join(home, "config", "models.json"), JSON.stringify(models, null, 2));
  }
  if (settings !== undefined) {
    writeFileSync(join(home, "config", "settings.json"), typeof settings === "string" ? settings : JSON.stringify(settings, null, 2));
  }
  return home;
}

const MODELS = {
  providers: {
    big: {
      models: [
        { id: "wide", contextWindow: 1_000_000 },
        { id: "huge", contextWindow: 1_050_000 },
      ],
    },
    small: {
      models: [{ id: "narrow", contextWindow: 76_800 }],
    },
    unknown: {
      models: [{ id: "no-window" }, { id: "zero-window", contextWindow: 0 }],
    },
  },
};

test("文件不存在时创建，按窗口写出每个模型的 reserveTokens", async () => {
  const home = makeHome(MODELS);
  const result = await syncCompactionSettings(home);

  assert.equal(result.ok, true);
  assert.equal(result.written, true);
  assert.equal(result.path, settingsPathOf(home));

  const written = JSON.parse(readFileSync(result.path, "utf8"));
  assert.deepEqual(written, {
    compaction: {
      modelOverrides: {
        "big/wide": { reserveTokens: 150_000 },
        "big/huge": { reserveTokens: 157_500 },
        "small/narrow": { reserveTokens: 32_000 },
      },
    },
  });
});

test("没有窗口的模型不写条目（回落 Pi 默认，不猜）", async () => {
  const home = makeHome(MODELS);
  const result = await syncCompactionSettings(home);
  const written = JSON.parse(readFileSync(result.path, "utf8"));
  const keys = Object.keys(written.compaction.modelOverrides);
  assert.ok(!keys.some((k) => k.startsWith("unknown/")), `不该有 unknown/* 条目，实际：${keys.join(",")}`);
});

test("已有 settings.json 有用户字段时，只接管 modelOverrides，其余原样保留", async () => {
  const home = makeHome(MODELS, {
    theme: "dark",
    retry: { enabled: true, maxRetries: 5 },
    compaction: {
      enabled: true,
      keepRecentTokens: 30_000,
      reserveTokens: 8_000,
      modelOverrides: { "stale/gone": { reserveTokens: 1 } },
    },
  });
  const result = await syncCompactionSettings(home);
  assert.equal(result.ok, true);

  const written = JSON.parse(readFileSync(result.path, "utf8"));
  assert.equal(written.theme, "dark");
  assert.deepEqual(written.retry, { enabled: true, maxRetries: 5 });
  // compaction 里的其他字段保留（用户可能显式设过通用值）
  assert.equal(written.compaction.enabled, true);
  assert.equal(written.compaction.keepRecentTokens, 30_000);
  assert.equal(written.compaction.reserveTokens, 8_000);
  // 过时的 modelOverrides 被替换成当前模型清单的集合
  assert.deepEqual(Object.keys(written.compaction.modelOverrides).sort(), ["big/huge", "big/wide", "small/narrow"]);
});

test("幂等：内容没变时第二次不写盘", async () => {
  const home = makeHome(MODELS);
  const first = await syncCompactionSettings(home);
  assert.equal(first.written, true);
  const second = await syncCompactionSettings(home);
  assert.equal(second.ok, true);
  assert.equal(second.written, false);
});

test("幂等：用户手改了别的字段后，再同步一次仍保留用户的改动且只动 modelOverrides", async () => {
  const home = makeHome(MODELS);
  await syncCompactionSettings(home);
  // 用户手改主题
  const path = settingsPathOf(home);
  const before = JSON.parse(readFileSync(path, "utf8"));
  before.theme = "light";
  writeFileSync(path, JSON.stringify(before, null, 2));

  const result = await syncCompactionSettings(home);
  assert.equal(result.ok, true);
  // 用户改的字段让内容变了 → 这次会写（因为我们的合并会保留它，写回后内容与"仅补丁"不同）
  const after = JSON.parse(readFileSync(path, "utf8"));
  assert.equal(after.theme, "light", "用户手改的 theme 必须保留");
});

test("models.json 缺失 → ok:false，不写盘、不抛", async () => {
  const home = makeHome(undefined);
  const result = await syncCompactionSettings(home);
  assert.equal(result.ok, false);
  assert.equal(result.reason.includes("读不到 models.json"), true);
});

test("models.json 坏 JSON → ok:false，不写盘", async () => {
  const home = makeHome(undefined);
  writeFileSync(join(home, "config", "models.json"), "{ not json");
  const result = await syncCompactionSettings(home);
  assert.equal(result.ok, false);
  assert.equal(result.reason.includes("不是合法 JSON"), true);
});

test("models.json 里没有带窗口的模型 → ok:false，不写空补丁", async () => {
  const home = makeHome({ providers: { p: { models: [{ id: "a" }] } } });
  const result = await syncCompactionSettings(home);
  assert.equal(result.ok, false);
  assert.equal(result.reason.includes("没有带 contextWindow"), true);
});

test("settings.json 坏 JSON → 拒绝改写（不能弄丢用户配置）", async () => {
  const home = makeHome(MODELS, "{ broken user config");
  const result = await syncCompactionSettings(home);
  assert.equal(result.ok, false);
  assert.equal(result.reason.includes("拒绝改写"), true);
  // 原文件没被动
  assert.equal(readFileSync(settingsPathOf(home), "utf8"), "{ broken user config");
});

test("modelsWithWindowOf：只收 provider/models 结构，坏形状一律跳过", () => {
  assert.deepEqual(modelsWithWindowOf(undefined), []);
  assert.deepEqual(modelsWithWindowOf(null), []);
  assert.deepEqual(modelsWithWindowOf({}), []);
  assert.deepEqual(modelsWithWindowOf({ providers: null }), []);
  assert.deepEqual(modelsWithWindowOf({ providers: { p: null } }), []);
  assert.deepEqual(modelsWithWindowOf({ providers: { p: { models: "x" } } }), []);

  const got = modelsWithWindowOf({
    providers: {
      p: {
        models: [
          { id: "ok", contextWindow: 100_000 },
          { id: "", contextWindow: 100_000 },        // 空 id 跳过
          { contextWindow: 100_000 },                 // 无 id 跳过
          { id: "str-window", contextWindow: "100" }, // 非数字跳过
          null,
          "junk",
        ],
      },
    },
  });
  assert.deepEqual(got, [{ provider: "p", id: "ok", contextWindow: 100_000 }]);
});

// 活性自检（testing.md 2.4）：如果哪天有人把"只合并 compaction.modelOverrides"改成
// "整个文件覆盖"，上头的「用户字段保留」用例必须变红。这里再锁一次语义：
test("活性：写出来的文件必须包含用户原有字段（整体覆盖实现会在这里变红）", async () => {
  const home = makeHome(MODELS, { sentinel: "must-survive" });
  await syncCompactionSettings(home);
  const written = JSON.parse(readFileSync(settingsPathOf(home), "utf8"));
  assert.equal(written.sentinel, "must-survive");
});
