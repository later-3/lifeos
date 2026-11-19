#!/usr/bin/env node
/**
 * 流式期文字区稳定性契约（Task 0018）。
 *
 * 用户报的现象（2026-11-16）："agent 回复过程中，有时候文字区域闪屏，感觉屏幕上一直在花屏"。
 * 定位（见 Task 0018 的 `01-background.md`）后，把四条**可测量**的成因各锁一条断言：
 *
 *  T1 正文块不搬家：流式期间，已显示的文字块不得在「正文区」与「过程区」之间跳转，也不得重挂。
 *  T2 思考卡不塌陷：一段思考结束时（这一轮还在跑），它的内容不得收起（收起会让下方正文整体上跳）。
 *  T3 代码块流式期不着色：`text-syn-*` span 只在**这一轮结束后**（或历史消息）出现，
 *     流式中途不得逐 delta 反复"纯文本 ↔ 着色"。
 *  T4 每 delta 的重建量与历史长度无关：一次 delta 只应重建**正在流式的那一个**块的索引，
 *     不得随会话变长线性增长（长会话里这条就是"掉帧 = 花屏感"的来源）。
 *
 * 为什么要打桩 SSE：真跑要模型可用，且无法精确控制"何时 thinking_end / 何时开始新段"。
 * 用法：APP_URL=http://localhost:5180 node frontend/test/stream-stability.mjs
 */
import { existsSync } from "node:fs";
import { EVENT_CHANNEL_STUB } from "./event-channel-stub.mjs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const APP_URL = process.env.APP_URL ?? "http://localhost:5180";
const RUN = process.env.RUN ?? "all";   // T1 / T2 / T3 / T4 / all

