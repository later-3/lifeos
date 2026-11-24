/**
 * 验证：CDP Tracing 录制器能否抓到"正在烧 CPU 的那个函数"（Task 0033 · P5）。
 *
 * ## 为什么需要这个测试
 *
 * 录制器能产出事件、能把地址翻译成函数名 —— 那只能证明"格式对"。
 * 真正要证明的是：**当某个函数在烧 CPU 时，排行第一名就是它**。
 *
 * ## 做法（三步，全部在一个进程里，不启子进程）
 *
 * 1. 连上页面 CDP，注入一个**已知的热点函数**（自带名字）；
 * 2. 直接在同一连接上 `Tracing.start`，然后触发热点跑 N 秒；
 * 3. `Tracing.end` 收完事件 → 分析 → 断言第一名是这个函数。
 *
 * 为什么不用子进程跑录制器：写第一版时用的是 `run(...)` 等子进程结束，
 * 结果子进程的 `--once` 要等满 30 秒、外面又叠了 verify 自己的等待，
 * 整条链 400 秒没回来（实测）。单进程内直接控制 "start → burn → end" 最短、
 * 也最容易看出哪一步卡住。
 *
 * 用法：node scripts/verify-cdp-recorder.mjs --port 9226
 */

import { summarize } from "./cdp-trace-summary.mjs";

const args = process.argv.slice(2);
const argOf = (name, fallback) => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : fallback;
};

const PORT = argOf("--port", "9222");
const BURN_MS = Number(argOf("--burn-ms", 4000));
const HOT_NAME = "__lifeos_probe_hot_function__";

/* ── 1. 找页面 ── */
async function pickPage() {
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const pages = list.filter((target) => target.type === "page");
  const ours = pages.filter((target) => String(target.url).includes("43120") || String(target.url).includes(":5173"));
  const picked = ours[0] ?? pages[0];
  if (picked === undefined) {
    console.error("没有可用的页面 target");
    process.exit(2);
  }
  return picked;
}

/* ── 2. 极简 CDP（一个连接上既能 send 又能收事件） ── */
function connect(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    let nextId = 0;
    const pending = new Map();
    const handlers = new Map();
    socket.addEventListener("open", () => resolve({
      send(method, params = {}) {
        const id = ++nextId;
        socket.send(JSON.stringify({ id, method, params }));
        return new Promise((res, rej) => pending.set(id, { res, rej }));
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
        pending.delete(message.id);
        if (message.error) slot.rej(new Error(message.error.message ?? "cdp error"));
        else slot.res(message.result);
        return;
      }
      if (typeof message.method === "string") {
        for (const handler of handlers.get(message.method) ?? []) handler(message.params);
      }
    });
  });
}

const page = await pickPage();
console.log(`目标页面 ${page.url}`);

const cdp = await connect(page.webSocketDebuggerUrl);
await cdp.send("Runtime.enable");

/* ── 3. 开录（只要 v8 函数级样本） ── */
const events = [];
let chunks = 0;
cdp.on("Tracing.dataCollected", (params) => {
  const value = params?.value ?? [];
  for (const event of value) {
    if (event.name === "ProfileChunk" || event.name === "Profile") { events.push(event); chunks += 1; }
  }
});
let complete = false;
cdp.on("Tracing.tracingComplete", () => { complete = true; });

await cdp.send("Tracing.start", {
  categories: "v8,disabled-by-default-v8.cpu_profiler,disabled-by-default-v8.cpu_profiler.hires",
  options: "sampling-frequency=1000",
  transferMode: "ReportEvents",
});
console.log("Tracing.start 已发");

/* ── 4. 注入热点并触发（不 await 那 5 秒，否则本进程也跟着等） ── */
const inject = `
  window.${HOT_NAME} = function ${HOT_NAME}(deadline) {
    let acc = 0;
    while (performance.now() < deadline) { acc += Math.sqrt(acc + 1); }
    return acc;
  };
  window.__lifeos_probe_started__ = performance.now();
  setTimeout(() => window.${HOT_NAME}(performance.now() + ${BURN_MS}), 50);
  "scheduled";
`;
const evaluated = await cdp.send("Runtime.evaluate", { expression: inject, returnByValue: true });
console.log(`注入结果 ${JSON.stringify(evaluated.result?.value)}`);

console.log(`等待 ${BURN_MS / 1000} 秒（热点在页面里烧 CPU）…`);
await new Promise((resolve) => setTimeout(resolve, BURN_MS + 1_500));

/* ── 5. 停录 + 等 tracingComplete ── */
console.log("Tracing.end…");
await cdp.send("Tracing.end");
const deadline = Date.now() + 20_000;
while (!complete && Date.now() < deadline) {
  await new Promise((resolve) => setTimeout(resolve, 200));
}
console.log(`收到 ${chunks} 个 ProfileChunk；tracingComplete=${complete}`);

/* ── 6. 分析 + 断言 ── */
const summary = summarize(events);
const top = summary.rows.filter((row) => row.functionName !== "(idle)" && row.functionName !== "(program)");
const hot = top.filter((row) => row.functionName.includes("lifeos_probe_hot"));

console.log(`\n样本总数 ${summary.totalSamples}`);
console.log(`非 idle 排行前 5：`);
for (const row of top.slice(0, 5)) {
  const pct = ((row.count / summary.totalSamples) * 100).toFixed(1);
  console.log(`  ${String(row.count).padStart(6)}  ${pct.padStart(5)}%  ${row.functionName.padEnd(38)} ${row.url}:${row.line}`);
}
console.log(`\n注入函数命中：${hot.length} 条`);
for (const row of hot.slice(0, 3)) console.log(`  ${row.count} 样本  ${row.functionName}  ${row.url}:${row.line}:${row.column}`);

const found = hot.length > 0;
const isTop = top[0] !== undefined && top[0].functionName.includes("lifeos_probe_hot");
console.log(`\n结果：`);
console.log(`  抓到注入的热点函数：${found ? "✅ 是" : "❌ 否"}`);
console.log(`  它是非 idle 第一名：${isTop ? "✅ 是" : "❌ 否"}`);
cdp.close();
process.exit(found && isTop ? 0 : 1);
