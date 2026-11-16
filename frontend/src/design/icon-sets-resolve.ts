/**
 * 图标解析的纯函数层（Task 0016 · P2-S1）。
 *
 * 抽成零依赖的 `.ts` 是为了**能离线单测**：`icon-sets.tsx` 里的注册表会 import 三个图标库的
 * 真实组件，Node 直接加载 `.tsx` 做不到；而"缺项该返回什么"这个判断不需要组件，只需要一张表。
 *
 * 契约（`icon-sets.tsx` 的 `iconOf` 直接建立在它上面）：
 *  - 表里有该项 → 返回它；
 *  - 表里是 `null`（该源明确缺此项）→ 返回 `null`，由调用方回退 tabler **并 warn**，不静默；
 *  - 表里没有这个键（拼写错 / 漏生成）→ 同样 `null`（不抛异常：一个图标缺失不该让整页白屏）。
 */
export function pickFrom<T>(table: Readonly<Record<string, T | null>>, name: string): T | null {
  return table[name] ?? null;
}

/**
 * 覆盖度：每套图标集缺哪些语义名。
 *
 * 为什么单独一个函数：设置页要显示"这套缺 1 个"，测试要断言"缺项集合没变多"。
 * 判据统一走 `pickFrom`，不各写一套。
 */
export function coverageOf(
  names: readonly string[],
  tables: Readonly<Record<string, Readonly<Record<string, unknown | null>>>>,
): Record<string, { total: number; missing: string[] }> {
  const report: Record<string, { total: number; missing: string[] }> = {};
  for (const [set, table] of Object.entries(tables)) {
    report[set] = { total: names.length, missing: names.filter((name) => pickFrom(table, name) === null) };
  }
  return report;
}
