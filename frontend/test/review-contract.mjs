#!/usr/bin/env node
/**
 * 检视面板契约（Task 0010 · P2）。
 *
 * 为什么有这个文件：2026-11-05 用户实测报「我一左右拖动，你那儿就有问题了」。当时查出的
 * 三个缺陷**全部只有真浏览器拖动才暴露**，纯函数测试与 curl 都是绿的：
 *   ① 拖动只跟手一半（存比例的分母 `视口 − 聊天保底` 与布局的分母 `视口` 不一致）；
 *   ② 拖到上限后往回拉有 163px 死区（比例在涨而像素被 layout 截断）；
 *   ③ 换视口面板自己跳（666px @1680 → 868px @1920，用户没拖）。
 * 所以这里按"用户动作"断言：拖、换屏、开第二个面板、关掉。改坏了必须红。
 *
 * 用法（需要 dev server）：
 *   node frontend/test/review-contract.mjs
 *   APP_URL=http://127.0.0.1:5178 node frontend/test/review-contract.mjs
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const APP_URL = process.env.APP_URL ?? "http://localhost:5173";
const MIN_CHAT = 420;
const MIN_REVIEW = 360;

const PLAYWRIGHT_CANDIDATES = [
  process.env.PLAYWRIGHT_CORE,
  join(HERE, "../node_modules/playwright-core/index.js"),
  join(HERE, "../../node_modules/playwright/index.js"),
  join(homedir(), ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.js"),
  join(homedir(), ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright-core/index.js"),
].filter(Boolean);

async function loadPlaywright() {
  for (const candidate of PLAYWRIGHT_CANDIDATES) {
    if (!existsSync(candidate)) continue;
    const module = await import(candidate);
    return module.default ?? module;
  }
  throw new Error("找不到 playwright：设置 PLAYWRIGHT_CORE=/path/to/playwright-core/index.js");
}

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
}

/**
 * 固定夹具：不依赖真实 worktree 的内容，契约只关心"渲染与几何"。
 * 两组源各含代码/文档/删除线，覆盖 D8 三类徽标与 diff 两色。
 */
const FIXTURE = {
  items: [
    {
      source: { kind: "worktree", path: "/tmp/demo-worktree", exists: true, branch: "dev/demo" },
      files: [
        {
          path: "src/demo.ts", kind: "code", status: "modified", additions: 2, deletions: 1,
          hunks: [{
            oldStart: 1, oldLines: 3, newStart: 1, newLines: 4,
            lines: [
              { type: "context", oldNo: 1, newNo: 1, text: "const a = 1;" },
              { type: "removed", oldNo: 2, newNo: null, text: "const b = 2;" },
              { type: "added", oldNo: null, newNo: 2, text: "const b = 22;" },
              { type: "added", oldNo: null, newNo: 3, text: "const c = 3;" },
              { type: "context", oldNo: 3, newNo: 4, text: "export default a;" },
            ],
          }],
        },
        {
          path: "docs/notes.md", kind: "doc", status: "added", additions: 1, deletions: 0,
          hunks: [{ oldStart: 0, oldLines: 0, newStart: 1, newLines: 1, lines: [{ type: "added", oldNo: null, newNo: 1, text: "# 笔记" }] }],
        },
        {
          // 多 hunk + 大 gap：折叠未改行的主用例（3 处改动，中间隔 90 行/80 行）
          path: "docs/big.md", kind: "doc", status: "modified", additions: 3, deletions: 3,
          hunks: [
            // 每侧 5 行上下文（> minimumLineCount=3，才允许被折）
            { oldStart: 5, oldLines: 11, newStart: 5, newLines: 11, lines: [
              { type: "context", oldNo: 5, newNo: 5, text: "line5" },
              { type: "context", oldNo: 6, newNo: 6, text: "line6" },
              { type: "context", oldNo: 7, newNo: 7, text: "line7" },
              { type: "context", oldNo: 8, newNo: 8, text: "line8" },
              { type: "context", oldNo: 9, newNo: 9, text: "line9" },
              { type: "removed", oldNo: 10, newNo: null, text: "line10-old" },
              { type: "added", oldNo: null, newNo: 10, text: "line10-new" },
              { type: "context", oldNo: 11, newNo: 11, text: "line11" },
              { type: "context", oldNo: 12, newNo: 12, text: "line12" },
              { type: "context", oldNo: 13, newNo: 13, text: "line13" },
              { type: "context", oldNo: 14, newNo: 14, text: "line14" },
              { type: "context", oldNo: 15, newNo: 15, text: "line15" },
            ] },
            { oldStart: 100, oldLines: 11, newStart: 100, newLines: 11, lines: [
              { type: "context", oldNo: 100, newNo: 100, text: "line100" },
              { type: "context", oldNo: 101, newNo: 101, text: "line101" },
              { type: "context", oldNo: 102, newNo: 102, text: "line102" },
              { type: "context", oldNo: 103, newNo: 103, text: "line103" },
              { type: "context", oldNo: 104, newNo: 104, text: "line104" },
              { type: "removed", oldNo: 105, newNo: null, text: "line105-old" },
              { type: "added", oldNo: null, newNo: 105, text: "line105-new" },
              { type: "context", oldNo: 106, newNo: 106, text: "line106" },
              { type: "context", oldNo: 107, newNo: 107, text: "line107" },
              { type: "context", oldNo: 108, newNo: 108, text: "line108" },
              { type: "context", oldNo: 109, newNo: 109, text: "line109" },
              { type: "context", oldNo: 110, newNo: 110, text: "line110" },
            ] },
          ],
        },
      ],
      truncated: false,
      base: { commit: "abcdef1234567", at: "2026-11-01T00:00:00Z" },
    },
    {
      source: { kind: "lifeos", path: "/tmp/demo-lifeos", exists: true },
      files: [
        { path: "tasks/0001/log.md", kind: "doc", status: "modified", additions: 1, deletions: 1, hunks: [{ oldStart: 3, oldLines: 1, newStart: 3, newLines: 1, lines: [{ type: "removed", oldNo: 3, newNo: null, text: "旧" }, { type: "added", oldNo: null, newNo: 3, text: "新" }] }] },
      ],
      truncated: false,
      base: { commit: "1234567abcdef", at: "2026-11-04T00:00:00Z" },
    },
  ],
};

const playwright = await loadPlaywright();
const browser = await playwright.chromium.launch({ headless: true });

/** 新开一页（清 localStorage），并给 review 两个端点打桩。 */
async function openPage(viewport) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  const page = await context.newPage();
  page.on("pageerror", (error) => check(`无页面崩溃（${String(error).slice(0, 60)}）`, false));
  // 夹具：源路径与 diff 内容都固定
  await page.route(/\/api\/review\/diff$/, (route) => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify(FIXTURE),
  }));
  await page.route(/\/review-sources$/, (route) => route.fulfill({
    status: 200, contentType: "application/json",
    body: JSON.stringify({ taskDir: "/tmp/demo-lifeos", items: [{ kind: "worktree", path: "/tmp/demo-worktree" }, { kind: "lifeos", path: "/tmp/demo-lifeos" }] }),
  }));
  await page.route(/review-candidates$/, (route) => route.fulfill({
    status: 200, contentType: "application/json",
    body: JSON.stringify({ items: [
      { taskId: "0017", title: "竞态参照（慢）", taskDir: "/tmp/demo-lifeos-0017", substantive: true },
      { taskId: "0018", title: "竞态目标（快）", taskDir: "/tmp/demo-lifeos-0018", substantive: true },
    ] }),
  }));
  /** diff mock：切 0018 的响应**延迟**（制造在飞）；切 0017 立即返回带标记的变体；其他（初始）立即返回默认。
   *  竞态路径：选 0018（慢）→ 立刻改选 0017（快、先到）→ 0018 晚到 —— 无守卫时晚到者覆盖（撕裂），有守卫时丢弃。 */
  await page.route(/\/api\/review\/diff$/, async (route) => {
    const raw = route.request().postData();
    const body = typeof raw === "string" && raw !== "" ? JSON.parse(raw) : {};
    const variantOf = (marker) => {
      const variant = JSON.parse(JSON.stringify(FIXTURE));
      const lifeos = variant.items.find((item) => item.source.kind === "lifeos");
      if (lifeos !== undefined) lifeos.source.path = marker;
      return variant;
    };
    if (body.taskDir === "/tmp/demo-lifeos-0018") {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(variantOf("/tmp/demo-lifeos-0018")) });
      return;
    }
    if (body.taskDir === "/tmp/demo-lifeos-0017") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(variantOf("/tmp/demo-lifeos-0017")) });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(FIXTURE) });
  });
  await page.goto(APP_URL, { waitUntil: "domcontentloaded" });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);
  return page;
}

const panel = (page) => page.locator('[data-testid="review-aside"]');

/**
 * 读某 Task 的服务端评论（S4-b 之后评论不在 localStorage）。
 * 用 Playwright 在页面上下文 fetch，确保走同一个 dev 后端（含代理）。
 */
/**
 * 等服务端评论满足条件（store 写是异步的：POST → 重读 → 渲染）。
 * 固定 waitForTimeout 在机器慢时会假红；这里轮询到条件成立或超时。
 */
async function waitForComments(page, predicate, timeoutMs = 6000) {
  const deadline = Date.now() + timeoutMs;
  let last = [];
  while (Date.now() < deadline) {
    last = await page.evaluate(async () => {
      const taskDir = document.querySelector("[data-review-task-dir]")?.value ?? "";
      if (taskDir === "") return [];
      const r = await fetch(`/api/review/comments?taskDir=${encodeURIComponent(taskDir)}`);
      return r.ok ? ((await r.json()).items ?? []) : [];
    });
    if (predicate(last)) return last;
    await page.waitForTimeout(150);
  }
  return last;
}

async function serverComments(page) {
  return await page.evaluate(async () => {
    const taskDir = document.querySelector("[data-review-task-dir]")?.value ?? "";
    if (taskDir === "") return [];
    const response = await fetch(`/api/review/comments?taskDir=${encodeURIComponent(taskDir)}`);
    if (!response.ok) return [];
    return ((await response.json()).items ?? []);
  });
}

/** 当前几何：检视宽 / 聊天宽 / 文件面板宽 / 是否横向溢出 / 存的比例 */
async function geometry(page) {
  return await page.evaluate(() => {
    const widthOf = (el) => (el === null ? 0 : Math.round(el.getBoundingClientRect().width));
    const review = document.querySelector('[data-testid="review-aside"]');
    const main = document.querySelector("main");
    // 文件面板 = 没有 testid 的那个 aside（历史/检视都有 testid）
    const panelAside = [...document.querySelectorAll("aside")].find((a) => a.dataset.testid === undefined && a.className.includes("shrink-0"));
    return {
      review: widthOf(review),
      chat: widthOf(main),
      file: widthOf(panelAside ?? null),
      overflow: document.documentElement.scrollWidth - window.innerWidth,
      ratio: Number(localStorage.getItem("lifeos.reviewRatio")) || 0,
    };
  });
}

/** 拖检视面板左缘把手：dx > 0 向右（变小），< 0 向左（变大）。 */
async function dragReview(page, dx, steps = 18) {
  const box = await panel(page).boundingBox();
  if (box === null) return false;
  const y = Math.min(box.y + box.height / 2, box.y + 400);
  await page.mouse.move(box.x - 2, y);
  await page.mouse.down();
  await page.mouse.move(box.x - 2 + dx, y, { steps });
  await page.waitForTimeout(150);
  await page.mouse.up();
  await page.waitForTimeout(250);
  return true;
}

/**
 * 确保所有文件卡都展开。
 * 注意：首屏默认在文件数 ≤5 时**已经全展开**，此时 `[data-review-toggle-all]` 的
 * `aria-pressed` 为 "true"，再点会全部折叠（踩过：折叠条断言因此拿到 0 条）。
 */
async function ensureAllOpen(page) {
  const toggle = page.locator("[data-review-toggle-all]").first();
  if ((await toggle.count()) === 0) return false;
  if ((await toggle.getAttribute("aria-pressed")) !== "true") {
    await toggle.click();
    await page.waitForTimeout(700);
  }
  return true;
}

/**
 * 打开检视面板。
 *
 * `clean`（默认 true）：先清空该 Task 在**服务端**的评论再重新打开。
 * 为什么需要：S4-b 之后评论落在后端，跨浏览器上下文/跨测试块都会累积——
 * 不清就会看到"上一个用例留下的针"（这是测试隔离问题，不是实现问题）。
 * 需要验证"持久化"的用例传 `{ clean: false }`（重开时不能清）。
 */
