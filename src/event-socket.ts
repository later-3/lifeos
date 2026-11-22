/**
 * 全局事件通道的 WebSocket 传输（Task 0028 · P3；缺陷 D1）。
 *
 * ## 为什么换传输（不是换协议）
 *
 * 缺陷（Task 0027 · E1/E3）：浏览器对同一 origin 的 HTTP/1.1 连接有 6 条上限，
 * 而我们是"**每个标签页一条永生 SSE**"。开满 6 个标签后，**连静态资源与切会话的请求都排不上队**：
 *
 * ```
 * 6 标签 × 1 条 SSE → 六个标签 fetch 全部 4001–4004ms 超时
 * 6 标签 × 1 条 WS  → 六个标签 fetch 全部 1–6ms 正常（Chromium 同 host 实测可开 ~194 条）
 * ```
 *
 * 所以这里**只**把"事件怎么送到浏览器"从 SSE 换成 WebSocket：
 * **总线契约一个都不动** —— 两级投递、快照优先、过载即摘除全部仍是 `events.ts` 的事。
 *
 * ## 帧格式（信封）
 *
 * SSE 用 `event:` / `id:` / `data:` 三个字段表达"名字 / 序号 / 内容"；ws 没有这些字段，
 * 因此显式封装成 `{ t, seq, d }`，语义一一对应：
 *
 * | SSE | ws |
 * |---|---|
 * | `event: ping` | `{ t: "ping", seq, d: {} }` |
 * | `event: delta` + `id: 42` + `data: {...}` | `{ t: "delta", seq: 42, d: {...} }` |
 *
 * `seq` 必须逐帧带回来：客户端 `routeEvent` 用"当前基线"丢弃重放事件（C119），丢了 seq 这条纪律就没了。
 *
 * ## 参考（A 级，源码可核）
 *
 * - **gitea**（`8848843`）`routers/web/websocket/websocket.go`：
 *   - `:32-38` 纯 GET → `426 Upgrade Required`（健康检查/爬虫不该在服务端刷错误日志）；
 *   - `:19-22` `pingInterval 30s` / `pingTimeout 10s` / `writeTimeout 10s`（写超时独立，慢客户端不拖住广播）；
 *   - `:71-88` **先订阅、再快照，并把订阅期间的 backlog 补在快照之后**；
 *   - `:14-19` 未认证用 3000 关闭码，让客户端**停止重连**（与"网络抖动"区分）。
 * - **mattermost**（`8b2fb370`）`webapp/platform/client/src/websocket.ts`：
 *   - `:27-35` 退避参数（3s 起、上限 300s、jitter 2s）；
 *   - `:300-335` ping 无 pong 时**自己造一个 close 事件**立即重连（不等浏览器慢吞吞的 close）。
 * - **open-webui**（`c38885a`）`src/routes/+layout.svelte:180-188` 用 socket.io —— 我们不引协议，只做最小信封。
 *
 * ## 边界（必须守住）
 *
 * - **必须** 与 SSE 分支共用同一个 `createBoundedSink` 与 `subscribeBus`（过载判定只有一处）。
 * - **必须** 在同一个同步块里"订阅 → 取快照 → 发送快照"，之后再 `ready()`（否则快照与缓冲会重复一条终态）。
 * - **必须** 心跳是**具名帧**（`t: "ping"`），不是 ws 协议层 ping（浏览器 JS 看不见协议层 ping/pong）。
 * - **不得** 在这里做焦点过滤或事件分类：那是 `events.ts` 的职责（分层别混）。
 */
import type { IncomingMessage, Server as HttpServer } from "node:http";
import type { Duplex } from "node:stream";
import { randomUUID } from "node:crypto";
import { WebSocketServer, type WebSocket } from "ws";
import { createBoundedSink } from "./bounded-sink.ts";
import { subscribeBus, eventsSeq } from "./events.ts";
import { globalSnapshot, pruneSessionViewsOnce } from "./agent-host.ts";
import { log } from "./logging.ts";

