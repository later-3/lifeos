/**
 * 前端事件通道（Task 0028 · P3；缺陷 D1 的客户端一半）。
 *
 * ## 为什么换传输
 *
 * 浏览器对同一 origin 的 HTTP/1.1 只有 **6** 条连接，而每个标签页都要一条**常驻**通道。
 * 用 SSE 时开满 6 个标签就会把整页（连静态资源）堵死 —— 实测（Task 0027 · E1/E3）：
 *
 * ```
 * 6 标签 × 1 条 SSE → 六个标签 fetch 全部 4001–4004ms 超时
 * 6 标签 × 1 条 WS  → 六个标签 fetch 全部 1–6ms 正常
 * ```
 *
 * ## 帧格式（与服务端 `src/event-socket.ts` 的信封一一对应）
 *
 * `{ t: "snapshot" | "ping" | <事件名>, seq: number, d: unknown }`
 *
 * `seq` 必须逐帧复原：下游 `routeEvent` 用"当前基线"丢重放事件（C119），丢了 seq 这条纪律就失效。
 *
 * ## 重连策略（mattermost `webapp/platform/client/src/websocket.ts` 同构）
 *
 * - `:27-35` 起手 3s、上限 300s、jitter 2s；
 * - `:246-258` 失败次数 > 7 后按 `n²` 放大（避免服务端长时间挂掉时的无脑锤打）；
 * - `:300-335` 心跳判死：**自己造一次重连**，不等浏览器慢吞吞地报 close。
 *   ws 协议层的 ping/pong 浏览器不暴露，所以心跳用**具名帧**（服务端每 10s 一条 `t:"ping"`）。
 *
 * ## 边界
 *
 * - **必须** 纯逻辑可单测：`parseFrame` / `nextBackoff` / `isChannelStale` 都是纯函数（`specs/code/frontend/code.md` 2.13）。
 * - **必须** 只暴露 `close()`；重连、计时器、关闭旧连接全部在内部完成（调用方不碰生命周期）。
 * - **必须** 尊重 `?transport=sse` 兼容路径：排障与只读工具仍可用 SSE。
 */

/** 服务端推来的帧（`d` 的内容随 `t` 变）。 */
export type ChannelFrame =
  | { kind: "snapshot"; seq: number; data: unknown }
  | { kind: "ping"; seq: number }
  | { kind: "event"; seq: number; type: string; data: Record<string, unknown> }
  | { kind: "invalid"; raw: string };

/** 解析一帧。坏帧不抛错（一条坏帧不该拆掉整条通道），返回 `invalid` 让调用方决定记日志。 */
export function parseFrame(raw: string): ChannelFrame {
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return { kind: "invalid", raw: raw.slice(0, 120) }; }
  if (typeof parsed !== "object" || parsed === null) return { kind: "invalid", raw: raw.slice(0, 120) };
  const frame = parsed as { t?: unknown; seq?: unknown; d?: unknown };
  if (typeof frame.t !== "string") return { kind: "invalid", raw: raw.slice(0, 120) };
  const seq = typeof frame.seq === "number" ? frame.seq : 0;
  if (frame.t === "snapshot") return { kind: "snapshot", seq, data: frame.d };
  if (frame.t === "ping") return { kind: "ping", seq };
  const data = typeof frame.d === "object" && frame.d !== null ? (frame.d as Record<string, unknown>) : {};
  return { kind: "event", seq, type: frame.t, data };
}

/** 退避参数（与 mattermost 的默认值同档）。 */
export const CHANNEL_MIN_RETRY_MS = 3_000;
export const CHANNEL_MAX_RETRY_MS = 300_000;
export const CHANNEL_JITTER_MS = 2_000;
export const CHANNEL_BACKOFF_AFTER = 7;

/**
 * 第 `failCount` 次失败之后等多久再连（含 jitter）。
 *
 * `failCount` 从 1 开始数（第一次失败 = 1）。`random` 可注入，便于测试穷举。
 */
export function nextBackoff(failCount: number, random: () => number = Math.random): number {
  const n = Math.max(1, Math.floor(failCount));
  const base = n > CHANNEL_BACKOFF_AFTER
    ? Math.min(CHANNEL_MIN_RETRY_MS * n * n, CHANNEL_MAX_RETRY_MS)
    : CHANNEL_MIN_RETRY_MS;
  return base + Math.floor(random() * CHANNEL_JITTER_MS);
}

/** 通道是否陈旧（服务端每 `pingMs` 一条 `t:"ping"`，阈值应 ≥ 2 倍）。 */
export function isChannelStale(lastSeenMs: number, nowMs: number, staleMs: number): boolean {
  return nowMs - lastSeenMs >= staleMs;
}

export type ChannelHandlers = {
  /** 连接建立后收到的第一帧（快照）。 */
  snapshot: (snapshot: { connectionId: string } & Record<string, unknown>) => void;
  /** 业务事件（`t` 是事件名；`seq` 已复原进 `data.seq`）。 */
  event: (event: Record<string, unknown>) => void;
  /** 连接状态变化（排障与 UI 角标可用；不需要就省略）。 */
  status?: (state: "open" | "closed" | "retry") => void;
};