async function openReview(page, options = {}) {
  const clean = options.clean !== false;
  const button = page.getByRole("button", { name: "检视当前 Task 的改动" }).first();
  if ((await button.count()) === 0) return false;
  await button.click();
  await page.waitForSelector('[data-testid="review-aside"]', { timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(600);
  if (clean) {
    const cleared = await page.evaluate(async () => {
      const taskDir = document.querySelector("[data-review-task-dir]")?.value ?? "";
      if (taskDir === "") return false;
      const res = await fetch("/api/review/comments", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ taskDir, op: "clear" }),
      });
      return res.ok;
    });
    if (cleared) {
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.waitForTimeout(1500);
      await page.getByRole("button", { name: "检视当前 Task 的改动" }).first().click();
      await page.waitForSelector('[data-testid="review-aside"]', { timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(600);
    }
  }
  return (await panel(page).count()) > 0;
}

// ── 1. 渲染：两组源、三类徽标、diff 两色、双行号 ────────────────────────────────
{
  const page = await openPage({ width: 1680, height: 1000 });
  const opened = await openReview(page);
  check("点「检视当前 Task 的改动」后面板出现", opened);
  if (opened) {
    const shape = await page.evaluate(() => {
      const root = document.querySelector('[data-testid="review-aside"]');
      const diffLine = (type) => root.querySelector(`[data-review-diff] [data-line="${type}"]`);
      const colorsOf = (el) => (el === null ? null : getComputedStyle(el).backgroundColor);
      const line = diffLine("added");
      const cells = line === null ? [] : [...line.children].map((c) => c.textContent);
      return {
        sources: [...root.querySelectorAll("[data-review-source]")].map((s) => s.dataset.reviewSource),
        fileCount: root.querySelectorAll("[data-review-file]").length,
        hunkHeads: root.querySelectorAll("[data-hunk]").length,
        addedBg: colorsOf(diffLine("added")),
        removedBg: colorsOf(diffLine("removed")),
        contextBg: colorsOf(diffLine("context")),
        // 双行号：旧号 / 新号两列（新增行只有一个号）
        // 行号槽现在可能含悬停的「＋」按钮文本，去掉它再断言（按钮是 S2·A5 的批注入口）
        addedNumbers: cells.slice(1, 3).map((t) => t.replace("＋", "").trim()),
        count: root.querySelector('[data-review-count]')?.textContent ?? "",
      };
    });
    check("两组源都在（项目 worktree + Task 文档）",
      shape.sources.includes("worktree") && shape.sources.includes("lifeos"), shape.sources.join(","));
    check("文件与 hunk 都渲染", shape.fileCount === 4 && shape.hunkHeads === 5, `文件 ${shape.fileCount} / hunk ${shape.hunkHeads}`);
    // 文件头主显 basename（0018）：长嵌套路径 truncate 时文件名仍可见，目录尾段次显
    const headText = await page.evaluate(() => {
      const card = document.querySelector("[data-review-file]");
      return card?.querySelector("button")?.textContent ?? "";
    });
    check("文件头主显文件名（basename），目录尾段次显",
      headText.includes("demo.ts") && headText.includes("src/"), headText.slice(0, 120));
    check("增/删/上下文三种行底色互不相同",
      shape.addedBg !== shape.removedBg && shape.addedBg !== shape.contextBg && shape.removedBg !== shape.contextBg,
      `${shape.addedBg} / ${shape.removedBg} / ${shape.contextBg}`);
    check("新增行显示新行号（双行号槽，旧号留空）", shape.addedNumbers[1] === "2", JSON.stringify(shape.addedNumbers));
    check("头部计数 = 4 个文件", shape.count.trim() === "4", shape.count);

    const a11y = await page.evaluate(() => {
      const root = document.querySelector('[data-testid="review-aside"]');
      return [...root.querySelectorAll("button")].map((b) => ({
        name: b.getAttribute("aria-label") ?? b.textContent.trim().slice(0, 20),
        box: b.getBoundingClientRect().width,
      }));
    });
    check("面板内每个按钮都有可访问名", a11y.every((item) => item.name !== ""), JSON.stringify(a11y.filter((i) => i.name === "")));

    const scroller = await page.evaluate(() => {
      const s = document.querySelector('[data-review-scroll]');
      return s === null ? null : { sw: s.scrollWidth, cw: s.clientWidth };
    });
    check("面板内容不产生横向滚动（长行折行而不是撑破）",
      scroller !== null && scroller.sw <= scroller.cw + 1, JSON.stringify(scroller));

    // 面板根必须填满 aside：2026-11-05 用户截图里右半边全是空白（宽屏 183–397px 浪费）
    const fill = await page.evaluate(() => {
      const aside = document.querySelector('[data-testid="review-aside"]');
      const panel = document.querySelector('[data-testid="review-panel"]');
      const scroll = document.querySelector('[data-review-scroll]');
      if (aside === null || panel === null || scroll === null) return null;
      return {
        aside: Math.round(aside.getBoundingClientRect().width),
        panel: Math.round(panel.getBoundingClientRect().width),
        scroll: Math.round(scroll.getBoundingClientRect().width),
        card: Math.round((document.querySelector("[data-review-file]")?.getBoundingClientRect().width ?? 0)),
      };
    });
    check("面板内容填满检视列（根不收缩，右侧不留白）",
      fill !== null && Math.abs(fill.aside - fill.panel) <= 1 && fill.scroll >= fill.aside - 20,
      JSON.stringify(fill));
  }
  await page.context().close();
}

// ── 1a. 批量展开/折叠 + 文件筛选（对齐 GitHub PR 与 opencode 的功能点）────────────
{
  const page = await openPage({ width: 1680, height: 1000 });
  const opened = await openReview(page);
  if (opened) {
    const read = () => page.evaluate(() => {
      const files = [...document.querySelectorAll("[data-review-file] > button")];
      const toggle = document.querySelector("[data-review-toggle-all]");
      return {
        total: files.length,
        expanded: files.filter((b) => b.getAttribute("aria-expanded") === "true").length,
        toggle: toggle === null ? null : { pressed: toggle.getAttribute("aria-pressed"), label: toggle.getAttribute("aria-label") },
      };
    });
    const first = await read();
    check("存在「全部展开 / 全部折叠」按钮", first.toggle !== null, JSON.stringify(first));
    // 点一次：全部反向
    await page.click("[data-review-toggle-all]");
    await page.waitForTimeout(400);
    const flipped = await read();
    check(`点「全部…」一次：所有文件状态一起翻转（${first.expanded} → ${flipped.expanded}）`,
      flipped.expanded === first.total - first.expanded, `共 ${first.total}`);
    check("按钮文案随状态切换（展开 ↔ 折叠互为反义）",
      flipped.toggle !== null && flipped.toggle.label !== first.toggle?.label, `${first.toggle?.label} → ${flipped.toggle?.label}`);
    // 再点一次回原状
    await page.click("[data-review-toggle-all]");
    await page.waitForTimeout(400);
    check("再点一次回到原状（幂等往返）", (await read()).expanded === first.expanded);
    // 单独折叠一个 → 按钮提示应变成「全部展开」（说明不是恒真）
    await page.click("[data-review-file] > button");
    await page.waitForTimeout(300);
    const one = await read();
    check("单独折叠一个文件后按钮变为「全部展开」",
      one.toggle !== null && one.toggle.label === "全部展开" && one.toggle.pressed === "false", JSON.stringify(one.toggle));

    // 筛选：按路径子串
    await page.fill("[data-review-filter]", "demo");
    await page.waitForTimeout(300);
    const filtered = await page.evaluate(() => [...document.querySelectorAll("[data-review-file]")].map((f) => f.dataset.reviewFile));
    check("筛选按路径子串命中", filtered.length > 0 && filtered.every((p) => p.includes("demo")), JSON.stringify(filtered));
    await page.fill("[data-review-filter]", "zzz-不存在");
    await page.waitForTimeout(300);
    const none = await page.evaluate(() => ({ files: document.querySelectorAll("[data-review-file]").length, empty: document.querySelectorAll("[data-review-filter-empty]").length }));
    check("筛选无命中时给出可见空态（不是静默空白）", none.files === 0 && none.empty > 0, JSON.stringify(none));
    await page.fill("[data-review-filter]", "");
    await page.waitForTimeout(300);
    check("清空筛选后文件全回来", (await page.evaluate(() => document.querySelectorAll("[data-review-file]").length)) === first.total);
  }
  await page.context().close();
}

// ── 1b. 宽屏填充：面板根必须跟随列宽（2026-11-05 用户截图：右半边空白）────────────
{
  for (const width of [2033, 2560, 3200]) {
    const page = await openPage({ width, height: 800 });
    const opened = await openReview(page);
    if (opened) {
      const g = await page.evaluate(() => {
        const aside = document.querySelector('[data-testid="review-aside"]');
        const panel = document.querySelector('[data-testid="review-panel"]');
        const cards = [...document.querySelectorAll("[data-review-file]")].map((c) => Math.round(c.getBoundingClientRect().width));
        if (aside === null || panel === null) return null;
        const a = Math.round(aside.getBoundingClientRect().width);
        const p = Math.round(panel.getBoundingClientRect().width);
        return { aside: a, panel: p, blank: a - p, cards, viewport: window.innerWidth };
      });
      check(`[${width}] 检视面板填满列宽（右侧留白 ≤ 1px）`, g !== null && g.blank <= 1, JSON.stringify(g));
      check(`[${width}] 文件卡跟随列宽（不被固定 max-w 卡住）`,
        g !== null && g.cards.length === 0 || g.cards.every((w) => w >= g.aside - 40), JSON.stringify(g?.cards));
    }
    await page.context().close();
  }
}

// ── 2. 拖动：1:1 跟手、无死区、比例与像素同源 ──────────────────────────────────
{
  const page = await openPage({ width: 1680, height: 1000 });
  const opened = await openReview(page);
  if (opened) {
    const g0 = await geometry(page);
    await dragReview(page, -100);
    const g1 = await geometry(page);
    check(`左拖 100px → 面板宽 +100（实际 ${g0.review} → ${g1.review}）`, g1.review - g0.review === 100, `差 ${g1.review - g0.review}`);

    await dragReview(page, 250);
    const g2 = await geometry(page);
    check(`右拖 250px → 面板宽 −250（实际 ${g1.review} → ${g2.review}）`, g1.review - g2.review === 250, `差 ${g1.review - g2.review}`);

    // 拖到上限：宽度停在预算，比例不得继续涨
    await dragReview(page, -999);
    const g3 = await geometry(page);
    check("拖到上限后聊天仍 ≥ 保底（不压破对话区）", g3.chat >= MIN_CHAT, `聊天 ${g3.chat}`);
    // 2026-11-05 用户拍板：没有绝对像素上限，唯一上限是"对话保底 420"（= 右侧预算）
    // 预算 = 视口 − 图标轨 44 − 列 232/300 − 两个把手 12 − 检视把手 6 − 对话保底 420 = 666
    const budget = 1680 - 44 - 232 - 300 - 12 - 6 - MIN_CHAT;
    check("拖到上限 = 右侧预算（没有额外像素上限）", Math.abs(g3.review - budget) <= 2,
      `检视 ${g3.review} / 聊天 ${g3.chat} / 期望上限 ${budget}`);
    // 上限处比例必须等于"看见的宽度 / 视口"（旧实现这里分叉，导致死区与跳变）
    check("保存的比例 = 看见的宽度 ÷ 视口（同一把尺子）",
      Math.abs(g3.ratio - g3.review / 1680) < 0.005, `ratio ${g3.ratio.toFixed(4)} vs ${(g3.review / 1680).toFixed(4)}`);

    // 死区：从上限回拉 1px 必须立刻变窄
    await dragReview(page, 1, 2);
    const g4 = await geometry(page);
    check(`到顶后回拉 1px 立即生效（${g3.review} → ${g4.review}，无死区）`, g4.review === g3.review - 1 || g4.review === g3.review - 2,
      `差 ${g3.review - g4.review}px`);

    // 拖动后仍然填满（不能只在默认宽度下对）
    const filled = await page.evaluate(() => {
      const aside = document.querySelector('[data-testid="review-aside"]');
      const panel = document.querySelector('[data-testid="review-panel"]');
      if (aside === null || panel === null) return null;
      return { aside: Math.round(aside.getBoundingClientRect().width), panel: Math.round(panel.getBoundingClientRect().width) };
    });
    check("拖动后内容仍填满列（比默认宽时也不留白）",
      filled !== null && Math.abs(filled.aside - filled.panel) <= 1, JSON.stringify(filled));

    // 换屏：严格等比例，不跳变
    await page.setViewportSize({ width: 1920, height: 1000 });
    await page.waitForTimeout(700);
    const g5 = await geometry(page);
    const expected = Math.round(1920 * g4.ratio);
    check(`1680 → 1920 视口：按比例换算（期望 ≈ ${expected}，实际 ${g5.review}）`,
      Math.abs(g5.review - expected) <= 2, `${g5.review} vs ${expected}`);
    check("换屏后聊天仍 ≥ 保底、无横向溢出", g5.chat >= MIN_CHAT && g5.overflow <= 1, `聊天 ${g5.chat} 溢出 ${g5.overflow}`);
    await page.setViewportSize({ width: 1680, height: 1000 });
    await page.waitForTimeout(600);
  }
  await page.context().close();
}

// ── 3. 并存：与文件面板同开（D10），关掉检视后文件面板回原宽 ──────────────────────
{
  const page = await openPage({ width: 1680, height: 1000 });
  const opened = await openReview(page);
  if (opened) {
    const before = await geometry(page);
    const fileButton = page.getByRole("button", { name: "展开文件面板" }).first();
    if ((await fileButton.count()) > 0) {
      await fileButton.click();
      await page.waitForTimeout(1200);
      const both = await geometry(page);
      check("检视与文件面板可同时打开（D10 并存不互斥）", both.review > 0 && both.file > 0,
        `检视 ${both.review} / 文件 ${both.file}`);
      check("两面板同开时聊天仍 ≥ 保底", both.chat >= MIN_CHAT, `聊天 ${both.chat}`);
      check("两面板同开无横向溢出", both.overflow <= 1, `溢出 ${both.overflow}`);
      check("检视不小于最小宽", both.review >= MIN_REVIEW || both.review === 0, `${both.review}`);
      void before;
    }
  }
  await page.context().close();
}

// ── 3b. 无绝对上限：2560 视口能拖过 1200px（2026-11-05 用户：没必要限制）────────────
{
  const page = await openPage({ width: 2560, height: 900 });
  const opened = await openReview(page);
  if (opened) {
    await dragReview(page, -999, 20); // 一路往左拖到底
    const g = await geometry(page);
    check(`2560 视口：检视宽度可超过 1200px（实际 ${g.review}px）`, g.review > 1200, `${g.review}px`);
    check("2560 拖到底后对话仍 ≥ 保底", g.chat >= MIN_CHAT, `聊天 ${g.chat}`);
    check("2560 拖到底后无横向溢出", g.overflow <= 1, `溢出 ${g.overflow}`);
  }
  await page.context().close();
}

// ── 3.5 折叠未改行（S1·G1b）：标准/仅改动两档 + 三向展开 + blob 按需取 ────────────
{
  const page = await openPage({ width: 1680, height: 1000 });
  const opened = await openReview(page);
  check("S1·折叠：面板出现", opened);
  if (opened) {
    // 展开所有文件卡，让 diff 体可见
    await ensureAllOpen(page);
    const card = page.locator('[data-review-file="docs/big.md"]');
    check("S1·折叠：多 hunk 文件卡存在", (await card.count()) === 1);

    const bars = () => card.locator("[data-review-hidden]").evaluateAll((els) =>
      els.map((e) => ({ region: e.dataset.reviewHidden, count: Number(e.dataset.hiddenCount), text: e.textContent })));

    // 标准档（默认）：hunk 内上下文直接显示，只有 gap 折叠
    const std = await bars();
    const gapOf = (list) => list.find((b) => b.region === "gap");
    check("S1·折叠：默认「上下文 3 行」档只折 gap（hunk 内上下文可见、文件头尾不折）",
      std.length === 1 && std[0].region === "gap",
      JSON.stringify(std.map((b) => `${b.region}:${b.count}`)));
    check("S1·折叠：gap 行数 = 100 − (5+11) = 84", gapOf(std)?.count === 84, `count=${gapOf(std)?.count}`);
    check("S1·折叠：折叠条报数字（用户看得见有多少行没显示）",
      gapOf(std)?.text.includes("84") === true, gapOf(std)?.text ?? "");
    const stdVisible = await card.locator("[data-line]").count();
    check("S1·折叠：上下文 3 行档可见行 = 两个 hunk 的全部行（24）", stdVisible === 24, `${stdVisible}`);

    // 三向按钮：gap 93 > 20 → 上/下/全部
    const gapBar = card.locator('[data-review-hidden="gap"]').first();
    check("S1·折叠：大 gap 给「↑20行」「↓20行」「全部」三向",
      (await gapBar.locator('[data-review-expand="up"]').count()) === 1
      && (await gapBar.locator('[data-review-expand="down"]').count()) === 1
      && (await gapBar.locator('[data-review-expand="all"]').count()) === 1);

    // 展示"仅改动行"档：连 hunk 内上下文也折 → 折叠条变多
    await page.getByRole("button", { name: "仅改动行" }).click();
    await page.waitForTimeout(600);
    const diffMode = await bars();
    check("S1·折叠：「仅改动行」档折叠条增多（hunk 内上下文也被折）",
      diffMode.length > std.length, `${std.length} → ${diffMode.length}`);
    // 用户视角关键点：hunk 内被折的上下文必须与相邻 gap **合成一条**，否则一堆「5 行未修改」把改动淹没
    // 本夹具：头 4 + [前上下文 5 + gap 84 + 后上下文 5 合成 94] + [前 5 + gap 74 + 后 5 合成 84] …共 3 条
    // 真实几何（hunk 头会隔断合并，这是正确行为：跨 hunk 的段不能焊在一起，否则行号对不上）
    //   head:4（文件头）· hunk:5（h1 改动前的 5 行）· gap:89（h1 改动后 5 行 + gap 84，合并）· hunk:5 · hunk:5
    check("S1·折叠：hunk 内上下文与相邻 gap 合并（改动后的 5 行并入 gap → 89）",
      diffMode.some((b) => b.region === "gap" && b.count === 89),
      JSON.stringify(diffMode.map((b) => `${b.region}:${b.count}`)));
    check("S1·折叠：hunk 头两侧不合并（跨 hunk 合并会让行号对不上）",
      diffMode.filter((b) => b.region === "hunk").length === 3,
      JSON.stringify(diffMode.map((b) => `${b.region}:${b.count}`)));
    const diffVisible = await card.locator("[data-line]").count();
    check("S1·折叠：「仅改动行」档可见行只剩 +/- 行（2 删 + 2 增 = 4）", diffVisible === 4, `${diffVisible}`);

    // 回标准档，测展开：up 20 行（gap 需要 blob 接口，夹具里拦截返回全文）
    await page.getByRole("button", { name: "上下文 3 行" }).click();
    await page.waitForTimeout(500);
    await page.route(/\/api\/review\/blob/, (route) => {
      // 造 200 行全文：第 n 行 = "line<n>"
      const body = Array.from({ length: 200 }, (_, i) => `line${i + 1}`).join("\n") + "\n";
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ content: body, truncated: false }) });
    });
    await card.locator('[data-review-hidden="gap"]').first().locator('[data-review-expand="up"]').click();
    await page.waitForTimeout(900);
    const afterUp = await bars();
    check("S1·折叠：点「↑20行」后 gap 减 20（84 → 64）",
      gapOf(afterUp)?.count === 64, JSON.stringify(afterUp.map((b) => `${b.region}:${b.count}`)));
    const expandedRows = await card.locator('[data-line]').count();
    check("S1·折叠：展开的 20 行真的渲染出来了（24 → 44）", expandedRows === 44, `${expandedRows}`);
    const leak = await page.locator("[data-review-expand-error]").count();
    check("S1·折叠：展开无错误提示", leak === 0, `${leak}`);

    // 全部展开该段
    await card.locator('[data-review-hidden="gap"]').first().locator('[data-review-expand="all"]').click();
    await page.waitForTimeout(900);
    const afterAll = await bars();
    /**
     * 行为在 G14（2026-11-08）**有意改变**：
     * 早先点「全部」后折叠条消失 —— 那就再也折不回去了（用户指出的缺口）。
     * 现在折叠条保留，文案变「已全部展开」，只留「折叠」按钮（VS Code `:438-441` 同判）。
     */
    const gapAfterAll = afterAll.find((b) => b.region === "gap");
    check("S1/G14·折叠：点「全部」后折叠条保留（可折回），文案变「已全部展开」",
      gapAfterAll !== undefined && gapAfterAll.text.includes("已全部展开"),
      JSON.stringify(afterAll.map((b) => `${b.region}:${b.count}:${b.text.slice(0, 20)}`)));

    // 刷新后折叠状态重置（difit：diff identity 变即清空）
    await page.locator('button[aria-label="重新加载 diff"]').click();
    await page.waitForTimeout(1200);
    const afterReload = await bars();
    check("S1·折叠：刷新后展开状态重置（gap 回到 84 行原始折叠态）",
      gapOf(afterReload)?.count === 84, JSON.stringify(afterReload.map((b) => `${b.region}:${b.count}`)));
  }
  await page.context().close();
}

// ── 3.6 折行按类型（S1·R6）：代码不折（可横滚）/ 文档折行 ─────────────────────────
{
  const page = await openPage({ width: 1680, height: 1000 });
  const opened = await openReview(page);
  if (opened) {
    await ensureAllOpen(page);
    const shape = await page.evaluate(() => {
      const wrapOf = (path) => {
        const body = document.querySelector(`[data-review-diff="${path}"]`);
        if (body === null) return null;
        const text = body.querySelector("[data-review-line-text]");
        const cs = text === null ? null : getComputedStyle(text);
        return { mode: body.dataset.reviewWrap, whiteSpace: cs?.whiteSpace ?? null };
      };
      return { code: wrapOf("src/demo.ts"), doc: wrapOf("docs/notes.md") };
    });
    check("S1·折行：代码文件标记为不折（scroll）", shape.code?.mode === "scroll", JSON.stringify(shape.code));
    check("S1·折行：代码行 white-space = pre（靠缩进阅读，DSH/difit/opencode 三处同判）",
      shape.code?.whiteSpace === "pre", shape.code?.whiteSpace ?? "null");
    check("S1·折行：文档文件标记为折行（wrap）", shape.doc?.mode === "wrap", JSON.stringify(shape.doc));
    check("S1·折行：文档行 white-space = pre-wrap", shape.doc?.whiteSpace?.includes("pre-wrap") === true, shape.doc?.whiteSpace ?? "null");
  }
  await page.context().close();
}

