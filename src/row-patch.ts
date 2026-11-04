// 行动态补丁的**节流推送器**（任务 0005 · 02-design.md D4）。
//
// 它解决一个具体矛盾：
// - 列表要显示"这条会话在跑多久 / 正在调什么工具"（用户 2026-11-02 要求）；
// - 但一次重回合有几百上千个细节事件（实测最重会话 448 次工具调用 / 804 个内容块），
//   逐条推给所有连接就是事件风暴。
//
// 三条规则：
// 1. **只在值变化时发**：`phase` 或 `tool` 真的变了才推（同一状态的重复事件直接丢）；
// 2. **每会话 ≥1000ms 至多 1 条**：变化的第一次立即发，之后窗口内的变化**合并**成一条尾随发送
//    （保证最后一次状态不会丢 —— 这正是简单 debounce 会犯的错）；
// 3. **回合终态立即发且不节流**：done/error 是用户最需要立刻看到的，等 1 秒毫无意义。
//
// 为什么不放前端做：服务端才是"所有会话"的事实源，且前端拿不到非焦点会话的 phase
// （细节事件只投给焦点连接，见 `src/events.ts` 的 `matchesFocus`）。
import { publish } from "./events.ts";

/** 每会话两次推送的最小间隔（毫秒）。值来自 `05-basis.md` §1.2 的推导：
 *  pi-web 用 2.5s 轮询、它的工具刷新上限是 1s；我们取 1000ms（推送比轮询省，但不至于滞后到"像卡住"）。 */
export const ROW_PATCH_MIN_INTERVAL_MS = 1000;

export type RowPatchState = {
  running?: { since: string; phase?: string; tool?: string } | null;
  unread?: { since: string } | null;
  failure?: { kind: string; detail: string; at?: string } | null;
  lastActivityAt?: string;
  title?: { raw: string; display: string };
  task?: { id: string; title: string; status: string; type: string } | null;
};

type Pending = {
  /** 已经排进尾随发送的补丁（多次变化合并到这里）。 */
  queued: RowPatchState;
  /** 尾随定时器。 */
  timer?: ReturnType<typeof setTimeout> | undefined;
};

export type RowPatchPublisher = ReturnType<typeof createRowPatchPublisher>;

/**
 * @param options.now      注入时钟（测试用；生产用 Date.now）
 * @param options.interval 最小间隔（默认 ROW_PATCH_MIN_INTERVAL_MS）
 * @param options.send     实际投递（默认 `publish`）；测试可替换
 */
