/**
 * 版本提示契约（Task 0013，案例 C216）。
 *
 * 按 testing 规范：
 * - 2.15：元素断言必须命中真实选择器并断言**几何**（宽高 + offsetParent），0 个 = 没测（显式输出）；
 * - 2.11：轮询间隔不等待真实时间——version-check 首次加载即查一次，测试只需等首查；
 * - 2.1：mock 需要一条"已命中"断言；注入夹具走 addInitScript（__LIFEOS_BUILD__），不依赖真实构建。
 *
 * 运行：先起 dev server（默认 http://localhost:5173；APP_URL 可覆盖）
 *   APP_URL=http://127.0.0.1:5176 node frontend/test/version-banner.mjs
 */
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const require_ = createRequire(import.meta.url);
function loadPlaywrightCore() {
  const candidates = [
    join(HERE, "../../frontend/node_modules/playwright-core/index.js"),
    join(process.env.HOME ?? "", ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright-core/index.js"),
  ];
  for (const c of candidates) if (existsSync(c)) return require_(c);
  throw new Error("找不到 playwright-core：设置 PLAYWRIGHT_CORE=/path/to/playwright-core/index.js");
}

const APP_URL = process.env.APP_URL ?? "http://localhost:5173";
const { chromium } = loadPlaywrightCore();

/** 显式报数（testing 2.15：0 个 = 没测，不许静默）。 */
function assertCount(label, n, atLeast) {
  console.log(`  [计数] ${label}: ${n}（要求 ≥${atLeast}）`);
  if (n < atLeast) throw new Error(`${label} 命中 ${n} 个，要求 ≥${atLeast} —— 0 个 = 没测`);
}

const browser = await chromium.launch();
let failures = 0;

/** 打开页面并注入夹具：当前版本 currentBuildId、/version.json 返回 servedBuildId。 */
async function openWith(currentBuildId, servedBuildId) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const hits = { versionFetch: 0 };
  await page.route("**/version.json*", (route) => {
    hits.versionFetch += 1;
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ buildId: servedBuildId }) });
  });
  await page.addInitScript((bid) => {
    if (bid !== null) window.__LIFEOS_BUILD__ = bid;
  }, currentBuildId);
  await page.goto(APP_URL, { waitUntil: "domcontentloaded", timeout: 20000 });
  await page.waitForTimeout(1500); // 首查（version-check 挂载即查一次）
  return { context, page, hits };
}

const SELECTOR = "[data-version-banner]";

try {
  // ── 用例 1：版本不同 → 提示条出现，且断言到几何（2.15）──
  console.log("用例 1：服务端版本 ≠ 当前 → 提示条出现");
  {
    const { context, page, hits } = await openWith("build-a", "build-b");
    assertCount("version.json 请求（mock 已命中）", hits.versionFetch, 1);
    const n = await page.locator(SELECTOR).count();
    assertCount("提示条元素", n, 1);
    const box = await page.locator(SELECTOR).first().boundingBox();
    if (box === null || box.height < 28 || box.width < 300) {
      throw new Error(`提示条几何不达标：${JSON.stringify(box)}（要求高 ≥28、宽 ≥300）`);
    }
    console.log(`  [几何] 提示条 ${Math.round(box.width)}×${Math.round(box.height)} ✓`);
    const status = await page.locator('[role="status"][aria-label="Life OS 有新版本"]').count();
    assertCount("role=status + 可访问名", status, 1);
    // 点击 → 真实页面重载（location.reload 不可 stub；用点击前写入的标记在新文档中消失来观察）
    await page.evaluate(() => { window.__bannerProbe = "pre"; });
    const nav = page.waitForNavigation();
    await page.locator("[data-version-banner-reload]").click();
    await nav;
    const reloaded = await page.evaluate(() => window.__bannerProbe === undefined);
    if (!reloaded) throw new Error("点击刷新未发生页面重载");
    console.log("  [行为] 点击刷新 → 页面重载 ✓");
    await context.close();
  }

  // ── 用例 2：版本相同 → 无提示条（0 个是正确结果，显式断言为 0）──
  console.log("用例 2：版本相同 → 无提示条");
  {
    const { context, page } = await openWith("build-a", "build-a");
    const n = await page.locator(SELECTOR).count();
    if (n !== 0) throw new Error(`版本相同不应出现提示条，实际 ${n} 个`);
    console.log("  [计数] 提示条元素: 0（预期 0，正确）");
    await context.close();
  }

  // ── 用例 3：无注入（dev 形态）→ 不轮询、无提示条 ──
  console.log("用例 3：无 __LIFEOS_BUILD__（dev）→ 不轮询");
  {
    const { context, page, hits } = await openWith(null, "build-z");
    const n = await page.locator(SELECTOR).count();
    if (n !== 0) throw new Error(`dev 形态不应出现提示条，实际 ${n} 个`);
    if (hits.versionFetch !== 0) throw new Error(`dev 形态不应请求 version.json，实际请求 ${hits.versionFetch} 次`);
    console.log("  [计数] version.json 请求: 0（预期 0，正确）");
    await context.close();
  }
} catch (error) {
  failures = 1;
  console.error("✗", error instanceof Error ? error.message : error);
} finally {
  await browser.close();
}
console.log(failures ? "version-banner 契约：✗ 红" : "version-banner 契约：✓ 全绿");
process.exit(failures);
