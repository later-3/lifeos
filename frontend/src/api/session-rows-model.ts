/**
 * 会话列表的**行模型**（Task 0017 · P7a）。
 *
 * ## 这个文件解决什么
 *
 * 列表现在是"两层 map 直接吐 JSX"（`App.tsx` 的分组循环 + 组内会话循环），
 * 于是**没有任何地方**能回答「这个列表一共有几行、每行多高、第 N 行是什么」。
 * 而虚拟滚动、键盘导航、`aria-setsize/posinset`、行高表、规模探针**全都需要这个答案**。
 *
 * 这里把它变成纯函数：`Group[] + 折叠状态 + 空态文案 → Row[]`。
 *
 * ## 为什么现在做（用户 2026-11-03 裁决过"虚拟化等触发条件"）
 *
 * 行模型**不是**虚拟滚动，它是虚拟滚动的前置，且本身就有收益：
 * - 规模探针需要它（`scripts/frontend-probes.mjs` 要报"多少行 / 每行多高"）；
 * - `aria-setsize` / `aria-posinset` 需要它（读屏要知道"第 7 行，共 31 行"）；
 * - 行高表需要它（`design-language` 的数值与真实行高必须对得上）。
 * 这三件事**无论上不上虚拟滚动都该做**，且都不改变现有渲染的 DOM。
 *
 * ## 契约
 *
 * - `key` **稳定**：折叠/展开不改变其它行的 key（组头 key = `g:<projectId>`，
 *   会话行 key = `s:<sessionId>`，空态 key = `e:<projectId>`）。
 * - `kind` 决定行高与语义；`index` 是**全表序号**（0 起，含组头与空态），供探针与 aria 用。
 * - 顺序 = 分组顺序 + 组内会话顺序（不排序：服务端已按 `lastActivityAt` 排好）。
 */
import type { Group } from "../hooks/types";

/** 行高表（px）。与 `design-language` §5.1 的数值同源；UI 改行高时这条表也要改（有断言）。 */
export const ROW_HEIGHTS = {
  /** 组头（`GroupHeader`）：h-8 */
  group: 32,
  /** 会话行（`Row variant="two-line"`）：h-14 */
  session: 56,
  /** 空态提示（组内没有会话时那一行）：py-2 + text-micro 行高 ≈ 32 */
  empty: 32,
} as const;

export type RowKind = keyof typeof ROW_HEIGHTS;

export type Row =
  | { kind: "group"; key: string; index: number; height: number; projectId: string }
  | { kind: "session"; key: string; index: number; height: number; projectId: string; sessionId: string }
  | { kind: "empty"; key: string; index: number; height: number; projectId: string };

/**
 * `Group[] + 折叠状态 → Row[]`。
 *
 * `collapsed[projectId] === true` 表示该组收起（与 `readCollapsedGroups` 的语义一致：
 * **只存收起的**）。收起的组**只产生一行**（组头），不产生组内行 —— 这正是
 * "折叠后 70 行"的来源。
 */
export function buildRows(groups: readonly Group[], collapsed: Record<string, boolean>): Row[] {
  const rows: Row[] = [];
  for (const group of groups) {
    const projectId = group.project.id;
    rows.push({ kind: "group", key: `g:${projectId}`, index: rows.length, height: ROW_HEIGHTS.group, projectId });
    if (collapsed[projectId] === true) continue;
    if (group.sessions.length === 0) {
      rows.push({ kind: "empty", key: `e:${projectId}`, index: rows.length, height: ROW_HEIGHTS.empty, projectId });
      continue;
    }
    for (const session of group.sessions) {
      rows.push({
        kind: "session", key: `s:${session.sessionId}`, index: rows.length,
        height: ROW_HEIGHTS.session, projectId, sessionId: session.sessionId,
      });
    }
  }
  return rows;
}

/** 总高度（虚拟滚动的容器高度；也是"这个列表有多长"的唯一答案）。 */
export function totalHeightOf(rows: readonly Row[]): number {
  return rows.reduce((sum, row) => sum + row.height, 0);
}
