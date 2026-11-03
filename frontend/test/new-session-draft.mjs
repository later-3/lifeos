#!/usr/bin/env node
/**
 * 「新建会话 = 草稿」契约（Task 0006）：
 * 点击新建会话不建服务端会话、列表不动；草稿文字刷新不丢；首条消息才建会话并命名；
 * 首条消息被明确拒绝时删掉刚建的会话并退回草稿。
 * 需要 dev server（默认 http://localhost:5173）。
 *
 * 参考与决策：projects/lifeos/tasks/0006-新建会话：只开草稿，不建会话/02-design.md
 */
import pw from "/Users/xulater/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright-core/index.js";
const { chromium } = pw;
const APP_URL = process.env.APP_URL ?? "http://localhost:5173";
const RUN = `草稿契约-${Date.now()}`;
const failures = [];
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "✔" : "✖"} ${name}${detail === "" ? "" : `  → ${detail}`}`);
  if (!ok) failures.push(name);
};

const browser = await chromium.launch({ headless: true });
let agentId;
let projectId;
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const sessionPosts = [];
  const sessionDeletes = [];
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (request.method() === "POST" && /\/sessions$/.test(path)) sessionPosts.push(path);
    if (request.method() === "DELETE" && /\/sessions\/[^/]+$/.test(path)) sessionDeletes.push(path);
  });
  await page.goto(APP_URL, { waitUntil: "networkidle" });
  await page.waitForTimeout(600);
  const params = new URL(page.url()).searchParams;
  agentId = params.get("agent") ?? undefined;
  projectId = params.get("project") ?? undefined;
  /**
   * 会话行的选择器：Task 0015 把项目列与会话列合并后，`session-rows` 的直接子元素变成了
   * `div[data-project-id]` 分组容器，会话行在**组内**（`[data-testid="group-header"]` 的兄弟）。
   * 旧选择器 `> [data-testid]` 会匹配到 0 个 —— 于是"列表条目不变/多一条"这几条断言
   * 在 2026-11-02 之后一直是空跑（永远 0 === 0）。这里按新结构取，门禁恢复活性。
   */
  const SESSION_ROW = '[data-shot-mask="session-rows"] [data-testid="group-header"] ~ div [data-testid]';
  const rows = page.locator(SESSION_ROW);
  const rowCount = () => rows.count();
  const headerTitle = async () => (await page.locator("header h1").first().innerText()).trim();
  /**
   * 「新建会话」按钮从列底搬到了**项目分组头**（Task 0006，用户 2026-11-03）。
   * 所以不再有唯一的全局按钮：按项目名定位。`groupNewButton(name)` 拿到的是"在这个项目下新建"。
   */
  const groupNewButton = (name) => page.locator(`button[aria-label="在 ${name} 新建会话"]`).first();
  const groupNames = async () => await page.evaluate(() => [...document.querySelectorAll('[data-testid="group-header"]')]
    .map((el) => el.getAttribute("data-group-name") ?? ""));
  const names = await groupNames();
  const projectName = names.find((name) => name !== "") ?? "";
  const newButton = groupNewButton(projectName);

  const before = await rowCount();
  check("起点：分组头里有「新建会话」按钮", names.length > 0 && (await newButton.count()) === 1, `projects=${names.join(",")}`);
  check("列底不再有全局「新建会话」",
    (await page.locator('aside footer button', { hasText: "新建会话" }).count()) === 0);
  check("起点：该项目「新建会话」可用", !(await newButton.isDisabled()), `rows=${before}`);

  // 1) 点击新建会话：零请求、列表不动、URL 去 session、头部「新会话」
  const postedAtStart = sessionPosts.length;
  await newButton.click();
  await page.waitForTimeout(500);
  check("点击新建会话不发 POST /sessions", sessionPosts.length === postedAtStart, sessionPosts.slice(postedAtStart).join(","));
  check("点击新建会话列表条目不变", (await rowCount()) === before, `before=${before} after=${await rowCount()}`);
  check("点击新建会话 URL 去掉 session", new URL(page.url()).searchParams.get("session") === null, page.url());
  check("草稿态头部显示「新会话」", (await headerTitle()) === "新会话", await headerTitle());
  check("草稿态「新建会话」按钮禁用", await newButton.isDisabled());

  // 2) 连点：仍然没有请求、没有新条目（按钮已禁用，force 点击模拟误触）
  const postedAfterFirst = sessionPosts.length;
  await newButton.click({ force: true }).catch(() => undefined);
  await page.waitForTimeout(300);
  check("连点新建会话不再发请求", sessionPosts.length === postedAfterFirst);
  check("连点新建会话不新增条目", (await rowCount()) === before);

  // 3) 草稿文字刷新不丢
  await page.locator("textarea").first().fill(RUN);
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(700);
  check("刷新后仍在草稿（URL 无 session）", new URL(page.url()).searchParams.get("session") === null, page.url());
  check("刷新后头部仍是「新会话」", (await headerTitle()) === "新会话");
  check("刷新后草稿文字仍在", (await page.locator("textarea").first().inputValue()) === RUN);
  check("刷新后列表没有新增条目", (await rowCount()) === before);

  // 4) 首条消息才建会话，标题 = 首条消息
  const postedBeforeSend = sessionPosts.length;
  await page.locator("textarea").first().press("Enter");
  await page.waitForFunction((title) =>
    [...document.querySelectorAll('[data-shot-mask="session-rows"] [data-testid="group-header"] ~ div [data-testid]')]
      .some((row) => (row.textContent ?? "").includes(title)), RUN, { timeout: 8000 }).catch(() => {});
  const firstRow = (await rows.first().innerText()).replace(/\s+/g, " ").trim();
  check("发送时创建会话（POST /sessions）", sessionPosts.length === postedBeforeSend + 1, sessionPosts.slice(postedBeforeSend).join(","));
  check("发送后 URL 带上 session", new URL(page.url()).searchParams.get("session") !== null, page.url());
  // Task 0006：归属由**被点的分组头**决定，不是 `selectedProjectId` 的旧值
  check("会话建在被点的那个项目下",
    sessionPosts.slice(postedBeforeSend).every((path) => path.includes(`/projects/${projectId}/sessions`)),
    `期望 /projects/${projectId}/sessions，实际 ${sessionPosts.slice(postedBeforeSend).join(",")}`);
  check("发送后列表多一条", (await rowCount()) === before + 1, `before=${before} after=${await rowCount()}`);
  check("列表标题 = 首条消息", firstRow.includes(RUN), firstRow);

  // 6) Task 0006 核心：点**另一个项目**的 ＋，草稿就落到那个项目（改前会落回上一个项目）
  if (names.length > 1) {
    const other = names.find((name) => name !== projectName) ?? "";
    const otherPostsBefore = sessionPosts.length;
    await groupNewButton(other).click();
    await page.waitForTimeout(700);
    const search = new URL(page.url()).searchParams;
    check("点他组 ＋：URL 无 session（进草稿）", search.get("session") === null, page.url());
    check("点他组 ＋：本组按钮禁用（已在该项目草稿）", await groupNewButton(other).isDisabled());
    check("点他组 ＋：原组按钮仍可用（可切回去）", !(await groupNewButton(projectName).isDisabled()));
    check("点他组 ＋：仍零请求", sessionPosts.length === otherPostsBefore, sessionPosts.slice(otherPostsBefore).join(","));
    // 该项目的默认 Task 是头部 task 段的事实源：发送后 POST 必须落在它下面
    const otherId = await page.evaluate(async (name) => {
      const list = await (await fetch(`/api/agents/${encodeURIComponent(new URL(location.href).searchParams.get("agent") ?? "")}/projects`)).json();
      return list.items.find((item) => item.name === name)?.id;
    }, other);
    check("点他组 ＋：当前项目就是它（?project 指向它）",
      otherId !== undefined && search.get("project") === otherId, `?project=${search.get("project")} 期望 ${otherId ?? "-"}`);
  } else {
    check("点他组 ＋：草稿落在他项目（只有 1 个项目，跳过）", true);
  }

  // 4b) 折叠状态下点该组的 ＋：组要展开（否则用户点了看不见结果）
  //     这一条补的是 Task 0006 收尾时「只有代码推断、没有实测」的缺口。
  {
    const headerBtn = (name) => page.locator(`[data-testid="group-header"][data-group-name="${name}"] button`).first();
    const currentName = await page.evaluate(() => {
      const selected = [...document.querySelectorAll('[data-testid="group-header"]')]
        .find((el) => el.querySelector('button[aria-current="true"]') !== null);
      return selected?.getAttribute("data-group-name") ?? null;
    });
    const foldTarget = currentName ?? projectName;
    // 先折叠
    if ((await headerBtn(foldTarget).getAttribute("aria-expanded")) === "true") {
      await headerBtn(foldTarget).click();
      await page.waitForTimeout(400);
    }
    check("折叠后 aria-expanded=false", (await headerBtn(foldTarget).getAttribute("aria-expanded")) === "false", foldTarget);
    // 折叠状态下点该组 ＋（若该组正是草稿项目，按钮禁用 → 换一个可用的组；只有一个组时跳过这条断言）
    const candidates = await page.evaluate(() => [...document.querySelectorAll('[data-testid="group-header"]')]
      .map((el) => el.getAttribute("data-group-name") ?? ""));
    const clickable = [];
    for (const name of candidates) {
      if (!(await groupNewButton(name).isDisabled())) clickable.push(name);
    }
    if (clickable.length > 0) {
      const pick = clickable[0];
      if ((await headerBtn(pick).getAttribute("aria-expanded")) === "true") {
        await headerBtn(pick).click();
        await page.waitForTimeout(400);
      }
      await groupNewButton(pick).click();
      await page.waitForTimeout(600);
      check("折叠组点 ＋ 会展开该组", (await headerBtn(pick).getAttribute("aria-expanded")) === "true", pick);
    } else {
      check("折叠组点 ＋ 会展开该组（所有组按钮都禁用，跳过）", true);
    }
  }

  // 5) 首条消息被明确拒绝：删掉刚建的会话、退回草稿、文字回填
  const rejectPage = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const rejectCalls = [];
  rejectPage.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (request.method() !== "GET") rejectCalls.push(`${request.method()} ${path}`);
  });
  await rejectPage.goto(`${APP_URL}/?agent=${encodeURIComponent(agentId ?? "")}&project=${encodeURIComponent(projectId ?? "")}`, { waitUntil: "networkidle" });
  await rejectPage.waitForTimeout(700);
  const rejectBefore = await rejectPage.locator(SESSION_ROW).count();
  await rejectPage.route(/\/api\/agents\/[^/]+\/sessions\/[^/]+\/messages$/, (route) => route.fulfill({
    status: 400, contentType: "application/json", body: JSON.stringify({ error: { code: "invalid_request", message: "契约测试拒绝" } }),
  }));
  await rejectPage.locator("textarea").first().fill(`${RUN}-拒绝`);
  await rejectPage.locator("textarea").first().press("Enter");
  await rejectPage.waitForTimeout(1500);
  const created = rejectCalls.find((call) => call.startsWith("POST ") && call.endsWith("/sessions"));
  const deleted = rejectCalls.find((call) => call.startsWith("DELETE ") && call.includes("/sessions/"));
  check("被拒绝后退回草稿（URL 无 session）", new URL(rejectPage.url()).searchParams.get("session") === null, rejectPage.url());
  check("被拒绝后头部回到「新会话」", (await rejectPage.locator("header h1").first().innerText()).trim() === "新会话");
  check("被拒绝后文字回填", (await rejectPage.locator("textarea").first().inputValue()) === `${RUN}-拒绝`);
  check("被拒绝后删除刚建的会话", created !== undefined && deleted !== undefined, `${created ?? "-"} / ${deleted ?? "-"}`);
  check("被拒绝后列表没有新增条目", (await rejectPage.locator(SESSION_ROW).count()) === rejectBefore);
} finally {
  // 测试产生的会话必须删掉（E2E 不留副作用）：按本轮的标题前缀清理
  if (agentId !== undefined && projectId !== undefined) {
    const list = await (await fetch(`${APP_URL}/api/agents/${agentId}/projects/${projectId}/sessions`)).json().catch(() => ({ items: [] }));
    for (const item of list.items ?? []) {
      if (typeof item.title !== "string" || !item.title.includes(RUN)) continue;
      await fetch(`${APP_URL}/api/agents/${agentId}/sessions/${item.sessionId}`, { method: "DELETE" }).catch(() => undefined);
    }
  }
  await browser.close();
}

const failed = failures.length;
console.log(failed === 0 ? "\n新建会话草稿契约通过。" : `\n${failed} 项失败：${failures.join("；")}`);
process.exit(failed === 0 ? 0 : 1);