/** 每连接发送积压上限（字节）：与 SSE 分支同一口径（`events.ts` 的过载即摘除）。 */
const HIGH_WATER_BYTES = 512 * 1024;
/** 心跳间隔：具名帧 `ping`，客户端据此判断连接已死（`specs/code/backend/code.md` 2.14）。 */
const PING_MS = 10_000;
/** 单帧写超时：慢客户端不许拖住广播循环（gitea `writeTimeout`）。 */
const WRITE_TIMEOUT_MS = 10_000;
/** 过载关闭码：1013 = Try Again Later（"重连即可"，与"别再连"的 3000 区分）。 */
const CLOSE_OVERLOAD = 1013;
/** 服务重启/排空：1001 = Going Away。 */
export const CLOSE_GOING_AWAY = 1001;

export type EventSocketOptions = {
  /** 心跳间隔（测试可注入更短的值）。 */
  pingMs?: number;
  /** 积压上限（测试可注入更小的值来触发过载）。 */
  highWaterBytes?: number;
  /**
   * **仅测试用**：写快照之前 await 一次，用来稳定复现"快照还没写出去，客户端就断了"的竞态。
   *
   * 这段窗口在真实环境里是存在的（`pruneSessionViewsOnce()` 首次调用要读盘、`writeFrame` 本身是异步），
   * 但它的宽度只有毫秒级，靠碰运气复现不出来 —— 而没有稳定复现，那条"必须先挂 close 再写快照"的
   * 顺序就成了一句无测试支撑的注释。
   */
  snapshotGate?: () => Promise<void>;
};

/**
 * 把事件通道挂到已有的 HTTP server 上。
 *
 * 挂 `upgrade` 而不是新起一个端口：WebSocket 与 HTTP 同 origin、同端口才有意义 ——
 * 既省一次连接（不占额度），也让 `HttpOnly` 之外的本地无鉴权模型保持原样。
 */
export function attachEventSocket(server: HttpServer, options: EventSocketOptions = {}): { close(): void } {
  const pingMs = options.pingMs ?? PING_MS;
  const highWaterBytes = options.highWaterBytes ?? HIGH_WATER_BYTES;
  const snapshotGate = options.snapshotGate;
  // `noServer`：自己处理 upgrade，才能精确控制"只接 /api/events"与 426 回退
  const wss = new WebSocketServer({ noServer: true });

  const onUpgrade = (req: IncomingMessage, socket: Duplex, head: Buffer): void => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (url.pathname !== "/api/events") { socket.destroy(); return; }
    wss.handleUpgrade(req, socket, head, (ws) => {
      /*
       * `.catch(...)` 不能省：`serve()` 是 async 函数且**没有调用者**，它 reject 出去就是
       * `unhandledRejection` —— Node 15+ 默认**终止进程**。一条客户端在错误时刻断开
       * （快照还没写出去就断了）就能把后端打掉，这是只需一次就能复现的全站故障。
       * 这里的失败全部是"这条连接没建立起来"，属于可预期路径，记一条 warn 即可。
       */
      void serve(ws, { pingMs, highWaterBytes, snapshotGate }).catch((error: unknown) => {
        log.warn("event-socket", "serve", "ws 连接异常结束", { details: { reason: error instanceof Error ? error.message : String(error) } });
      });
    });
  };

  server.on("upgrade", onUpgrade);

  return {
    close() {
      server.off("upgrade", onUpgrade);
      wss.close();
    },
  };
}

