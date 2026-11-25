/**
 * 徽标槽位（"这条会话现在占哪一格"）的**唯一判定**（Task 0037）。
 *
 * ## 为什么单独成模块
 *
 * 徽标数字的链路是 `CountBadge ← deriveStatus ← agentAggregate ← sessionSlots`；
 * `sessionSlots` 里的每一格由**两种输入**维护：`row` 补丁与"服务端在跑集合"对账。
 * 这两条路径都必须回答同一个问题：「这条会话现在占哪一格」——
 * 一旦各写一份判断，就会出现"行上是 idle、数字还在呼吸"的自相矛盾。
 *
 * 更具体的历史缺陷（2026-11-24 用户报「都没有会话在运行了，为什么还有呼吸的 1」）：
 * 原来这个判断写在 `App.tsx` 的 `applySlotFromPatch()` 里，是一条 **else-if 链**，
 * 分支顺序是 `unread 非空 → unread 为 null → running 非空 → running 为 null`。
 * 而服务端的终止补丁**同时带两个 null**（`src/row-patch.ts:132` 的 `pushTerminal`
 * 强制补上 `running: null`；`src/agent-host.ts:1061` 在"用户就停在这个会话上/被用户打断"时
 * 给 `unread: null`）。于是 `unread: null` 那支先命中 → 交给 `clearUnreadSlot()`，
 * 而它为了保护"点开正在跑的会话不能清数字"对 running 槽位**直接 return**
 * ⇒ 同一条补丁里的 `running: null` 被吞掉，槽位永久停在 running。
 * 当前 Agent 靠 `done` 事件触发的列表重取自愈；**别的 Agent 不重取**，于是永久残留。
 *
 * ## 契约
 *
 * 补丁里的字段是**互相独立的事实**，不能"挑一个分支执行"：
 *
 * | 补丁字段 | 表达的事实 | 结果 |
 * |---|---|---|
 * | `removed: true` | 会话被删了 | 不占格 |
 * | `running` 非空 | 这一轮开始了 | `running`（最高优先级，与后端 `running > failure > unread` 同序） |
 * | `running: null` | 这一轮停了 | 先落到"不占 running"，再看同一补丁里的 `unread` |
 * | `unread` 非空 | 结束且没人看过 | `unreadError`（带 failure）/ `unreadDone` |
 * | `unread: null` | 这条没有未读了 | 清未读；**如果它还真的在跑就保留 running**（2026-11-05 的保护，语义不变） |
 * | 以上都没有（如只带 `title`） | 与状态无关 | 保持原样 |
 *
 * 注意 `unread: null` 的保护只对"**没有**同时说 running 停了"的补丁生效：
 * `{running: null, unread: null}` 里 running 已经被显式否定，此时保留 running 就是错的。
 *
 * 机器检查：`test/status-map.test.mjs` 的 T80–T85（槽位）、T90–T92（对账）。
 */
import type { RowActivity } from "../../../src/row-activity.ts";

/** 一条会话在聚合里占的格（与后端 `aggregateStatus()` 的三格同口径）。 */
export type SlotKind = "running" | "unreadDone" | "unreadError";

/** 槽位条目：投影时要的归属 + 格子。 */
export type SlotEntry = { agentId: string; projectId?: string | undefined; slot: SlotKind };

/** 判断只需要的补丁字段（`App.tsx` 的 `RowPatchPayload` 是它的超集）。 */
export type SlotPatch = {
  removed?: true;
  running?: { since: string; phase?: string; tool?: string } | null;
  unread?: { since: string } | null;
  failure?: { kind: string; detail: string; at?: string } | null;
};

/**
 * 一条补丁之后，这条会话占哪一格（`undefined` = 不占格）。
 *
 * 纯函数：只依赖入参与补丁内容，不看时钟、不看服务端。
 */
export function slotAfterPatch(current: SlotKind | undefined, patch: SlotPatch): SlotKind | undefined {
  if (patch.removed === true) return undefined;
  // 「补丁里说了这件事吗」与「它说的是什么」必须分开判断：
  // 只有 `"running" in patch` 才代表服务端在说这件事，缺省 = 服务端没说，保持原样。
  const saidRunning = "running" in patch && patch.running !== undefined;
  const saidUnread = "unread" in patch && patch.unread !== undefined;

  // ① 在跑：最高优先级（与后端四态同序），任何其它字段都不能盖过它
  if (saidRunning && patch.running !== null) return "running";

  // ② running: null → 这一轮停了；same patch 里若还说了未读，就按未读算（终态补丁的常态）
  const stopped = saidRunning;            // 上面已排除"非空"，走到这里等于 `running === null`
  const base: SlotKind | undefined = stopped ? undefined : current;

  if (saidUnread) {
    if (patch.unread !== null) {
      // 带 failure 就是失败待看，否则完成待看（与后端 `slotOf()` 同口径）
      return patch.failure !== undefined && patch.failure !== null ? "unreadError" : "unreadDone";
    }
    // `unread: null` 的语义只是"这条没有未读了"：
    // 没有同时否定 running 时，在跑的会话不能因为"已读"而丢数字（2026-11-05 用户实测的 bug）。
    return base === "running" ? "running" : undefined;
  }

  return base;
}

