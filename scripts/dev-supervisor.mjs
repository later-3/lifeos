// 开发 supervisor（任务 0006 A2）：替代 `node --watch`。
// 监听 src/ 的改动；有改动时**先问后端有没有回合在跑**，有就等它们结束再重启，绝不在回合中途杀进程。
// 决策逻辑在 dev-supervisor-core.mjs（有测试）。前端由 Vite 热更新，不经过这里。
import { spawn } from "node:child_process";
import { appendFileSync } from "node:fs";
import { watch } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { decideRestart } from "./dev-supervisor-core.mjs";

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
const logFile = process.env.LIFEOS_SUPERVISOR_LOG ?? "/tmp/lifeos-dev-supervisor.log";
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
