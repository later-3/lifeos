#!/usr/bin/env node
/**
 * 层绘制契约（Task 0017 · P1）：「同一层只能有一个绘制者」。
 *
 * ## 为什么需要这个门
 *
 * `ui-contract.mjs` 对会话行只断言**宽度**（`actionsInsideRow`、`innerW`、不抖动）。
 * 而 2026-11-16 用户报的缺陷是**形状**问题：
 *   行容器有 `rounded-row`(8px) 却无底色 → 内层拿 `hover:bg-nav-accent` 但无圆角（方角块）
 *   → 动作覆盖层再画一块 `bg-nav-accent` + `rounded-control`(6px)（第二块底、第二种圆角、矮 4px）
 *   → 两色一深一浅时露出竖缝与上下缺口。
 * 宽度类断言对这四个现象**全绿**，所以必须另立门禁。
 *
 * ## 判据（全部可从 DOM 静态读出，不依赖鼠标悬停）
 *
 * 悬停态的几何量在无头浏览器里不稳定（本轮实测：`page.mouse.move` 后
 * `querySelectorAll(":hover")` 已包含该元素，但 `matches(":hover")` 仍可能为 false），
 * 拿它当门禁会得到"假红-假绿"交替的假断言（违反 testing 2.15 / 2.17）。
 * 所以这里量**声明**与**静态几何**——它们才是"谁在画"的直接事实：
 *
 * ① **行级悬停底只许声明在行根上**：行矩形内，声明了行高填充类（`hover:bg-*` /
 *    `group-hover/…:bg-*` / `bg-nav-selected` / `bg-nav-accent`）且高度 ≥ 行高一半的元素，
 *    必须**恰好 1 个**，且它就是行根。
 * ② **行根必须有圆角**（>0）——圆角与底色必须挂在同一个元素上。
 * ③ **动作覆盖层不得自绘底色**：它只负责让位与内容，底色由行根提供。
 *    （依据 LobeHub `NavItem.tsx:44-60` @`867a15a`：overlay 不画板，用 mask 淡出文字。）
 * ④ **状态标记（L3）不得越出行矩形**（圆角外溢出 ≤0.5px）。
 *
 * 用法：APP_URL=http://localhost:5176 node frontend/test/layer-paint.mjs
 */
import { existsSync, readFileSync } from "node:fs";
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

const results = [];
const check = (name, ok, detail = "") => results.push({ name, ok, detail });

const browser = await playwright.chromium.launch({
  headless: true, executablePath: playwright.chromium.executablePath(),
  args: ["--no-proxy-server", "--font-render-hinting=none", "--disable-lcd-text"],
});

/**
 * 行内「谁声明了行级填充」的静态清单。
 *
 * `rowFillClasses`: 判定一个元素是否**声明**行级填充（悬停底/选中底都算）。
 * 只要它在行根之外出现，就是"第二个绘制者"。
 */
const ROW_FILL_RE = /(?:^|\s)(?:hover:bg-[\w-]+|group-hover\/[\w-]+:bg-[\w-]+|bg-nav-selected|bg-nav-accent)(?:\s|$)/;