export type ChannelOptions = {
  /** 通道地址（默认相对路径，按当前 origin 拼）。 */
  path?: string;
  /** 用 SSE 兼容路径（排障/只读工具）。 */
  transport?: "ws" | "sse";
  /** 心跳间隔（服务端 10s；测试可缩短）。 */
  pingMs?: number;
  /** 陈旧阈值（默认 2.5 × pingMs）。 */
  staleMs?: number;
  /** 看门狗检查间隔（默认 5s）。 */
  watchdogMs?: number;
};

/**
 * 建立一条自我修复的事件通道。返回句柄只有 `close()`。
 *
 * 生命周期（全在内部）：
 * ```
 * connect ─open→ 收帧 ─(无帧超时 / 断线)→ close + 退避 → connect …
 * ```
 * 每次（重）连接都会收到一条新快照 —— 下游据此**重建**状态，不依赖重放（C119 的快照优先）。
 */
export function createEventChannel(handlers: ChannelHandlers, options: ChannelOptions = {}): { close(): void } {
  const path = options.path ?? "/api/events";
  const transport = options.transport ?? "ws";
  const pingMs = options.pingMs ?? 10_000;
  const staleMs = options.staleMs ?? Math.round(pingMs * 2.5);
  const watchdogMs = options.watchdogMs ?? 5_000;

  let closed = false;
  let failCount = 0;
  let lastSeen = Date.now();
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let watchdog: ReturnType<typeof setInterval> | undefined;
  let socket: WebSocket | undefined;
  let source: EventSource | undefined;

  const markSeen = (): void => { lastSeen = Date.now(); };

  const teardown = (): void => {
    if (socket !== undefined) { try { socket.close(); } catch { /* 已断 */ } socket = undefined; }
    if (source !== undefined) { try { source.close(); } catch { /* 已断 */ } source = undefined; }
  };

  const scheduleRetry = (): void => {
    if (closed || retryTimer !== undefined) return;
    failCount += 1;
    handlers.status?.("retry");
    const delay = nextBackoff(failCount);
    retryTimer = setTimeout(() => { retryTimer = undefined; connect(); }, delay);
  };

  const restart = (): void => {
    teardown();
    scheduleRetry();
  };

  const handleFrame = (raw: string): void => {
    markSeen();
    const frame = parseFrame(raw);
    if (frame.kind === "invalid") return;                       // 坏帧不拆通道
    if (frame.kind === "ping") return;                          // 只用来"证明活着"
    if (frame.kind === "snapshot") {
      failCount = 0;                                            // 拿到快照 = 这一轮连上了
      handlers.snapshot(frame.data as { connectionId: string } & Record<string, unknown>);
      return;
    }
    // 事件：把 seq 复原进 payload（下游按 `event.seq` 判基线，与 SSE 时代一致）
    handlers.event({ ...frame.data, seq: frame.seq, type: frame.type });
  };

  function connect(): void {
    if (closed) return;
    markSeen();
    if (transport === "sse") {
      source = new EventSource(`${path}?transport=sse`);
      source.addEventListener("open", () => { failCount = 0; handlers.status?.("open"); });
      source.addEventListener("ping", markSeen);
      source.addEventListener("snapshot", (event) => {
        markSeen();
        try { handlers.snapshot(JSON.parse((event as MessageEvent).data) as { connectionId: string } & Record<string, unknown>); }
        catch { /* 坏快照：等下一次 */ }
      });
      for (const name of CHANNEL_EVENT_NAMES) {
        source.addEventListener(name, (event) => {
          markSeen();
          const data = (event as MessageEvent).data;
          if (typeof data !== "string" || data === "") return;
          try { handlers.event(JSON.parse(data) as Record<string, unknown>); } catch { /* 坏事件：跳过 */ }
        });
      }
      source.addEventListener("error", () => { if (!closed) restart(); });
      return;
    }

    /*
     * 用 `new URL(path, location.href)` 而不是字符串拼接：后者要自己判协议、补斜杠、
     * 处理 `location.host` 为空（file://）等边界，而这里只需要"同源"这一件事。
     */
    const url = new URL(path, window.location.href);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    socket = new WebSocket(url.toString());
    socket.addEventListener("open", () => { failCount = 0; handlers.status?.("open"); });
    socket.addEventListener("message", (event) => {
      if (typeof event.data === "string") handleFrame(event.data);
    });
    socket.addEventListener("close", () => { if (!closed) restart(); });
    socket.addEventListener("error", () => { /* close 会紧随其后，统一在 close 里重连 */ });
  }

  connect();
  watchdog = setInterval(() => {
    if (closed) return;
    if (isChannelStale(lastSeen, Date.now(), staleMs)) restart();
  }, watchdogMs);

  return {
    close() {
      closed = true;
      if (retryTimer !== undefined) clearTimeout(retryTimer);
      if (watchdog !== undefined) clearInterval(watchdog);
      teardown();
      handlers.status?.("closed");
    },
  };
}

/**
 * SSE 兼容路径的事件名（ws 不需要这份清单：帧自带 `t`）。
 * 与 `App.tsx` 的 `STREAM_EVENT_NAMES` 必须一致 —— 由 `test/event-channel.test.mjs` 断言。
 */
export const CHANNEL_EVENT_NAMES = [
  "turn", "done", "error", "agents_changed", "row",
  "message_start", "message_end", "delta", "thinking", "thinking_end",
  "tool_call", "tool_start", "tool_update", "tool_result", "retrying", "retry_end",
  "review_open",
] as const;
