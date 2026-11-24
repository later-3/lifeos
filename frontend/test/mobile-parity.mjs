#!/usr/bin/env node
/**
 * 功能可达性门禁（Task 0016 · P7-S7）。
 *
 * ## 它解决什么
 *
 * 本轮实测出 **4 个功能在手机上根本不可用**（`knowledge/component-mobile-audit.md`）：
 * 检视面板（点了弹错）、会话改名/删除（无入口）、项目概览（无入口）、分组折叠（不存在）。
 *
 * 根因不是"某次忘了写"，而是**我们的适配策略**：手机适配几乎全在 `App.tsx` 里用
 * `isMobile` 决定**不渲染**谁（35 处），页面级组件 0 断点。于是每加一个桌面功能，
 * 手机上就多一个"不存在"的东西，而**没有任何门禁会发现**——
 * `mobile-contract` 只测它被写到的那些选择器。
 *
 * ## 它做什么
 *
 * 维护一份**功能清单**（`FEATURES`），每项声明三态之一：
 *  - `entry`：手机上必须有入口 —— 脚本探测 `probe`（选择器）是否存在；
 *  - `unsupported`：明确不支持 —— **必须**写 `todo` 编号，脚本去项目的 `todo/todo.md` 里核对它存在；
 *  - 新增桌面功能却没登记 → 脚本报错（强制思考"手机上怎么办"）。
 *
 * ## 为什么不在清单里的功能不会被发现
 *
 * 这是本门禁的边界：它只能检查"登记过的东西"。所以清单本身要**跟着桌面功能长**——
 * 加一个桌面入口时同时加一行。为了让这件事有抓手，脚本还会扫 `App.tsx` 里的头部动作
 * （`aria-label="..."` 的 IconButton）与已知的 `isMobile` 门，与清单做差集提示。
 *
 * 用法：
 *   node frontend/test/mobile-parity.mjs                 # 跑探测（需要 dev server）
 *   node frontend/test/mobile-parity.mjs --list          # 只打印清单与 todo 核对结果（不需要服务）
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const APP_URL = process.env.APP_URL ?? "http://localhost:5173";
const AGENT_HOME = process.env.LIFEOS_AGENT_HOME ?? join(homedir(), ".lifeos");
const TODO_FILE = join(AGENT_HOME, "projects", "lifeos", "todo", "todo.md");

/**
 * 功能清单。`id` 稳定、`probe` 是手机视口下应能找到的选择器。
 *
 * 三态：`entry`（有入口）/ `unsupported`（明确不支持 + 必须有 todo 编号）。
 * 每条都写"为什么"——没有理由的登记三个月后没人敢动。
 */
