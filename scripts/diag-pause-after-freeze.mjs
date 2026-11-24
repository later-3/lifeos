/**
 * 现实条件验证：**页面已经冻死之后**，才去 attach + Debugger.enable + pause，还能不能成功？
 * （Task 0033 · P5 的最后一道关）
 *
 * ## 为什么这一条决定方案能不能用
 *
 * 之前的实验（`diag-debugger-pause.mjs`）都是**先 enable、再制造死循环**——
 * 那是"有准备"的理想情况。真实事故是反过来的：
 *
 *   用户已经卡死 → 我才去连 → 这时 `Debugger.enable` 能不能成功？
 *
 * 这是整条方案的前提。如果 `Debugger.enable` 需要主线程配合（它要通知 V8 isolate），
 * 那"事后取证"就不成立，只能靠页面内预先埋点。
 *
 * ## 做法（严格模拟真实事故）
 *
 * 1. 用**纯 CDP**（不 attach）让页面冻死在死循环里，然后**断开连接**；
 * 2. 等 3 秒（确保它彻底冻住、且此时没有任何 DevTools 连接）；
 * 3. 像真实取证那样**新建连接**：attach → Runtime.enable → Debugger.enable → Debugger.pause；
 * 4. 记录每一步**耗时**，哪一步超时就是那一关过不去。
 *
 * 关键：全程每步都有超时，脚本自己不会挂死（上一版就是因为没有超时，400 秒没返回）。
 *
 * 用法：
 *   APP_URL=http://localhost:5183 node scripts/diag-pause-after-freeze.mjs --port 9227
 */

const args = process.argv.slice(2);
const argOf = (name, fallback) => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : fallback;
};
const PORT = Number(argOf("--port", 9227));
const APP = argOf("--app", "http://localhost:5183");
const FREEZE_MS = Number(argOf("--freeze-ms", 25_000));
const STEP_TIMEOUT_MS = Number(argOf("--step-timeout", 8_000));

/** 带超时的 Promise。所有 CDP 调用都过它 —— 不然一步卡住整脚本就挂死。 */
function withTimeout(promise, ms, label) {
  return Promise.race([
    promise.then((value) => ({ ok: true, value, ms: 0 })),
    new Promise((resolve) => setTimeout(() => resolve({ ok: false, ms, label }), ms)),
  ]);
}

function connect(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    let nextId = 0;
    const pending = new Map();
    const pendingMethods = new Map();
    const handlers = new Map();
    const openAt = Date.now();
    socket.addEventListener("open", () => resolve({
      openedInMs: Date.now() - openAt,
      send(method, params = {}, sessionId) {
        const id = ++nextId;
        const message = { id, method, params };
        if (sessionId !== undefined) message.sessionId = sessionId;
        socket.send(JSON.stringify(message));
        return new Promise((res, rej) => { pendingMethods.set(id, method); pending.set(id, { res, rej }); });
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
        pending.delete(message.id);
        if (message.error) {
          const method = pendingMethods.get(message.id) ?? "?";
          slot.rej(new Error(`${method}: ${message.error.message}`));
        }
        else slot.res(message.result);
        return;
      }
      if (typeof message.method === "string") {
        for (const handler of handlers.get(message.method) ?? []) handler(message.params, message.sessionId);
      }
    });
  });
}

/* ── 0. 找页面 ── */
const version = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find((target) => target.type === "page" && String(target.url).startsWith(APP))
  ?? list.find((target) => target.type === "page");
if (page === undefined) { console.error("没有页面 target"); process.exit(2); }
console.log(`页面 ${page.url}`);

/* ── 1. 先用一个**临时**连接把页面冻死，然后断开 ── */
console.log(`\n[阶段 1] 让页面冻死 ${FREEZE_MS / 1000} 秒（用临时连接注入，注入后立刻断开）`);
const burner = await connect(page.webSocketDebuggerUrl);
await burner.send("Runtime.enable");
const burn = `
  (function () {
    /* 外层包一个 setTimeout，让 Runtime.evaluate 立刻返回（否则它自己要等循环结束） */
    setTimeout(function () {
      const stop = Date.now() + ${FREEZE_MS};
      window.__lifeos_refreeze_end__ = stop;
      while (Date.now() < stop) { /* 纯死循环，不让出事件循环 */ }
      window.__lifeos_refreeze_done__ = true;
    }, 50);
    return "scheduled";
  })()
`;
const injected = await withTimeout(burner.send("Runtime.evaluate", { expression: burn, returnByValue: true }), 5000, "inject");
console.log(`  注入：${injected.ok ? JSON.stringify(injected.value.result?.value) : "超时"}`);
burner.close();
console.log(`  已断开所有 DevTools 连接；等 3 秒确保彻底冻住…`);
await new Promise((resolve) => setTimeout(resolve, 3000));

