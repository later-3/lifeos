#!/usr/bin/env node
/**
 * 工作台四态契约（Task 0023 · S1 第 5 块）。
 *
 * 依据 `specs/code/testing/testing.md` 2.3（配置类页面四态必测）与 2.26（注入类夹具的
 * 第一条断言必须是"被测对象存在"），以及 architect 第 4 块复核提的三条加码：
 *
 *   ① 四态各一条：**loading / empty / failed / content**，全部 route mock，不连真家目录；
 *   ② **被测对象存在必须是断言，不是分支**（C311 教训）：每条第一句先断言对象数 > 0，
 *      输出打印实际条数；对象不存在 = 报「没测到」并**红**，不许换成更弱的断言顶上；
 *   ③ **入口写死成夹具**：`ui-contract` / `test:boot` 都按"消息最多的会话"动态挑入口，
 *      入口一变红名单就跟着变（architect 实测 8 红 vs 我 6 红差的正是这个）。
 *      本文件用固定 `?agent/&project/&session`，四态与数据状态彻底解耦；
 *   ④ **"有内容但没对端"**（2.32：就绪标志按被取数对象分别维护）：只让 tasks 有、
 *      feed 失败 → 项目区照常出内容，**不是**整体失败页。
 *
 * 为什么 feed 走全局注入点而不是 route mock：S1 的 feed 是**桩**（不是网络请求），
 * `page.route` 拦不到。唯一的 seam 是 `api/workbench.ts` 的 `__lifeosFeedSource`
 * （S2 接真接口时与桩一起删，`grep __lifeosFeedSource` 能找到两处）。
 *
 * 用法：`APP_URL=http://127.0.0.1:5180 node frontend/test/workbench-states.mjs`
 */
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { EVENT_CHANNEL_STUB } from "./event-channel-stub.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const APP_URL = process.env.APP_URL ?? "http://127.0.0.1:5180";

