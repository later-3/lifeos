#!/usr/bin/env node
/**
 * 卡死取证录制器：CDP Tracing 流式落盘（Task 0033 · P5）。
 *
 * ## 为什么不用 `--js-flags=--perf-basic-prof`（实测被否决）
 *
 * 2026-11-23 在本机（Chrome 157.0.8103.80 / macOS 15.5）逐条对照测过：
 *
 * | 参数 | 结果 |
 * |---|---|
 * | `--js-flags=--perf-basic-prof` | **renderer 全灭**，`Fatal error: perf_output_handle_ != nullptr` |
 * | `--js-flags=--perf-basic-prof-only-functions` | 同上 |
 * | `--js-flags=--prof` | renderer 能起，但日志文件**一个都不生成**（Chrome 拦截 V8 flag） |
 * | `--js-flags=--expose-gc`（白名单内的） | 也起不来 |
 * | `--remote-debugging-port=9222` | ✅ **8 个 renderer 正常 + CDP 正常** |
 *
 * 结论：`--js-flags` 这条路在这台机器上不可靠；CDP 可靠。
 *
 * ## 为什么用 Tracing 而不是 Profiler
 *
 * 参考实现（hermes-agent `apps/desktop/scripts/profile-typing.mjs`）用
 * `Profiler.start` → `Profiler.stop` 拿 `.cpuprofile`。那对"正常操作卡顿"够用，
 * 但**卡死场景不成立**：`Profiler.stop` 要主线程配合，主线程 11 小时不返回时它永远等不到。
 *
 * Tracing 的关键差别：**采样事件是流式推给客户端的**（`Tracing.dataCollected`），
 * 不是攒在渲染进程里。所以主线程冻死时，**我这边已经拿到冻死之前的全部样本**。
 * 这正是 `perf-basic-prof` 想做的事，只是改由外部客户端持续接收 —— 不依赖 V8 写文件。
 *
 * ## 怎么得到函数名
 *
 * Tracing 的 `disabled-by-default-v8.cpu_profiler` 分类会带 `ProfileChunk` 事件，
 * 里面有 `cpuProfile.nodes[].callFrame`（functionName / url / lineNumber / columnNumber）
 * 与 `samples`（nodeId 序列）。按 nodeId 统计样本数即可得到「哪个函数占多少 CPU」。
 *
 * ## 用法
 *
 *   node scripts/cdp-freeze-recorder.mjs                 # 自动找 9222 端口，常驻录制
 *   CDP_PORT=9222 OUT=~/.lifeos/logs/cpu node scripts/cdp-freeze-recorder.mjs
 *   node scripts/cdp-freeze-recorder.mjs --once --seconds 20   # 录 20 秒就停（自测用）
 *   node scripts/cdp-freeze-recorder.mjs --analyze <file.json>  # 分析已落盘的录制
 *
 * 只读：CDP 的 Tracing 不影响页面行为（不 attach 调试器、不暂停）。
 */

import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { printSummary, summarize } from "./cdp-trace-summary.mjs";

const args = process.argv.slice(2);
const has = (name) => args.includes(name);
const argOf = (name, fallback) => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : fallback;
};

const CDP_PORT = Number(argOf("--port", process.env.CDP_PORT ?? 9222));
const HOME = process.env.LIFEOS_HOME ?? join(homedir(), ".lifeos");
const OUT_DIR = argOf("--out", process.env.OUT ?? join(HOME, "logs", "cpu"));
const ONCE = has("--once");
const SECONDS = Number(argOf("--seconds", 20));
const ANALYZE = argOf("--analyze", undefined);

/** 记录这轮录制对应的页面 URL（用于事后确认"这是哪个会话的卡死"）。 */
function stamp() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

/* ────────────────────────── 极简 CDP 客户端（零依赖） ────────────────────────── */

/**
 * 零依赖 WebSocket CDP 客户端。
 *
 * 参考 hermes-agent `apps/desktop/scripts/profile-typing.mjs:53-90` 的实现形状
 * （Node 24 内置 `WebSocket`，`send()` 返回 Promise，`on()` 订阅事件）。
 * 不引第三方库：这是一个排查工具，装依赖的成本比它本身还高。
 */
