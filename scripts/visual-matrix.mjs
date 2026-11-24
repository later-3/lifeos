#!/usr/bin/env node
/**
 * 视觉矩阵（T2 · Task 0017 · P1.5 重定取景对象）。
 *
 * ## 为什么重写取景对象（2026-11-16，用户拍板方案 A）
 *
 * 旧版截的是**真实应用页面**（聊天、设置、空态、消息正文）：5 场景 × 2 模式 × 2 视口 = 24 张。
 * 问题三条，全部实测：
 *  ① 全是用户数据（28 条会话、14 个助手名、相对时间）→ 用户正常使用就漂 → 恒红；
 *     实测把 P1 的改动 `git stash` 掉再跑，仍然是 24 张里 22 张不一致
 *     —— 差异不是代码造成的，是基线本身过期。
 *  ② **hover 态 0 张**：而「悬停底裂成两块」正是 hover 态的形状缺陷，在矩阵里根本不可见。
 *  ③ **外部主题 0 张**：只设 `localStorage.theme = { mode }`，从不加载主题包；
 *     而「选中底变荧光绿 + 光环变灰泥」只在外部主题下出现。
 *
 * 参考两家做截图的共同做法：
 *  - **Rocket.Chat** 只截 Storybook 里的**孤立组件**（`packages/visual-regression/test/visualRegression.spec.ts:24-36`），
 *    568 张基线全部入 git，从不截带真实数据的应用页面；
 *  - **Mattermost** 只截 6 个**内容固定**的页面，并且用 `hideDynamicChannelsContent()`
 *    把时间/头像 `visibility:hidden` 藏掉（`lib/src/test_action.ts:8-20`）；`PW_SNAPSHOT_ENABLE` 默认 false。
 *
 * ## 现在截什么
 *
 * 截 `frontend/dev/design-system.html` 里的 `[data-shot-zone]` 取景框：
 * 全是**真实组件**（Row / SessionRow / GroupHeader / Button / Field…），零用户数据。
 * 带 `data-shot-hover` 的框先悬停再截，所以 hover 态终于进了矩阵。
 *
 * 维度：`取景框 × {内置浅色, 内置深色, Quiet Light, Monokai} × {1280}`
 *  —— 视口只留 1280：取景框宽度是固定的（`max-w-4xl` 内），1920 与 1280 截出来的组件完全一样，
 *     多一维只是多一倍人眼成本（Rocket.Chat 的视觉回归也只有 `desktop` 一个 project）。
 *
 * 用法：
 *   APP_URL=http://127.0.0.1:5192 node scripts/visual-matrix.mjs              # 比对
 *   APP_URL=... node scripts/visual-matrix.mjs --update                       # 更新基线（必须先人眼看报告）
 *   APP_URL=... node scripts/visual-matrix.mjs --report /tmp/report.html
 *
 * 基线目录：`frontend/test/visual-matrix/`（**入 Git**，换机器/换人首次跑也有效）。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const APP_URL = process.env.APP_URL ?? "http://localhost:5173";
const BASELINE = join(ROOT, "frontend/test/visual-matrix");
const SHOTS = join(ROOT, ".visual-matrix-shots");
/*
 * 产物目录必须自己建（Task 0023 · S1 第 4 块实测）：
 * `.visual-matrix-shots/` 在 .gitignore 里，**新工作区 / 干净环境从来没有这个目录** ——
 * 原来第一次 `writeFileSync(join(SHOTS, file))` 直接 ENOENT 崩溃，
 * 报错长得像"页面挂了"，实际是"工具没建自己的输出目录"。
 */
mkdirSync(SHOTS, { recursive: true });
const UPDATE = process.argv.includes("--update");
const REPORT = (() => {
  const index = process.argv.indexOf("--report");
  return index >= 0 ? process.argv[index + 1] : join(SHOTS, "report.html");
})();

