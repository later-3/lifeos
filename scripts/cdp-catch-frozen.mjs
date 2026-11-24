/**
 * 已冻死页面的取证（Task 0033 · 现场工具）。
 *
 * ## 与 `cdp-freeze-catch.mjs` 的区别
 *
 * `cdp-freeze-catch.mjs` 走的是 "attach → Debugger.enable → pause"，在**活页面**上很可靠
 * （实测 304ms）。但在**已冻死**的页面上实测两次都卡在 `Debugger.enable`：
 *
 *   --timeout 12000 → 超时
 *   --timeout 60000 → 超时
 *
 * 而 `diag-enable-timing.mjs` 量到：冻死页面上的 `Debugger.enable`
 * **取决于冻结已进行多久**（刚冻 1 秒 → 29720ms；冻了 8 秒 → 91ms）。
 *
 * ## 本脚本的策略：**先探活，再决定**
 *
 * 1. attach（走 browser 进程，不受主线程影响，实测 0ms）；
 * 2. `Runtime.evaluate("1+1")` 带超时：
 *    - **正常返回** → 页面活着，直接 `Debugger.enable` + `pause`（快路径）
 *    - **超时** → 页面确实冻着，`Debugger.enable` 可能要等；改用**轮询 enable + pause**
 *      直到拿到 paused（最长给 `--wait` 秒）
 * 3. 拿到栈就立刻落盘（不要等收尾都做完）。
 *
 * 这是"事故现场"用的脚本，所以每一步都打时间戳，失败也告诉你卡在哪一步。
 *
 * 用法：
 *   node scripts/cdp-catch-frozen.mjs --port 9222
 *   node scripts/cdp-catch-frozen.mjs --port 9222 --wait 180
 */

import { createWriteStream, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { loadSourceMapFor, printStack, translateFrames } from "./sourcemap-translate.mjs";

const args = process.argv.slice(2);
const argOf = (name, fallback) => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : fallback;
};
const PORT = Number(argOf("--port", 9222));
const APP = argOf("--app", "43120");
const WAIT_SECONDS = Number(argOf("--wait", 120));
const ENABLE_TIMEOUT_MS = Number(argOf("--enable-timeout", 30_000));

const HOME = process.env.LIFEOS_HOME ?? join(homedir(), ".lifeos");
const OUT_DIR = join(HOME, "logs", "freeze-stacks");
const stamp = () => new Date().toISOString().slice(11, 19);
const log = (message) => console.log(`[${stamp()}] ${message}`);

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
      if (typeof message.method === "string") for (const handler of handlers.get(message.method) ?? []) handler(message.params, message.sessionId);
    });
  });
}

function timeoutOf(promise, ms, label) {
  return Promise.race([
    promise.then((value) => ({ ok: true, value })),
    new Promise((resolve) => setTimeout(() => resolve({ ok: false, label }), ms)),
  ]);
}

/* ── 连 browser-level ── */
const version = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
log(`CDP ${PORT} · ${version.Browser}`);
const browser = await connect(version.webSocketDebuggerUrl);

/* ── 找页面 ── */
const { targetInfos } = await browser.send("Target.getTargets");
const page = targetInfos.find((target) => target.type === "page" && String(target.url).includes(APP))
  ?? targetInfos.find((target) => target.type === "page");
if (page === undefined) { console.error("没有页面 target"); process.exit(2); }
log(`页面 ${page.url}`);

/* ── attach（不受主线程影响） ── */
const attached = await timeoutOf(browser.send("Target.attachToTarget", { targetId: page.targetId, flatten: true }), 10_000, "attach");
if (!attached.ok) { console.log(`❌ attach 超时 —— 连 browser 层都不通了`); process.exit(3); }
const sessionId = attached.value.sessionId;
log(`attach ✅（session ${String(sessionId).slice(0, 12)}…）`);

/*
 * `scriptId → url` 映射：必须在 `Debugger.enable` 之前挂好（enable 会重放全部脚本）。
 * 不挂的话 `callFrame.url` 恒为空（2026-11-24 实测）。
 */
const scriptUrls = new Map();
browser.on("Debugger.scriptParsed", (params, sid) => {
  if (sid !== undefined && sid !== sessionId) return;
  if (typeof params?.url === "string" && params.url !== "") scriptUrls.set(params.scriptId, params.url);
});

