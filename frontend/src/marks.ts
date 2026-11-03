/**
 * 批注的标记表（Task 0003 · P2）。
 *
 * **纯数据**：加一个标记 = 加一行，不改任何逻辑代码（决策 D5）。
 * 界面上能新增一个语气按钮、能上色、能生成给 Agent 的语气词，全部由这张表驱动。
 *
 * 约束（两条，都是安全要求）：
 *  1. `id` 必须匹配 MARK_ID_PATTERN —— 它会被拼进 `::highlight(anno-<id>)` 的选择器里，
 *     不受控的字符就是注入口；
 *  2. `tone` 只用来拼 CSS 变量名（`--color-anno-<tone>`），**不存色值**——色值只能在
 *     tokens.css 里（scripts/lint-tokens.mjs 会拦）。
 *
 * 值取自 demo（tools/anno-demo/anno.js 的 MARKS），顺序固定：
 * 疑问 / 批评 / 鼓励 / 存档 / 待办。
 */

export type MarkSpec = {
  /** 稳定 id；也是 `::highlight()` 的名字后缀。 */
  id: string;
  /** 菜单显示名，也是发给 Agent 时括号里的语气词。 */
  label: string;
  /** 色调：拼出 `--color-anno-<tone>` / `--color-anno-<tone>-soft`。 */
  tone: string;
  /** 语气前缀（demo 里有；最终消息文本只用 label，这里留给将来扩展）。 */
  say: string;
};

export const MARKS: readonly MarkSpec[] = [
  { id: "query",   label: "疑问", tone: "query",   say: "用户感到疑惑：" },
  { id: "critic",  label: "批评", tone: "critic",  say: "用户认为这里有问题：" },
  { id: "praise",  label: "鼓励", tone: "praise",  say: "用户觉得这段很好：" },
  { id: "archive", label: "存档", tone: "archive", say: "用户要你把这段记为一个案例：" },
  { id: "todo",    label: "待办", tone: "todo",    say: "用户要你把这条加入待办：" },
];

/** 合法的标记 id：小写字母开头，只允许小写字母/数字/连字符。 */
export const MARK_ID_PATTERN = /^[a-z][a-z0-9-]{0,15}$/;

/** 按 id 取标记；未知 id 返回 undefined（调用方决定怎么兜底）。 */
export function markById(id: string): MarkSpec | undefined {
  return MARKS.find((mark) => mark.id === id);
}

/** 主色 CSS 变量名，如 `--color-anno-critic`。 */
export function toneColorVar(tone: string): string {
  return `--color-anno-${tone}`;
}

/** 浅底色 CSS 变量名，如 `--color-anno-critic-soft`。 */
export function toneSoftVar(tone: string): string {
  return `--color-anno-${tone}-soft`;
}

/** 一批 id 的语气词串（给消息文本/表格用），按传入顺序，用「、」连接。 */
export function labelsOf(ids: readonly string[]): string {
  return ids.map((id) => markById(id)?.label ?? id).join("、");
}
