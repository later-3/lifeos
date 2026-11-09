#!/usr/bin/env node
/**
 * 视觉矩阵（T2）：把"截图基线"从 6 张零散图升级成 **矩阵 + 固定夹具 + 人眼对比报告**。
 *
 * 为什么重写（2026-11-09 两次假红都是它）：
 *  ① 旧基线用**真实家目录**渲染 —— 用户新建一个助手、改一个名字，基线就红，
 *     而那不是回归（本轮已经踩过两次：身份断言、folded 空白页）；
 *  ② 基线**不入 Git**（`.gitignore` 里）→ 换机器/换人首次跑等于没测；
 *  ③ 只有 6 张、只覆盖 4 个视口，**缺"深浅色 × 页面"的组合** —— 深色浮层糊成一片这种缺陷
 *     在矩阵里一眼可见，在零散图里永远发现不了。
 *
 * 这一版做三件事：
 *  1. **固定夹具**：所有页面都用 route mock 提供固定的 agents / sessions / 消息，
 *     不读真实家目录（用户数据换成任何东西都不影响基线）；
 *  2. **矩阵**：5 个页面 × 深浅色 2 × 视口 2（1280 / 1920）= 20 张；
 *  3. **人眼报告**：差异时输出一页 HTML（左右并排 + 差异框），比"差异像素 0.02%"可读得多。
 *
 * 用法：
 *   APP_URL=http://127.0.0.1:5192 node scripts/visual-matrix.mjs            # 比对
 *   APP_URL=... node scripts/visual-matrix.mjs --update                     # 更新基线（必须人眼看报告后）
 *   APP_URL=... node scripts/visual-matrix.mjs --report /tmp/report.html    # 指定报告路径
 *
 * 基线目录：`frontend/test/visual-matrix/`（**建议入 Git**，与零散基线不同）。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const APP_URL = process.env.APP_URL ?? "http://localhost:5173";
const BASELINE = join(ROOT, "frontend/test/visual-matrix");
const SHOTS = join(ROOT, ".visual-matrix-shots");
const UPDATE = process.argv.includes("--update");
const REPORT = (() => {
  const index = process.argv.indexOf("--report");
  return index >= 0 ? process.argv[index + 1] : join(SHOTS, "report.html");
})();

const CANDIDATES = [
  process.env.PLAYWRIGHT_CORE,
  join(ROOT, "frontend/node_modules/playwright-core/index.js"),
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

const { pixelDiff } = await import(join(ROOT, "frontend/test/png.mjs"));

/* ── 固定夹具（不读真实家目录） ─────────────────────────────────────────── */

const AGENT = { schemaVersion: 1, id: "fixture-agent", name: "Fixture Agent", description: "视觉矩阵用的固定助手", defaultProjectId: "workspace" };
const PROJECT = { id: "workspace", name: "workspace", isDefault: true };

const SESSION_ROWS = [
  { sessionId: "fx-1", title: { raw: "视觉矩阵：会话一", display: "视觉矩阵：会话一" }, project: PROJECT, task: null, peer: null,
    counts: { user: 2, assistant: 2, toolResult: 0, system: 0, total: 4 },
    time: { createdAt: "2026-11-01T02:00:00.000Z", firstMessageAt: "2026-11-01T02:00:00.000Z", lastMessageAt: "2026-11-01T02:05:00.000Z", lastActivityAt: "2026-11-01T02:05:00.000Z", fileModifiedAt: "2026-11-01T02:05:00.000Z" },
    activity: { state: "idle" }, isDefault: false },
  { sessionId: "fx-2", title: { raw: "视觉矩阵：会话二", display: "视觉矩阵：会话二" }, project: PROJECT, task: null, peer: null,
    counts: { user: 1, assistant: 1, toolResult: 0, system: 0, total: 2 },
    time: { createdAt: "2026-11-02T02:00:00.000Z", firstMessageAt: "2026-11-02T02:00:00.000Z", lastMessageAt: "2026-11-02T02:05:00.000Z", lastActivityAt: "2026-11-02T02:05:00.000Z", fileModifiedAt: "2026-11-02T02:05:00.000Z" },
    activity: { state: "unread" }, isDefault: false },
];

