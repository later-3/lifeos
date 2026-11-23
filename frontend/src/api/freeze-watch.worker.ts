/// <reference lib="webworker" />
/**
 * 冻结看门狗的 **Worker 侧**（Task 0033 · P0）。
 *
 * ## 为什么必须是独立线程
 *
 * `01-background.md` E5 的结构性事实：现有全部观测（logger / watchdog / 心跳）都在主线程。
 * 主线程冻住 → `setInterval` 不跑 → 什么都不记。三天四次卡死、前端日志零痕迹，根因就是这一条。
 *
 * 所以判定"主线程是否冻住"这件事，**必须由不受冻结影响的执行体来做**。浏览器里唯一的选择是 Worker。
 * 它的 `fetch` 也不依赖主线程，因此"冻结期间就能上报"成立（验收 #2）。
 *
 * ## 为什么判定逻辑不写在这里
 *
 * Worker 里的代码很难单测（要起真实 Worker）。所以阈值与纯函数都在 `freeze-watch-const.ts`，
 * 这里只做 I/O：收消息、计时、写 IndexedDB、发 fetch。这样"判定"可以被穷举测试，
 * 只有"搬运"留在这里。
 *
 * ## 上报为什么绕开 `api/logger.ts`
 *
 * `logger.flush()` 用主线程 fetch（`logger.ts:40`）——主线程冻住时它发不出，
 * 而"冻结期间就能上报"正是本任务的核心验收。所以这里**自己 fetch**，但复用
 * 同一个端点、同一份字段契约与同一组批上限（不制造第二套日志规则）。
 */

import {
  BEAT_MS,
  CHECK_MS,
  alreadyReported,
  freezeDurationOf,
  IDB_KEEP,
  MODULE_FREEZE,
  MODULE_LONG_TASK,
  MODULE_CLIENT,
  REPORT_JITTER_MS,
  REPORT_PERIOD_MS,
  chunkRows,
  frozenFor,
  longTaskBucket,
  type FreezeSnapshot,
  type LogRow,
  type TrailEntry,
} from "./freeze-watch-const";

type BeatMessage = {
  t: "beat";
  at: number;
  /** 只在"冻结恢复后"或每 N 拍带一次全量现场，避免每拍都搬运大对象。 */
  snapshot?: FreezeSnapshot;
  trail?: TrailEntry[];
};

type ReportMessage = {
  t: "report";
  row: LogRow;
};

type IncomingMessage = BeatMessage | ReportMessage;

/** Worker 全局（`self` 在 worker 里是 `DedicatedWorkerGlobalScope`）。 */
const workerScope = self as unknown as DedicatedWorkerGlobalScope;

/* ────────────────────────────── IndexedDB ────────────────────────────── */

/**
 * 落盘为什么用 IndexedDB 而不是 localStorage：
 * - localStorage 是同步 API，**写入会阻塞主线程**——在"刚恢复"的瞬间写等于二次伤害；
 * - localStorage 在 Worker 里根本不可用；
 * - 容量 5MB 且无事务。
 *
 * 保留条数 `IDB_KEEP = 50`：目的是"活过进程被杀"，不是做历史库。
 */
const DB_NAME = "lifeos-freeze-watch";
const STORE = "records";
const DB_VERSION = 1;

let dbPromise: Promise<IDBDatabase | undefined> | undefined;

function openDb(): Promise<IDBDatabase | undefined> {
  if (dbPromise !== undefined) return dbPromise;
  dbPromise = new Promise<IDBDatabase | undefined>((resolve) => {
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      resolve(undefined); // 隐私模式/被禁：降级为"只上报不落盘"，不能让观测本身把页面搞崩
      return;
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { autoIncrement: true });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(undefined);
  });
  return dbPromise;
}

/** 写一条待上传记录；失败静默（观测不能影响被观测对象）。 */
async function persist(row: LogRow | LogRow[]): Promise<void> {
  const db = await openDb();
  if (db === undefined) return;
  try {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    for (const item of Array.isArray(row) ? row : [row]) store.add(item);
    // 超量时删最旧的（autoIncrement key，取最小若干）
    const countRequest = store.count();
    countRequest.onsuccess = () => {
      const excess = countRequest.result - IDB_KEEP;
      if (excess <= 0) return;
      const cursorRequest = store.openCursor();
      let removed = 0;
      cursorRequest.onsuccess = () => {
        const cursor = cursorRequest.result;
        if (cursor === null || removed >= excess) return;
        cursor.delete();
        removed += 1;
        cursor.continue();
      };
    };
  } catch {
    /* 忽略：落盘是增强手段，不是必需路径 */
  }
}