// ── 3.7 批注草稿持久化（S2·A5）+ 过期检测（S2·A6）─────────────────────────────────
{
  const page = await openPage({ width: 1680, height: 1000 });
  const opened = await openReview(page);
  check("S2·草稿：面板出现", opened);
  if (opened) {
    await ensureAllOpen(page);
    const card = page.locator('[data-review-file="src/demo.ts"]');
    check("S2·草稿：目标文件卡存在", (await card.count()) === 1);

    // 悬停新增行 → 「＋」按钮出现（批注入口）
    const addBtn = card.locator('[data-review-add-draft="new:2"]').first();
    check("S2·草稿：改动行有批注入口", (await addBtn.count()) === 1);
    const opacityBefore = await addBtn.evaluate((el) => getComputedStyle(el).opacity);
    check("S2·草稿：未悬停时「＋」不可见（opacity 0，不占位跳动）", opacityBefore === "0", opacityBefore);
    await addBtn.hover();
    await page.waitForTimeout(300);
    const opacityHover = await addBtn.evaluate((el) => getComputedStyle(el).opacity);
    check("S2·草稿：悬停后「＋」出现", opacityHover === "1", opacityHover);

    // A2a：点行号本身也能起批注（opencode 组件测试 "opens the comment editor when a line number is clicked" 同款）
    await card.locator('[data-review-line-anchor="new:2"]').click();
    // store 走服务端：写 + 重读是异步的（原来 localStorage 是同步的）
    await page.waitForTimeout(1200);
    check("S2·A2a：点行号即可起批注（不必先找到「＋」）", (await card.locator("[data-review-draft]").count()) === 1);
    // 已有草稿时再点「＋」不该产生第二条（同键覆盖）
    await card.locator('[data-review-add-draft="new:2"]').click({ force: true });
    await page.waitForTimeout(1200);
    check("S2·A2a：同一行重复点只保留一条草稿（同键覆盖）", (await card.locator("[data-review-draft]").count()) === 1);
    check("S2·草稿：锚定行被高亮", (await card.locator("[data-review-anchored]").count()) >= 1);

    // 作者身份：存 id、展示名字与头像（用户 2026-11-05 要求）
    const authorInfo = await page.evaluate(async () => {
      const card = document.querySelector('[data-review-file="src/demo.ts"]');
      const draftEl = card?.querySelector("[data-review-draft]");
      if (!draftEl) return null;
      const taskDir = document.querySelector("[data-review-task-dir]")?.value ?? "";
      const res = await fetch(`/api/review/comments?taskDir=${encodeURIComponent(taskDir)}`);
      const items = res.ok ? ((await res.json()).items ?? []) : [];
      return {
        attr: draftEl.getAttribute("data-review-draft-author"),
        name: draftEl.querySelector("[data-review-draft-author-name]")?.textContent ?? "",
        hasUserAvatar: draftEl.querySelector('[data-review-draft-avatar="user"]') !== null,
        stored: items[0]?.author,
      };
    });
    check("S2·作者：草稿卡展示作者（data 属性 = kind:id）", /^(user|agent):.+/.test(authorInfo?.attr ?? ""), String(authorInfo?.attr));
    check("S2·作者：展示名字（不是只显示 id）", (authorInfo?.name ?? "").length > 0 && authorInfo?.name !== "user", authorInfo?.name);
    check("S2·作者：用户有头像色块", authorInfo?.hasUserAvatar === true);
    check("S2·作者：存储里是 id 而不是名字", typeof authorInfo?.stored?.id === "string" && authorInfo?.stored?.kind === "user", JSON.stringify(authorInfo?.stored));

    // 「＋」按钮外观：不是蓝色圆形（opencode 用中性方角 + 描边十字）
    const addLook = await addBtn.evaluate((el) => {
      const cs = getComputedStyle(el);
      const svg = el.querySelector("svg");
      return { w: cs.width, h: cs.height, radius: cs.borderRadius, bg: cs.backgroundColor, hasSvg: svg !== null };
    });
    check("S2·UI：「＋」是 20×20 的方形控件（不是圆形胶囊）", addLook.w === "20px" && addLook.h === "20px", JSON.stringify(addLook));
    check("S2·UI：「＋」的十字是画出来的 svg（字形在不同字体下不对齐）", addLook.hasSvg === true);
    check("S2·UI：「＋」不再用品牌蓝实心（与整体风格一致，走中性底 + 描边）",
      !addLook.bg.includes("37, 99, 235"), addLook.bg);

    // 打字 → 即时写服务端（S4-b 之后评论不再只存浏览器）
    const note = "这行为什么改成 22？";
    await card.locator("[data-review-draft-note]").first().fill(note);
    await page.waitForTimeout(900);
    const stored = (await serverComments(page))[0];
    check("S2·草稿：打字后立即写入服务端（无需保存按钮）", stored?.body === note, JSON.stringify(stored?.body));
    check("S2·草稿：存了文件路径与行号", stored?.anchor?.path === "src/demo.ts" && stored?.anchor?.start === 2, JSON.stringify(stored?.anchor));
    check("S2·草稿：存了锚点原文快照（过期判定用）", typeof stored?.anchor?.snapshot === "string" && stored.anchor.snapshot.length > 0, String(stored?.anchor?.snapshot));
    check("S4·持久化：评论带作者 id（不是名字）", stored?.author?.id === "xu-later" && stored?.author?.kind === "user", JSON.stringify(stored?.author));

    // 刷新页面 → 草稿还在（核心诉求：刷新不丢）
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2000);
    const reopened = await openReview(page, { clean: false });
    check("S2·草稿：刷新后能重新打开检视", reopened);
    if (reopened) {
      await ensureAllOpen(page);
      const card2 = page.locator('[data-review-file="src/demo.ts"]');
      // 刷新后草稿默认折叠成"行末头像针"（用户 2026-11-05 拍板的折叠形态）
      const pins = await card2.locator("[data-review-pin]").count();
      check("S2·草稿：刷新后草稿仍在（以行末头像针呈现，不丢）", pins === 1, `针数 ${pins}`);
      await card2.locator("[data-review-pin]").first().click();
      await page.waitForTimeout(500);
      const got = await card2.locator("[data-review-draft-note]").first().inputValue().catch(() => "");
      check("S2·草稿：点针展开后正文原样恢复", got === note, got.slice(0, 30));

      // 丢弃
      await card2.locator("[data-review-draft]").first().getByRole("button", { name: "丢弃这条草稿" }).click();
      await page.waitForTimeout(400);
      check("S2·草稿：丢弃后草稿消失", (await card2.locator("[data-review-draft]").count()) === 0 && (await card2.locator("[data-review-pin]").count()) === 0);
      const afterRemove = await serverComments(page);
      check("S2·草稿：丢弃后服务端同步清空", afterRemove.length === 0, `${afterRemove.length} 条`);
    }
  }
  await page.context().close();
}

// ── 3.8 过期检测（S2·A6）：代码变了 → 草稿标"过期" ─────────────────────────────
{
  const page = await openPage({ width: 1680, height: 1000 });
  const opened = await openReview(page);
  if (opened) {
    await ensureAllOpen(page);
    const card = page.locator('[data-review-file="src/demo.ts"]');
    await card.locator('[data-review-add-draft="new:2"]').first().click();
    await page.waitForTimeout(400);
    await card.locator("[data-review-draft-note]").first().fill("先写一条");
    await page.waitForTimeout(300);
    check("S2·过期：初始不标过期", (await card.locator("[data-review-draft-outdated]").count()) === 0);

    // 换一份"行内容变了"的 diff（同文件、同行号、内容不同）→ 重新打开检视
    const changed = JSON.parse(JSON.stringify(FIXTURE));
    const hunk = changed.items[0].files[0].hunks[0];
    const addedLine = hunk.lines.find((l) => l.type === "added" && l.newNo === 2);
    addedLine.text = "const b = 999;";
    await page.unrouteAll({ behavior: "ignoreErrors" });
    await page.route(/\/api\/review\/diff$/, (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(changed) }));
    await page.route(/\/review-sources$/, (route) => route.fulfill({
      status: 200, contentType: "application/json",
      body: JSON.stringify({ items: [{ kind: "worktree", path: "/tmp/demo-worktree" }, { kind: "lifeos", path: "/tmp/demo-lifeos" }] }),
    }));
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2000);
    const reopened = await openReview(page, { clean: false });
    check("S2·过期：换 diff 后能重新打开", reopened);
    if (reopened) {
      await ensureAllOpen(page);
      const card2 = page.locator('[data-review-file="src/demo.ts"]');
      // 过期标记在展开的卡片上（默认折叠成针，先点开）
      const hasPin = await card2.locator("[data-review-pin]").count();
      if (hasPin > 0) { await card2.locator("[data-review-pin]").first().click(); await page.waitForTimeout(500); }
      const outdated = await card2.locator("[data-review-draft-outdated]").count();
      check("S2·过期：代码变了 → 草稿标出「代码已变，这段锚点不再匹配」", outdated === 1, `标记数 ${outdated}`);
      const text = await card2.locator("[data-review-draft-outdated]").first().innerText().catch(() => "");
      check("S2·过期：提示文案说清原因（不是只有红点）", text.includes("代码已变"), text);
      // 草稿本身不能被删（用户还要看自己写了什么）
      check("S2·过期：过期不影响草稿存在", (await card2.locator("[data-review-draft]").count()) === 1);
    }
  }
  await page.context().close();
}

// ── 3.9 A2b 拖选范围（S3）：拖过 3 行 → 一条范围草稿 + 位置头 ─────────────────
{
  const page = await openPage({ width: 1680, height: 1000 });
  const opened = await openReview(page);
  check("S3·A2b：面板出现", opened);
  if (opened) {
    await ensureAllOpen(page);
    const card = page.locator('[data-review-file="docs/big.md"]');
    // 用行号锚点定位（比 nth 稳：nth 会命中隐藏段展开出来的行）
    const rowOf = (lineNo) => card.locator(`[data-review-line-anchor="new:${lineNo}"]`).first().locator("xpath=ancestor::div[contains(@class,'group/line')][1]");
    const from = await rowOf(6).boundingBox();
    const to = await rowOf(10).boundingBox();
    check("S3·A2b：两行都在视口内", from !== null && to !== null);
    if (from !== null && to !== null) {
      // 代码文字上拖 = **选中文字**（人的默认心智）；跨行时换算成行范围（opencode 路径）
      await page.mouse.move(from.x + 120, from.y + from.height / 2);
      await page.mouse.down();
      for (let i = 1; i <= 14; i++) {
        const y = from.y + from.height / 2 + (to.y - from.y) * i / 14;
        await page.mouse.move(from.x + 120 + i * 8, y);
        await page.waitForTimeout(22);
      }
      const selDuring = await page.evaluate(() => (window.getSelection()?.toString() ?? '').length);
      check("S3·A2b：代码文字上拖真的选中了文字（人能看见）", selDuring > 0, `${selDuring} 字符`);
      await page.mouse.up();
      const drafts = await waitForComments(page, (list) => list.length >= 1);
      check("S3·A2b：松手后只产生 1 条草稿", drafts.length === 1, `${drafts.length} 条`);
      const d = drafts[0];
      check("S3·A2b：文字拖选跨 5 行 → 范围正确",
        d !== undefined && d.anchor.end - d.anchor.start === 4,
        JSON.stringify({ start: d?.anchor?.start, end: d?.anchor?.end }));
      const leftover = await page.evaluate(() => (window.getSelection()?.toString() ?? '').length);
      check("S3·A2b：接管后清掉浏览器选区（不与行高亮两套视觉打架）", leftover === 0, `${leftover} 字符残留`);

      // A7 位置头：卡片上显示 path:Lstart-Lend
      const header = await card.locator("[data-review-draft-header]").first().innerText().catch(() => "");
      check("S3·A7：草稿卡显示位置头 path:Lx-Ly", /^docs\/big\.md:L\d+-L\d+$/.test(header), header);
      const label = await card.locator("[data-review-draft]").first().innerText();
      check("S3·A7：同时给人话标签「第 x–y 行」", label.includes("第 ") && label.includes("–"), label.split("\n")[0]);

    }
  }
  await page.context().close();
}

// ── 3.10 A2b 反向拖选：下→上 归一（独立 context，避免打断在途请求）────────────
{
  const page = await openPage({ width: 1680, height: 1000 });
  const opened = await openReview(page);
  if (opened) {
    await ensureAllOpen(page);
    const card = page.locator('[data-review-file="docs/big.md"]');
    const rowOf = (lineNo) => card.locator(`[data-review-line-anchor="new:${lineNo}"]`).first().locator("xpath=ancestor::div[contains(@class,'group/line')][1]");
    const bottom = await rowOf(10).boundingBox();
    const top = await rowOf(6).boundingBox();
    if (bottom !== null && top !== null) {
      await page.mouse.move(bottom.x + 260, bottom.y + bottom.height / 2);
      await page.mouse.down();
      await page.mouse.move(top.x + 260, top.y + top.height / 2, { steps: 6 });
      await page.mouse.up();
      const rev = await waitForComments(page, (list) => list.length >= 1);
      check("S3·A2b：反向拖（下→上）也归一成 start<end",
        rev.length === 1 && rev[0].anchor.start === 6 && rev[0].anchor.end === 10,
        JSON.stringify(rev.map((x) => [x.anchor.start, x.anchor.end])));
    }
  }
  await page.context().close();
}

// ── 3.11 哪些行能批注：改动行 + 上下文行 + 展开出来的行（都要能）───────────────
{
  const page = await openPage({ width: 1680, height: 1000 });
  const opened = await openReview(page);
  if (opened) {
    await ensureAllOpen(page);
    const card = page.locator('[data-review-file="src/demo.ts"]');

    // ① 改动行（added）有入口
    check("S3·可批注：新增行有入口", (await card.locator('[data-review-add-draft^="new:"]').count()) > 0);
    // ② 改动行（removed）有入口，且锚在 old 侧
    check("S3·可批注：删除行有入口且锚 old 侧", (await card.locator('[data-review-add-draft^="old:"]').count()) > 0);

    // ③ **未改动的上下文行也有入口**（用户问："那些没有改动的就不能写评论了吗？"）
    const ctxRows = card.locator('[data-line="context"]');
    const ctxCount = await ctxRows.count();
    check("S3·可批注：存在上下文行", ctxCount > 0, `${ctxCount} 行`);
    const ctxWithEntry = await ctxRows.evaluateAll((els) => els.filter((el) => el.querySelector("[data-review-add-draft]") !== null).length);
    check("S3·可批注：未改动的上下文行同样能写评论", ctxWithEntry === ctxCount, `${ctxWithEntry}/${ctxCount}`);

    // ④ 悬停上下文行，「＋」真的出现
    const firstCtx = ctxRows.first();
    const box = await firstCtx.boundingBox();
    if (box !== null) {
      await page.mouse.move(box.x + 260, box.y + box.height / 2);
      await page.waitForTimeout(350);
      const op = await firstCtx.locator("[data-review-add-draft]").first().evaluate((el) => getComputedStyle(el).opacity);
      check("S3·可批注：悬停上下文行后「＋」可见", op === "1", op);
    }

    // ⑤ 点上下文行行号 → 出草稿（不只有改动行能点）
    const ctxAnchor = await ctxRows.first().locator("[data-review-line-anchor]").getAttribute("data-review-line-anchor");
    await ctxRows.first().locator("[data-review-line-anchor]").click();
    await page.waitForTimeout(500);
    check("S3·可批注：点上下文行行号能起草稿", (await card.locator("[data-review-draft]").count()) === 1, String(ctxAnchor));

    // ⑥ **展开出来的行也能批注**（此前是空白：展开行没有锚点）
    await page.evaluate(() => localStorage.removeItem("lifeos.reviewDrafts"));
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1800);
    const re = await openReview(page, { clean: false });
    if (re) {
      await ensureAllOpen(page);
      const card2 = page.locator('[data-review-file="docs/big.md"]');
      const gapBar = card2.locator('[data-review-hidden="gap"]').first();
      const has = await gapBar.count();
      check("S3·可批注：多 hunk 文件有可展开的空档", has === 1);
      if (has === 1) {
        await gapBar.locator('[data-review-expand="up"]').click();
        await page.waitForTimeout(800);
        const stat = await card2.evaluate((c) => {
          const all = [...c.querySelectorAll("[data-line]")];
          return { total: all.length, withEntry: all.filter((el) => el.querySelector("[data-review-add-draft]") !== null).length };
        });
        check("S3·可批注：展开出来的未改动行也能批注（无死角）",
          stat.withEntry === stat.total && stat.total > 20, `${stat.withEntry}/${stat.total}`);
      }
    }
  }
  await page.context().close();
}

// ── 3.12 A2c：从**行号**起拖能出范围（GitHub 文档的首选路径）───────────────────
{
  const page = await openPage({ width: 1680, height: 1000 });
  const opened = await openReview(page);
  if (opened) {
    await ensureAllOpen(page);
    const card = page.locator('[data-review-file="docs/big.md"]');
    const anchorOf = (n) => card.locator(`[data-review-line-anchor="new:${n}"]`).first();

    // ① 点行号**不移动** → 单行草稿（原有行为不能坏）
    const a = await anchorOf(6).boundingBox();
    if (a !== null) {
      await page.mouse.click(a.x + a.width / 2, a.y + a.height / 2);
      const d1 = await waitForComments(page, (list) => list.length >= 1);
      check("S3·A2c：点行号（不移动）→ 单行草稿",
        d1.length === 1 && d1[0].anchor.start === d1[0].anchor.end,
        JSON.stringify(d1.map((x) => [x.anchor.start, x.anchor.end])));
    }

    // ② 从行号**按下拖到另一行号** → 范围草稿
    //    先清干净（上一步"点行号"已在服务端留了 1 条单行草稿，不清会污染"只产生 1 条"的断言）
    await page.evaluate(() => localStorage.removeItem("lifeos.reviewDrafts"));
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1800);
    const re = await openReview(page, { clean: true });
    if (re) {
      await ensureAllOpen(page);
      const card2 = page.locator('[data-review-file="docs/big.md"]');
      const an = (n) => card2.locator(`[data-review-line-anchor="new:${n}"]`).first();
      const from = await an(6).boundingBox();
      const to = await an(10).boundingBox();
      if (from !== null && to !== null) {
        await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
        await page.mouse.down();
        await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 8 });
        await page.waitForTimeout(250);
        const hl = await card2.locator("[data-review-drag-selected]").count();
        check("S3·A2c：从行号拖选时被选行有高亮", hl >= 4, `${hl} 行`);
        await page.mouse.up();
        const d2 = await waitForComments(page, (list) => list.length >= 1);
        check("S3·A2c：从行号拖出范围（GitHub 文档路径）",
          d2.length === 1 && d2[0].anchor.start === 6 && d2[0].anchor.end === 10,
          JSON.stringify(d2.map((x) => [x.anchor.start, x.anchor.end])));
        const cursor = await an(6).evaluate((el) => getComputedStyle(el).cursor);
        check("S3·A2c：行号区光标是 ns-resize（暗示可上下拖）", cursor === "ns-resize", cursor);
      }
    }
  }
  await page.context().close();
}

// ── 3.13 行内拖字 = 复制文字（不弹批注）；跨行拖 = 出范围 ────────────────────
{
  const page = await openPage({ width: 1680, height: 1000 });
  const opened = await openReview(page);
  if (opened) {
    await ensureAllOpen(page);
    const card = page.locator('[data-review-file="docs/big.md"]');
    const pick = card.locator("[data-review-line-text]").filter({ hasText: "line6" }).first();
    const b = await pick.boundingBox();
    check("S3·单行：目标行可见", b !== null);
    if (b !== null) {
      await page.mouse.move(b.x + 5, b.y + b.height / 2);
      await page.mouse.down();
      for (let i = 1; i <= 10; i++) { await page.mouse.move(b.x + 5 + i * 9, b.y + b.height / 2); await page.waitForTimeout(22); }
      const sel = await page.evaluate(() => (window.getSelection()?.toString() ?? ''));
      await page.mouse.up();
      await page.waitForTimeout(500);
      const drafts = await page.evaluate(() => JSON.parse(localStorage.getItem("lifeos.reviewDrafts") ?? "{}").drafts ?? []);
      check("S3·单行：行内拖字能选中文字（复制用）", sel.length > 0, `${sel.length} 字符`);
      check("S3·单行：行内拖字**不**弹批注框（否则打断复制）", drafts.length === 0, `${drafts.length} 条草稿`);
    }
  }
  await page.context().close();
}

