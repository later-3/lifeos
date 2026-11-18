/**
 * 头像的视觉参数（**唯一实现**，三个头像组件共用）。
 *
 * 为什么抽出来（2026-11-09 自检发现）：`AgentAvatar` / `UserAvatar` / 会话行的参与者头像
 * 各自写了一遍 `fontSize: Math.max(10, Math.round(size * 0.42))` —— 三处魔数、三处注释。
 * 改一处忘了另两处时，"同一个头像在不同位置字号不同"这种缺陷不会报错、只在对比时看得见。
 *
 * `ui-audit` 的历史报告里 10px 这个字号来源就在这里（首字母字号的下限），
 * 收敛到一处之后，字号清单才有唯一解释。
 */

/** 头像内首字母的字号：按直径比例取，且不小于 10px（再小就看不清了）。 */
const LETTER_RATIO = 0.42;
const LETTER_MIN_PX = 10;

export function avatarLetterSize(diameter: number): number {
  return Math.max(LETTER_MIN_PX, Math.round(diameter * LETTER_RATIO));
}

/** 头像的内联尺寸样式（宽高 + 首字母字号）。 */
export function avatarBoxStyle(diameter: number): { width: number; height: number; fontSize: number } {
  return { width: diameter, height: diameter, fontSize: avatarLetterSize(diameter) };
}

/**
 * 叠放头像的第二个左移量 = 直径 × 0.6（露出 40%，看得出是两个人）。
 * 会话行原先把 0.6 写成裸数字。
 */
const OVERLAP_RATIO = 0.6;

export function avatarOverlapOffset(diameter: number): number {
  return Math.round(diameter * OVERLAP_RATIO);
}

/**
 * 树的缩进（文件树 / 历史树共用一套语义）。
 *
 * 三个魔数曾经分散在 `FileTree.tsx`（`8 + depth*14`、`8 + (depth+1)*14`、`8 + depth*14 + 18`）
 * 与 `SessionHistory.tsx`（`4 + depth*10`）里。抽出来之后：
 * - `TREE_INDENT_BASE`：第 0 层的左缘（与列内边距对齐）
 * - `TREE_INDENT_STEP`：每深一层的增量
 * - `TREE_INDENT_DISCLOSURE`：折叠箭头列宽（子项要再让出这一列，才能与父项文字对齐）
 *
 * 为什么两棵树 step 不同（14 vs 10）：文件树每层要放 14px 图标 + 间距，
 * 历史树只有文字。这是**内容决定**的差异，不是随手写的两套；注释在此说明归属。
 */
export const TREE_INDENT_BASE = 8;
export const TREE_INDENT_STEP = 14;
export const TREE_INDENT_DISCLOSURE = 18;
export const TREE_INDENT_BASE_COMPACT = 4;
export const TREE_INDENT_STEP_COMPACT = 10;