/** 一条连接的生命周期：订阅 → 快照 → 心跳 → 等关闭。 */
async function serve(ws: WebSocket, options: { pingMs: number; highWaterBytes: number; snapshotGate?: (() => Promise<void>) | undefined }): Promise<void> {
  const { pingMs, highWaterBytes, snapshotGate } = options;
  await pruneSessionViewsOnce();   // 先清孤儿未读，再生成快照（与 SSE 分支同序）
  const connectionId = randomUUID();

  let finished: () => void = () => undefined;
  const finishedPromise = new Promise<void>((resolve) => { finished = resolve; });

  const sink = createBoundedSink({
    write: (event) => writeFrame(ws, { t: event.type, seq: event.seq, d: event }),
    limitBytes: highWaterBytes,
  });
  const bus = subscribeBus({
    id: connectionId,
    offer: (event) => sink.offer(event),
    // 过载：关闭连接让客户端重连（**绝不静默丢事件**，`specs/code/backend/code.md` 2.12）
    overflowed: () => { try { ws.close(CLOSE_OVERLOAD, "overload"); } catch { /* 已断 */ } finished(); },
  });

  // 同步块：订阅之后立刻取快照（bus.seq 即基线）—— 与 SSE 分支一字不差
  const snapshot = { connectionId, seq: bus.seq, ...globalSnapshot() };

  const ping = setInterval(() => {
    // 心跳也走 sink 之外直发：它不该被积压上限卡住（否则客户端会误判"服务端已死"）
    void writeFrame(ws, { t: "ping", seq: eventsSeq(), d: {} }).catch(() => finished());
  }, pingMs);

  /*
   * **close/error 必须在第一个 await 之前注册**：客户端可能在快照写出去之前就断开
   * （关标签、拔网线、代理掐断）。若等 `await writeFrame(...)` 之后才注册，那条 close 已经发生过了，
   * `finishedPromise` 永远不 resolve —— `finally` 不执行 → 总线与 sink 都不关，registry 里留下一条死连接，
   * 之后每次广播都往它 offer（它永远不成功，直到积压超限才被动摘除）。
   * 顺序改成"先挂监听，再写快照"，最坏情况只是 finished 早于 ready，`finally` 照样收尾。
   */
  /*
   * 断开也要留一行（Task 0033 · P3）：以前只有"已连接"，于是 2026-11-21 全天 45 次连接、
   * **0 条断开记录** —— 无法区分"客户端关了""代理掐了""我们自己超载摘了"。
   * `code` 是 WebSocket 关闭码（1000 正常 / 1006 异常断开 / 1013 过载），
   * 存活时长用来判断"是不是一接上就断"（那种通常是服务端写失败或客户端立刻离开）。
   */
  const openedAt = Date.now();
  ws.on("close", (code: number, reason: Buffer) => {
    log.info("event-socket", undefined, "ws 事件通道已断开", {
      details: {
        connectionId,
        code,
        ...(reason.length > 0 ? { reason: reason.toString().slice(0, 120) } : {}),
        livedMs: Date.now() - openedAt,
      },
    });
    finished();
  });
  ws.on("error", () => finished());
  // 客户端主动发的帧当前没有语义；读掉它们以免 TCP 缓冲堆积（未来可承载 ack）
  ws.on("message", () => undefined);

  try {
    if (snapshotGate !== undefined) await snapshotGate();
    /*
     * 快照写失败 = 客户端已经走了（`writeFrame` 在 readyState 非 OPEN 或写超时时 reject）。
     * 这是**正常结局**，不是异常：不 ready()、不往外抛，直接走到 finally 收尾。
     * （若在这里抛出去，`serve()` 的调用者不存在 —— 见上面 upgrade 回调里的说明。）
     */
    await writeFrame(ws, { t: "snapshot", seq: bus.seq, d: snapshot }).catch(() => undefined);
    if (ws.readyState === ws.OPEN) {
      bus.ready();
      log.info("event-socket", undefined, "ws 事件通道已连接", { details: { connectionId } });
    }
    await finishedPromise;
  } finally {
    clearInterval(ping);
    bus.close();
    sink.close();
    try { ws.close(CLOSE_GOING_AWAY); } catch { /* 已断 */ }
  }
}

/** 写一帧："{t, seq, d}" + 写超时（超时视为连接已坏）。 */
function writeFrame(ws: WebSocket, frame: { t: string; seq: number; d: unknown }): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (ws.readyState !== ws.OPEN) { reject(new Error("closed")); return; }
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error("write-timeout"));
    }, WRITE_TIMEOUT_MS);
    ws.send(JSON.stringify(frame), (error: Error | undefined) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error !== undefined && error !== null) reject(error);
      else resolve();
    });
  });
}
