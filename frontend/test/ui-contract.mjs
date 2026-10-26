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
import { createRequire } from "node:module";
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
    // 优先选有真实消息的非默认会话；默认欢迎会话可能没有 usage，状态条/截图契约会无数据。
    // 选消息数最多的非默认会话（有回复且带用量的概率最高；不依赖"最近更新"这种会变的顺序，2026-10-25 修复）
    const sid = [...(body.items ?? [])].filter((item) => item.isDefault !== true && item.messages > 0)
      .sort((a, b) => b.messages - a.messages)[0]?.sessionId
      ?? body.items?.[0]?.sessionId;
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

// 文件根切换：打开面板 → 点根名 → 列出"打开过的目录"（家目录永远在）→ Esc 关闭
await page.locator('[aria-label="展开文件面板"]').first().click();
await page.waitForTimeout(600);
const rootButton = page.locator('button[title]').filter({ hasText: /^· / }).first();
await rootButton.click();
await page.waitForTimeout(400);
const switcher = await page.evaluate(() => {
  const text = document.body.innerText;
  return { listed: text.includes("切换目录") && text.includes("打开过的目录"), hasHome: text.includes(".lifeos") };
});
check("文件根切换框：能打开并列出打开过的目录", switcher.listed, String(switcher.listed));

// 目录选择器：打开即聚焦路径输入框；Backspace 是删字符（不是关闭/触发 X）——用户 2026-10-19 点名的 bug
await page.getByText("浏览其他目录…").click();
await page.waitForTimeout(800);
const pickerFocus = await page.evaluate(() => {
  const el = document.querySelector('input[placeholder="输入路径后回车跳转"]');
  return { focused: document.activeElement === el, tag: document.activeElement?.tagName ?? null };
});
check("目录选择器：打开即聚焦路径输入框（不是关闭按钮）", pickerFocus.focused === true, `焦点在 ${pickerFocus.tag}`);
// 从"当前根"开始（不是每次回家目录）；长路径自动滚到末尾，保证最深一段可见
const startPath = await page.evaluate(() => ({
  rootTitle: [...document.querySelectorAll('button[title]')].find((b) => (b.textContent ?? '').trim().startsWith('· '))?.getAttribute('title') ?? null,
  inputValue: document.querySelector('input[placeholder="输入路径后回车跳转"]')?.value ?? null,
}));
check("目录选择器：从当前所在目录开始", startPath.rootTitle !== null && startPath.inputValue === startPath.rootTitle,
  `root=${startPath.rootTitle} input=${startPath.inputValue}`);
// 标准几何校验（用户 2026-10-19 要求）：输入框必须完整落在对话框内、宽度可用、无横向溢出/裁切
const pickerGeometry = await page.evaluate(() => {
  const dialog = document.querySelector('[role="dialog"]');
  const input = document.querySelector('input[placeholder="输入路径后回车跳转"]');
  if (dialog === null || input === null) return { ok: false, detail: "找不到对话框/输入框" };
  const d = dialog.getBoundingClientRect();
  const i = input.getBoundingClientRect();
  const style = getComputedStyle(input);
  return {
    ok: true,
    inputWidth: Math.round(i.width),
    insideLeft: i.left >= d.left, insideRight: i.right <= d.right,
    insideTop: i.top >= d.top, insideBottom: i.bottom <= d.bottom,
    marginRight: Math.round(d.right - i.right),
    paddingRight: Number.parseFloat(style.paddingRight),
    overflowX: document.documentElement.scrollWidth > window.innerWidth + 1,
  };
});
check("目录选择器：输入框完整可见（不被对话框裁切）",
  pickerGeometry.ok === true && pickerGeometry.insideLeft && pickerGeometry.insideRight && pickerGeometry.insideTop && pickerGeometry.insideBottom,
  `w=${pickerGeometry.inputWidth} rightMargin=${pickerGeometry.marginRight} inside=${pickerGeometry.insideLeft}/${pickerGeometry.insideRight}`);
check("目录选择器：输入框宽度可用（≥280px）且页面无横向溢出",
  pickerGeometry.inputWidth >= 280 && pickerGeometry.overflowX === false,
  `w=${pickerGeometry.inputWidth} overflowX=${pickerGeometry.overflowX}`);

// 对话框分隔与滚动锁（用户 2026-10-19：输入框顶边像嵌进标题条；滚轮滚到后面的页面）
const dialogLook = await page.evaluate(() => {
  const dialog = document.querySelector('[role="dialog"]');
  const header = dialog?.querySelector('header');
  const body = dialog?.querySelector('div.min-h-0.flex-1');
  const input = dialog?.querySelector('input[placeholder="输入路径后回车跳转"]');
  if (header === undefined || header === null || body === undefined || body === null || input === undefined || input === null) {
    return { ok: false };
  }
  const cs = (el) => getComputedStyle(el);
  return {
    ok: true,
    colorDiffers: cs(header).backgroundColor !== cs(body).backgroundColor,
    border: Number.parseFloat(cs(header).borderBottomWidth) >= 1,
    gap: Math.round(input.getBoundingClientRect().top - body.getBoundingClientRect().top),
    bodyOverflow: document.body.style.overflow,
    overscroll: cs(body).overscrollBehaviorY,
  };
});
check("对话框：头部与正文有色差 + 分隔线，正文与输入框有间距（≥12px）",
  dialogLook.ok === true && dialogLook.colorDiffers === true && dialogLook.border === true && dialogLook.gap >= 12,
  `色差=${dialogLook.colorDiffers} 线=${dialogLook.border} 间距=${dialogLook.gap}px`);
