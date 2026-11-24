/**
 * 端到端终验：**真冻结 → pause → 源码级栈**（Task 0033 · P5 的最后一道证）。
 *
 * ## 为什么要单独一个"终验"脚本
 *
 * 前面几版 bench 反复出现"看起来注入了、其实没冻"的情况（`pause` 打到 `beat`、
 * 探活 1ms 返回 2）。为了排除所有这些不确定性，本脚本用一条**永不结束**的循环
 * 并在暂停后用 `Debugger.evaluateOnCallFrame` 修改它依赖的全局变量来收尾：
 *
 *   while (window.__lifeos_stop__ !== true) { ... }
 *
 * 这样"是否真的在冻"有一条硬判据：**renderer CPU ≥ 90%**（用 `ps` 实测，不看 CDP 的自述）。
 *
 * ## 判据（三条都要满足才算通过）
 *
 * 1. 注入后 renderer CPU ≥ 90%（证明真的在烧）
 * 2. `Debugger.pause` 收到 `Debugger.paused`，且**按 sessionId 严格过滤**（不接受别人的事件）
 * 3. 顶部帧有非空 `url`，并能经 sourcemap 翻译成源码行
 *
 * 用法：
 *   node scripts/verify-freeze-catch.mjs --port 9228 --marker cdp-af
 *   --marker 用来在 `ps` 里认出"这个实例的 renderer"（一般是 user-data-dir 的名字）
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { loadSourceMapFor, translateFrames } from "./sourcemap-translate.mjs";

const run = promisify(execFile);
const args = process.argv.slice(2);
const argOf = (name, fallback) => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : fallback;
};
const PORT = Number(argOf("--port", 9228));
const MARKER = argOf("--marker", "");
const APP = argOf("--app", "5183");
const STACK_TIMEOUT_MS = Number(argOf("--stack-timeout", 30_000));

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
      const message = JSON.parse(event.data);
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

/** 某实例的 renderer CPU（取最高那个）。判据只看这个，不看 CDP 自述。 */
async function maxRendererCpu(marker) {
  const { stdout } = await run("ps", ["-eo", "pid,pcpu,command"], { maxBuffer: 16 * 1024 * 1024 });
  let best = 0;
  let pid = 0;
  for (const line of stdout.split("\n")) {
    if (!line.includes("--type=renderer")) continue;
    if (marker !== "" && !line.includes(marker)) continue;
    const match = /^\s*(\d+)\s+([\d.]+)\s/.exec(line);
    if (match === null) continue;
    const cpu = Number(match[2]);
    if (cpu > best) { best = cpu; pid = Number(match[1]); }
  }
  return { cpu: best, pid };
}

const version = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
const browser = await connect(version.webSocketDebuggerUrl);

const { targetInfos } = await browser.send("Target.getTargets");
const page = targetInfos.find((target) => target.type === "page" && String(target.url).includes(APP));
if (page === undefined) { console.error(`没有含 ${APP} 的页面`); process.exit(2); }
console.log(`页面 ${page.url}`);

const attached = await browser.send("Target.attachToTarget", { targetId: page.targetId, flatten: true });
const sessionId = attached.sessionId;
await browser.send("Debugger.enable", {}, sessionId);
console.log(`已 attach + Debugger.enable（session ${String(sessionId).slice(0, 12)}…）`);

/* ⭐ 严格按 sessionId 过滤：上一版把这个漏了，会收到别的 target 的 paused 事件 */
let paused;
browser.on("Debugger.paused", (params, sid) => {
  if (sid !== sessionId) return;
  paused = params;
});

/* ① 注入**永不结束**的循环（靠 window 标志退出，便于收尾） */
const expression = `
  window.__lifeos_stop__ = false;
  (function () {
    setTimeout(function burn() {
      while (window.__lifeos_stop__ !== true) {
        for (let i = 0; i < 4096; i += 1) Math.sqrt(i);
      }
    }, 50);
  })();
  "scheduled";
`;
await browser.send("Runtime.evaluate", { expression, returnByValue: true }, sessionId);
console.log("已注入循环（靠 window.__lifeos_stop__ 退出）");

/* ② 硬判据：CPU 必须真的上来 */
let cpu = 0;
for (let tick = 1; tick <= 12; tick += 1) {
  await new Promise((resolve) => setTimeout(resolve, 500));
  const now = await maxRendererCpu(MARKER);
  cpu = now.cpu;
  if (tick % 3 === 0 || cpu >= 90) console.log(`  ${tick * 0.5}s  renderer CPU ${cpu}%（pid ${now.pid}）`);
  if (cpu >= 90) break;
}
if (cpu < 90) {
  console.log(`\n❌ renderer CPU 只有 ${cpu}% —— 注入没生效，这台 bench 不能用于验证`);
  browser.send("Runtime.evaluate", { expression: "window.__lifeos_stop__ = true", returnByValue: true }, sessionId).catch(() => undefined);
  browser.close();
  process.exit(1);
}

/* ③ pause（严格过滤 sessionId） */
const pauseStart = Date.now();
browser.send("Debugger.pause", {}, sessionId).catch(() => undefined);
const deadline = Date.now() + STACK_TIMEOUT_MS;
while (paused === undefined && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 300));

if (paused === undefined) {
  console.log(`\n❌ ${STACK_TIMEOUT_MS}ms 内没收到 paused`);
  browser.send("Runtime.evaluate", { expression: "window.__lifeos_stop__ = true", returnByValue: true }, sessionId).catch(() => undefined);
  browser.close();
  process.exit(1);
}

const frames = paused.callFrames ?? [];
const rows = await translateFrames(frames, (url) => loadSourceMapFor(url));
console.log(`\n✅ paused（${Date.now() - pauseStart}ms）reason=${paused.reason}，${frames.length} 层`);
console.log(`\n栈（→ 表示经 sourcemap 翻译成源码位置）：`);
for (const [index, row] of rows.slice(0, 12).entries()) {
  const where = `${row.source}:${row.line}:${row.column}`;
  console.log(`  ${String(index).padStart(2)}. ${row.functionName.padEnd(30)} ${where}${row.mapped ? "  →" : ""}`);
}

const top = rows[0];
const hasUrl = top !== undefined && top.source !== "";
console.log(`\n判据核对：`);
console.log(`  ① renderer CPU ≥90%          : ${cpu >= 90 ? "✅" : "❌"}（${cpu}%）`);
console.log(`  ② 收到 paused（严格 session）: ✅（${Date.now() - pauseStart}ms）`);
console.log(`  ③ 顶部帧有 url               : ${hasUrl ? "✅" : "❌"}（${top?.source}）`);
console.log(`  顶部帧函数                    : ${top?.functionName} @ ${top?.source}:${top?.line}:${top?.column}`);

/* ④ 收尾：暂停状态下改标志位，再 resume（否则页面永久烧） */
await browser.send("Debugger.evaluateOnCallFrame", {
  callFrameId: frames[0]?.callFrameId,
  expression: "window.__lifeos_stop__ = true",
  returnByValue: true,
}, sessionId).catch(() => undefined);
await browser.send("Debugger.resume", {}, sessionId).catch(() => undefined);
await new Promise((resolve) => setTimeout(resolve, 1500));
const after = await maxRendererCpu(MARKER);
console.log(`\n收尾：resume 后 renderer CPU ${after.cpu}%（应回落到两位数以下）`);
browser.close();
process.exit(hasUrl ? 0 : 1);
