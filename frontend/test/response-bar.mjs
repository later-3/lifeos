#!/usr/bin/env node
/**
 * ResponseBar / SessionBar / MarkBar 三者的位置与口径（Task 0008 · P3）。
 *
 * 用户 2026-11-05 修正了 P3 第一版的位置，最终形态：
 *
 * ```
 * [头像] Agent 名字 · 时间
 * ┌ ResponseBar ────────────┐   ← 在正文**上方**（与主线的过程条同位置）
 * └─────────────────────────┘
 *   正文…
 * ┌ MarkBar ────────────────┐   ← 在正文**下方**
 * └─────────────────────────┘
 * ```
 * 输入框上方是 **SessionBar**（原 TurnStatusBar 改名）：会话累计的
 * 轮次 / 工具调用 / 生成耗时 / token / 平均速度 / 上下文 / 请求体 + **添加图片**。
 *
 * 每条都读真实渲染结果（DOM + computed style + localStorage），不接受"代码看起来对"。
 */
import pw from "/Users/xulater/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright-core/index.js";

const V = process.env.APP_URL ?? "http://127.0.0.1:5222";
const S = process.env.SESSION ?? "7424b2a4-99fa-46e6-840d-3fa955112da7";
const Q = `?agent=lifeosagent&project=workspace&session=${S}`;

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "✔" : "✖"} ${name}${detail === "" ? "" : `  → ${detail}`}`);
};

const browser = await pw.chromium.launch();

/** 打开会话并按需清掉折叠偏好。 */
async function open(opts = {}) {
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  page.on("pageerror", (e) => console.log("  [pageerror]", e.message.slice(0, 120)));
  await page.goto(V + "/" + Q, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(4500);
  if (opts.clearPref !== false) {
    await page.evaluate(() => { for (const k of Object.keys(localStorage)) if (k.startsWith("lifeos.response.")) localStorage.removeItem(k); });
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3500);
  }
  return page;
}

// ===== 1) 位置：ResponseBar 在正文上方，MarkBar 在正文下方 =====
{
  const page = await open();
  const layout = await page.evaluate(() => {
    const asst = [...document.querySelectorAll('[data-testid="message"][data-role="assistant"]')];
    const kids = (m) => [...m.children].map((c) => c.dataset?.testid ?? c.tagName);
    const withBar = asst.filter((m) => m.querySelector(':scope > [data-testid="response-bar"]') !== null);
    const idx = (m, id) => [...m.children].findIndex((c) => c.dataset?.testid === id);
    return {
      replies: asst.length,
      bars: withBar.length,
      order: asst.map(kids),
      // ResponseBar 必须排在**正文之前**
      barBeforeBody: withBar.every((m) => {
        const bar = idx(m, "response-bar");
        const body = [...m.children].findIndex((c) => c.dataset?.testid === "message-text" || c.classList?.contains("relative"));
        return bar >= 0 && body >= 0 && bar < body;
      }),
      // MarkBar（有批注时）排在正文**之后**
      markAfterBody: asst.filter((m) => idx(m, "mark-bar") >= 0).every((m) => {
        const mark = idx(m, "mark-bar");
        const body = [...m.children].findIndex((c) => c.dataset?.testid === "message-text" || c.classList?.contains("relative"));
        return mark > body;
      }),
      emptyBars: withBar.filter((m) => (m.querySelector(':scope > [data-testid="response-bar"]')?.textContent ?? "").trim() === "").length,
    };
  });
  check("每条有过程的回复都有 ResponseBar", layout.bars > 0, `${layout.replies} 回复 / ${layout.bars} bar`);
  check("ResponseBar 在正文**上方**（与主线同位置）", layout.barBeforeBody === true, JSON.stringify(layout.order[0] ?? []));
  check("MarkBar 在正文**下方**", layout.markAfterBody === true, JSON.stringify(layout.order.find((k) => k.includes("mark-bar")) ?? []));
  check("没有内容的回复不留空壳 bar", layout.emptyBars === 0, `${layout.emptyBars} 个空壳`);
  check("旧 process-bar 已不存在", await page.evaluate(() => document.querySelectorAll('[data-testid="process-bar"]').length === 0));
  check("旧 turn-status-bar 已不存在（改名 SessionBar）", await page.evaluate(() => document.querySelectorAll('[data-testid="turn-status-bar"]').length === 0));
  await page.close();
}

// ===== 2) SessionBar：累计口径 + 图片并进来 + 不与回复重复 =====
{
  const page = await open();
  const snap = await page.evaluate(() => {
    const bar = document.querySelector('[data-testid="session-bar"]');
    const labels = [...(bar?.querySelectorAll("[data-status-metric]") ?? [])].map((m) => m.getAttribute("data-label"));
    const texts = [...(bar?.querySelectorAll("[data-status-metric]") ?? [])].map((m) => (m.querySelector("[data-status-value]")?.textContent ?? "").trim());
    const inMessage = (node) => node?.closest('[data-testid="message"]') !== null && node?.closest('[data-testid="message"]') !== undefined;
    return {
      exists: bar !== null && bar !== undefined,
      dock: bar?.closest('[data-testid="composer-dock"]') !== null,
      outsideScroll: bar?.closest("main") === null,
      inMessage: inMessage(bar),
      labels,
      texts,
      hasAttach: bar?.querySelector('[data-testid="attach-image"]') !== null,
      attachArea: bar?.querySelector('[data-testid="composer-tools"]') !== null,
      // 回复上的 bar 不应该再有会话级指标
      replyMetrics: [...document.querySelectorAll('[data-testid="response-bar"] [data-status-metric]')].length,
    };
  });
  check("SessionBar 在输入框上方、滚动区外", snap.exists && snap.dock && snap.outsideScroll, JSON.stringify({ dock: snap.dock, outside: snap.outsideScroll }));
  check("SessionBar 不是消息内容（不挂在 message 里）", snap.inMessage === false);
  check("SessionBar 显示累计口径：轮次/工具调用/耗时/token/平均速度",
    ["轮次", "工具调用", "生成耗时", "输入", "输出", "平均速度"].every((l) => snap.labels.includes(l)),
    `${snap.labels.join(",")} → ${snap.texts.join(" | ")}`);
  check("「添加图片」并入 SessionBar（用户 2026-11-05）", snap.hasAttach && snap.attachArea, JSON.stringify({ attach: snap.hasAttach }));
  check("回复的 ResponseBar 不再重复会话级指标", snap.replyMetrics === 0, `${snap.replyMetrics} 个指标`);

  // 累计口径：轮次 = 用户消息数
  const counts = await page.evaluate(() => ({
    users: document.querySelectorAll('[data-testid="message"][data-role="user"]').length,
    toolCalls: document.querySelectorAll('[data-message-kind="tool"]').length,
    turnsText: [...document.querySelectorAll('[data-testid="session-bar"] [data-label="轮次"] [data-status-value]')].map((e) => e.textContent).join(""),
  }));
  check("SessionBar 的轮次 = 用户消息条数", counts.users > 0 && counts.turnsText.includes(String(counts.users)),
    `${counts.users} 条用户消息 vs 显示「${counts.turnsText}」`);
  await page.close();
}

// ===== 3) 与头像同时出现：占位消息就有头 + bar，且呼吸 =====
{
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  // 打桩：POST 消息永不返回（不调模型），模拟"刚发出、等首个块"
  await page.route("**/api/**/messages", async (route) => {
    if (route.request().method() === "POST") await new Promise(() => {});
    else await route.continue();
  });
  await page.goto(V + "/" + Q, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(4500);
  await page.fill("textarea", "打桩：等待回复态");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(1500);
  const snap = await page.evaluate(() => {
    const msgs = [...document.querySelectorAll('[data-testid="message"]')];
    const last = msgs[msgs.length - 1];
    const bar = last?.querySelector('[data-testid="response-bar"]');
    const cs = bar === null || bar === undefined ? null : getComputedStyle(bar);
    return {
      role: last?.dataset.role,
      hasHeader: last?.querySelector('[data-testid="message-header"]') !== null,
      hasBar: bar !== null && bar !== undefined,
      waitingText: bar?.querySelector('[data-testid="response-waiting"]')?.textContent ?? "",
      animation: cs?.animationName ?? "",
      duration: cs?.animationDuration ?? "",
      iterations: cs?.animationIterationCount ?? "",
      transform: cs?.transform ?? "",
    };
  });
  check("占位回复：消息头 + ResponseBar 同时出现（不等首个块）", snap.role === "assistant" && snap.hasHeader && snap.hasBar, JSON.stringify(snap));
  check("等待态有呼吸动画（opacity 循环，无位移）",
    snap.animation !== "none" && snap.iterations === "infinite" && (snap.transform === "none" || snap.transform === "matrix(1, 0, 0, 1, 0, 0)"),
    `${snap.animation} ${snap.duration} ${snap.iterations}`);
  check("等待态文案", /等待回复/.test(snap.waitingText), snap.waitingText);
  await page.screenshot({ path: "/tmp/response-bar-waiting.png" });
  await page.close();
}

// ===== 4) 折叠态按 session 持久 =====
{
  const page = await open();
  const probe = `(() => { for (const r of document.querySelectorAll('[data-testid="response-bar"]')) { const b = r.querySelector('button[aria-controls]'); if (b) return b; } return null; })()`;
  const hasProcess = await page.evaluate(`(${probe}) !== null`);
  check("夹具里存在可折叠的过程（否则本条无法测）", hasProcess);
  if (hasProcess) {
    const initial = await page.evaluate(`(${probe}).getAttribute('aria-expanded')`);
    await page.evaluate(`(${probe}).click()`);
    await page.waitForTimeout(300);
    const afterClick = await page.evaluate(`(${probe}).getAttribute('aria-expanded')`);
    const stored = await page.evaluate((sid) => localStorage.getItem(`lifeos.response.${sid}`), S);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3500);
    const afterReload = await page.evaluate(`(${probe}).getAttribute('aria-expanded')`);
    check("点击切换展开态", initial !== afterClick, `${initial} → ${afterClick}`);
    check("折叠态写入 localStorage（per-session key）", stored === (afterClick === "true" ? "open" : "folded"), String(stored));
    check("刷新后保持用户选的展开态（不被 live 重置）", afterReload === afterClick, `${afterClick} → ${afterReload}`);

    await page.evaluate(`(${probe}).click()`);
    await page.waitForTimeout(300);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3500);
    check("再次切换后刷新同样保持", await page.evaluate(`(${probe}).getAttribute('aria-expanded')`) === (afterClick === "true" ? "false" : "true"));

    const other = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
    await other.goto(V + "/?agent=lifeosagent&project=workspace", { waitUntil: "domcontentloaded" });
    await other.waitForTimeout(3500);
    check("折叠偏好不串 session", await other.evaluate((sid) => !Object.keys(localStorage).some((k) => k.startsWith("lifeos.response.") && k !== `lifeos.response.${sid}`), S),
      await other.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("lifeos.response.")).join(",")));
    await other.close();
  }
  await page.close();
}

// ===== 5) 流式过程中 bar 不被冲掉（打桩 SSE，不调模型）=====
{
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  const page = await ctx.newPage();
  await page.route(/\/api\/agents.*$/, async (route) => {
    const p = new URL(route.request().url()).pathname;
    const json = (body) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
    if (p === "/api/agents") return json({ items: [{ id: "lifeosagent", name: "Life Agent" }] });
    if (/\/projects$/.test(p)) return json({ items: [{ id: "workspace", name: "workspace", isDefault: true }] });
    if (/\/sessions$/.test(p)) return json({ items: [{
      sessionId: "sess-live", title: { raw: "流式", display: "流式" },
      project: { id: "workspace", name: "workspace", isDefault: true }, task: null, peer: null,
      counts: { user: 1, assistant: 1, toolResult: 0, system: 0, total: 2 },
      time: { createdAt: "2026-11-04T00:00:00.000Z", lastActivityAt: "2026-11-04T00:00:00.000Z", fileModifiedAt: "2026-11-04T00:00:00.000Z" },
      activity: { state: "idle" }, isDefault: false,
    }] });
    if (/\/config$/.test(p)) return json({ model: null, thinkingLevel: "medium" });
    if (/turns\/last$/.test(p)) return json({ turn: null });
    if (/annotations$/.test(p)) return json({ annotations: [] });
    if (/\/sessions\/[^/]+$/.test(p)) return json({ messages: [{ role: "assistant", id: "a1", blocks: [{ type: "text", text: "旧回复" }], at: Date.now() }], meta: {} });
    return json({});
  });
  await page.route("**/api/profile", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ name: "me" }) }));
  await page.route("**/api/runtime", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ running: [], draining: false }) }));
  await page.route("**/api/events/focus", (r) => r.fulfill({ status: 200, body: "{}", contentType: "application/json" }));
  await page.addInitScript(() => {
    window.__ssePush = null;
    class FakeES {
      constructor() {
        this.listeners = {}; this.readyState = 1;
        window.__ssePush = (name, data) => {
          const ev = { data: typeof data === "string" ? data : JSON.stringify(data) };
          for (const fn of this.listeners[name] ?? []) fn(ev);
        };
        setTimeout(() => (this.listeners.open ?? []).forEach((f) => f({})), 0);
      }
      addEventListener(name, fn) { (this.listeners[name] ??= []).push(fn); }
      removeEventListener() {}
      close() { this.readyState = 2; }
    }
    window.EventSource = FakeES;
    try { localStorage.setItem("lifeos.response.sess-live", "folded"); } catch { /* 忽略 */ }
  });
  await page.goto(V + "/?agent=lifeosagent&project=workspace&session=sess-live", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => typeof window.__ssePush === "function", null, { timeout: 15000 });
  const push = async (name, data) => { await page.evaluate(([n, d]) => window.__ssePush?.(n, d), [name, data]); await page.waitForTimeout(250); };
  const base = { agentId: "lifeosagent", sessionId: "sess-live", turnId: "turn-live1" };
  await push("turn", { ...base, type: "turn", state: "running" });
  await push("message_start", { ...base, type: "message_start" });
  await push("delta", { ...base, type: "delta", index: 0, text: "先看一下文件。" });
  await push("tool_call", { ...base, type: "tool_call", id: "t1", name: "read", arguments: { path: "/tmp/x" } });
  await push("tool_start", { ...base, type: "tool_start", id: "t1", name: "read", arguments: { path: "/tmp/x" } });

  const live = await page.evaluate(() => {
    const asst = [...document.querySelectorAll('[data-testid="message"][data-role="assistant"]')];
    const last = asst[asst.length - 1];
    const bar = last?.querySelector(':scope > [data-testid="response-bar"]');
    const body = [...(last?.children ?? [])];
    return {
      hasBar: bar !== null && bar !== undefined,
      // bar 排在正文之前
      barFirst: bar !== null && bar !== undefined && body.indexOf(bar) < body.length - 1,
      children: body.map((c) => c.dataset?.testid ?? c.tagName),
      expanded: bar?.querySelector('button[aria-controls]')?.getAttribute("aria-expanded") ?? null,
      waiting: bar?.querySelector('[data-testid="response-waiting"]') !== null,
    };
  });
  check("【流式】本轮回复有 ResponseBar（与头像一起出现）", live.hasBar, JSON.stringify(live.children));
  check("【流式】ResponseBar 排在正文之前", live.barFirst === true, JSON.stringify(live.children));
  check("【流式】用户折叠过 → 生成中也不强行展开（偏好压过 live）", live.expanded === "false", String(live.expanded));
  check("【流式】进入生成后不再显示「正在等待回复」", live.waiting === false, String(live.waiting));

  // 手动点开：过程块必须落在 bar 内部（而不是被顶到别处）
  await page.evaluate(() => {
    const m = [...document.querySelectorAll('[data-testid="message"][data-role="assistant"]')].pop();
    m?.querySelector('[data-testid="response-bar"] button[aria-controls]')?.click();
  });
  await page.waitForTimeout(400);
  const expandedBody = await page.evaluate(() => {
    const m = [...document.querySelectorAll('[data-testid="message"][data-role="assistant"]')].pop();
    const bar = m?.querySelector(':scope > [data-testid="response-bar"]');
    return {
      inBar: bar?.querySelector('[data-testid="process-body"]') !== null,
      childOrder: [...(m?.children ?? [])].map((c) => c.dataset?.testid ?? c.tagName),
    };
  });
  check("【流式】点开后过程块在 bar 内部（bar 不被顶走）", expandedBody.inBar === true, JSON.stringify(expandedBody));
  await page.screenshot({ path: "/tmp/response-bar-live.png" });
  await ctx.close();
}

// ===== 5b) 用户没点过 → 生成中自动展开（默认行为）=====
{
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  const page = await ctx.newPage();
  await page.route(/\/api\/agents.*$/, async (route) => {
    const p = new URL(route.request().url()).pathname;
    const json = (body) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
    if (p === "/api/agents") return json({ items: [{ id: "lifeosagent", name: "Life Agent" }] });
    if (/\/projects$/.test(p)) return json({ items: [{ id: "workspace", name: "workspace", isDefault: true }] });
    if (/\/sessions$/.test(p)) return json({ items: [{
      sessionId: "sess-live2", title: { raw: "流式2", display: "流式2" },
      project: { id: "workspace", name: "workspace", isDefault: true }, task: null, peer: null,
      counts: { user: 1, assistant: 1, toolResult: 0, system: 0, total: 2 },
      time: { createdAt: "2026-11-04T00:00:00.000Z", lastActivityAt: "2026-11-04T00:00:00.000Z", fileModifiedAt: "2026-11-04T00:00:00.000Z" },
      activity: { state: "idle" }, isDefault: false,
    }] });
    if (/\/config$/.test(p)) return json({ model: null, thinkingLevel: "medium" });
    if (/turns\/last$/.test(p)) return json({ turn: null });
    if (/annotations$/.test(p)) return json({ annotations: [] });
    if (/\/sessions\/[^/]+$/.test(p)) return json({ messages: [{ role: "assistant", id: "a1", blocks: [{ type: "text", text: "旧回复" }], at: Date.now() }], meta: {} });
    return json({});
  });
  await page.route("**/api/profile", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ name: "me" }) }));
  await page.route("**/api/runtime", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ running: [], draining: false }) }));
  await page.route("**/api/events/focus", (r) => r.fulfill({ status: 200, body: "{}", contentType: "application/json" }));
  await page.addInitScript(() => {
    window.__ssePush = null;
    class FakeES {
      constructor() {
        this.listeners = {}; this.readyState = 1;
        window.__ssePush = (name, data) => {
          const ev = { data: typeof data === "string" ? data : JSON.stringify(data) };
          for (const fn of this.listeners[name] ?? []) fn(ev);
        };
        setTimeout(() => (this.listeners.open ?? []).forEach((f) => f({})), 0);
      }
      addEventListener(name, fn) { (this.listeners[name] ??= []).push(fn); }
      removeEventListener() {}
      close() { this.readyState = 2; }
    }
    window.EventSource = FakeES;
  });
  await page.goto(V + "/?agent=lifeosagent&project=workspace&session=sess-live2", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => typeof window.__ssePush === "function", null, { timeout: 15000 });
  const push = async (name, data) => { await page.evaluate(([n, d]) => window.__ssePush?.(n, d), [name, data]); await page.waitForTimeout(250); };
  const base = { agentId: "lifeosagent", sessionId: "sess-live2", turnId: "turn-live2" };
  await push("turn", { ...base, type: "turn", state: "running" });
  await push("message_start", { ...base, type: "message_start" });
  await push("tool_call", { ...base, type: "tool_call", id: "t2", name: "read", arguments: { path: "/tmp/y" } });
  await push("tool_start", { ...base, type: "tool_start", id: "t2", name: "read", arguments: { path: "/tmp/y" } });
  const snap = await page.evaluate(() => {
    const m = [...document.querySelectorAll('[data-testid="message"][data-role="assistant"]')].pop();
    const bar = m?.querySelector(':scope > [data-testid="response-bar"]');
    return {
      expanded: bar?.querySelector('button[aria-controls]')?.getAttribute("aria-expanded") ?? null,
      bodyInBar: bar?.querySelector('[data-testid="process-body"]') !== null,
      stored: localStorage.getItem("lifeos.response.sess-live2"),
    };
  });
  check("【默认】用户没点过 → 生成中自动展开过程", snap.expanded === "true" && snap.bodyInBar === true, JSON.stringify(snap));
  check("【默认】自动展开不写 localStorage（那不是用户的选择）", snap.stored === null, String(snap.stored));
  await ctx.close();
}

// ===== 6) SessionBar 的「当前回合」（Task 0015 · P3）=====
// 用户 2026-11-07："这个能不能就直接在 session bar 里面呢？就跟之前在 turnstatusbar 里面一样，
// 而 Response bar 里面的还不能取消，相当于是在 session bar 里面添加！"
{
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  const page = await ctx.newPage();
  await page.route(/\/api\/agents.*$/, async (route) => {
    const p = new URL(route.request().url()).pathname;
    const json = (body) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
    if (p === "/api/agents") return json({ items: [{ id: "lifeosagent", name: "Life Agent" }] });
    if (/\/projects$/.test(p)) return json({ items: [{ id: "workspace", name: "workspace", isDefault: true }] });
    if (/\/sessions$/.test(p)) return json({ items: [{
      sessionId: "sess-turn", title: { raw: "回合", display: "回合" },
      project: { id: "workspace", name: "workspace", isDefault: true }, task: null, peer: null,
      counts: { user: 1, assistant: 1, toolResult: 0, system: 0, total: 2 },
      time: { createdAt: "2026-11-07T00:00:00.000Z", lastActivityAt: "2026-11-07T00:00:00.000Z", fileModifiedAt: "2026-11-07T00:00:00.000Z" },
      activity: { state: "idle" }, isDefault: false,
    }] });
    if (/\/config$/.test(p)) return json({ model: null, thinkingLevel: "medium" });
    if (/turns\/last$/.test(p)) return json({ turn: null });
    if (/annotations$/.test(p)) return json({ annotations: [] });
    if (/\/sessions\/[^/]+$/.test(p)) return json({ messages: [{ role: "assistant", id: "a1", blocks: [{ type: "text", text: "旧回复" }], at: Date.now() }], meta: { running: false } });
    return json({});
  });
  await page.route("**/api/profile", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ name: "me" }) }));
  await page.route("**/api/runtime", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ running: [], draining: false }) }));
  await page.route("**/api/events/focus", (r) => r.fulfill({ status: 200, body: "{}", contentType: "application/json" }));
  await page.addInitScript(() => {
    window.__ssePush = null;
    class FakeES {
      constructor() {
        this.listeners = {}; this.readyState = 1;
        window.__ssePush = (name, data) => {
          const ev = { data: typeof data === "string" ? data : JSON.stringify(data) };
          for (const fn of this.listeners[name] ?? []) fn(ev);
        };
        setTimeout(() => (this.listeners.open ?? []).forEach((f) => f({})), 0);
      }
      addEventListener(name, fn) { (this.listeners[name] ??= []).push(fn); }
      removeEventListener() {}
      close() { this.readyState = 2; }
    }
    window.EventSource = FakeES;
  });
  await page.goto(V + "/?agent=lifeosagent&project=workspace&session=sess-turn", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => typeof window.__ssePush === "function", null, { timeout: 15000 });

  const idle = await page.evaluate(() => ({
    hasTurn: document.querySelector('[data-testid="session-turn"]') !== null,
    barText: (document.querySelector('[data-testid="session-bar"]')?.textContent ?? "").trim(),
  }));
  check("【空闲】SessionBar 里没有「当前回合」（不留空行）", idle.hasTurn === false, JSON.stringify(idle));

  const push = async (name, data) => { await page.evaluate(([n, d]) => window.__ssePush?.(n, d), [name, data]); await page.waitForTimeout(250); };
  const base = { agentId: "lifeosagent", sessionId: "sess-turn", turnId: "turn-1", projectId: "workspace" };
  await push("turn", { ...base, type: "turn", state: "running" });
  await push("message_start", { ...base, type: "message_start" });
  await push("tool_call", { ...base, type: "tool_call", id: "t1", name: "read", arguments: { path: "/tmp/x" } });
  await push("tool_start", { ...base, type: "tool_start", id: "t1", name: "read", arguments: { path: "/tmp/x" } });
  await page.waitForTimeout(600);

  const live = await page.evaluate(() => {
    const turn = document.querySelector('[data-testid="session-turn"]');
    const bar = document.querySelector('[data-testid="session-bar"]');
    const turnBox = turn?.getBoundingClientRect();
    const avatar = document.querySelector('[data-testid="message-header"]');
    return {
      hasTurn: turn !== null,
      inSessionBar: turn?.closest('[data-testid="session-bar"]') !== null,
      outsideMain: turn?.closest("main") === null,
      text: (turn?.textContent ?? "").trim(),
      hasSpinnerText: /\d\/4/.test(turn?.textContent ?? ""),
      mentionsTool: /read/.test(turn?.textContent ?? ""),
      // ResponseBar 里的进行中状态仍在（用户要求"还不能取消"）
      responseLiveText: [...document.querySelectorAll('[data-testid="response-bar"]')].map((n) => n.textContent ?? "").join("|"),
      avatarVisible: avatar !== null,
      turnWidth: turnBox === undefined ? 0 : Math.round(turnBox.width),
    };
  });
  check("【生成中】SessionBar 里出现「当前回合」（滚动区外）", live.hasTurn && live.inSessionBar && live.outsideMain, JSON.stringify(live));
  check("【生成中】当前回合显示步骤与耗时（阶段文案只在 3/4 出现，见下一段）", live.hasSpinnerText && /\ds/.test(live.text), live.text);
  check("【生成中】ResponseBar 里的同名状态**仍然在**（用户：还不能取消）", /\d\/4/.test(live.responseLiveText) || /read/.test(live.responseLiveText), live.responseLiveText.slice(0, 120));
  check("【生成中】当前回合有实际宽度（不是 0×0 的假渲染）", live.turnWidth > 40, `${live.turnWidth}px`);

  // 真实收尾是两条事件：`turn(done)` 只清账本，`done` 才清 busy（finishFocused）
  await push("turn", { ...base, type: "turn", state: "done" });
  await push("done", { ...base, type: "done" });
  await page.waitForTimeout(600);
  const after = await page.evaluate(() => document.querySelector('[data-testid="session-turn"]') !== null);
  check("【结束】当前回合消失（不留空行）", after === false, String(after));
  await page.screenshot({ path: "/tmp/session-turn.png" });
  await ctx.close();
}

// ===== 7) 切会话回来：过程区展开态与 live 一致（Task 0015 · P2）=====
// 后端 `messagesOf()` 现在会给"正在跑的最后一条 assistant"带 `streaming: true`，
// 所以 `setMessages(history)` 之后 `messageLive` 与切走前一致 —— 不再"切回来就折叠"。
{
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  const page = await ctx.newPage();
  let running = true;
  await page.route(/\/api\/agents.*$/, async (route) => {
    const p = new URL(route.request().url()).pathname;
    const json = (body) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
    if (p === "/api/agents") return json({ items: [{ id: "lifeosagent", name: "Life Agent" }] });
    if (/\/projects$/.test(p)) return json({ items: [{ id: "workspace", name: "workspace", isDefault: true }] });
    if (/\/sessions$/.test(p)) return json({ items: [
      { sessionId: "s-a", title: { raw: "A", display: "A" }, project: { id: "workspace", name: "workspace", isDefault: true }, task: null, peer: null,
        counts: { user: 1, assistant: 1, toolResult: 1, system: 0, total: 3 },
        time: { createdAt: "2026-11-07T00:00:00.000Z", lastActivityAt: "2026-11-07T00:00:00.000Z", fileModifiedAt: "2026-11-07T00:00:00.000Z" },
        activity: { state: running ? "running" : "idle", ...(running ? { running: { since: new Date(Date.now() - 42_000).toISOString(), elapsedMs: 42_000 } } : {}) }, isDefault: false },
      { sessionId: "s-b", title: { raw: "B", display: "B" }, project: { id: "workspace", name: "workspace", isDefault: true }, task: null, peer: null,
        counts: { user: 0, assistant: 0, toolResult: 0, system: 0, total: 0 },
        time: { createdAt: "2026-11-07T00:00:00.000Z", lastActivityAt: "2026-11-07T00:00:00.000Z", fileModifiedAt: "2026-11-07T00:00:00.000Z" },
        activity: { state: "idle" }, isDefault: false },
    ] });
    if (/\/config$/.test(p)) return json({ model: null, thinkingLevel: "medium" });
    if (/turns\/last$/.test(p)) return json({ turn: running ? { turnId: "turn-x", state: "running" } : null });
    if (/annotations$/.test(p)) return json({ annotations: [] });
    if (/\/sessions\/s-a$/.test(p)) {
      // 关键：历史里这一轮正在跑 → 最后一条 assistant 带 streaming: true（后端 Task 0015 · P2 的行为）
      return json({
        messages: [
          { role: "user", id: "u1", blocks: [{ type: "text", text: "问" }] },
          { role: "assistant", id: "a1", blocks: [{ type: "toolCall", id: "t1", name: "read", arguments: {}, result: "x" }, { type: "thinking", text: "想" }], ...(running ? { streaming: true } : {}) },
        ],
        meta: { running },
      });
    }
    if (/\/sessions\/s-b$/.test(p)) return json({ messages: [], meta: { running: false } });
    return json({});
  });
  await page.route("**/api/profile", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ name: "me" }) }));
  await page.route("**/api/runtime", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ running: running ? [{ agentId: "lifeosagent", projectId: "workspace", sessionId: "s-a", startedAt: new Date(Date.now() - 42_000).toISOString() }] : [], draining: false }) }));
  await page.route("**/api/events/focus", (r) => r.fulfill({ status: 200, body: "{}", contentType: "application/json" }));
  await page.addInitScript(() => {
    window.__ssePush = null;
    class FakeES {
      constructor() { this.listeners = {}; this.readyState = 1;
        window.__ssePush = (name, data) => { const ev = { data: typeof data === "string" ? data : JSON.stringify(data) }; for (const fn of this.listeners[name] ?? []) fn(ev); };
        setTimeout(() => (this.listeners.open ?? []).forEach((f) => f({})), 0); }
      addEventListener(name, fn) { (this.listeners[name] ??= []).push(fn); }
      removeEventListener() {} close() { this.readyState = 2; }
    }
    window.EventSource = FakeES;
  });

  const opened = [];
  for (const round of [0, 1, 2]) {
    await page.goto(V + "/?agent=lifeosagent&project=workspace&session=s-a", { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => typeof window.__ssePush === "function", null, { timeout: 15000 });
    await page.waitForTimeout(1200);
    const first = await page.evaluate(() => {
      const b = document.querySelector('[data-testid="response-bar"] button[aria-controls]');
      return { expanded: b?.getAttribute("aria-expanded") ?? null, hasTurn: document.querySelector('[data-testid="session-turn"]') !== null };
    });
    // 切到 B 再切回 A
    await page.evaluate(() => { location.href = "/?agent=lifeosagent&project=workspace&session=s-b"; });
    await page.waitForTimeout(1500);
    await page.evaluate(() => { location.href = "/?agent=lifeosagent&project=workspace&session=s-a"; });
    await page.waitForTimeout(1800);
    const back = await page.evaluate(() => {
      const b = document.querySelector('[data-testid="response-bar"] button[aria-controls]');
      return { expanded: b?.getAttribute("aria-expanded") ?? null, hasTurn: document.querySelector('[data-testid="session-turn"]') !== null };
    });
    opened.push({ round, first, back });
  }
  const allOpen = opened.every((o) => o.first.expanded === "true" && o.back.expanded === "true");
  check("【切会话】A 在跑：切走再切回，过程区仍展开（不再回来就折叠）", allOpen, JSON.stringify(opened));
  check("【切会话】A 在跑：切回后 SessionBar 仍有「当前回合」", opened.every((o) => o.back.hasTurn === true), JSON.stringify(opened.map((o) => o.back.hasTurn)));
  // 切回来的会话由 openSession 置成 step=3（模型处理），此时 WorkingRow 才显示阶段文案
  const turnDetail = await page.evaluate(() => {
    const t = document.querySelector('[data-testid="session-turn"]');
    return { text: (t?.textContent ?? "").trim(), step3: /3\/4/.test(t?.textContent ?? "") };
  });
  check("【切会话】当前回合在 3/4 时显示「在干什么」（等模型/思考/执行工具/输出）",
    turnDetail.step3 && /等待模型|思考中|正在执行|输出中/.test(turnDetail.text), turnDetail.text);
  await ctx.close();
}

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
process.exit(failed.length === 0 ? 0 : 1);
