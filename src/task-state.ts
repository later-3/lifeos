// Task 状态归一（S1 契约 §1）：把 `task.md` 里 `状态：` 的自由文本收敛成四个枚举值。
//
// 为什么必须是一个纯函数、且只有一处实现：实测 135 个 Task 的状态字段有 **42 种原值**
// （`进行中（P1 已验收…）`、`**已完成**（2026-11-04 …）`、`已修复（2026-11-03）` …），
// 直接拿它做筛选器就会得到 42 个选项。前端**不得**再写一份（`specs/code/api/api.md` 2.7、
// `specs/code/frontend/code.md` 2.1）：`GET /api/tasks` 已经给出归一结果，前端只用它。
//
// 规则按顺序（每一条都有真实数据支撑，见 `01-background.md` §2.1）：
//   1. **先剥掉 `**` 强调**：实测 11 个原值带 `**`（7 个是 `**已完成**（…）`）。不剥 → 首词变成
//      `**已完成**` → 落「其他」。
//   2. 取**首个词**：`进行中（P1 已验收…）` → `进行中`。分隔符取空白与全/半角标点——中文状态词后面
//      从来不跟拉丁字母，所以"首词"就是第一个分隔符之前的那段。
//   3. `已修复` → `已完成`：同一事实（这件事不再需要做）。
//   4. 匹配不上 → `其他`。**不猜**：原文仍在 `status` 里，详情可见。宁可显示一个「其他」，
//      也不要把 `已作废` 说成 `已完成`（那会让用户以为做完了）。
//
// 零 node 依赖：与 `src/row-activity.ts` 同族（将来若前端要复算也能直接 import）。
export type TaskState = "进行中" | "已完成" | "已移交" | "其他";

/** 枚举的稳定顺序（看板列头按它排，前端不再自己排）。 */
export const TASK_STATES: readonly TaskState[] = ["进行中", "已完成", "已移交", "其他"];

/**
 * 首词 → 枚举。只有这四个键是已知状态；`已修复` 是实测存在过的同义写法。
 * 新增别名必须有真实数据依据（不许"先都收进来"）。
 */
const STATE_WORDS: Readonly<Record<string, TaskState>> = {
  进行中: "进行中",
  已完成: "已完成",
  已移交: "已移交",
  已修复: "已完成",
};

/** 首词的终止符：空白 + 全/半角标点（`（(，,。；;：:、/`）。 */
const WORD_END = /[\s（(，,。；;：:：、/]/;

export function normalizeTaskState(raw: string | undefined | null): TaskState {
  const bare = (raw ?? "").replace(/\*\*/g, "").trim();
  if (bare === "") return "其他";
  let word = bare;
  for (let index = 0; index < bare.length; index += 1) {
    if (WORD_END.test(bare[index] ?? "")) { word = bare.slice(0, index); break; }
  }
  return STATE_WORDS[word] ?? "其他";
}