/* ── 2. 模拟真实取证：全新连接 ── */
console.log(`\n[阶段 2] 像真实事故那样重新连上去（此时页面已经冻死）`);
const steps = [];
let pausedEvent;
let sessionId;

const browser = await connect(version.webSocketDebuggerUrl);
steps.push({ step: "连 browser-level WS", ...(await withTimeout(Promise.resolve(true), 1, "ws")), ok: true, ms: 0 });
console.log(`  ✅ 连上 browser-level（页面冻死不影响它）`);

/*
 * `/json/list` 里页面标识字段是 **`id`**（美式拼写），而 `Target.getTargets` 返回的是
 * `targetId`。第一次写成 `page.targetId` 拿到 undefined →
 * `Target.attachToTarget` 报 "Invalid parameters"（实测踩到）。
 */
const pageTargetId = page.id ?? page.targetId;
if (pageTargetId === undefined) { console.error("/json/list 里没有 id 字段"); process.exit(2); }

const targets = await withTimeout(browser.send("Target.getTargets"), STEP_TIMEOUT_MS, "Target.getTargets");
console.log(`  ${targets.ok ? "✅" : "❌"} Target.getTargets`);
if (!targets.ok) { console.log("\n→ 这一步就过不去：browser 进程也被拖住了"); browser.close(); process.exit(1); }

/*
 * **`flatten: true` 必须给**。
 *
 * 之前我误以为它导致 "Invalid parameters"，实际上那次报错是 `targetId` 传了 undefined。
 * 不加 flatten 时 CDP 走 `Target.sendMessageToTarget` 转发模型，
 * 直接在消息里带 `sessionId` 会得到 "Session with given id not found"（实测踩到）。
 */
const attached = await withTimeout(browser.send("Target.attachToTarget", { targetId: pageTargetId, flatten: true }), STEP_TIMEOUT_MS, "attach");
console.log(`  ${attached.ok ? "✅" : "❌"} Target.attachToTarget`);
if (!attached.ok) { console.log("\n→ attach 失败：页面冻死时连不上它的 agent"); browser.close(); process.exit(1); }
sessionId = attached.value.sessionId;

/*
 * ⭐ 这一条是全部方案的关键：`Debugger.enable` 在**已冻死**的页面上能不能成功。
 * 它要让 renderer 的 DevTools agent 去 V8 isolate 上注册 debug delegate。
 */
const enabled = await withTimeout(browser.send("Debugger.enable", {}, sessionId), STEP_TIMEOUT_MS, "Debugger.enable");
console.log(`  ${enabled.ok ? "✅" : "❌"} Debugger.enable${enabled.ok ? "" : `（${STEP_TIMEOUT_MS}ms 超时）`}`);
if (!enabled.ok) {
  console.log("\n❌ 关键结论：**已冻死的页面无法启用 Debugger** → 事后取证不成立");
  browser.close();
  process.exit(1);
}

browser.on("Debugger.paused", (params, sid) => { if (sid === undefined || sid === sessionId) pausedEvent = params; });

/* ── 3. pause ── */
const pauseStart = Date.now();
browser.send("Debugger.pause", {}, sessionId).catch(() => undefined);
for (let tick = 1; tick <= 10; tick += 1) {
  await new Promise((resolve) => setTimeout(resolve, 1000));
  if (pausedEvent !== undefined) break;
  console.log(`  ${tick}s 仍未 paused`);
}

if (pausedEvent === undefined) {
  console.log(`\n❌ ${Date.now() - pauseStart}ms 内没打断`);
  browser.close();
  process.exit(1);
}

const frames = pausedEvent.callFrames ?? [];
console.log(`\n✅ Debugger.paused（${Date.now() - pauseStart}ms）reason=${pausedEvent.reason}，${frames.length} 层`);
for (const [index, frame] of frames.slice(0, 15).entries()) {
  const name = frame.functionName === "" ? "(anonymous)" : frame.functionName;
  const url = String(frame.url ?? "").replace(APP, "");
  console.log(`  ${index}. ${name.padEnd(30)} ${url}:${frame.location?.lineNumber}:${frame.location?.columnNumber}`);
}

const hitOurLoop = frames.some((frame) => frame.location?.lineNumber >= 0 && String(frame.url).startsWith(APP));
console.log(`\n结论：`);
console.log(`  ✅ 已冻死的页面**可以**事后 attach + Debugger.enable + pause`);
console.log(`  栈里是否有源码位置：${hitOurLoop ? "✅ 有" : "⚠️ 只有匿名脚本（本次注入的是匿名 IIFE，符合预期）"}`);
console.log(`  → 真实卡死时，栈顶就是产品代码，能直接读出 文件:行:列`);

/* 让页面继续跑完（它会自己停，因为死循环有 deadline）；不 resume 也行，但 resume 更干净 */
await withTimeout(browser.send("Debugger.resume", {}, sessionId), 3000, "resume");
browser.close();
process.exit(0);
