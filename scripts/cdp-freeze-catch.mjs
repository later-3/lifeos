#!/usr/bin/env node
/**
 * **卡死一键取证**（Task 0033 · P5 的最终交付物）。
 *
 * ## 用法（事故现场只需要一条命令）
 *
 *   node scripts/cdp-freeze-catch.mjs                  # 自动找 CDP 端口与 Life OS 页面
 *   node scripts/cdp-freeze-catch.mjs --port 9222
 *   node scripts/cdp-freeze-catch.mjs --pid 12345      # 已知 renderer pid（更准）
 *   node scripts/cdp-freeze-catch.mjs --resume         # 取证完让它继续跑（默认 resume）
 *   node scripts/cdp-freeze-catch.mjs --no-resume      # 取证完保持暂停（想看现场）
 *
 * ## 它做什么
 *
 * 1. 连 **browser-level** CDP（页面冻死时它仍然响应，实测 `/json/version` 一直 1ms）；
 * 2. 找到 Life OS 的页面 target，attach（`flatten: true`）；
 * 3. `Debugger.enable` → `Debugger.pause` → 拿 `callFrames`；
 * 4. 用 sourcemap 把运行时行列翻译成**源码行列**；
 * 5. 打印栈 + 落盘到 `~/.lifeos/logs/freeze-stacks/`。
 *
 * ## 为什么这套方案成立（三条实测否证 + 一条实测成立）
 *
 * | 方案 | 冻结期间能拿到数据 | 原因 |
 * |---|---|---|
 * | page-level `Tracing` | ❌ 0 条 / 8 秒 | 数据经 renderer DevTools agent，跑在主线程上 |
 * | browser-level `Tracing` | ❌ 0 条 / 8 秒 | CPU 样本由 V8 在主线程采样后经 mojo 上报 |
 * | `--js-flags=--perf-basic-prof` | ❌ renderer 起不来 | Chrome 157 报 `Fatal: perf_output_handle_ != nullptr` |
 * | **`Debugger.pause`（已冻死页面）** | ✅ **6 秒内拿到完整栈** | V8 interrupt 机制，在循环回边检查 |
 *
 * 详细证据见 `evidence/p5-freeze-mechanisms.md`。
 *
 * ## 为什么必须先 attach 再 enable（不能反过来）
 *
 * 实测：`Debugger.enable` 在**已冻死**的页面上是成功的（6 秒内），
 * 但它要求 attach 已经建立；而 attach 本身走 browser 进程，不受主线程影响。
 */

import { createWriteStream, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { loadSourceMapFor, printStack, translateFrames } from "./sourcemap-translate.mjs";

const args = process.argv.slice(2);
const argOf = (name, fallback) => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : fallback;
};
const has = (name) => args.includes(name);

const PORT = Number(argOf("--port", 0)) || undefined;
const APP_PATTERN = argOf("--app", "43120");
const PIDS = argOf("--pid", undefined);
const STEP_TIMEOUT_MS = Number(argOf("--timeout", 12_000));
const PAUSE_WAIT_MS = Number(argOf("--pause-wait", 25_000));
const NO_RESUME = has("--no-resume");
const WATCH = has("--watch");
const DEBUG = has("--debug");
const PROBE_MS = Number(argOf("--probe-ms", 2000));
const PROBE_TIMEOUT_MS = Number(argOf("--probe-timeout", 4000));

const HOME = process.env.LIFEOS_HOME ?? join(homedir(), ".lifeos");
const OUT_DIR = join(HOME, "logs", "freeze-stacks");

/* ───────────────────────── 工具 ───────────────────────── */

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise.then((value) => ({ ok: true, value })),
    new Promise((resolve) => setTimeout(() => resolve({ ok: false, label }), ms)),
  ]);
}

function connect(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    let nextId = 0;
    const pending = new Map();
    const methods = new Map();
    const handlers = new Map();
    socket.addEventListener("open", () => resolve({
      send(method, params = {}, sessionId) {
        const id = ++nextId;
        const message = { id, method, params };
        if (sessionId !== undefined) message.sessionId = sessionId;
        socket.send(JSON.stringify(message));
        return new Promise((res, rej) => { methods.set(id, method); pending.set(id, { res, rej }); });
      },
      on(method, handler) {
        if (!handlers.has(method)) handlers.set(method, []);
        handlers.get(method).push(handler);
      },
      close() { try { socket.close(); } catch { /* 已关 */ } },
    }));
    socket.addEventListener("error", (event) => reject(new Error(String(event.message ?? "ws error"))));
    socket.addEventListener("message", (event) => {
      if (typeof event.data !== "string") return;
      let message;
      try { message = JSON.parse(event.data); } catch { return; }
      if (message.id != null) {
        const slot = pending.get(message.id);
        if (slot === undefined) return;
        const method = methods.get(message.id) ?? "?";
        pending.delete(message.id);
        methods.delete(message.id);
        if (message.error) slot.rej(new Error(`${method}: ${message.error.message}`));
        else slot.res(message.result);
        return;
      }
      if (typeof message.method === "string") {
        for (const handler of handlers.get(message.method) ?? []) handler(message.params, message.sessionId);
      }
    });
  });
}