// ── 3.14 草稿卡挂在结束行 + 多文档/多评论/折叠 的隔离（用户点名要"扎实"）──────
{
  const page = await openPage({ width: 1680, height: 1000 });
  const opened = await openReview(page);
  if (opened) {
    await ensureAllOpen(page);
    const card = page.locator('[data-review-file="docs/big.md"]');
    const rowOf = (n) => card.locator(`[data-review-line-anchor="new:${n}"]`).first().locator("xpath=ancestor::div[contains(@class,'group/line')][1]");

    // ① 拖 6~10 行 → 卡片必须挂在**第 10 行**下方（不是第 6 行）
    const b6 = await rowOf(6).boundingBox();
    const b10 = await rowOf(10).boundingBox();
    if (b6 !== null && b10 !== null) {
      await page.mouse.move(b6.x + 120, b6.y + b6.height / 2);
      await page.mouse.down();
      for (let i = 1; i <= 12; i++) {
        const y = b6.y + b6.height / 2 + (b10.y - b6.y) * i / 12;
        await page.mouse.move(b6.x + 120 + i * 8, y);
        await page.waitForTimeout(20);
      }
      await page.mouse.up();
      await waitForComments(page, (list) => list.length >= 1);
      await page.waitForTimeout(500);
      const pos = await page.evaluate(() => {
        const c = document.querySelector('[data-review-file="docs/big.md"]');
        const d = c.querySelector("[data-review-draft]");
        if (d === null) return null;
        const top = d.getBoundingClientRect().top;
        const rowTop = (n) => c.querySelector(`[data-review-line-anchor="new:${n}"]`)?.getBoundingClientRect().top ?? null;
        return { cardTop: top, rowStart: rowTop(6), rowEnd: rowTop(10) };
      });
      check("S4·S4-a：草稿卡挂在**结束行**下方（不是起始行）",
        pos !== null && pos.cardTop > pos.rowEnd, JSON.stringify(pos));

      // ② 文件头有评论数徽标
      const badge = await card.locator("[data-review-comment-count]").innerText().catch(() => "");
      check("S4·S4-a：文件卡头部显示评论条数", badge.trim() === "1", badge);

      // ③ **折叠后**评论数仍在（数据不随显示消失）
      await card.locator("button[aria-expanded]").first().click();
      await page.waitForTimeout(400);
      const badgeFolded = await card.locator("[data-review-comment-count]").innerText().catch(() => "");
      check("S4·隔离：折叠文件后评论数徽标仍在", badgeFolded.trim() === "1", badgeFolded);
      await card.locator("button[aria-expanded]").first().click();
      await page.waitForTimeout(400);
      const draftBack = await card.locator("[data-review-pin]").count();
      check("S4·隔离：再展开后评论针回来（数据一直在）", draftBack === 1, `${draftBack}`);

      // ④ **多个文件各写一条**（互不串）
      const other = page.locator('[data-review-file="docs/notes.md"]');
      await other.locator("[data-review-add-draft]").first().click();
      await waitForComments(page, (list) => list.length >= 2);
      await page.waitForTimeout(400);
      const perFile = await page.evaluate(() => {
        const out = {};
        for (const card of document.querySelectorAll("[data-review-file]")) {
          const p = card.getAttribute("data-review-file");
          out[p] = card.querySelectorAll("[data-review-pin]").length;
        }
        return out;
      });
      check("S4·隔离：多文件各有各的评论（big.md 1 条、notes.md 1 条）",
        perFile["docs/big.md"] === 1 && perFile["docs/notes.md"] === 1, JSON.stringify(perFile));

      // ⑤ **同一文件多条**（不同范围）
      await rowOf(6).locator("[data-review-line-anchor]").click();
      await waitForComments(page, (list) => list.length >= 3);
      await page.waitForTimeout(500);
      const multi = await card.locator("[data-review-pin]").count();
      check("S4·隔离：同一文件可以有多条评论（不同范围）", multi === 2, `${multi} 条`);
      const badge2 = await card.locator("[data-review-comment-count]").innerText().catch(() => "");
      check("S4·隔离：文件头计数跟着变（1 → 2）", badge2.trim() === "2", badge2);

      // ⑥ 刷新后全部还在（跨文档、多条一起）——**不能清服务端**，这正是要验证的
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.waitForTimeout(1800);
      const re = await openReview(page, { clean: false });
      if (re) {
        await ensureAllOpen(page);
        const counts = await page.evaluate(() => {
          const out = {};
          for (const card of document.querySelectorAll("[data-review-file]")) {
            out[card.getAttribute("data-review-file")] = card.querySelectorAll("[data-review-pin]").length;
          }
          return out;
        });
        check("S4·隔离：刷新后多文件多条全在",
          counts["docs/big.md"] === 2 && counts["docs/notes.md"] === 1, JSON.stringify(counts));
      }
    }
  }
  await page.context().close();
}

// ── 3.15 检视对象可见 + 一键复制（用户：传达起来很慢）──────────────────────────
{
  const context = await browser.newContext({ viewport: { width: 1680, height: 1000 }, permissions: ["clipboard-read", "clipboard-write"] });
  const page = await context.newPage();
  page.on("pageerror", (error) => check(`无页面崩溃（${String(error).slice(0, 60)}）`, false));
  await page.route(/\/api\/review\/diff$/, (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(FIXTURE) }));
  await page.route(/\/review-sources$/, (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [{ kind: "worktree", path: "/tmp/demo-worktree" }, { kind: "lifeos", path: "/tmp/demo-lifeos" }] }) }));
  await page.goto(APP_URL, { waitUntil: "domcontentloaded" });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2200);
  const opened = await openReview(page);
  check("S4·对象：面板出现", opened);
  if (opened) {
    const bar = await page.locator("[data-review-target]").innerText().catch(() => "");
    check("S4·对象：顶部显示检视对象（worktree + Task 文档两行）",
      bar.includes("worktree") && bar.includes("Task 文档"), bar.replace(/\n/g, " | "));
    const paths = await page.locator("[data-review-target-path]").evaluateAll((els) => els.map((el) => ({
      kind: el.getAttribute("data-review-target-path"),
      full: el.getAttribute("title"),
      shown: el.textContent,
    })));
    check("S4·对象：两个源都有完整路径（title 里是全路径）",
      paths.length === 2 && paths.every((p) => typeof p.full === "string" && p.full.length > 0),
      JSON.stringify(paths));
    check("S4·对象：长路径中间省略、可读（不是整段挤爆）",
      paths.every((p) => p.shown.length <= p.full.length), JSON.stringify(paths.map((p) => p.shown)));

    await page.locator("[data-review-copy-target]").click();
    await page.waitForTimeout(400);
    const clip = await page.evaluate(() => navigator.clipboard.readText().catch(() => ""));
    check("S4·对象：一键复制得到结构化文本（首行「检视对象：」）", clip.startsWith("检视对象："), clip.split("\n")[0] ?? "");
    check("S4·对象：复制内容含 worktree 绝对路径与分支", clip.includes("worktree：") && clip.includes("/tmp/demo-worktree"), clip.slice(0, 120));
  }
  await context.close();
}

// ── 3.16 评论卡：折叠 / 语气 / 作者色条 / 同行多作者（用户 2026-11-05 拍板的四项）──
{
  const page = await openPage({ width: 1680, height: 1000 });
  const opened = await openReview(page);
  if (opened) {
    await ensureAllOpen(page);
    const card = page.locator('[data-review-file="src/demo.ts"]');
    await card.locator('[data-review-add-draft="new:2"]').first().click();
    await page.waitForTimeout(500);
    await card.locator("[data-review-draft-note]").first().fill("这行为什么改成 22？");
    await page.waitForTimeout(400);

    // ① 折叠（用户 2026-11-05 拍板形态）：折叠 = 只剩行末头像针（卡片完全不渲染）
    const foldBtn = card.locator("[data-review-draft-fold]").first();
    check("S4·评论卡：展开态有折叠按钮", (await foldBtn.count()) === 1);
    await foldBtn.click();
    await page.waitForTimeout(400);
    const foldedShape = await page.evaluate(() => {
      const c = document.querySelector('[data-review-file="src/demo.ts"]');
      return {
        cards: c?.querySelectorAll("[data-review-draft]").length ?? -1,
        pins: c?.querySelectorAll("[data-review-pin]").length ?? -1,
        pinAuthors: [...(c?.querySelectorAll("[data-review-pin]") ?? [])].map((e) => e.getAttribute("data-review-pin-author")),
      };
    });
    check("S4·评论卡：折叠后卡片完全不渲染（不占高度）", foldedShape.cards === 0, JSON.stringify(foldedShape));
    check("S4·评论卡：折叠后行末出现头像针（替代卡片）", foldedShape.pins === 1, JSON.stringify(foldedShape));
    check("S4·评论卡：针上带作者身份", /^(user|agent):/.test(foldedShape.pinAuthors[0] ?? ""), JSON.stringify(foldedShape.pinAuthors));

    // 悬停针 → 预览气泡；移开消失
    await card.locator("[data-review-pin]").first().hover();
    await page.waitForTimeout(500);
    const preview = await page.evaluate(() => {
      const el = document.querySelector("[data-review-pin-preview]");
      return el === null ? null : { body: el.querySelector("[data-review-pin-preview-body]")?.textContent ?? "" };
    });
    check("S4·评论卡：悬停头像针出现预览气泡（Figma/Google Docs 心智）", preview !== null, JSON.stringify(preview));
    check("S4·评论卡：气泡里能看到评论正文", (preview?.body ?? "").includes("这行为什么改成 22"), preview?.body ?? "");

    // ★ C190：气泡必须**贴着**锚点，不能漂到屏幕角落（第一版偏移 524px）
    const geo = await page.evaluate(() => {
      const pin = document.querySelector("[data-review-pin]");
      const pop = document.querySelector("[data-review-pin-preview]");
      if (pin === null || pop === null) return null;
      const a = pin.getBoundingClientRect();
      const b = pop.getBoundingClientRect();
      return {
        verticalGap: Math.round(b.top - a.bottom),        // 下方间距（正数 = 在下方）
        centerDx: Math.round((b.left + b.width / 2) - (a.left + a.width / 2)),
        rightDelta: Math.round(b.right - a.right),        // 右缘对齐 → 应 ≈ 0
        overflowRight: Math.round(b.right - window.innerWidth),
        overflowLeft: Math.round(0 - b.left),
      };
    });
    check("S4·气泡：垂直上贴着锚点（间距 ≤ 20px，不是几百 px 的角落）",
      geo !== null && Math.abs(geo.verticalGap) <= 20, JSON.stringify(geo));
    check("S4·气泡：水平右缘对齐锚点（difit placement bottom-end）",
      geo !== null && Math.abs(geo.rightDelta) <= 2, JSON.stringify(geo));
    check("S4·气泡：不超出视口左右边缘（difit shift padding 8）",
      geo !== null && geo.overflowRight <= 8 && geo.overflowLeft <= 0, JSON.stringify(geo));
    await page.mouse.move(10, 10);
    await page.waitForTimeout(500);
    check("S4·评论卡：鼠标移开后气泡消失", (await page.locator("[data-review-pin-preview]").count()) === 0);

    // 点针 → 卡片展开回来
    await card.locator("[data-review-pin]").first().hover();
    await page.waitForTimeout(350);
    const hadPreview = (await page.locator("[data-review-pin-preview]").count()) > 0;
    await card.locator("[data-review-pin]").first().click();
    await page.waitForTimeout(450);
    check("S4·评论卡：点针后卡片展开、输入框回来", (await card.locator("[data-review-draft-note]").count()) === 1);
    check("S4·评论卡：点针后预览气泡消失（不叠两层浮层）",
      hadPreview && (await page.locator("[data-review-pin-preview]").count()) === 0, `悬停时=${hadPreview}`);

    // ② 语气（复用 marks 体系，不加 severity）
    const marks = await card.locator("[data-review-mark]").evaluateAll((els) => els.map((e) => e.getAttribute("data-review-mark")));
    check("S4·评论卡：语气按钮存在（疑问/批评/鼓励/同意/存档/待办）",
      marks.includes("query") && marks.includes("critic") && marks.includes("praise") && marks.includes("agree"), JSON.stringify(marks));
    await card.locator('[data-review-mark="critic"]').click();
    const afterMark = await waitForComments(page, (list) => list.some((c) => (c.marks ?? []).includes("critic")));
    const marks1 = afterMark.find((c) => c.anchor?.path === "src/demo.ts")?.marks;
    check("S4·评论卡：点语气后落盘到服务端（marks: [critic]）", JSON.stringify(marks1) === '["critic"]', JSON.stringify(marks1));
    const pressed = await card.locator('[data-review-mark="critic"]').getAttribute("aria-pressed");
    check("S4·评论卡：选中的语气有 aria-pressed", pressed === "true", String(pressed));

    // ③ 作者色条（与头像同源 avatarTone；用户用中性色）
    const accent = await page.evaluate(() => {
      const d = document.querySelector("[data-review-draft]");
      const el = d?.querySelector("[data-review-draft-accent]");
      return el === null || el === undefined ? null : { id: el.getAttribute("data-review-draft-accent"), cls: el.className };
    });
    check("S4·评论卡：卡片左侧有作者色条", accent !== null, JSON.stringify(accent));
    check("S4·评论卡：用户自己的色条用中性色（不抢 Agent 的彩色）",
      accent !== null && accent.cls.includes("bg-ink-300"), accent?.cls ?? "");

    // ④ 同一行不同作者 → 两条独立评论（键里带作者）
    //
    // **自足断言**：直接用 API 造两条（用户 + Agent），不依赖前面流程恰好写过——
    // 否则前置步骤一改，这条就假红/假绿（C187 的夹具教训）。
    const multi = await page.evaluate(async () => {
      const taskDir = document.querySelector("[data-review-task-dir]")?.value ?? "";
      const taskId = (/^(\d{4})/.exec(taskDir.split("/").pop() ?? "") ?? [])[1] ?? "0010";
      const post = (author) => fetch("/api/review/comments", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          taskDir, op: "add",
          comment: {
            taskId, author,
            anchor: { source: "worktree", path: "src/demo.ts", side: "new", start: 2, end: 2 },
            body: `${author.kind} 的意见`, marks: [], state: "open",
          },
        }),
      });
      await post({ kind: "user", id: "xu-later" });
      await post({ kind: "agent", id: "coder" });
      const list = await fetch(`/api/review/comments?taskDir=${encodeURIComponent(taskDir)}`);
      return ((await list.json()).items ?? []).filter((c) => c.anchor?.path === "src/demo.ts" && c.anchor?.start === 2).length;
    });
    check("S4·评论卡：同一段上用户与 Agent 各一条（服务端两条）", multi === 2, `${multi} 条`);

    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1800);
    const re = await openReview(page, { clean: false });
    if (re) {
      await ensureAllOpen(page);
      const card2 = page.locator('[data-review-file="src/demo.ts"]');
      await waitForComments(page, (list) => list.filter((c) => c.anchor?.path === "src/demo.ts").length >= 2);
      await page.waitForTimeout(700);
      const n = await card2.locator("[data-review-pin]").count();
      check("S4·评论卡：同一行不同作者各一个头像针", n >= 2, `${n} 个针`);
      const authors = await card2.locator("[data-review-pin]").evaluateAll((els) => els.map((e) => e.getAttribute("data-review-pin-author")));
      check("S4·评论卡：两条作者可区分", authors.length === 2 && authors[0] !== authors[1], JSON.stringify(authors));
      // 展开 agent 那条（点它的针），再看色条
      const agentPin = card2.locator('[data-review-pin-author^="agent:"]').first();
      await agentPin.click();
      await page.waitForTimeout(450);
      const agentAccent = await page.evaluate(() => {
        const d = [...document.querySelectorAll("[data-review-draft]")].find((e) => (e.getAttribute("data-review-draft-author") ?? "").startsWith("agent:"));
        const el = d?.querySelector("[data-review-draft-accent]");
        return el === null || el === undefined ? null : { id: el.getAttribute("data-review-draft-accent"), cls: el.className };
      });
      check("S4·评论卡：Agent 的色条取自 avatarTone（不是中性色）",
        agentAccent !== null && !agentAccent.cls.includes("bg-ink-300"), JSON.stringify(agentAccent));

      // ⑤ 评论数徽标可点击 → 定位到该文件的第一条评论（VS Code glyph / GitHub 同判）
      const badge = card2.locator("[data-review-comment-count]").first();
      check("S4·徽标：是可点击控件（role=button）", (await badge.getAttribute("role")) === "button");
      await page.evaluate(() => { window.__scrolled = false; });
      await badge.click();
      await page.waitForTimeout(700);
      const focused = await page.evaluate(() => {
        const d = document.querySelector("[data-review-pin]") ?? document.querySelector("[data-review-draft]");
        if (d === null) return null;
        const rect = d.getBoundingClientRect();
        return { inViewport: rect.top >= 0 && rect.top <= window.innerHeight, top: Math.round(rect.top) };
      });
      check("S4·徽标：点击后第一条评论滚进视口", focused !== null && focused.inViewport === true, JSON.stringify(focused));
    }
  }
  await page.context().close();
}

