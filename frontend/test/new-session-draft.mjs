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
  const rows = page.locator('[data-shot-mask="session-rows"] > [data-testid]');
  const rowCount = () => rows.count();
  const headerTitle = async () => (await page.locator("header h1").first().innerText()).trim();
  const newButton = page.getByRole("button", { name: "新建会话" }).first();

  const before = await rowCount();
  check("起点：已有会话，「新建会话」可用", !(await newButton.isDisabled()), `rows=${before}`);

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
    [...document.querySelectorAll('[data-shot-mask="session-rows"] > [data-testid]')]
      .some((row) => (row.textContent ?? "").includes(title)), RUN, { timeout: 8000 }).catch(() => {});
  const firstRow = (await rows.first().innerText()).replace(/\s+/g, " ").trim();
  check("发送时创建会话（POST /sessions）", sessionPosts.length === postedBeforeSend + 1, sessionPosts.slice(postedBeforeSend).join(","));
  check("发送后 URL 带上 session", new URL(page.url()).searchParams.get("session") !== null, page.url());
  check("发送后列表多一条", (await rowCount()) === before + 1, `before=${before} after=${await rowCount()}`);
  check("列表标题 = 首条消息", firstRow.includes(RUN), firstRow);

  // 5) 首条消息被明确拒绝：删掉刚建的会话、退回草稿、文字回填
  const rejectPage = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const rejectCalls = [];
  rejectPage.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (request.method() !== "GET") rejectCalls.push(`${request.method()} ${path}`);
  });
  await rejectPage.goto(`${APP_URL}/?agent=${encodeURIComponent(agentId ?? "")}&project=${encodeURIComponent(projectId ?? "")}`, { waitUntil: "networkidle" });
  await rejectPage.waitForTimeout(700);
  const rejectBefore = await rejectPage.locator('[data-shot-mask="session-rows"] > [data-testid]').count();
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
  check("被拒绝后列表没有新增条目", (await rejectPage.locator('[data-shot-mask="session-rows"] > [data-testid]').count()) === rejectBefore);
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