const MESSAGES = [
  { role: "user", id: "fx-u1", text: "这是夹具里的一句用户消息，用于视觉基线。", blocks: [{ type: "text", text: "这是夹具里的一句用户消息，用于视觉基线。" }], speaker: { kind: "user" } },
  { role: "assistant", id: "fx-a1", stopReason: "stop", text: "夹具回复：这一段用来检查正文排版、行高与颜色对比。",
    blocks: [{ type: "text", text: "夹具回复：这一段用来检查正文排版、行高与颜色对比。" }] },
];

const SESSION_DETAIL = {
  sessionId: "fx-1",
  messages: MESSAGES,
  meta: { thinkingLevel: "off", running: false, context: { percent: 12, window: 200000 },
    usage: { input: 1200, output: 800, cacheRead: 0, cacheWrite: 0, cost: 0, totalTokens: 2000 },
    model: { provider: "fixture", id: "fixture-model" }, payload: { estimated: 1200, limit: 400000 } },
};

/** 所有场景共用的 mock（顺序：先具体后一般）。 */
async function installFixtures(page) {
  await page.route(/\/api\/agents$/, async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [AGENT] }) });
  });
  await page.route(/\/api\/agents\/[^/]+$/, async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(AGENT) });
  });
  await page.route(/\/api\/agents\/[^/]+\/projects$/, async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [PROJECT] }) });
  });
  await page.route(/\/api\/agents\/[^/]+\/projects\/[^/]+\/sessions$/, async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: SESSION_ROWS }) });
  });
  await page.route(/\/api\/agents\/[^/]+\/rows$/, async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: SESSION_ROWS }) });
  });
  await page.route(/\/api\/agents\/[^/]+\/sessions\/[^/]+$/, async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(SESSION_DETAIL) });
  });
  await page.route(/\/api\/agents\/[^/]+\/sessions\/[^/]+\/entries/, async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ sessionId: "fx-1", total: 0, hasMore: false, entries: [] }) });
  });
  await page.route(/\/api\/profile$/, async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ id: "fixture-user", name: "Fixture User", avatar: null }) });
  });
  await page.route(/\/api\/ui-prefs$/, async (route) => {
    if (route.request().method() !== "GET") return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
    await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });
  await page.route(/\/api\/events/, (route) => route.fulfill({ status: 200, contentType: "text/event-stream", body: "" }));
  await page.route(/\/api\/events\/focus/, (route) => route.fulfill({ status: 200, body: "{}", contentType: "application/json" }));
}

/* ── 场景矩阵 ─────────────────────────────────────────────────────────── */

const SCENES = [
  { name: "chat", enter: async () => {} },
  {
    name: "settings-theme",
    enter: async (page) => {
      await page.locator('nav[aria-label="左侧图标轨"] button[aria-label="设置"]').click();
      await page.waitForSelector('[data-testid="settings-surface"]', { timeout: 8000 });
    },
  },
  {
    name: "settings-display",
    enter: async (page) => {
      await page.locator('nav[aria-label="左侧图标轨"] button[aria-label="设置"]').click();
      await page.waitForSelector('[data-testid="settings-surface"]', { timeout: 8000 });
      await page.evaluate(() => {
        const btn = [...document.querySelectorAll('nav[aria-label="设置分区"] button')].find((item) => (item.innerText ?? "").includes("显示"));
        btn?.click();
      });
      await page.waitForTimeout(250);
    },
  },
  {
    name: "quick-display-popover",
    enter: async (page) => {
      await page.locator('header button[aria-label="显示设置"]').click();
      await page.waitForSelector('[data-testid="popover"]', { timeout: 8000 });
    },
  },
  {
    name: "empty-state",
    // 两个列都收起 → 空态（最容易在深色下发灰的地方）
    enter: async (page) => {
      await page.evaluate(() => {
        document.querySelector('nav[aria-label="左侧图标轨"] button[aria-label="收起助手"]')?.click();
        document.querySelector('nav[aria-label="左侧图标轨"] button[aria-label="收起对话"]')?.click();
      });
      await page.waitForTimeout(400);
    },
  },
];

const VIEWPORTS = [1280, 1920];
const MODES = ["light", "dark"];

mkdirSync(BASELINE, { recursive: true });
mkdirSync(SHOTS, { recursive: true });

const browser = await playwright.chromium.launch({ headless: true, args: ["--no-proxy-server"] });
const results = [];

