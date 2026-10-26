// Task 0002 手动预览截图：桌面与手机两个视口的 composer 区域（开发实例 5174）。
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const candidates = [
  process.env.PLAYWRIGHT_CORE,
  join(HERE, "../../frontend/node_modules/playwright-core/index.js"),
  join(homedir(), ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright-core/index.js"),
].filter((p) => existsSync(p));
if (candidates.length === 0) throw new Error("找不到 playwright-core");

const pw = (await import(candidates[0])).default ?? (await import(candidates[0]));

const BACKEND = "http://127.0.0.1:43130";
const FRONT = "http://localhost:5174";

const browser = await pw.chromium.launch();
const out = [];

async function shot(name, width, height) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2, isMobile: width < 640 });
  const page = await ctx.newPage();
  await page.goto(FRONT, { waitUntil: "networkidle" });
  // 等 composer 出现（开发实例里有模板默认 Agent）
  await page.waitForSelector('[data-testid="composer"] textarea', { timeout: 15000 });
  await page.waitForTimeout(600);
  const comp = page.locator('[data-testid="composer"]');
  await comp.screenshot({ path: `/tmp/composer-${name}.png` });
  await page.screenshot({ path: `/tmp/page-${name}.png` });
  out.push(name);
  await ctx.close();
}

await shot("desktop", 1280, 800);
await shot("mobile", 390, 844);
await browser.close();
console.log("写好：", out.map((n) => `/tmp/composer-${n}.png /tmp/page-${n}.png`).flat().join(", "));
