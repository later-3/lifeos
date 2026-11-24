/**
 * 冻结观测的 **主线程侧**（Task 0033 · P0/P1/P2）。
 *
 * 分工：
 * - 主线程：定时报活（beat）、维护动作轨迹（trail）、维护现场快照（snapshot）、
 *   装 longtask 观测、装全局错误上报；
 * - Worker（`freeze-watch.worker.ts`）：判定冻结、冻结期间上报、落盘、周期上报。
 *
 * ## 为什么主线程只"报活"，不"判定"
 *
 * 判定需要"在没人报活时还能继续跑"的能力——主线程一旦冻住就没有这个能力。
 * 所以判定与上报全部下沉到 Worker；主线程做的唯一一件事是**证明自己还活着**。
 *
 * ## 为什么快照走 `freeze-snapshot.ts` 的寄存器，而不是传闭包进来
 *
 * 闭包要读 App 的 state，就必须把新对象传进来——那会参与渲染，违背"观测不改变被观测对象"。
 * 寄存器是模块级可变对象：App 在已有 effect 里顺手写几个字段（一次属性赋值），
 * 这里每 2 秒读一次。没有新 state、没有新渲染。
 */

import {
  BEAT_MS,
  FROZEN_MS,
  LONG_TASK_MS,
  MODULE_CLIENT,
  MODULE_LONG_TASK,
  TRAIL_MAX,
  pushTrail,
  type FreezeSnapshot,
  type TrailEntry,
} from "./freeze-watch-const";
import { readSnapshot } from "./freeze-snapshot";

export type WatchHandle = {
  /** 记录一个动作（只写"做了什么"，不写正文）。 */
  trail: (what: string) => void;
  /** 主动刷新一次快照（重大动作后调用，让冻结记录尽量新鲜）。 */
  refresh: () => void;
  /** 卸载（测试用）。 */
  stop: () => void;
};

let handle: WatchHandle | undefined;

/**
 * 安装冻结观测。**幂等**：重复调用返回同一个句柄（StrictMode 会双跑 effect）。
 */
export function installFreezeWatch(): WatchHandle {
  if (handle !== undefined) return handle;

  let trailState: TrailEntry[] = [];
  let seq = 0;
  let stopped = false;

  const worker = new Worker(new URL("./freeze-watch.worker.ts", import.meta.url), { type: "module" });
  // Worker 自身出错不能影响页面：静默降级（观测失败 ≠ 应用失败）
  worker.addEventListener("error", () => { /* 降级：只剩 longtask 与全局错误的主线程路径 */ });

  const safeSnapshot = (): FreezeSnapshot => {
    try {
      return readSnapshot();
    } catch {
      // 快照自己出错不能拖死观测：给一份"未知"，而不是让 postMessage 抛
      return { messages: -1, visibleCount: -1, domNodes: -1, busy: false, visibility: "unknown" };
    }
  };

  const beat = (): void => {
    if (stopped) return;
    seq += 1;
    const at = Date.now();
    /*
     * 每 4 拍（2s）带一次快照，其余只报活。
     * 理由：快照里有 `domNodes`（遍历 DOM，15,990 节点实测 1–3ms）。每 500ms 算一次
     * 等于白送 0.2–0.6% CPU；而冻结判定粒度本来就是 3s，落后 2s 不损失信息。
     */
    const withSnapshot = seq % 4 === 1;
    worker.postMessage({
      t: "beat",
      at,
      ...(withSnapshot ? { snapshot: safeSnapshot(), trail: trailState } : {}),
    });
  };

  const timer = setInterval(beat, BEAT_MS);
  beat();   // 立刻报第一拍：否则 Worker 要等 500ms 才知道页面在跑

  const trailFn = (what: string): void => {
    trailState = pushTrail(trailState, Date.now(), what, TRAIL_MAX);
  };

  const refresh = (): void => {
    if (stopped) return;
    worker.postMessage({ t: "beat", at: Date.now(), snapshot: safeSnapshot(), trail: trailState });
  };

  /* ── 长任务观测（P1）：阈值与理由见 freeze-watch-const.ts ── */
  let observer: PerformanceObserver | undefined;
  try {
    const supported = PerformanceObserver.supportedEntryTypes?.includes?.("longtask") === true;
    if (supported) {
      observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (entry.duration < LONG_TASK_MS) continue;
          const attribution = (entry as unknown as {
            attribution?: Array<{ containerType?: string; containerName?: string }>;
          }).attribution?.[0];
          const snapshot = safeSnapshot();
          worker.postMessage({
            t: "report",
            row: {
              ts: new Date().toISOString(),
              level: "warn",
              module: MODULE_LONG_TASK,
              msg: "长任务",
              details: {
                durationMs: Math.round(entry.duration),
                startMs: Math.round(entry.startTime),
                ...(attribution?.containerType !== undefined ? { containerType: attribution.containerType } : {}),
                domNodes: snapshot.domNodes,
                messages: snapshot.messages,
              },
            },
          });
        }
      });
      observer.observe({ type: "longtask", buffered: true } as PerformanceObserverInit);
    }
  } catch {
    observer = undefined;   // Safari/Firefox 无 longtask：降级为"只报冻结"
  }

  /* ── 全局错误（P2）：现在页面 JS 崩了是一条都不上报的 ── */
  const onError = (event: ErrorEvent): void => {
    worker.postMessage({
      t: "report",
      row: {
        ts: new Date().toISOString(),
        level: "error",
        module: MODULE_CLIENT,
        msg: "未捕获异常",
        details: {
          message: String(event.message ?? "").slice(0, 300),
          source: String(event.filename ?? "").slice(0, 200),
          line: event.lineno,
          col: event.colno,
        },
      },
    });
  };
  const onRejection = (event: PromiseRejectionEvent): void => {
    const reason = event.reason as { message?: unknown } | undefined;
    worker.postMessage({
      t: "report",
      row: {
        ts: new Date().toISOString(),
        level: "error",
        module: MODULE_CLIENT,
        msg: "未处理的 Promise 拒绝",
        details: { message: String(reason?.message ?? event.reason ?? "").slice(0, 300) },
      },
    });
  };
  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);

  handle = {
    trail: trailFn,
    refresh,
    stop: () => {
      stopped = true;
      clearInterval(timer);
      observer?.disconnect();
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
      worker.terminate();
      handle = undefined;
    },
  };
  return handle;
}

/** 取已安装的句柄（未安装时为 undefined）。 */
export function freezeWatch(): WatchHandle | undefined {
  return handle;
}

/** 记录一个动作；未安装时是 no-op（测试与局部渲染不需要观测）。 */
export function trail(what: string): void {
  handle?.trail(what);
}

/** 刷新快照；未安装时是 no-op。 */
export function refreshSnapshot(): void {
  handle?.refresh();
}

/** 冻结判定阈值导出给文档/测试引用（避免两处写死同一个数字）。 */
export const FROZEN_THRESHOLD_MS = FROZEN_MS;