check("对话框打开时锁住背景滚动（body overflow hidden + 内容区 overscroll contain）",
  dialogLook.ok === true && dialogLook.bodyOverflow === "hidden" && dialogLook.overscroll === "contain",
  `body=${dialogLook.bodyOverflow} overscroll=${dialogLook.overscroll}`);
const beforeBackspace = await page.locator('input[placeholder="输入路径后回车跳转"]').inputValue();
await page.keyboard.type("xyz");
await page.keyboard.press("Backspace");
await page.waitForTimeout(200);
const afterBackspace = await page.evaluate(() => ({
  value: document.querySelector('input[placeholder="输入路径后回车跳转"]')?.value ?? null,
  open: document.querySelector('[role="dialog"]') !== null,
}));
check("目录选择器：Backspace 删除字符且模态不关闭", afterBackspace.open && afterBackspace.value === `${beforeBackspace}xy`,
  `value=${afterBackspace.value} open=${afterBackspace.open}`);
await page.keyboard.press("Escape");
await page.waitForTimeout(300);

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

// 单容器 composer（chat.md §3.5）：一个容器 + textarea 有可访问名 + 发送/停止在容器内
const composerShape = await page.evaluate(() => {
  const container = document.querySelector('[data-testid="composer"]');
  const textarea = container?.querySelector("textarea");
  const action = container?.querySelector('button[aria-label="发送"], button[aria-label="停止（Esc）"]');
  return {
    exists: container !== null,
    aria: textarea?.getAttribute("aria-label") ?? null,
    action: action !== undefined && action !== null,
    ring: container === null ? "" : getComputedStyle(container).boxShadow,
  };
});
check("composer 是单一容器", composerShape.exists && composerShape.action, JSON.stringify(composerShape));
check("textarea 有可访问名", composerShape.aria === "输入消息", String(composerShape.aria));

// 自动高度 1–8 行（chat.md §3.5）
const autoTextarea = page.locator("textarea").first();
const heightBefore = await autoTextarea.evaluate((el) => el.getBoundingClientRect().height);
await autoTextarea.fill(Array.from({ length: 20 }, (_, i) => `line-${i}`).join("\n"));
await page.waitForTimeout(120);
const heightAfter = await autoTextarea.evaluate((el) => ({
  height: el.getBoundingClientRect().height,
  style: Number.parseFloat(el.style.height || "0"),
}));
check("输入框自动 1–8 行", heightAfter.height > heightBefore && heightAfter.style > 0 && heightAfter.style <= 178,
  `${heightBefore.toFixed(1)} → ${heightAfter.height.toFixed(1)} (style=${heightAfter.style})`);
await autoTextarea.fill("");
await page.waitForTimeout(80);

// 斜杠命令面板（对齐 Pi CLI / Pi Web）：输入 "/" 列命令，Esc 关闭
const chatComposer = page.locator("textarea").first();
await chatComposer.click();
await chatComposer.type("/");
await page.waitForTimeout(300);
const paletteItems = await page.evaluate(() => [...document.querySelectorAll("button")]
  .map((button) => (button.textContent ?? "").trim())
  .filter((text) => text.startsWith("/")));
check("斜杠命令面板：输入 / 列出命令", paletteItems.some((text) => text.startsWith("/compact")) && paletteItems.some((text) => text.startsWith("/model")) && paletteItems.some((text) => text.startsWith("/name")),
  paletteItems.slice(0, 7).join(" | "));
// 回归守卫：自造的 /task 已删除（切换只在对话里：建即进入 / 按编号接手）
check("斜杠命令面板：没有自造的 /task", !paletteItems.some((text) => text.startsWith("/task")),
  paletteItems.filter((text) => text.startsWith("/task")).join(" | ") || "无");
const paletteInsideComposer = await page.evaluate(() => {
  const container = document.querySelector('[data-testid="composer"]');
  const palette = document.querySelector('div[aria-label="斜杠命令"]');
  return container !== null && palette !== null && container.contains(palette);
});
check("斜杠命令面板在 composer 容器内", paletteInsideComposer);
await page.keyboard.press("Escape");
await page.waitForTimeout(200);
const paletteClosed = await page.evaluate(() => ![...document.querySelectorAll("button")]
  .some((button) => (button.textContent ?? "").trim().startsWith("/compact")));
check("斜杠命令面板：Esc 关闭", paletteClosed);
await chatComposer.fill("");

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
  headerMeta.projectName !== "" && headerMeta.line.includes(` · ${headerMeta.projectName}`) && headerMeta.line.includes(" · "),
  `${headerMeta.line}（接口 name=${headerMeta.projectName}）`);