const probeRow = async (page, selector) => await page.evaluate(({ sel, fillSrc }) => {
  const fillRe = new RegExp(fillSrc);
  const root = document.querySelector(sel);
  if (root === null) return null;
  const rowBox = root.getBoundingClientRect();
  const rowH = rowBox.height;

  const painters = [];
  const overlays = [];
  for (const el of [root, ...root.querySelectorAll("*")]) {
    const cls = String(el.className ?? "");
    const box = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const declaresFill = fillRe.test(cls);
    // 动作覆盖层：有 opacity 切换 + 绝对/网格叠放，是 L4 那一层
    const isOverlay = /(?:^|\s)(?:absolute|col-start-1)(?:\s|$)/.test(cls) && /opacity-(?:0|100)/.test(cls);
    /*
     * 「行级绘制者」= 声明了行级填充 + 尺寸像一整块行（不是 28×28 的小控件）。
     * 宽度门槛取行宽的 40%：动作图标钮自己也有 `hover:bg-hover`，那是**控件级**悬停，
     * 合法（它只是一个小方块）。把控件算成绘制者会让这条断言永远红 = 假断言。
     */
    if (declaresFill && box.height >= rowH * 0.5 && box.width >= rowBox.width * 0.4) {
      painters.push({
        cls: cls.slice(0, 120), isRowRoot: el === root, tag: el.tagName,
        box: { w: Math.round(box.width), h: Math.round(box.height) },
        bg: cs.backgroundColor, radius: parseFloat(cs.borderRadius) || 0,
      });
    }
    if (isOverlay) {
      // 覆盖层自己有没有声明**底色**类（bg-*）。`hover:bg-*` 是控件级悬停，不算覆盖层底板。
      const bgDecl = /(?:^|\s)bg-[\w-]+(?:\s|$)/.test(cls);
      overlays.push({ cls: cls.slice(0, 140), declaresBg: bgDecl, radius: parseFloat(cs.borderRadius) || 0, box: { w: Math.round(box.width), h: Math.round(box.height) } });
    }
  }

  const marksOverflow = [...root.querySelectorAll('[data-state-dot], [title="生成中"], [title^="完成未读"], [title^="失败"]')]
    .map((m) => { const b = m.getBoundingClientRect(); return { right: +(b.right - rowBox.right).toFixed(1), top: +(rowBox.top - b.top).toFixed(1), bottom: +(b.bottom - rowBox.bottom).toFixed(1) }; })
    .filter((d) => d.right > 0.5 || d.top > 0.5 || d.bottom > 0.5);

  return {
    rowBox: { w: Math.round(rowBox.width), h: Math.round(rowBox.height) },
    rowRadius: parseFloat(getComputedStyle(root).borderRadius) || 0,
    painters, overlays, marksOverflow,
  };
}, { sel: selector, fillSrc: ROW_FILL_RE.source });

const describePainters = (painters) => painters.map((p) => `${p.isRowRoot ? "[行根]" : "[行内]"} ${p.tag} ${p.box.w}×${p.box.h} r=${p.radius} bg=${p.bg}`).join(" | ") || "无";
const describeOverlays = (overlays) => overlays.map((o) => `${o.box.w}×${o.box.h} r=${o.radius} declaresBg=${o.declaresBg}`).join(" | ") || "无";

const PACKS_JSON = readFileSync(join(process.cwd(), "frontend/src/design/preloaded-themes.json"), "utf8");
const openPage = async (mode = "light") => {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
  // 外部主题（Quiet Light）：内置 cool 主题的 hover 与列底 ΔL* 只有 2.8，缺陷在它下面几乎不可见。
  // 必须在页面脚本之前写进 localStorage —— main.tsx 只在 key 不存在时灌预置包。
  await page.addInitScript(({ packsJson, mode }) => {
    localStorage.setItem("lifeos.themePacks", packsJson);
    const packs = JSON.parse(packsJson);
    const quiet = packs.find((p) => p.meta.name === "Quiet Light");
    if (quiet !== undefined) localStorage.setItem("lifeos.themePackActive", quiet.meta.name);
    localStorage.setItem("lifeos.theme", JSON.stringify({ preset: "cool", mode, accentH: 221, accentC: 0, lockNeutral: true, neutralC: 4, lSurface: 100, lNav: 96.9, lRail: 93, lLine: 89.4, hoverD: 4.2, selRatio: 2 }));
  }, { packsJson: PACKS_JSON, mode });
  return page;
};

/* ── 1 助手行（Row：容器 + 主点击区 + status/actions 槽） ── */
{
  const page = await openPage();
  await page.goto(`${APP_URL}/`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1000);

  /*
   * 行根 = 容器（`group/row`），不是主点击区。
   * 结构：容器（rounded-row + 底色）> 主点击区(role=button) + status/actions 槽。
   * 取 role=button 会只量到内层 —— 2026-11-16 实测踩过：量出来 0 个绘制者，像"没有底"。
   * 取**未选中**的行：选中行底色常驻（bg-nav-selected），测不出 hover 的问题。
   */
  const SEL = '[data-shot-mask="agent-rows"] [role="button"]';
  await page.evaluate((sel) => {
    const inners = [...document.querySelectorAll(sel)];
    const idle = inners.find((el) => el.getAttribute("aria-current") !== "true");
    idle?.parentElement?.setAttribute("data-probe-row", "1");
  }, SEL);
  const ROW = '[data-probe-row="1"]';
  const row = await probeRow(page, ROW);

  if (row === null) {
    check("助手行：取到行样本", false, "没找到未选中的助手行");
  } else {
    check("助手行：取到行样本", true, `行 ${row.rowBox.w}×${row.rowBox.h}`);
    const nonRoot = row.painters.filter((p) => !p.isRowRoot);
    check("助手行：行级填充只声明在行根（不留第二个绘制者）",
      row.painters.length >= 1 && nonRoot.length === 0,
      `绘制者 ${row.painters.length} 个：${describePainters(row.painters)}`);
    check("助手行：行根有圆角（圆角与底色挂在同一元素）", row.rowRadius > 0, `radius=${row.rowRadius}px`);
    check("助手行：动作覆盖层不自绘底色（L4 只叠内容）",
      row.overlays.length > 0 && row.overlays.every((o) => o.declaresBg === false),
      describeOverlays(row.overlays));
  }
  await page.close();
}

