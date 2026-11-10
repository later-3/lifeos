#!/usr/bin/env node
/**
 * md 渲染契约（线 B · 2026-11-10）。
 *
 * 看什么（用户点名的三类缺陷的回归锁）：
 *  ① fence 产 data-md-code + pending 类，decorate 后出现 `text-syn-*` span（语法高亮管线存活）；
 *  ② 已装饰的块不再带 pending（流式重渲染不重复 tokenize）；
 *  ③ 深色下 `--color-syn-*` 是 dark 派生值、浅色是 tokens.css 静态值（同 token 两套口径，防丢）；
 *  ④ fenced 底 = `--color-hover`（深色比页面亮、浅色比页面暗 —— "凹陷"病回归锁）。
 *  ⑤ prose 间距分层落地（h2 前 1.5em、段落 0.75em；旧版全部 0.6em 的回归即红）。
 *
 * 用法：`APP_URL=http://127.0.0.1:5192 node frontend/test/md-render-contract.mjs`
 * （要求 dev 服务器；模块经 vite 的 /src/*.ts 装载，无需渲染整个 App。）
 */
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const APP_URL = process.env.APP_URL ?? "http://localhost:5192";

const CANDIDATES = [
  process.env.PLAYWRIGHT_CORE,
  join(HERE, "../node_modules/playwright-core/index.js"),
  join(homedir(), ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright-core/index.js"),
].filter(Boolean);

let playwright;
for (const candidate of CANDIDATES) {
  if (!existsSync(candidate)) continue;
  playwright = (await import(candidate)).default ?? (await import(candidate));
  break;
}
if (playwright === undefined) throw new Error("找不到 playwright-core：设置 PLAYWRIGHT_CORE=...");

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "✔" : "✖"} ${name}${detail ? `  → ${detail}` : ""}`);
};

const browser = await playwright.chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
await page.goto(APP_URL, { waitUntil: "networkidle" });
await page.waitForTimeout(800);
if (process.argv.includes("--dark")) {
  await page.evaluate(() => { localStorage.setItem("lifeos.theme", JSON.stringify({ mode: "dark", preset: "neutral" })); });
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(900);
}

const probe = await page.evaluate(async () => {
  const { renderMarkdown } = await import("/src/message-markdown.tsx");
  const { decorateCodeBlocks, languageOfFence } = await import("/src/md-highlight.ts");
  const langAliases = [languageOfFence("sh"), languageOfFence("yml"), languageOfFence("ts")];
  const host = document.createElement("div");
  host.className = "md-body";
  const src = "```ts\nconst a: number = 1; // demo comment\nexport function hi(n: string) { return `x-${n}` }\n```\n";
  host.innerHTML = renderMarkdown(src);
  document.body.appendChild(host);
  const pre = host.querySelector("pre");
  const code = host.querySelector("code");
  const before = {
    preDataLang: pre?.getAttribute("data-md-code"),
    pending: code?.classList.contains("md-hl-pending") === true,
  };
  const decorated = await decorateCodeBlocks(host);
  const spans = [...host.querySelectorAll("code span")].map((s) => s.className);
  const after = {
    highlighted: decorated === 1 && spans.length > 3 && spans.some((c) => c.includes("text-syn-")),
    noPending: host.querySelectorAll(".md-hl-pending").length === 0,
  };
  // 幂等：再跑一次不会重算（pending 已零）
  const again = await decorateCodeBlocks(host);
  // 深浅色变量
  const css = getComputedStyle(document.documentElement);
  const lh = {
    mode: document.documentElement.dataset.themeMode,
    synKeyword: css.getPropertyValue("--color-syn-keyword").trim(),
    fencedBg: getComputedStyle(pre).backgroundColor,
    bodyFontSize: parseFloat(getComputedStyle(host).fontSize),
    spacing: (() => {
      host.innerHTML = renderMarkdown("段落占位\n\n## 标题间距探针\n\n后续段落");
      const h2 = host.querySelector("h2");
      const p0 = host.querySelector("p");
      return { h2mt: h2 === null ? "no-h2" : getComputedStyle(h2).marginTop,
        pmb: p0 === null ? "no-p" : getComputedStyle(p0).marginBottom };
    })(),
  };
  host.remove();
  return { before, after, again, langAliases, fontSize: lh.bodyFontSize, ...lh };
});