/** 取出全部待上传记录（不删；上传成功才删，避免"读出来就丢了"）。 */
async function loadPersisted(): Promise<Array<{ key: IDBValidKey; row: LogRow }>> {
  const db = await openDb();
  if (db === undefined) return [];
  return await new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, "readonly");
      const store = tx.objectStore(STORE);
      const out: Array<{ key: IDBValidKey; row: LogRow }> = [];
      const cursorRequest = store.openCursor();
      cursorRequest.onsuccess = () => {
        const cursor = cursorRequest.result;
        if (cursor === null) { resolve(out); return; }
        out.push({ key: cursor.primaryKey, row: cursor.value as LogRow });
        cursor.continue();
      };
      cursorRequest.onerror = () => resolve(out);
    } catch {
      resolve([]);
    }
  });
}

async function deletePersisted(keys: readonly IDBValidKey[]): Promise<void> {
  if (keys.length === 0) return;
  const db = await openDb();
  if (db === undefined) return;
  try {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    for (const key of keys) store.delete(key);
  } catch {
    /* 忽略 */
  }
}

/* ────────────────────────────── 上报 ────────────────────────────── */

/**
 * 直接 `POST /api/logs`（**不走 logger**：它在主线程）。
 * 失败时把记录留在 IndexedDB 里，等下一次周期或下次启动补传。
 */
async function postRows(rows: readonly LogRow[]): Promise<boolean> {
  if (rows.length === 0) return true;
  let allOk = true;
  const { chunks } = chunkRows(rows);
  for (const batch of chunks) {
    try {
      const response = await fetch("/api/logs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ events: batch }),
      });
      if (response.ok !== true) allOk = false;
    } catch {
      allOk = false;
    }
  }
  return allOk;
}

/**
 * 上报并删掉已成功的落盘记录。
 * 顺序：先 POST 成功 → 再删；失败保留（下次补传）。
 */
async function flushPersisted(): Promise<void> {
  const pending = await loadPersisted();
  if (pending.length === 0) return;
  const ok = await postRows(pending.map((item) => item.row));
  if (ok) await deletePersisted(pending.map((item) => item.key));
}

/* ────────────────────────────── 状态 ────────────────────────────── */

let lastBeatAt = 0;
let lastKnown: { snapshot?: FreezeSnapshot; trail?: TrailEntry[] } = {};
/**
 * 这一段冻结是否已经报过（`> 0` = 是）。
 *
 * 第一版这里存的是"上次报的 gap"，并用 `gap === reportedForGap` 去重 —— 那等于没去重：
 * `frozenFor()` 返回的是"当前已冻多久"，同一段冻结每秒都在涨（3525 → 4525），
 * 于是同一段被报了两次（实测）。现在只存"有没有报过"，时长留给恢复时重算。
 */
let reportedThisFreeze = 0;
let pendingRows: LogRow[] = [];
let reportTimer: ReturnType<typeof setTimeout> | undefined;

function row(level: LogRow["level"], module: string, msg: string, details?: Record<string, unknown>): LogRow {
  return { ts: new Date().toISOString(), level, module, msg, details };
}

/**
 * 入队；真正的网络发送交给周期上报（抖动）或冻结立即上报。
 *
 * **不在这里落盘**：落盘是"发不出去时"的兜底（实测缺陷：入队就落盘 → 周期发送成功后又把
 * IndexedDB 里那份当"未发送"再发一次，日志里同一条出现两遍）。所以只在发送失败时 `persist`。
 */
function enqueue(item: LogRow): void {
  pendingRows.push(item);
}

function scheduleReport(): void {
  if (reportTimer !== undefined) return;
  const delay = REPORT_PERIOD_MS + Math.random() * REPORT_JITTER_MS;
  reportTimer = setTimeout(() => {
    reportTimer = undefined;
    void flushPeriodic();
    scheduleReport();
  }, delay);
}

async function flushPeriodic(): Promise<void> {
  if (pendingRows.length === 0) { void flushPersisted(); return; }
  const batch = pendingRows;
  pendingRows = [];
  const ok = await postRows(batch);
  if (!ok) {
    // 失败：这两件事都要做——写回内存队列（下个周期再试）+ 落盘（页面可能等不到下个周期就被杀）
    pendingRows = [...batch, ...pendingRows];
    for (const item of batch) void persist(item);
    return;
  }
  await flushPersisted();
}

/* ────────────────────────────── 冻结判定（核心） ────────────────────────────── */

/**
 * 检查主线程是否冻结。
 *
 * `frozenFor()` 是纯函数（`freeze-watch-const.ts`），这里只负责"发现冻结之后做什么"：
 *   1. **立即**上报（不等周期）——这是验收 #2 的要求；
 *   2. 记录冻结时长 + 最后已知的现场 + 动作轨迹；
 *   3. 同一段冻结只报一次（`reportedForGap`），避免每秒刷一条。
 */