const CANDIDATES = [
  process.env.PLAYWRIGHT_CORE,
  join(HERE, "../node_modules/playwright-core/index.js"),
  join(HERE, "../../node_modules/playwright-core/index.js"),
  join(homedir(), ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright-core/index.js"),
].filter(Boolean);
let pw;
for (const candidate of CANDIDATES) {
  if (!existsSync(candidate)) continue;
  pw = (await import(candidate)).default ?? (await import(candidate));
  break;
}
if (pw === undefined) throw new Error("找不到 playwright-core：设置 PLAYWRIGHT_CORE=/path/to/playwright-core/index.js");

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "✔" : "✖"} ${name}${detail === "" ? "" : `  → ${detail}`}`);
};

const AGENT = { id: "lifeosagent", name: "Life Agent", description: "", defaultProjectId: "workspace", schemaVersion: 1, defaultSessionId: "sess-1" };
const PROJECT = { id: "workspace", name: "workspace", isDefault: true };
const row = () => ({
  sessionId: "sess-1", title: { raw: "流式稳定性", display: "流式稳定性" }, project: PROJECT, task: null, peer: null,
  counts: { user: 1, assistant: 1, toolResult: 1, system: 0, total: 3 },
  time: { createdAt: "2026-11-16T00:00:00.000Z", lastActivityAt: "2026-11-16T00:00:00.000Z", fileModifiedAt: "2026-11-16T00:00:00.000Z" },
  activity: { state: "idle" }, isDefault: false,
});

const browser = await pw.chromium.launch({ headless: true });

/**
 * 起一个全打桩的页面：接口固定数据，SSE 由脚本推帧。
 * `history` 给定时作为 `GET …/sessions/:id` 的消息列表返回（用来模拟长会话 / 历史代码块）。
 */
async function openApp({ history = [] } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 300)));
  const json = (route, body) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });

  await page.route(/\/api\/agents.*$/, async (route) => {
    const p = new URL(route.request().url()).pathname;
    if (p === "/api/agents") return json(route, { items: [AGENT] });
    if (/^\/api\/agents\/[^/]+\/projects$/.test(p)) return json(route, { items: [PROJECT] });
    /*
     * `/groups` 必须也给：列表从 Task 0017 起走这个聚合端点（`fetchGroups`）。
     * 不给的话它落到兜底的 `{}` → 分组为空 → 会话行不出现 → 下面的 `page.waitForSelector` 拿不到
     * 初始消息，于是**推帧全推给了一个没有宿主的页面**：T1 报 "0/0 帧"（空集恒绿）、
     * T2 报 null、T1b 报 []。这正是 `testing.md` 2.15 说的"夹具注入到没人读的地方"。
     */
    if (/^\/api\/agents\/[^/]+\/projects\/[^/]+\/groups$/.test(p)) return json(route, { items: [{ project: PROJECT, sessions: [row()] }] });
    if (/^\/api\/agents\/[^/]+\/projects\/[^/]+\/sessions$/.test(p)) return json(route, { items: [row()] });
    if (/^\/api\/agents\/[^/]+\/config$/.test(p)) return json(route, { model: null, thinkingLevel: "medium" });
    if (/turns\/last$/.test(p)) return json(route, { turn: null });
    if (/\/annotations$/.test(p)) return json(route, { annotations: [] });
    if (/^\/api\/agents\/[^/]+\/sessions\/[^/]+$/.test(p)) return json(route, { messages: history, meta: { running: false } });
    return json(route, {});
  });
  await page.route("**/api/profile", (r) => json(r, { name: "me" }));
  await page.route("**/api/runtime", (r) => json(r, { running: [], draining: false }));
  await page.route("**/api/events/focus", (r) => json(r, {}));
  await page.route("**/api/ui-prefs", (r) => json(r, {}));
  await page.route("**/api/media/catalog**", (r) => json(r, { items: [] }));

  /*
   * 事件通道已是 WebSocket（Task 0028 · P3）：假 EventSource 不再被任何代码读到，
   * 换成假 WebSocket；推帧接口仍是 `window.__ssePush(name, data)`。
   * 注意 `addInitScript` 会把函数序列化后送进页面，**页面里没有 Node 作用域**，
   * 所以 stub 必须以"函数本身"传入，不能在某段 init script 里调用它。
   */
  await page.addInitScript(EVENT_CHANNEL_STUB);
  await page.addInitScript(() => {
    /** T4：每个 delta 触发了多少次 TreeWalker（= 索引重建次数） */
    window.__walkers = 0;
    const orig = document.createTreeWalker.bind(document);
    document.createTreeWalker = (...args) => { window.__walkers += 1; return orig(...args); };
  });

  let seq = 1;
  const base = (extra) => ({ seq: seq++, agentId: AGENT.id, sessionId: "sess-1", projectId: "workspace", ...extra });
  const push = async (name, data) => page.evaluate(([n, d]) => window.__ssePush?.(n, d), [name, JSON.stringify(data)]);
  const resetWalkers = () => page.evaluate(() => { window.__walkers = 0; });
  const walkers = () => page.evaluate(() => window.__walkers);

  await page.goto(`${APP_URL}/?agent=${AGENT.id}&project=workspace&session=sess-1`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-project-id] [data-testid]', { timeout: 25000 }).catch(() => {});
  await page.waitForFunction(() => typeof window.__ssePush === "function", null, { timeout: 25000 });
  await page.waitForTimeout(1200);
  await push("snapshot", { connectionId: "test", seq: seq++, running: [], unread: [], aggregate: [] });
  await push("turn", base({ type: "turn", turnId: "turn-1", state: "running" }));
  return { page, push, base, resetWalkers, walkers, errors, close: async () => { await ctx.close(); } };
}

const THINK = (n) => Array.from({ length: n }, (_, i) => `思考第 ${i + 1} 行：先确认目录，再读文件。`).join("\n");

/** 推一段 assistant message：thinking → text（逐 delta）→ 可选 tool。返回该段的文本。 */
async function pushSegment(app, { segment, text, thinking = THINK(8), tool, index = 0 }) {
  const { push, base } = app;
  await push("message_start", base({ type: "message_start", segment }));
  for (let i = 0; i < thinking.length; i += 12) {
    await push("thinking", base({ type: "thinking", index, text: thinking.slice(i, i + 12), segment }));
    await app.page.waitForTimeout(12);
  }
  await push("thinking_end", base({ type: "thinking_end", index, segment }));
  await app.page.waitForTimeout(80);
  for (let i = 0; i < text.length; i += 6) {
    await push("delta", base({ type: "delta", index: index + 1, text: text.slice(i, i + 6), segment }));
    await app.page.waitForTimeout(12);
  }
  if (tool !== undefined) {
    await push("tool_call", base({ type: "tool_call", index: index + 2, id: tool, name: "read", arguments: { path: "a.ts" }, segment }));
    await push("tool_start", base({ type: "tool_start", id: tool, name: "read", arguments: { path: "a.ts" } }));
    await app.page.waitForTimeout(60);
    await push("tool_result", base({ type: "tool_result", id: tool, isError: false, text: "内容".repeat(10), truncated: false, durationMs: 60 }));
  }
  await push("message_end", base({ type: "message_end", segment }));
  await app.page.waitForTimeout(80);
}

if (RUN === "all" || RUN === "T1") {
  const app = await openApp();
  // 每帧记一次：每块正文在不在过程区、在哪个位置、节点身份有没有丢
  await app.page.evaluate(() => {
    window.__frames = [];
    window.__ids = 0;
    const tick = () => {
      const shot = [];
      for (const el of document.querySelectorAll('[data-testid="message-text"]')) {
        const text = (el.textContent ?? "").replace(/\s+/g, "");
        if (text === "过渡语一。" && el.__id === undefined) { window.__ids += 1; el.__id = window.__ids; }
        /*
         * 位置要用**容器内偏移**，不用视口坐标：流式时页面在自动贴底（followTail），
         * 视口 top 本来就会跟着滚动变——那是正常行为，不是闪屏。
         * 闪屏是"同一块在自己所在的消息容器里上下跳"，所以量相对消息顶部的距离。
         */
        const host = el.closest('[data-testid="message"]');
        const hostTop = host === null ? 0 : host.getBoundingClientRect().top;
        shot.push({
          text: text.slice(0, 12),
          inProcess: el.closest('[data-testid="process-body"]') !== null,
          id: el.__id ?? null,
          top: Math.round(el.getBoundingClientRect().top - hostTop),
        });
      }
      window.__frames.push(shot);
      window.__raf = requestAnimationFrame(tick);
    };
    window.__raf = requestAnimationFrame(tick);
  });
  await pushSegment(app, { segment: "msg-1", text: "过渡语一。", tool: "c1" });
  const afterFirst = await app.page.evaluate(() => window.__frames[window.__frames.length - 1]);
  await pushSegment(app, { segment: "msg-2", text: "过渡语二。", tool: "c2" });
  await pushSegment(app, { segment: "msg-3", text: "最终正文：结论在这里。" });
  const probe = await app.page.evaluate(() => {
    cancelAnimationFrame(window.__raf);
    const frames = window.__frames;
    const seenFirst = frames.filter((f) => f.some((b) => b.text.includes("过渡语一")));
    const insideProc = seenFirst.filter((f) => f.some((b) => b.text.includes("过渡语一") && b.inProcess)).length;
    // 节点身份：同一段文字出现过的 id 数（>1 = 被重挂过）
    const ids = new Set(seenFirst.flatMap((f) => f.filter((b) => b.text.includes("过渡语一")).map((b) => b.id)));
    // 位置跳变只用"向上位移"判断：流式期内容只会**往下长**（思考/正文变长把后面的内容推下去），
    // 所以向下位移是正常增长；**向上跳**才是真问题（掉消失、塌陷、整块重排）。
    let maxRiseBack = 0;
    for (let i = 1; i < seenFirst.length; i += 1) {
      const prev = seenFirst[i - 1].find((b) => b.text.includes("过渡语一"));
      const cur = seenFirst[i].find((b) => b.text.includes("过渡语一"));
      if (prev !== undefined && cur !== undefined) maxRiseBack = Math.max(maxRiseBack, prev.top - cur.top);
    }
    return { frames: frames.length, samples: seenFirst.length, insideProc, idCount: ids.size, maxRiseBack };
  });
  check("T1 流式期间已显示的正文块不进入过程区（不搬家）", probe.insideProc === 0, `${probe.insideProc}/${probe.samples} 帧在过程区里`);
  check("T1 同一段正文不被重挂（节点身份只有 1 个）", probe.idCount <= 1, `id 数 ${probe.idCount}`);
  check("T1 已显示的正文块不向上跳（相邻帧上移 ≤ 40px）", probe.maxRiseBack <= 40, `最大上移 ${probe.maxRiseBack}px`);
  check("T1 无页面异常", app.errors.length === 0, app.errors[0] ?? "");
  void afterFirst;
  await app.close();
}

if (RUN === "all" || RUN === "T1c") {
  /*
   * T1c：**一轮之内，已经显示出来的文字只增不减**（用户 2026-11-18："先回复了一些内容，突然一下没了"）。
   *
   * T1 只看正文块"搬不搬家、跳不跳"，看不到"整段消失"。这里直接盯字数：
   * 同一轮里，正文区与过程区的**总字数**只允许增长或持平 —— 只有"这一轮结束"才允许折叠掉文字。
   *
   * 为什么这条能抓住真问题：流式期间任何让正文变短的路径（新建一条消息顶掉旧的、
   * 状态机重置、按服务端事实中途覆盖）都会让字数下降，而它一律不是用户想要的。
   */
  const app = await openApp();
  await app.page.evaluate(() => {
    window.__lens = [];
    const tick = () => {
      const all = [...document.querySelectorAll('[data-testid="message"] [data-testid="message-text"], [data-testid="process-body"] .md-body')];
      const total = all.reduce((sum, el) => sum + (el.textContent ?? "").replace(/\s+/g, "").length, 0);
      window.__lens.push(total);
      window.__raf = requestAnimationFrame(tick);
    };
    window.__raf = requestAnimationFrame(tick);
  });
  await pushSegment(app, { segment: "msg-1", text: "过渡语一。", tool: "c1" });
  await pushSegment(app, { segment: "msg-2", text: "过渡语二。", tool: "c2" });
  await pushSegment(app, { segment: "msg-3", text: "最终正文：结论在这里。" });
  const probe = await app.page.evaluate(() => {
    cancelAnimationFrame(window.__raf);
    const lens = window.__lens;
    let worstDrop = 0;
    let peak = 0;
    for (const len of lens) {
      if (len < peak) worstDrop = Math.max(worstDrop, peak - len);
      peak = Math.max(peak, len);
    }
    return { frames: lens.length, peak, final: lens[lens.length - 1] ?? 0, worstDrop };
  });
  /*
   * 允许 2 个字符的抖动：Markdown 渲染会给围栏/列表补标记字符（Task 0018 · T5 记录过同一现象），
   * 但**不允许整段消失**（那会是十几个字以上的跌幅）。
   */
  check("T1c 一轮之内文字只增不减（轮中不整段消失）", probe.worstDrop <= 2, JSON.stringify(probe));
  check("T1c 无页面异常", app.errors.length === 0, app.errors[0] ?? "");
  await app.close();
}

if (RUN === "all" || RUN === "T2") {
  const app = await openApp();
  await pushSegment(app, { segment: "msg-1", text: "过渡语一。", tool: "c1" });
  // 第一段的思考已 thinking_end（它那一段的思考卡若收起，下方内容会整体上跳）
  const state1 = await app.page.evaluate(() => {
    const cards = [...document.querySelectorAll('[data-message-kind="thinking"]')];
    return cards.map((el) => ({
      height: Math.round(el.getBoundingClientRect().height),
      // 展开时正文可见（内容区存在且有高度）
      bodyH: Math.round((el.querySelector(".md-body")?.getBoundingClientRect().height ?? 0)),
    }));
  });
  check("T2 一段思考结束时（整轮仍在跑）思考卡保持展开", (state1[0]?.bodyH ?? 0) > 40, JSON.stringify(state1[0] ?? null));

  // 第二段开始流式：第一段的思考卡仍应展开（位置不塌陷）
  await app.push("message_start", app.base({ type: "message_start", segment: "msg-2" }));
  for (let i = 0; i < "过渡语二。".length; i += 3) {
    await app.push("delta", app.base({ type: "delta", index: 1, text: "过渡语二。".slice(i, i + 3), segment: "msg-2" }));
    await app.page.waitForTimeout(20);
  }
  const state2 = await app.page.evaluate(() => [...document.querySelectorAll('[data-message-kind="thinking"]')]
    .map((el) => Math.round((el.querySelector(".md-body")?.getBoundingClientRect().height ?? 0))));
  check("T2 后续段流式时，前一段的思考卡仍展开（不中途塌陷）", (state2[0] ?? 0) > 40, JSON.stringify(state2));
  check("T2 无页面异常", app.errors.length === 0, app.errors[0] ?? "");
  await app.close();

  // T2b：已结束的历史消息里，思考卡**必须**是收起的（不能因为"不中途收起"而永远展开）
  const finished = await openApp({
    history: [
      { id: "u1", role: "user", text: "问题", blocks: [{ type: "text", text: "问题" }] },
      { id: "a1", role: "assistant", blocks: [{ type: "thinking", text: THINK(10) }, { type: "text", text: "历史回答。" }], at: Date.now() },
    ],
  });
  await finished.page.waitForTimeout(1200);
  const collapsed = await finished.page.evaluate(() => [...document.querySelectorAll('[data-message-kind="thinking"]')]
    .map((el) => Math.round((el.querySelector(".md-body")?.getBoundingClientRect().height ?? 0))));
  check("T2b 已结束的历史消息里思考卡收起（展开只限进行中）", (collapsed[0] ?? 0) === 0, JSON.stringify(collapsed));
  await finished.close();
}

if (RUN === "all" || RUN === "T1b") {
  // 折叠在**这一轮结束时**发生一次：多段回复里只有最后一个 text 留在正文，其余进过程区
  const history = [
    { id: "u1", role: "user", text: "问题", blocks: [{ type: "text", text: "问题" }] },
    ...["一", "二", "三"].map((k, i) => ({
      id: `a${i}`, role: "assistant", at: Date.now() + i * 10,
      blocks: [
        { type: "thinking", text: THINK(4) },
        { type: "text", text: `过渡语${k}。` },
        { type: "toolCall", id: `t${i}`, name: "read", arguments: { path: "a.ts" }, result: "x", durationMs: 10 },
      ],
    })),
  ];
  const app = await openApp({ history });
  await app.page.waitForTimeout(1500);
  const readFolded = () => app.page.evaluate(() => {
    const bodyTexts = [...document.querySelectorAll('[data-testid="message"][data-role="assistant"] [data-testid="message-text"]')]
      .filter((el) => el.closest('[data-testid="process-body"]') === null).map((el) => (el.textContent ?? "").trim());
    const processTexts = [...document.querySelectorAll('[data-testid="process-body"] [data-testid="message-text"]')]
      .map((el) => (el.textContent ?? "").trim());
    return { bodyTexts, processTexts };
  });
  // 完成后过程区默认收起（用户 2026-11-02 定案）——先展开再查
  const collapsed = await readFolded();
  check("T1b 已结束的多段回复照样折叠：正文只留最后一段", collapsed.bodyTexts.length === 1 && collapsed.bodyTexts[0].includes("过渡语三"), JSON.stringify(collapsed.bodyTexts));
  await app.page.evaluate(() => {
    document.querySelector('[data-testid="response-bar"] button[aria-controls]')?.click();
  });
  await app.page.waitForTimeout(400);
  const opened = await readFolded();
  check("T1b 被折叠的过渡语进了过程区（没丢）", opened.processTexts.length === 2, JSON.stringify(opened.processTexts));
  await app.close();
}

if (RUN === "all" || RUN === "T3") {
  // ① 流式中：代码块不得带 text-syn-* span（否则逐 delta 纯文本↔着色闪烁）
  const app = await openApp();
  const FENCE = "示例：\n```ts\nconst a = 1;\nconst b = a + 2;\n```\n继续写正文。";
  await app.push("message_start", app.base({ type: "message_start", segment: "msg-1" }));
  let peakSpans = 0;
  for (let i = 0; i < FENCE.length; i += 6) {
    await app.push("delta", app.base({ type: "delta", index: 0, text: FENCE.slice(i, i + 6), segment: "msg-1" }));
    await app.page.waitForTimeout(30);
    const spans = await app.page.evaluate(() => document.querySelectorAll('[data-testid="message-text"] [class*="text-syn-"]').length);
    peakSpans = Math.max(peakSpans, spans);
  }
  check("T3 流式期间代码块不做语法着色（不逐 delta 闪色）", peakSpans === 0, `峰值 ${peakSpans} 个着色 span`);
  check("T3 无页面异常", app.errors.length === 0, app.errors[0] ?? "");
  await app.close();

  // ② 历史消息（已完成）：代码块必须已着色（否则"流式不着色"会变成"永远不着色"）
  const done = await openApp({
    history: [
      { id: "u1", role: "user", text: "看看这段", blocks: [{ type: "text", text: "看看这段" }] },
      { id: "a1", role: "assistant", blocks: [{ type: "text", text: FENCE }], at: Date.now() },
    ],
  });
  await done.page.waitForTimeout(1500);
  const historySpans = await done.page.evaluate(() => document.querySelectorAll('[data-testid="message-text"] [class*="text-syn-"]').length);
  check("T3 已完成的回复里代码块仍然着色（着色没被关掉）", historySpans > 0, `${historySpans} 个着色 span`);
  await done.close();
}

if (RUN === "all" || RUN === "T5") {
  /*
   * T5（R5）：**流式中已显示的文字不得被改写**。
   *
   * 用户 2026-11-16 补充："思考块在不断追加的时候，某些情况下它就不断地闪"。
   * 成因是 Markdown 分隔符回吞（`**` / 反引号只到一半时是字面，闭合那一刻被吃掉）。
   * 修法：流式渲染前补齐未闭合结构（`md-stream.ts`），定稿仍走原文。
   */
  const app = await openApp();
  await app.page.evaluate(() => {
    window.__seen = [];
    const tick = () => {
      // 思考块的内容不是 `message-text`（那是正文块的 testid），要单独取
      const bodies = [...document.querySelectorAll('[data-testid="message-text"], [data-message-kind="thinking"] .md-body')];
      window.__seen.push(bodies.map((el) => (el.textContent ?? "").replace(/\s+/g, "")).join("\u0000"));
      window.__raf = requestAnimationFrame(tick);
    };
    window.__raf = requestAnimationFrame(tick);
  });
  await app.push("message_start", app.base({ type: "message_start", segment: "msg-1" }));
  // 真实形态的思考文本：小标题 + 粗体 + 行内码 + 列表（模型常用排版）
  const THINKING = "### 定位思路\n先确认 **渲染入口** 在 `Message.tsx`，再看 `stream-blocks.ts`。\n- 检查 A 的 key\n- 检查 B 的 effect\n";
  for (let i = 0; i < THINKING.length; i += 6) {
    await app.push("thinking", app.base({ type: "thinking", index: 0, text: THINKING.slice(i, i + 6), segment: "msg-1" }));
    await app.page.waitForTimeout(30);
  }
  await app.page.waitForTimeout(300);
  const probe = await app.page.evaluate(() => {
    cancelAnimationFrame(window.__raf);
    const frames = window.__seen.filter((value, i, all) => i === 0 || value !== all[i - 1]);
    // 已显示文字被改写 = 这一帧不是"在上一帧末尾追加"，且少掉的不只是标记字符
    const lostWords = [];
    for (let i = 1; i < frames.length; i += 1) {
      const prev = frames[i - 1];
      const cur = frames[i];
      let k = 0;
      while (k < Math.min(prev.length, cur.length) && prev[k] === cur[k]) k += 1;
      const lost = prev.slice(k).replace(/[*`~#-]/g, "");
      if (lost !== "") lostWords.push({ frame: i, lost: lost.slice(0, 12) });
    }
    return { frames: frames.length, lostWords };
  });
  check("T5 思考块追加期间，已显示的正文文字不被改写（只允许标记字符变化）", probe.lostWords.length === 0,
    probe.lostWords.length === 0 ? `${probe.frames} 帧` : JSON.stringify(probe.lostWords.slice(0, 4)));
  check("T5 无页面异常", app.errors.length === 0, app.errors[0] ?? "");
  await app.close();
}