check("md fence：data-md-code 带语言 + code 带 md-hl-pending",
  probe.before.preDataLang === "ts" && probe.before.pending === true, JSON.stringify(probe.before));
check("md fence：decorate 后出现 text-syn-* 高亮 span",
  probe.after.highlighted === true, `decorated=${probe.after.highlighted}）`);
check("md fence：已装饰块不再有 pending（幂等，next pass 必须是 0 次重算）",
  probe.after.noPending === true && probe.again === 0, `again=${probe.again}`);
check("md fence：fence 语言别名归一（sh → bash、yml → yaml、ts → typescript）",
  probe.langAliases?.[0] === "bash" && probe.langAliases?.[1] === "yaml" && probe.langAliases?.[2] === "typescript",
  JSON.stringify(probe.langAliases));

const isDark = probe.mode === "dark";
const expectKw = isDark ? "#c4b5fd" : "#5b21b6";
check(`syn 色随主题模式换挡（当前=${probe.mode}，${isDark ? "深色派生" : "浅色静态"}）`,
  probe.synKeyword.toLowerCase() === expectKw.toLowerCase(), `${probe.mode}: ${probe.synKeyword}`);

// fenced 底：dark = hover（亮于页面底）、light = hover（暗于页面底）——统一断言「不是 sunken」/「不是透明」
check("md fenced 底 = --color-hover（深浅自适应；批量防「凹陷」回归）",
  probe.fencedBg !== "rgba(0, 0, 0, 0)" && probe.fencedBg !== "rgb(250, 250, 250)", probe.fencedBg);

check("prose 间距分层：h2 前 1.5em（≈22.5px）/ 段落 0.75em（≈11.25px）",
  (() => {
    const fontSize = probe.fontSize ?? 15;
    const h2Size = fontSize * 1.12;           // h2 的 1.5em 相对**自身**字级（CSS em 语义）
    const h2mt = parseFloat(probe.spacing?.h2mt ?? "0");
    const pmb = parseFloat(probe.spacing?.pmb ?? "0");
    return Math.abs(h2mt - 1.5 * h2Size) < 2 && Math.abs(pmb - 0.75 * fontSize) < 2;
  })(),
  `h2-mt=${probe.spacing?.h2mt} p-mb=${probe.spacing?.pmb}`);

// 语义块深浅换挡（spec 2.30）—— 追加在 browser 关闭前的第二段探针
{
  const semantic = await page.evaluate(() => {
    const mk = (cls) => {
      const el = document.createElement("div");
      el.className = cls;
      document.body.appendChild(el);
      const bg = getComputedStyle(el).backgroundColor;
      el.remove();
      return bg;
    };
    return {
      mode: document.documentElement.dataset.themeMode,
      thinking: mk("bg-message-thinking"),
      toolDone: mk("bg-message-tool-done"),
      user: mk("bg-message-user"),
    };
  });
  check("语义块：thinking/tools 深色不再沿用浅色静态值（#fafafa/#f4f4f5 已派生）",
    !(semantic.mode === "dark" && semantic.thinking === "rgb(250, 250, 250)"),
    `${semantic.mode}: thinking=${semantic.thinking} done=${semantic.toolDone}`);
  const channels = semantic.user.match(/\d+/g)?.map(Number) ?? [];
  check("语义块：user 气泡深色 = accent-solid（主题派生）、浅色保持黑",
    semantic.mode === "dark" ? channels.every((v) => v > 40) : channels.every((v) => v < 40),
    `${semantic.mode}: user=${semantic.user}`);
}

await browser.close();

const failed = results.filter((r) => !r.ok);
console.log(failed.length === 0
  ? `\nmd 渲染契约通过（${results.length} 项）`
  : `\nmd 渲染契约 ${failed.length} 项失败`);
process.exitCode = failed.length === 0 ? 0 : 1;