/** 自动找带 CDP 的端口（用户可能用 9222，也可能用别的）。 */
async function discoverPort() {
  if (PORT !== undefined) return PORT;
  const candidates = [9222, 9223, 9224, 9225, 9226, 9227, 9228, 9229, 9230];
  for (const candidate of candidates) {
    try {
      const response = await fetch(`http://127.0.0.1:${candidate}/json/version`, { signal: AbortSignal.timeout(800) });
      if (response.ok) return candidate;
    } catch { /* 下一个 */ }
  }
  return undefined;
}

/* ───────────────────────── 主流程 ───────────────────────── */

/* ───────────────────────── 常驻模式（推荐） ───────────────────────── */

/**
 * 常驻看守：**在页面还正常时**就 attach + `Debugger.enable`，然后持续探活。
 * 一旦主线程不响应 → 立即 `Debugger.pause` → 出栈。
 *
 * ## 为什么必须"提前 enable"（这组实测数字是关键）
 *
 * `diag-enable-timing.mjs` 在**已经冻死**的页面上量 `Debugger.enable`：
 *
 * | 场景 | 耗时 |
 * |---|---|
 * | 刚冻 1 秒就去 enable（冻 30 秒） | **29720ms** ← 等到冻结束才回 |
 * | 冻了 8 秒才 enable | 91ms |
 * | 有 GC 压力的冻，刚冻 1 秒 | 95ms |
 *
 * 结论：`Debugger.enable` **有时会等主线程**（不稳定）。而 `diag-debugger-pause.mjs`
 * 证明"**先 enable，再冻**"时 pause 只要 1005ms。
 * 所以取证工具必须长期驻留、提前 enable —— 这就是"守着"而不是"事后抢救"。
 */
