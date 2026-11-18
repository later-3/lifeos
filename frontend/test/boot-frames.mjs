#!/usr/bin/env node
/**
 * 首屏抓帧门禁（Task 0019）：逐帧读出「这一帧有几个骨架 / 几个真实行 / 聊天区画的是什么」。
 *
 * 用法：`APP_URL=http://127.0.0.1:43130 pnpm test:boot`（需要**生产构建**在跑，见 `frontend-probes.mjs` 的说明：
 * dev server 的首屏噪声会让帧序列失真）。
 *
 * 为什么要抓帧而不是等稳定后断言：问题只存在于**从打开到稳定之间**的那几百毫秒。
 * 稳定之后的断言（"最终有没有内容"）在修复前后都是绿的 —— 那是恒绿的假断言
 * （`specs/code/testing` 2.15：0 个命中 = 没测，不是通过）。
 *
 * 四条不变量（用户 2026-11-17 的口径："加载就加载，别割裂"）：
 *   I0 **测到东西了**：每轮至少若干帧且出现真实内容，否则判"没测"（不许静默通过）；
 *   I1 **互斥**：同一帧里同一列不会既有骨架又有真实行；
 *   I2 **不撒谎**：加载中不写结论文案（聊天区/列头计数）；
 *   I3 **不回退**：内容出现之后不再退回骨架。
 *
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const APP_URL = process.env.APP_URL ?? "http://127.0.0.1:43130";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 入口 URL：**必须显式指定一个真有消息的会话**。
 *
 * 为什么不能直接开 `/`：那会走"接着上次会话"，而上一次测试（ui-contract、草稿契约）可能刚把
 * 上次会话删掉 → 首屏落到草稿态 → "稳定后有内容"这条会假红，看起来像产品缺陷
 * （`specs/code/testing` 2.17：先证明测量通道是对的）。
 * 这里按 UI 的入口规则挑：选消息数最多的会话，挑不到就退到第一个项目的第一个会话。
 */
async function entryUrl() {
  const agents = (await (await fetch(`${APP_URL}/api/agents`)).json()).items ?? [];
  for (const agent of agents) {
    const projects = (await (await fetch(`${APP_URL}/api/agents/${agent.id}/projects`)).json()).items ?? [];
    for (const project of projects) {
      const rows = (await (await fetch(`${APP_URL}/api/agents/${agent.id}/projects/${project.id}/sessions`)).json()).items ?? [];
      const withMessages = rows.filter((row) => (row.counts?.total ?? 0) > 0);
      const pick = withMessages[0] ?? rows[0];
      if (pick !== undefined) {
        return `${APP_URL}/?agent=${encodeURIComponent(agent.id)}&project=${encodeURIComponent(project.id)}&session=${encodeURIComponent(pick.sessionId)}`;
      }
    }
  }
  throw new Error("演示家目录里没有任何会话：先用 scripts/readme-demo-home.mjs 造数据，或指定一个真实家目录");
}

