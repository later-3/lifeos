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

/**
 * 标记分两类（用户 2026-11-03 明确，是**两个维度**不是二选一）：
 *
 *  - `tone`（语气）：**我的看法**，要发给 Agent（疑问/批评/鼓励/同意…）
 *  - `feature`（功能）：**我自己的分类**，不发（存档/待办）
 *
 * 一条批注可以同时有语气与功能（例如"批评 + 待办"）。
 * 只有功能、没有语气的批注**不进消息**——它没有要对 Agent 说的话。
 */
export type MarkKind = "tone" | "feature";

export type MarkSpec = {
  /** 稳定 id；也是 `::highlight()` 的名字后缀。 */
  id: string;
  /** 菜单显示名。 */
  label: string;
  /** `tone` = 语气（发给 Agent）/ `feature` = 功能（不发）。 */
  kind: MarkKind;
  /**
   * 发给 Agent 时括号里的那句话。
   * **大多数**是「我是 XX 的语气！」，但**有些不是**（用户 2026-11-03：
   * "所以这里一般情况是 xxx 的语气，但有些不是"——"同意"就直说"我同意"）。
   * 所以它是**每个标记自己的一句话**，不是拿 label 套模板。
   * `feature` 类不需要它（不发）。
   */
  say?: string;
  /** 色调：拼出 `--color-anno-<tone>` / `--color-anno-<tone>-soft`。 */
  tone: string;
};

export const MARKS: readonly MarkSpec[] = [
  // —— 语气：发给 Agent ——
  { id: "query",   label: "疑问", kind: "tone", tone: "query",   say: "我是疑问的语气！" },
  { id: "critic",  label: "批评", kind: "tone", tone: "critic",  say: "我是批评的语气！" },
  { id: "praise",  label: "鼓励", kind: "tone", tone: "praise",  say: "我是鼓励的语气！" },
  // "同意"不套模板：说"我是同意的语气"很怪，直接说"我同意"（用户 2026-11-03 点名）
  { id: "agree",   label: "同意", kind: "tone", tone: "praise",  say: "我同意！" },
  // —— 功能：不发给 Agent，只是用户自己的分类 ——
  { id: "archive", label: "存档", kind: "feature", tone: "archive" },
  { id: "todo",    label: "待办", kind: "feature", tone: "todo" },
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

/** 一批 id 的标签串（表格展示用），按传入顺序，用「、」连接。 */
export function labelsOf(ids: readonly string[]): string {
  return ids.map((id) => markById(id)?.label ?? id).join("、");
}

/** 只保留语气类（发给 Agent 的部分）。 */
export function toneIdsOf(ids: readonly string[]): readonly string[] {
  return ids.filter((id) => markById(id)?.kind === "tone");
}

/**
 * 一批 id → 发给 Agent 的括号语句，多个用「、」连接。
 * 只有功能标记时返回空串（调用方据此判定"这条不进消息"）。
 */
export function sayOf(ids: readonly string[]): string {
  return ids
    .map((id) => markById(id))
    .filter((mark): mark is MarkSpec => mark !== undefined && mark.kind === "tone")
    .map((mark) => mark.say ?? `我是${mark.label}的语气！`)
    .join("、");
}
