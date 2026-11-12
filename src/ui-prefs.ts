// 用户界面偏好（主题 / 显示）的持久层。
//
// 为什么需要它（2026-11-09 用户："是否用户重启了，这些配置就丢了？"）：
// 实测结论是 —— **重启不丢，换环境才丢**。这些偏好存在浏览器 localStorage 里，
// 于是：同一浏览器刷新/关掉浏览器再开都保留；但换浏览器、换设备、清缓存、隐私模式全部回默认；
// 而且本机 5173、后端直连 43120、手机访问的 lifeos.ai4child.asia 是**三个不同 origin**，互不相通。
//
// 所以把"事实源"挪到 `~/.lifeos/config/ui.json`（一个家目录一份，跟 profile / file-roots 同一层），
// 浏览器 localStorage 降级为**首屏缓存**（index.html 的防闪脚本读它，避免等网络往返才上色）。
//
// 边界（协议 §2.6 / architecture 2.6）：
// - 只放 **UI 偏好**，不放凭据（models.json / auth.json 的事）；
// - 不塞进 config/settings.json —— 那是 Pi 的配置（模型与思考级别的系统默认，assembly.ts 读它），
//   UI 偏好写进去会与底座配置混在一起；
// - 坏值一律**收敛回默认**而不是报错（与 display-prefs.ts 的 parsePrefs 同一纪律：
//   用户手改坏了文件不该让界面打不开）。
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { writeTextAtomic } from "./atomic-file.ts";
import { resolveHome } from "./home.ts";

/** 文件位置：`~/.lifeos/config/ui.json`。 */
export function uiPrefsPath(home = resolveHome()): string {
  return join(home, "config", "ui.json");
}

/**
 * 偏好形状。
 *
 * **只收"跨设备应该有同一份"的东西**：
 * - `theme`：主题状态（预设 / 深浅 / 主色 / 四档 L*）；
 * - `display`：内容宽度 + 字号。
 *
 * 明确**不**收：列宽（`columnWidths`）、列收展（`fold.*`）、草稿、当前选中会话 ——
 * 这些是"当前这块屏幕上的临时状态"，1280 上拖的列宽同步到 390 手机上只会更糟。
 */
export type UiPrefs = {
  theme?: unknown;
  display?: unknown;
  /** 状态徽标（运行/未读/失败的配色强度与呼吸动画参数，2026-11-10 用户：单独可调）。 */
  badges?: unknown;
  /** 选中行为（Task 0018）：`copyOnSelect` 开关（默认开 = 松手即复制，Task 0013 现状）。 */
  selection?: unknown;
};

/** 读取（文件不存在 / 坏 JSON → 空对象，调用方用各自的默认值补齐）。 */
export async function readUiPrefs(home = resolveHome()): Promise<UiPrefs> {
  try {
    const raw = await readFile(uiPrefsPath(home), "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const record = parsed as Record<string, unknown>;
    const out: UiPrefs = {};
    if (record.theme !== undefined) out.theme = record.theme;
    if (record.display !== undefined) out.display = record.display;
    if (record.badges !== undefined) out.badges = record.badges;
    if (record.selection !== undefined) out.selection = record.selection;
    return out;
  } catch {
    return {};
  }
}

/**
 * 写入（原子：tmp + rename）。
 *
 * **部分更新语义**：请求体里没给的键保持原值 —— 用户只改了显示宽度，
 * 不该把主题一起重置（这是 PUT 与 PATCH 的区别；这里选 PUT + 合并，
 * 因为前端两个面板各自只知道自己那一半）。
 */
export async function writeUiPrefs(patch: UiPrefs, home = resolveHome()): Promise<UiPrefs> {
  const current = await readUiPrefs(home);
  const next: UiPrefs = { ...current };
  if (patch.theme !== undefined) next.theme = patch.theme;
  if (patch.display !== undefined) next.display = patch.display;
  if (patch.badges !== undefined) next.badges = patch.badges;
  if (patch.selection !== undefined) next.selection = patch.selection;
  await writeTextAtomic(uiPrefsPath(home), `${JSON.stringify(next, null, 2)}\n`);
  return next;
}