const CANDIDATES = [
  process.env.PLAYWRIGHT_CORE,
  join(process.cwd(), "frontend/node_modules/playwright-core/index.js"),
  join(homedir(), ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright-core/index.js"),
].filter(Boolean);
let playwright;
for (const candidate of CANDIDATES) {
  if (!existsSync(candidate)) continue;
  const m = await import(candidate);
  playwright = m.default ?? m;
  break;
}
if (playwright === undefined) throw new Error("找不到 playwright-core");

const browser = await playwright.chromium.launch({ headless: true, args: ["--no-proxy-server"] });
const ENTRY = await entryUrl();
console.log(`入口：${ENTRY}`);
const failures = [];
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "✔" : "✖"} ${name}${detail === "" ? "" : `  → ${detail}`}`);
  if (!ok) failures.push(name);
};

const FRAME_SCRIPT = () => {
  window.__frames = [];
  let last = "";
  const read = () => {
    const rowsHost = document.querySelector('[data-shot-mask="agent-rows"]');
    const sessHost = document.querySelector('[data-shot-mask="session-rows"]');
    const main = document.querySelector("main");
    const chat = (main?.textContent ?? "").replace(/\s+/g, " ").trim();
    return {
      t: Math.round(performance.now()),
      agentSkeleton: rowsHost === null ? -1 : rowsHost.querySelectorAll('[data-skeleton="list"] > div').length,
      agentRows: rowsHost === null ? -1 : rowsHost.querySelectorAll('[role="button"]').length,
      sessionSkeleton: sessHost === null ? -1 : sessHost.querySelectorAll('[data-skeleton="list"] > div').length,
      sessionRows: sessHost === null ? -1 : sessHost.querySelectorAll('[data-project-id]').length,
      counts: [...document.querySelectorAll('[data-shot-mask="column-count"]')].map((n) => n.textContent),
      title: document.querySelector("header h1")?.textContent ?? "",
      chatLoading: main === null ? -1 : main.querySelectorAll('[data-skeleton="message"] > div').length,
      chatConclusion: chat.includes("先选择项目") ? "先选择项目"
        : chat.includes("发一条消息开始对话") ? "发一条消息开始对话"
        : chat.length === 0 ? "" : "content",
    };
  };
  const loop = () => {
    try {
      const frame = read();
      const key = JSON.stringify([frame.agentSkeleton, frame.agentRows, frame.sessionSkeleton, frame.sessionRows, frame.counts, frame.title, frame.chatLoading, frame.chatConclusion]);
      if (key !== last) { last = key; window.__frames.push(frame); }
    } catch { /* 页面还没挂上 */ }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
};

/** 起一个隔离 context；`delayMs` 让列表接口变慢（模拟隧道/手机网络）。 */
async function newPage({ delayMs, keepStorage }) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
  await page.route("**/api/**", async (route) => {
    const req = route.request();
    if (req.method() !== "GET") return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
    const p = new URL(req.url()).pathname;
    if (delayMs > 0 && (/\/(projects|sessions)$/.test(p) || p === "/api/agents")) await sleep(delayMs);
    return route.continue();
  });
  await page.addInitScript(FRAME_SCRIPT);
  if (keepStorage) {
    // 暖一遍：先用一份正常速度的页面把缓存写进同一个 context，再让它变慢
    await page.goto(ENTRY, { waitUntil: "domcontentloaded" });
    await page.waitForSelector('[data-project-id]', { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(1200);
  }
  return { ctx, page, errors };
}

/** 等"稳定"：聊天区出内容、两列骨架归零，且连续 600ms 没有新形态。 */
async function collect(page, timeout = 15000) {
  const started = Date.now();
  let quietSince = Date.now();
  let last = "";
  while (Date.now() - started < timeout) {
    const frames = await page.evaluate(() => window.__frames ?? []);
    const mark = frames.length === 0 ? "" : JSON.stringify(frames[frames.length - 1]);
    if (mark !== last) { last = mark; quietSince = Date.now(); }
    const f = frames[frames.length - 1];
    if (f !== undefined && Date.now() - quietSince > 600 && f.chatConclusion === "content" && f.agentSkeleton === 0 && f.sessionSkeleton === 0) break;
    await sleep(50);
  }
  return page.evaluate(() => window.__frames ?? []);
}

function report(label, frames) {
  console.log(`\n### ${label}（${frames.length} 个形态）`);
  for (const f of frames) {
    console.log(`  t=${String(f.t).padStart(5)}ms 助手[骨架${f.agentSkeleton}/行${f.agentRows}] 会话[骨架${f.sessionSkeleton}/行${f.sessionRows}] 计数${JSON.stringify(f.counts)} 标题"${f.title}" 聊天[骨架${f.chatLoading}/"${f.chatConclusion}"]`);
  }
}