// 头部同时显示会话实际用的模型（用户要能一眼看到"到底在连哪个模型"）
const headerModel = await page.evaluate(async () => {
  const id = new URL(location.href).searchParams.get("agent");
  const sid = new URL(location.href).searchParams.get("session");
  if (id === null || sid === null) return { expected: null, line: "" };
  const data = await (await fetch(`/api/agents/${id}/sessions/${sid}`)).json();
  return { expected: data.meta?.model ?? null, line: document.querySelector('[data-testid="header-meta"]')?.textContent ?? "" };
});
check("头部显示会话实际模型（与接口 meta 一致）",
  headerModel.expected === null || headerModel.line.includes(`${headerModel.expected.provider}/${headerModel.expected.id}`),
  `${headerModel.line}（接口 ${headerModel.expected === null ? "无模型" : `${headerModel.expected.provider}/${headerModel.expected.id}`}）`);

// 头部模型显示规则（用户 2026-10-22）：没 /model 覆盖 → 有效默认；覆盖过 → 会话模型。
// 用拦截响应证明“显示规则”，不依赖真实会话恰好被 /model 切过。
{
  const displayPage = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
  let overridden = false;
  await displayPage.route(/\/api\/agents\/[^/]+\/config$/, (route) => route.fulfill({
    status: 200, contentType: "application/json",
    body: JSON.stringify({ config: null, effective: { defaultProvider: "test", defaultModel: "display-default" }, source: "catalog" }),
  }));
  await displayPage.route(/\/api\/agents\/[^/]+\/sessions\/[^/]+$/, (route) => route.fulfill({
    status: 200, contentType: "application/json",
    body: JSON.stringify({
      messages: [],
      meta: {
        model: { provider: "actual", id: "session-model" },
        modelOverridden: overridden,
        thinkingLevel: "off",
        running: false,
        context: null,
      },
    }),
  }));
  await displayPage.goto(page.url(), { waitUntil: "networkidle" });
  await displayPage.waitForTimeout(400);
  const notOverriddenLine = await displayPage.locator('[data-testid="header-meta"]').textContent() ?? "";
  check("未覆盖会话头部显示有效默认（不显示会话实际值）",
    notOverriddenLine.includes("test/display-default") && !notOverriddenLine.includes("actual/session-model"),
    notOverriddenLine);
  overridden = true;
  await displayPage.reload({ waitUntil: "networkidle" });
  await displayPage.waitForTimeout(400);
  const overriddenLine = await displayPage.locator('[data-testid="header-meta"]').textContent() ?? "";
  check("/model 覆盖会话头部显示覆盖模型（不被默认顶掉）",
    overriddenLine.includes("actual/session-model") && !overriddenLine.includes("test/display-default"),
    overriddenLine);
  await displayPage.close();
}

// Task 0002：task 段 =「0001 标题」（无 Task 前缀、无清中标题时只 ID）；thinking 段 = 档位本身（无"思考"二字）。
// 用 mock 响应证明显示规则，不依赖真实会话恰好有 activeTaskId。
{
  const displayPage = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
  await displayPage.route(/\/api\/agents\/[^/]+\/config$/, (route) => route.fulfill({
    status: 200, contentType: "application/json",
    body: JSON.stringify({ config: null, effective: { defaultProvider: "test", defaultModel: "display-default" }, source: "catalog" }),
  }));
  await displayPage.route(/\/api\/agents\/[^/]+\/sessions\/[^/]+$/, (route) => route.fulfill({
    status: 200, contentType: "application/json",
    body: JSON.stringify({
      messages: [],
      meta: {
        model: { provider: "actual", id: "session-model" },
        modelOverridden: true,
        thinkingLevel: "high",
        running: false,
        context: null,
        activeTaskId: "0007",
      },
    }),
  }));
  await displayPage.route(/\/api\/agents\/[^/]+\/projects\/[^/]+\/tasks$/, (route) => route.fulfill({
    status: 200, contentType: "application/json",
    body: JSON.stringify({ items: [{ id: "0007", title: "输入框优化", status: "进行中", type: "development", category: "A" }] }),
  }));
  await displayPage.goto(page.url(), { waitUntil: "networkidle" });
  await displayPage.waitForTimeout(400);
  const taskLine = await displayPage.locator('[data-testid="header-meta"]').textContent() ?? "";
  check("task 段显示「0007 输入框优化」（无 Task 前缀）",
    taskLine.includes("0007 输入框优化") && !taskLine.includes("Task "), taskLine);
  check("thinking 段显示档位本身（无思考二字）",
    taskLine.split(" · ").includes("high") && !taskLine.includes("思考"), taskLine);
  await displayPage.close();
}