if (RUN === "all" || RUN === "T4") {
  // 长会话（60 轮）里推一个 delta，看触发多少次索引重建
  const history = [];
  for (let i = 0; i < 60; i += 1) {
    history.push({ id: `u${i}`, role: "user", text: `问题 ${i}`, blocks: [{ type: "text", text: `问题 ${i}：讲讲实现。` }] });
    history.push({
      id: `a${i}`, role: "assistant", at: 1763300000000 + i * 2000,
      blocks: [
        { type: "thinking", text: `第 ${i} 轮思考：先看目录再读文件。`.repeat(2) },
        { type: "text", text: `第 ${i} 轮回答：` + "解释性正文，模拟真实会话的文字量。".repeat(2) },
      ],
    });
  }
  const app = await openApp({ history });
  await app.page.waitForTimeout(2500);
  const blocks = await app.page.evaluate(() => document.querySelectorAll('[data-testid="message-text"]').length);
  await app.push("message_start", app.base({ type: "message_start", segment: "live" }));
  await app.resetWalkers();
  const DELTAS = 6;
  for (let i = 0; i < DELTAS; i += 1) {
    await app.push("delta", app.base({ type: "delta", index: 0, text: `流式第 ${i} 段。`, segment: "live" }));
    await app.page.waitForTimeout(45);
  }
  const perDelta = (await app.walkers()) / DELTAS;
  // 1 = 只有正在流式的那一个块重建索引；给它一点余量（≤3）但仍与历史长度无关
  check("T4 单次 delta 的索引重建次数与历史长度无关（≤3 次）", perDelta <= 3, `${perDelta.toFixed(1)} 次/ delta（页面 ${blocks} 个正文块）`);
  check("T4 无页面异常", app.errors.length === 0, app.errors[0] ?? "");
  await app.close();
}

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
process.exit(failed.length === 0 ? 0 : 1);