// ── 3.17 评论状态（S4-e · A18/A19）：徽标 / 关闭 / 权限 ──────────────────────
{
  const context = await browser.newContext({ viewport: { width: 1680, height: 1000 }, permissions: ["clipboard-read", "clipboard-write"] });
  const page = await context.newPage();
  page.on("pageerror", (error) => check(`无页面崩溃（${String(error).slice(0, 60)}）`, false));
  await page.route(/\/api\/review\/diff$/, (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(FIXTURE) }));
  await page.route(/\/review-sources$/, (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [{ kind: "worktree", path: "/tmp/demo-worktree" }, { kind: "lifeos", path: "/tmp/demo-lifeos" }] }) }));
  await page.goto(APP_URL, { waitUntil: "domcontentloaded" });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2000);
  const opened = await openReview(page);
  check("S4e·状态：面板出现", opened);
  if (opened) {
    // 造两条：一条 agent 的（awaiting=user），一条 user 自己的
    await page.evaluate(async () => {
      const taskDir = document.querySelector("[data-review-task-dir]")?.value ?? "";
      const taskId = (/^(\d{4})/.exec(taskDir.split("/").pop() ?? "") ?? [])[1] ?? "0010";
      await fetch("/api/review/comments", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ taskDir, op: "clear" }) });
      const post = (comment) => fetch("/api/review/comments", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ taskDir, op: "add", comment: { taskId, ...comment } }),
      });
      await post({ author: { kind: "agent", id: "coder" }, anchor: { source: "worktree", path: "src/demo.ts", side: "new", start: 2, end: 2 }, body: "Agent 提的", marks: [], state: "open", awaiting: "user" });
    });
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1800);
    const re = await openReview(page, { clean: false });
    if (re) {
      await ensureAllOpen(page);
      const card = page.locator('[data-review-file="src/demo.ts"]');
      await waitForComments(page, (list) => list.length >= 1);
      await page.waitForTimeout(600);
      // 展开那条评论
      await card.locator("[data-review-pin]").first().click();
      await page.waitForTimeout(600);

      const shape = await page.evaluate(() => {
        const d = document.querySelector("[data-review-draft]");
        return {
          awaiting: d?.querySelector("[data-review-comment-awaiting]")?.textContent?.trim() ?? null,
          closed: d?.querySelector("[data-review-comment-state]")?.textContent?.trim() ?? null,
          hasCopy: d?.querySelector("[data-review-copy]") !== null,
          hasSend: d?.querySelector("[data-review-send]") !== null,
          hasClose: d?.querySelector("[data-review-close]") !== null,
        };
      });
      check("S4e·状态：awaiting=user 显示「等你回复」", shape.awaiting === "等你回复", JSON.stringify(shape));
      check("S4e·状态：未关闭时不显示「已关闭」", shape.closed === null, String(shape.closed));
      check("S4e·状态：用户能关闭任何人的评论（关闭按钮在）", shape.hasClose === true);
      check("S4f·按钮：复制与发送都在", shape.hasCopy === true && shape.hasSend === true);

      // 复制（A20）
      await card.locator("[data-review-copy]").first().click();
      await page.waitForTimeout(500);
      const clip = await page.evaluate(() => navigator.clipboard.readText().catch(() => ""));
      check("S4f·复制：剪贴板拿到带位置头的文本", clip.includes("【src/demo.ts:L2】"), clip.slice(0, 80));

      /**
       * 发送（A8/G3 之后行为变了，这是**有意的**）：
       * 不再往 textarea 里塞文本，而是在输入框上方挂一个**结构化 chip**（可逐条移除）。
       * 真正合成文本发生在用户按 Enter 时（`send()` 里用同一条 `commentsToText()`）。
       * 所以这里断言：① 出现 chip 且位置头正确；② 输入框正文**没被塞文本**（用户还能自由写）；
       * ③ 没有自动发出去；④ 点 ✕ 能把 chip 去掉。
       */
      const before = await page.locator('textarea[aria-label="输入消息"]').inputValue().catch(() => "");
      await card.locator("[data-review-send]").first().click();
      await page.waitForTimeout(700);
      const refs = await page.evaluate(() => ({
        count: document.querySelectorAll("[data-comment-ref]").length,
        labels: [...document.querySelectorAll("[data-comment-ref-label]")].map((n) => n.textContent ?? ""),
        textarea: document.querySelector('textarea[aria-label="输入消息"]')?.value ?? "",
      }));
      check("A8·发送：评论变成输入框里的引用 chip（不是塞进正文）",
        refs.count === 1 && refs.labels.some((label) => label.includes("src/demo.ts:L2")), JSON.stringify(refs));
      check("A8·发送：正文没被塞文本（用户还能自由写）", refs.textarea === before, `${JSON.stringify(before)} → ${JSON.stringify(refs.textarea)}`);
      const sent = await page.evaluate(() => document.querySelectorAll("[data-turn-user]").length);
      check("A8·发送：没有自动产生用户消息", sent === 0, `${sent}`);
      // chip 可单独移除（这是"结构化"的意义：opencode composer chip 同款）
      await page.locator("[data-comment-ref-remove]").first().click();
      await page.waitForTimeout(400);
      check("A8·发送：chip 可以单独移除", (await page.locator("[data-comment-ref]").count()) === 0);

      // 关闭（A19）
      await card.locator("[data-review-close]").first().click();
      await page.waitForTimeout(1500);
      const closed = await page.evaluate(async () => {
        const taskDir = document.querySelector("[data-review-task-dir]")?.value ?? "";
        const r = await fetch(`/api/review/comments?taskDir=${encodeURIComponent(taskDir)}`);
        return ((await r.json()).items ?? [])[0];
      });
      check("S4e·关闭：服务端 state=resolved 且记录了关闭人",
        closed?.state === "resolved" && closed?.resolvedBy?.kind === "user", JSON.stringify({ state: closed?.state, by: closed?.resolvedBy }));
      await ensureAllOpen(page);
      await page.waitForTimeout(800);
      /**
       * S4-h 之后行为变了（这是**有意的**，不是回归）：已关闭的评论默认不渲染
       * （GitHub/Gitea 同款），要看必须点「显示已关闭」。
       * 所以这里断言的是闭环：关闭 → 默认看不到 → 打开开关能看到「已关闭」。
       */
      const hiddenByDefault = await page.evaluate(() => document.querySelectorAll("[data-review-comment-state]").length);
      check("S4e·关闭：关闭后默认不再渲染（G7 收起已关闭）", hiddenByDefault === 0, `${hiddenByDefault}`);
      const toggleResolved = page.locator("[data-review-show-resolved]").first();
      if ((await toggleResolved.count()) > 0) {
        await toggleResolved.click();
        await page.waitForTimeout(600);
        const badge = await page.evaluate(() => document.querySelector("[data-review-comment-state]")?.textContent?.trim() ?? null);
        check("S4e·关闭：打开「显示已关闭」后界面显示「已关闭」", badge === "已关闭", String(badge));
      } else {
        check("S4e·关闭：有「显示已关闭」开关", false, "找不到 [data-review-show-resolved]");
      }
    }
  }
  await context.close();
}

// ── 3.18 线程（S4-h）：回复 / 等待方 / 复制全部 / 已关闭默认隐藏 / 整块高亮 ──────
{
  const context = await browser.newContext({ viewport: { width: 1680, height: 1000 }, permissions: ["clipboard-read", "clipboard-write"] });
  const page = await context.newPage();
  page.on("pageerror", (error) => check(`无页面崩溃（${String(error).slice(0, 60)}）`, false));
  await page.route(/\/api\/review\/diff$/, (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(FIXTURE) }));
  await page.route(/\/review-sources$/, (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [{ kind: "worktree", path: "/tmp/demo-worktree" }, { kind: "lifeos", path: "/tmp/demo-lifeos" }] }) }));
  await page.goto(APP_URL, { waitUntil: "domcontentloaded" });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2000);
  if (await openReview(page)) {
    /**
     * 造三条：①用户提的（3 行范围，用于整块高亮）②它的一条 Agent 回复 ③一条已关闭的。
     * 用真后端（契约必须在真语义上跑，不然测的是 mock）。
     */
    const ids = await page.evaluate(async () => {
      const taskDir = document.querySelector("[data-review-task-dir]")?.value ?? "";
      const post = (payload) => fetch("/api/review/comments", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ taskDir, ...payload }),
      }).then((r) => r.json());
      await post({ op: "clear" });
      const a = await post({ op: "add", comment: { taskId: "0010", author: { kind: "user", id: "xu-later" }, anchor: { source: "worktree", path: "src/demo.ts", side: "new", start: 1, end: 3, snapshot: "const a = 1;\nconst b = 22;\nconst c = 3;" }, body: "这三行能不能合并？", marks: ["query"], state: "open" } });
      await post({ op: "reply", id: a.comment.id, reply: { author: { kind: "agent", id: "coder" }, body: "已合并，见 src/demo.ts:1-4。" } });
      const c = await post({ op: "add", comment: { taskId: "0010", author: { kind: "user", id: "xu-later" }, anchor: { source: "worktree", path: "src/demo.ts", side: "new", start: 4, end: 4 }, body: "这条已经处理完了。", marks: [], state: "open" } });
      await post({ op: "state", id: c.comment.id, state: "resolved", by: { kind: "user", id: "xu-later" } });
      return { a: a.comment.id };
    });
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1600);
    if (await openReview(page, { clean: false })) {
      await ensureAllOpen(page);
      await waitForComments(page, (list) => list.length >= 2);
      await page.waitForTimeout(600);
      const card = page.locator('[data-review-file="src/demo.ts"]');

      // G7：已关闭默认隐藏（但数据还在）
      const visibleClosed = await page.locator("[data-review-draft] [data-review-comment-state]").count();
      check("S4h·G7 已关闭的评论默认不渲染", visibleClosed === 0, `${visibleClosed}`);
      // 开关在**面板头部**（它是全局面板级的，不属于某个文件卡）
      const toggle = page.locator('[data-testid="review-panel"] [data-review-show-resolved]').first();
      check("S4h·G7 有「显示已关闭」开关（不是把功能藏起来）", (await toggle.count()) > 0);
      if ((await toggle.count()) > 0) {
        /**
         * 折叠态下卡片默认不渲染（D19：行末头像组），所以"能看见"的证据是**行末头像针多一个**
         * （已关闭那条锚在第 4 行，未关闭那条锚在 1-3 行 → 收起来时只有 1 个针）。
         * 断言针数而不是卡片数：这才是用户在这一屏真正能看到的东西。
         */
        const pinsBefore = await page.locator("[data-review-pin]").count();
        await toggle.first().click();
        await page.waitForTimeout(600);
        const pinsAfter = await page.locator("[data-review-pin]").count();
        check("S4h·G7 打开开关后已关闭那条出现在行末（针 +1）", pinsAfter === pinsBefore + 1, `${pinsBefore} → ${pinsAfter}`);
        await toggle.first().click();     // 关回去，后续断言在"只看未关闭"的状态下做
        await page.waitForTimeout(400);
        const pinsBack = await page.locator("[data-review-pin]").count();
        check("S4h·G7 再关回去针数恢复", pinsBack === pinsBefore, `${pinsBack} vs ${pinsBefore}`);
      }

      // 展开用户提的那条（有回复）
      await card.locator("[data-review-pin]").first().click();
      await page.waitForTimeout(600);

      const thread = await page.evaluate(() => ({
        replies: [...document.querySelectorAll("[data-review-reply-body]")].map((n) => n.textContent ?? ""),
        hasReplyInput: document.querySelectorAll("[data-review-reply-input]").length,
        awaitingText: document.querySelector("[data-review-comment-awaiting]")?.textContent ?? null,
        copyAll: document.querySelector("[data-review-copy-all]")?.textContent ?? null,
      }));
      check("S4h·回复：Agent 的回复显示在线程里", thread.replies.some((t) => t.includes("已合并")), JSON.stringify(thread.replies));
      check("S4h·回复：有回复输入框", thread.hasReplyInput === 1, `${thread.hasReplyInput}`);
      check("S4h·交棒：Agent 回复后显示「等你回复」", thread.awaitingText === "等你回复", String(thread.awaitingText));
      check("S4h·G2：有「复制全部 N」且只数未关闭的", /复制全部 1/.test(thread.copyAll ?? ""), String(thread.copyAll));

      // A22：整块高亮（3 行范围 → first/middle/last 三段，而不是每行一圈）
      const blocks = await page.evaluate(() => [...document.querySelectorAll("[data-review-drafted-block]")].map((n) => n.getAttribute("data-review-drafted-block")));
      check("S4h·A22 三行范围渲染成 first/middle/last 的整块（不是每行一圈）",
        blocks.join(",") === "first,middle,last", blocks.join(","));

      // 回复：用户输入并提交 → 落盘 + awaiting 翻回 agent
      await card.locator("[data-review-reply-input]").first().fill("好，我看过了，你说得对");
      await card.locator("[data-review-reply-submit]").first().click();
      const after = await waitForComments(page, (list) => (list.find((c) => c.id === ids.a)?.replies ?? []).length >= 2);
      const target = after.find((c) => c.id === ids.a);
      check("S4h·回复：用户回复落盘（2 条回复）", (target?.replies ?? []).length === 2, JSON.stringify((target?.replies ?? []).map((r) => r.body)));
      check("S4h·交棒：用户回复后 awaiting 变成 agent", target?.awaiting === "agent", String(target?.awaiting));

      /**
       * A4-余：回复的**编辑**（内联改正文，作者或用户）。
       * 服务端接口 `op:"reply-update"` 已有单测（S4h·6 / S4hAPI·6），这里验的是界面真的接上了。
       */
      const editBtn = page.locator("[data-review-reply-edit]").first();
      if ((await editBtn.count()) > 0) {
        await editBtn.click();
        await page.waitForTimeout(300);
        await page.locator("[data-review-reply-edit-input]").first().fill("改过的回复内容");
        await page.locator("[data-review-reply-edit-save]").first().click();
        await page.waitForTimeout(1200);
        const edited = (await serverComments(page)).find((c) => c.id === ids.a)?.replies?.[0]?.body;
        check("A4-余·回复编辑：服务端的回复正文被改过来了", edited === "改过的回复内容", String(edited));
      } else {
        check("A4-余·回复编辑：有编辑按钮", false, "找不到 [data-review-reply-edit]");
      }

      // A18：关闭后能重开（误关的退路）
      const closeBtn = page.locator("[data-review-close]").first();
      if ((await closeBtn.count()) > 0) {
        await closeBtn.click();
        await page.waitForTimeout(1200);
        // 打开"显示已关闭"才看得到那条（G7）
        await page.locator("[data-review-show-resolved]").first().click();
        await page.waitForTimeout(800);
        const reopen = page.locator("[data-review-reopen]").first();
        check("A18·重开：关闭后卡片出现「重开」按钮", (await reopen.count()) > 0);
        if ((await reopen.count()) > 0) {
          await reopen.click();
          await page.waitForTimeout(1200);
          const reopened = (await serverComments(page)).find((c) => c.id === ids.a)?.state;
          check("A18·重开：服务端回到 open", reopened === "open", String(reopened));
        }
        await page.locator("[data-review-show-resolved]").first().click().catch(() => undefined);
        await page.waitForTimeout(400);
      }

      // G2：复制全部拿到两条（未关闭的），且带位置头与回复
      await page.locator("[data-review-copy-all]").first().click().catch(() => undefined);
      await page.waitForTimeout(500);
      const clipAll = await page.evaluate(() => navigator.clipboard.readText().catch(() => ""));
      /**
       * 注意：前面 A4-余 那条用例**改过** Agent 的回复正文，
       * 所以这里不能断言原文案「已合并」——断言"含回复记号与改后的正文"才不会被用例顺序影响
       * （夹具之间互相污染是本项目踩过的坑，C186/C187）。
       */
      const currentReply = (await serverComments(page)).find((c) => c.id === ids.a)?.replies?.[0]?.body ?? "";
      check("S4h·G2 复制全部：含位置头与 Agent 回复的正文（用服务端当前值断言，不写死文案）",
        clipAll.includes("【src/demo.ts:L1-L3】") && currentReply !== "" && clipAll.includes(currentReply), clipAll.slice(0, 160));
      check("S4h·G2 复制全部：**不含**已关闭那条", clipAll.includes("这条已经处理完了") === false, clipAll.slice(0, 120));

      /**
       * G1「等谁」的界面入口：一个按钮轮转 null → agent → user → null，
       * 每点一次都要真的落到服务端（不是只改 UI 状态）。
       */
      /**
       * G1「等谁」的界面入口：一个按钮轮转 null → agent → user → null。
       * 关键是**每一档都由服务端确认**（不是只改 UI 状态），所以每点一次都回读服务端。
       * 轮转的起点取决于前面回复动作把 awaiting 推到了哪一档，所以断言"每点一次就换代"而不是硬编码起点。
       */
      const awaitingBtn = page.locator("[data-review-awaiting-toggle]").first();
      const seen = [];
      for (let i = 0; i < 3; i += 1) {
        await awaitingBtn.click();
        await page.waitForTimeout(900);
        seen.push((await serverComments(page)).find((c) => c.id === ids.a)?.awaiting ?? null);
      }
      check("S4h·G1 每点一次「等谁」都真的落到服务端（三档轮转）",
        seen[0] !== seen[1] && seen[1] !== seen[2] && seen[0] !== seen[2], JSON.stringify(seen));
      check("S4h·G1 三档覆盖到「不指定」（null 也能被选中）", seen.includes(null), JSON.stringify(seen));
    }
  }
  await context.close();
}

// ── 3.19 A8/G3：评论引用 → 发送时合成文本（拦截 POST，不调模型）──────────────────
{
  const context = await browser.newContext({ viewport: { width: 1680, height: 1000 } });
  const page = await context.newPage();
  page.on("pageerror", (error) => check(`无页面崩溃（${String(error).slice(0, 60)}）`, false));
  await page.route(/\/api\/review\/diff$/, (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(FIXTURE) }));
  await page.route(/\/review-sources$/, (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [{ kind: "worktree", path: "/tmp/demo-worktree" }, { kind: "lifeos", path: "/tmp/demo-lifeos" }] }) }));
  await page.goto(APP_URL, { waitUntil: "domcontentloaded" });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2000);
  if (await openReview(page)) {
    /**
     * 拦截发消息：**不调模型**也要验完整链路（用户原话要求端到端）。
     * 断言的是"真的发出去的那段文本"——不是 chip 长得对，而是 Agent 会收到什么。
     */
    const sent = [];
    await page.route(/\/sessions\/[^/]+\/messages$/, async (route) => {
      const body = route.request().postDataJSON();
      sent.push(body);
      await route.fulfill({ status: 202, contentType: "application/json", body: JSON.stringify({ accepted: true }) });
    });
    await page.evaluate(async () => {
      const taskDir = document.querySelector("[data-review-task-dir]")?.value ?? "";
      const post = (payload) => fetch("/api/review/comments", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ taskDir, ...payload }),
      }).then((r) => r.json());
      await post({ op: "clear" });
      await post({ op: "add", comment: { taskId: "0010", author: { kind: "user", id: "xu-later" }, anchor: { source: "worktree", path: "src/demo.ts", side: "new", start: 2, end: 3, snapshot: "const a = 1;\nconst b = 22;" }, body: "这两行合并一下？", marks: ["query"], state: "open" } });
    });
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1600);
    if (await openReview(page, { clean: false })) {
      await ensureAllOpen(page);
      await waitForComments(page, (list) => list.length >= 1);
      await page.waitForTimeout(600);
      const card = page.locator('[data-review-file="src/demo.ts"]');
      await card.locator("[data-review-pin]").first().click();
      await page.waitForTimeout(500);
      /**
       * 状态不被编辑污染（S4i）：把一条 **open** 的评论正文改掉，状态必须还是 `open`。
       * 早先 `onChangeDraft` 写死 `state:"draft"`，一次编辑就把"已在讨论中"降级成草稿——
       * 数据事实被编辑动作改写（`pendingFor` / 徽标 / 复制全跟着变）。
       * 这里改的是**屏幕上那条**（demo.ts，用 op:add 建成 open），断言服务端状态。
       */
      const beforeEdit = (await serverComments(page)).find((c) => c.anchor.path === "src/demo.ts");
      if (beforeEdit !== undefined) {
        const noteArea = page.locator(`[data-review-draft-note="${beforeEdit.id}"]`);
        if ((await noteArea.count()) > 0) {
          await noteArea.fill("用户改过的正文");
          await page.waitForTimeout(1500);
          const afterEdit = (await serverComments(page)).find((c) => c.id === beforeEdit.id);
          check("S4i·编辑不改状态：改 open 评论的正文后状态仍是 open", afterEdit?.state === "open", String(afterEdit?.state));
          check("S4i·编辑生效：正文被保存", afterEdit?.body === "用户改过的正文", String(afterEdit?.body));
        } else {
          check("S4i·编辑不改状态：找得到那条正文输入框", false, "noteArea 命中 0 个");
        }
      } else {
        check("S4i·编辑不改状态：夹具里应有 src/demo.ts 的评论", false);
      }

      await card.locator("[data-review-send]").first().click();
      await page.waitForTimeout(400);
      // 用户再补一句自己的话
      await page.locator('textarea[aria-label="输入消息"]').fill("顺便把注释也补上");
      const count = await page.locator("[data-comment-ref]").count();
      check("A8·端到端：评论引用挂在输入框（1 条）", count === 1, `${count}`);
      await page.locator('button[aria-label="发送"], button:has-text("发送")').first().click().catch(() => undefined);
      await page.keyboard.press("Enter");
      await page.waitForTimeout(1500);
      const text = sent.at(-1)?.text ?? "";
      // 正文在上面被编辑改过 → 用服务端**当前值**断言（写死文案会被用例顺序打红）
      const currentBody = (await serverComments(page)).find((c) => c.anchor.path === "src/demo.ts")?.body ?? "";
      check("A8·端到端：真正发出去的消息里带位置头与评论正文",
        text.includes("【src/demo.ts:L2-L3】") && currentBody !== "" && text.includes(currentBody), JSON.stringify(text.slice(0, 200)));
      check("A8·端到端：用户自己补的话也在同一条消息里（不是两条）", text.includes("顺便把注释也补上") && sent.length === 1, `${sent.length} 条 / ${JSON.stringify(text.slice(-60))}`);
      await page.waitForTimeout(600);
      check("A8·端到端：发送成功后 chip 被清空（不残留）", (await page.locator("[data-comment-ref]").count()) === 0);
    }
  }
  await context.close();
}

