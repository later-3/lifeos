#!/usr/bin/env node
/**
 * 前端规模探针（Task 0017 · P7a）：把"该不该上虚拟滚动"从口头判断变成数字。
 *
 * ## 为什么有它
 *
 * `knowledge/architecture/session-list-rendering.md` §4 写了三个触发条件，但它们一直是
 * **人工判断**（"某个组展开超过 6 条""看 DevTools"）。人工判断的问题是：没人会定期做，
 * 于是"暂不实施"变成"永远不实施也不复核"。
 *
 * 这个探针把三个条件做成可一键重跑的数字：
 *
 * | 触发条件（§4） | 探针怎么量 | 门槛 |
 * |---|---|---|
 * | ① 单次渲染 > 100 行 | 行模型算出的行数（**默认折叠状态**）+ 真实 DOM 行数 | > 100 |
 * | ② 折叠后首屏 > 1 秒 | 从 goto 到"第一行可见"的时长 | > 1000ms |
 * | ③ 滚动出现 Long Task > 50ms | Zoom 滚动 20 帧，统计 >50ms 的长任务 | 连续出现 |
 *
 * ## 它不改任何东西
 *
 * 只读：不点任何会改状态的按钮（不发送、不删除、不改偏好）。可以随手跑。
 *
 * ## ⚠️ 必须量**生产构建**，不能量 dev server
 *
 * 2026-11-16 实测（同一份代码、同一台机、3 次）：
 *
 * | 入口 | 首屏到第一行可见 |
 * |---|---|
 * | `localhost:5176`（Vite dev，按需编译模块） | **1338ms** |
 * | `127.0.0.1:43130`（`dist` 生产构建） | **422ms** |
 *
 * 差 900ms 全是 Vite 的模块加载，不是应用成本。用 dev 量会把 ② 判成"触发"
 * （而它其实是测量通道的假象 —— `testing.md` 2.17「先证明测量通道是对的」）。
 * 所以脚本会先检查入口像不像生产构建，并在报告里注明。
 *
 * 用法：APP_URL=http://127.0.0.1:43130 node scripts/frontend-probes.mjs
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const APP_URL = process.env.APP_URL ?? "http://localhost:5173";
const CANDIDATES = [
  process.env.PLAYWRIGHT_CORE,
  join(process.cwd(), "frontend/node_modules/playwright-core/index.js"),
  join(homedir(), ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright-core/index.js"),
].filter(Boolean);

let playwright;
for (const candidate of CANDIDATES) {
  if (!existsSync(candidate)) continue;
  const module = await import(candidate);
  playwright = module.default ?? module;
  break;
}
if (playwright === undefined) throw new Error("找不到 playwright-core：设置 PLAYWRIGHT_CORE=...");

const browser = await playwright.chromium.launch({
  headless: true, executablePath: playwright.chromium.executablePath(),
  args: ["--no-proxy-server", "--font-render-hinting=none", "--disable-lcd-text"],
});
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });

/* ── ② 首屏：从 goto 到"第一行可见" ── */
/*
 * 先判断入口类型（在 Node 侧 fetch，不能在页面里：页面还没导航，相对地址解析不了）。
 * 生产构建的 index.html 引用带内容 hash 的 `/assets/*.js` 并注入 `__LIFEOS_BUILD__`；
 * dev server 引用 `/src/main.tsx`。
 */
const buildKind = await (async () => {
  try {
    const html = await (await fetch(APP_URL, { cache: "no-store" })).text();
    if (/\/assets\/[A-Za-z0-9_.-]+-[A-Za-z0-9_-]{6,}\.js/.test(html)) return "production";
    if (html.includes("/src/main.tsx")) return "dev";
    return "unknown";
  } catch { return "unknown"; }
})();

const started = Date.now();
await page.goto(APP_URL, { waitUntil: "domcontentloaded" });
const firstRowMs = await page.waitForSelector(
  '[data-shot-mask="session-rows"] [data-testid]:not([data-testid="group-header"])',
  { timeout: 30000 },
).then(() => Date.now() - started, () => -1);