function assertions(label, frames) {
  // I0 先判"测到东西了"：帧太少或没出现内容 = 没测，不是通过
  const hasContent = frames.some((f) => f.chatConclusion === "content");
  check(`${label} · I0 抓到足够帧且出现过内容`, frames.length >= 3 && hasContent,
    `形态数 ${frames.length}，出现内容 ${hasContent}`);

  const mixAgent = frames.filter((f) => f.agentSkeleton > 0 && f.agentRows > 0);
  const mixSession = frames.filter((f) => f.sessionSkeleton > 0 && f.sessionRows > 0);
  check(`${label} · I1 助手列：骨架与真实行不同框`, mixAgent.length === 0,
    mixAgent.length === 0 ? "" : `${mixAgent.length} 帧，首帧 t=${mixAgent[0].t}ms 骨架${mixAgent[0].agentSkeleton}+行${mixAgent[0].agentRows}`);
  check(`${label} · I1 会话列：骨架与真实行不同框`, mixSession.length === 0,
    mixSession.length === 0 ? "" : `${mixSession.length} 帧，首帧 t=${mixSession[0].t}ms 骨架${mixSession[0].sessionSkeleton}+行${mixSession[0].sessionRows}`);

  const lyingChat = frames.filter((f) => f.chatLoading > 0 && f.chatConclusion !== "" && f.chatConclusion !== "content");
  check(`${label} · I2 聊天区：加载中不写结论文案`, lyingChat.length === 0,
    lyingChat.length === 0 ? "" : `${lyingChat.length} 帧，首帧 t=${lyingChat[0].t}ms "${lyingChat[0].chatConclusion}"`);

  /*
   * I2b **结论一旦说出口就不改口**（Task 0019 的核心口径：不割裂）。
   *
   * 上面 I2 只能抓"加载中同时写结论"，抓不到更烦人的那种：先给一个看起来很肯定的结论，
   * 半秒后自己推翻 —— 改前实测（热刷新 43120）：191ms 标题「新会话」+ 聊天「先选择项目」，
   * 2373ms 变成真会话名 + 「发一条消息开始对话」，2729ms 才出内容。
   *
   * 判据只看帧序列**自身**，不依赖"什么时候算就绪"（`testing.md` 2.5：断言行为，不断言实现）：
   * 某一块表面第一次说出非空值之后，后面所有帧都必须还是那个值。
   * 留白（""）不算结论，所以"空 → 真实标题"是合法的；"新会话 → 真实标题"不是。
   */
  const firstStable = (key) => {
    const idx = frames.findIndex((f) => f[key] !== "");
    if (idx < 0) return undefined;
    const value = frames[idx][key];
    const changed = frames.slice(idx + 1).find((f) => f[key] !== value);
    return changed === undefined ? undefined : { at: frames[idx].t, value, changedAt: changed.t, changedTo: changed[key] };
  };
  const titleLie = firstStable("title");
  const chatLie = firstStable("chatConclusion");
  check(`${label} · I2b 标题说出后不改口`, titleLie === undefined,
    titleLie === undefined ? "" : `t=${titleLie.at}ms 说"${titleLie.value}"，t=${titleLie.changedAt}ms 改成"${titleLie.changedTo}"`);
  check(`${label} · I2b 聊天区结论说出后不改口`, chatLie === undefined,
    chatLie === undefined ? "" : `t=${chatLie.at}ms 说"${chatLie.value}"，t=${chatLie.changedAt}ms 改成"${chatLie.changedTo}"`);

  const falseCount = frames.filter((f) => f.counts.some((c) => c === "0") && f.sessionRows === 0 && f.sessionSkeleton > 0);
  check(`${label} · I2 列头：未就绪的 0 不显示`, falseCount.length === 0,
    falseCount.length === 0 ? "" : `${falseCount.length} 帧，首帧 t=${falseCount[0].t}ms 计数${JSON.stringify(falseCount[0].counts)}`);

  const regress = (rowsKey, skelKey, isContent) => {
    let seen = false;
    for (const f of frames) {
      if (isContent(f)) seen = true;
      else if (seen && f[skelKey] > 0) return f;
    }
    return undefined;
  };
  const backAgent = regress("agentRows", "agentSkeleton", (f) => f.agentRows > 0);
  const backSession = regress("sessionRows", "sessionSkeleton", (f) => f.sessionRows > 0);
  const backChat = regress("chatLoading", "chatLoading", (f) => f.chatConclusion === "content");
  check(`${label} · I3 不回退：助手列`, backAgent === undefined, backAgent === undefined ? "" : `t=${backAgent.t}ms 有内容后又出骨架`);
  check(`${label} · I3 不回退：会话列`, backSession === undefined, backSession === undefined ? "" : `t=${backSession.t}ms 有内容后又出骨架`);
  check(`${label} · I3 不回退：聊天区`, backChat === undefined, backChat === undefined ? "" : `t=${backChat.t}ms 有内容后又出骨架`);

  const settled = frames[frames.length - 1];
  check(`${label} · 稳定后：两列与聊天区都有真实内容`,
    settled !== undefined && settled.chatConclusion === "content" && settled.agentSkeleton === 0 && settled.sessionSkeleton === 0,
    settled === undefined ? "没有帧" : `末帧 t=${settled.t}ms 聊天"${settled.chatConclusion}" 骨架 ${settled.agentSkeleton}/${settled.sessionSkeleton}`);
}

try {
  // ① 冷启动：全新 context（无缓存），列表接口各慢 400ms
  {
    const { ctx, page, errors } = await newPage({ delayMs: 400, keepStorage: false });
    await page.goto(ENTRY, { waitUntil: "domcontentloaded" });
    const frames = await collect(page);
    report("冷启动（清缓存 + 接口各慢 400ms）", frames);
    assertions("冷启动", frames);
    check("冷启动 · 无 pageerror", errors.length === 0, errors[0] ?? "");
    await ctx.close();
  }
  // ② 热刷新：同一 context 暖一次写缓存，再刷新（接口仍慢 700ms）
  {
    const { ctx, page, errors } = await newPage({ delayMs: 700, keepStorage: true });
    await page.evaluate(() => { window.__frames.length = 0; });
    await page.reload({ waitUntil: "domcontentloaded" });
    const frames = await collect(page);
    report("热刷新（有缓存 + 接口各慢 700ms）", frames);
    assertions("热刷新-慢", frames);
    check("热刷新-慢 · 无 pageerror", errors.length === 0, errors[0] ?? "");
    await ctx.close();
  }
  // ③ 热刷新：接口正常速度
  {
    const { ctx, page, errors } = await newPage({ delayMs: 0, keepStorage: true });
    await page.evaluate(() => { window.__frames.length = 0; });
    await page.reload({ waitUntil: "domcontentloaded" });
    const frames = await collect(page);
    report("热刷新（有缓存，接口正常）", frames);
    assertions("热刷新-正常", frames);
    check("热刷新-正常 · 无 pageerror", errors.length === 0, errors[0] ?? "");
    await ctx.close();
  }
} finally {
  await browser.close();
}

console.log(`\n${failures.length === 0 ? "全部通过" : `${failures.length} 条失败`}`);
if (failures.length > 0) process.exit(1);