function connectCdp(url) {
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

    socket.addEventListener("error", (event) => reject(new Error(`WebSocket 连接失败：${event.message ?? "unknown"}`)));

    socket.addEventListener("message", (event) => {
      const text = typeof event.data === "string" ? event.data : "";
      if (text === "") return;
      let message;
      try { message = JSON.parse(text); } catch { return; }
      if (message.id != null) {
        const slot = pending.get(message.id);
        if (slot === undefined) return;
        pending.delete(message.id);
        if (message.error) slot.rej(new Error(message.error.message ?? "CDP error"));
        else slot.res(message.result);
        return;
      }
      if (typeof message.method === "string") {
        for (const handler of handlers.get(message.method) ?? []) handler(message.params);
      }
    });
  });
}

/* ────────────────────────── 找到要录的页面 ────────────────────────── */

/**
 * 从 `/json/list` 里挑"我们的页面"。
 *
 * 为什么不取第一个 `type === "page"`（参考实现的做法）：用户浏览器里可能有
 * 十几个标签，取错一个就等于录错了对象。所以优先选 **指向 Life OS 的 URL**，
 * 找不到才退回第一个 http 页面，并把候选列表打出来（免得"录了个空白页还不自知"）。
 */
async function pickTarget() {
  const response = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`);
  const list = await response.json();
  const pages = list.filter((target) => target.type === "page" && typeof target.url === "string");
  const ours = pages.filter((target) => target.url.includes("/?agent=") || target.url.includes(":43120") || target.url.includes(":5173"));
  const picked = ours[0] ?? pages.find((target) => target.url.startsWith("http"));
  if (picked === undefined) {
    console.error("没有可录的页面。当前 targets：");
    for (const target of list) console.error(`  ${target.type}  ${target.url}`);
    process.exit(2);
  }
  return { picked, candidates: pages.map((target) => target.url) };
}

/* ────────────────────────── 分析：Tracing 事件 → 函数耗时排行 ────────────────────────── */

/* 分析与打印已抽到 `cdp-trace-summary.mjs`（纯函数，可被测试与验证脚本安全 import）。 */

/* ────────────────────────── 录制 ────────────────────────── */

async function record() {
  mkdirSync(OUT_DIR, { recursive: true });
  const { picked, candidates } = await pickTarget();
  console.log(`CDP 端口 ${CDP_PORT}`);
  console.log(`页面 ${picked.url}`);
  if (candidates.length > 1) {
    console.log(`（当前共 ${candidates.length} 个页面，已选第一个 Life OS 页面）`);
  }

  const cdp = await connectCdp(picked.webSocketDebuggerUrl);
  await cdp.send("Runtime.enable");
  await cdp.send("Tracing.start", {
    /*
     * 分类选择：
     *  - `toplevel`            ：主线程各类任务的大类事件（能看到"长任务"边界）
     *  - `v8.cpu_profiler`     ：**函数级样本**（我要的核心）
     *  - `disabled-by-default-v8.cpu_profiler.hires`：更细粒度（约 100µs），代价是体积更大
     * 体积实测见 log.md；先开 hires，因为卡死时我最缺的是分辨率。
     */
    categories: [
      "toplevel",
      "v8",
      "disabled-by-default-v8.cpu_profiler",
      "disabled-by-default-v8.cpu_profiler.hires",
    ].join(","),
    options: "sampling-frequency=1000",
    transferMode: "ReportEvents",
  });

  let stampText = stamp();
  let jsonlPath = join(OUT_DIR, `trace-${stampText}.jsonl`);
  let stream = createWriteStream(jsonlPath, { flags: "a" });

  /*
   * 轮转：单文件到 `ROTATE_BYTES` 就换下一个（默认 256 MB）。
   * 为什么需要：卡死可能持续几小时，只保留 ProfileChunk 也是 ~0.2 MB/s → 3 小时 2 GB。
   * 轮转保证"磁盘不会被写满"，同时**最近的文件总是最新的**（取证时看最后那个）。
   */
  const ROTATE_BYTES = Number(argOf("--rotate-mb", 256)) * 1024 * 1024;
  let written = 0;
  const rotateIfNeeded = () => {
    if (written < ROTATE_BYTES) return;
    stream.end();
    stampText = stamp();
    jsonlPath = join(OUT_DIR, `trace-${stampText}.jsonl`);
    stream = createWriteStream(jsonlPath, { flags: "a" });
    written = 0;
    console.log(`  轮转 → ${jsonlPath}`);
  };

  let eventCount = 0;
  let floatCount = 0;
  const collected = [];   // 内存里也留一份（自测要立即分析；长时间跑可关）

  cdp.on("Tracing.dataCollected", (params) => {
    const events = params?.value ?? [];
    eventCount += events.length;
    /*
     * **只落盘 ProfileChunk / Profile**（实测：20 秒 46 MB 里它们只占 4.3 MB，2.2% 的事件）。
     * 其余 98% 是线程调度噪音（ThreadControllerImpl::RunTask、cc::TaskGraphWorkQueue…），
     * 对"哪个 JS 函数在烧 CPU"这个问题零信息量。
     *
     * 保留 toplevel 记录事件（--keep-toplevel）供以后看长任务边界，默认关。
     */
    const keepToplevel = has("--keep-toplevel");
    const wanted = keepToplevel ? events : events.filter((event) => event.name === "ProfileChunk" || event.name === "Profile");
    if (has("--keep")) collected.push(...wanted);
    /*
     * **每条事件立刻落盘**（JSON Lines）：
     * 这是整个方案的核心 —— 主线程冻死时，进程里攒的东西一个都拿不出来，
     * 已经写到磁盘的才是证据。
     */
    for (const event of wanted) {
      const line = `${JSON.stringify(event)}\n`;
      written += line.length;
      stream.write(line);
    }
    rotateIfNeeded();
  });

  let flopped = false;
  cdp.on("Tracing.tracingComplete", () => { flopped = true; });
  cdp.on("Tracing.bufferUsage", (params) => { floatCount = params?.percentFull ?? 0; });

  const startedAt = Date.now();
  console.log(`录制中 → ${jsonlPath}`);
  console.log("（要取证时让它一直跑；Ctrl-C 结束并输出排行）");

  if (ONCE) {
    await new Promise((resolve) => setTimeout(resolve, Math.max(1000, SECONDS * 1000)));
    console.log(`\n--once：${SECONDS} 秒到，停止`);
    await cdp.send("Tracing.end").catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 1500));   // 等 tracingComplete
    stream.end();
    console.log(`落盘 ${eventCount} 条事件（${(eventCount / 1000).toFixed(0)}k），缓冲占用 ${floatCount}%`);
    if (has("--keep")) {
      printSummary(summarize(collected));
    }
    cdp.close();
    return;
  }

  /* 常驻模式：定期把进度打出来（也顺便证明它还活着） */
  const timer = setInterval(() => {
    const minutes = ((Date.now() - startedAt) / 60000).toFixed(1);
    process.stdout.write(`  ${minutes} 分钟 · 已落盘 ${(eventCount / 1000).toFixed(0)}k 条事件 · 缓冲 ${floatCount}%\n`);
  }, 60_000);

  const shutdown = async () => {
    clearInterval(timer);
    console.log("\n停止录制…");
    await cdp.send("Tracing.end").catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 2000));
    stream.end();
    console.log(`已落盘：${jsonlPath}（${eventCount} 条事件）`);
    console.log(`分析：node scripts/cdp-freeze-recorder.mjs --analyze ${jsonlPath}`);
    cdp.close();
    process.exit(0);
  };
  process.on("SIGINT", () => { void shutdown(); });
  process.on("SIGTERM", () => { void shutdown(); });

  await new Promise((resolve) => process.on("exit", resolve));
}

/* ────────────────────────── 分析已落盘的文件 ────────────────────────── */

function analyze(path) {
  if (!existsSync(path)) { console.error(`文件不存在：${path}`); process.exit(1); }
  console.log(`分析 ${path}（${(readFileSync(path).length / 1024 / 1024).toFixed(1)} MB）`);
  const events = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (line.trim() === "") continue;
    try { events.push(JSON.parse(line)); } catch { /* 末行可能被截断（进程被杀）—— 跳过，不影响前面的样本 */ }
  }
  const summary = summarize(events);
  printSummary(summary);

  /* 顺手把 top 20 写成一个可拖进 DevTools 的精简报告，便于人工看 */
  const outPath = path.replace(/\.jsonl$/, ".summary.json");
  writeFileSync(outPath, JSON.stringify({
    totalSamples: summary.totalSamples,
    top: summary.rows.slice(0, 200),
  }, null, 1));
  console.log(`\n前 200 名已写入 ${outPath}`);
}

if (ANALYZE !== undefined) analyze(ANALYZE);
else await record();