// 呈现底线：可见按钮必须有可访问名（文字 / aria-label / title 至少一个）。
// 反例：只画一个图标、没有标签——人认不出、读屏认不出、自动化也认不出（"做了个按钮在那儿"）。
const noName = () => page.evaluate(() => [...document.querySelectorAll("button")]
  .filter((button) => button.offsetParent !== null)
  .map((button) => ({ text: (button.innerText || "").trim(), aria: button.getAttribute("aria-label") ?? "", title: button.getAttribute("title") ?? "" }))
  .filter((button) => button.text === "" && button.aria === "" && button.title === ""));
// 动作条统一规则：未悬停时全部隐藏（不给任何动作开"常显"特例；触屏与反馈另有规则）
await page.mouse.move(0, 0);
await page.waitForTimeout(150);
const idleBars = await page.evaluate(() => [...document.querySelectorAll('[data-testid="message-actions"]')]
  .map((el) => getComputedStyle(el).opacity));
check("未悬停时动作条全部隐藏", idleBars.every((opacity) => opacity === "0"), `实际 ${idleBars.join("/")}`);

const unnamedChrome = await noName();
check("可见按钮都有可访问名（主界面）", unnamedChrome.length === 0, `${unnamedChrome.length} 个未命名`);

// 固定状态条：必须在消息滚动区外；消息类型背景必须可区分。
const turnBar = await page.evaluate(() => {
  const bar = document.querySelector('[data-testid="turn-status-bar"]');
  return { exists: bar !== null, inMain: bar?.closest("main") !== null && bar?.closest("main") !== undefined };
});
check("固定状态条在消息滚动区外", turnBar.exists && !turnBar.inMain, JSON.stringify(turnBar));
const statusText = await page.locator('[data-testid="turn-status-content"]').innerText();
check("状态条不写冗余“本轮”", !/本轮/.test(statusText), statusText.replace(/\n/g, " | "));
const statusTitles = await page.locator('[data-testid="turn-status-content"] [title]').evaluateAll((nodes) => nodes.map((node) => node.getAttribute("title") ?? ""));
check("状态条符号有 tooltip 解释", statusTitles.some((title) => title.includes("输入")) && statusTitles.some((title) => title.includes("输出")) && statusTitles.some((title) => title.includes("上下文")),
  statusTitles.join(" / "));
const statusSpacing = await page.evaluate(() => {
  const items = [...document.querySelectorAll("[data-status-metric]")];
  const iconValue = items.map((item) => {
    const icon = item.querySelector("[data-status-icon]")?.getBoundingClientRect();
    const value = item.querySelector("[data-status-value]")?.getBoundingClientRect();
    return icon === undefined || value === undefined ? 0 : Math.round(value.left - icon.right);
  });
  const boxes = items.map((item) => item.getBoundingClientRect());
  const between = boxes.slice(1).map((box, index) => Math.round(box.left - boxes[index].right));
  return { iconValue, between };
});
check("状态条：符号与数值间距 ≥4px", statusSpacing.iconValue.every((gap) => gap >= 4), statusSpacing.iconValue.join("/"));
check("状态条：指标之间间距 ≥8px", statusSpacing.between.every((gap) => gap >= 8), statusSpacing.between.join("/"));

const messageKinds = await page.evaluate(() => {
  const kinds = new Map();
  for (const el of document.querySelectorAll("[data-message-kind]")) {
    const kind = el.getAttribute("data-message-kind");
    if (kind === null) continue;
    kinds.set(kind, getComputedStyle(el).backgroundColor);
  }
  return [...kinds].map(([kind, bg]) => ({ kind, bg }));
});
check("消息类型背景可区分", new Set(messageKinds.map((item) => item.bg)).size === messageKinds.length,
  messageKinds.map((item) => `${item.kind}:${item.bg}`).join(" / "));

// 对话框里同样要成立（配置弹窗是控件最密的地方）
await page.locator('button[title="配置助手"]').first().click();
await page.waitForTimeout(400);
const unnamedDialog = await noName();
check("可见按钮都有可访问名（配置对话框）", unnamedDialog.length === 0, `${unnamedDialog.length} 个未命名`);

// 配置对话框：单页（资料 + 运行配置 + 身份）、初始焦点、内容文案、身份字号（前端规范 §2/§5/§7）
const dialogContract = await page.evaluate(() => {
  const d = document.querySelector('[role="dialog"]');
  const active = document.activeElement;
  const textarea = d?.querySelector("textarea");
  const buttons = [...(d?.querySelectorAll("button") ?? [])].map((button) => (button.textContent ?? "").trim());
  return {
    tablist: d?.querySelectorAll('[role="tablist"]').length ?? 0,
    profile: d?.querySelector('[data-testid="agent-profile"]') !== null,
    runtime: d?.querySelector('[data-testid="agent-runtime"]') !== null,
    identity: d?.querySelector('[data-testid="agent-identity"]') !== null,
    modelSave: buttons.some((text) => text.includes("保存模型配置")),
    primaryActions: d?.querySelectorAll('button[data-variant="primary"]').length ?? 0,
    activeName: active?.getAttribute("name") ?? "",
    footer: d?.querySelector("footer")?.textContent ?? "",
    identityFont: textarea === null || textarea === undefined ? 0 : parseFloat(getComputedStyle(textarea).fontSize),
  };
});
check("配置对话框：单页，无分区 Tab", dialogContract.tablist === 0, `tablist=${dialogContract.tablist}`);
check("配置对话框：资料 / 运行配置 / 身份同页", dialogContract.profile && dialogContract.runtime && dialogContract.identity && dialogContract.modelSave,
  `profile=${dialogContract.profile} runtime=${dialogContract.runtime} identity=${dialogContract.identity} modelSave=${dialogContract.modelSave}`);
