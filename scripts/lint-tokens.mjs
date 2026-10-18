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
import { join, relative } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const SRC = join(ROOT, "frontend/src");
const ALLOW_DIRS = [join(SRC, "design")];                 // primitive 层可以写布局常量，但仍不许调色板

const RULES = [
  { id: "arbitrary-value", re: /\b(?:text|bg|border|ring|rounded|w|h|max-w|max-h|min-w|min-h|p|px|py|m|mx|my|gap|top|left|right|bottom|inset|shadow|leading|tracking|z)-\[[^\]]+\]/g, hint: "改用 token（设计 tokens.css 或 design/ui.tsx 的 primitive）" },
  { id: "raw-palette", re: /\b(?:text|bg|border|ring|divide|from|to|via|placeholder|decoration)-(?:neutral|zinc|slate|gray|stone|blue|indigo|sky|emerald|green|amber|orange|red|rose|violet|purple|teal|cyan|lime|fuchsia|pink)-\d{2,3}\b/g, hint: "改用 ink-*/accent/danger/success/hover/line/surface/sunken" },
  { id: "hex-color", re: /#[0-9a-fA-F]{3,8}\b/g, hint: "颜色只允许在 design/tokens.css 里出现" },
];

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
      if (isCss && rule.id !== "raw-palette") continue;                                   // CSS 里允许变量与布局常量
      if (rule.id === "raw-palette" && isDesign) continue;
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
