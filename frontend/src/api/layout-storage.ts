/**
 * 列表布局的持久化键与读写（Task 0017 · P5：从 `App.tsx` 抽出）。
 *
 * 抽出的理由：`useWorkspace` 需要"分组折叠"的持久化，而它原来是 `App.tsx` 里的两个私有函数。
 * 留在 App 里会让 hook 反向 import 组件文件（循环依赖）。这里只放**读/写/迁移**三件事，
 * 纯 localStorage、无 React 依赖，可被单测直接 import。
 */

/**
 * 折叠键迁移（Task 0015 · T15）：旧的两个键 `projects` / `sessions` → 一个 `groups`。
 *
 * 为什么"任一展开就展开"：合并后一列同时承担两个作用。宁可多开一列（用户点一下就能收），
 * 也不要让老用户的展开状态在升级后变成"点了没反应"。
 * 只在读不到 `groups` 键时参考旧键（`useFold` 的 initial 只在没有存量值时生效）。
 */
export function legacyGroupsOpen(): boolean {
  try {
    if (localStorage.getItem("lifeos.fold.groups") !== null) return true;   // 有存量就不看旧键
    const projects = localStorage.getItem("lifeos.fold.projects");
    const sessions = localStorage.getItem("lifeos.fold.sessions");
    return projects !== "0" || sessions !== "0";
  } catch { return true; }
}

/** 分组折叠状态的持久化键（只存收起的项目 id）。 */
const COLLAPSED_GROUPS_KEY = "lifeos.collapsedGroups";

export function readCollapsedGroups(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(COLLAPSED_GROUPS_KEY);
    if (raw === null) return {};
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: Record<string, boolean> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (value === true) out[key] = true;   // 只认 true；其它一律当展开
    }
    return out;
  } catch { return {}; }
}

export function writeCollapsedGroups(value: Record<string, boolean>): void {
  try {
    const keys = Object.keys(value).filter((key) => value[key] === true);
    if (keys.length === 0) localStorage.removeItem(COLLAPSED_GROUPS_KEY);
    else localStorage.setItem(COLLAPSED_GROUPS_KEY, JSON.stringify(Object.fromEntries(keys.map((key) => [key, true]))));
  } catch { /* 忽略：存不下时退化为不持久，不影响功能 */ }
}
