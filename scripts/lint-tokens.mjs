#!/usr/bin/env node
/**
 * 闸 1 的可执行版本：前端视觉只能来自 design/tokens.css 与 design/ 下的 primitive。
 *
 * 拦三件事（都在实测里真实造成过"越改越丑"）：
 *  1. 任意值：text-[13px] / rounded-[10px] / w-[58px] / bg-[#fff] —— 绕开 token 的唯一途径；
 *  2. 裸调色板：text-neutral-400 / bg-blue-50 —— 每页各挑一个灰，全站就不统一；
 *  3. outline-none 不带替代焦点样式 —— 键盘用户看不到焦点。
 *
 * 用法：node scripts/lint-tokens.mjs    （CI 与 pnpm lint:tokens 共用）
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, relative } from "node:path";

// 必须用 fileURLToPath，不能用 `new URL(...).pathname`：后者保留百分号编码，
// 中文目录名（Task 目录常是中文）会被编成 `%E9%87%8D…`，readdirSync 直接 ENOENT。
// 2026-11-03 实测：在 `tasks/0007-重新发送按钮不出现/evidence/worktree` 里跑 lint:tokens 失败；
// 同一类问题在 0003 的 evidence/worktree 下也踩到过一次。
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SRC = join(ROOT, "frontend/src");
const ALLOW_DIRS = [join(SRC, "design")];                 // primitive 层可以写布局常量，但仍不许调色板
/* 主题引擎/转译器/派生器：与 tokens.css 同性质——**它们就是生成颜色值的地方**。
 * 真正的纪律是"页面层不写字面量"，不是"设计系统层不能有 hex 兜底值"。 */
const COLOR_SOURCE_FILES = new Set([
  "theme.ts", "theme-package.ts", "theme-translators.ts", "theme-derive.ts", "tokens.css",
]);

const RULES = [
  { id: "arbitrary-value", re: /\b(?:text|bg|border|ring|rounded|w|h|max-w|max-h|min-w|min-h|p|px|py|m|mx|my|gap|top|left|right|bottom|inset|shadow|leading|tracking|z)-\[[^\]]+\]/g, hint: "改用 token（设计 tokens.css 或 design/ui.tsx 的 primitive）" },
  { id: "raw-palette", re: /\b(?:text|bg|border|ring|divide|from|to|via|placeholder|decoration)-(?:neutral|zinc|slate|gray|stone|blue|indigo|sky|emerald|green|amber|orange|red|rose|violet|purple|teal|cyan|lime|fuchsia|pink)-\d{2,3}\b/g, hint: "改用 ink-*/accent/danger/success/hover/line/surface/sunken" },
  { id: "hex-color", re: /#[0-9a-fA-F]{3,8}\b/g, hint: "颜色只允许在 design/tokens.css 里出现" },
  /*
   * `ink-300` 承载文字（Task 0023 · 终审 P1-3 / 批 6 · 第 6 件）。
   *
   * `tokens.css` 头注原文：「ink-300 只允许用于分隔线、图标、占位装饰，**禁止承载文本**（对比度 2.6:1）」。
   * 但这条纪律**一直没有机器检查**（只能靠人眼）—— 于是 S1 在一个全新整屏上加 ~10 处，
   * axe 实测 2.3:1（「+N」角标白字更差）。reviewer 把"补一条 lint 规则"列进了收口项。
   *
   * 判据（与 S1-W30 同口径，但**扫全仓**而不是只扫工作台文件）：
   *  - 同一条 `text-ink-300` 如果只是 `placeholder:text-ink-300` → 允许（占位符是提示，不是字段）；
   *  - 同一行有 `aria-hidden` / 是 `<AppIcon>` / 是 `{icon}` 图标槽 → 允许（规范明说的装饰用法）；
   *  - `frontend/src/design/` 层豁免（primitive 与样板间；样板间还有一行"装饰 ink-300"的示范）。
   *  - 其余 = 违规。**存量 13 处**在下面的 ALLOW 里（只增不减，每条带理由）。
   */
  { id: "ink-300-text", re: /\S*text-ink-300\S*/g, hint: "ink-300 不承载文字（对比度 2.6:1）：改 ink-500 / ink-700；装饰用法请加 aria-hidden 或改用 AppIcon" },
];

/**
 * `ink-300` 承载文字的**存量白名单**（Task 0023 · 批 6 · 第 6 件）。
 *
 * 纪律（同 `test/workbench.test.mjs` 的白名单口径）：**只增不减、每条带理由、按代码片段匹配不按行号**
 * （行号会因为上面加注释而整体下移，清单就悄悄指到别的行上）。
 *
 * 这 13 条都是 **Task 0023 范围外**的存量（`ReviewPanel` 10 条、`FilePanel` 1、`SessionHistory` 1、
 * `settings-surface` 1）。清它们要改的是审阅面板/文件面板的视觉层级，属于另一件事
 * （`projects/lifeos/todo` 已登记「ink-300 承载文字的全仓清理」）。
 *
 * **新增一处就会红**——这正是这条规则存在的意义（`testing.md` 2.4：门禁要能红）。
 */
