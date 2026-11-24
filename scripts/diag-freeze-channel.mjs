/**
 * 诊断：冻结期间数据为什么没到磁盘？（Task 0033 · P5 的失败定位）
 *
 * 实测现象（`verify-freeze-during-record.mjs`）：
 *   主线程冻死 10 秒期间，磁盘文件**完全不长**（0 KB）；解冻后一次性涨到 3.8 MB。
 *
 * 本脚本分离三个变量，判断是"CDP 推不动"还是"我的写法有问题"：
 *   1. 冻结期间 `Tracing.dataCollected` 事件数是否变化；
 *   2. 冻结期间 `Tracing.bufferUsage` 是否还在推（它是轻量帧，能证明通道活着）；
 *   3. 冻结期间 browser 级 HTTP 端点（`/json/version`）是否响应。
 *
 * 用法：node scripts/diag-freeze-channel.mjs --port 9226
 */

const args = process.argv.slice(2);
const argOf = (name, fallback) => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : fallback;
};
const PORT = Number(argOf("--port", 9222));
const FREEZE_MS = Number(argOf("--freeze-ms", 8000));

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find((target) => target.type === "page" && (String(target.url).includes("43120") || String(target.url).includes(":5173")));
if (page === undefined) { console.error("没有页面"); process.exit(2); }
console.log(`页面 ${page.url.slice(0, 80)}`);

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
      if (typeof message.method === "string") for (const handler of handlers.get(message.method) ?? []) handler(message.params);
    });
  });
}

const cdp = await connect(page.webSocketDebuggerUrl);
await cdp.send("Runtime.enable");
await cdp.send("Tracing.start", {
  categories: "v8,disabled-by-default-v8.cpu_profiler",
  transferMode: "ReportEvents",
});

let events = 0;
let bufferFrames = 0;
cdp.on("Tracing.dataCollected", (params) => { events += (params?.value ?? []).length; });
cdp.on("Tracing.bufferUsage", () => { bufferFrames += 1; });

console.log(`\n冻结主线程 ${FREEZE_MS / 1000} 秒，期间每 2 秒观察一次：`);
const freeze = cdp.send("Runtime.evaluate", {
  expression: `(function(){const d=Date.now()+${FREEZE_MS};while(Date.now()<d){};return "done";})()`,
  returnByValue: true,
}).catch((error) => ({ error: error.message }));

for (let tick = 1; tick <= Math.ceil(FREEZE_MS / 2000); tick += 1) {
  await new Promise((resolve) => setTimeout(resolve, 2000));
  const httpStart = Date.now();
  const httpOk = await fetch(`http://127.0.0.1:${PORT}/json/version`).then((response) => response.ok).catch(() => false);
  const httpMs = Date.now() - httpStart;
  console.log(`  ${tick * 2}s  事件=${String(events).padStart(6)}  bufferUsage帧=${bufferFrames}  HTTP=${httpOk ? "✅" : "❌"}(${httpMs}ms)`);
}

const frozenResult = await freeze;
console.log(`\n冻结结束：${JSON.stringify(frozenResult)}`);

await new Promise((resolve) => setTimeout(resolve, 3000));
console.log(`解冻后 3 秒：事件=${events}  bufferUsage帧=${bufferFrames}`);

await cdp.send("Tracing.end").catch(() => undefined);
await new Promise((resolve) => setTimeout(resolve, 2500));
console.log(`Tracing.end 之后：事件=${events}`);

console.log(`\n判读：`);
console.log(`  冻结期间事件不涨、bufferUsage 也不涨 → 整个 renderer 的 CDP 通道被主线程卡住`);
console.log(`  冻结期间 bufferUsage 还在涨       → 通道活着，是我的写法把它攒在内存里`);
cdp.close();
