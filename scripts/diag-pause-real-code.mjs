/**
 * 关键验证：`Debugger.pause` 打断**真实产品代码**时，能否拿到可读的源码位置
 * （Task 0033 · P5）。
 *
 * ## 为什么这是最后一步验证
 *
 * 前一版（`diag-debugger-pause.mjs`）已经证明：死循环里 `Debugger.pause` 能在 ~1 秒内
 * 打断并拿到 callFrames。但那次注入的是**没有源文件的匿名脚本**（url 为空），
 * 只能证明"机制通"，不能证明"能定位到我们的代码"。
 *
 * 本脚本让**真实产品模块**自己跑长循环：
 *   `import('/src/md-stream.ts')` → `closeIncompleteMarkdown(巨大的病态文本)`
 * 然后 pause，看 callFrames 里是否出现 `/src/md-stream.ts` + 具体行号。
 *
 * 为什么选 dev server（5183）而不是生产产物：Vite dev 每个模块是独立文件并带内联
 * sourcemap（含 sourcesContent），位置天然可读。生产产物只有压缩后的 `index-xxx.js:97:7163`，
 * 需要 `.map` 才能翻译（本项目当前未开 `build.sourcemap`）。
 *
 * 用法：
 *   APP_URL=http://localhost:5183 node scripts/diag-pause-real-code.mjs --port 9227
 */

const args = process.argv.slice(2);
const argOf = (name, fallback) => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : fallback;
};
const PORT = Number(argOf("--port", 9227));
const APP = argOf("--app", "http://localhost:5183");
const BURN_MS = Number(argOf("--burn-ms", 12_000));

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

/* ── 1. 连 browser-level，attach 我们的页面 ── */
const version = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
const browser = await connect(version.webSocketDebuggerUrl);
const { targetInfos } = await browser.send("Target.getTargets");
const page = targetInfos.find((target) => target.type === "page" && String(target.url).startsWith(APP))
  ?? targetInfos.find((target) => target.type === "page");
if (page === undefined) { console.error("没有页面 target"); process.exit(2); }
console.log(`页面 ${page.url}`);

const { sessionId } = await browser.send("Target.attachToTarget", { targetId: page.targetId, flatten: true });
await browser.send("Runtime.enable", {}, sessionId);
await browser.send("Debugger.enable", {}, sessionId);
console.log("Debugger.enable 已开");

let pausedEvent;
browser.on("Debugger.paused", (params, sid) => {
  if (sid !== undefined && sid !== sessionId) return;
  pausedEvent = params;
});

/*
 * ── 2. 让**真实产品函数**跑长循环 ──
 *
 * `closeIncompleteMarkdown` 是纯函数，输入是文本。给它一段**病态输入**
 * （大量未闭合的反引号 + 星号），它会走 `blankPairedCode` / `delimiterCount` 等多个 while 循环，
 * 每个都是 O(n) —— 给一个足够大的 n 就能跑很久。
 *
 * 这样 pause 时栈顶就是 `/src/md-stream.ts` 里的真实函数，不是匿名脚本。
 */
const expression = `
  (async () => {
    const mod = await import('/src/md-stream.ts');
    /*
     * 让产品函数**在循环里反复跑**，直到外部叫停。
     *
     * 为什么要循环而不是单次大输入：单次调用可能几秒就跑完，pause 时主线程
     * 恰好空闲就会打到别处（第一次实测就是这么失败的：打到了 \`beat\`）。
     * 循环 + 足够大的单次输入 → 主线程 100% 时间都在 md-stream 里。
     */
    /* 反引号用 fromCharCode 拼，避免在外层模板字符串里转义地狱 */
    const tick = String.fromCharCode(96);
    const pathological = '**' + (tick + tick).repeat(20000) + '**' + '**'.repeat(20000);
    window.__lifeos_burn_stop__ = false;
    window.__lifeos_burn_iterations__ = 0;
    setTimeout(() => {
      while (window.__lifeos_burn_stop__ !== true) {
        mod.closeIncompleteMarkdown(pathological);
        window.__lifeos_burn_iterations__ += 1;
      }
    }, 100);
    return 'scheduled';
  })()
`;

const scheduled = await browser.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }, sessionId);
console.log(`注入产品函数调用：${JSON.stringify(scheduled.result?.value ?? scheduled)}`);

await new Promise((resolve) => setTimeout(resolve, 1500));   // 让它进入循环（此后主线程被占满）

/* ── 3. pause ── */
console.log("发 Debugger.pause …");
const startedPause = Date.now();
browser.send("Debugger.pause", {}, sessionId).catch((error) => console.log(`  pause 报错：${error.message}`));

for (let tick = 1; tick <= 10; tick += 1) {
  await new Promise((resolve) => setTimeout(resolve, 1000));
  if (pausedEvent !== undefined) break;
  console.log(`  ${tick}s 仍未 paused`);
}

if (pausedEvent === undefined) {
  console.log(`\n❌ ${BURN_MS}ms 内没打断 —— 这条路不成立`);
  browser.send("Debugger.resume", {}, sessionId).catch(() => undefined);
  browser.close();
  process.exit(1);
}

console.log(`\n✅ Debugger.paused（${Date.now() - startedPause}ms）reason=${pausedEvent.reason}`);
const frames = pausedEvent.callFrames ?? [];
console.log(`callFrames ${frames.length} 层：`);
for (const [index, frame] of frames.slice(0, 15).entries()) {
  const name = frame.functionName === "" ? "(anonymous)" : frame.functionName;
  const url = frame.url === "" ? "(no url)" : frame.url.replace(APP, "");
  console.log(`  ${index}. ${name.padEnd(32)} ${url}:${frame.location?.lineNumber}:${frame.location?.columnNumber}`);
}

/* ── 4. 断言：必须在**产品源码文件**里，且有行号 ── */
const productFrame = frames.find((frame) => String(frame.url).includes("/src/") && frame.location?.lineNumber >= 0);
const onStackList = frames.map((frame) => String(frame.url).replace(APP, "")).filter((url) => url.startsWith("/src/"));

console.log(`\n结果：`);
console.log(`  栈顶 ${frames.length} 层落在产品源码：${onStackList.length > 0 ? "✅ 是" : "❌ 否"}`);
if (onStackList.length > 0) console.log(`  涉及文件：${[...new Set(onStackList)].join(", ")}`);
console.log(`  第一个产品 frame：${productFrame?.functionName} @ ${String(productFrame?.url).replace(APP, "")}:${productFrame?.location?.lineNumber}:${productFrame?.location?.columnNumber}`);

await browser.send("Debugger.resume", {}, sessionId).catch(() => undefined);
/* resume 之后主线程会继续烧，所以要显式叫停（否则页面永久卡住） */
await new Promise((resolve) => setTimeout(resolve, 300));
await browser.send("Runtime.evaluate", { expression: "window.__lifeos_burn_stop__ = true; 'stopped'", returnByValue: true }, sessionId)
  .then((result) => console.log(`已 resume + 叫停：${JSON.stringify(result.result?.value)}`))
  .catch((error) => console.log(`叫停失败（主线程可能仍在烧）：${error.message}`));
browser.close();
process.exit(onStackList.length > 0 ? 0 : 1);
