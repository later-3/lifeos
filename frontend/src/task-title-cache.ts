// 头部 task 段的两份缓存（Task 0008 修复）：**请求过的 key 不再请求**。
//
// 修的是什么：两个 effect 的守卫都是"缓存里有这个 key 就 return"，但**缓存只会在
// 接口确实返回该 key 时才有值**。于是只要满足以下任一条件，界面就进入死循环：
//
//   - 会话的 activeTaskId 在任务清单里不存在（task.md 缺字段 / 项目目录搬过）；
//   - 项目连默认 Task 都没有（新目录、还没 ensureDefaultTask）；
//   - 接口返回 200 但 items 为空。
//
// 实测（2026-11-05）：把 /tasks 应答改成 `{"items":[]}`，**3 秒 2664 次请求**；
// 当天后端日志 95MB 里 96% 是这一个端点，峰值 3000 次/分钟。
//
// 规则（纯函数，见 test/task-title-cache.test.mjs）：
//   1. 一个 key 的清单只请求一次；请求过就记进 `attempted`，不再请求；
//   2. 请求**失败**（网络/非 2xx）不记，留给下一次依赖变化重试（缺标题只是显示降级）；
//   3. 清单里没有该 key 也要记 —— 这正是"永远补不上"的那个 key，不记就死循环。
// 副作用（fetch / setState）留在 App.tsx 的 effect 里，这里只放判断与合并。

/** 某 key 的清单是否已经请求过。 */
export function shouldRequest(attempted: ReadonlySet<string>, key: string): boolean {
  return !attempted.has(key);
}

/** 把清单合并进缓存（只加不改：已有 key 的标题更可信，不让空清单冲掉）。 */
export function mergeTaskTitles(
  previous: Readonly<Record<string, string>>,
  keys: (taskId: string) => string,
  items: readonly { id: string; title: string }[],
): Record<string, string> {
  if (items.length === 0) return { ...previous };
  const next = { ...previous };
  for (const item of items) {
    const key = keys(item.id);
    if (next[key] === undefined) next[key] = item.title;
  }
  return next;
}