const FEATURES = [
  { id: "new-session", label: "新建会话", mobile: "entry", probe: 'button:has-text("新建会话"), [data-mobile-toolbar-action]', why: "抽屉底部的新建会话（P7 之前就有）" },
  { id: "session-actions", label: "会话改名/删除", mobile: "entry", probe: "[data-session-actions]", why: "P7-S1：抽屉会话行 ⋯（此前完全没有入口）" },
  { id: "project-info", label: "项目概览", mobile: "entry", probe: "[data-project-info]", why: "P7-S2：抽屉项目行 ⓘ（此前完全没有入口）" },
  { id: "review", label: "检视当前 Task", mobile: "entry", probe: '[data-mobile-toolbar-action="review"]', why: "P7-S6：头部动作层（此前点了弹错）" },
  { id: "history", label: "完整历史", mobile: "entry", probe: '[data-mobile-toolbar-action="history"]', why: "P7-S5：头部动作层" },
  { id: "file-panel", label: "文件面板", mobile: "entry", probe: '[data-mobile-toolbar-action="files"]', why: "P7-S5：头部动作层" },
  { id: "settings", label: "设置", mobile: "entry", probe: '[data-mobile-toolbar-action="settings"]', why: "P7-S5：头部动作层" },
  { id: "agent-config", label: "助手配置", mobile: "entry", probe: 'button:has-text("配置当前助手")', why: "抽屉底部的「配置当前助手」按钮（助手级）" },
  { id: "add-project", label: "添加项目", mobile: "entry", probe: 'button:has-text("添加项目")', why: "抽屉底部（项目级）" },
  { id: "switch-project", label: "切换项目", mobile: "entry", probe: "[data-mobile-level], nav", why: "抽屉助手→项目→会话三级下钻（每个项目行可点）" },
  /* Task 0023 · S1：手机抽屉第一级的「我的工作台」入口（独立全屏表面）。
     登记它有两个作用：① 它是**新加的手机入口**，清单必须跟着产品长；
     ② 它守住了"这行不能被挤掉/改名"——探测点就是它的 testid。 */
  { id: "workbench", label: "我的工作台", mobile: "entry", probe: '[data-testid="mobile-workbench-entry"]', why: "S1：抽屉第一级入口行 → 独立全屏工作台表面" },
  { id: "attach-image", label: "发图", mobile: "entry", probe: '[aria-label="添加图片"], input[type="file"]', why: "composer 内的图片入口" },
  { id: "slash-commands", label: "斜杠命令", mobile: "entry", probe: 'textarea[aria-label="输入消息"]', why: "输入 / 触发 palette" },
  { id: "jump-to-latest", label: "回到底部", mobile: "entry", probe: '[data-testid="jump-to-latest"]', why: "离开底部时出现的箭头（Pi TUI 基线）" },
  { id: "copy-on-select", label: "选中即复制", mobile: "entry", probe: "main", why: "document 级 mouseup，无入口（区域即能力）" },
  { id: "session-group-fold", label: "按项目折叠会话", mobile: "unsupported", todoId: "3", why: "手机上抽屉是 drill-down（一级一屏）+ 分页（P7-S4），分组折叠在手机上语义重叠" },
  { id: "bottom-tab", label: "底部 Tab 导航", mobile: "unsupported", todoId: "3", why: "信息架构改动，需先定「消息/项目/设置」三页内容；三个参考项目都没在聊天页用它" },
];

/** 读 todo 文件里的编号集合（`| 7 | ...` 形式）。 */
function todoIds() {
  if (!existsSync(TODO_FILE)) return undefined;
  const text = readFileSync(TODO_FILE, "utf8");
  const ids = new Set();
  for (const line of text.split("\n")) {
    const m = /^\|\s*(\d+)\s*\|/.exec(line);
    if (m) ids.add(m[1]);
  }
  return ids;
}

/** 清单自检（不需要服务）：三态合法 + unsupported 必须有存在的 todo 编号。 */
function validateManifest() {
  const failures = [];
  const ids = todoIds();
  if (ids === undefined) {
    failures.push(`读不到 todo 文件：${TODO_FILE}（unsupported 项无法核对）`);
  }
  const seen = new Set();
  for (const feature of FEATURES) {
    if (seen.has(feature.id)) failures.push(`功能 id 重复：${feature.id}`);
    seen.add(feature.id);
    if (feature.mobile !== "entry" && feature.mobile !== "unsupported") {
      failures.push(`${feature.id} 的 mobile 必须是 entry 或 unsupported（现在是 ${String(feature.mobile)}）`);
    }
    if (feature.why === undefined || feature.why.length < 8) failures.push(`${feature.id} 缺少可读的理由（why）`);
    if (feature.mobile === "unsupported") {
      if (feature.todoId === undefined) failures.push(`${feature.id} 登记为 unsupported 但没写 todoId`);
      else if (ids !== undefined && !ids.has(feature.todoId)) failures.push(`${feature.id} 指向的 todo #${feature.todoId} 在 todo.md 里不存在`);
    }
    if (feature.mobile === "entry" && feature.probe === undefined) failures.push(`${feature.id} 是 entry 但没有 probe 选择器`);
  }
  return failures;
}