/**
 * 用"服务端此刻在跑哪些会话"对账槽位（`/api/runtime` 的 30s 兜底）。
 *
 * 为什么需要（Task 0037 的同类风险，和 Task 0007 的"漏 done 事件"是同一族）：
 * 槽位的两条维护路径都是**推送**（`row` 补丁）与**重取**（只对当前 Agent 生效）。
 * 推送丢了（后台节流 / 半开连接 / 乱序守卫丢弃）就没有任何东西会纠正它 ——
 * 用户看到的就是本次报的"没有会话在跑，呼吸 1 一直挂着"。
 * 服务端持有真相（`runningAll()`），而这条对账接口只关心运行态，代价是每 30s 一个小响应。
 *
 * 语义（只碰 running，不碰未读）：
 * - 服务端说在跑、槽位不是 running → 记 running（补上漏掉的"开跑"）；
 * - 槽位是 running、服务端说不在跑 → 删掉（清掉漏掉的"结束"）；
 * - 其它槽位（unreadDone / unreadError）原样不动 —— 未读的真相在 `session-views.json`，
 *   不在这条接口里，拿它推断未读就会"删掉用户还没看的失败"。
 */
export function reconcileRunningSlots(
  slots: ReadonlyMap<string, SlotEntry>,
  running: ReadonlyArray<{ sessionId: string; agentId: string; projectId?: string | undefined }>,
): Map<string, SlotEntry> | undefined {
  const runningById = new Map(running.map((entry) => [entry.sessionId, entry] as const));
  let changed = false;
  const next = new Map(slots);

  for (const [sessionId, entry] of slots) {
    if (entry.slot !== "running") continue;
    if (runningById.has(sessionId)) continue;
    next.delete(sessionId);
    changed = true;
  }
  for (const entry of running) {
    const current = next.get(entry.sessionId);
    // 已经在这个状态且归属一致 → 不必重建对象（避免无意义重渲染）
    const same = current !== undefined && current.slot === "running" && current.agentId === entry.agentId
      && (entry.projectId === undefined || entry.projectId === current.projectId);
    if (same) continue;
    // projectId 只增不减（与 `setSlot` 同一规则）：对账接口不带归属时不得把数字挪进"无项目桶"
    const projectId = entry.projectId ?? current?.projectId;
    next.set(entry.sessionId, { agentId: entry.agentId, ...(projectId !== undefined ? { projectId } : {}), slot: "running" });
    changed = true;
  }
  return changed ? next : undefined;
}

/**
 * 哪些 running 槽位**服务端已经不认了**（可能只是"漏了结束推送"的残留）。
 *
 * 为什么要单独一个函数：对账时「补上漏掉的开跑」与「清掉漏掉的结束」后果不对等 ——
 * 前者不需要额外动作（下一次列表重取自然会对齐），后者意味着**行上的呼吸点也没清**（它们同源不同路），
 * 所以只有"有残留"时才值得多一次列表重取。把判据放纯函数，调用方不用自己比一遍。
 */
export function staleRunningSlots(
  slots: ReadonlyMap<string, SlotEntry>,
  running: ReadonlyArray<{ sessionId: string }>,
): string[] {
  const runningIds = new Set(running.map((entry) => entry.sessionId));
  const stale: string[] = [];
  for (const [sessionId, entry] of slots) {
    if (entry.slot === "running" && !runningIds.has(sessionId)) stale.push(sessionId);
  }
  return stale;
}

/**
 * 补丁 → 新的槽位条目（含项目归属与"projectId 只增不减"的规则）。
 *
 * 为什么把归属也放进纯函数：`App.tsx` 的 `setSlot` 里有这条规则
 * （2026-11-05：不带 projectId 的补丁曾把数字从项目行挪进"无项目桶"），
 * 而它是"槽位怎么写"的一部分，与"占哪一格"必须同源，否则又会分叉成两套。
 */
export function nextSlotEntry(
  current: SlotEntry | undefined,
  agentId: string,
  projectId: string | undefined,
  patch: SlotPatch,
): SlotEntry | undefined {
  const slot = slotAfterPatch(current?.slot, patch);
  if (slot === undefined) return undefined;
  const effective = projectId ?? current?.projectId;
  return { agentId, ...(effective !== undefined ? { projectId: effective } : {}), slot };
}

/** 行的四态 → 槽位（重取列表时用服务端行校正槽位；与 `rowActivityOf` 的四态同源）。 */
export function slotOfActivity(activity: Pick<RowActivity, "state">): SlotKind | undefined {
  if (activity.state === "running") return "running";
  if (activity.state === "unread") return "unreadDone";
  if (activity.state === "failure") return "unreadError";
  return undefined;
}
