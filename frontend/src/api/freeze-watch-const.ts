/**
 * 冻结观测定值（Task 0033 · P0）。
 *
 * ## 为什么阈值单独一个文件
 *
 * 这些数字要能被**测试**与**设计文档**同时引用（`02-design.md` §3 有逐个出处）。
 * 散在实现里会让"改了一个数、文档没改"变成静默漂移；集中在这里，改一个数就必须面对它的依据。
 *
 * ## 每个数字的出处（不写"看起来合理"）
 *
 * - `BEAT_MS = 500`：让冻结检测的分辨率达到 0.5s；postMessage 同进程开销 ~µs，500ms 一次可忽略。
 * - `FROZEN_MS = 3000`：用户的描述是"点不了"。低于 3s 的停顿通常被忍掉、事后也记不住；
 *   ≥3s 才够得上"卡死"。与前端规范的读请求超时（15s/10s，code.md 2.33）不冲突——那管网络，这管主线程。
 * - `LONG_TASK_MS = 100`：抄 open-design `observability/long-task.ts:12-14`（原文：浏览器已按 50ms
 *   过滤，提到 100ms 把事件量减半而仍覆盖人能感知的任务），A 级源码可核。
 * - `REPORT_PERIOD_MS / REPORT_JITTER_MS`：抄 mattermost `performance_telemetry/reporter.ts`
 *   的 `reportPeriodBase = 60_000` / `reportPeriodJitter = 15_000`（A 级）。抖动的用途是
 *   避免多个标签页在同一秒齐发。
 * - `TRAIL_MAX = 40`：一次卡死的因果链通常 ≤10 个动作，留 4 倍余量；40 × ~40B ≈ 1.6KB，
 *   远低于 `/api/logs` 单批 16KiB 上限（`src/server.ts:665`）。
 * - `UPLOAD_BATCH_MAX / UPLOAD_BODY_MAX`：与 `api/logger.ts` 保持**同一组**上限，避免同一端点两套规则。
 * - `IDB_KEEP = 50`：只保留最近 50 条未发送/已发送记录；目的是"活过进程被杀"，不是做历史库。
 */

/** 主线程给 Worker 的报活间隔。 */
export const BEAT_MS = 500;

/** 多久没收到报活就判定主线程冻结。 */
export const FROZEN_MS = 3_000;

/** Worker 检查报活的时间粒度（≤ FROZEN_MS 的一半，保证判定误差不超过这个值）。 */
export const CHECK_MS = 1_000;

/** 长任务观测阈值。 */
export const LONG_TASK_MS = 100;

/** 周期上报基础间隔与抖动上限。 */
export const REPORT_PERIOD_MS = 60_000;
export const REPORT_JITTER_MS = 15_000;

/** 动作轨迹环形缓冲容量。 */
export const TRAIL_MAX = 40;

/** 与 `api/logger.ts` 相同的批上限（同一个端点，同一套规则）。 */
export const UPLOAD_BATCH_MAX = 50;
export const UPLOAD_BODY_MAX = 16 * 1024;

/** IndexedDB 里保留的记录条数。 */
export const IDB_KEEP = 50;

/** 日志 module 名（与后端模块对齐；新增三个）。 */
export const MODULE_FREEZE = "freeze";
export const MODULE_LONG_TASK = "longtask";
export const MODULE_CLIENT = "client";

/** 一条动作轨迹。只记"做了什么"，不记正文（规范：日志不写正文与凭据）。 */
export type TrailEntry = { at: number; what: string };

/**
 * 冻结现场快照：只放能解释"为什么卡"的因子。
 *
 * 字段选择依据见 `02-design.md` §4；`domNodes` 与 `messages` 的对照是
 * "渲染规模"的硬指标（2026-11-21 实测 1860 条消息 → 15,990 节点）。
 */
export type FreezeSnapshot = {
  agentId?: string;
  sessionId?: string;
  messages: number;
  visibleCount: number;
  domNodes: number;
  busy: boolean;
  phase?: string;
  activeTool?: string;
  panelOpen?: boolean;
  historyOpen?: boolean;
  reviewOpen?: boolean;
  visibility: string;
};

