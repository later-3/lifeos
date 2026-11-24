/**
 * 关键验证：**主线程冻死期间，录制器还能不能继续收到并落盘数据**（Task 0033 · P5）。
 *
 * ## 为什么这是最关键的验证
 *
 * 整个方案的前提是：Tracing 的采样事件由**浏览器的 IO 线程**推给客户端，
 * 不依赖渲染主线程。如果这个前提不成立，那"卡死时取证"就是空话
 * （这和 `Profiler.stop` 的死法一样：数据攒在冻住的进程里，永远取不出来）。
 *
 * ## 做法
 *
 * 1. 起录制器（**子进程**，模拟真实用法），让它把事件写到文件；
 * 2. 让页面主线程**彻底冻死 10 秒**（同步 busy loop，不让出事件循环）；
 * 3. 在这 10 秒里，每隔 2 秒看一次**磁盘文件大小**；
 * 4. 断言：文件在冻结期间**持续增长**。
 *
 * 只有第 4 条成立，"下次卡死能定位"才不是空话。
 *
 * 用法：node scripts/verify-freeze-during-record.mjs --port 9226
 */

import { execFile } from "node:child_process";
import { mkdirSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

const args = process.argv.slice(2);
const argOf = (name, fallback) => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : fallback;
};
const PORT = argOf("--port", "9222");
const FREEZE_MS = Number(argOf("--freeze-ms", 10_000));
const OUT_DIR = argOf("--out", "/tmp/cdp-freeze-verify");

/* ── 找页面 ── */
const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const ours = list.filter((target) => target.type === "page" && (String(target.url).includes("43120") || String(target.url).includes(":5173")));
const page = ours[0] ?? list.find((target) => target.type === "page");
if (page === undefined) { console.error("没有页面 target"); process.exit(2); }
console.log(`目标页面 ${page.url}`);

/* ── 1. 起录制器子进程（真实用法） ── */
mkdirSync(OUT_DIR, { recursive: true });
const recorder = execFile(
  "node",
  ["scripts/cdp-freeze-recorder.mjs", "--port", String(PORT), "--out", OUT_DIR, "--rotate-mb", "64"],
  { maxBuffer: 16 * 1024 * 1024 },
);
recorder.stdout?.on("data", (chunk) => process.stdout.write(`  [rec] ${chunk}`));

await new Promise((resolve) => setTimeout(resolve, 6_000));   // 等它连上并开始写

const files = () => {
  try {
    return readdirSync(OUT_DIR).filter((name) => name.endsWith(".jsonl"));
  } catch { return []; }
};
const totalBytes = () => {
  let sum = 0;
  for (const name of files()) {
    try { sum += statSync(join(OUT_DIR, name)).size; } catch { /* 正在轮转 */ }
  }
  return sum;
};

const before = totalBytes();
console.log(`冻结前已落盘 ${(before / 1024).toFixed(0)} KB`);

/* ── 2. 让主线程彻底冻死（不 await：这条指令永远不会返回，直到冻结结束） ── */
const freezeExpression = `
  window.__lifeos_freeze_start__ = Date.now();
  (function () {
    const deadline = Date.now() + ${FREEZE_MS};
    while (Date.now() < deadline) { /* 完全不让出事件循环 */ }
    window.__lifeos_freeze_end__ = Date.now();
  })();
  "frozen-done";
`;

console.log(`让主线程冻死 ${FREEZE_MS / 1000} 秒（这条 CDP 调用要等冻结结束才返回）…`);
const freezePromise = (async () => {
  const socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve);
    socket.addEventListener("error", reject);
  });
  let id = 0;
  const call = (method, params) => new Promise((resolve, reject) => {
    const myId = ++id;
    const onMessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.id !== myId) return;
      socket.removeEventListener("message", onMessage);
      if (message.error) reject(new Error(message.error.message));
      else resolve(message.result);
    };
    socket.addEventListener("message", onMessage);
    socket.send(JSON.stringify({ id: myId, method, params }));
  });
  await call("Runtime.enable");
  const startedAt = Date.now();
  const result = await call("Runtime.evaluate", { expression: freezeExpression, returnByValue: true });
  const elapsed = Date.now() - startedAt;
  socket.close();
  return { elapsed, value: result.result?.value };
})();

/* ── 3. 冻结期间每 2 秒看一次磁盘 ── */
const samples = [];
const watchUntil = Date.now() + FREEZE_MS + 4_000;
while (Date.now() < watchUntil) {
  await new Promise((resolve) => setTimeout(resolve, 2_000));
  const bytes = totalBytes();
  samples.push({ at: Date.now(), bytes });
  console.log(`  ${((Date.now() - (watchUntil - FREEZE_MS - 4_000)) / 1000).toFixed(0)}s  磁盘 ${(bytes / 1024).toFixed(0)} KB`);
}

const frozen = await freezePromise.catch((error) => ({ error: error.message }));
console.log(`\n冻结指令返回：${JSON.stringify(frozen)}`);

/* ── 4. 停录制器 ── */
recorder.kill("SIGINT");
await new Promise((resolve) => setTimeout(resolve, 2_500));
const finalBytes = totalBytes();

/* ── 5. 断言 ── */
const grew = samples.filter((sample) => sample.bytes > before);
const stillGrowing = samples.some((sample, index) => index > 0 && sample.bytes > samples[index - 1].bytes);
const duringFreeze = samples.slice(0, Math.ceil(FREEZE_MS / 2000));

console.log(`\n结论：`);
console.log(`  冻结前 ${(before / 1024).toFixed(0)} KB → 冻结后 ${(finalBytes / 1024).toFixed(0)} KB`);
console.log(`  采样点：${samples.map((s) => (s.bytes / 1024).toFixed(0)).join(" → ")} KB`);
console.log(`  冻结期间磁盘是否增长：${duringFreeze.some((s) => s.bytes > before) ? "✅ 增长" : "❌ 未增长"}`);
console.log(`  全程是否持续增长：${stillGrowing ? "✅ 是" : "❌ 否"}`);
console.log(`  有增长的采样点：${grew.length}/${samples.length}`);
process.exit(stillGrowing ? 0 : 1);
