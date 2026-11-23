/**
 * 探针：验证长任务观测真的在记录（Task 0033 · 验收 #4）。
 *
 * 做法：打开页面 → 用 CDP 把 CPU 降到 1/6 → 在页面里跑几段重活 → 看 /api/logs 里有没有 longtask。
 *
 * 为什么用 CDP 节流而不是"跑一段死循环"：死循环会被冻结看门狗抓成 freeze，
 * 而这里要验证的是"不到 3 秒但确实卡"的那一档（100ms–3s），两者不重叠。
 *
 * 用法：APP_URL=http://localhost:5183 node scripts/probe-longtask-e2e.mjs
 */

import { join } from "node:path";
import { homedir } from "node:os";

const PW = join(homedir(), ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright-core/index.js");
const mod = await import(PW);
const playwright = mod.default ?? mod;

const APP_URL = process.env.APP_URL ?? "http://localhost:5183";
const THROTTLE = Number(process.env.THROTTLE ?? 6);

const browser = await playwright.chromium.launch({ headless: true, executablePath: playwright.chromium.executablePath() });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });

const uploads = [];
page.on("request", (request) => {
  if (!request.url().includes("/api/logs")) return;
  uploads.push(request.postData() ?? "");
});

await page.goto(APP_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
await page.waitForTimeout(4_000);

const cdp = await page.context().newCDPSession(page);
await cdp.send("Emulation.setCPUThrottlingRate", { rate: THROTTLE });
console.log(`CPU 节流 ${THROTTLE}x，跑 3 段重活`);

for (let round = 1; round <= 3; round += 1) {
  await page.evaluate(() => {
    // 400–900ms 的同步计算：必然产生 ≥100ms 的长任务，但不会触发 3s 冻结阈值
    const deadline = performance.now() + 400 + Math.random() * 500;
    let x = 0;
    while (performance.now() < deadline) x += Math.sqrt(x + 1);
    return x;
  });
  await page.waitForTimeout(300);
}
console.log("重活跑完，等周期上报（60s + 抖动；这里直接等 70s）…");
/*
 * 周期上报是 60s + 0–15s 抖动（抄 mattermost，见 freeze-watch-const.ts）。
 * 为了不干等，长任务记录也允许被"下一条 freeze/client 记录"顺带 flush ——
 * 这里就主动触发一次未捕获异常，把队列顶出去。
 */
await page.evaluate(() => {
  setTimeout(() => { throw new Error("probe: force flush"); }, 0);
});
await page.waitForTimeout(5_000);
await browser.close();

const longTasks = uploads
  .flatMap((body) => { try { return (JSON.parse(body)?.events ?? []); } catch { return []; } })
  .filter((event) => event.module === "longtask");

console.log(`\n长任务记录：${longTasks.length} 条`);
for (const event of longTasks) {
  console.log(`  ${event.ts} durationMs=${event.details?.durationMs} count=${event.details?.count ?? 1} domNodes=${event.details?.domNodes} messages=${event.details?.messages}`);
}

const clientErrors = uploads
  .flatMap((body) => { try { return (JSON.parse(body)?.events ?? []); } catch { return []; } })
  .filter((event) => event.module === "client");
console.log(`全局错误记录：${clientErrors.length} 条`);
for (const event of clientErrors) console.log(`  ${event.ts} ${event.msg} · ${event.details?.message}`);

const passed = longTasks.length > 0 && clientErrors.length > 0;
console.log(`\n结果：${passed ? "✅ 长任务与全局错误都被记录" : "❌ 有缺失"}`);
process.exit(passed ? 0 : 1);
