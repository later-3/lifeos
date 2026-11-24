/**
 * 冻结观测的现场快照**寄存器**（Task 0033 · P0）。
 *
 * ## 为什么用一个可变对象，而不是让 App 通过 props/context 传
 *
 * 快照要读到 App 的内部状态（当前会话、消息条数、渲染窗口、界面开关）。
 * 如果用 props/context 传，就得让 App 每次都把新对象传下去 —— 那会参与渲染、可能触发重渲染，
 * 而观测的第一原则是**不改变被观测对象的行为**。
 *
 * 所以这里是一个模块级可变对象：App 在**已有的 effect/事件**里顺手写几个字段（赋值成本 ~ns），
 * Worker 侧每 2 秒读一次。没有新的 state、没有新的渲染。
 *
 * ## 为什么 `domNodes` 不在每次读取时算
 *
 * `document.getElementsByTagName("*").length` 在 15,990 节点时约 1–3ms（2026-11-21 实测）。
 * 每 500ms 算一次是白送 CPU。所以它是**惰性**的：由 `sampleDomNodes()` 在快照被真正打包时
 * 才算（每 2 秒一次），并且带一个下限间隔防止被高频调用。
 */

import type { FreezeSnapshot } from "./freeze-watch-const";

type LiveFields = Omit<FreezeSnapshot, "domNodes" | "visibility">;

let live: LiveFields = {
  messages: 0,
  visibleCount: 0,
  busy: false,
};

/** App 调用：更新字段（只写变化的部分，成本约等于一次属性赋值）。 */
export function updateSnapshot(fields: Partial<LiveFields>): void {
  live = { ...live, ...fields };
}

/** 读取当前快照（含 DOM 节点数与可见性）。 */
export function readSnapshot(): FreezeSnapshot {
  return {
    ...live,
    domNodes: domNodeCount(),
    visibility: typeof document === "undefined" ? "unknown" : document.visibilityState,
  };
}

/**
 * DOM 节点数。
 *
 * 用一个 500ms 的缓存：快照本身每 2 秒打包一次，缓存足以覆盖；
 * 而 longtask 回调里也会读它（同一毫秒内可能有多个长任务），没有缓存就是重复的 O(n) 遍历。
 */
const DOM_CACHE_MS = 500;
let domCacheAt = 0;
let domCacheValue = 0;

function domNodeCount(): number {
  if (typeof document === "undefined") return -1;
  const now = Date.now();
  if (now - domCacheAt < DOM_CACHE_MS) return domCacheValue;
  domCacheAt = now;
  domCacheValue = document.getElementsByTagName("*").length;
  return domCacheValue;
}

/** 仅测试用：重置寄存器（避免用例之间串状态）。 */
export function resetSnapshotForTest(): void {
  live = { messages: 0, visibleCount: 0, busy: false };
  domCacheAt = 0;
  domCacheValue = 0;
}