async function watch() {
  const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
  const browser = await connect(version.webSocketDebuggerUrl);

  let sessionId;
  let pageInfo;
  let paused;

  const attach = async () => {
    const { targetInfos } = await browser.send("Target.getTargets");
    const page = targetInfos.find((target) => target.type === "page" && String(target.url).includes(APP_PATTERN))
      ?? targetInfos.find((target) => target.type === "page");
    if (page === undefined) return false;
    pageInfo = { url: page.url, pid: page.pid, targetId: page.targetId };
    const attached = await browser.send("Target.attachToTarget", { targetId: page.targetId, flatten: true });
    sessionId = attached.sessionId;
    await browser.send("Debugger.enable", {}, sessionId);
    browser.on("Debugger.paused", (params, sid) => { if (sid === undefined || sid === sessionId) paused = params; });
    return true;
  };

  console.log(`常驻看守启动（每 ${PROBE_MS / 1000}s 探活一次）`);
  await attach();
  console.log(`已 attach + Debugger.enable：${pageInfo?.url}`);

  let probing = false;
  const timer = setInterval(async () => {
    /*
     * 串行保护：探活本身可能挂住（它要经渲染进程），不能让下一拍再叠一个上去。
     * 第一版没有这个 guard，冻结期间每 2 秒叠一次探活，日志里一条都不打
     * （因为所有探活都在 waiting，而 withTimeout 的计时器只对**第一个**生效）。
     */
    if (probing) return;
    probing = true;
    try {
    if (sessionId === undefined) {
      if (!(await attach())) return;
    }
    /*
     * ⚠️ **不能靠 `Runtime.evaluate` 探活**（2026-11-23 实测）：
     * 页面 renderer 满核 100% 时，`Runtime.evaluate("1+1")` 照样 **1ms 返回 2** ——
     * 它在排队时会话由 DevTools agent 缓存，返回的是"我已经排上了"，不是"主线程跑完了"。
     * 我第一版据此判断"还活着"，于是永远发现不了冻结。
     *
     * 可靠判据只有一条：**`Debugger.pause` 之后，看它停在哪**。
     * 停在帧里（`location.lineNumber >= 0` 且有 url）才是真打断；停在 `(anonymous)` 无 url
     * 说明打断的是内部任务，主线程其实还很忙 —— 那就 resume 继续等。
     */
    const pauseStarted = Date.now();
    paused = undefined;
    if (DEBUG) console.log(`  [${new Date().toLocaleTimeString()}] 发 pause`);
    browser.send("Debugger.pause", {}, sessionId).catch(() => undefined);
    const pauseDeadline = Date.now() + PAUSE_WAIT_MS;
    while (paused === undefined && Date.now() < pauseDeadline) {
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    if (DEBUG) console.log(`  [${new Date().toLocaleTimeString()}] pause 结果: ${paused === undefined ? "超时" : "拿到栈"}`);
    if (paused === undefined) return;   // 没打断：不是冻结，下一拍再试

    /*
     * 判断这次 pause 是否"有意义"：顶层帧得有 url。
     * 没有 url 的 top frame 通常是 V8/Blink 内部的一次小任务（页面空闲时 pause 也会命中断点），
     * 那不算卡死 —— resume 后继续看守。
     */
    const topFrameOfPause = (paused.callFrames ?? [])[0];
    const hasRealFrame = topFrameOfPause !== undefined && String(topFrameOfPause.url ?? "") !== "";
    if (DEBUG) console.log(`  topFrame url=${JSON.stringify(String(topFrameOfPause?.url ?? ""))} line=${topFrameOfPause?.location?.lineNumber} fn=${topFrameOfPause?.functionName}`);
    if (!hasRealFrame) {
      paused = undefined;
      await withTimeout(browser.send("Debugger.resume", {}, sessionId), 3000, "resume");
      return;
    }

    console.log(`\n⚠️ 主线程无响应且已打断（${Date.now() - pauseStarted}ms）→ 出栈`);
    const started = Date.now();
    browser.send("Debugger.pause", {}, sessionId).catch(() => undefined);
    const deadline = Date.now() + PAUSE_WAIT_MS;
    while (paused === undefined && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    if (paused === undefined) {
      console.log(`${PAUSE_WAIT_MS}ms 内没拿到栈 —— 可能整个渲染进程被挂起了`);
      return;
    }

    const frames = paused.callFrames ?? [];
    const rows = await translateFrames(frames, (url) => loadSourceMapFor(url));
    console.log(`\n✅ 已暂停（${Date.now() - started}ms）`);
    printStack(rows);

    const snapshot = {};
    for (const [key, code] of [["messages", "document.querySelectorAll('[data-message-id]').length"], ["domNodes", "document.getElementsByTagName('*').length"]]) {
      const result = await withTimeout(browser.send("Runtime.evaluate", { expression: code, returnByValue: true }, sessionId), 3000, key);
      if (result.ok) snapshot[key] = result.value.result?.value;
    }

    mkdirSync(OUT_DIR, { recursive: true });
    const now = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    const outPath = join(OUT_DIR, `stack-${stamp}.json`);
    createWriteStream(outPath).end(JSON.stringify({
      ts: now.toISOString(), mode: "watch", page: pageInfo, reason: paused.reason,
      pausedAfterMs: Date.now() - started, snapshot, frames: rows,
    }, null, 1));
    const top = rows.find((row) => row.functionName !== "(anonymous)") ?? rows[0];
    console.log(`\n👉 卡在：${top?.functionName} @ ${top?.source}:${top?.line}:${top?.column}`);
    console.log(`已落盘 ${outPath}`);

    paused = undefined;
    if (!NO_RESUME) await withTimeout(browser.send("Debugger.resume", {}, sessionId), 5000, "resume");
    } finally {
      probing = false;
    }
  }, PROBE_MS);

  process.on("SIGINT", () => { clearInterval(timer); browser.close(); process.exit(0); });
}

const port = await discoverPort();
if (port === undefined) {
  console.error("找不到 CDP 端口。需要先这样启动浏览器：");
  console.error('  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --remote-debugging-port=9222');
  process.exit(2);
}
console.log(`CDP 端口 ${port}`);
if (WATCH) {
  await watch();
} else {

const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
const browser = await connect(version.webSocketDebuggerUrl);

/* 1) 找页面：优先 PID（更准），其次 URL 匹配 */
const { targetInfos } = await browser.send("Target.getTargets");
let page;
if (PIDS !== undefined) {
  const wanted = new Set(PIDS.split(",").map((value) => Number(value.trim())));
  page = targetInfos.find((target) => target.type === "page" && wanted.has(Number(target.pid ?? -1)));
}
page = page ?? targetInfos.find((target) => target.type === "page" && String(target.url).includes(APP_PATTERN));
page = page ?? targetInfos.find((target) => target.type === "page");
if (page === undefined) {
  console.error("没有页面 target。当前 targets：");
  for (const target of targetInfos) console.error(`  ${target.type}  ${target.url}`);
  browser.close();
  process.exit(2);
}
console.log(`目标页面 ${page.url}`);
console.log(`（pid ${page.pid ?? "?"}）`);

/* 2) attach（flatten 必须给；不给会得到 "Session with given id not found"） */
const attached = await withTimeout(browser.send("Target.attachToTarget", { targetId: page.targetId, flatten: true }), STEP_TIMEOUT_MS, "attach");
if (!attached.ok) {
  console.error(`attach 超时（${STEP_TIMEOUT_MS}ms）—— 这一关过不去，取证不可用`);
  browser.close();
  process.exit(3);
}
const sessionId = attached.value.sessionId;

/* 3) Debugger.enable：这一步在已冻死的页面上也成功（实测 6 秒内） */
const enabled = await withTimeout(browser.send("Debugger.enable", {}, sessionId), STEP_TIMEOUT_MS, "Debugger.enable");
if (!enabled.ok) {
  console.error(`Debugger.enable 超时（${STEP_TIMEOUT_MS}ms）`);
  browser.close();
  process.exit(3);
}
console.log("Debugger.enable 完成，发 pause…");

let paused;
browser.on("Debugger.paused", (params, sid) => {
  if (sid !== undefined && sid !== sessionId) return;
  paused = params;
});

const pauseStarted = Date.now();
browser.send("Debugger.pause", {}, sessionId).catch(() => undefined);
const deadline = Date.now() + PAUSE_WAIT_MS;
while (paused === undefined && Date.now() < deadline) {
  await new Promise((resolve) => setTimeout(resolve, 500));
}

if (paused === undefined) {
  console.error(`${PAUSE_WAIT_MS}ms 内没有 paused —— 可能页面没在跑 JS（空闲），或它真被系统挂起了`);
  browser.close();
  process.exit(4);
}

console.log(`\n✅ 已暂停（${Date.now() - pauseStarted}ms）reason=${paused.reason}`);
const frames = paused.callFrames ?? [];
const rows = await translateFrames(frames, (url) => loadSourceMapFor(url));
console.log(`\n调用栈（栈顶 = 卡住的地方）：`);
printStack(rows, `${APP_PATTERN.startsWith("http") ? APP_PATTERN : ""}`);

/* 4) 顺手把当时的几个现场数字读出来（能读到就带上） */
const snapshot = {};
for (const expression of [
  ["messages", "document.querySelectorAll('[data-message-id]').length"],
  ["domNodes", "document.getElementsByTagName('*').length"],
  ["visibility", "document.visibilityState"],
  ["url", "location.href"],
]) {
  const [key, code] = expression;
  const result = await withTimeout(
    browser.send("Runtime.evaluate", { expression: code, returnByValue: true }, sessionId),
    3000,
    `eval ${key}`,
  );
  if (result.ok) snapshot[key] = result.value.result?.value;
}

/* 5) 落盘 */
mkdirSync(OUT_DIR, { recursive: true });
const now = new Date();
const pad = (n) => String(n).padStart(2, "0");
const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
const outPath = join(OUT_DIR, `stack-${stamp}.json`);
const record = {
  ts: now.toISOString(),
  port,
  page: { url: page.url, pid: page.pid, targetId: page.targetId },
  reason: paused.reason,
  pausedAfterMs: Date.now() - pauseStarted,
  snapshot,
  frames: rows,
};
createWriteStream(outPath).end(JSON.stringify(record, null, 1));
console.log(`\n已落盘 ${outPath}`);

/* 6) 收尾 */
if (!NO_RESUME) {
  await withTimeout(browser.send("Debugger.resume", {}, sessionId), 5000, "resume");
  console.log("已 resume（页面继续跑）；加 --no-resume 可以保持暂停");
}
browser.close();

/* 7) 结论行：让不读栈的人也能一眼看懂 */
const top = rows.find((row) => row.functionName !== "(anonymous)") ?? rows[0];
if (top !== undefined) {
  console.log(`\n👉 卡在：${top.functionName} @ ${top.source}:${top.line}:${top.column}`);
  if (!top.mapped && top.source.endsWith(".js")) {
    console.log(`   （这是压缩后的位置，源码行需要 .map 才能翻译；dev server 下可直接读）`);
  }
}
if (!existsSync(OUT_DIR)) console.log(`（日志目录未创建：${OUT_DIR}）`);
process.exit(0);
}