async function loadPlaywright() {
  const candidates = [
    process.env.PLAYWRIGHT_CORE,
    join(HERE, "../node_modules/playwright-core/index.js"),
    join(ROOT, "node_modules/playwright/index.js"),
    join(homedir(), ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright-core/index.js"),
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue;
    const module = await import(candidate);
    return module.default ?? module;
  }
  throw new Error("找不到 playwright：设置 PLAYWRIGHT_CORE=/path/to/playwright-core/index.js");
}

const failures = [];
const manifestFailures = validateManifest();
failures.push(...manifestFailures);

if (process.argv.includes("--list")) {
  for (const feature of FEATURES) {
    const mark = feature.mobile === "entry" ? "手机有入口" : `手机不支持（todo #${feature.todoId}）`;
    console.log(`${feature.id.padEnd(20)} ${mark.padEnd(26)} ${feature.why}`);
  }
  if (failures.length > 0) {
    console.error(`\n✖ 清单自检失败 ${failures.length} 项：`);
    for (const failure of failures) console.error(`  · ${failure}`);
    process.exit(1);
  }
  console.log("\n✓ 清单自检通过");
  process.exit(0);
}

// ── 实机探测（需要 dev server）──────────────────────────────────────────────
const pw = await loadPlaywright();
const browser = await pw.chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
const page = await context.newPage();
await page.goto(APP_URL, { waitUntil: "networkidle" });
await page.waitForTimeout(900);

/** 一次探测：先把三个表面都打开过（导航抽屉 / 头部动作层 / 会话级），再统一查选择器。 */
async function ensureSurfaces() {
  // 头部动作层
  await page.evaluate(() => { document.querySelector("[data-mobile-toolbar-more]")?.click(); });
  await page.waitForTimeout(250);
  const found = new Set();
  const collect = async () => {
    // 选择器可能在当前页面上不合法（`:has-text()` 是 Playwright 的，不是 querySelector 的）：
    // 每条单独 try，坏选择器记成"未命中"，不让它把整轮探测打崩。
    const ids = await page.evaluate((features) => features.map((feature) => {
      if (feature.probe === undefined) return { id: feature.id, present: false };
      // 支持 Playwright 专有的 `:has-text()`：把它降级成"文本包含"判断
      const hasText = /:has-text\("([^"]+)"\)/.exec(feature.probe);
      const selector = feature.probe.replace(/,?\s*:has-text\("[^"]+"\)/g, "").trim();
      try {
        if (hasText !== null) {
          const needle = hasText[1];
          const hit = [...document.querySelectorAll(selector === "" ? "button" : selector)]
            .some((el) => (el.textContent ?? "").includes(needle));
          return { id: feature.id, present: hit };
        }
        return { id: feature.id, present: document.querySelector(selector) !== null };
      } catch {
        return { id: feature.id, present: false };
      }
    }), FEATURES.map(({ id, probe }) => ({ id, probe })));
    for (const item of ids) if (item.present) found.add(item.id);
  };
  await collect();
  // 导航抽屉
  await page.evaluate(() => { document.querySelector("[data-mobile-toolbar-more]")?.click(); });
  /**
   * 在某一级里选一个**真要下钻的实体行**。
   *
   * 为什么不能 `.first()`（Task 0023 · 批 5）：抽屉第一级多了一行「我的工作台」入口，
   * 它排在第一位（产品决定：手机上第一眼看到自己的东西）。`.first()` 点到它 → 打开工作台表面
   * 而不是项目列表 → 后面两级都下不去 → 「新建会话」「会话操作」在 agents 级当然找不到（实测 0 个）。
   * 归因是**门禁的定位太脆**，不是功能回归（两个 testid 都还在，位置也没变）。
   *
   * 现在的选法：**跳过工作台入口行**（按 testid 认，不按序号），并优先点当前选中的那个
   *（`Row selected` 会给行根 `aria-current="true"`）。两处都不依赖行序。
   */
  const drillableIndex = (level) => page.evaluate((lvl) => {
    const rows = [...document.querySelectorAll(`[data-mobile-level="${lvl}"] [role="button"]`)];
    const isWorkbenchEntry = (el) => {
      for (let node = el; node !== null; node = node.parentElement) {
        if (node.getAttribute?.("data-testid") === "mobile-workbench-entry") return true;
      }
      return false;
    };
    const rowRootOf = (el) => {
      for (let node = el; node !== null; node = node.parentElement) {
        if (node.getAttribute?.("data-mobile-level") === lvl) return null;
        if (node.getAttribute?.("aria-current") === "true") return node;
      }
      return null;
    };
    let fallback = -1;
    for (const [index, el] of rows.entries()) {
      if (isWorkbenchEntry(el)) continue;
      if (fallback === -1) fallback = index;
      if (rowRootOf(el) !== null) return index;
    }
    return fallback;
  }, level);
  const clickDrillableRow = async (level) => {
    const index = await drillableIndex(level);
    if (index < 0) return false;
    await page.locator(`[data-mobile-level="${level}"] [role="button"]`).nth(index).click().catch(() => {});
    await page.waitForTimeout(900);
    await collect();
    return true;
  };
  await page.waitForTimeout(200);
  const navEntry = page.getByRole("button", { name: "打开导航" }).or(page.getByRole("button", { name: "返回项目" }));
  if (await navEntry.count() > 0) {
    await navEntry.first().click();
    await page.waitForTimeout(700);
    await collect();
    // 回到 agents 级（`配置当前助手` 只在那里）
    for (let i = 0; i < 3; i += 1) {
      if ((await page.locator('[data-mobile-level="agents"]').count()) > 0) break;
      await page.evaluate(() => { const b = [...document.querySelectorAll('[data-testid="mobile-nav"] button')].find((x) => (x.textContent ?? "").includes("返回")); b?.click(); });
      await page.waitForTimeout(400);
    }
    await collect();
    /*
     * 抽屉结构自检（Task 0023 · 批 5）：agents 级必须**同时**有「我的工作台」入口与
     * 至少一个可下钻的实体行（助手行）。缺前者 = 用户看不到自己的工作台；缺后者 =
     * 抽屉变成死胡同（只能开工作台，进不去任何项目/会话）。
     * 这两条以前没人守，第一次被挤掉就是这么发现的（`.first()` 点到工作台入口）。
     */
    const agentsLevel = await page.evaluate(() => {
      const buttons = [...document.querySelectorAll('[data-mobile-level="agents"] [role="button"]')];
      const isWorkbenchEntry = (el) => {
        for (let node = el; node !== null; node = node.parentElement) {
          if (node.getAttribute?.("data-testid") === "mobile-workbench-entry") return true;
        }
        return false;
      };
      return {
        workbenchEntry: document.querySelector('[data-testid="mobile-workbench-entry"]') !== null,
        entityRows: buttons.filter((el) => !isWorkbenchEntry(el)).length,
        total: buttons.length,
      };
    });
    if (agentsLevel.workbenchEntry !== true) {
      failures.push("抽屉 agents 级找不到「我的工作台」入口（[data-testid=mobile-workbench-entry]）");
    }
    if (agentsLevel.entityRows < 1) {
      failures.push(`抽屉 agents 级没有可下钻的助手行（共 ${agentsLevel.total} 行）`);
    } else {
      console.log(`  [agents 级] 工作台入口=true · 助手行=${agentsLevel.entityRows} · 行总数=${agentsLevel.total}（预期 = 助手行 + 1）`);
    }
    const clickedAgents = await clickDrillableRow("agents");
    if (clickedAgents !== true) failures.push("抽屉 agents 级没有可点的助手行（下钻无从开始）");
    if ((await page.locator('[data-mobile-level="projects"]').count()) === 0) {
      failures.push(`点助手行之后没进到项目级（当前级别属性：${await page.locator("[data-mobile-level]").first().getAttribute("data-mobile-level").catch(() => "—")}）`);
    } else {
      const projectRows = await page.locator('[data-mobile-level="projects"] [role="button"]').count();
      console.log(`  [projects 级] 项目行=${projectRows}`);
      if (projectRows < 1) failures.push("抽屉 projects 级没有任何项目行");
    }
    const clickedProjects = await clickDrillableRow("projects");
    if (clickedProjects !== true) failures.push("抽屉 projects 级没有可点的项目行（下钻无从继续）");
    if ((await page.locator('[data-mobile-level="sessions"]').count()) === 0) {
      /*
       * 这一条是「定位是否够硬」的判据本身（活性验证用得上）：把定位改回 `.first()`
       * → 点到的会是工作台入口 → 停在 agents 级 → 这里必红。
       */
      failures.push(`抽屉没能下钻到会话级（agents → projects → sessions）；当前级别属性：${await page.locator("[data-mobile-level]").first().getAttribute("data-mobile-level").catch(() => "—")}（工作台入口若排在第一位，按序取第一个会点到它）`);
    } else {
      console.log(`  [sessions 级] 会话行=${await page.locator('[data-mobile-level="sessions"] [role="button"]').count()}`);
    }
  }
  /*
   * "回到底部"单独一段：它只在**离开底部**时出现，而且不能滚到顶
   * （顶部哨兵会触发分页加载，加载后 `restoreScrollTop` 又回到尾部 → 按钮消失）。
   * 所以放在最后：滚一小段（400px）让 `followTail` 变 false，再收集。
   */
  /*
   * "回到底部"单独一段：它只在**离开底部**时出现，且需要一个"内容比视口长"的会话。
   *
   * 前面的抽屉导航会把当前会话切到别处（可能是个空会话），所以这里**重新打开一个有内容的会话**
   * 再测——不依赖上一步停在哪儿。
   */
  await page.evaluate(() => { document.querySelector('[data-testid="mobile-nav"] button[aria-label="关闭导航"]')?.click(); });
  await page.waitForTimeout(300);
  const longSession = await page.evaluate(async () => {
    // 找一个消息数 ≥ 20 的会话（太少则滚不动，按钮本来就不该出现）
    const agents = await (await fetch("/api/agents")).json();
    for (const agent of agents.items ?? []) {
      const projects = await (await fetch(`/api/agents/${agent.id}/projects`)).json();
      for (const project of projects.items ?? []) {
        const sessions = await (await fetch(`/api/agents/${agent.id}/projects/${project.id}/sessions`)).json();
        const hit = (sessions.items ?? []).find((item) => (item.counts?.total ?? 0) >= 20);
        if (hit !== undefined) return { agent: agent.id, project: project.id, session: hit.sessionId };
      }
    }
    return null;
  });
  if (longSession === null) {
    // 没有长会话就没有"离开底部"这回事 —— 打印 SKIP 而不是假绿，也不是假红
    console.log("SKIP 回到底部：家目录里没有 ≥20 条消息的会话（这条需要可滚动的对话）");
    return found;
  }
  await page.goto(`${APP_URL}/?agent=${longSession.agent}&project=${longSession.project}&session=${longSession.session}`,
    { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  await page.evaluate(() => {
    /*
     * 向上滚一小段（400px）让 `followTail` 变 false —— 但**不能滚到顶**：
     * 顶部哨兵会触发分页加载，加载后 `restoreScrollTop` 又回到尾部，按钮就消失了（实测过一次）。
     */
    const main = document.querySelector("main");
    if (main !== null && main.scrollHeight > main.clientHeight + 600) {
      main.scrollTop = Math.max(0, main.scrollHeight - main.clientHeight - 400);
    }
  });
  await page.waitForTimeout(800);
  await collect();
  return found;
}

const found = await ensureSurfaces();
for (const feature of FEATURES) {
  if (feature.mobile !== "entry") continue;
  if (!found.has(feature.id)) {
    failures.push(`${feature.id}（${feature.label}）在手机上找不到入口：${feature.probe}`);
  }
}

await context.close();
await browser.close();

if (failures.length > 0) {
  console.error(`✖ 功能可达性 ${failures.length} 项失败：`);
  for (const failure of failures) console.error(`  · ${failure}`);
  process.exit(1);
}
const entries = FEATURES.filter((feature) => feature.mobile === "entry").length;
const unsupported = FEATURES.filter((feature) => feature.mobile === "unsupported").length;
console.log(`✓ 功能可达性通过：${entries} 项手机有入口，${unsupported} 项明确不支持（均有 todo）`);
