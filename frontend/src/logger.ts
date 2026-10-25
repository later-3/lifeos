// 前端运行日志（协议 P1·1.5 / specs/code/frontend 2.11）：console 结构化输出 + 批量上报 `/api/logs`。
// 分层（用户拍板的 a/b 框架）：transport（SSE 连接/断/重连）· run（发送/心跳/恢复）· ui（ UIFail）。
// 字段：{ ts, level, module, fn, msg, details } 一致契约（扁平），不写用户正文与凭据。
type LogLevel = "error" | "warn" | "info" | "debug";
type QueueRow = { ts: string; level: LogLevel; module: string; msg: string; details?: Record<string, unknown> };

const MAX_ROW_LEN = 200;
const UPLOAD_BATCH_MAX = 50;
const UPLOAD_BODY_MAX = 16 * 1024;
const INFO_SAMPLE = 0.1;

const queue: QueueRow[] = [];
function consoleOut(level: LogLevel, row: QueueRow): void {
  const args = [row.msg, { module: row.module, details: row.details }];
  if (level === "error") console.error(...args);
  else if (level === "warn") console.warn(...args);
  else console.info(...args);
}

function enqueue(level: LogLevel, module: string, msg: string, details?: Record<string, unknown>): void {
  const row: QueueRow = {
    ts: new Date().toISOString(), level, module,
    msg: msg.length > MAX_ROW_LEN ? msg.slice(0, MAX_ROW_LEN) : msg,
    details,
  };
  consoleOut(level, row);
  if (level === "debug") return;                    // debug 只本地，上报不收
  if (level === "info" && Math.random() > INFO_SAMPLE) return;   // info 采样（specs 2.11）
  queue.push(row);
  if (level === "error" || level === "warn" || queue.length >= UPLOAD_BATCH_MAX) void flush();
}

/** 批量上报；失败静默（列不为空，等于自发丢订阅——绝不阻塞 UI 流）。 */
export async function flush(): Promise<void> {
  if (queue.length === 0) return;
  const batch = queue.splice(0, UPLOAD_BATCH_MAX);
  const body = JSON.stringify({ events: batch });
  if (body.length > UPLOAD_BODY_MAX) return;  // 超限（极端）按丢弃处理
  try {
    await fetch("/api/logs", { method: "POST", headers: { "content-type": "application/json" }, body, keepalive: true });
  } catch { /* 断线时的批量重试由上层运行事实处理（P1·1.4），日志无重试 */ }
}

window.addEventListener("pagehide", () => { void flush(); });

/** 后端模块对齐：大模块 → fn → 细节；client 从不再被写用户正文（上层自己拿捏）。 */
export const logger = {
  error: (module: string, msg: string, details?: Record<string, unknown>) => enqueue("error", module, msg, details),
  warn:  (module: string, msg: string, details?: Record<string, unknown>) => enqueue("warn", module, msg, details),
  info:  (module: string, msg: string, details?: Record<string, unknown>) => enqueue("info", module, msg, details),
  debug: (module: string, msg: string, details?: Record<string, unknown>) => enqueue("debug", module, msg, details),
  fnFetchedFlush: flush,
};