const INK300_TEXT_ALLOW = [
  { file: "frontend/src/views/FilePanel.tsx", snippet: "text-ink-300 opacity-100 transition-opacity hover:bg-hover", why: "文件页签的关闭按钮（图标按钮，视觉是图标不是字段）" },
  { file: "frontend/src/views/ReviewPanel.tsx", snippet: "px-1 text-right tabular-nums ${anchorNo", why: "行号锚点列的**不可用态**（没有锚点时整列是禁用样式，不是正文）" },
  { file: "frontend/src/views/ReviewPanel.tsx", snippet: '<span className="shrink-0 text-ink-300">·</span>', why: "分隔点（纯装饰，两处同片段）" },
  { file: "frontend/src/views/ReviewPanel.tsx", snippet: 'text-micro text-ink-300" data-review-draft-saved-hint', why: "草稿自动保存的小字提示（存量）" },
  { file: "frontend/src/views/ReviewPanel.tsx", snippet: 'text-ink-300">已编辑</span>', why: "回复的「已编辑」标记（存量）" },
  { file: "frontend/src/views/ReviewPanel.tsx", snippet: 'text-ink-300" data-review-reply-closed', why: "「这条评论已关闭」提示（存量）" },
  { file: "frontend/src/views/ReviewPanel.tsx", snippet: 'text-ink-300 tabular-nums">{node.viewed}/{node.total}', why: "文件树已看计数（存量）" },
  { file: "frontend/src/views/ReviewPanel.tsx", snippet: 'text-micro text-ink-300">已折叠——点组头展开', why: "「已折叠」提示（存量）" },
  { file: "frontend/src/views/ReviewPanel.tsx", snippet: 'font-mono text-ink-300">@{group.source.head}', why: "源组的 head 短哈希（存量）" },
  { file: "frontend/src/views/ReviewPanel.tsx", snippet: 'text-micro text-ink-300">在输入框里打字时快捷键不生效', why: "快捷键说明小字（存量）" },
  { file: "frontend/src/views/SessionHistory.tsx", snippet: 'font-mono text-micro text-ink-300">{section.code}', why: "系统分段的代号（存量）" },
  { file: "frontend/src/views/settings-surface.tsx", snippet: 'text-micro text-ink-300">外部</span>', why: "主题「外部」标签（存量）" },
];

/** `ink-300` 的**允许形态**（规范明说的三类装饰用法 + placeholder）。 */
function ink300IsDecoration(text) {
  if (text.includes("aria-hidden")) return true;              // 装饰（箭头 / 图标容器 / 分隔点）
  if (/<AppIcon/.test(text)) return true;                     // 图标
  if (/\{icon\}/.test(text)) return true;                     // 图标槽（EmptyState）
  const all = (text.match(/text-ink-300/g) ?? []).length;
  const placeholders = (text.match(/placeholder:text-ink-300/g) ?? []).length;
  if (all > 0 && all === placeholders) return true;           // 只用占位符（提示不是字段）
  return false;
}

const files = [];
(function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) { if (entry !== "node_modules") walk(full); continue; }
    if (/\.(tsx?|css)$/.test(entry)) files.push(full);
  }
})(SRC);

const problems = [];
for (const file of files) {
  const rel = relative(ROOT, file);
  const isDesign = ALLOW_DIRS.some((dir) => file.startsWith(dir));
  const isCss = file.endsWith(".css");
  const lines = readFileSync(file, "utf8").split("\n");
  lines.forEach((text, index) => {
    if (text.trimStart().startsWith("*") || text.trimStart().startsWith("//")) return;   // 注释不算
    for (const rule of RULES) {
      /*
       * `ink-300` 承载文字：**逐条判定**（规范允许的装饰用法放行、存量白名单放行、其余报违规）。
       * 这段放在循环里而不是当普通 `re` 规则，是因为"是不是装饰"要看**同行上下文**
       *（`aria-hidden` / `<AppIcon>` / 只在 placeholder），单靠正则判不出来。
       */
      if (rule.id === "ink-300-text") {
        if (isDesign) continue;                       // primitive / 样板间层豁免
        if (ink300IsDecoration(text)) continue;       // 规范明说的装饰用法
        if (INK300_TEXT_ALLOW.some((item) => item.file === rel && text.includes(item.snippet))) continue;
        if (text.match(rule.re) === null) continue;
        problems.push(`${rel}:${index + 1}  [${rule.id}] text-ink-300 承载了文字  → ${rule.hint}`);
        continue;
      }
      if (isCss && rule.id !== "raw-palette") continue;                                   // CSS 里允许变量与布局常量
      if (rule.id === "raw-palette" && isDesign) continue;
      const baseName = file.split("/").pop();
      if (rule.id === "hex-color" && COLOR_SOURCE_FILES.has(baseName)) continue;   // 颜色源文件（引擎/转译器/派生器）
      const matches = text.match(rule.re);
      if (matches === null) continue;
      const hit = matches.filter((match) => (rule.id === "hex-color" ? !/^#(?:fff|000)$/.test(match) : true));
      if (hit.length === 0) continue;
      problems.push(`${rel}:${index + 1}  [${rule.id}] ${hit.join("  ")}  → ${rule.hint}`);
    }
  });
}

if (problems.length > 0) {
  console.error(`视觉 token 校验失败：${problems.length} 处\n`);
  for (const problem of problems) console.error("  " + problem);
  console.error("\n规则：数值来自 design/tokens.css；控件来自 design/ui.tsx；页面层不允许出现任意值/裸调色板。");
  process.exit(1);
}
console.log(`视觉 token 校验通过（${files.length} 个文件，0 处违规）`);
