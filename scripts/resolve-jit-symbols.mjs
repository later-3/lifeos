#!/usr/bin/env node
/**
 * 把 `sample` 的采样地址翻译成 **JS 函数名 + 源码行号**（Task 0033）。
 *
 * ## 用途
 *
 * 卡死现场的栈全是 `<unknown binary>`（V8 JIT 代码没有系统符号）。
 * 但如果 Chrome 启动时带了 `--js-flags=--perf-basic-prof`，V8 会把
 * 「JIT 地址 → 函数名 + 文件:行:列」写进 `/tmp/perf-<pid>.map`。
 *
 * 本脚本做三件事：
 *   1. 找 perf map（`/tmp/perf-*.map`，**注意不是 os.tmpdir()** —— 实测过这个坑）；
 *   2. 对每个 renderer 跑 `sample`，收集所有 JIT 地址与样本数；
 *   3. 按 map 把地址翻译成函数名，按样本权重排序输出。
 *
 * ## 用法
 *
 *   node scripts/resolve-jit-symbols.mjs                 # 自动找最高 CPU 的 renderer
 *   node scripts/resolve-jit-symbols.mjs --pid 92407     # 指定进程
 *   node scripts/resolve-jit-symbols.mjs --sample /path/to/sample.txt   # 用已有采样
 *
 * 只读：不 attach、不改任何东西（sample 是采样，不是调试器）。
 */

import { execFile } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

const args = process.argv.slice(2);
const argOf = (name) => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : undefined;
};

/** perf map 固定在 `/tmp`（V8 写的是 `/tmp`，而 Node 的 `os.tmpdir()` 是别的目录）。 */
const PERF_DIR = "/tmp";

function perfMaps() {
  return readdirSync(PERF_DIR)
    .filter((name) => /^perf-\d+\.map$/.test(name))
    .map((name) => {
      const path = join(PERF_DIR, name);
      return { path, pid: Number(name.slice(5, -4)), mtime: statSync(path).mtimeMs };
    })
    .sort((a, b) => b.mtime - a.mtime);
}

/** perf map 一行：`<start-hex> <size-hex> <name>`（name 里可能带空格，取剩余部分）。 */
function loadSymbols(path) {
  const entries = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (line.length === 0) continue;
    const parts = line.split(" ");
    if (parts.length < 3) continue;
    const start = Number.parseInt(parts[0], 16);
    const size = Number.parseInt(parts[1], 16);
    if (!Number.isFinite(start) || !Number.isFinite(size)) continue;
    entries.push({ start, end: start + size, name: parts.slice(2).join(" ") });
  }
  entries.sort((a, b) => a.start - b.start);
  return entries;
}

/** 二分查找地址落在哪个符号里。 */
function lookup(entries, address) {
  let lo = 0;
  let hi = entries.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const entry = entries[mid];
    if (address < entry.start) hi = mid - 1;
    else if (address >= entry.end) lo = mid + 1;
    else return entry;
  }
  return undefined;
}

/** 从 sample 输出里抽「地址 → 样本数」。只取 unknown binary 的帧（JIT）。 */
function parseSample(text) {
  const counts = new Map();
  for (const line of text.split("\n")) {
    if (!line.includes("<unknown binary>")) continue;
    const m = /^\s*[+!:| ]*(\d+) \?\?\?.*\[(0x[0-9a-f]+)\]/.exec(line);
    if (m === null) continue;
    const count = Number(m[1]);
    const address = Number.parseInt(m[2], 16);
    counts.set(address, (counts.get(address) ?? 0) + count);
  }
  return counts;
}

async function topRendererPid() {
  const { stdout } = await run("ps", ["-eo", "pid,pcpu,command"], { maxBuffer: 16 * 1024 * 1024 });
  let best;
  for (const line of stdout.split("\n")) {
    if (!line.includes("--type=renderer")) continue;
    const m = /^\s*(\d+)\s+([\d.]+)\s/.exec(line);
    if (m === null) continue;
    const cpu = Number(m[2]);
    if (best === undefined || cpu > best.cpu) best = { pid: Number(m[1]), cpu };
  }
  return best;
}

