// 服务端未读事实（任务 0007 P2）：每个会话记 completedAt（最近一次终态）与 viewedAt（用户在前台查看的最近时间）。
// 未读 = completedAt 晚于 viewedAt。为什么放服务端而不是前端 localStorage：
// 完成发生在后台（用户没在看），前端不一定在线；重启后未读必须还在（opencode/Open WebUI 同样把未读放服务端）。
//
// 写入策略：
// - 完成（markCompleted）：立即落盘（低频，且丢了就是"完成却没提示"）；
// - 查看（markViewed）：每个会话 throttleMs 内最多落一次；窗口内的变化由尾随定时器补写（不丢、不写放大）。
// 文件：~/.lifeos/state/session-views.json（运行数据，不入库，见 state/AGENTS.md）。
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { resolveHome } from "./home.ts";
import { writeTextAtomic } from "./atomic-file.ts";

/**
 * 会话的**最近一次终态**（Task 0005 · P8-1）。
 *
 * 为什么记在这里（而不是每次去扫会话文件）：聚合"每个 Agent 有几个失败会话"时，
 * 唯一没有索引的事实就是 failure —— 实测扫 69 个文件 156ms、经 sessionRowsOf 全链路 532ms。
 * 而终态在回合结束时**本来就已算出**（`agent-host.ts` 的 `classifyFailure`），
 * 顺手写进这条已有记录，失败查询就从"扫全盘"变成"读索引"（实测 0.3ms）。
 *
 * 与 `completedAt` 的关系：两者由同一次 `markCompleted` 写入，同生同灭；
 * `lastState` 描述"那一次是怎么结束的"。
 */
export type TurnState = "done" | "error";
export type TurnOutcome = { state: TurnState; failureKind?: string; failureDetail?: string };

export type UnreadItem = {
  agentId: string;
  sessionId: string;
  projectId?: string;
  completedAt: string;
  /** 这条未读是**失败**还是**成功**（决定进 unreadError 还是 unreadDone）。 */
  state?: TurnState;
  /** 失败时带上种类与原文（行对象直接用，不必回扫会话文件）。 */
  failureKind?: string;
  failureDetail?: string;
};

/** 聚合用的状态条目：比 UnreadItem 多带终态（不看已读，只看"有没有事发生"）。 */
export type StateItem = UnreadItem & { lastState?: TurnState; failureKind?: string; failureAt?: string; failureSeenAt?: string };

/**
 * 一条会话的结束事实。
 *
 * **失败与成功分开记**（2026-11-04 用户裁决）：
 * 一个会话可能先失败两次、后来成功了 —— 如果只存"最近一次终态"，
 * 那两次失败会被成功覆盖，用户永远看不到它们（实测过的真实情况）。
 *
 * 现在：
 *   · `completedAt` / `lastState` —— 最近一次的结束（成功或失败），用于行上的四态
 *   · `viewedAt` —— 用户看过"最近这次结束"的时间
 *   · `failureAt` / `failureKind` / `failureSeenAt` —— **失败独立的一套**：
 *     失败发生记 `failureAt`，用户看过才写 `failureSeenAt`。
 *     只要 `failureAt > failureSeenAt`（或从未看过），这个失败就一直算"待查看"，
 *     **后来的成功不会把它抹掉** —— 那是两件不同的事。
 */
type Entry = {
  completedAt?: string;
  viewedAt?: string;
  projectId?: string;
  lastState?: TurnState;
  failureKind?: string;
  /** 最近一次失败的时间（独立于 completedAt）。 */
  failureAt?: string;
  /** 用户看过这个失败的时间；`failureAt > failureSeenAt` 或缺失 = 未看。 */
  failureSeenAt?: string;
  /** 失败原文（不脱敏、不截断 —— 用户裁决）。索引里存它，行对象不必回扫文件。 */
  failureDetail?: string;
};

export type SessionViewsOptions = {
  now: () => number;
  load: () => Promise<string | undefined>;
  persist: (text: string) => Promise<void>;
  throttleMs: number;
};