function checkFreeze(): void {
  const now = Date.now();
  /*
   * visibility 来自最后一次 beat 的快照：隐藏标签页会被浏览器节流到 60 秒一次定时器，
   * 若不区分，每分钟都会误报一条"冻结 60 秒"（2026-11-23 实测 7 条假阳性）。
   * 阈值见 `THROTTLED_FROZEN_MS`。
   */
  const visible = lastKnown.snapshot?.visibility === "visible";
  const gap = frozenFor(lastBeatAt, now, visible);
  if (gap === 0) return;                     // 没冻（恢复由 heartbeat 分支处理）
  if (alreadyReported(reportedThisFreeze)) return;   // 这一段已经报过

  reportedThisFreeze = gap;
  const snapshot = lastKnown.snapshot;
  const freezeRow = row("error", MODULE_FREEZE, "主线程冻结", {
    durationMs: gap,
    startedAt: new Date(lastBeatAt).toISOString(),
    detectedAt: new Date(now).toISOString(),
    ...(snapshot !== undefined ? { snapshot } : {}),
    ...(lastKnown.trail !== undefined ? { trail: lastKnown.trail } : {}),
  });
  // 冻结记录必须**先**发出去（用户最需要的就是它），再补周期里的其他行。
  void (async () => {
    const ok = await postRows([freezeRow]);
    if (!ok) await persist(freezeRow);   // 发不出去就落盘，下次启动补传
    else await flushPersisted();
  })();
}

/* ────────────────────────────── 消息入口 ────────────────────────────── */

workerScope.addEventListener("message", (event: MessageEvent<IncomingMessage>) => {
  const data = event.data;
  if (data === null || typeof data !== "object") return;

  if (data.t === "beat") {
    /*
     * 注意顺序：先判"上一段是否已报"（用旧的 lastBeatAt 算时长），再更新 lastBeatAt。
     * 反了就算不出恢复时长（会把这次报活自己当起点，得到 0）。
     */
    const previousBeatAt = lastBeatAt;
    lastBeatAt = data.at;
    if (data.snapshot !== undefined) lastKnown.snapshot = data.snapshot;
    if (data.trail !== undefined) lastKnown.trail = data.trail;
    /*
     * 恢复后的第一条 heartbeat 是"我活过来了"的信号：此时报一次恢复记录，
     * 让日志里能配对"冻结 → 恢复"（只有冻结没有恢复，读日志的人会以为还没结束）。
     */
    if (alreadyReported(reportedThisFreeze)) {
      /*
       * 恢复时长必须用"最后一次报活 → 这次报活"重算：
       * 冻结是在**进行中**上报的（及时性），那时只知道"至少冻了 3 秒"；
       * 实测 5 秒冻结在检测时报 3525ms，恢复后才发现真实是 5005ms。
       * 只用检测时的值会让所有记录的时长系统性偏小。
       */
      const durationMs = freezeDurationOf(previousBeatAt, data.at);
      reportedThisFreeze = 0;
      enqueue(row("info", MODULE_FREEZE, "主线程恢复", { durationMs, at: new Date(data.at).toISOString() }));
      void flushPeriodic();
    }
    return;
  }

  if (data.t === "report") {
    const item = data.row;
    if (item.module === MODULE_LONG_TASK) {
      // 长任务合并：同一量级 + 同一分钟 → 计数（避免一次卡顿刷几百条）
      const bucket = longTaskBucket(Number(item.details?.durationMs ?? 0));
      const minute = item.ts.slice(0, 16);
      const existing = pendingRows.find((candidate) =>
        candidate.module === MODULE_LONG_TASK
        && candidate.ts.slice(0, 16) === minute
        && candidate.details?.bucket === bucket);
      if (existing !== undefined) {
        existing.details = { ...existing.details, count: Number(existing.details?.count ?? 1) + 1 };
        return;
      }
      enqueue(row("warn", MODULE_LONG_TASK, "长任务", { ...item.details, bucket }));
      return;
    }
    if (item.module === MODULE_CLIENT) {
      // 页面 JS 报错：立即发（这是"崩了"级别的事实，不该等周期）
      enqueue(item);
      void flushPeriodic();
      return;
    }
    enqueue(item);
  }
});

/* ────────────────────────────── 启动 ────────────────────────────── */

/**
 * 启动时的第一件事是**补传上次没成功的记录**（验收 #3）：
 * 页面被强杀 / OOM / 用户 3 秒内关标签，落盘那份是唯一的证词。
 */
void (async () => {
  await flushPersisted();
  scheduleReport();
})();

setInterval(checkFreeze, CHECK_MS);

/** 心跳间隔导出给主线程对齐（主线程按它发 beat，避免两边各写一个数字）。 */
export const BEAT_INTERVAL_MS = BEAT_MS;
