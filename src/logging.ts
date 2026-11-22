// 运行日志（协议 P1·1.5；docs specs/code/backend 2.10）：Life OS 运行产物，与交互协议无关。
// - 路径：~/.lifeos/logs/{backend|frontend}-<YYYY-MM-DD>.jsonl；启动建目录；>14 天滚动；
// - 字段（扁平）：{ ts, level, module, fn?, sessionId?, turnId?, agentId?, projectId?, msg, details? }；
// - 正文/凭据零出现：用户消息正文在会话 JSONL，details 里的 key/token/password/cookie/auth 字段一律丢弃；
// - debug 默认静默（info 起可读），环境变量 LIFEOS_LOG_DEBUG=1 打开 debug。
import { appendFile, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
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
const LOGS_NOTE = `# logs · 运行日志

- 背景：后端与前端的结构化运行日志，程序按天写入，超过 14 天自动滚动删除。
- 内容：backend-<日期>.jsonl、frontend-<日期>.jsonl；只含事实与 ID，不含正文与凭据。
- 何时读：排障（按 sessionId / turnId 查一轮的完整过程）时。
- 怎么用：不要手改；不入库（~/.lifeos/.gitignore 已排除）。
`;

/** 协议 §5.2：目录由谁创建，谁负责说明文件；懒创建路径（如测试里第一次写日志）也必须补上。 */
async function ensureLogsDir(): Promise<string> {
  await mkdir(logsDir(), { recursive: true, mode: 0o700 });
  await writeFile(join(logsDir(), "AGENTS.md"), LOGS_NOTE, { flag: "wx", mode: 0o600 }).catch(() => undefined);
  return logsDir();
}

export async function initLogs(): Promise<void> {
  await ensureLogsDir();
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
  // file 与它的目录都在【调用时】求值：`resolveHome()` 是进程级可变状态（测试/多 home 切换），
  // 若在【执行时】再求，链排到这条写时 home 已被切换，mkdir 与 appendFile 会各写各的目录
  // ——实测（0032 · S1-19 全量首跑）：前家用例的 cleanup 与下一个用例的写赛跑，
  // 出现「mkdir 建在新家、appendFile 开旧家的文件」→ ENOENT/EINVAL，行静默丢。
  const dir = dirname(file);
  const work = previous.then(async () => {
    try { await mkdir(dir, { recursive: true, mode: 0o700 }); } catch { return; }
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
  await ensureLogsDir();
  await appendLine(backendFile(), row);
}

/**
 * 等待排队的写全部落盘（测试与排障用）。
 *
 * 为什么必须导出：`log.*` 是 fire-and-forget（`void log.debug(...)`），写操作排在**模块级**
 * `chain` 上。测试切了 `LIFEOS_HOME` 后，旧家目录的写仍可能排在链尾 —— 断言"日志里有没有
 * 某条"前必须先排空，否则读到的是上一家的文件、或自己的还没写（S1-19 全量首跑就是这么假红的：
 * 单文件 14/14、全量 1745/1746，前家用例的 cleanup 与本家断言赛跑）。
 */
export async function flushLogs(): Promise<void> {
  await chain.catch(() => undefined);
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