// ── 3.20 G13 键盘导航：j/k 行、n/p 块、]/[ 文件、? 帮助、输入框里不抢键 ──────────
{
  const context = await browser.newContext({ viewport: { width: 1680, height: 1000 } });
  const page = await context.newPage();
  page.on("pageerror", (error) => check(`无页面崩溃（${String(error).slice(0, 60)}）`, false));
  await page.route(/\/api\/review\/diff$/, (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(FIXTURE) }));
  await page.route(/\/review-sources$/, (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [{ kind: "worktree", path: "/tmp/demo-worktree" }, { kind: "lifeos", path: "/tmp/demo-lifeos" }] }) }));
  await page.goto(APP_URL, { waitUntil: "domcontentloaded" });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2000);
  if (await openReview(page)) {
    await ensureAllOpen(page);
    await page.waitForTimeout(500);
    const cursorAnchor = () => page.evaluate(() => document.querySelector("[data-review-cursor]")?.getAttribute("data-review-line-anchor") ?? null);

    await page.keyboard.press("j");
    await page.waitForTimeout(250);
    const first = await cursorAnchor();
    check("G13·j：第一下出现可见光标（有 data-review-cursor）", first !== null, String(first));
    await page.keyboard.press("j");
    await page.waitForTimeout(250);
    const second = await cursorAnchor();
    check("G13·j：再按一下移到下一行", second !== null && second !== first, `${first} → ${second}`);
    await page.keyboard.press("k");
    await page.waitForTimeout(250);
    check("G13·k：回到上一行", (await cursorAnchor()) === first, `${second} → ${await cursorAnchor()}`);

    /**
     * n：跳到下一个改动块。**必须同时比「文件 + 锚点」**——不同文件的锚点可能都是 `new:1`，
     * 只比锚点会得到"没动"的假红（第一次就踩到了）。
     */
    const cursorWhere = () => page.evaluate(() => {
      const el = document.querySelector("[data-review-cursor]");
      if (el === null) return null;
      return `${el.closest("[data-review-file]")?.getAttribute("data-review-file") ?? "?"}@${el.getAttribute("data-review-line-anchor") ?? "?"}`;
    });
    const beforeN = await cursorWhere();
    await page.keyboard.press("n");
    await page.waitForTimeout(300);
    const afterN = await cursorWhere();
    check("G13·n：跳到下一个改动块（文件或行号变化）", afterN !== null && afterN !== beforeN, `${beforeN} → ${afterN}`);

    // ]：跳到下一个文件
    await page.keyboard.press("]");
    await page.waitForTimeout(300);
    const afterBracket = await page.evaluate(() => {
      const el = document.querySelector("[data-review-cursor]");
      return el?.closest("[data-review-file]")?.getAttribute("data-review-file") ?? null;
    });
    check("G13·]：跳到下一个文件", afterBracket !== null, String(afterBracket));

    // ?：帮助浮层
    await page.keyboard.press("?");
    await page.waitForTimeout(400);
    const helpKeys = await page.evaluate(() => [...document.querySelectorAll("[data-review-help-key]")].map((n) => n.textContent));
    check("G13·?：帮助浮层列出键位（≥8 条，且含 j / n / ]）",
      helpKeys.length >= 8 && helpKeys.includes("j / ↓") && helpKeys.includes("n") && helpKeys.includes("]"), JSON.stringify(helpKeys));
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
    check("G13·Esc：先关帮助（不关面板）", (await page.locator("[data-review-help]").count()) === 0 && (await page.locator('[data-testid="review-panel"]').count()) === 1);

    /**
     * 最关键的一条：**在输入框里打字时快捷键不能抢键**。
     * 用户写评论时按 j 必须打出一个 j（difit `enableOnFormTags:false` 同款取向）。
     */
    // 先造一条评论并展开（折叠态没有 textarea；不造就只能跳过这条最关键的守卫）
    await page.evaluate(async () => {
      const taskDir = document.querySelector("[data-review-task-dir]")?.value ?? "";
      await fetch("/api/review/comments", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ taskDir, op: "add", comment: { taskId: "0010", author: { kind: "user", id: "xu-later" }, anchor: { source: "worktree", path: "src/demo.ts", side: "new", start: 2, end: 2 }, body: "键盘用例的夹具", marks: [], state: "open" } }),
      });
    });
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1600);
    if (await openReview(page, { clean: false })) {
      await ensureAllOpen(page);
      await waitForComments(page, (list) => list.length >= 1);
      await page.waitForTimeout(500);
      await page.locator('[data-review-file="src/demo.ts"] [data-review-pin]').first().click().catch(() => undefined);
      await page.waitForTimeout(600);
    }
    const noteArea = page.locator("[data-review-draft-note]").first();
    if ((await noteArea.count()) > 0) {
      await noteArea.click();
      await noteArea.fill("");
      await page.keyboard.type("jjj");
      const typed = await noteArea.inputValue();
      check("G13·守卫：在评论输入框里按 j 是打字，不是导航", typed === "jjj", JSON.stringify(typed));
    } else {
      check("G13·守卫：夹具里应有可写的评论输入框", false);
    }
  }
  await context.close();
}

// ── 3.21 G5/G6：大 diff 提示 + 懒挂载占位 + 首屏只挂 8 个 ─────────────────────
{
  const context = await browser.newContext({ viewport: { width: 1680, height: 1000 } });
  const page = await context.newPage();
  page.on("pageerror", (error) => check(`无页面崩溃（${String(error).slice(0, 60)}）`, false));

  /**
   * 夹具：1 个**超大**文件（600 行改动 → 触发 500 行门槛）+ 12 个普通文件（触发首屏只挂 8 个）。
   * 行用生成器造，不手写 600 行。
   */
  const bigLines = Array.from({ length: 620 }, (_, i) => ({ type: "added", oldNo: null, newNo: i + 1, text: `big line ${i + 1}` }));
  const manyFiles = Array.from({ length: 12 }, (_, i) => ({
    path: `many/f${i}.ts`, kind: "code", status: "modified", additions: 1, deletions: 0,
    hunks: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 2, lines: [
      { type: "context", oldNo: 1, newNo: 1, text: "a" },
      { type: "added", oldNo: null, newNo: 2, text: `file ${i}` },
    ] }],
  }));
  const FIX = { items: [{
    source: { kind: "worktree", path: "/tmp/demo-worktree", exists: true, branch: "dev/demo" },
    files: [
      { path: "big.ts", kind: "code", status: "modified", additions: 620, deletions: 0,
        hunks: [{ oldStart: 0, oldLines: 0, newStart: 1, newLines: 620, lines: bigLines }] },
      ...manyFiles,
    ],
    truncated: false,
  }] };
  await page.route(/\/api\/review\/diff$/, (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(FIX) }));
  /**
   * `/review-sources` 必须同时给 `worktree` 与 `lifeos` 两项：
   * 打开面板的入口（`App.tsx` 的「检视当前 Task 的改动」）取的是 **lifeos 项的 path** 当检视对象，
   * 缺它就 `toast("拿不到这个 Task 的目录")` 且面板不出现——整段用例会静默跳过（假绿）。
   * 这是本用例第一次写漏的东西，由「前置断言先行」当场抓出来。
   */
  await page.route(/\/review-sources$/, (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [{ kind: "worktree", path: "/tmp/demo-worktree" }, { kind: "lifeos", path: "/tmp/demo-lifeos" }] }) }));
  await page.goto(APP_URL, { waitUntil: "domcontentloaded" });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "domcontentloaded" });
  /**
   * 先等「检视」按钮出现再点——它依赖"已选中一个会话"，冷启动 + 拉会话列表可能超过 2 秒
   * （实测本机 3–4 秒；等固定 2000ms 会偶发拿不到按钮，整段用例静默跳过 = 假绿）。
   */
  await page.getByRole("button", { name: "检视当前 Task 的改动" }).first().waitFor({ timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(500);
  const g56Opened = await openReview(page);
  /**
   * **前置断言先行**（C193 的教训）：`if (opened) { … }` 里条件不成立时整段验证会静默蒸发，
   * 测试仍然全绿。所以这里先把"面板真的开了"记成一条断言。
   */
  check("G5/G6·前置：检视面板打开（否则下面几条等于没测）", g56Opened === true);
  if (g56Opened) {
    // 全部展开（13 个文件）
    await ensureAllOpen(page);
    await page.waitForTimeout(1200);

    const layout = await page.evaluate(() => ({
      placeholders: [...document.querySelectorAll("[data-review-placeholder]")].map((n) => n.getAttribute("data-review-placeholder")),
      mountedDiffs: [...document.querySelectorAll("[data-review-diff]")].map((n) => n.getAttribute("data-review-diff")),
      placeholderHeight: document.querySelector("[data-review-placeholder]")?.getBoundingClientRect().height ?? 0,
    }));
    /**
     * G6：首屏只挂 8 个 —— 但 big.ts 在最前面，所以它必挂；后面 12 个里应该有占位。
     * 关键断言：**真的有占位**（否则懒挂载等于没做）且占位高度是 160（与 opencode 同值）。
     */
    check("G6·懒挂载：首屏之外的文件先渲染占位", layout.placeholders.length > 0, `占位 ${layout.placeholders.length} 个 / 已挂 ${layout.mountedDiffs.length} 个`);
    check("G6·占位高度 160px（opencode session-review.tsx:660 同值）",
      Math.round(layout.placeholderHeight) === 160, `${layout.placeholderHeight}`);

    // 滚到占位处 → 应挂载（IntersectionObserver 提前 1200px）
    const firstPlaceholder = page.locator("[data-review-placeholder]").first();
    if ((await firstPlaceholder.count()) > 0) {
      const before = layout.placeholders.length;
      /**
       * 滚到占位处。**必须滚到可视区内**：`scrollIntoViewIfNeeded()` 在元素已在"预取区"
       * 但仍在视口外时可能什么都不做，IntersectionObserver 就不会触发——实测占位数不变。
       * 这里用 `scrollIntoView({block:"center"})` 明确把它放到视口中间。
       */
      await firstPlaceholder.evaluate((node) => node.scrollIntoView({ block: "center" }));
      await page.waitForTimeout(1500);
      const after = await page.locator("[data-review-placeholder]").count();
      check("G6·滚动到占位 → 自动挂载（占位减少）", after < before, `${before} → ${after}`);
    }

    // G5：big.ts 展开后给提示 + 只渲染前 200 行 + 点「全部展开」后不再提示
    const bigCard = page.locator('[data-review-file="big.ts"]');
    await bigCard.scrollIntoViewIfNeeded();
    await page.waitForTimeout(800);
    const notice = bigCard.locator("[data-review-large-diff]");
    check("G5·大 diff：超 500 行的文件给出提示（不是把内容藏起来）", (await notice.count()) > 0);
    const renderedRows = await bigCard.locator("[data-line]").count();
    check("G5·大 diff：默认只渲染前 200 行左右（不是 620 行全渲染）", renderedRows > 0 && renderedRows <= 240, `${renderedRows} 行`);
    if ((await bigCard.locator("[data-review-large-force]").count()) > 0) {
      await bigCard.locator("[data-review-large-force]").first().click();
      await page.waitForTimeout(1000);
      const afterForce = await bigCard.locator("[data-line]").count();
      check("G5·大 diff：点「全部展开」后渲染全部（行数显著增加）", afterForce > renderedRows * 2, `${renderedRows} → ${afterForce}`);
      check("G5·大 diff：全部展开后提示消失", (await bigCard.locator("[data-review-large-diff]").count()) === 0);
    }
  }
  await context.close();
}

// ── 3.22 G10 已看进度 + G9 文件树三态 ───────────────────────────────────────
{
  const context = await browser.newContext({ viewport: { width: 1680, height: 1000 } });
  const page = await context.newPage();
  page.on("pageerror", (error) => check(`无页面崩溃（${String(error).slice(0, 60)}）`, false));
  await page.route(/\/api\/review\/diff$/, (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(FIXTURE) }));
  await page.route(/\/review-sources$/, (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [{ kind: "worktree", path: "/tmp/demo-worktree" }, { kind: "lifeos", path: "/tmp/demo-lifeos" }] }) }));
  await page.goto(APP_URL, { waitUntil: "domcontentloaded" });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "domcontentloaded" });
  // 等「检视」按钮真的出现再点（冷启动 3–4 秒；固定等待会偶发拿不到 → 整段静默跳过）
  await page.getByRole("button", { name: "检视当前 Task 的改动" }).first().waitFor({ timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(400);
  const g10Opened = await openReview(page);
  check("G10·前置：检视面板打开（否则下面几条等于没测）", g10Opened === true);
  if (g10Opened) {
    // 清空进度，保证起点可预期
    await page.evaluate(async () => {
      const taskDir = document.querySelector("[data-review-task-dir]")?.value ?? "";
      await fetch("/api/review/viewed", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ taskDir, op: "clear" }) });
    });
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1800);
    if (await openReview(page, { clean: false })) {
      await ensureAllOpen(page);
      await page.waitForTimeout(600);

      const summaryBefore = await page.locator("[data-review-viewed-count]").innerText().catch(() => "");
      check("G10·进度：初始为 0/N", /^0\//.test(summaryBefore), summaryBefore);

      // 标记一个文件已看 → 进度 +1，且**落服务端**
      const firstToggle = page.locator("[data-review-viewed-toggle]").first();
      const firstName = await firstToggle.getAttribute("data-review-viewed-toggle");
      await firstToggle.click();
      await page.waitForTimeout(1200);
      const serverRecords = await page.evaluate(async () => {
        const taskDir = document.querySelector("[data-review-task-dir]")?.value ?? "";
        return (await (await fetch(`/api/review/viewed?taskDir=${encodeURIComponent(taskDir)}`)).json()).items ?? [];
      });
      check("G10·标记已看：写进服务端（不是只改界面）", serverRecords.some((record) => record.path === firstName), JSON.stringify(serverRecords.map((r) => r.path)));
      const summaryAfter = await page.locator("[data-review-viewed-count]").innerText().catch(() => "");
      check("G10·进度：标记后变成 1/N", /^1\//.test(summaryAfter), `${summaryBefore} → ${summaryAfter}`);

      /**
       * 刷新后仍在（这是"存服务端"的意义；difit 只存 localStorage，换浏览器就丢）。
       */
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.waitForTimeout(1800);
      if (await openReview(page, { clean: false })) {
        await page.waitForTimeout(800);
        const afterReload = await page.locator("[data-review-viewed-count]").innerText().catch(() => "");
        check("G10·刷新后进度仍在（服务端持久化）", /^1\//.test(afterReload), afterReload);
      }

      // 文件树三态：目录勾选一次把该目录下所有文件标上
      const treeSummary = page.locator("[data-review-tree-summary]");
      check("G9·文件树：面板里有可展开的文件树", (await treeSummary.count()) > 0);
      if ((await treeSummary.count()) > 0) {
        await treeSummary.first().click();
        await page.waitForTimeout(500);
        const dirButtons = page.locator("[data-review-tree-dir]");
        const fileButtons = page.locator("[data-review-tree-file]");
        check("G9·文件树：列出目录与文件", (await dirButtons.count()) + (await fileButtons.count()) > 0,
          `目录 ${await dirButtons.count()} / 文件 ${await fileButtons.count()}`);
        if ((await dirButtons.count()) > 0) {
          await dirButtons.first().click();
          await page.waitForTimeout(1400);
          const states = await page.evaluate(() => [...document.querySelectorAll("[data-review-tree-dir]")].map((node) => node.getAttribute("data-review-tree-dir-state")));
          check("G9·勾选目录 → 该目录下文件全部标为已看（目录变 all）", states.includes("all"), JSON.stringify(states));
          const summaryAll = await page.locator("[data-review-viewed-count]").innerText().catch(() => "");
          check("G10·批量标记后进度上升", summaryAll !== summaryAfter, `${summaryAfter} → ${summaryAll}`);
        }
      }
    }
  }
  await context.close();
}

// ── 3.23 G8 语法高亮：真的分出 token 颜色（不是"加了依赖"就算做完）─────────────
{
  const context = await browser.newContext({ viewport: { width: 1680, height: 1000 } });
  const page = await context.newPage();
  page.on("pageerror", (error) => check(`无页面崩溃（${String(error).slice(0, 60)}）`, false));

  /**
   * 夹具刻意用**真 TypeScript**（有一眼能认出的 keyword/string/comment/number），
   * 并且**blob 接口也要打桩**——高亮取的是全文（diff 只有 3 行上下文，靠 blob 补全文）。
   * 不打桩 blob 的话，高亮会静默不生效而用例仍然"通过"。
   */
  const TS_SOURCE = [
    "// 第一行注释",
    "const answer: number = 42;",
    'const label = "hello";',
    "function greet(name: string) {",
    "  return `hi ${name}`;",
    "}",
  ].join("\n") + "\n";
  await page.route(/\/api\/review\/blob/, (route) => route.fulfill({
    status: 200, contentType: "application/json",
    body: JSON.stringify({ content: TS_SOURCE, truncated: false }),
  }));
  await page.route(/\/api\/review\/diff$/, (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(FIXTURE) }));
  await page.route(/\/review-sources$/, (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [{ kind: "worktree", path: "/tmp/demo-worktree" }, { kind: "lifeos", path: "/tmp/demo-lifeos" }] }) }));
  await page.goto(APP_URL, { waitUntil: "domcontentloaded" });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1800);
  const g8Opened = await openReview(page);
  check("G8·前置：检视面板打开（否则下面几条等于没测）", g8Opened === true);
  if (g8Opened) {
    await ensureAllOpen(page);
    await page.waitForTimeout(2000);   // 等 blob + 分词
    const syn = await page.evaluate(() => {
      const spans = [...document.querySelectorAll("[data-syn]")];
      return {
        count: spans.length,
        kinds: [...new Set(spans.map((node) => node.getAttribute("data-syn")))],
        colors: [...new Set(spans.map((node) => getComputedStyle(node).color))],
      };
    });
    check("G8·高亮：diff 里真的出现了带 token 类型的 span", syn.count > 0, JSON.stringify(syn.kinds));
    check("G8·高亮：至少分出 3 类 token（keyword/string/comment 级）", syn.kinds.length >= 3, JSON.stringify(syn.kinds));
    /**
     * **颜色必须真的不同**——只断言"有 span"会漏掉"类名生成了但 Tailwind 没编译"（高亮静默全黑）。
     * 这是 Tailwind 4 只扫静态类名导致的经典坑，所以这里查 computedStyle。
     */
    check("G8·高亮：不同 token 类型渲染出不同颜色（Tailwind 类真的生成了）", syn.colors.length >= 3, JSON.stringify(syn.colors));

    // markdown（doc 类）**不**高亮（D4：md 用源码行级 diff，不做行内标记高亮）
    const mdSpans = await page.evaluate(() => {
      const cards = [...document.querySelectorAll('[data-review-file$=".md"]')];
      return cards.reduce((sum, card) => sum + card.querySelectorAll("[data-syn]").length, 0);
    });
    check("G8·范围：.md 文件不做语法高亮（只对 code 类生效）", mdSpans === 0, `${mdSpans}`);
  }
  await context.close();
}

