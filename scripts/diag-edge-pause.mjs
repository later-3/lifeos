/**
 * 诊断：Edge 9223 上 attach + enable 之后的 pause 为什么会抛异常（Task 0033）。
 *
 * 现象（2026-11-24）：`attach: ok`、`enable: ok`，但 `Debugger.pause` 之后
 * 进程直接抛未处理异常退出（栈里只有 undici 的 onMessage，看不到 CDP 错误）。
 *
 * 本脚本把每一步的 CDP 原始返回都打出来（包括 error 对象全文），
 * 用来区分：是 pause 返回 error、还是 paused 事件里的 callFrames 结构异常、
 * 还是我解析 URL 时踩到 undefined。
 *
 * 用法：node scripts/diag-edge-pause.mjs --port 9223
 */

const args = process.argv.slice(2);
const argOf = (name, fallback) => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : fallback;
};
const PORT = Number(argOf("--port", 9223));

const version = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
console.log(`CDP ${PORT} · ${version.Browser}`);

const socket = new WebSocket(version.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve);
  socket.addEventListener("error", reject);
});

let nextId = 0;
const pending = new Map();
const handlers = new Map();

socket.addEventListener("message", (event) => {
  if (typeof event.data !== "string") return;
  let message;
  try { message = JSON.parse(event.data); } catch { return; }

  if (message.id != null) {
    const slot = pending.get(message.id);
    if (slot === undefined) return;
    pending.delete(message.id);
    if (message.error) slot.reject(new Error(`${slot.method}: ${message.error.message} (code ${message.error.code})`));
    else slot.resolve(message.result);
    return;
  }
  if (typeof message.method === "string") {
    const list = handlers.get(message.method);
    if (Array.isArray(list)) {
      for (const handler of list) {
        try { handler(message.params, message.sessionId); }
        catch (error) { console.log(`  ⚠️ 处理 ${message.method} 的 handler 抛错：${error.message}`); }
      }
    } else if (typeof list === "function") {
      try { list(message.params, message.sessionId); }
      catch (error) { console.log(`  ⚠️ 处理 ${message.method} 的 handler 抛错：${error.message}`); }
    }
  }
});

const call = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
  const id = ++nextId;
  pending.set(id, { resolve, reject, method });
  const message = { id, method, params };
  if (sessionId !== undefined) message.sessionId = sessionId;
  socket.send(JSON.stringify(message));
});

const targets = await call("Target.getTargets");
const page = targets.targetInfos.find((target) => target.type === "page" && String(target.url).includes("43120"));
if (page === undefined) { console.log("没有 43120 页面"); process.exit(2); }
console.log(`页面 ${page.url.slice(0, 70)}`);

const attached = await call("Target.attachToTarget", { targetId: page.targetId, flatten: true });
const sessionId = attached.sessionId;
console.log(`attach ok（session ${String(sessionId).slice(0, 12)}…）`);

try {
  const enabled = await call("Debugger.enable", {}, sessionId);
  console.log(`enable ok：` + JSON.stringify(enabled));
} catch (error) {
  console.log(`enable 失败：${error.message}`);
  process.exit(3);
}

let paused;
handlers.set("Debugger.paused", (params, sid) => {
  paused = params;
  console.log(`\n收到 Debugger.paused（session ${String(sid).slice(0, 12)}…）`);
  console.log(`  reason = ${JSON.stringify(params?.reason)}`);
  console.log(`  callFrames 类型 = ${Array.isArray(params?.callFrames) ? "array" : typeof params?.callFrames}`);
  console.log(`  callFrames 长度 = ${params?.callFrames?.length}`);
  const first = params?.callFrames?.[0];
  if (first !== undefined) {
    /* 逐字段打印，特别是 url 与 location —— 之前抛错很可能就在这里 */
    console.log(`  顶层帧 functionName = ${JSON.stringify(first.functionName)}`);
    console.log(`  顶层帧 url          = ${JSON.stringify(first.url)} (typeof ${typeof first.url})`);
    console.log(`  顶层帧 location     = ${JSON.stringify(first.location)}`);
  }
});

try {
  const pausedCall = await Promise.race([
    call("Debugger.pause", {}, sessionId).then((result) => ({ ok: true, result })),
    new Promise((resolve) => setTimeout(() => resolve({ ok: false }), 5000)),
  ]);
  console.log(`pause 调用返回：${pausedCall.ok ? "ok " + JSON.stringify(pausedCall.result) : "5s 未返回"}`);
} catch (error) {
  console.log(`pause 抛出：${error.message}`);
}

await new Promise((resolve) => setTimeout(resolve, 2000));
console.log(`\n最终 paused 事件：${paused === undefined ? "未收到" : "已收到"}`);

if (paused !== undefined) {
  try { await call("Debugger.resume", {}, sessionId); console.log("resume ok"); }
  catch (error) { console.log(`resume 失败：${error.message}`); }
}
socket.close();