export function createRowPatchPublisher(options: {
  now?: () => number;
  interval?: number;
  send?: (agentId: string, sessionId: string, projectId: string | undefined, patch: RowPatchState) => void;
} = {}) {
  const now = options.now ?? Date.now;
  const interval = options.interval ?? ROW_PATCH_MIN_INTERVAL_MS;
  const send = options.send ?? ((agentId, sessionId, projectId, patch) => {
    publish(agentId, {
      sessionId,
      ...(projectId !== undefined ? { projectId } : {}),
      type: "row",
      patch: patch as never,
    });
  });

  const pending = new Map<string, Pending>();
  /** 每会话上次真正发出的时刻（0 = 还没发过）。**必须与队列分开存** ——
   *  否则队列清空后节流窗口就丢了，下一次变化会立刻发出（= 没有节流）。 */
  const sentAt = new Map<string, number>();
  /** 每会话最近一次**推出去**的运行态，用于"只在值变化时发"。 */
  const lastSent = new Map<string, RowPatchState["running"]>();
  const keyOf = (agentId: string, sessionId: string) => `${agentId}\u0000${sessionId}`;

  function flush(agentId: string, sessionId: string, projectId: string | undefined): void {
    const key = keyOf(agentId, sessionId);
    const entry = pending.get(key);
    if (entry === undefined) return;
    const patch = entry.queued;
    if (entry.timer !== undefined) { clearTimeout(entry.timer); entry.timer = undefined; }
    pending.delete(key);          // 队列清空
    sentAt.set(key, now());       // **但节流窗口保留**
    if (Object.keys(patch).length === 0) return;
    if (patch.running !== undefined) lastSent.set(key, patch.running);
    send(agentId, sessionId, projectId, patch);
  }

  return {
    /**
     * 运行态变化（turn 开始 / 工具切换 / 文本块切换）。
     * 返回 true = 已立即发出；false = 排队等尾随发送。
     */
    pushRunning(agentId: string, sessionId: string, projectId: string | undefined, running: NonNullable<RowPatchState["running"]>): boolean {
      const key = keyOf(agentId, sessionId);
      // 规则 1：值没变就不发（phase 和 tool 都相同 → 无事发生）
      const previous = lastSent.get(key);
      const queued = pending.get(key)?.queued.running;
      const candidate = queued ?? previous;
      if (candidate !== undefined && candidate !== null
        && candidate.phase === running.phase && candidate.tool === running.tool && candidate.since === running.since) {
        return false;
      }
      const entry = pending.get(key) ?? { queued: {} };
      entry.queued = { ...entry.queued, running };
      pending.set(key, entry);

      const last: number = sentAt.get(key) ?? 0;
      const elapsed = now() - last;
      if (last === 0 || elapsed >= interval) {
        flush(agentId, sessionId, projectId);
        return true;
      }
      // 规则 2：窗口内 → 合并成一次尾随发送（不丢最后一次状态）
      if (entry.timer === undefined) {
        entry.timer = setTimeout(() => flush(agentId, sessionId, projectId), interval - elapsed);
        entry.timer.unref?.();
      }
      return false;
    },

    /** 终态（done / error）：清掉运行态 + 带 unread / failure / lastActivityAt，**立即发、不节流**。 */
    pushTerminal(agentId: string, sessionId: string, projectId: string | undefined, patch: RowPatchState): void {
      const key = keyOf(agentId, sessionId);
      const entry = pending.get(key);
      if (entry?.timer !== undefined) { clearTimeout(entry.timer); entry.timer = undefined; }
      pending.delete(key);
      sentAt.set(key, now());
      lastSent.set(key, null);
      const full: RowPatchState = { running: null, ...patch };
      send(agentId, sessionId, projectId, full);
    },

    /** 非运行态变化（重命名 / 切 Task）：低频用户动作，立即发。 */
    pushNow(agentId: string, sessionId: string, projectId: string | undefined, patch: RowPatchState): void {
      send(agentId, sessionId, projectId, patch);
    },

    /** 测试与收尾用：把还在排队的补丁全部发出。 */
    flushAll(): void {
      for (const [key, entry] of Array.from(pending.entries())) {
        if (entry.timer !== undefined) clearTimeout(entry.timer);
        const [agentId, sessionId] = key.split("\u0000");
        if (agentId === undefined || sessionId === undefined) continue;
        flush(agentId, sessionId, undefined);
      }
    },

    /** 会话被删除：丢掉它的登记。 */
    forget(agentId: string, sessionId: string): void {
      const key = keyOf(agentId, sessionId);
      const entry = pending.get(key);
      if (entry?.timer !== undefined) clearTimeout(entry.timer);
      pending.delete(key);
      sentAt.delete(key);
      lastSent.delete(key);
    },

    /** 诊断：还有多少会话在排队。 */
    size(): number {
      return pending.size;
    },
  };
}

/** 生产实例（进程级单例）：`runTurn` 推、`subscribeBus` 消费。 */
let shared: RowPatchPublisher | undefined;
export function rowPatches(): RowPatchPublisher {
  shared ??= createRowPatchPublisher();
  return shared;
}

/**
 * 流事件 → 列表用的 phase / 工具名。
 *
 * 只映射**状态切换**（thinking 开始 / 工具开始 / 文本开始），**不映射增量**：
 * - `thinking` 事件既在"开始"也在"每次增量"出现，这里统一记 `thinking` —— 去重交给调用方
 *   （`pushRunning` 只在值变化时发，同一个 `thinking` 连续来不会重复推）；
 * - `delta`（正文增量）只表示"在输出文本"，记 `text`；
 * - `tool_start` 带工具名，记 `tool` + 工具名。
 *
 * 为什么不用 `derivePhase()`（`src/peer.ts:400`）：那个函数需要读**会话历史最后一块**，
 * 每来一个流事件都去读一次投影代价太高；这里用事件自身携带的信息，零额外 IO。
 */
export function phaseOfStreamEvent(event: { type: string; name?: unknown }): { phase?: string; tool?: string } | undefined {
  if (event.type === "thinking") return { phase: "thinking" };
  if (event.type === "delta") return { phase: "text" };
  if (event.type === "tool_start") {
    return typeof event.name === "string" && event.name !== ""
      ? { phase: "tool", tool: event.name }
      : { phase: "tool" };
  }
  return undefined;
}