// ── 3.24 G14 折叠未改行：↑N/↓N/全部 **+ 折叠**（折得回去，全展开时也有）────────
{
  const context = await browser.newContext({ viewport: { width: 1680, height: 1000 } });
  const page = await context.newPage();
  page.on("pageerror", (error) => check(`无页面崩溃（${String(error).slice(0, 60)}）`, false));
  /**
   * gap 段的内容**不在 patch 里**，展开要调 `/api/review/blob` 取全文。
   * 不打桩 → 真后端按 FIXTURE 的假路径去读文件 → 404 → 展开静默失败（行数不变），
   * 用例变成"点了一下没反应"。这是第一次跑 G14 时就踩到的（32 → 32）。
   */
  const G14_FULL = Array.from({ length: 220 }, (_, i) => `line ${i + 1}`).join("\n") + "\n";
  await page.route(/\/api\/review\/blob/, (route) => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify({ content: G14_FULL, truncated: false }),
  }));
  await page.route(/\/api\/review\/diff$/, (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(FIXTURE) }));
  await page.route(/\/review-sources$/, (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [{ kind: "worktree", path: "/tmp/demo-worktree" }, { kind: "lifeos", path: "/tmp/demo-lifeos" }] }) }));
  await page.goto(APP_URL, { waitUntil: "domcontentloaded" });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "检视当前 Task 的改动" }).first().waitFor({ timeout: 15000 }).catch(() => {});
  let g14Opened = await openReview(page);
  if (!g14Opened) {
    // openReview 的 clean 分支会 reload 页面；冷启动时按钮可能还没回来，再等一次（C193 的老教训）
    await page.getByRole("button", { name: "检视当前 Task 的改动" }).first().waitFor({ timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(500);
    g14Opened = await openReview(page, { clean: false });
  }
  check("G14·前置：检视面板打开（否则下面几条等于没测）", g14Opened === true);
  if (g14Opened) {
    await ensureAllOpen(page);
    await page.waitForTimeout(1200);
    const gapBar = page.locator('[data-review-hidden="gap"]').first();
    check("G14·折叠条存在（FIXTURE 的 big.md 有 90/80 行 gap）", (await gapBar.count()) > 0);
    if ((await gapBar.count()) > 0) {
      const rowsNow = () => page.evaluate(() => document.querySelectorAll("[data-review-diff] [data-review-line-anchor]").length);
      const before = await rowsNow();
      check("G14·初始：未展开时没有「折叠」按钮（没东西可折）",
        (await gapBar.locator('[data-review-expand="collapse"]').count()) === 0);

      // ① 部分展开 → 出现「折叠」
      await gapBar.locator('[data-review-expand="up"]').first().click();
      await page.waitForTimeout(900);
      const partial = await rowsNow();
      check("G14·↑20 真的多渲染了行", partial > before, `${before} → ${partial}`);
      check("G14·展开无错误提示（blob 取不到时会静默不生效）",
        (await page.locator("[data-review-expand-error]").count()) === 0);
      check("G14·部分展开后就给「折叠」（点错了能反悔）",
        (await gapBar.locator('[data-review-expand="collapse"]').count()) === 1);

      // ② 点折叠 → 回到初始
      await gapBar.locator('[data-review-expand="collapse"]').first().click();
      await page.waitForTimeout(900);
      check("G14·折叠后行数回到初始", (await rowsNow()) === before, `${partial} → ${await rowsNow()}`);

      // ③ 全部展开 → **折叠条仍在**（这是用户 2026-11-08 指出的缺口：之前全展开后就折不回去了）
      await gapBar.locator('[data-review-expand="all"]').first().click();
      await page.waitForTimeout(1200);
      const allRows = await rowsNow();
      check("G14·全部展开后仍显示折叠条（可折回）", (await page.locator('[data-review-hidden="gap"] [data-review-expand="collapse"]').count()) >= 1);
      const label = (await page.locator('[data-review-hidden="gap"]').first().textContent()) ?? "";
      check("G14·全展开时文案变「已全部展开」（不再是「0 行未修改」）", label.includes("已全部展开"), label.slice(0, 40));

      // ④ 再折回去 → 行数恢复
      await page.locator('[data-review-hidden="gap"] [data-review-expand="collapse"]').first().click();
      await page.waitForTimeout(1000);
      check("G14·全展开后能折回初始", (await rowsNow()) === before, `${allRows} → ${await rowsNow()}`);
      check("G14·折回后「折叠」按钮消失（没东西可折）",
        (await gapBar.locator('[data-review-expand="collapse"]').count()) === 0);
    }
  }
  await context.close();
}

// ── 3.25 G11 并排视图：配对 / 两侧行号 / 两侧都能评论 / 切回单列 ────────────────
{
  const context = await browser.newContext({ viewport: { width: 1680, height: 1000 } });
  const page = await context.newPage();
  page.on("pageerror", (error) => check(`无页面崩溃（${String(error).slice(0, 60)}）`, false));
  await page.route(/\/api\/review\/blob/, (route) => route.fulfill({
    status: 200, contentType: "application/json",
    body: JSON.stringify({ content: "const a = 1;\nconst b = 2;\nconst c = 3;\n", truncated: false }),
  }));
  await page.route(/\/api\/review\/diff$/, (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(FIXTURE) }));
  await page.route(/\/review-sources$/, (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [{ kind: "worktree", path: "/tmp/demo-worktree" }, { kind: "lifeos", path: "/tmp/demo-lifeos" }] }) }));
  await page.goto(APP_URL, { waitUntil: "domcontentloaded" });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "检视当前 Task 的改动" }).first().waitFor({ timeout: 15000 }).catch(() => {});
  let g11Opened = await openReview(page);
  if (!g11Opened) {
    await page.getByRole("button", { name: "检视当前 Task 的改动" }).first().waitFor({ timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(500);
    g11Opened = await openReview(page, { clean: false });
  }
  check("G11·前置：检视面板打开（否则下面几条等于没测）", g11Opened === true);
  if (g11Opened) {
    await ensureAllOpen(page);
    await page.waitForTimeout(800);

    // ① 默认单列（不改既有行为）
    check("G11·默认单列（不突变）", (await page.locator("[data-review-split-row]").count()) === 0);

    // ② 切并排
    await page.getByRole("button", { name: "并排" }).click();
    await page.waitForTimeout(900);
    const shape = await page.evaluate(() => {
      const rows = [...document.querySelectorAll("[data-review-split-row]")];
      return {
        rows: rows.length,
        sides: rows.flatMap((row) => [...row.children].map((cell) => cell.getAttribute("data-split-side"))),
        // 每一横排必须**恰好两格**（左 old / 右 new），这是并排的定义
        perRow: rows.map((row) => row.children.length),
        anchors: [...document.querySelectorAll("[data-review-split-row] [data-review-line-anchor]")].map((n) => n.getAttribute("data-review-line-anchor")),
      };
    });
    check("G11·并排：每横排恰好两格（左 old / 右 new）",
      shape.rows > 0 && shape.perRow.every((n) => n === 2), JSON.stringify(shape.perRow));
    check("G11·并排：存在 old 与 new 两侧", shape.sides.includes("old") && shape.sides.includes("new"), JSON.stringify([...new Set(shape.sides)]));

    /**
     * ③ **两侧都能锚**（这是与单列最实质的差异）：context 行左右两格都有 data-review-line-anchor，
     * 且侧不同（`old:N` 与 `new:N`）。
     */
    const hasOldAnchor = shape.anchors.some((a) => a?.startsWith("old:"));
    const hasNewAnchor = shape.anchors.some((a) => a?.startsWith("new:"));
    check("G11·并排：old 与 new 两侧都有可锚行（左侧点 = 「原来这行」）", hasOldAnchor && hasNewAnchor, JSON.stringify(shape.anchors.slice(0, 8)));

    // ④ 左列点行号 → 建一条 old 侧的评论（证明并排的左侧真的可批注）
    const firstOld = page.locator('[data-review-split-row] [data-review-anchor], [data-review-split-row] [data-review-line-anchor^="old:"]').first();
    if ((await firstOld.count()) > 0) {
      await firstOld.click({ position: { x: 4, y: 4 } });
      await page.waitForTimeout(900);
    }

    // ⑤ 切回单列 → 还原
    await page.getByRole("button", { name: "单列" }).click();
    await page.waitForTimeout(800);
    check("G11·切回单列：并排行消失、单列行回来",
      (await page.locator("[data-review-split-row]").count()) === 0
      && (await page.locator("[data-review-diff] [data-line]").count()) > 0);
  }
  await context.close();
}

// ── 3.26 G12 词级 diff：成对增删行只标出改动的词（单列与并排都要有）─────────────
{
  const context = await browser.newContext({ viewport: { width: 1680, height: 1000 } });
  const page = await context.newPage();
  page.on("pageerror", (error) => check(`无页面崩溃（${String(error).slice(0, 60)}）`, false));

  /**
   * 夹具刻意造"只改了两个变量名"的成对行：
   * 期望词级只标 `sum`→`acc` 两处，而不是整行标色（那等于没做词级）。
   */
  const OLD_LINE = "const total = valid.reduce((sum, r) => sum + r.count, 0);";
  const NEW_LINE = "const total = valid.reduce((acc, r) => acc + r.count, 0);";
  const WORD_FIX = { items: [{
    source: { kind: "worktree", path: "/tmp/demo-worktree", exists: true, branch: "dev/demo" },
    files: [{ path: "src/sum.ts", kind: "code", status: "modified", additions: 1, deletions: 1,
      hunks: [{ oldStart: 1, oldLines: 2, newStart: 1, newLines: 2, lines: [
        { type: "removed", oldNo: 1, newNo: null, text: OLD_LINE },
        { type: "added", oldNo: null, newNo: 1, text: NEW_LINE },
        { type: "context", oldNo: 2, newNo: 2, text: "const label = 'sum';" },
      ] }] }],
    truncated: false,
  }] };
  await page.route(/\/api\/review\/blob/, (route) => route.fulfill({
    status: 200, contentType: "application/json",
    body: JSON.stringify({ content: `${OLD_LINE}\n${NEW_LINE}\n`, truncated: false }),
  }));
  await page.route(/\/api\/review\/diff$/, (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(WORD_FIX) }));
  await page.route(/\/review-sources$/, (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [{ kind: "worktree", path: "/tmp/demo-worktree" }, { kind: "lifeos", path: "/tmp/demo-lifeos" }] }) }));
  await page.goto(APP_URL, { waitUntil: "domcontentloaded" });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "检视当前 Task 的改动" }).first().waitFor({ timeout: 15000 }).catch(() => {});
  let g12Opened = await openReview(page);
  if (!g12Opened) {
    await page.getByRole("button", { name: "检视当前 Task 的改动" }).first().waitFor({ timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(500);
    g12Opened = await openReview(page, { clean: false });
  }
  check("G12·前置：检视面板打开（否则下面几条等于没测）", g12Opened === true);
  if (g12Opened) {
    await page.waitForTimeout(2000);   // 等 diff 库动态加载 + 计算

    const worded = await page.evaluate(() => {
      const nodes = [...document.querySelectorAll("[data-word-diff]")];
      return {
        count: nodes.length,
        entries: nodes.map((node) => `${node.getAttribute("data-word-diff")}:${node.textContent}`),
        colors: [...new Set(nodes.map((node) => getComputedStyle(node).backgroundColor))],
        // 词级段必须**嵌在行内**（不是替换整行）：行文本仍包含未改动的部分
        fullLineHasUnchanged: (document.querySelector("[data-review-line-text]")?.textContent ?? "").includes("const total"),
      };
    });
    check("G12·词级：出现词级高亮段", worded.count > 0, JSON.stringify(worded.entries));
    check("G12·词级：只标出改动的词（sum → acc），不是整行",
      worded.entries.filter((entry) => entry === "removed:sum").length === 2
      && worded.entries.filter((entry) => entry === "added:acc").length === 2,
      JSON.stringify(worded.entries));
    check("G12·词级：删除段与新增段颜色不同（可区分哪边是新的）",
      worded.colors.length >= 2, JSON.stringify(worded.colors));
    check("G12·词级：未改动的部分仍在行内（不是把整行替换成词级段）", worded.fullLineHasUnchanged === true);

    // 并排视图里也要有（difit 同一份结果同时用于 unified 与 split）
    await page.getByRole("button", { name: "并排" }).click();
    await page.waitForTimeout(1200);
    const splitWorded = await page.evaluate(() =>
      [...document.querySelectorAll("[data-review-split-row] [data-word-diff]")].map((node) => `${node.getAttribute("data-word-diff")}:${node.textContent}`));
    check("G12·并排里也有词级高亮（同一份结果，两个视图共用）", splitWorded.length > 0, JSON.stringify(splitWorded));
  }
  await context.close();
}

// ── 3.27 D31 换检视对象 + D32 Agent 触发开面板 ───────────────────────────────
{
  const context = await browser.newContext({ viewport: { width: 1680, height: 1000 } });
  const page = await context.newPage();
  page.on("pageerror", (error) => check(`无页面崩溃（${String(error).slice(0, 60)}）`, false));

  /**
   * 夹具：三个候选 Task，分别对应三种状态（有实质改动 / 只有 daily / 什么都没）。
   * 断言选择器**把三种状态标出来**——这是 C2 分层的可见落点。
   */
  const CANDIDATES = { items: [
    { taskId: "0010", title: "检视模式", taskDir: "/tmp/task-0010", hasWorktree: true, worktreeChanged: true, docChangedFiles: 5, docOnlyDaily: false, substantive: true, commentsTotal: 3, openComments: 2, pendingForUser: 2 },
    { taskId: "0002", title: "只有日常", taskDir: "/tmp/task-0002", hasWorktree: false, worktreeChanged: false, docChangedFiles: 2, docOnlyDaily: true, substantive: false, commentsTotal: 0, openComments: 0, pendingForUser: 0 },
    { taskId: "0001", title: "默认", taskDir: "/tmp/task-0001", hasWorktree: false, worktreeChanged: false, docChangedFiles: 0, docOnlyDaily: false, substantive: false, commentsTotal: 1, openComments: 0, pendingForUser: 0 },
  ], elapsedMs: 12 };
  await page.route(/\/review-candidates$/, (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(CANDIDATES) }));
  await page.route(/\/api\/review\/diff$/, (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(FIXTURE) }));
  await page.route(/\/review-sources$/, (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [{ kind: "worktree", path: "/tmp/demo-worktree" }, { kind: "lifeos", path: "/tmp/demo-lifeos" }] }) }));
  await page.goto(APP_URL, { waitUntil: "domcontentloaded" });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "检视当前 Task 的改动" }).first().waitFor({ timeout: 15000 }).catch(() => {});
  let d31Opened = await openReview(page);
  if (!d31Opened) {
    await page.getByRole("button", { name: "检视当前 Task 的改动" }).first().waitFor({ timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(500);
    d31Opened = await openReview(page, { clean: false });
  }
  check("D31·前置：检视面板打开（否则下面几条等于没测）", d31Opened === true);
  if (d31Opened) {
    await page.waitForTimeout(1200);

    const switcher = await page.evaluate(() => {
      const select = document.querySelector("[data-review-switcher-select]");
      if (select === null) return null;
      return {
        options: [...select.options].map((option) => ({ value: option.value, text: option.textContent?.trim() ?? "" })),
        value: select.value,
        ariaLabel: select.getAttribute("aria-label"),
      };
    });
    check("D31·选择器：面板里有「检视对象」下拉", switcher !== null, JSON.stringify(switcher));
    if (switcher !== null) {
      check("D31·选择器：列出全部候选 Task（3 个）", switcher.options.length === 3, JSON.stringify(switcher.options.map((o) => o.text)));
      check("D31·选择器：有实质改动的标 ●", switcher.options.some((o) => o.text.includes("●") && o.text.includes("0010")), JSON.stringify(switcher.options.map((o) => o.text)));
      check("D31·选择器：只有日常的单独标注（C2 分层）", switcher.options.some((o) => o.text.includes("仅日常")), JSON.stringify(switcher.options.map((o) => o.text)));
      check("D31·选择器：有可访问名", (switcher.ariaLabel ?? "").length > 0, String(switcher.ariaLabel));
      /**
       * D29 用户侧可见化：一眼看出"哪个 Task 有评论等我"。
       * 只有 pendingForUser > 0 的才标（0001 有评论但已关闭 → 不该标）。
       */
      check("D29·候选列：有评论等我的 Task 标出条数", switcher.options.some((o) => o.text.includes("2 条等你")), JSON.stringify(switcher.options.map((o) => o.text)));
      check("D29·候选列：没有等我的不标（已关闭的不算）",
        switcher.options.filter((o) => o.text.includes("条等你")).length === 1, JSON.stringify(switcher.options.map((o) => o.text)));

      // 切到另一个 Task → 面板重新加载该 Task 的 diff（断言 taskDir 变了）
      const before = await page.evaluate(() => document.querySelector("[data-review-task-dir]")?.value ?? "");
      const other = switcher.options.find((option) => option.value !== switcher.value);
      if (other !== undefined) {
        await page.selectOption("[data-review-switcher-select]", other.value);
        await page.waitForTimeout(1500);
        const after = await page.evaluate(() => document.querySelector("[data-review-task-dir]")?.value ?? "");
        check("D31·切换：切到另一个 Task 后面板换了检视对象", after === other.value && after !== before, `${before} → ${after}`);
      }
    }
  }
  await context.close();
}

// ── 3.28 G15 md 渲染态 diff：渲染成文档 + 按块标色 + 代码块逐行标色 ─────────────
{
  const context = await browser.newContext({ viewport: { width: 1680, height: 1000 } });
  const page = await context.newPage();
  page.on("pageerror", (error) => check(`无页面崩溃（${String(error).slice(0, 60)}）`, false));

  /**
   * 夹具：一个 md 文件，含**标题改动**（删+增）、**列表改动**、**代码块内改动**。
   * 这三样覆盖渲染态的三种关键情形：块级标色、列表结构、围栏内逐行标色。
   */
  const MD_OLD = ["# 旧标题", "", "这一行保留。", "", "- 旧列表项", "", "```js", "const a = 1;", "```", ""].join("\n");
  const MD_NEW = ["# 新标题", "", "这一行保留。", "", "- 新列表项 A", "- 新列表项 B", "", "```js", "const a = 2;", "```", ""].join("\n");
  const MD_FIX = { items: [{
    source: { kind: "lifeos", path: "/tmp/md-task", exists: true },
    files: [{
      path: "docs/demo.md", kind: "doc", status: "modified", additions: 5, deletions: 3,
      hunks: [{ oldStart: 1, oldLines: 9, newStart: 1, newLines: 10, lines: [
        { type: "removed", oldNo: 1, newNo: null, text: "# 旧标题" },
        { type: "added", oldNo: null, newNo: 1, text: "# 新标题" },
        { type: "context", oldNo: 2, newNo: 2, text: "" },
        { type: "context", oldNo: 3, newNo: 3, text: "这一行保留。" },
        { type: "context", oldNo: 4, newNo: 4, text: "" },
        { type: "removed", oldNo: 5, newNo: null, text: "- 旧列表项" },
        { type: "added", oldNo: null, newNo: 5, text: "- 新列表项 A" },
        { type: "added", oldNo: null, newNo: 6, text: "- 新列表项 B" },
        { type: "context", oldNo: 6, newNo: 7, text: "" },
        { type: "context", oldNo: 7, newNo: 8, text: "```js" },
        { type: "removed", oldNo: 8, newNo: null, text: "const a = 1;" },
        { type: "added", oldNo: null, newNo: 9, text: "const a = 2;" },
        { type: "context", oldNo: 9, newNo: 10, text: "```" },
      ] }],
    }],
    truncated: false,
  }] };
  await page.route(/\/api\/review\/blob/, (route) => {
    const side = route.request().url().includes("side=old") ? MD_OLD : MD_NEW;
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ content: side, truncated: false }) });
  });
  await page.route(/\/api\/review\/diff$/, (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(MD_FIX) }));
  await page.route(/\/review-sources$/, (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [{ kind: "lifeos", path: "/tmp/md-task" }] }) }));
  await page.goto(APP_URL, { waitUntil: "domcontentloaded" });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "检视当前 Task 的改动" }).first().waitFor({ timeout: 15000 }).catch(() => {});
  let g15Opened = await openReview(page);
  if (!g15Opened) {
    await page.getByRole("button", { name: "检视当前 Task 的改动" }).first().waitFor({ timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(500);
    g15Opened = await openReview(page, { clean: false });
  }
  check("G15·前置：检视面板打开（否则下面几条等于没测）", g15Opened === true);
  if (g15Opened) {
    await ensureAllOpen(page);
    await page.waitForTimeout(800);

    // ① 默认是源码档（opt-in，与 VS Code 官方文档的 "This behavior is opt-in" 一致）
    check("G15·默认源码档（不突变；VS Code 文档明确这是 opt-in）",
      (await page.locator("[data-review-md-diff]").count()) === 0
      && (await page.locator("[data-review-diff]").count()) > 0);

    // ② 有 doc 文件时才给「渲染」开关
    const renderTab = page.getByRole("button", { name: "渲染" });
    check("G15·有 doc 文件时显示「渲染」档", (await renderTab.count()) > 0);
    if ((await renderTab.count()) > 0) {
      await renderTab.click();
      await page.waitForTimeout(900);

      const shape = await page.evaluate(() => ({
        hasPreview: document.querySelectorAll("[data-review-md-diff]").length,
        blocks: [...document.querySelectorAll("[data-review-md-block]")].map((n) => n.getAttribute("data-review-md-block")),
        headings: [...document.querySelectorAll("[data-review-md-preview] h1")].map((n) => n.textContent?.trim()),
        listItems: [...document.querySelectorAll("[data-review-md-preview] li")].map((n) => n.textContent?.trim()),
        codeLines: [...document.querySelectorAll("[data-review-md-code-line]")].map((n) => `${n.getAttribute("data-review-md-code-line")}:${n.textContent?.trim()}`),
        borderOf: (type) => {
          const el = document.querySelector(`[data-review-md-block="${type}"]`);
          return el === null ? null : getComputedStyle(el).borderLeftColor;
        },
      }));
      check("G15·渲染档：md 被渲染成真正的文档（出现 h1 元素）", shape.headings.length >= 2, JSON.stringify(shape.headings));
      check("G15·渲染档：列表渲染成 li（不是文本行）", shape.listItems.length >= 3, JSON.stringify(shape.listItems));
      check("G15·渲染档：块带类型标记（delete/change/context）",
        shape.blocks.includes("delete") && shape.blocks.includes("change") && shape.blocks.includes("context"), JSON.stringify(shape.blocks));

      // ③ 删除块与变更块的左边色边**必须是两种不同颜色**（否则分不清删了什么、加了什么）
      const colors = await page.evaluate(() => {
        const pick = (type) => {
          const el = document.querySelector(`[data-review-md-block="${type}"]`);
          return el === null ? null : getComputedStyle(el).borderLeftColor;
        };
        return { del: pick("delete"), change: pick("change"), ctx: pick("context") };
      });
      check("G15·渲染档：删除块红边、变更块绿边（颜色不同）",
        colors.del !== null && colors.change !== null && colors.del !== colors.change, JSON.stringify(colors));
      check("G15·渲染档：未改块没有色边（transparent）",
        colors.ctx === "rgba(0, 0, 0, 0)", String(colors.ctx));

      // ④ 代码围栏内**逐行**标色（不是整块一个颜色）
      check("G15·渲染档：代码块内逐行标色（delete 与 change 两行）",
        shape.codeLines.some((line) => line.startsWith("delete:")) && shape.codeLines.some((line) => line.startsWith("change:")),
        JSON.stringify(shape.codeLines));

      // ⑤ 切回源码档 → 渲染态消失、源码 diff 回来
      await page.getByRole("button", { name: "源码" }).click();
      await page.waitForTimeout(700);
      check("G15·切回源码档：渲染态消失、源码行级 diff 回来",
        (await page.locator("[data-review-md-diff]").count()) === 0
        && (await page.locator("[data-review-diff] [data-line]").count()) > 0);
    }
  }
  await context.close();
}

// ── 3.29 检视面板里的「选中即复制」+ 不接管时保留选区 + 只挂 chip 也能发 ──────────
//
// 三个都是 2026-11-09 实测出来的真缺陷（用户报"用户直接复制也会比较方便"）：
//  ① 检视面板是 `<main>` 的**兄弟节点**，而 copy-on-select 只认 `<main>` → 面板里一个字都复制不了；
//  ② `ReviewPanel` 的拖选监听**无条件** `selection.removeAllRanges()`，而"单行内"
//     是设计上**不接管**的出口 → 用户拖选一段文字，松手后选区消失、评论没建、剪贴板空（三空）；
//  ③ 发送按钮只看批注不看评论 chip → 只挂 chip 时按钮是灰的，用户必须再打一个字才能发。
//
// 每条都断言到**用户可验证的结果**（选区还在 / 剪贴板有内容 / 按钮可点），不看实现细节。
{
  const context = await browser.newContext({ viewport: { width: 1680, height: 1000 }, permissions: ["clipboard-read", "clipboard-write"] });
  const page = await context.newPage();
  page.on("pageerror", (error) => check(`无页面崩溃（${String(error).slice(0, 60)}）`, false));
  await page.route(/\/api\/review\/diff$/, (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(FIXTURE) }));
  await page.route(/\/review-sources$/, (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [{ kind: "worktree", path: "/tmp/demo-worktree" }, { kind: "lifeos", path: "/tmp/demo-lifeos" }] }) }));
  await page.goto(APP_URL, { waitUntil: "domcontentloaded" });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2200);
  const opened = await openReview(page);
  check("copy·面板出现", opened);
  if (opened) {
    /**
     * ③ 需要一个**已有评论**（否则面板里没有「全部发送」按钮，这条断言等于没测）。
     * 先通过服务端接口种一条，再重载面板（`clean: false` 不把刚种的那条清掉）。
     */
    await page.evaluate(async () => {
      const taskDir = document.querySelector("[data-review-task-dir]")?.value ?? "";
      if (taskDir === "") return;
      await fetch("/api/review/comments", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ taskDir, op: "add", comment: {
          taskId: "0010", author: { kind: "user", id: "xu-later" },
          anchor: { source: "worktree", path: "src/demo.ts", side: "new", start: 2, end: 2, snapshot: "const b = 22;" },
          body: "这一行合并一下？", marks: ["query"], state: "open",
        } }),
      });
    });
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1600);
    const reopened = await openReview(page, { clean: false });
    check("copy·种评论后重开面板", reopened);
    await ensureAllOpen(page);
    await waitForComments(page, (list) => list.length >= 1);
    await page.waitForTimeout(700);

    /**
     * 用**真实鼠标**拖（不是程序化选区）：缺陷②只在 mouseup 的接管逻辑里。
     * 拖之前**先清空剪贴板**——否则上一条用例留下的旧内容会让“复不复制”变成假绿。
     */
    const dragOver = async (selector, inset = 5) => {
      const box = await page.locator(selector).first().boundingBox();
      if (box === null) return false;
      await page.evaluate(() => window.getSelection()?.removeAllRanges());
      await page.evaluate(() => navigator.clipboard.writeText("<<清空>>").catch(() => undefined));
      await page.mouse.move(box.x + inset, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width - inset, box.y + box.height / 2, { steps: 12 });
      await page.mouse.up();
      await page.waitForTimeout(450);
      return true;
    };
    /** 读剪贴板；`"<<清空>>"` 是哨兵值，表示“没被写过” */
    const clipNow = async () => {
      const text = await page.evaluate(() => navigator.clipboard.readText().catch(() => ""));
      return text === "<<清空>>" ? "" : text;
    };

    // ① 检视对象条（纯文本、不可批注的区域）→ 选区留下 + 进了剪贴板
    const draggedPath = await dragOver('[data-review-target-path="worktree"]');
    check("copy·检视对象条可以拖选（找得到目标）", draggedPath);
    if (draggedPath) {
      const after = await page.evaluate(() => ({
        sel: window.getSelection()?.toString() ?? "",
        clip: "",
      }));
      const clip = await clipNow();
      check("copy·检视对象条：拖选后选区**还在**（不被清掉）", after.sel.length > 0, `${after.sel.length} 字符`);
      check("copy·检视对象条：松手即复制（剪贴板拿到那段路径）",
        clip.length > 0 && after.sel.includes(clip.trim()), JSON.stringify({ clip: clip.slice(0, 40), sel: after.sel.slice(0, 40) }));
      check("copy·检视对象条：面板算可复制区域（否则上面两条恒失败）", clip.length > 0, clip.slice(0, 30));
    }

    // ② diff 代码行里**单行内**拖选（设计上不接管）→ 选区留下 + 复制 + **不建草稿**
    //
    // 行直接用通配找（不依赖具体行号：夹具的行内容长短不一，按行号写死会“测试自己错”）。
    const rowBox = await page.evaluate(() => {
      for (const anchor of document.querySelectorAll("[data-review-line-anchor]")) {
        const row = anchor.parentElement?.parentElement;
        const r = row?.getBoundingClientRect();
        if (r !== undefined && r.width > 300 && r.height > 8) {
          return { key: anchor.getAttribute("data-review-line-anchor"), x: r.x, y: r.y, width: r.width, height: r.height };
        }
      }
      return null;
    });
    check("copy·找到一行可拖的 diff 行", rowBox !== null, JSON.stringify(rowBox));
    if (rowBox !== null) {
      const before = await page.locator("[data-review-draft]").count();
      await page.evaluate(() => window.getSelection()?.removeAllRanges());
      await page.evaluate(() => navigator.clipboard.writeText("<<清空>>").catch(() => undefined));
      await page.mouse.move(rowBox.x + 130, rowBox.y + rowBox.height / 2);
      await page.mouse.down();
      await page.mouse.move(rowBox.x + Math.min(330, rowBox.width - 10), rowBox.y + rowBox.height / 2, { steps: 12 });
      await page.mouse.up();
      await page.waitForTimeout(600);
      const sel = await page.evaluate(() => window.getSelection()?.toString() ?? "");
      const clip = await clipNow();
      const after = await page.locator("[data-review-draft]").count();
      check("copy·单行内拖选：选区不被清掉（不接管的出口必须原样保留）", sel.length > 0, `${sel.length} 字符`);
      check("copy·单行内拖选：剪贴板拿到那段文字", clip.length > 0, clip.slice(0, 40));
      check("copy·单行内拖选：不建草稿（单行批注走行号/＋）", after === before, `${before} → ${after}`);
    }

    // ③ 只挂 chip（不写字、不批注）→ 发送按钮可点
    await page.evaluate(() => window.getSelection()?.removeAllRanges());
    const sendAllBtn = page.locator("[data-review-send-all]");
    check("copy·前置：面板里有「全部发送」（否则 ③ 等于没测）", (await sendAllBtn.count()) > 0);
    if ((await sendAllBtn.count()) > 0) {
      await sendAllBtn.first().click();
      await page.waitForTimeout(600);
      const shape = await page.evaluate(() => {
        const chips = document.querySelectorAll("[data-comment-ref]").length;
        const ta = document.querySelector('textarea[aria-label="输入消息"]');
        const btn = [...document.querySelectorAll("button")].find((b) => (b.getAttribute("aria-label") ?? "") === "发送");
        return { chips, input: ta?.value ?? null, disabled: btn?.disabled ?? null };
      });
      check("copy·前置：chip 挂上了、输入框是空的", shape.chips > 0 && shape.input === "", JSON.stringify(shape));
      check("copy·只挂 chip 时发送按钮可点（不用再打一个字）", shape.disabled === false, JSON.stringify(shape));
    }
  }
  await context.close();
}

