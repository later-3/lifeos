/**
 * 诊断：`Debugger.enable` 在冻结页面上的耗时到底是多少（Task 0033 · P5）。
 *
 * ## 为什么要单独测
 *
 * 已经出现过两种结果：
 *  - `diag-pause-after-freeze.mjs`：冻结 20 秒，`Debugger.enable` **成功**，pause 6 秒到；
 *  - `cdp-freeze-catch.mjs` 端到端：冻结 15 秒（刚冻 3 秒就去），`Debugger.enable` **12 秒超时**。
 *
 * 这两种结果必须解释清楚，否则工具在真实事故里会不稳定。
 *
 * ## 本脚本分离三个变量
 *
 * 1. **冻结里有没有分配内存**（`while` 空转 vs 每圈新建字符串）—— GC 压力可能拖慢 DevTools 命令的可见性；
 * 2. **attach 之前是否有过 DevTools 连接**（先前连过再断开 vs 从未连过）；
 * 3. **冻结已进行多久**（刚冻 1 秒 vs 冻了 10 秒）。
 *
 * 每组都量 `attach` 与 `enable` 的耗时，并带超时保护。
 *
 * 用法：node scripts/diag-enable-timing.mjs --port 9228
 */

const args = process.argv.slice(2);
const argOf = (name, fallback) => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : fallback;
};
const PORT = Number(argOf("--port", 9228));
const APP = argOf("--app", "http://localhost:5183");

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
    socket.addEventListener("error", reject);
    socket.addEventListener("message", (event) => {
      if (typeof event.data !== "string") return;
      const message = JSON.parse(event.data);
      if (message.id != null) {
        const slot = pending.get(message.id);
        if (slot === undefined) return;
        const method = methods.get(message.id) ?? "?";
        pending.delete(message.id);
        if (message.error) slot.rej(new Error(`${method}: ${message.error.message}`));
        else slot.res(message.result);
        return;
      }
      if (typeof message.method === "string") for (const handler of handlers.get(message.method) ?? []) handler(message.params, message.sessionId);
    });
  });
}

async function timed(label, promise, timeoutMs) {
  const start = Date.now();
  const result = await Promise.race([
    promise.then(() => ({ ok: true })).catch((error) => ({ ok: false, error: error.message })),
    new Promise((resolve) => setTimeout(() => resolve({ ok: false, error: `超时 ${timeoutMs}ms` }), timeoutMs)),
  ]);
  const ms = Date.now() - start;
  console.log(`    ${result.ok ? "✅" : "❌"} ${label}  ${ms}ms${result.ok ? "" : `（${result.error}）`}`);
  return { ok: result.ok, ms };
}

const version = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();

/* 用一个**独立**连接注入冻结，注入后断开（模拟"事故发生前没有 DevTools 连接"） */
async function freeze(mode, ms) {
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const page = list.find((target) => target.type === "page" && String(target.url).startsWith(APP));
  const ws = await connect(page.webSocketDebuggerUrl);
  await ws.send("Runtime.enable");
  /*
   * mode=alloc：每圈都新建大字符串（GC 压力）
   * mode=spin ：纯算术，零分配
   */
  const body = mode === "alloc"
    ? `const tick = String.fromCharCode(96);
       while (Date.now() < deadline) { (tick + tick).repeat(30000).length; }`
    : `let acc = 0; while (Date.now() < deadline) { acc += Math.sqrt(acc + 1); }`;
  await ws.send("Runtime.evaluate", {
    expression: `setTimeout(function(){ const deadline = Date.now() + ${ms}; ${body} }, 60); "scheduled"`,
    returnByValue: true,
  });
  ws.close();
}

async function probe(label) {
  console.log(`  ${label}`);
  const browser = await connect(version.webSocketDebuggerUrl);
  const targets = await browser.send("Target.getTargets");
  const page = targets.targetInfos.find((target) => target.type === "page" && String(target.url).startsWith(APP));
  if (page === undefined) { console.log("    没有页面"); browser.close(); return; }
  const attached = await timed("attach", browser.send("Target.attachToTarget", { targetId: page.targetId, flatten: true }), 10_000);
  if (!attached.ok) { browser.close(); return; }
  /* 需要 sessionId：重新 attach 拿一次（上面那次已经建立，session 是幂等的，用新返回值） */
  const again = await browser.send("Target.attachToTarget", { targetId: page.targetId, flatten: true }).catch(() => undefined);
  const sessionId = again?.sessionId;
  if (sessionId === undefined) { console.log("    拿不到 sessionId"); browser.close(); return; }
  await timed("Debugger.enable", browser.send("Debugger.enable", {}, sessionId), 30_000);
  browser.close();
}

/* ── 组合实验 ── */
console.log("实验 1：零分配死循环，刚冻 1 秒就去 attach（最接近真实：用户刚卡住我就连）");
await freeze("spin", 30_000);
await new Promise((resolve) => setTimeout(resolve, 1000));
await probe("spin + 1s");
await new Promise((resolve) => setTimeout(resolve, 32_000));   // 等它跑完，别污染下一组

console.log("\n实验 2：零分配死循环，冻了 8 秒才 attach");
await freeze("spin", 30_000);
await new Promise((resolve) => setTimeout(resolve, 8000));
await probe("spin + 8s");
await new Promise((resolve) => setTimeout(resolve, 24_000));

console.log("\n实验 3：**有 GC 压力**的死循环（每圈新建字符串），刚冻 1 秒就 attach");
await freeze("alloc", 30_000);
await new Promise((resolve) => setTimeout(resolve, 1000));
await probe("alloc + 1s");
await new Promise((resolve) => setTimeout(resolve, 32_000));

console.log("\n实验完了");