const CANDIDATES = [
  process.env.PLAYWRIGHT_CORE,
  join(HERE, "../node_modules/playwright-core/index.js"),
  join(HERE, "../../node_modules/playwright-core/index.js"),
  join(homedir(), ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright-core/index.js"),
].filter(Boolean);
let pw;
for (const candidate of CANDIDATES) {
  if (!existsSync(candidate)) continue;
  pw = (await import(candidate)).default ?? (await import(candidate));
  break;
}
if (pw === undefined) throw new Error("找不到 playwright-core：设置 PLAYWRIGHT_CORE=/path/to/playwright-core/index.js");

/* ══════════════ 结果账（"没测到"= 红，不是通过）══════════════ */

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "✔" : "✖"} ${name}${detail === "" ? "" : `  → ${detail}`}`);
};

/**
 * architect 加码②：**对象存在性单独成一类断言**，失败文案直接写「没测到」。
 *
 * 为什么不能写成 `if (count === 0) return;` 或 `cards.forEach(...)`：
 * 空集上的 `every()` 恒真 —— 断言会以"全部符合"的姿态通过，
 * 而真相是"页面根本没渲染出被注入的东西"（testing 2.26 / C308 的同一种病）。
 */
const mustExist = (label, stats) => {
  const ok = Object.values(stats).every((value) => value > 0);
  const detail = Object.entries(stats).map(([key, value]) => `${key}=${value}`).join(" ");
  check(`${label}：测到对象了`, ok, ok ? detail : `没测到（${detail}）—— 断言未执行`);
  return ok;
};

/**
 * FYI-2：这条场景没有打到任何"没准备"的 /api 路径。
 * 打印实际打到的清单（空 = 夹具覆盖完整），为空才算通过。
 */
const makeAssertNoUnmatched = (unmatched) => () => {
  check("夹具覆盖完整（没有打到兜底 501）", unmatched.length === 0,
    unmatched.length === 0 ? "" : `未准备：${[...new Set(unmatched)].join(", ")}`);
};

/* ══════════════ 夹具（入口写死）══════════════ */

const AGENT = { id: "lifeosagent", name: "Life Agent", description: "", defaultProjectId: "workspace", schemaVersion: 1, defaultSessionId: "sess-fixture" };
const PROJECT = { id: "workspace", name: "workspace", isDefault: true };
/** 入口会话**写死**（不按"消息最多"挑）：四态断言不应该被用户数据的形状决定。 */
const ENTRY = `/?agent=${AGENT.id}&project=${PROJECT.id}&session=sess-fixture`;

const sessionRow = () => ({
  sessionId: "sess-fixture",
  title: { raw: "四态夹具会话", display: "四态夹具会话" },
  project: PROJECT, task: null, peer: null,
  counts: { user: 1, assistant: 1, toolResult: 0, system: 0, total: 2 },
  time: { createdAt: "2026-11-22T00:00:00.000Z", lastActivityAt: "2026-11-22T00:00:00.000Z", fileModifiedAt: "2026-11-22T00:00:00.000Z" },
  activity: { state: "idle" }, isDefault: false,
});

const browser = await pw.chromium.launch({ headless: true });

/** 三个接口 + feed 的四种装填。`feed` 走全局注入点（见文件头）。 */
const GLOBAL_TASK = {
  id: "9001", dirName: "9001-夹具任务", number: 9001, title: "四态夹具任务",
  type: "development", category: "A 改产品行为", status: "进行中", goal: "",
  path: "", docPath: "", date: "2026-11-22", agentId: AGENT.id, projectId: PROJECT.id, state: "进行中",
};
/**
 * 「其他」卡的夹具（R4 活性）：**原文 status 必须非空且不等于"其他"** ——
 * 那是 R4 的核心要求（用户要能看出"已作废"还是"状态写错了"）。
 */
const OTHER_TASK = {
  ...GLOBAL_TASK, id: "9002", dirName: "9002-夹具其他任务", number: 9002,
  title: "四态夹具·其他状态卡", status: "已作废（夹具，未使用）", state: "其他",
};
const GLOBAL_PROJECT = { id: PROJECT.id, name: PROJECT.name, icon: "🏠", agentIds: [AGENT.id] };
const DAY = {
  date: "2026-11-22", documents: [], todos: [],
  activity: [{ kind: "log", agentId: AGENT.id, projectId: PROJECT.id, taskId: "9001", taskTitle: "四态夹具任务", heading: "夹具日志", at: "2026-11-21T16:00:00.000Z" }],
};

const FEED_SEED = [{
  _stub: true, id: "fixture-1", day: "2026-11-22",
  author: { kind: "agent", id: AGENT.id, name: AGENT.name },
  title: "四态夹具卡片", text: "这张卡只在四态契约里存在。", tags: ["夹具"],
  likes: 1, comments: 0, mine: false, kind: "dev",
}];

/**
 * `mode` 决定四个数据源各自怎么响应：
 * - `content`：全给数据；
 * - `empty`：全给空数组（**已就绪**的空，不是"没拿到"）；
 * - `failed`：三接口 500 + feed 返回 http 失败；
 * - `loading`：全部挂起（永不到达）→ 骨架；
 * - `partial`：tasks 有数据、**feed 失败**、projects 有数据（2.32 的"按对象分别维护"）；
 * - `other`：tasks 里有一张 `state:"其他"` 的卡（原文 status 非空）——**R4 尾部组的活性夹具**。
 * - `other-moved`：同一张卡改成 `进行中` → 尾部组必须**消失**（反向）。
 */
async function openWorkbench({ mode, waitMs = 700 }) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const json = (route, body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  const fail = (route) => json(route, { error: { code: "boom", message: "夹具失败" } }, 500);
  const hang = () => new Promise(() => {});   // 永不 resolve：骨架态

  /*
   * **兜底 catch-all（FYI-2）**：必须**先**注册（Playwright 后注册先匹配 → 这条成最后兜底）。
   * 返回 501 并**记到 node 侧数组**（不写 window：route handler 里 `page.evaluate` 会在
   * 页面未就绪时悬挂，请求永远不 fulfill、App 起不来——实测踩过）。
   * 每个场景收尾断言该数组为空，于是"App 新增首屏接口而夹具没准备"会变红。
   */
  const unmatched = [];
  /*
   * **必须用 predicate 而不是 .../api/... 这种通配**：后者会命中 Vite 的开发模块路径
   * /src/api/emoji-catalog.ts（实测：rootHTML len=0、App 根本起不来）。
   * predicate 只认 pathname 以 /api/ 开头 = 真正的后端调用。
   */
  await page.route((url) => url.pathname.startsWith("/api/"), async (route) => {
    unmatched.push(new URL(route.request().url()).pathname);
    return route.fulfill({
      status: 501,
      contentType: "application/json",
      body: JSON.stringify({ error: { code: "unmatched_fixture", message: "四态夹具没有为这条路径准备响应" } }),
    });
  });

  /* 应用自身的接口（与工作台无关，但 App 要能起来；全部固定） */
  await page.route(/\/api\/agents.*$/, async (route) => {
    const p = new URL(route.request().url()).pathname;
    if (p === "/api/agents") return json(route, { items: [AGENT] });
    if (/^\/api\/agents\/[^/]+\/projects$/.test(p)) return json(route, { items: [PROJECT] });
    if (/^\/api\/agents\/[^/]+\/projects\/[^/]+\/groups$/.test(p)) return json(route, { items: [{ project: PROJECT, sessions: [sessionRow()] }] });
    if (/^\/api\/agents\/[^/]+\/projects\/[^/]+\/sessions$/.test(p)) return json(route, { items: [sessionRow()] });
    if (/^\/api\/agents\/[^/]+\/config$/.test(p)) return json(route, { model: null, thinkingLevel: "medium" });
    if (/turns\/last$/.test(p)) return json(route, { turn: null });
    if (/\/annotations$/.test(p)) return json(route, { annotations: [] });
    if (/^\/api\/agents\/[^/]+\/sessions\/[^/]+$/.test(p)) return json(route, { messages: [], meta: { running: false } });
    return json(route, {});
  });
  await page.route("**/api/profile", (route) => json(route, { name: "me" }));
  await page.route("**/api/runtime", (route) => json(route, { running: [], draining: false }));
  await page.route("**/api/events/focus", (route) => json(route, {}));
  await page.route("**/api/ui-prefs", (route) => json(route, {}));
  await page.route("**/api/media/catalog**", (route) => json(route, { items: [] }));
  await page.route("**/api/logs", (route) => json(route, {}));

  /* 工作台三个只读接口（全局路径，与上面的 per-agent 路径不重合） */
  await page.route("**/api/tasks*", (route) => {
    if (mode === "failed") return fail(route);
    if (mode === "loading") return hang();
    if (mode === "empty") return json(route, { items: [] });
    if (mode === "other") return json(route, { items: [GLOBAL_TASK, OTHER_TASK] });
    if (mode === "other-moved") return json(route, { items: [GLOBAL_TASK, { ...OTHER_TASK, state: "进行中", status: "进行中" }] });
    return json(route, { items: [GLOBAL_TASK] });   // content / partial
  });
  await page.route("**/api/projects", (route) => {
    if (mode === "failed") return fail(route);
    if (mode === "loading") return hang();
    if (mode === "empty") return json(route, { items: [] });
    return json(route, { items: [GLOBAL_PROJECT] });
  });
  await page.route("**/api/days*", (route) => {
    if (mode === "failed") return fail(route);
    if (mode === "loading") return hang();
    if (mode === "empty") return json(route, { items: [] });
    return json(route, { items: [DAY] });
  });

  /* feed：S1 是桩，packet 只能用全局注入点（S2 接真接口时与桩一起删） */
  await page.addInitScript(({ mode, seed }) => {
    window.__lifeosFeedSource = () => {
      if (mode === "failed" || mode === "partial") {
        return Promise.resolve({ ok: false, failure: { kind: "http", status: 500, label: "工作台内容流", ms: 1 } });
      }
      if (mode === "loading") return new Promise(() => {});
      if (mode === "empty") return Promise.resolve({ ok: true, value: [] });
      return Promise.resolve({ ok: true, value: seed });
    };
  }, { mode, seed: FEED_SEED });
  await page.addInitScript(EVENT_CHANNEL_STUB);

  await page.goto(`${APP_URL}${ENTRY}`, { waitUntil: "domcontentloaded" });
  // 进工作台：rail 顶部的「我」
  await page.getByRole("button", { name: "我的工作台" }).first().click();
  await page.locator('[data-testid="workbench-surface"]').waitFor({ timeout: 10_000 });
  await page.waitForTimeout(waitMs);   // 等四态落定（loading 态也走这一步，让骨架先画出来）
  return { ctx, page, assertNoUnmatched: makeAssertNoUnmatched(unmatched) };
}

/* ══════════════ ① loading：骨架，且不写结论 ══════════════ */
{
  const { ctx, page, assertNoUnmatched } = await openWorkbench({ mode: "loading" });
  const feedSkeletons = await page.locator('[data-testid="workbench-feed-loading"]').count();
  const cards = await page.locator('[data-testid="workbench-feed-card"]').count();
  mustExist("loading/feed 骨架", { skeletons: feedSkeletons });
  check("loading：不画任何卡片（骨架与内容互斥）", cards === 0, `cards=${cards}`);
  const body = (await page.locator('[data-testid="workbench-panel"]').textContent()) ?? "";
  check("loading：不写结论性空态文案（2.32 不撒谎）", !body.includes("还没有内容"), body.slice(0, 60));
  // 项目区同样
  await page.getByRole("tab", { name: /项目/ }).click();
  await page.waitForTimeout(300);
  const projectSkeletons = await page.locator('[data-testid="workbench-projects-loading"]').count();
  const projectRows = await page.locator('[data-testid="workbench-project-row"]').count();
  mustExist("loading/项目区骨架", { skeletons: projectSkeletons });
  check("loading：项目区不画行（骨架与内容互斥）", projectRows === 0, `rows=${projectRows}`);
  assertNoUnmatched();
  await ctx.close();
}

/* ══════════════ ② empty：确实为空（已就绪）+ 空态出口 ══════════════ */
{
  const { ctx, page, assertNoUnmatched } = await openWorkbench({ mode: "empty" });
  const emptyFeed = await page.locator('[data-testid="workbench-feed-empty"]').count();
  const cards = await page.locator('[data-testid="workbench-feed-card"]').count();
  mustExist("empty/内容流空态", { emptyNodes: emptyFeed });
  check("empty：没有卡片（真空 ≠ 加载）", cards === 0, `cards=${cards}`);
  check("empty：写明「还没有内容」（空态给结论，因为确实没数据）",
    ((await page.locator('[data-testid="workbench-panel"]').textContent()) ?? "").includes("还没有内容"));
  await page.getByRole("tab", { name: /项目/ }).click();
  await page.waitForTimeout(300);
  const emptyProjects = await page.locator('[data-testid="workbench-projects-empty"]').count();
  mustExist("empty/项目区空态", { emptyNodes: emptyProjects });
  assertNoUnmatched();
  await ctx.close();
}

/* ══════════════ ③ failed：失败有出口（原因 + 重试），不冒充空态 ══════════════ */
{
  const { ctx, page, assertNoUnmatched } = await openWorkbench({ mode: "failed" });
  const notices = await page.locator('[data-testid="workbench-load-failure"]').count();
  mustExist("failed/失败表面", { notices });
  const scope = await page.locator('[data-testid="workbench-load-failure"]').first().getAttribute("data-failure-scope");
  check("failed：失败标明是哪一块（按对象分别维护，2.32）", scope === "feed", `scope=${scope}`);
  const text = (await page.locator('[data-testid="workbench-load-failure"]').first().textContent()) ?? "";
  check("failed：有原因文案（不是空白/不是空态）", text.trim().length > 0 && !text.includes("还没有内容"), text.slice(0, 60));
  check("failed：有重试入口", (await page.getByRole("button", { name: "重试" }).count()) >= 1);
  assertNoUnmatched();
  await ctx.close();
}

/* ══════════════ ④ content：真内容 + 关系的形状 ══════════════ */
{
  const { ctx, page, assertNoUnmatched } = await openWorkbench({ mode: "content" });
  const cards = await page.locator('[data-testid="workbench-feed-card"]').count();
  mustExist("content/内容流卡片", { cards });
  check("content：卡片带「示例」徽标（桩变漂亮了还是桩）",
    (await page.locator('[data-testid="workbench-feed-card"]').first().textContent() ?? "").includes("示例"));
  await page.getByRole("tab", { name: /项目/ }).click();
  await page.waitForTimeout(400);
  const rows = await page.locator('[data-testid="workbench-project-row"]').count();
  const kanbanCards = await page.locator('[data-testid="workbench-kanban-card"]').count();
  mustExist("content/项目区", { rows, kanbanCards });
  assertNoUnmatched();
  await ctx.close();
}

/* ══════════════ ⑤ partial：有内容 + 对端失败（不是整体失败页）══════════════ */
{
  const { ctx, page, assertNoUnmatched } = await openWorkbench({ mode: "partial" });
  const feedNotice = await page.locator('[data-testid="workbench-load-failure"][data-failure-scope="feed"]').count();
  mustExist("partial/内容流失败表面", { notices: feedNotice });
  await page.getByRole("tab", { name: /项目/ }).click();
  await page.waitForTimeout(400);
  const rows = await page.locator('[data-testid="workbench-project-row"]').count();
  mustExist("partial/项目区仍有内容（快的那个不被慢的那个代言）", { rows });
  check("partial：项目区没有跟着报错",
    (await page.locator('[data-testid="workbench-load-failure"][data-failure-scope="projects"]').count()) === 0);
  assertNoUnmatched();
  await ctx.close();
}

/* ══════════════ ⑥ other：R4 尾部组的**正路径**（夹具，不靠 live 数据）══════════════ */
{
  const { ctx, page, assertNoUnmatched } = await openWorkbench({ mode: "other" });
  await page.getByRole("tab", { name: /项目/ }).click();
  await page.waitForTimeout(400);
  const group = await page.locator('[data-testid="workbench-kanban-other"]').count();
  mustExist("other/「其他」尾部组", { groups: group });
  // 点开展开组（折叠组的展开行）
  await page.locator('[data-testid="workbench-kanban-other"] button, [data-testid="workbench-kanban-other"] [role="button"]').first().click();
  await page.waitForTimeout(250);
  const cards = await page.locator('[data-testid="workbench-kanban-other-card"]').count();
  mustExist("other/组内卡片", { cards });
  const text = (await page.locator('[data-testid="workbench-kanban-other-card"]').first().textContent()) ?? "";
  check("other：组内卡显示**原始 status**（不是「其他」两个字）",
    text.includes("已作废（夹具，未使用）"), text.slice(0, 80));
  assertNoUnmatched();
  await ctx.close();
}

/* ══════════════ ⑦ other-moved：同一张卡改成进行中 → 尾部组**消失**（反向活性）══════════════ */
{
  const { ctx, page, assertNoUnmatched } = await openWorkbench({ mode: "other-moved" });
  await page.getByRole("tab", { name: /项目/ }).click();
  await page.waitForTimeout(400);
  const group = await page.locator('[data-testid="workbench-kanban-other"]').count();
  check("other-moved：没有「其他」卡时尾部组不渲染（空组不出现）", group === 0, `groups=${group}`);
  // 那张卡应当出现在「进行中」列里
  const runCards = await page.locator('[data-testid="workbench-kanban-card"]').count();
  mustExist("other-moved/看板卡片", { cards: runCards });
  assertNoUnmatched();
  await ctx.close();
}

/* ══════════════ ⑧ month-fail：从有内容的月份切到**失败**的月份（P1-2）══════════════ */
{
  const { ctx, page, assertNoUnmatched } = await openWorkbench({ mode: "content" });
  // 桌面：月历在右栏（testid=workbench-right），不是 tab（手机才是分段）
  await page.locator('[data-testid="workbench-right"] [data-testid="workbench-calendar"]').waitFor({ timeout: 10_000 });
  // 同上：用 testid 定位（role 已从 grid 改成 group）
  const hasDay = await page.locator('[data-testid="workbench-calendar-grid"] button').count();
  mustExist("month-fail/本月内容", { days: hasDay });
  // 让下一次 /api/days 失败（route 后注册优先匹配）
  await page.route("**/api/days*", (route) => route.fulfill({
    status: 500, contentType: "application/json",
    body: JSON.stringify({ error: { code: "boom", message: "切月失败夹具" } }),
  }));
  // 点下个月
  await page.getByRole("button", { name: "下个月" }).click();
  await page.waitForTimeout(700);
  const failure = await page.locator('[data-testid="workbench-load-failure"][data-failure-scope="days"]').count();
  mustExist("month-fail/切月后失败表面", { surfaces: failure });
  const panelText = (await page.locator('[data-testid="workbench-panel"]').textContent()) ?? "";
  check("month-fail：不是「这个月没有活动」那种空态结论",
    !panelText.includes("这个月还没有") && !panelText.includes("这个月没有活动"), panelText.slice(0, 80));
  assertNoUnmatched();
  await ctx.close();
}

await browser.close();

const failed = results.filter((item) => !item.ok);
console.log(`\n${results.length - failed.length}/${results.length} 通过${failed.length === 0 ? "" : `；失败：${failed.map((item) => item.name).join(" · ")}`}`);
process.exit(failed.length === 0 ? 0 : 1);
