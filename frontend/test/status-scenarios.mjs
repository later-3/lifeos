// 状态场景矩阵（Task 0005）：**打桩 SSE**，逐个验证面板上每个会变的点。
//
// 为什么用打桩而不是真跑回合：
//   ① 真跑要模型可用 + 网络通，环境不稳（本项目实测会挂在 running 十几分钟）；
//   ② 场景多达十几种（开跑/成功/失败/查看/删除/重连/别的 Agent…），真跑无法穷举；
//   ③ 打桩能**精确控制时序**（补丁到达顺序、重复补丁、快照与补丁的先后）。
//
// 用法：APP_URL=http://localhost:5174 node frontend/test/status-scenarios.mjs
// 前置：只需要前端 dev server（后端可以完全不存在，SSE 与接口全部拦截）。
import pkg from "/Users/xulater/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright-core/index.js";
const { chromium } = pkg;

const APP_URL = process.env.APP_URL ?? "http://localhost:5174";
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "✔" : "✖"} ${name}${detail === "" ? "" : `  → ${detail}`}`);
};

// 两个 Agent 的假数据（不需要真后端）
const AGENT = { id: "lifeosagent", name: "Life Agent", description: "", defaultProjectId: "workspace", schemaVersion: 1, defaultSessionId: "sess-1" };
const OTHER = { id: "agent-other", name: "Other", description: "", defaultProjectId: "workspace", schemaVersion: 1 };
const PROJECT = { id: "workspace", name: "workspace", isDefault: true };
const OTHER_PROJECT = { id: "workspace", name: "workspace", isDefault: true };

function row(id, state = "idle") {
  return {
    sessionId: id,
    title: { raw: `会话 ${id}`, display: `会话 ${id}` },
    project: PROJECT,
    task: null, peer: null,
    counts: { user: 1, assistant: 1, toolResult: 0, system: 0, total: 2 },
    time: { createdAt: "2026-11-04T00:00:00.000Z", lastActivityAt: "2026-11-04T00:00:00.000Z", fileModifiedAt: "2026-11-04T00:00:00.000Z" },
    activity: { state },
    isDefault: false,
  };
}

const browser = await chromium.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
});

/**
 * 起一个完全打桩的页面：接口返回固定数据，SSE 由测试脚本手动推帧。
 * 返回 { page, push(event), close() } —— push 用来模拟服务端推送。
 */
async function openApp({ rows = [row("sess-1")], agent = AGENT } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));

  // ① 所有 REST 接口打桩
  // 用一个**统一的函数式 route**按 URL 精确分发 —— 多条通配 route 的匹配顺序不可靠
  // （实测：`**/api/agents` 会把 `/api/agents/x/projects` 也吃掉，导致分组永远空）。
  await page.route(/\/api\/agents.*$/, async (route) => {
    const url = new URL(route.request().url());
    const p = url.pathname;
    const json = (body) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
    if (p === "/api/agents") return json({ items: [agent, OTHER] });
    if (/^\/api\/agents\/[^/]+\/projects$/.test(p)) {
      const aid = p.split("/")[3];
      return json({ items: aid === OTHER.id ? [OTHER_PROJECT] : [PROJECT] });
    }
    if (/^\/api\/agents\/[^/]+\/projects\/[^/]+\/sessions$/.test(p)) {
      const aid = p.split("/")[3];
      return json({ items: aid === OTHER.id ? [row("other-1")] : rows });
    }
    if (/^\/api\/agents\/[^/]+\/config$/.test(p)) return json({ model: null, thinkingLevel: "medium" });
    if (/turns\/last$/.test(p)) return json({ turn: null });
    if (/^\/api\/agents\/[^/]+\/sessions\/[^/]+$/.test(p)) return json({ messages: [], meta: {} });
    return json({});
  });
  await page.route("**/api/profile", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ name: "me" }) }));
  await page.route("**/api/runtime", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ running: [], draining: false }) }));
  await page.route("**/api/events/focus", (r) => r.fulfill({ status: 200, body: "{}", contentType: "application/json" }));

  // ② SSE：注入假的 EventSource，测试脚本手动推帧。
  // 为什么不用 route.fulfill + TransformStream：实测 Playwright 的 route.fulfill
  // 拿到的流不可写（writer 为 undefined），且页面拿不到增量帧。
  // 注入假 EventSource 简单可靠，且能**精确控制帧的到达时刻与顺序**。
  await page.addInitScript(() => {
    window.__ssePush = null;
    class FakeES {
      constructor(url) {
        this.url = url; this.listeners = {}; this.readyState = 1;
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

  const push = async (eventName, data) => {
    // 等 FakeES 真正被页面实例化（React 挂载 SSE 在 goto 返回之后）
    await page.waitForFunction(() => typeof window.__ssePush === "function", null, { timeout: 15000 });
    await page.evaluate(([n, d]) => window.__ssePush?.(n, d), [eventName, data]);
    await page.waitForTimeout(150);
  };
  const snapshot = async (snap) => push("snapshot", {
    connectionId: "test", seq: snap.seq ?? 0, turns: [],
    running: snap.running ?? [], unread: snap.unread ?? [], aggregate: snap.aggregate ?? [],
  });

  await page.goto(`${APP_URL}/?agent=${agent.id}&project=workspace`, { waitUntil: "domcontentloaded" });
  // 等"项目分组与会话行"真正渲染（实测 8 秒内会偶发未完成；16 秒稳定）。
  // 不等够的话会得到一堆"全 0"的假结论（C173 坑 3：先等已知元素出现，再判断数据）。
  await page.waitForSelector('[data-project-id] [data-testid]', { timeout: 20000 }).catch(() => {});

  return { page, push, snapshot, errors, close: async () => { await ctx.close(); } };
}

/** 读面板上所有会变的点。 */
async function readPanels(page) {
  return await page.evaluate(() => {
    const grab = (root, selector) => {
      if (root === null) return [];
      return [...root.querySelectorAll(selector)].map((el) => {
        const box = el.getBoundingClientRect();
        return {
          kind: el.dataset.stateCount ?? el.dataset.stateDot ?? "",
          title: el.getAttribute("title") ?? "",
          text: (el.textContent ?? "").trim(),
          w: Math.round(box.width), h: Math.round(box.height),
          visible: box.width > 0 && box.height > 0 && el.offsetParent !== null,
        };
      });
    };
    const agentCol = document.querySelector('[data-shot-mask="agent-rows"]');
    const panel = document.querySelector('[data-testid="groups-panel"]');
    return {
      // 助手行本身没有 data-testid；徽标是 [data-state-count]，按容器取就够
      agentBadges: grab(agentCol, "[data-state-count]"),
      projectBadges: grab(panel, "[data-state-count]"),
      rowDots: grab(panel, "[data-state-dot], [title^='失败'], [title^='完成未读']"),
    };
  });
}

const nums = (badges) => {
  const out = { running: 0, unreadDone: 0, unreadError: 0 };
  for (const b of badges) if (b.kind in out) out[b.kind] = Number(b.text);
  return out;
};

// ══════════════════════════════════════════════════════════════════
// 场景矩阵：面板上每个会变的点 × 每个触发它的场景
// ══════════════════════════════════════════════════════════════════

// —— 场景 1：快照里有未读 → 助手行 + 项目行都有绿数字，会话行有绿点 ——
{
  const app = await openApp({ rows: [row("sess-1"), row("sess-2")] });
  await app.snapshot({
    unread: [{ agentId: AGENT.id, sessionId: "sess-1", projectId: "workspace", completedAt: "2026-11-04T01:00:00.000Z", state: "done" }],
    aggregate: [{ agentId: AGENT.id, projectId: "workspace", running: 0, unreadDone: 1, unreadError: 0 }],
  });
  const p = await readPanels(app.page);
  check("1 快照未读 → 助手行绿1", nums(p.agentBadges).unreadDone === 1, JSON.stringify(nums(p.agentBadges)));
  check("1 快照未读 → 项目行绿1", nums(p.projectBadges).unreadDone === 1, JSON.stringify(nums(p.projectBadges)));
  check("1 快照未读 → 会话行有绿点", p.rowDots.some((d) => d.title.includes("完成未读") && d.visible), JSON.stringify(p.rowDots.map((d) => d.title)));
  check("1 无 JS 错误", app.errors.length === 0, app.errors.slice(0, 1).join());
  await app.close();
}

// —— 场景 2：开跑补丁 → 呼吸数字出现（助手行 + 项目行） ——
{
  const app = await openApp({ rows: [row("sess-1")] });
  await app.snapshot({});
  const before = nums((await readPanels(app.page)).agentBadges);
  await app.push("row", { agentId: AGENT.id, sessionId: "sess-1", projectId: "workspace", type: "row", patch: { running: { since: new Date().toISOString(), phase: "waiting" } } });
  const p = await readPanels(app.page);
  check("2 开跑前无呼吸数字", before.running === 0);
  check("2 开跑 → 助手行呼吸1", nums(p.agentBadges).running === 1, JSON.stringify(nums(p.agentBadges)));
  check("2 开跑 → 项目行呼吸1", nums(p.projectBadges).running === 1, JSON.stringify(nums(p.projectBadges)));
  check("2 呼吸徽标在动（动画名非 none）", await app.page.evaluate(() => {
    const el = document.querySelector('[data-state-count="running"]');
    if (el === null) return false;
    // 断的是"有动画"，不是具体哪条 keyframes —— 改版后呼吸从 animate-pulse 换成
    // badge-dot（圆点缩放），写死 pulse 会让断言假红（C173 坑：断言写成实现细节）。
    return getComputedStyle(el).animationName !== "none";
  }));
  check("2 会话行有呼吸点", p.rowDots.some((d) => d.title === "生成中" && d.visible));
  await app.close();
}

// —— 场景 3：终态补丁（成功）→ 呼吸消失、转绿1 ——
{
  const app = await openApp({ rows: [row("sess-1")] });
  await app.snapshot({});
  await app.push("row", { agentId: AGENT.id, sessionId: "sess-1", projectId: "workspace", type: "row", patch: { running: { since: new Date().toISOString(), phase: "waiting" } } });
  await app.push("row", { agentId: AGENT.id, sessionId: "sess-1", projectId: "workspace", type: "row", patch: { running: null, unread: { since: new Date().toISOString() } } });
  const p = await readPanels(app.page);
  const a = nums(p.agentBadges);
  check("3 结束后呼吸归零", a.running === 0, JSON.stringify(a));
  check("3 结束后转绿1", a.unreadDone === 1, JSON.stringify(a));
  check("3 结束后无错误", a.unreadError === 0, JSON.stringify(a));
  await app.close();
}

// —— 场景 4：终态补丁（失败）→ 转红1（不是绿） ——
{
  const app = await openApp({ rows: [row("sess-1")] });
  await app.snapshot({});
  await app.push("row", { agentId: AGENT.id, sessionId: "sess-1", projectId: "workspace", type: "row", patch: { running: { since: new Date().toISOString() } } });
  await app.push("row", {
    agentId: AGENT.id, sessionId: "sess-1", projectId: "workspace", type: "row",
    patch: { running: null, unread: { since: new Date().toISOString() }, failure: { kind: "auth", detail: "401 Unauthorized" } },
  });
  const p = await readPanels(app.page);
  const a = nums(p.agentBadges);
  check("4 失败结束 → 红1（不是绿）", a.unreadError === 1 && a.unreadDone === 0, JSON.stringify(a));
  check("4 会话行红点", p.rowDots.some((d) => d.title.startsWith("失败") && d.visible), JSON.stringify(p.rowDots.map((d) => d.title)));
  await app.close();
}

// —— 场景 5：点开（unread: null）→ 全部清零 ——
{
  const app = await openApp({ rows: [row("sess-1")] });
  await app.snapshot({
    unread: [{ agentId: AGENT.id, sessionId: "sess-1", projectId: "workspace", completedAt: "2026-11-04T01:00:00.000Z", state: "done" }],
    aggregate: [{ agentId: AGENT.id, projectId: "workspace", running: 0, unreadDone: 1, unreadError: 0 }],
  });
  await app.push("row", { agentId: AGENT.id, sessionId: "sess-1", projectId: "workspace", type: "row", patch: { unread: null } });
  const p = await readPanels(app.page);
  check("5 点开后助手行清零", nums(p.agentBadges).unreadDone === 0, JSON.stringify(nums(p.agentBadges)));
  check("5 点开后项目行清零", nums(p.projectBadges).unreadDone === 0, JSON.stringify(nums(p.projectBadges)));
  check("5 点开后会话行无绿点", p.rowDots.every((d) => !d.title.includes("完成未读")), JSON.stringify(p.rowDots.map((d) => d.title)));
  await app.close();
}

// —— 场景 6：删除（removed）→ 行消失 + 数字减少 ——
{
  const app = await openApp({ rows: [row("sess-1"), row("sess-2")] });
  await app.snapshot({
    unread: [
      { agentId: AGENT.id, sessionId: "sess-1", projectId: "workspace", completedAt: "2026-11-04T01:00:00.000Z", state: "done" },
      { agentId: AGENT.id, sessionId: "sess-2", projectId: "workspace", completedAt: "2026-11-04T01:00:00.000Z", state: "done" },
    ],
    aggregate: [{ agentId: AGENT.id, projectId: "workspace", running: 0, unreadDone: 2, unreadError: 0 }],
  });
  await app.push("row", { agentId: AGENT.id, sessionId: "sess-1", projectId: "workspace", type: "row", patch: { removed: true, was: "unreadDone" } });
  const p = await readPanels(app.page);
  check("6 删除后数字减一", nums(p.agentBadges).unreadDone === 1, JSON.stringify(nums(p.agentBadges)));
  check("6 删除后行消失", !(await app.page.evaluate(() => document.querySelectorAll('[data-testid="sess-1"]').length > 0)));
  await app.close();
}

// —— 场景 7：**别的 Agent** 开跑 → 当前页面的助手行也要有数字（用户报的 bug） ——
{
  const app = await openApp({ rows: [row("sess-1")] });   // 当前停在 lifeosagent
  await app.snapshot({});
  await app.push("row", { agentId: OTHER.id, sessionId: "other-1", projectId: "workspace", type: "row", patch: { running: { since: new Date().toISOString() } } });
  const p = await readPanels(app.page);
  const badges = p.agentBadges.map((b) => `${b.kind}=${b.text}`);
  check("7 别的 Agent 开跑 → 助手列出现呼吸数字", badges.some((b) => b.startsWith("running=1")), badges.join(" "));
  await app.close();
}

// —— 场景 8：重复补丁不会重复计数（节流窗口内会来很多条） ——
{
  const app = await openApp({ rows: [row("sess-1")] });
  await app.snapshot({});
  for (let i = 0; i < 5; i++) {
    await app.push("row", { agentId: AGENT.id, sessionId: "sess-1", projectId: "workspace", type: "row", patch: { running: { since: new Date().toISOString(), phase: "tool", tool: "read" } } });
  }
  const a = nums((await readPanels(app.page)).agentBadges);
  check("8 同一状态重复 5 次 → 仍然只有 1（不是 5）", a.running === 1, JSON.stringify(a));
  await app.close();
}

// —— 场景 9：重连（新快照）→ 以服务端为准重建，不叠加 ——
{
  const app = await openApp({ rows: [row("sess-1")] });
  await app.snapshot({
    unread: [{ agentId: AGENT.id, sessionId: "sess-1", projectId: "workspace", completedAt: "2026-11-04T01:00:00.000Z", state: "done" }],
    aggregate: [{ agentId: AGENT.id, projectId: "workspace", running: 0, unreadDone: 1, unreadError: 0 }],
  });
  // 再来一次同样的快照（模拟重连）→ 数字不能变成 2
  await app.snapshot({
    seq: 10,
    unread: [{ agentId: AGENT.id, sessionId: "sess-1", projectId: "workspace", completedAt: "2026-11-04T01:00:00.000Z", state: "done" }],
    aggregate: [{ agentId: AGENT.id, projectId: "workspace", running: 0, unreadDone: 1, unreadError: 0 }],
  });
  const a = nums((await readPanels(app.page)).agentBadges);
  check("9 重连重建 → 数字不叠加（仍是 1）", a.unreadDone === 1, JSON.stringify(a));
  await app.close();
}

// —— 场景 10：快照说"没在跑" → 用快照值（重建覆盖本地） ——
{
  const app = await openApp({ rows: [row("sess-1")] });
  await app.snapshot({});
  await app.push("row", { agentId: AGENT.id, sessionId: "sess-1", projectId: "workspace", type: "row", patch: { running: { since: new Date().toISOString() } } });
  check("10 本地认为在跑", nums((await readPanels(app.page)).agentBadges).running === 1);
  await app.snapshot({ seq: 20, aggregate: [] });   // 服务端说没有在跑的
  check("10 快照重建后归零（以服务端为准）", nums((await readPanels(app.page)).agentBadges).running === 0,
    JSON.stringify(nums((await readPanels(app.page)).agentBadges)));
  await app.close();
}

// —— 场景 11：点开一个**正在跑**的会话 → 不能清掉 running 数字（2026-11-05 用户实测 bug） ——
//
// 复现：用户点开正在跑的会话 → 服务端 focus → markSessionViewed → 推 { unread: null }
// → 前端原来一律 setSlot(..., undefined)，把 running 槽位一起删了。
// 现象：行上蓝点在呼吸，项目行/助手行**没有数字**。
{
  const app = await openApp({ rows: [row("sess-1")] });
  await app.push("row", { agentId: AGENT.id, sessionId: "sess-1", projectId: "workspace", type: "row", patch: { running: { since: new Date().toISOString() } } });
  check("11 开跑后助手行有呼吸 1", nums((await readPanels(app.page)).agentBadges).running === 1);
  // 点开它（服务端现在会先判断"有没有未读"，没有就不推 —— 这里直接模拟最坏情况：推了）
  await app.push("row", { agentId: AGENT.id, sessionId: "sess-1", projectId: "workspace", type: "row", patch: { unread: null } });
  const after = await readPanels(app.page);
  check("11 收到 {unread:null} 后助手行仍显示 1（不是 0）", nums(after.agentBadges).running === 1, JSON.stringify(nums(after.agentBadges)));
  check("11 项目行也仍显示 1", nums(after.projectBadges).running === 1, JSON.stringify(nums(after.projectBadges)));
  check("11 会话行的蓝点还在", after.rowDots.some((d) => d.title === "生成中" && d.visible), JSON.stringify(after.rowDots));
  await app.close();
}

// —— 场景 12：补丁不带 projectId → 数字不能从项目行掉到"无项目桶" ——
{
  const app = await openApp({ rows: [row("sess-1")] });
  await app.push("row", { agentId: AGENT.id, sessionId: "sess-1", projectId: "workspace", type: "row", patch: { running: { since: new Date().toISOString() } } });
  // 再推一条**不带 projectId** 的补丁（历史上 focus 端点就是这样）
  await app.push("row", { agentId: AGENT.id, sessionId: "sess-1", type: "row", patch: { running: { since: new Date().toISOString(), phase: "thinking" } } });
  const p = await readPanels(app.page);
  check("12 不带 projectId 的补丁不丢项目归属", nums(p.projectBadges).running === 1, JSON.stringify(nums(p.projectBadges)));
  await app.close();
}

await browser.close();
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} 通过${failed === 0 ? "" : `；${failed} 项失败`}`);
if (failed > 0) process.exit(1);
