/**
 * 思考正文取数的**并发闸 + 去重**（Task 0028 · P7）。
 *
 * ## 为什么必须有
 *
 * 用户 2026-11-19 截图：一屏「正在取思考正文…」，页面像卡死。
 * 现场（coder 会话 `01a1ecf8`，正在跑，200 条窗口里 **82 个 deferred 思考块**）实测：
 * 进会话那一刻**同时**发出 **9 条** `…/thinking` 请求（峰值并发 9）。
 *
 * 而每条 thinking 请求在后端都要**重读并解析整个会话文件**
 * （实测该会话 4.2 MB；单条 21–23ms，并发 20 条 451ms）。
 * 浏览器对同源 HTTP/1.1 只有 **6 条**连接，剩下的全排队 ——
 * 于是切会话的详情请求、下一屏消息、静态资源都跟着等，表现为"页面卡死"。
 *
 * 这与 Task 0027 的 D1 是**同一族**（连接池被占满），只是占用者从"常驻 SSE"变成了"一堆并发 thinking 请求"。
 *
 * ## 规则
 *
 * - **必须** 同时在飞的 thinking 请求不超过 `LIMIT`（3）。
 *   依据：它只是"展开一段思考"的辅助请求，没有理由占满全部 6 条连接；
 *   留 3 条给用户真正在等的会话详情/列表。
 * - **必须** 同一个 key（same agent+session+entry+blockIndex）复用同一个 Promise：
 *   同一段思考被两处同时展开（主对话 + 侧边栏）只发一次。
 * - **必须** 完成的条目从在飞表里移除（失败也移除，允许重试）。
 * - **必须** 纯逻辑可单测：不碰 DOM、不碰 React（`specs/code/frontend/code.md` 2.13）。
 */

/** 同时在飞的 thinking 请求上限。3 = 一半的连接额度。 */
export const THINKING_LIMIT = 3;

type Waiter = { run: () => void };

let running = 0;
const waiters: Waiter[] = [];
const inflight = new Map<string, Promise<string>>();

/** 排队：拿到槽位才真正发请求。 */
function acquire(): Promise<void> {
  if (running < THINKING_LIMIT) {
    running += 1;
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => { waiters.push({ run: resolve }); });
}

/** 释放槽位；有排队就交给下一个（`running` 不变，等于把槽位直接转交）。 */
function release(): void {
  const next = waiters.shift();
  if (next !== undefined) { next.run(); return; }
  running = Math.max(0, running - 1);
}

/**
 * 通过闸门执行一次取数。
 *
 * `key` 相同的调用共享同一个 Promise（去重）；`task` 只在**拿到槽位后**才被执行。
 */
export function withThinkingSlot(key: string, task: () => Promise<string>): Promise<string> {
  const existing = inflight.get(key);
  if (existing !== undefined) return existing;
  const promise = (async () => {
    await acquire();
    try {
      return await task();
    } finally {
      release();
      inflight.delete(key);
    }
  })();
  inflight.set(key, promise);
  // 调用方各自 catch；这里再挂一次空 catch 只为避免"所有调用方都放弃"时的 unhandledRejection
  void promise.catch(() => undefined);
  return promise;
}

/** 诊断与测试用：当前在飞数量与排队数量。 */
export function thinkingQueueState(): { running: number; queued: number } {
  return { running, queued: waiters.length };
}
