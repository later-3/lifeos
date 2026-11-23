/**
 * 压测：用**真实会话文本**跑 markdown 管线，看是否存在病态耗时（Task 0033 · 定位辅助）。
 *
 * 为什么需要：卡死现场的栈停在 V8 JIT 段，无法直接给出函数名。但如果我们能证明
 * "这段真实文本让某个纯函数耗时异常"，那就把"JIT 段"缩小到了具体一段代码。
 *
 * 用法：
 *   APP_URL=http://localhost:43120 node scripts/probe-md-stress.mjs
 *   TEXT_FILE=/path/to/texts.json   （JSON 字符串数组）
 */

import { join } from "node:path";
import { homedir } from "node:os";
import { readFileSync } from "node:fs";

const PW = join(homedir(), ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright-core/index.js");
const mod = await import(PW);
const playwright = mod.default ?? mod;

const APP_URL = process.env.APP_URL ?? "http://127.0.0.1:43120";
const TEXT_FILE = process.env.TEXT_FILE ?? join(homedir(), ".lifeos/tmp/lasttext.json");
const THROTTLE = Number(process.env.THROTTLE ?? 4);
const texts = JSON.parse(readFileSync(TEXT_FILE, "utf8"));

const browser = await playwright.chromium.launch({ headless: true, executablePath: playwright.chromium.executablePath() });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
await page.goto(APP_URL, { waitUntil: "domcontentloaded", timeout: 120_000 });
await page.waitForTimeout(3_000);

const cdp = await page.context().newCDPSession(page);
await cdp.send("Emulation.setCPUThrottlingRate", { rate: THROTTLE });
console.log(`CPU ${THROTTLE}x，${texts.length} 段真实文本`);

/*
 * 在页面里 import 产品代码跑管线。Vite 的 dev server 能解析 `/src/...`；
 * 生产构建下这些模块已经打包，无法单独 import —— 所以探针必须对 dev server 跑。
 */
const result = await page.evaluate(async (list) => {
  const { renderMarkdown } = await import("/src/views/message-markdown.tsx");
  const { closeIncompleteMarkdown } = await import("/src/md-stream.ts");
  const { fixCjkEmphasis } = await import("/src/api/md-cjk.ts");
  const { expandShortcodes } = await import("/src/api/emoji-catalog.ts");

  const measure = (label, fn, input) => {
    const t0 = performance.now();
    const out = fn(input);
    const ms = performance.now() - t0;
    return { label, ms: Math.round(ms * 100) / 100, inChars: input.length, outChars: typeof out === "string" ? out.length : -1 };
  };

  const rows = [];
  for (const text of list) {
    rows.push(measure("expandShortcodes", expandShortcodes, text));
    rows.push(measure("fixCjkEmphasis", fixCjkEmphasis, text));
    rows.push(measure("closeIncompleteMarkdown", closeIncompleteMarkdown, text));
    rows.push(measure("renderMarkdown(全量)", renderMarkdown, text));
    /*
     * 流式的最坏情况：**每个前缀**都跑一遍。
     * 一个 1600 字的回复在流式期会产生 ~1600 次渲染，如果单次 5ms 就是 8 秒的累计主线程占用。
     */
    const step = Math.max(1, Math.floor(text.length / 20));
    const t0 = performance.now();
    for (let i = 1; i <= text.length; i += step) {
      renderMarkdown(text.slice(0, i));
    }
    rows.push({ label: `renderMarkdown(流式前缀×${Math.ceil(text.length / step)})`, ms: Math.round((performance.now() - t0) * 100) / 100, inChars: text.length, outChars: -1 });
  }
  return rows;
}, texts);

const byLabel = new Map();
for (const row of result) {
  const prev = byLabel.get(row.label) ?? { max: 0, total: 0, count: 0 };
  byLabel.set(row.label, { max: Math.max(prev.max, row.ms), total: prev.total + row.ms, count: prev.count + 1 });
}
console.log("\n按管线阶段（4x 节流）：");
for (const [label, agg] of byLabel) {
  console.log(`  ${label.padEnd(38)} 最大 ${String(agg.max).padStart(8)}ms  平均 ${String(Math.round(agg.total / agg.count * 100) / 100).padStart(8)}ms  ×${agg.count}`);
}

await browser.close();