const CANDIDATES = [
  process.env.PLAYWRIGHT_CORE,
  join(ROOT, "frontend/node_modules/playwright-core/index.js"),
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

const { pixelDiff } = await import(join(ROOT, "frontend/test/png.mjs"));

/* ── 主题维（Task 0017 · P1.5）───────────────────────────────────────────
 * 四档：内置浅色 / 内置深色 / Quiet Light / Monokai。
 * 后两个是**外部主题包**——「选中底变荧光绿」只在它们下面出现，而旧矩阵从不加载主题包。
 * `theme` 值由样板间的 URL 参数消费（`/dev/design-system.html?mode=&theme=`）。
 */
const THEMES = [
  { id: "builtin-light", mode: "light", theme: "builtin" },
  { id: "builtin-dark", mode: "dark", theme: "builtin" },
  { id: "quiet-light", mode: "light", theme: "quiet-light" },
  { id: "monokai", mode: "dark", theme: "monokai" },
];

/*
 * 取景框（`[data-shot-zone]` 的 id）。**不在这里硬编码清单**——运行时从页面读，
 * 这样新增一个取景框不需要改脚本（少一处会漂的第二事实源）。
 */
const ZONES_FALLBACK = ["row-idle"];

const DEV_PAGE = `${APP_URL}/dev/design-system.html`;

const browser = await playwright.chromium.launch({
  headless: true,
  executablePath: playwright.chromium.executablePath(),
  // 与 ui-contract 同一套光栅化参数：字体渲染差异会让基线跨机器漂
  args: ["--no-proxy-server", "--font-render-hinting=none", "--disable-lcd-text"],
});

const results = [];
const FROZEN_TIME = new Date("2026-11-09T12:00:00+08:00");

for (const preset of THEMES) {
  const page = await browser.newPage({ viewport: { width: 1200, height: 1400 }, deviceScaleFactor: 1 });
  // 冻结时钟：定点与相对时间文案不该让基线抖
  await page.clock.install({ time: FROZEN_TIME });
  await page.goto(`${DEV_PAGE}?mode=${preset.mode}&theme=${preset.theme}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(700);

  const zones = await page.evaluate(() => [...document.querySelectorAll("[data-shot-zone]")]
    .map((el) => ({ id: el.getAttribute("data-shot-zone"), hover: el.querySelector("[data-shot-hover]") !== null })));
  const list = zones.length === 0 ? ZONES_FALLBACK.map((id) => ({ id, hover: false })) : zones;

  for (const zone of list) {
    const locator = page.locator(`[data-shot-zone="${zone.id}"]`).first();
    if (zone.hover) {
      // 悬停取景框里的那一行（真实鼠标坐标：`:hover` 只在指针真的落在元素上时成立）
      const target = page.locator(`[data-shot-zone="${zone.id}"] [data-shot-hover]`).first();
      const box = await target.boundingBox();
      if (box !== null) await page.mouse.move(box.x + 24, box.y + box.height / 2, { steps: 4 });
      await page.waitForTimeout(360);   // 等 transition 结束（动作层 opacity 0→100）
    } else {
      await page.mouse.move(0, 0);
      await page.waitForTimeout(120);
    }
    const file = `${zone.id}-${preset.id}.png`;
    const buffer = await locator.screenshot({ animations: "disabled", caret: "hide" });
    writeFileSync(join(SHOTS, file), buffer);

    const basePath = join(BASELINE, file);
    if (UPDATE) {
      writeFileSync(basePath, buffer);
      results.push({ zone: zone.id, preset: preset.id, file, status: "updated" });
      continue;
    }
    /*
     * 缺基线 = **红**（不是"首次写入并报绿"）。
     * 旧版 `if (UPDATE || !existsSync(basePath)) { writeFileSync(...); status = "created" }`
     * 会让干净环境首次跑**全部通过**——等于没测（本仓已踩过一次，见 .gitignore 注释）。
     */
    if (!existsSync(basePath)) {
      results.push({ zone: zone.id, preset: preset.id, file, status: "missing" });
      continue;
    }
    const diff = pixelDiff(readFileSync(basePath), buffer);
    results.push({
      zone: zone.id, preset: preset.id, file,
      status: diff.ratio <= 0.0005 ? "same" : "diff",
      ratio: diff.ratio, maxDelta: diff.maxDelta,
    });
  }
  await page.close();
}

await browser.close();

/* ── 报告（人眼看的那一份）─────────────────────────────────────────────── */

const encode = (path) => (path !== "" && existsSync(path) ? readFileSync(path).toString("base64") : "");
const rows = results.map((item) => {
  const label = `${item.zone} · ${item.preset}`;
  const baseline = join(BASELINE, item.file);
  const current = join(SHOTS, item.file);
  const badge = item.status === "same" ? "✔ 一致"
    : item.status === "diff" ? `✖ 差异 ${(item.ratio * 100).toFixed(2)}%`
      : item.status === "missing" ? "！缺基线"
        : item.status === "updated" ? "↻ 已更新" : item.status;
  const color = item.status === "diff" || item.status === "missing" ? "#c0392b" : item.status === "same" ? "#1e8449" : "#7f8c8d";
  const imgs = item.status === "diff" || item.status === "same"
    ? `<img src="data:image/png;base64,${encode(baseline)}" height="90"><img src="data:image/png;base64,${encode(current)}" height="90">`
    : "";
  return `<tr><td>${label}</td><td style="color:${color};white-space:nowrap">${badge}</td><td>${imgs}</td></tr>`;
}).join("\n");

mkdirSync(dirname(REPORT), { recursive: true });
writeFileSync(REPORT, `<!doctype html><meta charset="utf-8"><title>视觉矩阵报告 · 组件取景框</title>
<style>body{font:13px -apple-system,'PingFang SC';margin:24px;color:#222}table{border-collapse:collapse}
td,th{border:1px solid #ddd;padding:6px;vertical-align:top}img{border:1px solid #eee;margin-right:4px;background:#fff}</style>
<h1>视觉矩阵报告（组件取景框）</h1>
<p>取景对象：<code>frontend/dev/design-system.html</code> 的 <code>[data-shot-zone]</code>，全部是真实组件、零用户数据。
主题维：内置浅色 / 内置深色 / Quiet Light / Monokai。带 hover 的取景框先悬停再截。判定阈值 0.05%。</p>
<p>左图 = 基线，右图 = 本次。</p>
<table><tr><th>取景框 · 主题</th><th>结果</th><th>基线 / 本次</th></tr>${rows}</table>`);

const diffed = results.filter((item) => item.status === "diff");
const missing = results.filter((item) => item.status === "missing");
console.log(`视觉矩阵：${results.length} 张（${THEMES.length} 主题 × ${results.length / THEMES.length} 取景框）`);
console.log(`一致 ${results.filter((item) => item.status === "same").length} · 差异 ${diffed.length} · 缺基线 ${missing.length}${UPDATE ? " · 已更新基线" : ""}`);
for (const item of diffed) console.log(`  ✖ ${item.zone}/${item.preset}：差异 ${(item.ratio * 100).toFixed(2)}%（最大通道差 ${item.maxDelta}）`);
for (const item of missing) console.log(`  ！ ${item.zone}/${item.preset}：缺基线（先 --update 并人眼确认后提交）`);
console.log(`报告：${REPORT}`);
if ((diffed.length > 0 || missing.length > 0) && !UPDATE) process.exit(1);
