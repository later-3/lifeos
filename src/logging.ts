// 运行日志（协议 P1·1.5；docs specs/code/backend 2.10）：Life OS 运行产物，与交互协议无关。
// - 路径：~/.lifeos/logs/{backend|frontend}-<YYYY-MM-DD>.jsonl；启动建目录；>14 天滚动；
// - 字段（扁平）：{ ts, level, module, fn?, sessionId?, turnId?, agentId?, projectId?, msg, details? }；
// - 正文/凭据零出现：用户消息正文在会话 JSONL，details 里的 key/token/password/cookie/auth 字段一律丢弃；
// - debug 默认静默（info 起可读），环境变量 LIFEOS_LOG_DEBUG=1 打开 debug。
import { appendFile, mkdir, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { resolveHome } from "./home.ts";

export type LogLevel = "error" | "warn" | "info" | "debug";
const LEVELS: LogLevel[] = ["error", "warn", "info", "debug"];

export function logsDir(): string { return join(resolveHome(), "logs"); }
function localDate(d = new Date()): string {
  const y = d.getFullYear(); const m = String(d.getMonth() + 1).padStart(2, "0"); const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function backendFile(): string { return join(logsDir(), `backend-${localDate()}.jsonl`); }
function frontendFile(): string { return join(logsDir(), `frontend-${localDate()}.jsonl`); }

/** 启动一次性：建目录 + 删除 14 天前的日志文件（按文件名日期）。 */
export async function initLogs(): Promise<void> {
  await mkdir(logsDir(), { recursive: true, mode: 0o700 });
  const cutoffMs = Date.now() - 14 * 24 * 60 * 60 * 1000;
  for (const entry of await readdir(logsDir())) {
    const match = /(?:backend|frontend)-(\d{4}-\d{2}-\d{2})\.jsonl$/.exec(entry);
    if (match === null) continue;
    const at = new Date(`${match[1]}T23:59:59`).getTime();
    if (!Number.isNaN(at) && at < cutoffMs) await rm(join(logsDir(), entry), { force: true });
  }
}

const RESERVED = ["ts", "level", "module", "fn", "sessionId", "turnId", "agentId", "projectId", "msg", "details"];
const SECRET = /(api[-_]?key|token|password|cookie|authorization|secret)/i;
function sanitize(details: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (details === undefined) return undefined;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(details)) {
    if (SECRET.test(key)) continue;
    if (typeof value === "string" && value.length > 200) continue;   // 顺手卡掉疑似正文的大段文本
    out[key] = value;
  }
  return out;
}

/** 对应日期的 JSONL 追加（一次一行；串行化避免交错写坏）。
 * 对外的承诺是"永不拒绝"——调用方（`void log.××`）不会因此把测试/业务搞崩；
 * 失败仅打印 stderr 提示（logs 目录无法创建/权限失败等运维问题由用户处理）。 */
let chain: Promise<unknown> = Promise.resolve();
let logsDirReady = false;
async function appendLine(file: string, row: Record<string, unknown>): Promise<void> {
  const previous = chain;
  const work = previous.then(async () => {
    try { await mkdir(logsDir(), { recursive: true, mode: 0o700 }); } catch { return; }
    await appendFile(file, JSON.stringify(row) + "\n", { encoding: "utf8", flag: "a" });
  });
  chain = work;
  return work.catch((err) => { console.error("[logs] 写失败：", err instanceof Error ? err.message : String(err)); });
}

export type LogFields = { sessionId?: string; turnId?: string; agentId?: string; projectId?: string | undefined; details?: Record<string, unknown> | undefined };

async function write(level: LogLevel, module: string, fn: string | undefined, msg: string, fields?: LogFields): Promise<void> {
  if (level === "debug" && process.env.LIFEOS_LOG_DEBUG !== "1") return;
  const { sessionId, turnId, agentId, projectId, details, ...rest } = fields ?? {};
  void rest;   // 其他自定义字段统一进 details（扁平字段只挑有语义的关键键）
  const row: Record<string, unknown> = {
    ts: new Date().toISOString(),
    level,
    module,
    ...(fn !== undefined && fn !== "" ? { fn } : {}),
    ...(sessionId !== undefined ? { sessionId } : {}),
    ...(turnId !== undefined ? { turnId } : {}),
    ...(agentId !== undefined ? { agentId } : {}),
    ...(projectId !== undefined ? { projectId } : {}),
    msg,
    ...(sanitize(details) !== undefined ? { details: sanitize(details) } : {}),
  };
  await appendLine(backendFile(), row);
}

/** 便捷入口：log.info("agent-host", "runTurn", "受理回合", { sessionId, turnId }) */
export const log = {
  error: (module: string, fn: string | undefined, msg: string, fields?: LogFields) => write("error", module, fn, msg, fields),
  warn:  (module: string, fn: string | undefined, msg: string, fields?: LogFields) => write("warn", module, fn, msg, fields),
  info:  (module: string, fn: string | undefined, msg: string, fields?: LogFields) => write("info",  module, fn, msg, fields),
  debug: (module: string, fn: string | undefined, msg: string, fields?: LogFields) => write("debug", module, fn, msg, fields),
};

/** 服务端收到前端批量上报时的落盘（写进 frontend 文件，行里带 level/module 来自客户端）。 */
export async function appendFrontendRows(rows: Array<Record<string, unknown>>): Promise<number> {
  let written = 0;
  for (const raw of rows) {
    if (typeof raw !== "object" || raw === null) continue;
    const row: Record<string, unknown> = { ts: new Date().toISOString(), ...raw };
    await appendLine(frontendFile(), row);
    written += 1;
  }
  return written;
}