/** 一条待上报的记录（字段与 `/api/logs` 的既有契约一致）。 */
export type LogRow = {
  ts: string;
  level: "error" | "warn" | "info" | "debug";
  module: string;
  msg: string;
  details?: Record<string, unknown>;
};

/**
 * 冻结判定的纯函数（可穷举单测，不在 Worker 里写判断逻辑）。
 *
 * @param lastBeatAt 最近一次收到报活的时刻（0 = 还没收到过）
 * @param now        判定时刻
 * @returns 冻结时长（ms）；未冻结返回 0
 *
 * 边界：`lastBeatAt === 0` 表示 Worker 刚起来、主线程还没报活 —— **不算冻结**
 * （页面正在加载，主线程本来就忙着；这段由 longtask 覆盖）。
 */
export function frozenFor(lastBeatAt: number, now: number, visible: boolean = true): number {
  if (lastBeatAt <= 0) return 0;
  const gap = now - lastBeatAt;
  /*
   * **隐藏标签页必须用更高的阈值**（2026-11-23 真实现场抓到）。
   *
   * Chrome/Edge 对隐藏标签页做 intensive throttling：`setInterval` 被压到**每分钟一次**。
   * 主线程的 beat（500ms）与 Worker 的 check（1000ms）**同时**被压，
   * 于是 Worker 每分钟醒来都看到"60 秒没报活" → 报一条"冻结 60 秒"。
   *
   * 实测那天：连续 7 条假记录（53000/60012/59772/60000/59998/59999/44498ms，
   * 全部 `visibility: hidden`），而真正的冻结只有 1 条（`visible`，3523ms）。
   * 假阳性比真事故多 7 倍 —— 不修就等于把日志淹掉。
   *
   * 判据：隐藏时阈值必须高于节流周期（60 秒），取 `THROTTLED_FROZEN_MS = 90_000`。
   * 代价：真正在后台卡死时，要 90 秒才报（但会带着真实时长，不丢信息）。
   */
  const threshold = visible ? FROZEN_MS : THROTTLED_FROZEN_MS;
  return gap >= threshold ? gap : 0;
}

/**
 * 超过这个时长就不当作"主线程冻结"，而是"标签页被浏览器挂起过"。
 *
 * ## 为什么需要（2026-11-23 真实现场抓到的第二类假阳性）
 *
 * 日志里出现 **206 条** `durationMs ≈ 3,153,xxx,xxx`（36.5 天）的记录：
 * `startedAt = 2026-10-18T04:00:29`（上一次页面能跑的时刻），
 * 今天解冻时报"冻结 36 天"，并且**每秒一条、连刷两小时**。
 *
 * 真因：Chrome 的 tab 挂起/内存回收（Memory Saver 之类）会把整个标签页停掉。
 * 解冻后 Worker 醒来，看到的 gap 是"上次 beat 到现在"，于是报成冻结。
 *
 * 这不是主线程被 JS 卡住，**证据价值为零**，而且会把真记录淹掉
 * （那天真记录 1 条、假记录 200+ 条）。
 *
 * ## 为什么取 1 小时
 *
 * 真人不会盯着"卡死 1 小时以上"还继续用同一个标签页：真卡死超过 1 小时，
 * 用户早就关掉或重启了（实测最长真事故是 11 小时满核，但那是**进程**在烧，
 * 页面自己的 beat 早就停了 —— 那种情况由"恢复记录缺失"表达，而不是靠超长 duration）。
 * 1 小时是"明显不像 interacted-by-human"的量级分界，不是精确科学。
 */
export const TAB_SUSPEND_MS = 60 * 60 * 1000;

/**
 * 判断一条冻结记录是否"像是标签页被挂起"而不是主线程卡死。
 *
 * @param durationMs 观测到的间隔
 * @param visible    最后一次快照里的 visibility
 * @returns true = 记录应标为 `tab-suspended`，不作为冻结事故
 */
export function looksLikeTabSuspend(durationMs: number, visible: boolean): boolean {
  if (durationMs >= TAB_SUSPEND_MS) return true;
  /* 隐藏页只有超过 90 秒才算（节流阈值见 THROTTLED_FROZEN_MS） */
  return !visible && durationMs >= THROTTLED_FROZEN_MS;
}

