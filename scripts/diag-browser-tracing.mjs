/**
 * 关键验证：**browser-level** 的 CDP Tracing 是否不受渲染主线程冻结影响（Task 0033 · P5）。
 *
 * ## 为什么要测这个
 *
 * 上一轮实测（`diag-freeze-channel.mjs`）：
 *
 * ```
 * 冻结 8 秒期间：事件 = 0，bufferUsage 帧 = 0，而 /json/version 一直 1ms 正常
 * 解冻之后：一次性涌进来 3140 个事件
 * ```
 *
 * 结论：**page-level 的 Trace 数据要经过渲染进程的 DevTools agent，而它跑在主线程上**
 * ——主线程一冻，数据全部堵在进程里，和 `Profiler.stop` 的死法一模一样。
 * 这是我第一版方案的致命缺陷。
 *
 * ## 这次测什么
 *
 * browser-level CDP（`/json/version` 的 `webSocketDebuggerUrl`）由 **browser 进程的 IO 线程**
 * 驱动。浏览器级 `Tracing.start` 启动的是**全局 TracingController**，
 * 各进程的 trace agent 通过 mojo 把数据送到 browser 进程（走各自的 tracing 线程，
 * 不经渲染主线程）。如果这个前提成立，冻结期间数据就会持续到达。
 *
 * ## 判据（只有一条）
 *
 * 冻结期间事件数**必须持续增长**。否则这条路也断，必须改用代码内埋点。
 *
 * 用法：node scripts/diag-browser-tracing.mjs --port 9226
 */

const args = process.argv.slice(2);
const argOf = (name, fallback) => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : fallback;
};
const PORT = Number(argOf("--port", 9222));
const FREEZE_MS = Number(argOf("--freeze-ms", 8000));
const CATEGORIES = "toplevel,v8,disabled-by-default-v8.cpu_profiler,disabled-by-default-v8.cpu_profiler.hires";

/* ── 极简 CDP 客户端 ── */
function connect(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    let nextId = 0;
    const pending = new Map();
    const handlers = new Map();
    socket.addEventListener("open", () => resolve({
      send(method, params = {}, sessionId) {
        const id = ++nextId;
        const message = { id, method, params };
        if (sessionId !== undefined) message.sessionId = sessionId;
        socket.send(JSON.stringify(message));
        return new Promise((res, rej) => pending.set(id, { res, rej }));
      },
      on(method, handler) {
        if (!handlers.has(method)) handlers.set(method, []);
        handlers.get(method).push(handler);
      },
      close() { try { socket.close(); } catch { /* 已关 */ } },
    }));
    socket.addEventListener("error", reject);
    socket.addEventListener("message", (event) => {
      if (typeof event.data !== "string") return;
      const message = JSON.parse(event.data);
      if (message.id != null) {
        const slot = pending.get(message.id);
        if (slot === undefined) return;
        pending.delete(message.id);
        if (message.error) slot.rej(new Error(message.error.message));
        else slot.res(message.result);
        return;
      }
      if (typeof message.method === "string") {
        for (const handler of handlers.get(message.method) ?? []) handler(message.params, message.sessionId);
      }
    });
  });
}

/* ── 1. 连 browser-level ── */
const version = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
const browserWs = version.webSocketDebuggerUrl;
if (browserWs === undefined) { console.error("/json/version 里没有 webSocketDebuggerUrl"); process.exit(2); }
console.log(`browser-level CDP: ${String(browserWs).slice(0, 80)}`);

const browser = await connect(browserWs);

/* ── 2. 找到我们的页面 target ── */
const { targetInfos } = await browser.send("Target.getTargets");
const ours = targetInfos.filter((target) => target.type === "page" && (String(target.url).includes("43120") || String(target.url).includes(":5173")));
const page = ours[0] ?? targetInfos.find((target) => target.type === "page");
if (page === undefined) { console.error("没有页面 target"); process.exit(2); }
console.log(`目标页面 ${page.url.slice(0, 80)}（targetId ${page.targetId}）`);

/* ── 3. browser-level Tracing.start ── */
let events = 0;
let chunks = 0;
browser.on("Tracing.dataCollected", (params) => {
  const value = params?.value ?? [];
  events += value.length;
  chunks += value.filter((event) => event.name === "ProfileChunk" || event.name === "Profile").length;
});

/*
 * 用 `traceConfig` 而不是 `categories + options`（CDP 明确禁止两者同时给）。
 *
 * `flushInterval` 是关键：默认 TracingController 攒一批再送，
 * 对取证来说"晚到"等于"丢失"（进程被杀就没了）。1000ms 一次 flush
 * 才能保证冻结那一刻之前的数据已经在我们手里。
 */
await browser.send("Tracing.start", {
  traceConfig: {
    includedCategories: CATEGORIES.split(","),
    flushInterval: 1000,
  },
  transferMode: "ReportEvents",
});
console.log(`Tracing.start（browser-level）已发；categories=${CATEGORIES}`);

/* ── 4. 冻结页面主线程（通过 page session） ── */
const { sessionId } = await browser.send("Target.attachToTarget", { targetId: page.targetId, flatten: true });
await browser.send("Runtime.enable", {}, sessionId);

const freeze = browser.send("Runtime.evaluate", {
  expression: `(function(){const d=Date.now()+${FREEZE_MS};while(Date.now()<d){};return "done";})()`,
  returnByValue: true,
}, sessionId).then((result) => result.result?.value).catch((error) => `error: ${error.message}`);

/* ── 5. 冻结期间观察 ── */
console.log(`\n冻结主线程 ${FREEZE_MS / 1000} 秒，期间每 2 秒看一次数据是否还在到：`);
const ticks = [];
for (let tick = 1; tick <= Math.ceil(FREEZE_MS / 2000); tick += 1) {
  await new Promise((resolve) => setTimeout(resolve, 2000));
  ticks.push({ tick, events, chunks });
  console.log(`  ${tick * 2}s  事件=${String(events).padStart(6)}  ProfileChunk=${String(chunks).padStart(5)}`);
}

const frozen = await freeze;
console.log(`\n冻结结束：${JSON.stringify(frozen)}`);

await new Promise((resolve) => setTimeout(resolve, 3000));
console.log(`解冻后 3 秒：事件=${events}  ProfileChunk=${chunks}`);

await browser.send("Tracing.end").catch(() => undefined);
await new Promise((resolve) => setTimeout(resolve, 3000));
console.log(`Tracing.end 之后：事件=${events}  ProfileChunk=${chunks}`);

/* ── 6. 判读 ── */
const grewDuringFreeze = ticks.length >= 2 && ticks[ticks.length - 1].events > ticks[0].events;
const chunksDuringFreeze = ticks[ticks.length - 1]?.chunks ?? 0;

console.log(`\n判读：`);
console.log(`  冻结期间事件增长：${grewDuringFreeze ? "✅ 是" : "❌ 否"}`);
console.log(`  冻结期间收到的 ProfileChunk：${chunksDuringFreeze}`);
if (grewDuringFreeze && chunksDuringFreeze > 0) {
  console.log(`  → ✅ browser-level 可行：卡死期间数据能持续落盘，方案成立`);
} else if (grewDuringFreeze) {
  console.log(`  → ◐ 通道活着，但冻结期间没有函数级样本（可能 V8 profiler 本身也跑在主线程）`);
} else {
  console.log(`  → ❌ browser-level 也不行，必须改用代码内 performance.mark 埋点`);
}

browser.close();
process.exit(grewDuringFreeze && chunksDuringFreeze > 0 ? 0 : 1);