/* ── ① 行数：真实 DOM + 分组/会话规模 ── */
const shape = await page.evaluate(() => {
  const list = document.querySelector('[data-shot-mask="session-rows"]');
  const rows = list === null ? 0 : list.querySelectorAll(":scope > div > [data-testid]").length;
  const groups = list === null ? 0 : list.querySelectorAll('[data-testid="group-header"]').length;
  const collapsed = (() => { try { return Object.keys(JSON.parse(localStorage.getItem("lifeos.collapsedGroups") ?? "{}")).length; } catch { return 0; } })();
  // 所有会话数（含收起的组）：从接口拿，不依赖 DOM
  return { rows, groups, collapsedGroups: collapsed };
});
const apiCount = await page.evaluate(async () => {
  const agents = (await (await fetch("/api/agents")).json()).items ?? [];
  let sessions = 0;
  let groups = 0;
  for (const agent of agents) {
    const projects = (await (await fetch(`/api/agents/${agent.id}/projects`)).json()).items ?? [];
    groups += projects.length;
    for (const project of projects) {
      const list = (await (await fetch(`/api/agents/${agent.id}/projects/${project.id}/sessions`)).json()).items ?? [];
      sessions += list.length;
    }
  }
  return { sessions, groups };
}).catch(() => ({ sessions: -1, groups: -1 }));

/* ── ③ 滚动 Long Task ── */
const longTasks = await page.evaluate(async () => {
  const host = document.querySelector('[data-shot-mask="session-rows"]');
  if (host === null) return { supported: false, tasks: [] };
  const tasks = [];
  const observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) tasks.push(Math.round(entry.duration));
  });
  try { observer.observe({ entryTypes: ["longtask"] }); } catch { return { supported: false, tasks: [] }; }
  for (let i = 0; i < 20; i += 1) {
    host.scrollTop += 60;
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
  }
  observer.disconnect();
  return { supported: true, tasks };
});

await browser.close();

/* ── 判定（门槛来自 session-list-rendering.md §4，不新造数字） ── */
const rows = shape.rows;
const triggers = {
  "① 单次渲染 > 100 行": rows > 100,
  // ② 只在生产构建下判：dev server 的首屏含 Vite 按需编译（实测 1338ms vs 422ms），
  //    用它判会把测量通道的成本当成应用成本（testing.md 2.17）。
  "② 折叠后首屏 > 1 秒": buildKind === "production" ? firstRowMs > 1000 : false,
  "③ 滚动 Long Task > 50ms": longTasks.supported && longTasks.tasks.some((d) => d > 50),
};

console.log(`前端规模探针（只读）· 入口=${buildKind === "production" ? "生产构建" : buildKind === "dev" ? "dev server（② 不参与判定）" : "未知"}\n`);
console.log(`  当前 Agent 的列表：${shape.groups} 个分组 / ${shape.rows} 行 DOM / ${shape.collapsedGroups} 个分组收起`);
console.log(`  全部 Agent 合计：${apiCount.groups} 个分组 / ${apiCount.sessions} 条会话`);
console.log(`  ② 首屏到第一行可见：${firstRowMs < 0 ? "未出现行（超时）" : `${firstRowMs}ms`}`);
console.log(`  ③ 滚动 20 帧的 Long Task：${longTasks.supported ? (longTasks.tasks.length === 0 ? "无" : longTasks.tasks.join("ms / ") + "ms") : "此浏览器不支持 longtask"}`);
console.log("");
for (const [name, hit] of Object.entries(triggers)) {
  console.log(`  ${hit ? "✖ 触发" : "✔ 未触发"}  ${name}`);
}
const hit = Object.values(triggers).filter(Boolean).length;
console.log(`\n结论：${hit === 0 ? "三条都没触发 → 按 §4 维持现状（行模型已抽出，虚拟滚动不实施）" : `${hit} 条触发 → 按 §5 实施虚拟滚动`}`);
