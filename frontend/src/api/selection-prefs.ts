/**
 * 「选中行为」偏好（Task 0018）的**纯函数层**：默认值 + 解析收敛。
 *
 * 形状：`{ copyOnSelect: boolean }`。
 * - **copyOnSelect = true（默认）**：松手即复制（Task 0013 现状），功能条不含复制按钮；
 * - **copyOnSelect = false**：松手只弹功能条，点「复制」才复制。
 *
 * 纪律（与 display-prefs / badge-prefs 同一套）：坏值一律**收敛回默认**，
 * 不报错、不抛 —— 用户手改坏了 ui.json 不该让界面打不开。可穷举单测。
 */

export type SelectionPrefs = { copyOnSelect: boolean };

export const DEFAULT_SELECTION_PREFS: SelectionPrefs = { copyOnSelect: true };

/** 解析：非对象 → 默认；copyOnSelect 非布尔 → 该键回默认。未知键忽略（向前兼容）。 */
export function parseSelectionPrefs(raw: unknown): SelectionPrefs {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return { ...DEFAULT_SELECTION_PREFS };
  const record = raw as Record<string, unknown>;
  const copy = record.copyOnSelect;
  return { copyOnSelect: typeof copy === "boolean" ? copy : DEFAULT_SELECTION_PREFS.copyOnSelect };
}