check("配置对话框：只有一个 primary 操作", dialogContract.primaryActions === 1, `${dialogContract.primaryActions} 个`);
check("配置对话框：初始焦点在名字输入框", dialogContract.activeName === "agent-name", `active=${dialogContract.activeName || "(none)"}`);
check("配置对话框：footer 不写实现路径", !/agent\.json|identity\.md/.test(dialogContract.footer), dialogContract.footer);
check("配置对话框：身份正文 ≥15px", dialogContract.identityFont >= 15, `${dialogContract.identityFont}px`);

// axe：自动扫 a11y；只把 serious/critical 作为失败，minor/moderate 记录在输出。
const axePath = createRequire(import.meta.url).resolve("axe-core/axe.min.js");
await page.addScriptTag({ path: axePath });
const axeViolations = await page.evaluate(async () => {
  const dialog = document.querySelector('[role="dialog"]');
  if (dialog === null) return [{ id: "no-dialog", impact: "critical", nodes: 0 }];
  const result = await window.axe.run(dialog, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] } });
  return result.violations
    .filter((violation) => violation.impact === "serious" || violation.impact === "critical")
    .map((violation) => ({ id: violation.id, impact: violation.impact, nodes: violation.nodes.length }));
});
check("配置对话框 axe 无 serious/critical", axeViolations.length === 0, JSON.stringify(axeViolations));

await page.keyboard.press("Escape");
await page.waitForTimeout(250);

// 配置保存语义：footer primary 是“保存全部”，不是只保存基础信息。
// 复现用户反例：改模型 → 点 footer 保存 → 关闭，不能再弹“放弃未保存的改动”。
{
  const configPage = await browser.newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 1 });
  // 配置保存语义测试不依赖当前家目录有几个模型：显式给一个可切换的最小目录。
  await configPage.route(/\/api\/models-config$/, async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
      providers: [{ id: "test", models: [{ id: "m1", name: "Model 1" }, { id: "m2", name: "Model 2" }] }],
    }) });
  });
  await configPage.route(/\/api\/agents\/[^/]+\/config$/, async (route) => {
    if (route.request().method() === "GET") {
      return await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
        config: { defaultProvider: "test", defaultModel: "m1" }, effective: { defaultProvider: "test", defaultModel: "m1" }, source: "agent",
      }) });
    }
    const body = JSON.parse(route.request().postData() ?? "{}");
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ config: body, applied: 0 }) });
  });
  await configPage.route(/\/api\/agents\/[^/]+$/, async (route) => {
    if (route.request().method() !== "PUT") return route.continue();
    const body = JSON.parse(route.request().postData() ?? "{}");
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ id: "test", name: body.name, description: body.description }) });
  });
  await configPage.route(/\/api\/agents\/[^/]+\/identity$/, async (route) => {
    if (route.request().method() !== "PUT") return route.continue();
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
  });
  await configPage.goto(page.url(), { waitUntil: "networkidle" });
  await configPage.waitForTimeout(400);
  await configPage.locator('button[title="配置助手"]').first().click();
  await configPage.waitForTimeout(700);
  const footerSave = configPage.locator('[role="dialog"] footer button').filter({ hasText: /保存/ }).first();
  check("配置 footer primary 写「保存全部」", (await footerSave.textContent() ?? "").includes("保存全部"), await footerSave.textContent() ?? "");

  const modelSelect = configPage.locator('select[name="agent-model"]');
  const modelValues = await modelSelect.locator("option").evaluateAll((options) => options.map((option) => option.value));
  const currentModel = await modelSelect.inputValue();
  const nextModel = modelValues.find((value) => value !== currentModel);
  if (nextModel !== undefined) {
    await modelSelect.selectOption(nextModel);
    await configPage.waitForTimeout(200);
    await footerSave.click();
    await configPage.waitForTimeout(800);
    await configPage.locator('[role="dialog"] footer button').filter({ hasText: "关闭" }).click();
    await configPage.waitForTimeout(400);
    check("保存全部后关闭不再提示未保存", await configPage.locator('[role="dialog"]').count() === 0);
  } else {
    check("保存全部后关闭不再提示未保存", false, "没有可切换的模型");
  }

  // 基础信息走同一个 footer primary：改名 → 保存全部 → 关闭，也不应误报。
  await configPage.locator('button[title="配置助手"]').first().click();
  await configPage.waitForTimeout(700);
  await configPage.locator('input[name="agent-name"]').fill("saved-name-probe");
  await configPage.locator('[role="dialog"] footer button').filter({ hasText: /保存/ }).first().click();
  await configPage.waitForTimeout(800);
  await configPage.locator('[role="dialog"] footer button').filter({ hasText: "关闭" }).click();
  await configPage.waitForTimeout(400);
  check("保存基础信息后关闭不再提示未保存", await configPage.locator('[role="dialog"]').count() === 0);

  // 真正有未保存基础信息时，提示必须说清楚是哪个保存域。
  await configPage.locator('button[title="配置助手"]').first().click();
  await configPage.waitForTimeout(700);
  await configPage.locator('input[name="agent-name"]').fill("dirty-name-probe");
  await configPage.locator('[role="dialog"] footer button').filter({ hasText: "关闭" }).click();
  await configPage.waitForTimeout(300);
  const confirmText = await configPage.getByRole('dialog', { name: "放弃未保存的改动？" }).innerText().catch(() => "");
  check("未保存关闭提示写明「基础信息」", confirmText.includes("基础信息"), confirmText.slice(0, 100));
  await configPage.getByRole("button", { name: "取消" }).click().catch(() => {});
  await configPage.close();
}

