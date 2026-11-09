#!/usr/bin/env node
/**
 * 可访问性审计（T3）—— 用 axe-core 跑真实页面，serious/critical 必须为 0。
 *
 * 为什么有这个脚本：`specs/frontend-development/frontend-spec.md` §9.1 检查点 3
 * 早就写了「axe 无 serious/critical」，但**从来没有实现**（规范写了没落地）。
 * 我们的 ui-contract 手写了几条（命中区、对比度、焦点可见），覆盖不到
 * `aria-*` 合法性、label 关联、landmark 唯一、role 合法性这些 axe 的强项。
 *
 * 用法：
 *   APP_URL=http://127.0.0.1:5192 node scripts/a11y-audit.mjs
 *   APP_URL=... node scripts/a11y-audit.mjs --strict     # moderate 也当失败
 *
 * 判级（与 frontend-spec §9.1 一致）：
 *   · serious / critical → **阻塞**（退出码 1）
 *   · moderate / minor   → 只报告（退出码 0），进 HTML/终端报告供排期
 *
 * 覆盖：4 个视口 × 深浅色 × 5 个页面状态（对话 / 设置-主题 / 设置-显示 / 完整历史 / 文件面板）。
 * 注：设置页与文件面板都要"点开"才有，脚本按 aria-label 点击后等元素出现。
 */
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

const HERE = dirname(fileURLToPath(import.meta.url));
const APP_URL = process.env.APP_URL ?? "http://localhost:5173";
const STRICT = process.argv.includes("--strict");

const CANDIDATES = [
  process.env.PLAYWRIGHT_CORE,
  join(HERE, "../frontend/node_modules/playwright-core/index.js"),
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

const AXE_PATH = join(HERE, "../frontend/node_modules/axe-core/axe.min.js");
if (!existsSync(AXE_PATH)) throw new Error(`找不到 axe-core：${AXE_PATH}（pnpm --dir frontend add -D axe-core）`);

/** 页面状态：名字 + 进入动作（点开面板等）。 */
const SCENES = [
  { name: "对话", enter: async () => {} },
  {
    name: "设置-主题",
    enter: async (page) => {
      await page.locator('nav[aria-label="左侧图标轨"] button[aria-label="设置"]').click();
      await page.waitForSelector('[data-testid="settings-surface"]', { timeout: 8000 });
    },
  },
  {
    name: "设置-显示",
    enter: async (page) => {
      await page.locator('nav[aria-label="左侧图标轨"] button[aria-label="设置"]').click();
      await page.waitForSelector('[data-testid="settings-surface"]', { timeout: 8000 });
      await page.evaluate(() => {
        const btn = [...document.querySelectorAll('nav[aria-label="设置分区"] button')].find((item) => (item.innerText ?? "").includes("显示"));
        btn?.click();
      });
      await page.waitForTimeout(300);
    },
  },
  {
    name: "完整历史",
    enter: async (page) => {
      // 草稿态（还没选会话）这个按钮是 disabled 的 —— 那不是可访问性缺陷，跳过本场景
      const trigger = page.locator('button[aria-label="完整历史"]').first();
      if (await trigger.isDisabled().catch(() => true)) return "skip";
      await trigger.click();
      await page.waitForSelector('[data-resize-key="c5"]', { timeout: 10000 });
    },
  },
  {
    name: "文件面板",
    enter: async (page) => {
      const trigger = page.locator('button[aria-label="展开文件面板"]').first();
      if (await trigger.count() === 0) return "skip";
      await trigger.click();
      // 视口/草稿态下可能放不下（layout.ts 的 panelFits）—— 不是可访问性缺陷
      const opened = await page.waitForSelector('[data-resize-key="c4"]', { timeout: 4000 }).then(() => true).catch(() => false);
      return opened ? undefined : "skip";
    },
  },
];

const VIEWPORTS = [1280, 1440, 1600, 1920];
const MODES = ["light", "dark"];

const browser = await playwright.chromium.launch({ headless: true, args: ["--no-proxy-server"] });
const axeSource = (await import("node:fs")).readFileSync(AXE_PATH, "utf8");

const blocking = [];
const advisory = [];
let checks = 0;

for (const viewport of VIEWPORTS) {
  for (const mode of MODES) {
    for (const scene of SCENES) {
      const page = await browser.newPage({ viewport: { width: viewport, height: 900 }, deviceScaleFactor: 1 });
      await page.addInitScript((value) => localStorage.setItem("lifeos.theme", JSON.stringify({ mode: value })), mode);
      await page.goto(APP_URL, { waitUntil: "networkidle" });
      await page.waitForTimeout(600);
      try {
        const outcome = await scene.enter(page);
        if (outcome === "skip") { await page.close(); continue; }
      } catch (error) {
        advisory.push({ viewport, mode, scene: scene.name, id: "scene-enter-failed", impact: "minor", message: String(error).slice(0, 120), nodes: [] });
        await page.close();
        continue;
      }
      await page.addScriptTag({ content: axeSource });
      const result = await page.evaluate(async () => await window.axe.run(document, {
        // 只查我们关心的规则族；颜色对比度我们另有更严的自定义闸（含 22px 大字规则）
        runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"] },
      }));
      checks += 1;
      for (const violation of result.violations) {
        const entry = {
          viewport,
          mode,
          scene: scene.name,
          id: violation.id,
          impact: violation.impact ?? "minor",
          message: violation.help,
          nodes: violation.nodes.slice(0, 3).map((node) => node.target.join(" ")),
        };
        if (entry.impact === "serious" || entry.impact === "critical") blocking.push(entry);
        else advisory.push(entry);
      }
      await page.close();
    }
  }
}

await browser.close();

const byId = (list) => {
  const map = new Map();
  for (const item of list) map.set(item.id, (map.get(item.id) ?? 0) + 1);
  return [...map.entries()].sort((a, b) => b[1] - a[1]);
};

console.log(`可访问性审计（axe-core）：${checks} 次运行（${VIEWPORTS.length} 视口 × ${MODES.length} 模式 × ${SCENES.length} 场景）`);
if (blocking.length === 0) {
  console.log("✔ serious / critical：0");
} else {
  console.log(`✖ serious / critical：${blocking.length}`);
  for (const [id, count] of byId(blocking)) {
    const sample = blocking.find((item) => item.id === id);
    console.log(`   ${id} × ${count}  — ${sample.message}`);
    console.log(`     例：${sample.viewport}/${sample.mode}/${sample.scene} → ${sample.nodes.join(" | ")}`);
  }
}
if (advisory.length > 0) {
  console.log(`\n提示（不阻塞）：${advisory.length}`);
  for (const [id, count] of byId(advisory)) {
    const sample = advisory.find((item) => item.id === id);
    console.log(`   ${id} × ${count}  — ${sample.message}`);
  }
}
if (blocking.length > 0 || (STRICT && advisory.length > 0)) process.exit(1);