let paused;
browser.on("Debugger.paused", (params, sid) => { if (sid === sessionId) paused = params; });

/* ── 探活：判断它是否真的冻着 ── */
const probe = await timeoutOf(browser.send("Runtime.evaluate", { expression: "1+1", returnByValue: true }, sessionId), 5_000, "probe");
log(`探活 ${probe.ok ? "正常返回（页面能响应）" : "超时（页面确实冻着）"}`);

/* ── Debugger.enable：带超时；失败就重试（它是唯一必须的一步） ── */
let enabled = false;
for (let attempt = 1; attempt <= 3 && !enabled; attempt += 1) {
  const result = await timeoutOf(browser.send("Debugger.enable", {}, sessionId), ENABLE_TIMEOUT_MS, "enable");
  enabled = result.ok;
  log(`Debugger.enable 第 ${attempt} 次：${enabled ? "✅" : `超时 ${ENABLE_TIMEOUT_MS}ms`}`);
}
if (!enabled) {
  console.log("❌ Debugger.enable 一直超时 —— 这次抓不到栈（下次卡死请更快通知我，或页面保持在前台）");
  browser.close();
  process.exit(4);
}

/* ── pause + 等到有 url 的帧 ── */
const deadline = Date.now() + WAIT_SECONDS * 1000;
let realStack;
while (Date.now() < deadline && realStack === undefined) {
  paused = undefined;
  browser.send("Debugger.pause", {}, sessionId).catch(() => undefined);
  const pauseDeadline = Date.now() + 20_000;
  while (paused === undefined && Date.now() < pauseDeadline) await new Promise((resolve) => setTimeout(resolve, 300));
  if (paused === undefined) { log("pause 无响应，重试…"); continue; }

  const top = (paused.callFrames ?? [])[0];
  const hasUrl = top !== undefined && String(top.url ?? "") !== "";
  if (!hasUrl) {
    log(`pause 命中的是无 url 的帧（${top?.functionName ?? "?"}），resume 重试…`);
    await timeoutOf(browser.send("Debugger.resume", {}, sessionId), 5000, "resume");
    await new Promise((resolve) => setTimeout(resolve, 500));
    continue;
  }
  realStack = paused;
}

if (realStack === undefined) {
  console.log(`❌ ${WAIT_SECONDS}s 内没抓到带 url 的帧`);
  browser.close();
  process.exit(5);
}

const frames = realStack.callFrames ?? [];
const rows = await translateFrames(frames, (url) => loadSourceMapFor(url), scriptUrls);
console.log(`\n✅ 栈（${frames.length} 层）：`);
printStack(rows);

/* ── 现场数字 ── */
const snapshot = {};
for (const [key, expression] of [
  ["messages", "document.querySelectorAll('[data-message-id]').length"],
  ["domNodes", "document.getElementsByTagName('*').length"],
  ["url", "location.href"],
  ["visibility", "document.visibilityState"],
]) {
  const result = await timeoutOf(browser.send("Runtime.evaluate", { expression, returnByValue: true }, sessionId), 3000, key);
  if (result.ok) snapshot[key] = result.value.result?.value;
}

/* ── 落盘（先落盘再收尾） ── */
mkdirSync(OUT_DIR, { recursive: true });
const outPath = join(OUT_DIR, `frozen-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
createWriteStream(outPath).end(JSON.stringify({
  ts: new Date().toISOString(), port: PORT, page: { url: page.url, targetId: page.targetId },
  reason: realStack.reason, frames: rows, snapshot,
}, null, 1));
log(`已落盘 ${outPath}`);

const top = rows[0];
console.log(`\n👉 卡在：${top?.functionName} @ ${top?.source}:${top?.line}:${top?.column}`);
console.log(`   现场：消息 ${snapshot.messages ?? "?"} 条 · DOM ${snapshot.domNodes ?? "?"} 节点 · ${snapshot.url ?? ""}`);

/* ── 收尾：resume（不 resume 会让页面永久停住） ── */
await timeoutOf(browser.send("Debugger.resume", {}, sessionId), 5000, "resume");
log("已 resume");
browser.close();
process.exit(0);