// ── 4. 窄窗口：放不下时要有提示，不静默消失 ──────────────────────────────────────
{
  const page = await openPage({ width: 1280, height: 900 });
  const opened = await openReview(page);
  if (opened) {
    const g = await geometry(page);
    check(`1280 视口：检视要么有宽度、要么有明确提示（不静默消失）`,
      g.review >= MIN_REVIEW || (await page.locator("text=放不下检视面板").count()) > 0,
      `review=${g.review}`);
    check("无论开没开，聊天都 ≥ 保底", g.chat >= MIN_CHAT, `聊天 ${g.chat}`);
  }
  await page.context().close();
}

// ── 切换竞态：慢响应不得覆盖新选择（Task 0018 · 用户实测“切 0018 却显示 0015/0017 的内容”）────────
{
  const page = await openPage({ width: 1680, height: 1000 });
  const opened = await openReview(page);   // 初始 task 立即返回（默认 FIXTURE）
  check("竞态用例：面板已打开", opened);
  if (opened) {
    await page.waitForSelector('[data-review-switcher-select] option[value="/tmp/demo-lifeos-0018"]', { timeout: 5000 }).catch(() => {});
    await page.selectOption('[data-review-switcher-select]', '/tmp/demo-lifeos-0018');   // 0018 响应在飞（延迟 1.5s）
    await page.waitForTimeout(300);
    await page.selectOption('[data-review-switcher-select]', '/tmp/demo-lifeos-0017');   // 改选 0017，立即到
    await page.waitForTimeout(600);        // 等 0017 的响应渲染
    const switched = await page.evaluate(() => document.querySelector('[data-review-target-path="lifeos"]')?.textContent ?? "");
    check("改选 0017：内容已是 0017", switched.includes("demo-lifeos-0017"), switched);
    await page.waitForTimeout(2500);        // 0018 的慢响应此时到达
    const after = await page.evaluate(() => document.querySelector('[data-review-target-path="lifeos"]')?.textContent ?? "");
    check("切换后：慢响应不得覆盖新选择（仍显示 0017）", after.includes("demo-lifeos-0017"), after);
  }
  await page.context().close();
}

await browser.close();

const failed = results.filter((item) => !item.ok);
for (const item of results) console.log(`${item.ok ? "✔" : "✖"} ${item.name}${item.detail === "" ? "" : `  → ${item.detail}`}`);
console.log(`\n${results.length - failed.length}/${results.length} 通过${failed.length === 0 ? "" : `；${failed.length} 项失败`}`);
if (failed.length > 0) process.exit(1);