/* ── 2 会话行（SessionRow：状态槽 + 绝对定位动作区 + 运行态光环） ── */
{
  const page = await openPage();
  // 造一条 running + 一条 unread，让 L3 标记（光环/绿点）真的出现
  await page.route("**/sessions", async (route) => {
    const res = await route.fetch();
    const body = await res.json();
    const items = body.items ?? [];
    if (items.length > 0) items[0].activity = { state: "running", running: { since: new Date(Date.now() - 90_000).toISOString(), elapsedMs: 90_000 } };
    if (items.length > 1) items[1].activity = { state: "unread", unread: { since: new Date().toISOString() } };
    await route.fulfill({ response: res, body: JSON.stringify(body) });
  });
  await page.goto(`${APP_URL}/`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);

  const ROW = '[data-shot-mask="session-rows"] [data-testid]:not([data-testid="group-header"])';
  const row = await probeRow(page, ROW);
  if (row === null) {
    check("会话行：取到行样本", false, "没找到会话行");
  } else {
    check("会话行：取到行样本", true, `行 ${row.rowBox.w}×${row.rowBox.h}`);
    const nonRoot = row.painters.filter((p) => !p.isRowRoot);
    check("会话行：行级填充只声明在行根（不留第二个绘制者）",
      row.painters.length >= 1 && nonRoot.length === 0,
      `绘制者 ${row.painters.length} 个：${describePainters(row.painters)}`);
    check("会话行：行根有圆角", row.rowRadius > 0, `radius=${row.rowRadius}px`);
    check("会话行：动作覆盖层不自绘底色（L4 只叠内容）",
      row.overlays.length === 0 || row.overlays.every((o) => o.declaresBg === false),
      describeOverlays(row.overlays));
    check("会话行：状态标记不越出行矩形（L3 不溢出 L2）", row.marksOverflow.length === 0,
      JSON.stringify(row.marksOverflow));
  }
  await page.close();
}

/* ── 3 分组头计数药丸：与宿主同色会让"形"在悬停时消失 ── */
{
  const page = await openPage();
  await page.goto(`${APP_URL}/`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1000);
  const same = await page.evaluate(() => {
    const header = document.querySelector('[data-testid="group-header"]');
    if (header === null) return null;
    const headerRow = header.querySelector("button");
    const pill = header.querySelector('[data-shot-mask="group-count"]');
    if (headerRow === null || pill === null) return null;
    const tokensOf = (cls) => [...String(cls).matchAll(/(?:hover:)?bg-([\w-]+)/g)].map((m) => m[1]);
    const hostTokens = tokensOf(headerRow.className);
    const pillTokens = tokensOf(pill.className);
    // 宿主悬停用哪个 token、药丸常驻用哪个 token —— 同名即同色 = 悬停时药丸的形状消失
    const hostHover = [...String(headerRow.className).matchAll(/hover:bg-([\w-]+)/g)].map((m) => m[1]);
    const shared = hostHover.filter((t) => pillTokens.includes(t));
    return { hostHover, pillTokens, shared, pillBg: getComputedStyle(pill).backgroundColor };
  });
  if (same === null) check("分组头：取到计数药丸样本", false, "没找到");
  else {
    check("分组头：计数药丸不借行悬停色（悬停时形状不消失）", same.shared.length === 0,
      `宿主悬停=${same.hostHover.join(",") || "无"} 药丸=${same.pillTokens.join(",") || "无"} 撞=${same.shared.join(",") || "无"}`);
  }
  await page.close();
}

await browser.close();

for (const item of results) console.log(`${item.ok ? "✔" : "✖"} ${item.name}${item.detail === "" ? "" : `  → ${item.detail}`}`);
const failed = results.filter((item) => !item.ok);
console.log(`\n${results.length - failed.length}/${results.length} 通过${failed.length === 0 ? "" : `；${failed.length} 项失败`}`);
if (failed.length > 0) process.exit(1);
