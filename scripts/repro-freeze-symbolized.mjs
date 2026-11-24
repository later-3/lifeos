/**
 * 复现 + 符号化尝试（Task 0033 · 现场 92407 的追击）。
 *
 * ## 为什么有这个脚本
 *
 * 92407 已经满核跑了 11 小时，热点稳定在 V8 JIT 区的同一段 7912 字节里，
 * 但 `sample` 拿不到函数名（JIT 无符号）、`lldb` 被 SIP 拒。
 *
 * **唯一还能拿函数名的办法**：让浏览器在启动时带 `--js-flags=--perf-basic-prof`，
 * V8 会把「JIT 代码地址 → 函数名」写进 `/tmp/perf-<pid>.map`。
 * 本脚本用**真实 Chrome**（不是 Playwright 自带的 Chromium）打开同一个会话，
 * 带上这个参数，然后用同一份采样逻辑看能否复现 + 读映射表。
 *
 * ## 怎么判断复现成功
 *
 * 不是"页面看起来卡"（主观），而是三条客观判据：
 *   1. 主线程连续 >3s 不响应 `page.evaluate`（超时）；
 *   2. 进程 CPU ≥90%；
 *   3. `/tmp/perf-<pid>.map` 存在且能让采样地址落进某个函数。
 *
 * 用法：
 *   node scripts/repro-freeze-symbolized.mjs
 *   AGENT=architect SESSION=01a20470-21ed-7783-b2df-af92e8f4758a node scripts/...
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { execFile } from "node:child_process";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

const PW = join(homedir(), ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright-core/index.js");
const mod = await import(PW);
const playwright = mod.default ?? mod;

const APP_URL = process.env.APP_URL ?? "http://127.0.0.1:43120";
const AGENT = process.env.AGENT ?? "architect";
const SESSION = process.env.SESSION ?? "01a20470-21ed-7783-b2df-af92e8f4758a";
const PROJECT = process.env.PROJECT ?? "lifeos";
const WATCH_MS = Number(process.env.WATCH_MS ?? 45_000);

const url = `${APP_URL}/?agent=${AGENT}&project=${PROJECT}&session=${SESSION}`;

/*
 * `--js-flags="--perf-basic-prof"` 是这里唯一的"魔法"，理由：
 * V8 默认不导出 JIT 符号；开了它就写 /tmp/perf-<pid>.map（每行 `start size name`）。
 * 这不是调试器附加，所以不受 SIP 限制 —— 是被观测进程**自己**自愿写出来的。
 */
const browser = await playwright.chromium.launch({
  channel: "chrome",
  headless: false,
  args: [
    "--js-flags=--perf-basic-prof",
    "--window-size=1500,950",
    "--no-first-run",
    "--no-default-browser-check",
  ],
});

const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
console.log("打开:", url);
await page.goto(url, { waitUntil: "domcontentloaded", timeout: 120_000 }).catch((error) => console.log("goto:", error.message));

/* 找到这个浏览器进程树里的 renderer，并持续采样 CPU */
async function rendererPids() {
  const { stdout } = await run("ps", ["-eo", "pid,pcpu,rss,command"], { maxBuffer: 16 * 1024 * 1024 });
  const rows = [];
  for (const line of stdout.split("\n")) {
    if (!line.includes("--type=renderer")) continue;
    if (!line.includes("remote-debugging-pipe")) continue;   // Playwright 起的实例才有这个参数
    const m = /^\s*(\d+)\s+([\d.]+)\s+(\d+)\s+(.*)$/.exec(line);
    if (m === null) continue;
    rows.push({ pid: Number(m[1]), cpu: Number(m[2]), rssMb: Math.round(Number(m[3]) / 1024) });
  }
  return rows.sort((a, b) => b.cpu - a.cpu);
}

console.log(`观察 ${WATCH_MS / 1000}s，每 5s 采一次 CPU，同时检测主线程是否冻结`);
const startedAt = Date.now();
let frozen = false;
let worst = { pid: 0, cpu: 0 };

while (Date.now() - startedAt < WATCH_MS) {
  await new Promise((resolve) => setTimeout(resolve, 5_000));
  const rows = await rendererPids();
  const top = rows[0];
  if (top !== undefined && top.cpu > worst.cpu) worst = { pid: top.pid, cpu: top.cpu };

  /* 冻结检测：给主线程派一个 1+1 的任务，2 秒不回就是冻住 */
  let responsive = true;
  try {
    await Promise.race([
      page.evaluate(() => 1 + 1),
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 2_000)),
    ]);
  } catch {
    responsive = false;
  }

  const elapsed = Math.round((Date.now() - startedAt) / 1000);
  console.log(`  ${elapsed}s  renderer ${rows.length} 个` +
    `${top === undefined ? "" : ` · 最高 CPU ${top.cpu}%（pid ${top.pid}, ${top.rssMb}MB）`}` +
    `${responsive ? "" : "  ← 主线程无响应"}`);
  if (!responsive) { frozen = true; break; }
}

/* 无论是否复现，都把已有的 perf map 读出来（有的话） */
const mapFiles = readdirSync(tmpdir()).filter((name) => /^perf-\d+\.map$/.test(name));
console.log(`\n找到 ${mapFiles.length} 个 perf map：${mapFiles.join(", ") || "（无）"}`);

let symbols = 0;
for (const name of mapFiles) {
  const path = join(tmpdir(), name);
  const lines = readFileSync(path, "utf8").split("\n").filter((line) => line.length > 0);
  symbols += lines.length;
  console.log(`  ${name}: ${lines.length} 行`);
  // 打印最前面几行，确认格式是 "start size name"
  for (const line of lines.slice(0, 3)) console.log("     ", line.slice(0, 120));
}

await browser.close();

console.log(`\n结果：`);
console.log(`  是否复现冻结：${frozen ? "✅ 是" : "❌ 否（这段会话在干净的浏览器里没有立刻复现）"}`);
console.log(`  最高 renderer CPU：${worst.cpu}%（pid ${worst.pid}）`);
console.log(`  V8 符号总数：${symbols}`);
if (frozen && symbols > 0) {
  console.log(`\n下一步：对那个 renderer 跑 sample，把采样地址按 perf map 翻译成函数名。`);
}
process.exit(0);