for (const viewport of VIEWPORTS) {
  for (const mode of MODES) {
    for (const scene of SCENES) {
      const page = await browser.newPage({ viewport: { width: viewport, height: 900 }, deviceScaleFactor: 1 });
      // 时间冻结 + 主题固定：相对时间文案与主题状态都不该让基线漂
      await page.clock.install({ time: new Date("2026-11-09T12:00:00+08:00") });
      await page.addInitScript((value) => {
        localStorage.setItem("lifeos.theme", JSON.stringify({ mode: value }));
        localStorage.removeItem("lifeos.columnWidths");
        localStorage.removeItem("lifeos.collapsedGroups");
      }, mode);
      await installFixtures(page);
      await page.goto(APP_URL, { waitUntil: "networkidle" });
      await page.waitForTimeout(700);
      try {
        await scene.enter(page);
      } catch {
        await page.close();
        results.push({ viewport, mode, scene: scene.name, status: "skipped" });
        continue;
      }
      await page.waitForTimeout(300);
      const file = `${scene.name}-${mode}-${viewport}.png`;
      const buffer = await page.screenshot({ animations: "disabled", caret: "hide" });
      writeFileSync(join(SHOTS, file), buffer);
      const basePath = join(BASELINE, file);
      if (UPDATE || !existsSync(basePath)) {
        writeFileSync(basePath, buffer);
        results.push({ viewport, mode, scene: scene.name, status: UPDATE ? "updated" : "created", file });
      } else {
        const diff = pixelDiff(readFileSync(basePath), buffer);
        results.push({ viewport, mode, scene: scene.name, file, status: diff.ratio <= 0.0005 ? "same" : "diff", ratio: diff.ratio, maxDelta: diff.maxDelta });
      }
      await page.close();
    }
  }
}

await browser.close();

/* ── 报告 ─────────────────────────────────────────────────────────────── */

const rows = results.map((item) => {
  const label = `${item.scene} · ${item.mode} · ${item.viewport}`;
  const baseline = item.file === undefined ? "" : join(BASELINE, item.file);
  const current = item.file === undefined ? "" : join(SHOTS, item.file);
  const encode = (path) => (path !== "" && existsSync(path) ? readFileSync(path).toString("base64") : "");
  const badge = item.status === "same" ? "✔ 一致"
    : item.status === "diff" ? `✖ 差异 ${(item.ratio * 100).toFixed(2)}%`
      : item.status === "skipped" ? "— 跳过（场景进不去）"
        : item.status === "created" ? "＋ 首次写入" : "↻ 已更新";
  const color = item.status === "diff" ? "#c0392b" : item.status === "same" ? "#1e8449" : "#7f8c8d";
  return `<tr>
    <td>${label}</td>
    <td style="color:${color};white-space:nowrap">${badge}</td>
    <td>${item.status === "diff" || item.status === "same" ? `<img src="data:image/png;base64,${encode(baseline)}" height="220"><img src="data:image/png;base64,${encode(current)}" height="220">` : ""}</td>
  </tr>`;
}).join("\n");

mkdirSync(dirname(REPORT), { recursive: true });
writeFileSync(REPORT, `<!doctype html><meta charset="utf-8"><title>视觉矩阵报告</title>
<style>body{font:13px -apple-system,'PingFang SC';margin:24px;color:#222}table{border-collapse:collapse}
td,th{border:1px solid #ddd;padding:6px;vertical-align:top}img{border:1px solid #eee;margin-right:4px}</style>
<h1>视觉矩阵报告</h1>
<p>左图为基线、右图为本次（仅 diff/same 时展示）。判定阈值 0.05%。</p>
<table><tr><th>场景</th><th>结果</th><th>基线 / 本次</th></tr>${rows}</table>`);

const diffed = results.filter((item) => item.status === "diff");
const skipped = results.filter((item) => item.status === "skipped");
console.log(`视觉矩阵：${results.length} 张（${VIEWPORTS.length} 视口 × ${MODES.length} 模式 × ${SCENES.length} 场景）`);
console.log(`一致 ${results.filter((item) => item.status === "same").length} · 差异 ${diffed.length} · 跳过 ${skipped.length}${UPDATE ? " · 已更新基线" : ""}`);
for (const item of diffed) console.log(`  ✖ ${item.scene}/${item.mode}/${item.viewport}：差异 ${(item.ratio * 100).toFixed(2)}%（最大通道差 ${item.maxDelta}）`);
for (const item of skipped) console.log(`  — ${item.scene}/${item.mode}/${item.viewport}：场景进不去（不是回归）`);
console.log(`报告：${REPORT}`);
if (diffed.length > 0 && !UPDATE) process.exit(1);