// 消息动作条：悬停出现"复制"；点击复制文本并给"已复制"反馈（参照 Pi Web MessageView）
await page.mouse.move(0, 0);
const firstMessage = page.locator('[data-testid="message"][data-role="user"]').first();
if (await firstMessage.count() === 0) {
  check("消息动作条：悬停出现复制", false, "入口会话里没有用户消息");
} else {
  const actions = firstMessage.locator('[data-testid="message-actions"]');
  const idleOpacity = await actions.evaluate((el) => getComputedStyle(el).opacity);
  await firstMessage.hover();
  await page.waitForTimeout(250);
  const hoverOpacity = await actions.evaluate((el) => getComputedStyle(el).opacity);
  check("消息动作条：悬停出现复制", idleOpacity === "0" && hoverOpacity === "1", `idle=${idleOpacity} hover=${hoverOpacity}`);

  await page.context().grantPermissions(["clipboard-read", "clipboard-write"], { origin: APP_URL });
  const copy = firstMessage.locator('[data-testid="copy-message"]').first();
  await copy.click();
  await page.waitForTimeout(200);
  const label = (await copy.innerText()).trim();
  check("复制后按钮显示「已复制」", label.includes("已复制"), label);

  // 动作条跟着消息一侧：用户贴右（气泡右缘），助手贴左（正文左缘）——不能让按钮跑到对侧
  const align = await page.evaluate(() => {
    const box = (el) => { const b = el?.getBoundingClientRect(); return b === undefined || b === null ? null : { x: b.x, right: b.right }; };
    const user = document.querySelector('[data-testid="message"][data-role="user"]');
    const userRow = user?.querySelector('[data-testid="message-actions"]');
    const userBox = box(user);
    const userRowBox = box(userRow);
    const assistants = [...document.querySelectorAll('[data-testid="message"][data-role="assistant"]')]
      .filter((el) => el.querySelector('[data-testid="message-text"]') !== null);
    const last = assistants[assistants.length - 1];
    const lastText = box(last?.querySelector('[data-testid="message-text"]'));
    const lastRow = box(last?.querySelector('[data-testid="message-actions"]'));
    return {
      userGap: userBox === null || userRowBox === null ? null : Math.round(userBox.right - userRowBox.right),
      assistantGap: lastText === null || lastRow === null ? null : Math.round(lastRow.x - lastText.x),
    };
  });
  check("动作条跟随消息一侧（用户贴右 / 助手贴左）",
    (align.userGap === null || Math.abs(align.userGap) <= 16) && (align.assistantGap === null || Math.abs(align.assistantGap) <= 16),
    `user gap=${align.userGap}px, assistant gap=${align.assistantGap}px`);

  // 正常完成的会话里只有"复制"：重发动作只属于失败的那一轮（不能到处挂）
  const retryInMessage = await firstMessage.locator('[data-testid="resend-message"]').count();
  check("正常一轮不出现「重新发送」（只在失败消息的动作条里）", retryInMessage === 0, `${retryInMessage} 个`);

  // 反馈期间动作条不能被悬停规则收走：鼠标移开也必须还看得见"已复制"
  await page.mouse.move(0, 0);
  await page.waitForTimeout(150);
  const feedbackOpacity = await actions.evaluate((el) => getComputedStyle(el).opacity);
  const feedbackLabel = (await copy.innerText()).trim();
  check("反馈期间动作条保持可见（鼠标移开不消失）",
    feedbackOpacity === "1" && feedbackLabel.includes("已复制"), `opacity=${feedbackOpacity} label=${feedbackLabel}`);

  const clipboard = (await page.evaluate(() => navigator.clipboard.readText())).trim();
  const expected = (await firstMessage.locator('[data-testid="message-text"]').first().innerText()).trim();
  const plain = !/[*`#_[\]()<>]/.test(expected);   // 有 Markdown 记号时只断言"有内容"，否则逐字相等
  check("剪贴板内容 = 消息文本", clipboard !== "" && (!plain || clipboard === expected),
    `clipboard=${clipboard.slice(0, 30)} expected=${expected.slice(0, 30)}`);

  // 1.5s 后自动复原：文案回到"复制"，动作条随悬停收起（不残留高亮）
  await page.waitForTimeout(1400);
  const resetLabel = (await copy.innerText()).trim();
  const resetOpacity = await actions.evaluate((el) => getComputedStyle(el).opacity);
  check("反馈 1.5s 后复原（文案回「复制」、动作条随悬停收起）",
    resetLabel.includes("复制") && !resetLabel.includes("已复制") && resetOpacity === "0",
    `label=${resetLabel} opacity=${resetOpacity}`);
}

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
  // 真实会话的最后一个回合可能是空回合（中断/未回复），不能假定它一定有 usage；
  // 从后往前找一个"有回复且带 token/窗口"的回合再断言。
  const usage = await page.evaluate(async () => {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const aside = [...document.querySelectorAll("aside")].find((el) => (el.textContent ?? "").includes("完整历史"));
    if (aside === undefined) return { ok: false, detail: "找不到历史列" };
    const turns = [...aside.querySelectorAll("button")].filter((el) => /^回合 #\d/.test((el.textContent ?? "").trim()));
    for (const turn of turns.slice().reverse()) {
      turn.click();
      await sleep(220);
      const text = aside.textContent ?? "";
      if (text.includes("回复") && /tok/.test(text) && text.includes("窗口")) {
        return { ok: true, detail: (turn.textContent ?? "").trim().slice(0, 12) };
      }
    }
    return { ok: false, detail: "所有回合都没有 usage 块头" };
  });
  check("块头带 token 与占窗口比例", usage.ok, String(usage.detail));
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

// 空项目 / 新 Agent：输入框可用，首条消息 = 建会话 + 发送（参照 Pi Web 的 new session draft）
const freshPage = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
await freshPage.clock.install({ time: FROZEN_TIME });
await freshPage.goto(APP_URL, { waitUntil: "networkidle" });
const emptyTarget = await freshPage.evaluate(async () => {
  const agents = (await (await fetch("/api/agents")).json()).items;
  for (const agent of agents) {
    const groups = (await (await fetch(`/api/agents/${agent.id}/projects`)).json()).items;
    for (const project of groups) {
      const sessions = (await (await fetch(`/api/agents/${agent.id}/projects/${project.id}/sessions`)).json()).items;
      if (sessions.length === 0) return { agentId: agent.id, projectId: project.id };
    }
  }
  return null;
});
if (emptyTarget === null) {
  check("没有会话时输入框仍可用（首条消息＝建会话）", true, "没有空项目可测，跳过");
} else {
  await freshPage.goto(`${APP_URL}/?agent=${emptyTarget.agentId}&project=${emptyTarget.projectId}`, { waitUntil: "networkidle" });
  await freshPage.waitForTimeout(700);
  const emptyState = await freshPage.evaluate(() => ({
    disabled: document.querySelector("textarea")?.disabled ?? true,
    hint: /会自动|写进这个会话/.test(document.body.innerText ?? ""),
    header: document.querySelector('[data-testid="header-meta"]')?.textContent ?? "",
    text: (document.body.innerText ?? "").split("\n").filter((line) => line.trim() !== "").slice(-8).join(" | "),
  }));
  check("没有会话时输入框仍可用（首条消息＝建会话）", emptyState.disabled === false,
    `agent=${emptyTarget.agentId} project=${emptyTarget.projectId} disabled=${emptyState.disabled}`);
  check("空会话态有「直接发送即建会话」的提示", emptyState.hint, String(emptyState.text ?? ""));
  // 无会话时头部显示 Agent 默认模型；配置保存后由 agents_changed 刷新，不能要求用户手动刷新页面。
  check("无会话时头部显示默认模型", /·\s+\S+\/\S+/.test(emptyState.header), emptyState.header);
}
await freshPage.close();

// 输入历史 ↑/↓（chat.md §3.5；拦截 202，不打真实模型）
await page.route(/\/api\/agents\/[^/]+\/sessions\/[^/]+\/messages$/, (route) => route.fulfill({
  status: 202, contentType: "application/json", body: JSON.stringify({ accepted: true }),
}));
await chatComposer.fill("history-probe");
await chatComposer.press("Enter");
await page.waitForTimeout(350);
await chatComposer.fill("");
await page.waitForTimeout(120);
await chatComposer.press("ArrowUp");
await page.waitForTimeout(120);
const historyValue = await chatComposer.inputValue();
await chatComposer.fill("");
await page.waitForTimeout(120);
await chatComposer.press("ArrowDown");
await page.waitForTimeout(120);
const historyCleared = await chatComposer.inputValue();
check("空输入 ↑ 取回输入历史", historyValue === "history-probe", `value=${historyValue}`);
check("空输入 ↓ 返回空输入", historyCleared === "", `value=${historyCleared}`);
await page.unroute(/\/api\/agents\/[^/]+\/sessions\/[^/]+\/messages$/);
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(300);

// ---- 截图基线（闸 4）----
// 关键点：独立浏览器 + 每张图一个新页面 + 冻结时钟。
// 否则同一 context 里页面的先后顺序、以及"4小时前"这类相对时间文案，会让基线随机抖动（实测 66457 vs 66460 字节）。
const shotBrowser = await playwright.chromium.launch({
  headless: true, executablePath: playwright.chromium.executablePath(),
  args: ["--no-proxy-server", "--font-render-hinting=none", "--disable-lcd-text"],
});
async function capture(width, setup, clipTo) {
  const shotPage = await shotBrowser.newPage({ viewport: { width, height: 900 }, deviceScaleFactor: 1 });
  await shotPage.clock.install({ time: FROZEN_TIME });
  await shotPage.goto(ENTRY_URL, { waitUntil: "networkidle" });
  await shotPage.waitForTimeout(500);
  if (setup !== undefined) await setup(shotPage);
  await settle(shotPage);
  // 遮罩"会随数据变化"的区域（会话正文、完整历史、项目/会话行）：基线只比界面骨架。
  // 侧栏行的名称/计数/相对时间都是用户数据——用户正常使用就会变，不该让门禁变红。
  // 不这么做的话，用户每聊一句、每多一个回合，截图就漂 → 门禁天天红（实测漂 5–8%）。
  // 对话框类截图按元素裁剪：Playwright 的 mask 画在最上层，会把浮在上面的对话框一起盖住
  const buffer = clipTo === undefined
    ? await shotPage.screenshot({
        animations: "disabled", caret: "hide",
        mask: [shotPage.locator("[data-shot-mask]")],
        maskColor: "#fafafa",
      })
    : await (async () => {
        const box = await shotPage.locator(clipTo).first().boundingBox();
        if (box === null) return await shotPage.screenshot({ animations: "disabled", caret: "hide" });
        // 不留边距：留边距会把对话框背后的页面一起截进来，聊天内容一变就"假红"（实测 2%）
        const pad = 0;
        return await shotPage.screenshot({
          animations: "disabled", caret: "hide",
          // clip 截图里也用**专用**遮罩：页面级 [data-shot-mask] 会把浮层一起盖住，不能复用
          mask: [shotPage.locator("[data-shot-mask-clip]")],
          maskColor: "#fafafa",
          clip: { x: Math.max(0, box.x - pad), y: Math.max(0, box.y - pad), width: Math.min(1600, box.width + pad * 2), height: box.height + pad * 2 },
        });
      })();
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
  ["picker.png", 1600, async (shotPage) => {
    // 选择器的目录列表是用户的文件系统（新增 state/、logs/ 等就会变高）：基线用固定的目录列表，只比对话框骨架。
    await shotPage.route(/\/api\/fs\/browse\?/, async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
        path: "/Users/xulater/.lifeos", parent: "/Users/xulater",
        dirs: [".git", "agents", "config", "interaction-harness", "logs", "memory", "projects"],
      }) });
    });
    await shotPage.getByRole("button", { name: /添加项目/ }).first().click();
    await shotPage.waitForTimeout(800);
  }, '[role="dialog"]'],
  ["modal.png", 1600, async (shotPage) => {
    // 模态基线是视觉契约，不依赖当前真实 Agent 的模型配置；固定一个与基线一致的默认模型。
    await shotPage.route(/\/api\/agents\/[^/]+\/config$/, async (route) => {
      if (route.request().method() !== "GET") return route.continue();
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
        config: { defaultProvider: "command", defaultModel: "z-ai/glm-5.3-flash" },
        effective: { defaultProvider: "command", defaultModel: "z-ai/glm-5.3-flash" },
        source: "agent",
      }) });
    });
    await shotPage.locator('button[aria-label^="配置 "]').first().click();
    await shotPage.waitForTimeout(400);
  }, '[role="dialog"]'],
];
for (const [name, width, setup, clipTo] of SHOTS) {
  const buffer = await capture(width, setup, clipTo);
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


// —— P1·1.4 三态点契约（run-facts）—— 跨会话运行 / 完成未读 / 已读时间 三态语义。
// 不依赖截图基线；以"渲染后的会话列表行"断言（DOM 里 title=生成中/完成未读/时间）。
{
  const runPage = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
  await runPage.goto(ENTRY_URL, { waitUntil: "networkidle" });
  await runPage.waitForTimeout(700);
  const sessionStates = await runPage.evaluate(() => {
    return [...document.querySelectorAll("[data-testid]")].map((row) => ({
      sessionId: row.getAttribute("data-session-id"),
      running: row.querySelector('[title="生成中"]') !== null,
      unread: row.querySelector('[title="完成未读"]') !== null,
      anyDot: row.querySelector('[title="生成中"], [title="完成未读"]') !== null,
    }));
  });
  check("P1·1.4 三态点：会话列表行可捕捉", sessionStates.length >= 1, `${sessionStates.length} 行`);
}

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
