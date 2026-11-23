/**
 * 关键验证：`Debugger.pause` 能否在**死循环里**打断并拿到调用栈（Task 0033 · P5）。
 *
 * ## 为什么这是最后一根救命稻草
 *
 * 前两条路都实测失败（见 `diag-freeze-channel.mjs` / `diag-browser-tracing.mjs`）：
 * page-level 与 browser-level 的 `Tracing` 在冻结期间**都收不到任何数据**
 * —— 因为 CPU 样本是 V8 在主线程采样后经 mojo 上报的，主线程一冻，数据就出不来。
 *
 * 而 `Debugger.pause` 走的是**另一套机制**：V8 的 **interrupt**。
 * 任何线程都能给 isolate 设一个中断标志，V8 在**循环回边（loop back-edge）与函数入口**
 * 检查它 —— 这正是 DevTools 能暂停 `while(true){}` 的原理。
 * 而且是 **browser 进程的 DevTools agent 发起**，不依赖 renderer 主线程配合。
 *
 * ## 判据（三条都要满足）
 *
 * 1. 冻结（死循环）期间发出 `Debugger.pause`，能在有限时间内收到 `Debugger.paused`；
 * 2. `Debugger.paused` 里带 **callFrames**，每个 frame 有 `functionName` + `url` + `lineNumber`；
 * 3. 栈顶 frame 就是那个死循环所在的函数（名字可核对）。
 *
 * ## 用法
 *
 *   node scripts/diag-debugger-pause.mjs --port 9226
 *   node scripts/diag-debugger-pause.mjs --port 9226 --burn-ms 20000   # 死循环跑更久
 */

const args = process.argv.slice(2);
const argOf = (name, fallback) => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : fallback;
};
const PORT = Number(argOf("--port", 9222));
const BURN_MS = Number(argOf("--burn-ms", 15_000));
const HOT_NAME = "__lifeos_probe_loop__";

/* ── 极简 CDP ── */
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

/* ── 1. browser-level + attach 到页面 ── */
const version = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
const browser = await connect(version.webSocketDebuggerUrl);

const { targetInfos } = await browser.send("Target.getTargets");
const page = targetInfos.find((target) => target.type === "page" && (String(target.url).includes("43120") || String(target.url).includes(":5173")))
  ?? targetInfos.find((target) => target.type === "page");
if (page === undefined) { console.error("没有页面 target"); process.exit(2); }
console.log(`页面 ${page.url.slice(0, 80)}`);

/*
 * flatten: true —— 让 page session 的事件直接走 browser 这条连接。
 * 用 browser-level 而不是 page-level：如果 renderer 的 agent 死掉，
 * browser 这条连接还能活着（实测冻结期间 /json/version 一直 1ms）。
 */
const { sessionId } = await browser.send("Target.attachToTarget", { targetId: page.targetId, flatten: true });

/* ── 2. Debugger.enable（必须在**冻结之前**开好） ── */
await browser.send("Runtime.enable", {}, sessionId);
await browser.send("Debugger.enable", {}, sessionId);
console.log("Debugger.enable 已开");

/* ── 3. 收集 paused 事件 ── */
let pausedEvent;
browser.on("Debugger.paused", (params) => { pausedEvent = params; });

/* ── 4. 注入一个命名清楚的死循环，跑 BURN_MS ── */
const expression = `
  window.${HOT_NAME} = function ${HOT_NAME}(deadline) {
    let acc = 0;
    while (performance.now() < deadline) { acc += Math.sqrt(acc + 1); }
    return acc;
  };
  setTimeout(() => window.${HOT_NAME}(performance.now() + ${BURN_MS}), 200);
  "scheduled";
`;
/* 这条会立刻返回（只是 setTimeout 排期） */
const scheduled = await browser.send("Runtime.evaluate", { expression, returnByValue: true }, sessionId);
console.log(`注入：${JSON.stringify(scheduled.result?.value)}`);

console.log(`等 1 秒让它进入循环…`);
await new Promise((resolve) => setTimeout(resolve, 1000));

/* ── 5. 发 Debugger.pause（关键：这条指令不返回，直到 paused 事件到达） ── */
console.log(`发 Debugger.pause …`);
const pauseStart = Date.now();
let pauseSettled = false;
browser.send("Debugger.pause", {}, sessionId)
  .then(() => { pauseSettled = true; })
  .catch((error) => { console.log(`  Debugger.pause 报错：${error.message}`); });

/* 一边等 paused，一边看 renderer 死活（用 HTTP 探活） */
for (let tick = 1; tick <= 8; tick += 1) {
  await new Promise((resolve) => setTimeout(resolve, 1000));
  const alive = await fetch(`http://127.0.0.1:${PORT}/json/version`).then((response) => response.ok).catch(() => false);
  console.log(`  ${tick}s  已收到 paused=${pausedEvent !== undefined}  pause 调用返回=${pauseSettled}  browser HTTP=${alive ? "✅" : "❌"}`);
  if (pausedEvent !== undefined) break;
}

/* ── 6. 判读 ── */
const elapsed = Date.now() - pauseStart;

if (pausedEvent === undefined) {
  console.log(`\n❌ ${elapsed}ms 内没有收到 Debugger.paused —— 这条路也不通`);
  browser.send("Debugger.resume", {}, sessionId).catch(() => undefined);
  browser.close();
  process.exit(1);
}

console.log(`\n✅ 收到 Debugger.paused（${elapsed}ms）`);
console.log(`  reason: ${pausedEvent.reason}`);
const frames = pausedEvent.callFrames ?? [];
console.log(`  callFrames 共 ${frames.length} 层`);
for (const [index, frame] of frames.slice(0, 12).entries()) {
  const name = frame.functionName === "" ? "(anonymous)" : frame.functionName;
  console.log(`  ${index}. ${name.padEnd(34)} ${frame.url}:${frame.location?.lineNumber}:${frame.location?.columnNumber}`);
}

const top = frames[0];
const topName = top?.functionName ?? "";
const hit = topName.includes("lifeos_probe_loop");
console.log(`\n结果：`);
console.log(`  栈顶函数：${topName}`);
console.log(`  是否命中注入的死循环：${hit ? "✅ 是" : "❌ 否"}`);
console.log(`  该 frame 的源码位置：${top?.url}:${top?.location?.lineNumber}:${top?.location?.columnNumber}`);

/* ── 7. 收尾：resume 让它跑完，别把测试页面永久冻住 ── */
await browser.send("Debugger.resume", {}, sessionId).catch(() => undefined);
console.log(`已 resume`);
browser.close();
process.exit(hit ? 0 : 1);
