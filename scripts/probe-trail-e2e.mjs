/**
 * 探针：验证 trail（动作轨迹）真的会跟着冻结记录一起上报（Task 0033 · 验收 #5）。
 *
 * ## 为什么用 URL 参数而不是点 UI
 *
 * "点会话行"依赖左列的分组已经展开、行已经渲染 —— 那是另一条链路，失败时无法区分
 * "trail 没埋上"还是"没点中"。带 `?agent&project&session` 打开页面走的是
 * `openSession()` 这条**真实产品路径**（首屏恢复），必然触发 `open-session` 与
 * `load-messages`。更少的活动部件 = 更可信的断言（`testing.md` 2.17）。
 *
 * 用法：
 *   APP_URL=http://localhost:5183 AGENT=lifeosagent SESSION=<id> node scripts/probe-trail-e2e.mjs
 */

import { join } from "node:path";
import { homedir } from "node:os";

const PW = join(homedir(), ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright-core/index.js");
const mod = await import(PW);
const playwright = mod.default ?? mod;

const APP_URL = process.env.APP_URL ?? "http://localhost:5183";
const AGENT = process.env.AGENT ?? "lifeosagent";
const SESSION = process.env.SESSION ?? "";
const PROJECT = process.env.PROJECT ?? "workspace";
const FREEZE_MS = Number(process.env.FREEZE_MS ?? 4000);

const target = SESSION === ""
  ? `${APP_URL}/?agent=${AGENT}&project=${PROJECT}`
  : `${APP_URL}/?agent=${AGENT}&project=${PROJECT}&session=${SESSION}`;

const browser = await playwright.chromium.launch({ headless: true, executablePath: playwright.chromium.executablePath() });
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });

const uploads = [];
page.on("request", (request) => {
  if (request.url().includes("/api/logs")) uploads.push(request.postData() ?? "");
});

console.log(`打开：${target}`);
await page.goto(target, { waitUntil: "domcontentloaded", timeout: 60_000 });
await page.waitForTimeout(6_000);   // 等首屏恢复（openSession）与观测装好

console.log(`制造 ${FREEZE_MS}ms 冻结…`);
await page.evaluate((ms) => {
  const start = Date.now();
  while (Date.now() - start < ms) { /* busy wait */ }
}, FREEZE_MS);
await page.waitForTimeout(4_000);
await browser.close();

const events = uploads
  .flatMap((body) => { try { return (JSON.parse(body)?.events ?? []); } catch { return []; } })
  .filter((event) => event.module === "freeze");

const freeze = events.find((event) => event.msg === "主线程冻结");
const trail = freeze?.details?.trail ?? [];
console.log(`\n冻结记录：${freeze === undefined ? "未找到" : `已找到（durationMs=${freeze.details?.durationMs}）`}；trail ${trail.length} 条`);
for (const entry of trail) console.log(`  ${new Date(entry.at).toISOString()}  ${entry.what}`);

const hasOpen = trail.some((entry) => entry.what === "open-session");
const hasLoad = trail.some((entry) => String(entry.what).startsWith("load-messages"));
const passed = trail.length > 0 && hasOpen && hasLoad;
console.log(`\n结果：${passed ? "✅ 轨迹含 open-session 与 load-messages" : "❌ 轨迹缺失或不完整"}`);
process.exit(passed ? 0 : 1);