/**
 * 隐藏标签页的冻结阈值。
 *
 * 为什么是 90 秒：Chrome 的 intensive throttling 把隐藏页的定时器压到 **60 秒一次**
 * （见 https://developer.chrome.com/blog/timer-throttling-in-chrome-88 与实测：
 * 隐藏期的 7 条记录全部落在 44–60 秒）。阈值必须显著高于 60，否则每次节流都会被当成冻结；
 * 90 秒留出 1.5× 余量，同时保证"后台真的卡死 90 秒以上"仍然能被记录。
 */
export const THROTTLED_FROZEN_MS = 90_000;

/**
 * 这一段冻结是否**已经报过**。
 *
 * 为什么需要这个判断：`checkFreeze` 每秒跑一次，而 `frozenFor()` 返回的是"当前已冻结多久"——
 * 同一个冻结块在第 1 秒是 3525ms、第 2 秒是 4525ms，**每次都不同**。第一版用
 * `gap === reportedForGap` 去重，等于没去重（实测同一段 5 秒冻结被报了 2 条，日志里读起来
 * 像"卡了两次"）。正确判据是"这一段是否已报"，与 gap 的具体值无关。
 *
 * @param reportedForThisFreeze 该段冻结已上报过（>0）；`0` 表示当前没有已上报的冻结
 */
export function alreadyReported(reportedForThisFreeze: number): boolean {
  return reportedForThisFreeze > 0;
}

/**
 * 冻结的真实时长：最后一次报活 → 恢复后的第一次报活。
 *
 * 为什么不能直接用检测时的 gap：检测发生在冻结**进行中**（第一次发现即上报，为了及时性），
 * 那时只知道"至少冻了 3 秒"。真实时长要到恢复才完整（实测：检测报 3525ms，实际 5005ms）。
 * 所以恢复记录必须用这个函数重算，否则日志里的时长系统性偏小。
 */
export function freezeDurationOf(lastBeatBeforeFreeze: number, firstBeatAfterFreeze: number): number {
  if (lastBeatBeforeFreeze <= 0) return 0;
  return Math.max(0, firstBeatAfterFreeze - lastBeatBeforeFreeze);
}

/** 动作轨迹入栈（保留最近 `TRAIL_MAX` 条）。返回新数组，不改入参（便于测试与冻结时取快照）。 */
export function pushTrail(trail: readonly TrailEntry[], at: number, what: string, max: number = TRAIL_MAX): TrailEntry[] {
  const next = [...trail, { at, what }];
  return next.length > max ? next.slice(next.length - max) : next;
}

/**
 * 长任务聚合键：把同一量级、同一时间窗的任务合并计数。
 *
 * 为什么按量级分桶：单个 delta 造成的 120ms 与一次布局风暴的 800ms 意义完全不同，
 * 合并成一个数字就看不出来了。量级 = 向下取整到 100ms 的倍数。
 */
export function longTaskBucket(durationMs: number): number {
  return Math.max(1, Math.floor(durationMs / LONG_TASK_MS)) * LONG_TASK_MS;
}

/**
 * 上报批的分片（与 `/api/logs` 的 50 条 / 16KiB 上限一致）。
 *
 * 两种"放不下"要分开处理，不能一视同仁：
 * - **一片装不下更多**：正常分片，谁都不丢；
 * - **单条自己就超 16KiB**：这条永远发不出去，只能丢掉，并把丢了几条报给调用方（不能静默）。
 */
export function chunkRows(rows: readonly LogRow[]): { chunks: LogRow[][]; dropped: number } {
  const chunks: LogRow[][] = [];
  let current: LogRow[] = [];
  let dropped = 0;
  for (const row of rows) {
    // 单条就超限：直接丢（发出去也会被后端 400），但计数上报
    if (JSON.stringify({ events: [row] }).length > UPLOAD_BODY_MAX) { dropped += 1; continue; }
    const candidate = [...current, row];
    const size = JSON.stringify({ events: candidate }).length;
    if (candidate.length > UPLOAD_BATCH_MAX || size > UPLOAD_BODY_MAX) {
      if (current.length > 0) chunks.push(current);
      current = [row];
      continue;
    }
    current = candidate;
  }
  if (current.length > 0) chunks.push(current);
  return { chunks, dropped };
}