export function createSessionViews(options: SessionViewsOptions) {
  const state = new Map<string, Entry>();
  const viewWrittenAt = new Map<string, number>();
  const trailing = new Set<string>();
  let chain: Promise<void> = Promise.resolve();
  const keyOf = (agentId: string, sessionId: string) => `${agentId}\u0000${sessionId}`;
  const entryOf = (agentId: string, sessionId: string): Entry => {
    const key = keyOf(agentId, sessionId);
    const existing = state.get(key);
    if (existing !== undefined) return existing;
    const created: Entry = {};
    state.set(key, created);
    return created;
  };
  const maxIso = (a: string | undefined, b: string): string => (a === undefined || Date.parse(b) > Date.parse(a) ? b : a);

  function persistNow(): void {
    const snapshot: Record<string, Entry> = {};
    for (const [key, entry] of state) snapshot[key] = { ...entry };
    const text = JSON.stringify(snapshot, null, 2) + "\n";
    chain = chain.then(() => options.persist(text)).catch(() => undefined);
  }

  return {
    /** 读盘并与内存合并（取较晚的时间戳）：启动前已发生的标记不会被旧文件覆盖。 */
    async load(): Promise<void> {
      const text = await options.load();
      if (text === undefined) return;
      const parsed = JSON.parse(text) as Record<string, Entry>;
      for (const [key, entry] of Object.entries(parsed)) {
        const current = state.get(key) ?? {};
        const projectId = entry.projectId ?? current.projectId;
        state.set(key, {
          ...(projectId !== undefined ? { projectId } : {}),
          ...(entry.completedAt !== undefined ? { completedAt: maxIso(current.completedAt, entry.completedAt) } : current.completedAt !== undefined ? { completedAt: current.completedAt } : {}),
          ...(entry.viewedAt !== undefined ? { viewedAt: maxIso(current.viewedAt, entry.viewedAt) } : current.viewedAt !== undefined ? { viewedAt: current.viewedAt } : {}),
          // 终态随记录一起恢复；取**较晚**那次（与 completedAt 同一判定）
          ...(entry.lastState !== undefined && (entry.completedAt === undefined || current.completedAt === undefined || Date.parse(entry.completedAt) >= Date.parse(current.completedAt))
            ? { lastState: entry.lastState, ...(entry.failureKind !== undefined ? { failureKind: entry.failureKind } : {}) }
            : current.lastState !== undefined ? { lastState: current.lastState } : {}),
          ...(current.lastState !== undefined && entry.lastState === undefined ? { lastState: current.lastState } : {}),
          // 失败是独立的一份：取较晚的失败时间与较晚的已看时间
          ...(entry.failureAt !== undefined ? { failureAt: maxIso(current.failureAt, entry.failureAt) } : current.failureAt !== undefined ? { failureAt: current.failureAt } : {}),
          ...(entry.failureSeenAt !== undefined ? { failureSeenAt: maxIso(current.failureSeenAt, entry.failureSeenAt) } : current.failureSeenAt !== undefined ? { failureSeenAt: current.failureSeenAt } : {}),
          ...(entry.failureDetail !== undefined ? { failureDetail: entry.failureDetail } : current.failureDetail !== undefined ? { failureDetail: current.failureDetail } : {}),
        });
      }
    },
    /**
     * 回填缺失的 projectId（旧记录没有这个字段）：resolve 返回 undefined 的保持不变。
     * 返回回填的条数；有变化才落盘。
     */
    async backfill(resolve: (agentId: string, sessionId: string) => Promise<string | undefined>): Promise<number> {
      let filled = 0;
      for (const [key, entry] of Array.from(state.entries())) {
        if (entry.completedAt === undefined || entry.projectId !== undefined) continue;
        const [agentId, sessionId] = key.split("\u0000");
        const projectId = await resolve(agentId ?? "", sessionId ?? "");
        if (projectId === undefined) continue;
        entry.projectId = projectId;
        filled += 1;
      }
      if (filled > 0) persistNow();
      return filled;
    },
    /**
     * 回填终态（`lastState`/`failureKind`）—— 给**旧版本写入的记录**补上（Task 0005 · P8）。
     *
     * 为什么必须有这一步：`lastState` 是本轮新加的字段，此前落盘的记录只有 `completedAt`。
     * 不做迁移的话，用户打开界面看到的是**全 0**（几十条会话都"结束过"却一个都不计），
     * 而且这个 0 会一直持续到那些会话各自重新跑一遍。
     *
     * 为什么可以推断：`completedAt` 存在 = 这条会话**确实结束过**；
     * 结束方式写在会话文件最后一条 assistant 的 `stopReason`/`errorMessage` 里
     * （调用方注入 `resolve` 去读，通常是 `classifyFailure`）。
     * 读不到（文件已删/没有 assistant）→ 返回 undefined，**这条保持缺失，不编造**。
     *
     * 只处理 `lastState === undefined` 的记录：已经有终态的一律不动（新记录是对的）。
     */
    async backfillOutcomes(resolve: (agentId: string, sessionId: string) => Promise<{
      outcome?: TurnOutcome;
      lastFailureAt?: string;
      lastFailureKind?: string;
    } | undefined>): Promise<number> {
      let filled = 0;
      for (const [key, entry] of Array.from(state.entries())) {
        if (entry.completedAt === undefined) continue;
        const [agentId, sessionId] = key.split("\u0000");
        const found = await resolve(agentId ?? "", sessionId ?? "").catch(() => undefined);
        if (found === undefined) continue;
        let changed = false;
        // ① 终态缺失才补（已有的不动 —— 新记录是对的）
        if (entry.lastState === undefined && found.outcome !== undefined) {
          entry.lastState = found.outcome.state;
          if (found.outcome.state === "error" && found.outcome.failureKind !== undefined) entry.failureKind = found.outcome.failureKind;
          else delete entry.failureKind;
          changed = true;
        }
        // ② **失败历史**缺失才补：这是本轮新增的独立字段。
        //    用户实测的现场：某会话失败三次后成功，lastState=done，
        //    若不单独补 failureAt，那三次失败永远不会出现在数字里。
        if (entry.failureAt === undefined && found.lastFailureAt !== undefined) {
          entry.failureAt = found.lastFailureAt;
          if (found.lastFailureKind !== undefined) entry.failureKind = found.lastFailureKind;
          // 已看过（viewedAt 晚于这次失败）→ 视为已看，避免把用户早就知道的旧失败又报一遍
          if (entry.viewedAt !== undefined && Date.parse(entry.viewedAt) >= Date.parse(found.lastFailureAt)) {
            entry.failureSeenAt = entry.viewedAt;
          }
          changed = true;
        }
        if (changed) filled += 1;
      }
      if (filled > 0) persistNow();
      return filled;
    },

    /**
     * 清理孤儿未读：只保留仍然存在的会话（exists 由调用方注入，通常是查会话文件）。
     * 为什么需要：修复前删除会话没有清未读，残留记录会让侧栏的蓝点永远去不掉（2026-10-25 实测）。
     */
    async prune(exists: (agentId: string, sessionId: string) => Promise<boolean>): Promise<number> {
      let removed = 0;
      for (const [key, entry] of Array.from(state.entries())) {
        if (entry.completedAt === undefined) continue;
        const [agentId, sessionId] = key.split("\u0000");
        if (await exists(agentId ?? "", sessionId ?? "")) continue;
        state.delete(key);
        viewWrittenAt.delete(key);
        removed += 1;
      }
      if (removed > 0) persistNow();
      return removed;
    },
    /** 会话被删除：连同未读记录一起遗忘（落盘）。 */
    forget(agentId: string, sessionId: string): void {
      const key = keyOf(agentId, sessionId);
      if (!state.delete(key)) return;
      viewWrittenAt.delete(key);
      persistNow();
    },
    /**
     * 记一次终态。
     *
     * `outcome` 决定 `lastState` / `failureKind`（Task 0005 · P8-1）：
     * 它们是聚合层回答"这个 Agent 有几个失败会话"的**唯一索引**，不写就得回扫会话文件。
     * 只在**这次确实更新了 completedAt** 时才写终态——旧终态不能被更早的补写覆盖。
     */
    markCompleted(agentId: string, sessionId: string, at: string, projectId?: string, outcome?: TurnOutcome): void {
      const entry = entryOf(agentId, sessionId);
      const previous = entry.completedAt;
      entry.completedAt = maxIso(entry.completedAt, at);
      if (projectId !== undefined && projectId !== "") entry.projectId = projectId;
      // 只有"这次比之前更晚"才更新终态：否则一条更早的补写会把最近一次失败/完成覆盖掉
      const isLatest = previous === undefined || Date.parse(at) >= Date.parse(previous);
      if (outcome !== undefined && isLatest) {
        entry.lastState = outcome.state;
        if (outcome.state === "error" && outcome.failureKind !== undefined) entry.failureKind = outcome.failureKind;
        else delete entry.failureKind;
      }
      // 失败**再独立记一份**：后来的成功会覆盖 lastState，但不该抹掉"曾经失败过且我没看过"。
      if (outcome?.state === "error") {
        entry.failureAt = maxIso(entry.failureAt, at);
        if (outcome.failureKind !== undefined) entry.failureKind = outcome.failureKind;
        if (outcome.failureDetail !== undefined) entry.failureDetail = outcome.failureDetail;
      }
      persistNow();
    },

    /**
     * 全量状态条目（**不看已读**）：聚合层用它数"每个 Agent 有几个在跑/待查看/失败"。
     *
     * 与 `unread()` 的区别：`unread()` 只给"还没看"的；这里给所有有过终态的会话，
     * 因为助手列要的是"这个 Agent 有什么动静"，与"用户看没看"无关（看没看由前端按 viewedAt 判）。
     */
    states(): StateItem[] {
      const out: StateItem[] = [];
      for (const [key, entry] of state) {
        if (entry.completedAt === undefined) continue;
        const [agentId, sessionId] = key.split("\u0000");
        out.push({
          agentId: agentId ?? "", sessionId: sessionId ?? "",
          ...(entry.projectId !== undefined ? { projectId: entry.projectId } : {}),
          completedAt: entry.completedAt,
          ...(entry.lastState !== undefined ? { lastState: entry.lastState } : {}),
          ...(entry.failureKind !== undefined ? { failureKind: entry.failureKind } : {}),
          ...(entry.failureAt !== undefined ? { failureAt: entry.failureAt } : {}),
          ...(entry.failureSeenAt !== undefined ? { failureSeenAt: entry.failureSeenAt } : {}),
          // viewedAt 不在这里暴露：本方法回答"发生了什么"，不回答"看没看"
        });
      }
      return out;
    },

    /** 某会话的最近终态（前端补丁与测试用）。 */
    outcomeOf(agentId: string, sessionId: string): { state: TurnState; failureKind?: string } | undefined {
      const entry = state.get(keyOf(agentId, sessionId));
      if (entry?.lastState === undefined) return undefined;
      return { state: entry.lastState, ...(entry.failureKind !== undefined ? { failureKind: entry.failureKind } : {}) };
    },
    markViewed(agentId: string, sessionId: string, at: string): void {
      const entry = entryOf(agentId, sessionId);
      entry.viewedAt = maxIso(entry.viewedAt, at);
      // 失败是**独立**的一份已读：看过就把失败也标掉，否则"失败后被成功覆盖"的情形
      // 会永远留着一条看不见的未读失败（用户实测："我感觉我没看，但也没显示"）。
      if (entry.failureAt !== undefined) entry.failureSeenAt = maxIso(entry.failureSeenAt, at);
      const key = keyOf(agentId, sessionId);
      const now = options.now();
      const last = viewWrittenAt.get(key);
      if (last === undefined || now - last >= options.throttleMs) {
        viewWrittenAt.set(key, now);
        persistNow();
        return;
      }
      if (trailing.has(key)) return;
      trailing.add(key);
      const timer = setTimeout(() => {
        trailing.delete(key);
        viewWrittenAt.set(key, options.now());
        persistNow();
      }, options.throttleMs - (now - last));
      timer.unref?.();
    },
    /**
     * "有结束但用户还没看"的会话（Task 0005 · 2026-11-04 改）。
     *
     * **失败与成功分别判断**：一个会话可能失败两次、后来成功 ——
     * 若只看"最近一次终态"，那两次失败会被成功覆盖，用户永远看不到（实测过的真实情况）。
     *
     * 规则：
     *   · 失败未看（`failureAt > failureSeenAt` 或从未看过）→ 报 `error`（**优先**：更需要处理）
     *   · 成功未看（`completedAt > viewedAt` 或从未看过）→ 报 `done`
     *   · 两者都看过 → 不报
     */
    unread(): UnreadItem[] {
      const out: UnreadItem[] = [];
      for (const [key, entry] of state) {
        const [agentId, sessionId] = key.split("\u0000");
        const base = {
          agentId: agentId ?? "", sessionId: sessionId ?? "",
          ...(entry.projectId !== undefined ? { projectId: entry.projectId } : {}),
        };
        const unseenFailure = entry.failureAt !== undefined
          && (entry.failureSeenAt === undefined || Date.parse(entry.failureAt) > Date.parse(entry.failureSeenAt));
        if (unseenFailure) {
          out.push({ ...base, completedAt: entry.failureAt!, state: "error", ...(entry.failureKind !== undefined ? { failureKind: entry.failureKind } : {}), ...(entry.failureDetail !== undefined ? { failureDetail: entry.failureDetail } : {}) });
          continue;
        }
        if (entry.completedAt === undefined) continue;
        const seen = entry.viewedAt !== undefined && Date.parse(entry.viewedAt) >= Date.parse(entry.completedAt);
        if (seen) continue;
        // 没有 lastState（旧记录）→ 不猜是成功还是失败，`state` 留空由聚合层丢弃。
        // 这不会漏掉"该显示的"：启动时的 backfillOutcomes 会从会话文件把它们补上。
        out.push({ ...base, completedAt: entry.completedAt, ...(entry.lastState !== undefined ? { state: entry.lastState } : {}) });
      }
      return out;
    },
    /** 等待已排队的写盘完成（测试与关闭前用）。 */
    flush(): Promise<void> {
      return chain;
    },
  };
}

