/**
 * 会话区"该显示什么"的唯一判定（Task 0016 · P1-S1）。
 *
 * 为什么抽成纯函数：空态 vs 骨架 vs 列表是**三选一互斥**的，而"messages 为空"
 * 同时是"正在加载"和"真·空会话"的表现——用 `messages.length === 0` 直接判
 * 会把加载中显示成"这个会话是空的"（实测 1.4 秒，`evidence/perf-flash2.mjs`）。
 * 规范 2.1 禁止靠"值不相等"猜语义，所以判定必须读**显式状态**，穷举可测。
 *
 * 四态（互斥，`sessionLoading` 优先于一切）：
 *
 * | sessionId | sessionLoading | messages | → 结果   |
 * | 未定义     | 任意            | 任意      | "empty"（无会话 / 草稿） |
 * | 已定义     | true           | 任意      | "loading" |
 * | 已定义     | false          | 空        | "empty"（真·空会话） |
 * | 已定义     | false          | 非空      | "list"   |
 *
 * **不变式**：`sessionLoading === true` 时永远不返回 "empty"。
 * 这条是 P1 的验收口径（T17-1 穷举 + T1-1/T1-4 界面断言）。
 */

export type SessionViewState = "empty" | "loading" | "list";

export function viewStateOf(input: {
  sessionId: string | undefined;
  sessionLoading: boolean;
  messageCount: number;
}): SessionViewState {
  if (input.sessionId === undefined) return "empty";
  if (input.sessionLoading) return "loading";
  return input.messageCount === 0 ? "empty" : "list";
}
