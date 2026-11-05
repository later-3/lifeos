#!/usr/bin/env node
/**
 * ResponseBar 契约（Task 0008 · P3）。
 *
 * 用户 2026-11-04 的四条硬要求，逐条可断言：
 *  1. 一条回复一个 ResponseBar，挂在**正文下方**（不是正文上方），不被过程块冲掉；
 *  2. 指标（token/上下文/请求体/速度）只在 ResponseBar 出现一次 —— 底部 composer dock 不再显示；
 *  3. 用户发消息的瞬间，占位回复就有**消息头 + ResponseBar**（与头像同时出现），等待态**有呼吸动画**；
 *  4. 折叠态**按 session 持久**：点开→刷新仍开；点收→刷新仍收；另一个 session 不受影响。
 *
 * 所有断言都读**真实渲染结果**（DOM + computed style + localStorage），不接受"代码看起来对"。
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

// ===== 1) bar 的位置与"不画空壳" =====
{
  const page = await open();
  const layout = await page.evaluate(() => {
    const asst = [...document.querySelectorAll('[data-testid="message"][data-role="assistant"]')];
    const kids = (m) => [...m.children].map((c) => c.dataset?.testid ?? c.tagName);
    const barOf = (m) => m.querySelector(':scope > [data-testid="response-bar"]');
    // 一条 bar "有内容" = 有过程摘要 / 有指标 / 有状态文字 / 有 turn id
    const hasContent = (bar) => bar !== null && (bar.textContent ?? "").trim() !== "";
    return {
      replies: asst.length,
      bars: asst.filter((m) => barOf(m) !== null).length,
      order: asst.map(kids),
      // 所有出现的 bar 都必须在正文**下方**
      barAfterBody: asst.every((m) => {
        const bar = barOf(m);
        if (bar === null) return true;
        const body = [...m.children].findIndex((c) => c !== bar && c.dataset?.testid !== "message-header");
        return body >= 0 && [...m.children].indexOf(bar) > body;
      }),
      // 空壳：没有内容的 bar 不允许出现（用户："不要画蛇添足"）
      emptyBars: asst.filter((m) => { const bar = barOf(m); return bar !== null && !hasContent(bar); }).length,
      // 有过程或有指标的回复，必须有 bar
      missingBars: asst.filter((m) => {
        const stats = m.dataset.process === "folded";
        const isLast = m === asst[asst.length - 1];
        return (stats || isLast) && barOf(m) === null;
      }).length,
    };
  });
  check("有内容的回复都有 ResponseBar（过程/会话指标）", layout.bars > 0 && layout.missingBars === 0, `${layout.replies} 回复 / ${layout.bars} bar / 缺 ${layout.missingBars}`);
  check("ResponseBar 在正文**下方**（不是上方）", layout.barAfterBody, JSON.stringify(layout.order[0] ?? []));
  check("没有内容的回复不留空壳 bar（不画蛇添足）", layout.emptyBars === 0, `${layout.emptyBars} 个空壳`);
  check("旧 process-bar 已不存在", await page.evaluate(() => document.querySelectorAll('[data-testid="process-bar"]').length === 0));
  await page.close();
}

// ===== 2) 指标不重复：只在 ResponseBar，dock 里没有 =====
{
  const page = await open();
  const dup = await page.evaluate(() => {
    const dock = document.querySelector('[data-testid="composer-dock"]');
    const bars = [...document.querySelectorAll('[data-testid="response-bar"]')];
    const tokenGroups = bars.map((b) => b.querySelectorAll('[data-status-group="tokens"]').length);
    const allMetrics = bars.reduce((n, b) => n + b.querySelectorAll("[data-status-metric]").length, 0);
    return {
      dockHasTurnStatus: dock?.querySelector('[data-testid="turn-status-bar"]') !== null && dock?.querySelector('[data-testid="turn-status-bar"]') !== undefined,
      dockMetrics: dock?.querySelectorAll("[data-status-metric]").length ?? 0,
      dockText: (dock?.textContent ?? "").trim(),
      barsWithTokens: tokenGroups.filter((n) => n > 0).length,
      allMetrics,
      // 会话指标只挂一条 bar
      metricsBars: bars.filter((b) => b.querySelectorAll("[data-status-metric]").length > 0).length,
    };
  });
  check("底部 dock 不再有状态条", dup.dockHasTurnStatus === false && dup.dockMetrics === 0, JSON.stringify({ text: dup.dockText, n: dup.dockMetrics }));
  check("token 指标只出现在一条 bar 上（不重复）", dup.barsWithTokens <= 1, `${dup.barsWithTokens} 条 bar 带 token`);
  check("指标只挂最后一条回复（不每条重复）", dup.metricsBars <= 1, `${dup.metricsBars} 条 bar 带指标 / 共 ${dup.allMetrics} 个指标`);
  check("指标符号有 tooltip 解释", await page.evaluate(() => {
    const titles = [...document.querySelectorAll('[data-testid="response-bar"] [data-status-metric]')].map((m) => m.getAttribute("title") ?? "");
    return titles.length > 0 && titles.some((t) => /输入|输出|上下文|请求体|速度/.test(t));
  }));
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
      // 用户要求的"轻微"：只在透明度上呼吸，不位移
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

    // 再切一次，确认可逆且仍然持久
    await page.evaluate(`(${probe}).click()`);
    await page.waitForTimeout(300);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3500);
    check("再次切换后刷新同样保持", await page.evaluate(`(${probe}).getAttribute('aria-expanded')`) === (afterClick === "true" ? "false" : "true"));

    // 别的 session 不受影响
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
  // 全接口打桩 + 假 EventSource：帧由脚本手动推，能精确控制"什么时候出现工具块"
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  const page = await ctx.newPage();
  await page.route(/\/api\/agents.*$/, async (route) => {
    const url = new URL(route.request().url());
    const p = url.pathname;
    const json = (body) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
    if (p === "/api/agents") return json({ items: [{ id: "lifeosagent", name: "Life Agent" }] });
    if (/\/projects$/.test(p)) return json({ items: [{ id: "workspace", name: "workspace" }] });
    if (/\/sessions$/.test(p)) return json({ items: [{
      sessionId: "sess-live",
      title: { raw: "流式", display: "流式" },
      project: { id: "workspace", name: "workspace", isDefault: true },
      task: null, peer: null,
      counts: { user: 1, assistant: 1, toolResult: 0, system: 0, total: 2 },
      time: { createdAt: "2026-11-04T00:00:00.000Z", lastActivityAt: "2026-11-04T00:00:00.000Z", fileModifiedAt: "2026-11-04T00:00:00.000Z" },
      activity: { state: "idle" },
      isDefault: false,
    }] });
    if (/\/config$/.test(p)) return json({ model: null, thinkingLevel: "medium" });
    if (/turns\/last$/.test(p)) return json({ turn: null });
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
  // 先把本 session 的偏好设成"折叠"：流式期间**也不许**被 live 强扭开
  await page.addInitScript(() => { try { localStorage.setItem("lifeos.response.sess-live", "folded"); } catch { /* 忽略 */ } });
  await page.goto(V + "/?agent=lifeosagent&project=workspace&session=sess-live", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => typeof window.__ssePush === "function", null, { timeout: 15000 });
  const push = async (name, data) => { await page.evaluate(([n, d]) => window.__ssePush?.(n, d), [name, data]); await page.waitForTimeout(250); };
  const before = await page.evaluate(() => document.querySelectorAll('[data-testid="response-bar"]').length);

  // 推一轮：turn running → 思考块 → 工具开始 → 正文
  const base = { agentId: "lifeosagent", sessionId: "sess-live", turnId: "turn-live1" };
  await push("turn", { ...base, type: "turn", state: "running" });
  // 块事件是**扁平**的（type 直接在事件上，不是 message.type）：见 frontend/src/stream-blocks.ts:117-210
  await push("message_start", { ...base, type: "message_start" });
  await push("delta", { ...base, type: "delta", index: 0, text: "先看一下文件。" });
  await push("tool_call", { ...base, type: "tool_call", id: "t1", name: "read", arguments: { path: "/tmp/x" } });
  await push("tool_start", { ...base, type: "tool_start", id: "t1", name: "read", arguments: { path: "/tmp/x" } });

  const live = await page.evaluate(() => {
    const msgs = [...document.querySelectorAll('[data-testid="message"]')];
    const asst = msgs.filter((m) => m.dataset.role === "assistant");
    const last = asst[asst.length - 1];
    const bar = last?.querySelector(':scope > [data-testid="response-bar"]');
    return {
      replies: asst.length,
      hasBar: bar !== null && bar !== undefined,
      // 过程块（工具/思考）必须在 bar **内部**，不能把 bar 顶走
      // 过程入口（摘要/展开按钮）必须在 bar 内部；展开后过程块（process-body）也必须在 bar 内部
      processInBar: bar === null || bar === undefined ? null
        : bar.querySelector('button[aria-controls]') !== null
          && (bar.querySelector('[data-testid="process-body"]') !== null || bar.querySelector('button[aria-controls]')?.getAttribute("aria-expanded") === "false"),
      bodyAfterBar: bar === null || bar === undefined ? null : [...last.children].indexOf(bar) > 1,
      children: last === undefined ? [] : [...last.children].map((c) => c.dataset?.testid ?? c.tagName),
      inProcessBody: document.querySelectorAll('[data-message-kind] [class*="tool"]').length,
      waiting: bar?.querySelector('[data-testid="response-waiting"]') !== null,
      expanded: bar?.querySelector('button[aria-controls]')?.getAttribute("aria-expanded") ?? null,
    };
  });
  check("【流式】本轮回复有 ResponseBar（与头像一起出现）", live.hasBar, JSON.stringify(live.children));
  check("【流式】过程块渲染在 bar 内部，不把 bar 冲走", live.processInBar === true && live.bodyAfterBar === true, JSON.stringify(live));
  check("【流式】用户折叠过 → 生成中也不强行展开（偏好压过 live）", live.expanded === "false", String(live.expanded));
  check("【流式】进入生成后不再显示「正在等待回复」", live.waiting === false, String(live.waiting));
  // 手动点开：过程块必须落在 bar 内部（而不是把 bar 顶走）
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
      childOrder: m === undefined || m === null ? [] : [...m.children].map((c) => c.dataset?.testid ?? c.tagName),
    };
  });
  check("【流式】点开后过程块在 bar 内部（bar 不被顶走）", expandedBody.inBar === true, JSON.stringify(expandedBody));
  void before;
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

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
process.exit(failed.length === 0 ? 0 : 1);