async function main() {
  const maps = perfMaps();
  if (maps.length === 0) {
    console.error("找不到 /tmp/perf-*.map —— Chrome 启动时没带 --js-flags=--perf-basic-prof，或那个进程已退出");
    process.exit(1);
  }
  console.log(`找到 ${maps.length} 个 perf map：`);
  for (const map of maps.slice(0, 5)) {
    const alive = (() => { try { process.kill(map.pid, 0); return true; } catch { return false; } })();
    console.log(`  ${map.path}  (${Math.round(statSync(map.path).size / 1024)} KB)  pid ${map.pid} ${alive ? "活着" : "已退出"}`);
  }

  /* 选目标：显式 --pid > 采样文件 > 最高 CPU 的 renderer > 最新的 map */
  const explicitPid = argOf("--pid");
  const sampleFile = argOf("--sample");
  let text;
  let pid;

  if (sampleFile !== undefined) {
    if (!existsSync(sampleFile)) { console.error(`采样文件不存在：${sampleFile}`); process.exit(1); }
    text = readFileSync(sampleFile, "utf8");
    // 从采样文件头 "Analysis of sampling ... (pid 12345)" 里取 pid
    pid = Number(/\(pid (\d+)\)/.exec(text)?.[1] ?? Number.NaN);
    console.log(`\n用已有采样：${sampleFile}（pid ${pid}）`);
  } else {
    pid = explicitPid !== undefined ? Number(explicitPid) : (await topRendererPid())?.pid;
    if (pid === undefined || Number.isNaN(pid)) { console.error("找不到 renderer 进程"); process.exit(1); }
    const tmp = `/tmp/sample-${pid}-${Date.now()}.txt`;
    console.log(`\n采样 pid ${pid}（4 秒）…`);
    await run("sample", [String(pid), "4", "-file", tmp], { maxBuffer: 32 * 1024 * 1024 }).catch((error) => {
      console.error(`sample 失败：${error.message}`);
      process.exit(1);
    });
    text = readFileSync(tmp, "utf8");
  }

  /*
   * **pid 必须精确对上，不许 fallback 到别的 map**。
   * 实测教训：第一次写的时候用了 `?? maps[0]`，于是拿着 41856 的符号表去解析 92407 的地址，
   * 输出"可解析 0 / 未解析 16805"，看起来像"符号机制不работает"，实际只是 pid 不对。
   * perf map 里是**绝对地址**（JIT 区基址随进程变），跨进程永远翻译不出来。
   */
  const map = maps.find((candidate) => candidate.pid === pid);
  if (map === undefined) {
    console.error(`\n没有 pid ${pid} 的符号表（现有：${maps.map((m) => m.pid).join(", ")}）`);
    console.error("这个进程启动时没带 --js-flags=--perf-basic-prof，翻译不了。");
    console.error("→ 用它重启浏览器后再复现：");
    console.error('   "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --js-flags="--perf-basic-prof"');
    process.exit(2);
  }
  console.log(`符号表：${map.path}`);
  const symbols = loadSymbols(map.path);
  console.log(`符号条目：${symbols.length}`);

  const counts = parseSample(text);
  if (counts.size === 0) {
    console.log("\n这份采样里没有 JIT 帧（可能它没在跑 JS，或采样时机不对）");
    return;
  }

  const rows = [];
  let unresolved = 0;
  let unresolvedSamples = 0;
  for (const [address, count] of counts) {
    const hit = lookup(symbols, address);
    if (hit === undefined) { unresolved += 1; unresolvedSamples += count; continue; }
    rows.push({ count, address, name: hit.name });
  }
  rows.sort((a, b) => b.count - a.count);

  const total = [...counts.values()].reduce((sum, n) => sum + n, 0);
  const sampleLow = Math.min(...counts.keys());
  const sampleHigh = Math.max(...counts.keys());
  const mapLow = symbols[0]?.start ?? 0;
  const mapHigh = symbols[symbols.length - 1]?.end ?? 0;
  console.log(`\n地址范围对照：`);
  console.log(`  采样 JIT：${sampleLow.toString(16)} .. ${sampleHigh.toString(16)}`);
  console.log(`  符号表  ：${mapLow.toString(16)} .. ${mapHigh.toString(16)}`);
  console.log(`\nJIT 样本总数 ${total}；可解析 ${total - unresolvedSamples}，未解析 ${unresolvedSamples}（${unresolved} 个地址）`);
  console.log("\n按样本权重排序（这就是「它在哪个函数里烧 CPU」）：");
  for (const row of rows.slice(0, 25)) {
    const pct = ((row.count / total) * 100).toFixed(1);
    console.log(`  ${String(row.count).padStart(6)}  ${pct.padStart(5)}%  ${row.name}`);
  }
  if (rows.length === 0) {
    console.log("  （全部未解析：perf map 可能是另一次运行留下的，pid 对不上）");
  }
}

await main();
