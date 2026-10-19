#!/usr/bin/env node
/**
 * 视觉契约测试（前端开发路径 · 闸 3 + 闸 4）。
 *
 * 为什么存在：2026-10-18 之前，"丑"只能靠人眼发现——聊天列被压到 252px、输入框占位被裁、
 * 文本对比度 2.58:1、hover 时行内容位移、模态键盘逃逸……全部靠人工复查，一开发就回潮。
 * 这里把当时的手工体检固化成断言：改坏了就红，红了必须给理由。
 *
 * 用法：
 *   node frontend/test/ui-contract.mjs                 # 需要 dev server（默认 http://localhost:5173）
 *   APP_URL=http://127.0.0.1:5173 node ...             # 换地址
 *   node frontend/test/ui-contract.mjs --update-baseline   # 人眼确认后更新截图基线
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { pixelDiff } from "./png.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASELINE_DIR = join(HERE, "ui-baseline");
const SHOT_DIR = join(HERE, "../../.ui-shots");
const APP_URL = process.env.APP_URL ?? "http://localhost:5173";
const UPDATE_BASELINE = process.argv.includes("--update-baseline");

const PLAYWRIGHT_CANDIDATES = [
  process.env.PLAYWRIGHT_CORE,
  join(HERE, "../../frontend/node_modules/playwright-core/index.js"),
  join(homedir(), ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright-core/index.js"),
].filter(Boolean);

const MIN_CHAT = 420;
const MIN_HISTORY = 360;
const MIN_HIT = 28;
const MIN_CONTRAST = 4.5;

async function loadPlaywright() {
  for (const candidate of PLAYWRIGHT_CANDIDATES) {
    if (!existsSync(candidate)) continue;
    const module = await import(candidate);
    return module.default ?? module;
  }
  throw new Error("找不到 playwright-core：设置 PLAYWRIGHT_CORE=/path/to/playwright-core/index.js");
}

const results = [];
async function measureHistory(target) {
  return await target.evaluate(({ MIN_CONTRAST }) => {
    const main = document.querySelector("main");
    const box = main?.getBoundingClientRect();
    const leafText = [...(main?.querySelectorAll("*") ?? [])].filter((el) => el.children.length === 0 && (el.textContent ?? "").trim() !== "");
    const clipped = leafText
      .filter((el) => getComputedStyle(el).textOverflow !== "ellipsis")            // truncate 是设计行为，不算裁切
      .filter((el) => el.scrollWidth > el.clientWidth + 1)
      .map((el) => (el.textContent ?? "").trim().slice(0, 12));
    const canvas = document.createElement("canvas"); canvas.width = canvas.height = 1; const ctx = canvas.getContext("2d");
    const toRgb = (c) => { ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = "#fff"; ctx.fillStyle = c; ctx.fillRect(0, 0, 1, 1); const d = ctx.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2]]; };
    const lum = (rgb) => rgb.map((v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }).reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i], 0);
    const ratio = (a, b) => { const x = lum(toRgb(a)), y = lum(toRgb(b)); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
    const bgOf = (el) => { for (let n = el; n !== null; n = n.parentElement) { const v = getComputedStyle(n).backgroundColor; if (v !== "rgba(0, 0, 0, 0)") return v; } return "rgb(255,255,255)"; };
    const lowContrast = leafText.filter((el) => { const style = getComputedStyle(el); if (Number(style.opacity) < 0.9) return false; return ratio(style.color, bgOf(el)) < (Number.parseFloat(style.fontSize) >= 22 ? 3 : MIN_CONTRAST); })
      .map((el) => `${(el.textContent ?? "").trim().slice(0, 10)} ${ratio(getComputedStyle(el).color, bgOf(el)).toFixed(2)}:1`);
    return {
      width: box === undefined ? 0 : Math.round(box.width),
      rendered: document.body.innerText.includes("历史 ·"),
      overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
      clipped, lowContrast,
      markdownBodies: main?.querySelectorAll(".md-body")?.length ?? 0,
      contextSummary: document.body.innerText.includes("上下文"),
      systemSectionsHidden: !document.body.innerText.includes("系统提示分段"),
      buttons: main?.parentElement?.querySelectorAll("button, summary")?.length ?? 0,
    };
  }, { MIN_CONTRAST });
}

async function settle(page) {
  // 截图前把滚动位置归位（挂载时的 smooth scrollIntoView 会造成像素级抖动）
  await page.evaluate(() => {
    document.documentElement.style.scrollBehavior = "auto";
    const main = document.querySelector("main");
    if (main !== null) main.scrollTop = main.scrollHeight;
  });
  await page.waitForTimeout(300);
}

function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
}

async function measure(page) {
  return await page.evaluate(({ MIN_HIT, MIN_CONTRAST }) => {
    const rect = (el) => el.getBoundingClientRect();
    const visible = (el) => { const box = rect(el); return box.width > 0 && box.height > 0; };

    // 有效背景：向上找到第一个非透明背景
    const bgOf = (el) => {
      for (let node = el; node !== null; node = node.parentElement) {
        const value = getComputedStyle(node).backgroundColor;
        if (value !== "rgba(0, 0, 0, 0)" && value !== "transparent") return value;
      }
      return "rgb(255, 255, 255)";
    };
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const ctx = canvas.getContext("2d");
    const toRgb = (color) => {
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = "#fff";
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, 1, 1);
      const data = ctx.getImageData(0, 0, 1, 1).data;
      return [data[0], data[1], data[2]];
    };
    const lum = (rgb) => {
      const [r, g, b] = rgb.map((value) => {
        const channel = value / 255;
        return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const ratio = (a, b) => {
      const x = lum(toRgb(a));
      const y = lum(toRgb(b));
      return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
    };

    const chat = document.querySelector("header")?.parentElement;
    const body = document.body;
    const overflow = document.documentElement.scrollWidth > window.innerWidth + 1;
    // 折叠成本 = 导航轨容器宽度之和（不是轨上按钮之和）
    const rail = [...document.querySelectorAll('nav[aria-label="左侧图标轨"]')]
      .reduce((sum, el) => sum + Math.round(rect(el).width), 0);

    // 竖向裁切（横向截断是 ellipsis 的正常表现，不算）
    const clipped = [];
    for (const el of document.querySelectorAll("body *")) {
      if (!visible(el)) continue;
      const style = getComputedStyle(el);
      if (style.overflowY === "auto" || style.overflowY === "scroll") continue;
      if (el.closest("[data-no-clip-check]") !== null) continue;
      // 只看"承载文字的元素"（叶子节点或输入类控件）：容器裁切是布局手段，不是缺陷
      const isTextLeaf = el.children.length === 0 && (el.textContent ?? "").trim() !== "";
      const isField = el.tagName === "TEXTAREA" || el.tagName === "INPUT";
      if (!isTextLeaf && !isField) continue;
      if (el.scrollHeight > el.clientHeight + 2 && el.clientHeight > 0) {
        clipped.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 28)}`);
      }
    }

    // 对比度
    const lowContrast = [];
    for (const el of document.querySelectorAll("body *")) {
      if (!visible(el) || el.children.length > 0) continue;
      const text = (el.textContent ?? "").trim();
      if (text === "") continue;
      const style = getComputedStyle(el);
      if (style.visibility === "hidden" || Number(style.opacity) < 0.9) continue;
      const size = Number.parseFloat(style.fontSize);
      const need = size >= 22 ? 3 : MIN_CONTRAST;
      const value = ratio(style.color, bgOf(el));
      if (value < need) lowContrast.push(`${text.slice(0, 12)} (${value.toFixed(2)}:1)`);
    }

    // 命中区
    const smallTargets = [];
    for (const el of document.querySelectorAll("button, [role=button], a[href]")) {
      if (!visible(el)) continue;
      const box = rect(el);
      if (box.width < MIN_HIT || box.height < MIN_HIT) {
        smallTargets.push(`${(el.getAttribute("aria-label") ?? el.textContent ?? "").trim().slice(0, 14)} ${Math.round(box.width)}×${Math.round(box.height)}`);
      }
    }

    return {
      viewport: window.innerWidth,
      chatWidth: chat === undefined || chat === null ? 0 : Math.round(rect(chat).width),
      overflow,
      rail,
      clipped,
      lowContrast,
      smallTargets,
      dialogCount: document.querySelectorAll('[role="dialog"][aria-modal="true"]').length,
      bodyFont: getComputedStyle(body).fontFamily.split(",")[0],
    };
  }, { MIN_HIT, MIN_CONTRAST });
}

const playwright = await loadPlaywright();
const browser = await playwright.chromium.launch({
  headless: true,
  executablePath: playwright.chromium.executablePath(),
  args: ["--no-proxy-server", "--font-render-hinting=none", "--disable-lcd-text"],
});

mkdirSync(SHOT_DIR, { recursive: true });

// 稳定入口：显式指定 agent/project/session。否则"上次选中的助手"可能是刚建的、还没有会话
// → 完整历史按钮 disabled、面板/截图相关断言会超时（数据无关的写法）。
const ENTRY_URL = await (async () => {
  try {
    const res = await fetch(`${APP_URL}/api/agents/lifeosagent/projects/workspace/sessions`);
    const body = await res.json();
    const sid = body.items?.[0]?.sessionId;
    return sid === undefined ? APP_URL : `${APP_URL}/?agent=lifeosagent&project=workspace&session=${sid}`;
  } catch { return APP_URL; }
})();
mkdirSync(BASELINE_DIR, { recursive: true });

const FROZEN_TIME = new Date("2026-10-18T12:00:00+08:00");   // 冻结时钟：相对时间文案（"4小时前"）否则会让截图基线抖动

for (const viewport of [1024, 1280, 1440, 1600]) {
  const page = await browser.newPage({ viewport: { width: viewport, height: 900 }, deviceScaleFactor: 1 });
  await page.clock.install({ time: FROZEN_TIME });
  await page.goto(ENTRY_URL, { waitUntil: "networkidle" });
  await page.waitForTimeout(700);
  const data = await measure(page);
  check(`[${viewport}] 聊天列 ≥ ${MIN_CHAT}px`, data.chatWidth >= MIN_CHAT, `实际 ${data.chatWidth}px`);
  check(`[${viewport}] 无横向溢出`, data.overflow === false);
  check(`[${viewport}] 无竖向文本裁切`, data.clipped.length === 0, data.clipped.slice(0, 3).join(" | "));
  check(`[${viewport}] 文本对比度 ≥ 4.5:1`, data.lowContrast.length === 0, data.lowContrast.slice(0, 3).join(" | "));
  check(`[${viewport}] 命中区 ≥ ${MIN_HIT}×${MIN_HIT}`, data.smallTargets.length === 0, data.smallTargets.slice(0, 3).join(" | "));
  await settle(page);
  await page.screenshot({ path: join(SHOT_DIR, `viewport-${viewport}.png`), animations: "disabled", caret: "hide" });   // 仅产物，不参与基线
  await page.close();
}

// 交互态：折叠 / 面板 / 模态 / hover
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
await page.clock.install({ time: FROZEN_TIME });
await page.goto(ENTRY_URL, { waitUntil: "networkidle" });
await page.waitForTimeout(700);

// 图标轨常驻（VS Code Activity Bar 范式）：先量"三列都展开"时的轨宽
const expandedRail = await measure(page);
check("图标轨常驻：三列展开时轨仍是 44px", expandedRail.rail === 44, `实际 ${expandedRail.rail}px`);
const hideButtons = page.locator('[aria-label="收起此列"]');
while (await hideButtons.count() > 0) { await hideButtons.first().click(); await page.waitForTimeout(120); }
const folded = await measure(page);
check("三列收起后轨道宽度不变（仍是同一条 44px）", folded.rail === 44, `实际 ${folded.rail}px`);
check("收起后聊天列仍 ≥ MIN_CHAT", folded.chatWidth >= MIN_CHAT, `实际 ${folded.chatWidth}px`);
await settle(page);
for (const label of ["助手", "项目", "会话"]) {
  const railButton = page.locator(`[aria-label="展开${label}"]`);
  if (await railButton.count() > 0) { await railButton.first().click(); await page.waitForTimeout(120); }
}

// 图标常驻 + 高亮 = 展开 + 点击切换（用户 2026-10-18 需求，参照 VS Code Activity Bar）
const railButtons = page.locator('nav[aria-label="左侧图标轨"] button');
check("图标常驻：三列全展开时轨道上仍有 3 个图标", await railButtons.count() === 3, `实际 ${await railButtons.count()} 个`);
check("图标顺序固定：助手 → 项目 → 会话", await page.evaluate(() => [...document.querySelectorAll('nav[aria-label="左侧图标轨"] button')]
  .map((b) => (b.getAttribute("aria-label") ?? "").replace(/^(展开|收起)/, "")).join(",")) === "助手,项目,会话");
check("高亮 = 该列展开（aria-pressed 全为 true）", await page.evaluate(() => [...document.querySelectorAll('nav[aria-label="左侧图标轨"] button')]
  .every((b) => b.getAttribute("aria-pressed") === "true")));
const projectColumn = async () => await page.evaluate(() => [...document.querySelectorAll("aside")].some((el) => (el.innerText ?? "").startsWith("项目")));
const clickProject = async () => { await page.locator('nav[aria-label="左侧图标轨"] button').nth(1).click(); await page.waitForTimeout(300); };
const seq = [await projectColumn()];
await clickProject(); seq.push(await projectColumn());
await clickProject(); seq.push(await projectColumn());
await clickProject(); seq.push(await projectColumn());
check("点图标可连续切换（开 → 收 → 开 → 收），不弹回", JSON.stringify(seq) === JSON.stringify([true, false, true, false]), JSON.stringify(seq));
await clickProject();   // 恢复展开
check("点图标后高亮跟随状态", await page.evaluate(() => {
  const buttons = [...document.querySelectorAll('nav[aria-label="左侧图标轨"] button')];
  return buttons.every((b) => b.getAttribute("aria-pressed") === "true");
}));

// 助手行悬停出现删除入口（归档；只断言入口存在，绝不点确认——契约跑在真实家目录上）
const firstAgentRow = page.locator('aside').first().locator('[role="button"]').first();
await firstAgentRow.hover();
await page.waitForTimeout(200);
// 多个助手时会有多个（隐藏的）按钮 → 只看第一行那个；数据无关
check("助手行悬停出现删除入口", await page.locator('[aria-label="删除助手"]').first().isVisible());

// 输入法组字中的 Enter 不能触发发送（照 Pi Web ChatInput 的守卫：composing / isComposing / keyCode 229 / 100ms 宽限）
const imeGuard = await page.evaluate(() => {
  const textarea = document.querySelector("textarea");
  if (textarea === null) return { ok: false, detail: "找不到输入框" };
  const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
  setValue.call(textarea, "ime-probe");
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
  textarea.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
  textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
  const kept = textarea.value === "ime-probe";
  // 收尾：结束组字并清空（不发消息）
  textarea.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
  setValue.call(textarea, "");
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
  return { ok: kept, detail: `组字后输入框 value=${textarea.value}` };
});
check("输入法组字中的 Enter 不发送", imeGuard.ok, String(imeGuard.detail));

// hover 不位移（会话行：时间 ↔ 图标切换后行内元素不得移动）
const rowBox = async () => await page.evaluate(() => {
  const row = [...document.querySelectorAll('[role="button"]')].find((el) => el.className.includes("h-8") && el.textContent.includes("welcome"));
  if (row === undefined) return null;
  const box = row.getBoundingClientRect();
  return { x: Math.round(box.x), w: Math.round(box.width), h: Math.round(box.height), children: [...row.children].map((child) => Math.round(child.getBoundingClientRect().x)) };
});
const before = await rowBox();
if (before !== null) {
  await page.locator('[role="button"]').filter({ hasText: "welcome" }).first().hover();
  await page.waitForTimeout(260);
  const after = await rowBox();
  check("hover 不改变行几何（无抖动）", JSON.stringify(before) === JSON.stringify(after), `${JSON.stringify(before)} → ${JSON.stringify(after)}`);
} else {
  check("hover 不改变行几何（无抖动）", false, "找不到会话行样本");
}

// 模态：语义 + Esc + 焦点归位
const avatarTrigger = page.locator('button[aria-label^="配置 "]').first();
if (await avatarTrigger.count() > 0) {
  await avatarTrigger.click();
  await page.waitForTimeout(500);
  const opened = await measure(page);
  check("模态具备 role=dialog + aria-modal", opened.dialogCount === 1, `dialog=${opened.dialogCount}`);

  const focusTrapped = await page.evaluate(() => document.querySelector('[role="dialog"]')?.contains(document.activeElement) === true);
  check("模态打开后焦点在对话框内", focusTrapped);
  for (let index = 0; index < 12; index += 1) await page.keyboard.press("Tab");
  const stillTrapped = await page.evaluate(() => document.querySelector('[role="dialog"]')?.contains(document.activeElement) === true);
  check("Tab 12 次不逃出对话框（焦点陷阱）", stillTrapped);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  const closed = await page.evaluate(() => document.querySelectorAll('[role="dialog"]').length === 0);
  check("Esc 关闭模态", closed);
} else {
  check("模态可打开", false, "找不到头像入口");
}

// 会话区头部：必须写「Agent · 项目目录名」，且项目名与 /api 返回一致（防"工作区"这类展示名回流）
const headerMeta = await page.evaluate(async () => {
  const line = document.querySelector("header p")?.textContent?.trim() ?? "";
  const data = await (await fetch("/api/agents/lifeosagent/projects")).json();
  return { line, projectName: data.items?.[0]?.name ?? "" };
});
check("会话区头部显示「Agent · 项目目录名」且与接口一致",
  headerMeta.projectName !== "" && headerMeta.line.endsWith(headerMeta.projectName) && headerMeta.line.includes(" · "),
  `${headerMeta.line}（接口 name=${headerMeta.projectName}）`);

// 列头语义：列头只写"这一列是什么"，"默认"这类徽标属于行内数据，不许重复出现在列头
const headerTexts = await page.evaluate(() => [...document.querySelectorAll("aside > div:first-child")]
  .map((el) => (el.textContent ?? "").trim()));
check("列头不重复行内徽标（无“默认”）", headerTexts.every((text) => !text.includes("默认")), headerTexts.join(" | "));

// 列内文本噪音：项目/会话行不再出现"默认"这类文字徽标（默认项目改用 6px 点 + title）
// 只查"界面自称"的地方：三列 + 右侧面板。会话正文里的"默认"是用户/模型说的话，不是徽标。
const chromeText = await page.evaluate(() => [...document.querySelectorAll("aside")].map((el) => el.innerText).join("\n"));
check("界面的列与面板不再出现“默认”文字徽标", !chromeText.includes("默认"), chromeText.includes("默认") ? "仍有“默认”字样" : "");

// 键盘焦点可见（全局 :focus-visible 兜底）
await page.keyboard.press("Tab");
const focusRing = await page.evaluate(() => {
  const el = document.activeElement;
  if (el === null) return { ok: false, detail: "无焦点元素" };
  const style = getComputedStyle(el);
  return { ok: style.outlineStyle !== "none" && Number.parseFloat(style.outlineWidth) > 0, detail: `${el.tagName} ${style.outlineStyle} ${style.outlineWidth}` };
});
check("键盘 Tab 后焦点可见（outline）", focusRing.ok, String(focusRing.detail));

// 完整历史（v3：右侧并列列 + 回合树，不覆盖对话区）
const historyButton = page.locator('[aria-label="完整历史"]').first();
if (await historyButton.count() > 0) {
  await historyButton.click();
  await page.waitForTimeout(900);

  const docking = await page.evaluate(() => {
    const aside = [...document.querySelectorAll("aside")].find((el) => (el.textContent ?? "").includes("完整历史"));
    const main = document.querySelector("main");
    const rect = (el) => { const b = el.getBoundingClientRect(); return { w: Math.round(b.width), x: Math.round(b.x) }; };
    return { dock: aside ? rect(aside) : null, chat: main ? rect(main) : null, text: document.body.innerText };
  });
  check("完整历史以右侧并列列出现（不覆盖对话区）",
    docking.dock !== null && docking.chat !== null && docking.dock.x >= docking.chat.x + docking.chat.w - 2,
    `chat ${docking.chat?.w ?? 0}px @${docking.chat?.x ?? 0} · dock ${docking.dock?.w ?? 0}px @${docking.dock?.x ?? 0}`);
  check("并排：对话区与历史列同时 ≥ 下限", (docking.chat?.w ?? 0) >= MIN_CHAT && (docking.dock?.w ?? 0) >= MIN_HISTORY,
    `chat ${docking.chat?.w ?? 0} / dock ${docking.dock?.w ?? 0}`);

  const tree = await page.evaluate(() => {
    const aside = [...document.querySelectorAll("aside")].find((el) => (el.textContent ?? "").includes("完整历史"));
    const text = aside?.textContent ?? "";
    const leaf = [...(aside?.querySelectorAll("*") ?? [])].filter((el) => el.children.length === 0 && (el.textContent ?? "").trim() !== "");
    const clipped = leaf.filter((el) => getComputedStyle(el).textOverflow !== "ellipsis" && el.scrollWidth > el.clientWidth + 1).length;
    return {
      hasTurn: /回合 #\d/.test(text), hasRequest: text.includes("请求"), hasReply: text.includes("回复"),
      hasToken: /tok/.test(text), hasWindow: text.includes("窗口"),
      clipped,
      horizontalOverflow: (aside?.scrollWidth ?? 0) > (aside?.clientWidth ?? 0) + 1,
    };
  });
  check("回合树：回合 / 请求 / 回复 三层都在", tree.hasTurn && tree.hasRequest && tree.hasReply);
  check("块头带 token 与占窗口比例", tree.hasToken && tree.hasWindow);
  check("历史列无横向溢出/裁切", tree.horizontalOverflow === false && tree.clipped === 0, `clipped=${tree.clipped}`);

  // 请求展开后必须能看到 system 分区（区域名 + 归属）。
  // 不假设"最后一个回合就是 Life OS 跑的"：会话里可能有别的运行（或历史遗留）写入的回合，从后往前找到 Life OS 那个回合。
  const sections = await page.evaluate(async () => {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const aside = [...document.querySelectorAll("aside")].find((el) => (el.textContent ?? "").includes("完整历史"));
    if (aside === undefined) return { identity: false, harness: false, source: false, detail: "找不到历史列" };
    const turns = [...aside.querySelectorAll("button")].filter((el) => /^回合 #\d/.test((el.textContent ?? "").trim()));
    for (const turn of turns.slice().reverse()) {
      turn.click();
      await sleep(250);
      const request = [...aside.querySelectorAll("button")].find((el) => (el.textContent ?? "").trim().startsWith("请求"));
      if (request === undefined) continue;
      request.click();
      await sleep(350);
      const text = aside.textContent ?? "";
      if (text.includes("身份区") && text.includes("交互 harness 区")) {
        return { identity: true, harness: true, source: text.includes("我方") && text.includes("Pi 内置"), detail: (turn.textContent ?? "").trim().slice(0, 12) };
      }
      request.click();   // 收起，继续往前找
      await sleep(150);
    }
    return { identity: false, harness: false, source: false, detail: `${turns.length} 个回合都没有 Life OS 分区` };
  });
  check("请求里显示 system 分区（身份区 / 交互 harness 区）", sections.identity && sections.harness, String(sections.detail ?? ""));
  check("分区带归属（我方 / Pi 内置）", sections.source);

  // 把手方向一致性（用户点名的 bug）：右侧停靠面板左拉变大、左列表右拉变大
  const dragCheck = await (async () => {
    const measure = async () => await page.evaluate(() => {
      const aside = [...document.querySelectorAll("aside")].find((el) => (el.textContent ?? "").includes("完整历史"));
      return aside === undefined ? 0 : Math.round(aside.getBoundingClientRect().width);
    });
    const handle = await page.evaluate(() => {
      const aside = [...document.querySelectorAll("aside")].find((el) => (el.textContent ?? "").includes("完整历史"));
      if (aside === undefined) return null;
      const box = aside.getBoundingClientRect();
      const handles = [...document.querySelectorAll("div.cursor-col-resize")];
      const nearest = handles
        .map((el) => ({ el, distance: Math.abs(el.getBoundingClientRect().x - box.x) }))
        .sort((a, b) => a.distance - b.distance)[0];
      if (nearest === undefined) return null;
      const rect = nearest.el.getBoundingClientRect();
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    });
    if (handle === null) return { ok: false, detail: "找不到把手" };
    const before = await measure();
    await page.mouse.move(handle.x, handle.y);
    await page.mouse.down();
    await page.mouse.move(handle.x - 60, handle.y, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(250);
    const wider = await measure();
    return { ok: wider > before + 40, detail: `左拉 ${before} → ${wider}（应变宽）` };
  })();
  check("右侧停靠面板把手方向正确（左拉变大）", dragCheck.ok, String(dragCheck.detail));

  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
  check("Esc 关闭完整历史", await page.evaluate(() => ![...document.querySelectorAll("aside")].some((el) => (el.textContent ?? "").includes("完整历史"))));
} else {
  check("完整历史入口存在", false, "找不到 [aria-label=\"完整历史\"]");
}

// 1280 并排：窗口变窄时自动收左三列，对话区与历史列都要保住
const narrow = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
await narrow.clock.install({ time: FROZEN_TIME });
await narrow.goto(ENTRY_URL, { waitUntil: "networkidle" });
await narrow.waitForTimeout(700);
await narrow.locator('[aria-label="完整历史"]').first().click();
await narrow.waitForTimeout(900);
const narrowPair = await narrow.evaluate(() => {
  const aside = [...document.querySelectorAll("aside")].find((el) => (el.textContent ?? "").includes("完整历史"));
  const main = document.querySelector("main");
  const width = (el) => (el === null || el === undefined ? 0 : Math.round(el.getBoundingClientRect().width));
  return { chat: width(main), dock: width(aside) };
});
check("[1280] 仍并排（对话 ≥ MIN_CHAT，历史 ≥ MIN_HISTORY）", narrowPair.chat >= MIN_CHAT && narrowPair.dock >= MIN_HISTORY,
  `chat ${narrowPair.chat} / dock ${narrowPair.dock}`);
await narrow.close();

// URL 三键：切项目必须更新 ?project=（尤其"该项目没有会话"时——否则刷新会退回旧项目/旧会话）
const urlThreeKeys = await page.evaluate(async () => {
  const list = await (await fetch("/api/agents/lifeosagent/projects")).json();
  if (list.items.length < 2) return { skipped: true };
  const target = list.items[1];
  const projectCol = [...document.querySelectorAll("aside")][1];
  if (projectCol === undefined) return { ok: false, detail: "找不到项目列" };
  const row = [...projectCol.querySelectorAll("div")].find((el) => (el.textContent ?? "").trim().startsWith(target.name));
  if (row === undefined) return { ok: false, detail: "找不到项目行 " + target.name };
  row.click();
  await new Promise((resolve) => setTimeout(resolve, 900));
  const params = new URLSearchParams(location.search);
  return { ok: params.get("project") === target.id, detail: `?project=${params.get("project")}（期望 ${target.id}）` };
});
check("URL 三键：切项目更新 ?project=（无会话时也要）", urlThreeKeys.skipped === true || urlThreeKeys.ok === true,
  urlThreeKeys.skipped === true ? "只有 1 个项目，跳过" : String(urlThreeKeys.detail ?? ""));

// ---- 截图基线（闸 4）----
// 关键点：独立浏览器 + 每张图一个新页面 + 冻结时钟。
// 否则同一 context 里页面的先后顺序、以及"4小时前"这类相对时间文案，会让基线随机抖动（实测 66457 vs 66460 字节）。
const shotBrowser = await playwright.chromium.launch({
  headless: true, executablePath: playwright.chromium.executablePath(),
  args: ["--no-proxy-server", "--font-render-hinting=none", "--disable-lcd-text"],
});
async function capture(width, setup) {
  const shotPage = await shotBrowser.newPage({ viewport: { width, height: 900 }, deviceScaleFactor: 1 });
  await shotPage.clock.install({ time: FROZEN_TIME });
  await shotPage.goto(ENTRY_URL, { waitUntil: "networkidle" });
  await shotPage.waitForTimeout(500);
  if (setup !== undefined) await setup(shotPage);
  await settle(shotPage);
  // 遮罩"会随对话变化"的正文（会话消息、完整历史正文与标题行）：基线只比界面骨架。
  // 不这么做的话，用户每聊一句、每多一个回合，截图就漂 → 门禁天天红（实测漂 5–8%）。
  const buffer = await shotPage.screenshot({
    animations: "disabled", caret: "hide",
    mask: [shotPage.locator("[data-shot-mask]")],
    maskColor: "#fafafa",
  });
  await shotPage.close();
  return buffer;
}
const SHOTS = [
  ["viewport-1280.png", 1280, undefined],
  ["viewport-1600.png", 1600, undefined],
  ["folded.png", 1600, async (shotPage) => {
    const buttons = shotPage.locator('[aria-label="收起此列"]');
    while (await buttons.count() > 0) { await buttons.first().click(); await shotPage.waitForTimeout(100); }
  }],
  ["history.png", 1600, async (shotPage) => {
    await shotPage.locator('[aria-label="会话历史"]').first().click();
    await shotPage.waitForTimeout(600);
  }],
  ["history.png", 1600, async (shotPage) => {
    await shotPage.locator('[aria-label="完整历史"]').first().click();
    await shotPage.waitForTimeout(700);
  }],
  ["modal.png", 1600, async (shotPage) => {
    await shotPage.locator('button[aria-label^="配置 "]').first().click();
    await shotPage.waitForTimeout(400);
  }],
];
for (const [name, width, setup] of SHOTS) {
  const buffer = await capture(width, setup);
  writeFileSync(join(SHOT_DIR, name), buffer);
  const basePath = join(BASELINE_DIR, name);
  if (UPDATE_BASELINE || !existsSync(basePath)) {
    writeFileSync(basePath, buffer);
    check(`截图基线 ${name}`, true, UPDATE_BASELINE ? "已更新" : "首次写入");
    continue;
  }
  // 像素容差比较（不是字节相等）：抗锯齿抖动容忍 8/255，差异像素 > 0.05% 才算视觉变化
  const diff = pixelDiff(readFileSync(basePath), buffer);
  const same = diff.ratio <= 0.0002;   // 0.02%：实测抗锯齿抖动 0.0000%，而"删掉一个小徽标"约 0.03%
  check(`截图基线 ${name} 未变化`, same,
    same ? `差异像素 ${(diff.ratio * 100).toFixed(3)}%` : `差异像素 ${(diff.ratio * 100).toFixed(2)}%（最大通道差 ${diff.maxDelta}）：人眼确认后 pnpm test:ui:update`);
}
await shotBrowser.close();

await browser.close();

// 门禁自检：防止某段检查被删掉却依然"全绿"（本次就发生过一次基线检查块被整体删掉）
const REQUIRED = ["聊天列 ≥", "无横向溢出", "无竖向文本裁切", "文本对比度", "命中区", "轨道宽度不变", "hover 不改变行几何", "焦点陷阱", "Esc 关闭模态", "截图基线"];
const missing = REQUIRED.filter((needle) => !results.some((item) => item.name.includes(needle)));
check("门禁自检：所有检查项都在（防静默删除）", missing.length === 0 && results.length >= 24,
  missing.length > 0 ? `缺失 ${missing.join(" / ")}` : `共 ${results.length} 项`);

const failed = results.filter((item) => !item.ok);
for (const item of results) console.log(`${item.ok ? "✔" : "✖"} ${item.name}${item.detail === "" ? "" : `  → ${item.detail}`}`);
console.log(`\n${results.length - failed.length}/${results.length} 通过${failed.length === 0 ? "" : `；${failed.length} 项失败`}`);
if (failed.length > 0) process.exit(1);
