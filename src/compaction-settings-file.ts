// 把压缩阈值写进 Pi 的 `settings.json`（Task 0041 · S2）。
//
// 为什么需要写文件而不是在代码里设：Pi 的 `SettingsManager.getCompactionSettings(model)`
// 只从 `settings.json` 读（`settings-manager.js:654-684`），没有编程接口。
// 它支持两层：`compaction.reserveTokens`（通用）+ `compaction.modelOverrides["<provider>/<id>"]`（按模型），
// 查找顺序是 **模型覆盖 → 通用 → 内置默认 16384**。
//
// 为什么要按模型写（01-background §9）：同一个固定值在 76,800 与 1,000,000 的窗口上
// 分别占 21.3% 与 1.6%，两端都不对。按模型写才能让每个窗口都有自己的合理余量。
//
// **生效时机（已核实）**：`SettingsManager.create()` 在**会话创建时**读一次文件，之后用内存快照
// （`settings-manager.js:223-231`）。所以写完配置后，**新建会话**才拿到新阈值；已有会话保持旧值。
// 这是刻意不做热更新的取舍：热更新会让"改配置"影响正在跑的回合。
//
// 写入纪律（backend/code.md 2.4）：tmp+rename 原子、不覆盖用户已有的其他字段、幂等（内容没变不写盘）。

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { writeTextAtomic } from "./atomic-file.ts";
import {
  compactionOverridesOf,
  mergeCompactionOverrides,
  shouldWriteOverrides,
  type CompactionModelInput,
} from "./compaction-settings.ts";
import { resolveHome } from "./home.ts";

/** `settings.json` 的路径。与 Pi 的 `SettingsManager.create(cwd, configDir)` 一致（agentDir = config/）。 */
export function settingsPathOf(home: string = resolveHome()): string {
  return join(home, "config", "settings.json");
}

/** `models.json` 的路径（与 `agent-host.ts` 的 `readProvidersConfig` 同源，可用环境变量覆盖）。 */
function modelsPathOf(home: string): string {
  return process.env.LIFEOS_MODELS_PATH?.trim() || join(home, "config", "models.json");
}

type ModelsFileShape = {
  providers?: Record<string, { models?: Array<{ id?: unknown; contextWindow?: unknown }> }>;
};

/**
 * 从 `models.json` 读出所有「有已知窗口」的模型。
 *
 * 读不到 / 坏 JSON → 空数组（不猜、不抛）：压缩配置写不进去比启动失败好，
 * 而"写不进去"会被 `missing` 上报出来（见返回值）。
 */
export function modelsWithWindowOf(raw: unknown): CompactionModelInput[] {
  if (typeof raw !== "object" || raw === null) return [];
  const providers = (raw as ModelsFileShape).providers;
  if (typeof providers !== "object" || providers === null) return [];

  const out: CompactionModelInput[] = [];
  for (const [provider, config] of Object.entries(providers)) {
    if (typeof config !== "object" || config === null) continue;
    const models = config.models;
    if (!Array.isArray(models)) continue;
    for (const model of models) {
      if (typeof model !== "object" || model === null) continue;
      const id = model.id;
      const contextWindow = model.contextWindow;
      if (typeof id !== "string" || id === "") continue;
      // contextWindow 必须是非有限以外的正数；其余情况交给 reserveTokensOf 判（它返回 undefined 就跳过）
      if (typeof contextWindow !== "number") continue;
      out.push({ provider, id, contextWindow });
    }
  }
  return out;
}

export type SyncResult =
  | { ok: true; written: boolean; models: number; path: string }
  | { ok: false; reason: string; path: string };

/**
 * 同步压缩阈值到 `settings.json`。
 *
 * 幂等：把结果与现有内容比对，**完全一致就不写**（避免每次启动都改 mtime）。
 *
 * 失败不抛：家目录只读、JSON 坏等情况下返回 `{ok:false}`，由调用方决定是 warn 还是忽略。
 */
export async function syncCompactionSettings(home: string = resolveHome()): Promise<SyncResult> {
  const path = settingsPathOf(home);

  // 1) 读模型清单
  const modelsText = await readFile(modelsPathOf(home), "utf8").catch(() => "");
  if (modelsText === "") {
    return { ok: false, reason: "读不到 models.json（无法知道模型窗口）", path };
  }
  let modelsRaw: unknown;
  try {
    modelsRaw = JSON.parse(modelsText);
  } catch {
    return { ok: false, reason: "models.json 不是合法 JSON", path };
  }
  const models = modelsWithWindowOf(modelsRaw);
  const patch = compactionOverridesOf(models);
  if (!shouldWriteOverrides(patch)) {
    return { ok: false, reason: "models.json 里没有带 contextWindow 的模型", path };
  }

  // 2) 读现有 settings.json（不存在 = 空对象；坏 JSON = 不覆盖，报错）
  const currentText = await readFile(path, "utf8").catch(() => "");
  let current: unknown = {};
  if (currentText !== "") {
    try {
      current = JSON.parse(currentText);
    } catch {
      return { ok: false, reason: `settings.json 不是合法 JSON，拒绝改写（避免弄丢用户配置）`, path };
    }
  }

  // 3) 合并并比对
  const merged = mergeCompactionOverrides(current, patch);
  const mergedText = `${JSON.stringify(merged, null, 2)}\n`;
  if (currentText !== "" && canonical(currentText) === canonical(mergedText)) {
    return { ok: true, written: false, models: models.length, path };
  }

  // 4) 原子写
  try {
    await writeTextAtomic(path, mergedText);
  } catch (error) {
    return { ok: false, reason: `写 settings.json 失败：${error instanceof Error ? error.message : String(error)}`, path };
  }
  return { ok: true, written: true, models: models.length, path };
}

/** 规范化 JSON 文本用于比对（忽略键序与空白差异）。解析失败时原样返回。 */
function canonical(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text));
  } catch {
    return text;
  }
}
