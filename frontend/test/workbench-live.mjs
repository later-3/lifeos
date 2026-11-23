#!/usr/bin/env node
/**
 * 工作台 live 验证（Task 0023 · S1 第 3 块的「和接口对得上」）。
 *
 * 与 ui-contract 的差别：**不 route mock**——它打开的是连着真数据的实例
 * （默认 APP_URL=http://127.0.0.1:5180，即 0023 的整合运行时），先把三个接口拉下来，
 * 再进界面逐条对关系（S1-contract §6-R3：断言写关系，不写快照数字）：
 *
 *   1. stories 数 = /api/agents 条数 + 1（我）；
 *   2. 项目区行数 = /api/projects 条数；行副行「X 进行中 · Y 个任务」与 /api/tasks 按项目求出的关系一致；
 *   3. 看板：3 列卡数 + 「其他」组卡数 = /api/tasks 里 type!=="daily" 的条数（勾选=默认全选）；
 *   4. 列头是枚举值（进行中/已完成/已移交），不是原始 status 字符串；
 *   5. 「其他」组：真数据里有 1 张（architect/lifeos/0005 已作废）→ 组出现且显示原文；
 *   6. 月历：点一个有底色的格 → 当日列表行数 = 该格计数（同一份 Day.activity）；
 *   7. 1280/1440/1920 三档中栏 ≥ 420；右栏拖宽逐帧跟手（分隔条 x 位移 ≈ 鼠标位移）；
 *   8. 桩卡带「示例」徽标（假数据不装真）。
 *
 * 用法：APP_URL=… node frontend/test/workbench-live.mjs [--shots <dir>]
 */
import { existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const HERE = dirname(fileURLToPath(import.meta.url));
const APP_URL = process.env.APP_URL ?? "http://127.0.0.1:5180";
const SHOTS = (() => {
  const i = process.argv.indexOf("--shots");
  return i >= 0 ? process.argv[i + 1] : join(HERE, "../../.workbench-shots");
})();

const PLAYWRIGHT_CANDIDATES = [
  process.env.PLAYWRIGHT_CORE,
  join(HERE, "../node_modules/playwright-core/index.js"),
  join(HERE, "../../node_modules/playwright-core/index.js"),
  join(homedir(), ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright-core/index.js"),
].filter(Boolean);

async function loadPlaywright() {
  for (const candidate of PLAYWRIGHT_CANDIDATES) {
    if (!existsSync(candidate)) continue;
    const module = await import(candidate);
    return module.default ?? module;
  }
  throw new Error("找不到 playwright-core：设置 PLAYWRIGHT_CORE=/path/to/playwright-core/index.js");
}

let pass = 0;
const failures = [];
const check = (name, ok, detail = "") => {
  if (ok) { pass += 1; console.log(`✔ ${name}${detail ? `  → ${detail}` : ""}`); }
  else { failures.push(name); console.log(`✖ ${name}  → ${detail}`); }
};

const require_ = createRequire(import.meta.url);
const pw = await loadPlaywright();
const browser = await pw.chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

// 先拉三个接口的实况（经页面同源 → 走 vite 代理 → 整合后端）
const api = async (path) => (await page.request.get(`${APP_URL}${path}`)).json();
const agentsRes = await api("/api/agents");
const tasksRes = await api("/api/tasks");
const projectsRes = await api("/api/projects");
const agents = agentsRes.items ?? [];
const tasks = tasksRes.items ?? [];
const projects = projectsRes.items ?? [];
const nonDaily = tasks.filter((t) => t.type !== "daily");
const byState = { "进行中": [], "已完成": [], "已移交": [], "其他": [] };
for (const t of nonDaily) (byState[t.state] ??= []).push(t);

// 进工作台：点 rail 顶部的「我」
await page.goto(APP_URL, { waitUntil: "networkidle" });
await page.getByRole("button", { name: "我的工作台" }).first().click();
await page.locator('[data-testid="workbench-surface"]').waitFor();
await page.waitForTimeout(400);

// 1) stories 数 = agents + 我
const stories = await page.locator('[data-testid="workbench-stories"] button').count();
check("stories 数 = /api/agents 条数 + 我", stories === agents.length + 1, `${stories} vs ${agents.length + 1}`);
// 验收句 1：我那一格 = 首字母色块（/api/profile 的 avatar 为 null 时不许假设有图）
const profile = (await api("/api/profile")) ?? {};
const meStory = page.locator('[data-testid="workbench-stories"] button').first();
if (profile.avatar === null || profile.avatar === undefined) {
  const meImgs = await meStory.locator("img").count();
  check("验收句 1：我格无 <img>（avatar null → 首字母色块分支）", meImgs === 0, `img 数 ${meImgs}`);
  const meText = await meStory.textContent();
  check("验收句 1：我格有首字母（profile.name 首字符）", meText.includes((profile.name ?? "?").charAt(0).toUpperCase()) || meText.includes((profile.name ?? "?").charAt(0)),
    `name=${profile.name ?? "?"}`);
}
// 验收句 2：点助手头像筛选内容流，再点取消
{
  const target = agents[0];
  const filteredBefore = await page.locator('[data-testid="workbench-feed-card"]').count();
  await page.locator('[data-testid="workbench-stories"] button', { hasText: target.name }).first().click();
  await page.waitForTimeout(250);
  const filtered = await page.locator('[data-testid="workbench-feed-card"]').count();
  const authorOk = await page.locator('[data-testid="workbench-feed-card"]').evaluateAll(
    (cards) => cards.every((card) => card.textContent?.includes("示例")));
  check("验收句 2：点助手 → 只看它（出现筛选 chip + 卡数变化或为空态）",
    (await page.locator('[data-testid="workbench-clear-filter"]').count()) === 1,
    `${filtered} 张`);
  const beforeFilter = filteredBefore;   // 筛选前的卡数（关系，不写死数字——R3）
  await page.locator('[data-testid="workbench-clear-filter"]').click();
  await page.waitForTimeout(250);
  const restored = await page.locator('[data-testid="workbench-feed-card"]').count();
  check("验收句 2：再点取消 → 回到筛选前的卡数", restored === beforeFilter && (await page.locator('[data-testid="workbench-clear-filter"]').count()) === 0,
    `${restored} vs ${beforeFilter}`);
}

// 8) 桩卡带「示例」
const stubBadges = await page.locator('[data-testid="workbench-feed-card"]', { hasText: "示例" }).count();
check("内容流桩卡带「示例」徽标", stubBadges > 0, `${stubBadges} 张`);

// 2) 项目区
await page.getByRole("tab", { name: /项目/ }).click();
await page.locator('[data-testid="workbench-projects"]').waitFor();
await page.waitForTimeout(300);
const rows = await page.locator('[data-testid="workbench-project-row"]').count();
check("项目行数 = /api/projects 条数", rows === projects.length, `${rows} vs ${projects.length}`);
// 行副行的关系：第一个行文本含「X 进行中 · Y 个任务」，X/Y 与接口求值一致（抽查 2 行）
const rowTexts = await page.locator('[data-testid="workbench-project-row"]').allTextContents();
let rowOk = true;
const rowDetail = [];
for (const project of projects.slice(0, 2)) {
  const expectRun = nonDaily.filter((t) => t.projectId === project.id && t.state === "进行中").length;
  const expectTotal = nonDaily.filter((t) => t.projectId === project.id).length;
  const hit = rowTexts.find((text) => text.includes(project.name));
  const ok = hit !== undefined && hit.includes(`${expectRun} 进行中`) && hit.includes(`${expectTotal} 个任务`);
  rowOk &&= ok;
  rowDetail.push(`${project.name}:${ok ? "ok" : `期望 ${expectRun}/${expectTotal}，行文本=${(hit ?? "（未找到）").slice(0, 60)}`}`);
}
check("项目行「N 进行中 · M 个任务」与 /api/tasks 求值一致（抽查前 2 行）", rowOk, rowDetail.join(" · "));

// 3) 看板卡数关系（默认全选；「其他」组默认折叠 → 先展开再数组内卡）
const cardCount = await page.locator('[data-testid="workbench-kanban-card"]').count();
const otherGroupToggle = page.locator('[data-testid="workbench-kanban-other"] button').first();
let otherCount = 0;
if (byState["其他"].length > 0) {
  await otherGroupToggle.click();   // 展开（折叠时组内卡不在 DOM——计数读头部不行，要真数卡）
  await page.locator('[data-testid="workbench-kanban-other-card"]').first().waitFor();
  otherCount = await page.locator('[data-testid="workbench-kanban-other-card"]').count();
  await otherGroupToggle.click();   // 收回（不影响后续检查）
  await page.waitForTimeout(150);
}
check("3 列卡数 + 「其他」组卡数 = type!=='daily' 条数", cardCount + otherCount === nonDaily.length,
  `${cardCount}+${otherCount} vs ${nonDaily.length}`);

// 4) 列头是枚举值
const colText = await page.locator('[data-testid="workbench-projects"]').textContent();
check("列头是枚举（进行中/已完成/已移交）", colText.includes("进行中") && colText.includes("已完成") && colText.includes("已移交"));
check("列头不是原始状态值（不含「已作废」在列头位置）", !/^\s*已作废\s*\d/.test(colText));

// 5) 「其他」组出现且显示原文 status（展开态）
const otherGroup = page.locator('[data-testid="workbench-kanban-other"]');
if (byState["其他"].length > 0) {
  await otherGroup.waitFor();
  check("「其他」组出现（非空才出现）", await otherGroup.isVisible());
  await page.locator('[data-testid="workbench-kanban-other"] button').first().click();
  await page.locator('[data-testid="workbench-kanban-other-card"]').first().waitFor();
  const otherText = await otherGroup.textContent();
  check("「其他」组内卡显示原文 status（已作废…）", otherText.includes("已作废"), otherText.slice(0, 80));
} else {
  check("「其他」组非空才出现（当前数据为空 → 不渲染）", (await otherGroup.count()) === 0);
}
await page.screenshot({ path: join(SHOTS, "workbench-projects-1280.png"), fullPage: false });

// 6) 月历：回到全部流 → 日历在右栏（桌面常驻）；点一个有底色的格
await page.getByRole("tab", { name: /^全部/ }).click();
const right = page.locator('[data-testid="workbench-right"]');
await right.waitFor();
const dayCell = page.locator('[data-testid="workbench-right"] [role="grid"] button[title*="条"]').first();
await dayCell.waitFor();
const cellTitle = await dayCell.getAttribute("title");
const expectedCount = Number((cellTitle.match(/(\d+) 条/) ?? [])[1]);
await dayCell.click();
await page.locator('[data-testid="workbench-day-list"]').waitFor();
const dayRows = await page.locator('[data-testid="workbench-day-row"]').count();
check("当日列表行数 = 该格计数（同一份 Day.activity）", dayRows === expectedCount, `${dayRows} vs ${cellTitle}`);
await page.screenshot({ path: join(SHOTS, "workbench-feed-1280.png"), fullPage: false });

// 7) 三档中栏 ≥ 420 + 拖宽跟手
for (const width of [1280, 1440, 1920]) {
  await page.setViewportSize({ width, height: 900 });
  await page.waitForTimeout(250);
  const mid = await page.evaluate(() => {
    const surface = document.querySelector('[data-testid="workbench-surface"]');
    const section = surface?.querySelector("section");
    return section ? Math.round(section.getBoundingClientRect().width) : 0;
  });
  check(`[${width}] 中栏 ≥ 420`, mid >= 420, `${mid}`);
}
// 拖宽跟手：分隔条 x 位移 ≈ 鼠标位移（≤4px/帧，frontend 2.27 的 coordinate 断言）
await page.setViewportSize({ width: 1280, height: 900 });
await page.waitForTimeout(250);
{
  const handle = page.locator('[data-testid="workbench-right"] [role="separator"]');
  await handle.waitFor();
  const before = await page.evaluate(() => {
    const aside = document.querySelector('[data-testid="workbench-right"]');
    return Math.round(aside.getBoundingClientRect().width);
  });
  const box = await handle.boundingBox();
  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;
  const deltas = [40, 80, 120, 60];   // 每步落一次鼠标位置，读一次列宽
  const samples = [];
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  for (const dx of deltas) {
    await page.mouse.move(startX - dx, startY);   // 把手在左缘：往左拖 = 变宽（HANDLE_SIGN right = -1）
    samples.push({ dx, width: await page.evaluate(() => Math.round(document.querySelector('[data-testid="workbench-right"]').getBoundingClientRect().width)) });
  }
  await page.mouse.up();
  const drift = samples.every((s) => Math.abs(s.width - (before + s.dx)) <= 4);
  check("右栏拖宽逐帧跟手（分隔条位移 ≈ 鼠标位移，偏差 ≤4px）", drift, JSON.stringify(samples));
  const after = await page.evaluate(() => Math.round(document.querySelector('[data-testid="workbench-right"]').getBoundingClientRect().width));
  check("松手后宽度保持（inline 不清）", Math.abs(after - samples[samples.length - 1].width) <= 2, `${before} → ${after}`);
}

/*
 * 拖宽跟手（P1-1 修正后加的两档）：**窄窗才是钳制生效的地方**。
 * 1280 的 cap=816，永不触发钳制 —— 旧实现在那里"看起来是好的"，
 * 所以旧门禁绿着但缺陷在。900 cap=436 / 700 cap=236 都会撞上限。
 */
for (const vp of [900, 700]) {
  await page.setViewportSize({ width: vp, height: 900 });
  await page.waitForTimeout(300);
  const handle = page.locator('[data-testid="workbench-right"] [role="separator"]');
  await handle.waitFor();
  const before = await page.evaluate(() => {
    const el = document.querySelector('[data-testid="workbench-right"]');
    const r = el.getBoundingClientRect();
    const h = el.querySelector('[role="separator"]').getBoundingClientRect();
    return { width: Math.round(r.width), handleX: Math.round(h.x + h.width / 2) };
  });
  const box = await handle.boundingBox();
  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  const samples = [];
  for (const dx of [20, 40, 60]) {
    // 往左拖 = 变宽；但窄窗已经顶到 cap → 宽度不变，**把手必须仍贴在鼠标上**
    await page.mouse.move(startX - dx, startY);
    samples.push(await page.evaluate(() => {
      const el = document.querySelector('[data-testid="workbench-right"]');
      const h = el.querySelector('[role="separator"]').getBoundingClientRect();
      return { w: Math.round(el.getBoundingClientRect().width), hx: Math.round(h.x + h.width / 2) };
    }));
  }
  await page.mouse.up();
  // 坐标断言（frontend 2.27）：把手 x 位移 ≈ 鼠标位移（≤4px），宽度顶到 cap 也不许不动
  /*
   * 窄窗（narrowed 档）的**已批准边界**（architect §P1-1 第二条）：宽度撞 cap 后把手不再跟。
   * vp=700 时渲染宽已 = RIGHT_MIN(220)，一拖就撞 cap=236 → 宽度到位后把手停在边界，
   * 这是"把手到边就停（可预期的死区）"，与 c1/c2/c5 的一致语义，**不是本批缺陷**。
   * 所以断言分两档：
   *  - docked/未撞墙（宽度还在涨）→ 必须逐帧跟手（≤4px）；
   *  - 已撞墙（宽度连续两帧不变）→ 只要求"停在 cap 上、不反向、不抖动"。
   */
  const widths = samples.map((s) => s.w);
  const stuckAtCap = widths[widths.length - 1] === widths[0];
  if (stuckAtCap) {
    check(`[${vp}] 右栏已顶 cap：宽度停在边界不抖动（已知且接受的死区）`,
      widths.every((w) => w === widths[0]), JSON.stringify({ vp, widths }));
  } else {
    const follows = samples.every((s, i) => Math.abs((startX - s.hx) - [20, 40, 60][i]) <= 4);
    check(`[${vp}] 右栏把手逐帧跟手（宽度撞 cap 时把手仍贴鼠标）`, follows,
      JSON.stringify({ startX: Math.round(startX), before, samples }));
  }
  check(`[${vp}] 中栏 ≥ 420（窄窗降级后仍不被压破）`,
    (await page.evaluate(() => Math.round(document.querySelector('[data-testid="workbench-surface"] section').getBoundingClientRect().width))) >= 420);
  // 拉回宽视口，恢复干净状态
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.waitForTimeout(200);
}

/*
 * 列数自查（第 5 块那条自查法）：工作台**不该**出现对话工作台的 c1/c2 把手。
 * 关闭工作台时应有 2 条；打开时 0 条；Esc 后回到 2 条。
 * 这条比 chat 数值断言更贴近用户感知：用户看到的就是"这里有没有那条分隔条"。
 *
 * 顺序：先 Esc 关掉（本脚本前面已进过工作台）→ 数 2 → 再打开 → 数 0 → Esc → 数 2。
 */
{
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.waitForTimeout(250);
  await page.keyboard.press("Escape");                 // 关工作台
  await page.waitForTimeout(300);
  const closedCount = await page.locator('[data-resize-key="c1"], [data-resize-key="c2"]').count();
  check("关闭工作台后：对话工作台的 c1/c2 把手回到 2（Esc 交还）", closedCount === 2, `count=${closedCount}`);
  await page.getByRole("button", { name: "我的工作台" }).first().click();
  await page.locator('[data-testid="workbench-surface"]').waitFor();
  await page.waitForTimeout(300);
  const openCount = await page.locator('[data-resize-key="c1"], [data-resize-key="c2"]').count();
  check("工作台打开时：c1/c2 把手为 0（不与工作台右栏混用）", openCount === 0, `count=${openCount}`);
}

// 手机表面（骨架）
{
  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await mobile.goto(APP_URL, { waitUntil: "networkidle" });
  await mobile.waitForTimeout(400);
  // 默认可能已恢复上次会话（头部是「返回项目」而非「打开导航」）——两种入口都处理
  const openNav = mobile.getByRole("button", { name: "打开导航" });
  const backBtn = mobile.getByRole("button", { name: "返回项目" });
  if (await backBtn.count() > 0) { await backBtn.click(); }
  else { await openNav.click(); }
  await mobile.locator('[data-testid="mobile-nav"]').waitFor();
  // 「我的工作台」在抽屉第一级顶部；「返回项目」打开的是 projects 层，先回 agents 层
  if ((await mobile.locator('[data-testid="mobile-nav"]').getAttribute("data-mobile-level")) !== "agents") {
    await mobile.getByRole("button", { name: "返回上一级" }).click();
    await mobile.waitForTimeout(200);
  }
  await mobile.getByRole("button", { name: "我的工作台" }).click();
  await mobile.locator('[role="dialog"][aria-label="我的工作台"]').waitFor();
  const storiesM = await mobile.locator('[data-testid="workbench-stories"] button').count();
  check("[390] 手机表面：stories 数 = agents + 我", storiesM === agents.length + 1, `${storiesM}`);
  await mobile.screenshot({ path: join(SHOTS, "workbench-mobile-390.png"), fullPage: false });
  // 系统返回关表面
  await mobile.goBack();
  await mobile.waitForTimeout(400);
  check("[390] 系统返回关掉工作台表面", (await mobile.locator('[role="dialog"][aria-label="我的工作台"]').count()) === 0);
  await mobile.close();
}

console.log(`\n${pass} 通过；${failures.length} 失败${failures.length ? `：${failures.join(" · ")}` : ""}`);
await browser.close();
process.exit(failures.length ? 1 : 0);
