// 开发 supervisor（任务 0006 A2）：替代 `node --watch`。
// 监听 src/ 的改动；有改动时**先问后端有没有回合在跑**，有就等它们结束再重启，绝不在回合中途杀进程。
// 决策逻辑在 dev-supervisor-core.mjs（有测试）。前端由 Vite 热更新，不经过这里。
import { spawn } from "node:child_process";
import { appendFileSync } from "node:fs";
import { watch } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { decideRestart } from "./dev-supervisor-core.mjs";
import { DEFAULT_LOG, checkIsolation } from "./dev-supervisor-guard.mjs";
import { readRegistry } from "./dev-ports-core.mjs";
import { createServer } from "node:net";
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const backend = process.env.LIFEOS_API ?? "http://127.0.0.1:43120";
// 透传额外参数给后端（如 --port=43130）；supervisor 只保留自身控制参数。
const args = ["--experimental-strip-types", "src/main.ts", ...process.argv.slice(2)];
const POLL_MS = 1000;
const DEBOUNCE_MS = 300;

let child;
let changed = false;
let debounce;
let polling;
let stopping = false;

// 日志同时落盘：supervisor 的 stdout 在跑 pnpm dev:all 的那个终端里，出事后翻不到。
// 2026-10-26 排空卡住时就是因为没有日志，无法判断卡在哪一步。
const logFile = process.env.LIFEOS_SUPERVISOR_LOG ?? DEFAULT_LOG;
const log = (msg) => {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(`[dev-supervisor] ${msg}`);
  try { appendFileSync(logFile, `${line}\n`); } catch { /* 日志失败不阻断重启 */ }
};

let drainRequested = false;

/** 先排空：拒绝新回合（竞态封口），再等现有回合结束。后端不可达 = 没有回合可打断，直接允许重启。 */
async function requestDrain() {
  if (drainRequested) return;
  try {
    const response = await fetch(`${backend}/api/runtime/drain`, { method: "POST", signal: AbortSignal.timeout(1500) });
    drainRequested = response.ok;
    if (drainRequested) log("已排空：新回合暂停受理，等待正在跑的回合结束");
  } catch {
    drainRequested = false;
  }
}

async function runningCount() {
  try {
    const response = await fetch(`${backend}/api/runtime`, { signal: AbortSignal.timeout(1500) });
    if (!response.ok) return 0;
    const data = await response.json();
    return Array.isArray(data.running) ? data.running.length : 0;
  } catch {
    return 0;   // 后端不可达：没有回合可以打断
  }
}

// 启动自检（任务 0016）：保留号 / 共用用户家目录 / 共用主 worktree / 共用默认日志 / 端口已被占用
// —— 任何一条成立就**打印原因并退出**，不进入"每秒崩溃重启"的循环（那是 2026-11-02 的 91 万行日志）。
const backendPort = (() => {
  const found = process.argv.find((arg) => arg.startsWith("--port="));
  return found === undefined ? 43120 : Number(found.slice("--port=".length));
})();
const portBusy = (port) => new Promise((resolve) => {
  const server = createServer();
  server.once("error", () => resolve(true));
  server.once("listening", () => server.close(() => resolve(false)));
  server.listen(port, "127.0.0.1");
});
const ownerOf = (port) => {
  try {
    return execFileSync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN"], { encoding: "utf8" })
      .trim().split("\n").slice(1).map((line) => line.split(/\s+/).slice(0, 2).join(" pid=")).join("; ") || "占用者未知";
  } catch { return "占用者未知"; }
};
// 端口必须有来源：从登记表里找这个号属于哪个 Task（Task 0016）。
const registry = await readRegistry(homedir() + "/.lifeos");
const registration = Object.entries(registry.instances).find(([, entry]) => entry.backend === backendPort)?.[0];
const problems = checkIsolation({
  port: backendPort,
  home: process.env.LIFEOS_HOME ?? homedir() + "/.lifeos",
  // 非 worktree（主仓库）本身没有 .git 文件；git rev-parse 能区分
  worktree: root,
  logFile,
  expectedHome: homedir() + "/.lifeos",
  expectedWorktree: process.env.LIFEOS_MAIN_WORKTREE ?? homedir() + "/Code/lifeos",
  probe: (await portBusy(backendPort)) ? { busy: true, owner: ownerOf(backendPort) } : { busy: false },
  registration: registration === undefined ? undefined : { taskId: registration },
  requireRegistration: true,
});
if (problems.length > 0) {
  console.error("[dev-supervisor] 启动自检未通过，拒绝启动（不会重试）：");
  for (const problem of problems) console.error(`  · ${problem}`);
  console.error("[dev-supervisor] 修正方式：node scripts/dev-port.mjs claim --task <NNNN>，按输出起实例。");
  process.exit(2);
}
log(`自检通过：worktree=${root} LIFEOS_HOME=${process.env.LIFEOS_HOME ?? "(默认)"} 端口=${backendPort} 日志=${logFile}`);

/** 启动一个后端进程。同一时刻只允许一个存活的子进程（否则会抢端口，见 2026-10-25 的 EADDRINUSE 循环）。 */
function start() {
  if (child !== undefined && child.exitCode === null) return;
  log("启动后端（无 --watch；改动由 supervisor 在回合结束后重启）");
  const mine = spawn(process.execPath, args, { cwd: root, stdio: "inherit" });
  child = mine;
  log(`后端进程 pid=${String(mine.pid ?? "-")}`);
  mine.on("exit", (code, signal) => {
    if (child === mine) child = undefined;
    if (stopping || mine.lifeosStopping === true) return;   // 主动停止：不是意外退出，不重启（由调用方重启）
    log(`后端意外退出（code=${code ?? "-"} signal=${signal ?? "-"}），1 秒后重启`);
    setTimeout(() => { if (!stopping) start(); }, 1000);
  });
}

/** 主动停止子进程并等它真正退出（端口释放之后才返回）。 */
function stopChild() {
  return new Promise((resolve) => {
    const current = child;
    if (current === undefined || current.exitCode !== null) return resolve();
    current.lifeosStopping = true;
    current.once("exit", () => resolve());
    current.kill("SIGTERM");
  });
}

async function tryRestart() {
  if (!changed || stopping) return;
  await requestDrain();
  const running = await runningCount();
  const decision = decideRestart({ changed, running });
  if (decision === "wait") {
    if (polling === undefined) {
      log(`源码已改动；有 ${running} 个回合在跑，等它们结束后再重启（不打断回合）`);
      polling = setInterval(() => { void tryRestart(); }, POLL_MS);
    }
    return;
  }
  if (decision === "restart") {
    clearInterval(polling); polling = undefined;
    changed = false;
    drainRequested = false;   // 新进程的排空标记自然为 false
    log("源码已改动，没有回合在跑，重启后端");
    await stopChild();
    start();
  }
}

watch(join(root, "src"), { recursive: true }, (_event, file) => {
  if (file !== null && !/\.(ts|mjs|json)$/.test(file)) return;
  changed = true;
  clearTimeout(debounce);
  debounce = setTimeout(() => { void tryRestart(); }, DEBOUNCE_MS);
});

const shutdown = async () => {
  stopping = true;
  clearInterval(polling);
  await stopChild();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

start();
