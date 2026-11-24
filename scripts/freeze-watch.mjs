#!/usr/bin/env node
/**
 * 机外采样（Task 0033 · P4）：从**进程外部**看"渲染进程满核"。
 *
 * ## 为什么浏览器内的观测不够
 *
 * 2026-11-21/22/23 的现场（`evidence/freeze-1122`、`freeze-1123`）：
 * 卡死的 renderer 主线程 100% 卡在 V8 JIT 里，**且没有任何网络连接**。
 * 这种情况下游览器内的 Worker 也可能一起被拖住（同进程），而且进程被 OOM 杀掉时
 * 什么都来不及写。只有外部采样能在那一刻留下证据。
 *
 * ## 采什么、阈值从哪来
 *
 * | 采样 | 间隔 | 依据 |
 * |---|---|---|
 * | 各家浏览器/node 的 CPU + RSS | 5s | 一次 ps ≈ 10ms，5s 内开销可忽略；满核事故能留下 ≥96 个点/8 分钟 |
 * | swap 与内存压力 | 5s | 2026-11-21 实测 swap 21.3G/22.5G（近满），这是"整机卡"的直接指标 |
 * | 超阈值时 `sample` 抓栈 | 触发一次 | CPU ≥80% 连续 2 次（=10s）才抓，排除构建/首次解析的瞬时抖动 |
 *
 * ## 输出
 *
 * `~/.lifeos/logs/freeze-<日期>.jsonl`，每行一个采样点（`{ts, kind, ...}`）。
 * 与后端日志同一时间轴，便于对齐"界面卡住的那一刻"与"进程在干什么"。
 *
 * ## 用法
 *
 *   node scripts/freeze-watch.mjs                 # 常驻（Ctrl-C 退出）
 *   node scripts/freeze-watch.mjs --once          # 采一次就退（自测/排查用）
 *   node scripts/freeze-watch.mjs --self-test     # 不采样，只校验解析逻辑
 */

import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

const SAMPLE_MS = 5_000;
const CPU_THRESHOLD = 80;
const CPU_STRIKES = 2;
const WATCHED = ["Google Chrome", "Microsoft Edge", "node"];

const args = new Set(process.argv.slice(2));
const once = args.has("--once");
const selfTest = args.has("--self-test");

function logsDir() {
  const home = process.env.LIFEOS_HOME ?? join(homedir(), ".lifeos");
  return join(home, "logs");
}

function localDate(now = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function write(record) {
  const dir = logsDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  appendFileSync(join(dir, `freeze-${localDate()}.jsonl`), `${JSON.stringify(record)}\n`);
}

/** 解析 `ps` 的一行；抽成纯函数以便自测。 */
export function parsePsLine(line) {
  const match = /^\s*(\d+)\s+([\d.]+)\s+(\d+)\s+(.+)$/.exec(line);
  if (match === null) return undefined;
  return {
    pid: Number(match[1]),
    cpu: Number(match[2]),
    rssMb: Math.round(Number(match[3]) / 1024),
    command: (match[4] ?? "").slice(0, 160),
  };
}

async function psSnapshot() {
  const { stdout } = await run("ps", ["-eo", "pid,pcpu,rss,command"], { maxBuffer: 8 * 1024 * 1024 });
  const out = [];
  for (const line of stdout.split("\n")) {
    if (!WATCHED.some((name) => line.includes(name))) continue;
    const parsed = parsePsLine(line);
    if (parsed !== undefined && parsed.cpu > 0.5) out.push(parsed);
  }
  return out.sort((a, b) => b.cpu - a.cpu).slice(0, 12);
}

async function swapUsage() {
  const { stdout } = await run("sysctl", ["-n", "vm.swapusage"]).catch(() => ({ stdout: "" }));
  const used = /used = ([\d.]+)M/.exec(stdout)?.[1];
  const total = /total = ([\d.]+)M/.exec(stdout)?.[1];
  if (used === undefined || total === undefined) return undefined;
  return { usedMb: Math.round(Number(used)), totalMb: Math.round(Number(total)) };
}

async function sampleStack(pid) {
  const file = join(logsDir(), `stack-${pid}-${Date.now()}.txt`);
  await run("sample", [String(pid), "3", "-file", file], { maxBuffer: 4 * 1024 * 1024 }).catch(() => undefined);
  return file;
}

/** 连续满核的里程计（pid → 连续命中次数）；纯逻辑，自测覆盖。 */
export function nextStrikes(previous, processes) {
  const next = new Map();
  const toSample = [];
  for (const proc of processes) {
    const hits = proc.cpu >= CPU_THRESHOLD ? (previous.get(proc.pid) ?? 0) + 1 : 0;
    next.set(proc.pid, hits);
    if (hits === CPU_STRIKES) toSample.push(proc);
  }
  return { next, toSample };
}

if (selfTest) {
  const parsed = parsePsLine("  63349 101.7  165424 /Applications/Google Chrome.app/…");
  const okParse = parsed?.pid === 63349 && parsed.cpu === 101.7 && parsed.rssMb === 162;
  const { next, toSample } = nextStrikes(new Map([[1, 1]]), [
    { pid: 1, cpu: 99, command: "chromium" },
    { pid: 2, cpu: 30, command: "node" },
  ]);
  const okStrikes = toSample.length === 1 && toSample[0].pid === 1 && next.get(2) === 0;
  console.log(`parsePsLine: ${okParse ? "ok" : "FAIL"}`);
  console.log(`nextStrikes: ${okStrikes ? "ok" : "FAIL"}`);
  process.exit(okParse && okStrikes ? 0 : 1);
}

let strikes = new Map();
let timer;

async function tick() {
  try {
    const processes = await psSnapshot();
    const swap = await swapUsage();
    const { next, toSample } = nextStrikes(strikes, processes);
    strikes = next;

    const stacks = [];
    for (const proc of toSample) stacks.push({ pid: proc.pid, file: await sampleStack(proc.pid) });

    write({
      ts: new Date().toISOString(),
      kind: "sample",
      ...(swap !== undefined ? { swap } : {}),
      top: processes,
      ...(stacks.length > 0 ? { stacks } : {}),
    });
    const hot = processes[0];
    process.stdout.write(`${new Date().toLocaleTimeString()} 进程 ${processes.length} 个`
      + `${hot === undefined ? "" : ` · 最高 CPU ${hot.cpu}%（pid ${hot.pid}）`}`
      + `${swap === undefined ? "" : ` · swap ${swap.usedMb}/${swap.totalMb} MB`}`
      + `${stacks.length > 0 ? ` · 已抓栈 ${stacks.map((s) => s.pid).join(",")}` : ""}\n`);
  } catch (error) {
    write({ ts: new Date().toISOString(), kind: "error", message: String(error).slice(0, 300) });
  }
}

async function main() {
  await tick();
  if (once) return;
  timer = setInterval(() => { void tick(); }, SAMPLE_MS);
  process.stdout.write(`机外采样中（每 ${SAMPLE_MS / 1000}s），输出 ${join(logsDir(), `freeze-${localDate()}.jsonl`)}\nCtrl-C 退出\n`);
}

process.on("SIGINT", () => { if (timer !== undefined) clearInterval(timer); process.stdout.write("\n已停止\n"); process.exit(0); });

await main();