const STATE_NOTE = `# state · 运行状态

- 背景：服务端的运行时状态（当前是各会话的未读/已读时间），由程序写入，随使用变化。
- 内容：session-views.json（会话 → 完成时间 / 查看时间）。不是给人读的文档，也不入库（~/.lifeos/.gitignore 已排除）。
- 何时读：排查"为什么有/没有未读点"时。
- 怎么用：不要手改；删除文件等于清空所有未读记录（下次完成会重新记录）。
`;

// —— 默认实例：按家目录分开（测试切换 LIFEOS_HOME 不串状态）——
const instances = new Map<string, ReturnType<typeof createSessionViews>>();
const loads = new Map<string, Promise<void>>();

/** 等待当前家目录的未读状态读盘完成（清理孤儿记录前必须等，否则读盘会把旧记录合并回来）。 */
export function sessionViewsReady(): Promise<void> {
  sessionViewsOf();
  return loads.get(resolveHome()) ?? Promise.resolve();
}

export function sessionViewsOf(): ReturnType<typeof createSessionViews> {
  const home = resolveHome();
  const existing = instances.get(home);
  if (existing !== undefined) return existing;
  const dir = join(home, "state");
  const file = join(dir, "session-views.json");
  const created = createSessionViews({
    now: () => Date.now(),
    load: () => readFile(file, "utf8").catch(() => undefined),
    persist: async (text) => {
      await writeTextAtomic(file, text);
      // 协议 §5.2：每个目录都有说明文件（运行数据目录也一样），由创建者补上
      await writeFile(join(dir, "AGENTS.md"), STATE_NOTE, { flag: "wx", mode: 0o600 }).catch(() => undefined);
    },
    throttleMs: 5000,
  });
  instances.set(home, created);
  loads.set(home, created.load().catch(() => undefined));   // 启动即读盘；读失败不阻断（未读从空开始，日志由调用方记录）
  return created;
}
