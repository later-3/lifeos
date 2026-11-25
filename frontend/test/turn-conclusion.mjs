#!/usr/bin/env node
/**
 * 回合结论（"正在生成中…/上一轮曾被中断"、"4/4 · 完成"等）在页面上**出现几次**（Task 0040）。
 *
 * 用户 2026-11-25 报障：同一句「正在生成中…（上一轮曾被中断，本轮结束前不提供重新发送）」
 * 在一轮回复里被重复打印几十上百次（`evidence/screenshot-notice-repeat.png`）。
 *
 * 这一条测的是**用户能看见的层**：页面上 `[data-testid="turn-status"]` 的个数与位置。
 * 纯函数层（哪个下标该挂）在 `test/turn-fold.test.mjs`；这里只认"渲染出来几个"。
 *
 * 夹具是现场形状（不是编的）：
 *  - `?tail=200` 整段落在一轮内部 → 客户端只有一个 `userIndex=-1` 的隐式轮；
 *  - 服务端把窗口外的压缩卡补回窗口首条（`src/server.ts:612`）→ 首条是压缩卡；
 *  - 这一轮有 200 段工具型回复，且**正在跑**（最后一段 streaming）。
 *
 * 修前：200 个结论节点（每个助手消息各挂一份）。
 * 修后：1 个。
 *
 * 用法：APP_URL=http://127.0.0.1:<webPort> node frontend/test/turn-conclusion.mjs
 */
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { EVENT_CHANNEL_STUB } from "./event-channel-stub.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const APP_URL = process.env.APP_URL ?? "http://localhost:5180";

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
  results.push({ name, ok });
  console.log(`${ok ? "✔" : "✖"} ${name}${detail === "" ? "" : `  → ${detail}`}`);
};

const AGENT = { id: "lifeosagent", name: "Life Agent", description: "", defaultProjectId: "workspace", schemaVersion: 1, defaultSessionId: "sess-1" };
const PROJECT = { id: "workspace", name: "workspace", isDefault: true };
const row = () => ({
  sessionId: "sess-1", title: { raw: "结论节点", display: "结论节点" }, project: PROJECT, task: null, peer: null,
  counts: { user: 1, assistant: 200, toolResult: 200, system: 0, total: 401 },
  time: { createdAt: "2026-11-25T00:00:00.000Z", lastActivityAt: "2026-11-25T00:00:00.000Z", fileModifiedAt: "2026-11-25T00:00:00.000Z" },
  activity: { state: "running" }, isDefault: false,
});

/** 现场形状：压缩卡 + N 段"思考 + 工具"回复，最后一段还在流式。 */
function history() {
  const messages = [{
    id: "card-1", role: "assistant", text: "", at: Date.now() - 3600_000,
    blocks: [{ type: "compaction", summary: "前面 127 条被压缩", tokensBefore: 800000 }],
  }];
  for (let i = 0; i < 200; i += 1) {
    const last = i === 199;
    messages.push({
      id: `a-${i}`, role: "assistant", text: last ? "" : "", at: Date.now() - 3600_000 + i * 1000,
      blocks: [
        { type: "thinking", text: "" , deferred: true },
        { type: "toolCall", id: `t-${i}`, name: "bash", arguments: { command: "echo hi" }, result: "hi", isError: false },
      ],
      stopReason: last ? "toolUse" : "toolUse",
      ...(last ? {} : {}),
    });
  }
  return messages;
}

const browser = await pw.chromium.launch({ headless: true });

async function openApp({ messages, running = true }) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 300)));
  const json = (route, body) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });

  await page.route(/\/api\/agents.*$/, async (route) => {
    const p = new URL(route.request().url()).pathname;
    if (p === "/api/agents") return json(route, { items: [AGENT] });
    if (/^\/api\/agents\/[^/]+\/projects$/.test(p)) return json(route, { items: [PROJECT] });
    /*
     * `/groups` 的真实路径是 `/api/agents/:id/groups`（`App.tsx` 的 `fetchGroups`）。
     * 写成 `/projects/:pid/groups` 会**永不命中** → 落到兜底的 `{}` → 项目为空 →
     * 聊天区停在「先选择项目」，夹具注入到没人读的地方（testing.md 2.26 的假绿）。
     */
    if (/^\/api\/agents\/[^/]+\/groups$/.test(p)) return json(route, { items: [{ project: PROJECT, sessions: [row()] }] });
    if (/^\/api\/agents\/[^/]+\/projects\/[^/]+\/sessions$/.test(p)) return json(route, { items: [row()] });
    if (/^\/api\/agents\/[^/]+\/config$/.test(p)) return json(route, { model: null, thinkingLevel: "medium" });
    if (/turns\/last$/.test(p)) return json(route, { turn: null });
    if (/\/annotations$/.test(p)) return json(route, { annotations: [] });
    if (/\/rail$/.test(p)) return json(route, { items: [] });
    if (/^\/api\/agents\/[^/]+\/sessions\/[^/]+$/.test(p)) {
      return json(route, {
        sessionId: "sess-1", messages, total: messages.length, tailStart: 0, hasOlder: false,
        meta: { model: { provider: "p", id: "m" }, running },
      });
    }
    return json(route, {});
  });
  await page.route("**/api/profile", (r) => json(r, { name: "me" }));
  await page.route("**/api/runtime", (r) => json(r, { running: [], draining: false }));
  await page.route("**/api/events/focus", (r) => json(r, {}));
  await page.route("**/api/ui-prefs", (r) => json(r, {}));
  await page.route("**/api/media/catalog**", (r) => json(r, { items: [] }));

  await page.addInitScript(EVENT_CHANNEL_STUB);
  await page.goto(`${APP_URL}/?agent=${AGENT.id}&project=workspace&session=sess-1`, { waitUntil: "domcontentloaded" });
  // 夹具是否真的进了页面（testing.md 2.26）：列表行与聊天区都要先出现，否则下面的断言是空集恒绿。
  await page.waitForSelector('[data-testid="message"][data-role="assistant"]', { timeout: 30000 });
  await page.waitForFunction(() => typeof window.__ssePush === "function", null, { timeout: 20000 });
  await page.waitForTimeout(800);

  /*
   * **真正的复现路径在流式**（这是本次事故的关键，不补这一步就测不到）：
   *
   * 重复不是"静态渲染"造成的：`messageLive = 本段 streaming || 本轮任一段 streaming`，
   * 而服务端下发的历史消息没有 `streaming` 字段。只有当**这一轮有一条消息在流**
   *（`applyStreamMessage` 会把尾条置 `streaming: true`）时，轮级 live 才为真，
   * 于是这一轮的**每一条**回复都挂上同一句结论 —— 用户截图里的 23:05 / 23:06 / 23:07 … 正是这些宿主。
   */
  const base = (extra) => ({ seq: ++seqNo, agentId: AGENT.id, sessionId: "sess-1", projectId: "workspace", ...extra });
  const push = (name, data) => page.evaluate(([n, d]) => window.__ssePush?.(n, d), [name, JSON.stringify(data)]);
  /*
   * 快照必须与 `meta.running` 一致（这里 running=true）：
   * 推一个 `running: []` 会让 `reconcileLostRun()` 把 busy 收尾成 false，
   * 之后到达的 delta 再把 busy 拉回 true —— 那一刻 `busy=false + lastStop=toolUse` 就是 `lost`，
   * 会凭空多出一条「上一轮没有完成」。那是测试夹具自相矛盾造成的事故（类似于 Task 0039），
   * 不是本任务要验的行为。
   */
  await push("snapshot", {
    connectionId: "t",
    seq: base({}).seq,
    running: running ? [{ sessionId: "sess-1", agentId: AGENT.id, projectId: "workspace", turnId: "turn-1", startedAt: new Date().toISOString() }] : [],
    unread: [],
  });
  await page.waitForTimeout(300);   // 等快照的异步对账（turns/last）落定，再推流式事件
  if (running) {
    await push("turn", base({ type: "turn", turnId: "turn-2", state: "running" }));
    await push("delta", base({ type: "delta", index: 0, text: "正在跑", segment: "seg-live" }));
    await page.waitForTimeout(300);
  }
  return { page, errors, close: async () => { await ctx.close(); } };
}
let seqNo = 0;

// ── 场景 1：现场形状（压缩卡 + 200 段 + 正在跑）→ 结论只能有 1 个 ────────────
{
  const app = await openApp({ messages: history(), running: true });
  const snap = await app.page.evaluate(() => {
    const nodes = [...document.querySelectorAll('[data-testid="turn-status"]')];
    const replies = [...document.querySelectorAll('[data-testid="message"][data-role="assistant"]')];
    return {
      notices: nodes.length,
      texts: [...new Set(nodes.map((n) => (n.textContent ?? "").trim()))],
      replies: replies.length,
      cards: document.querySelectorAll('[data-testid="compaction-card"]').length,
      bars: document.querySelectorAll('[data-testid="response-bar"]').length,
      // 结论出现在第几条回复的 ResponseBar 里（-1 = 没挂）
      hostReplyIndex: (() => {
        const host = nodes[0]?.closest('[data-testid="message"]');
        if (host === undefined || host === null) return -1;
        return replies.indexOf(host);
      })(),
    };
  });
  // 先证明"测到东西了"（testing.md 2.26）：夹具真的进了页面，否则下面的断言是空集恒绿
  check("I0 夹具已进入页面（助手回复 ≥ 1 且压缩卡在）", snap.replies >= 1 && snap.cards >= 1,
    `replies=${snap.replies} cards=${snap.cards}`);
  check("I1 现场形状：一轮 200 段 + 1 张补回的压缩卡 → 页面上只剩 1 条回复（卡片也恰好在 1 张）",
    snap.replies === 1 && snap.cards === 1, `replies=${snap.replies} cards=${snap.cards}`);
  check("I2 流式期间不出现任何回合结论（本轮结局还没产生）", snap.notices === 0,
    `notices=${snap.notices} 文案=${JSON.stringify(snap.texts)}`);
  check("I3 生成中不出现「上一轮曾被中断」（那一轮还在跑，没有「上一轮」可判）",
    snap.texts.every((t) => !t.includes("上一轮曾被中断")), JSON.stringify(snap.texts));
  check("I3b 流式期间整个页面只有 1 个 ResponseBar（不能按段数放大）", snap.bars === 1, `bars=${snap.bars}`);
  check("I4 无页面异常", app.errors.length === 0, app.errors[0] ?? "");
  await app.close();
}

// ── 场景 2：跑完的一轮（同形状，running=false）→ 结论仍只有 1 个 ─────────────
{
  const finished = history().map((m, i, all) => (i === all.length - 1 ? { ...m, stopReason: "stop" } : m));
  const app = await openApp({ messages: finished, running: false });
  const snap = await app.page.evaluate(() => {
    const nodes = [...document.querySelectorAll('[data-testid="turn-status"]')];
    return { notices: nodes.length, replies: document.querySelectorAll('[data-testid="message"][data-role="assistant"]').length };
  });
  check("I5 已跑完的一轮：结论节点仍然只有 1 个", snap.notices <= 1, `notices=${snap.notices} replies=${snap.replies}`);
  await app.close();
}

// ── 场景 3：纯聊天的一轮（无工具无思考，不折叠）→ 结论只挂最后一条 ────────────
{
  const messages = [
    { id: "u-1", role: "user", text: "你好", blocks: [{ type: "text", text: "你好" }] },
    { id: "a-1", role: "assistant", text: "在的", blocks: [{ type: "text", text: "在的" }] },
    { id: "a-2", role: "assistant", text: "有什么事", blocks: [{ type: "text", text: "有什么事" }] },
  ];
  const app = await openApp({ messages, running: false });
  const snap = await app.page.evaluate(() => {
    const nodes = [...document.querySelectorAll('[data-testid="turn-status"]')];
    const replies = [...document.querySelectorAll('[data-testid="message"][data-role="assistant"]')];
    return {
      replies: replies.length,
      notices: nodes.length,
      hostIndex: nodes.length === 0 ? -1 : replies.indexOf(nodes[0].closest('[data-testid="message"]')),
    };
  });
  check("I6 纯聊天一轮两个回复都在（不折叠）", snap.replies === 2, `replies=${snap.replies}`);
  check("I7 不折叠时结论也只挂 1 条（最后一条回复）", snap.notices <= 1 && (snap.notices === 0 || snap.hostIndex === 1),
    `notices=${snap.notices} host=${snap.hostIndex}`);
  await app.close();
}

// ── 场景 4：**不折叠 + 多段 + 正在流式** → 挂点单独被验到 ─────────────────────
{
  /*
   * 这一场是给"挂点"单独设的活性闸（testing.md 2.4）：
   *
   * 场景 1 不够——那里折叠把整轮收成 1 条，就算把挂载条件改回
   * `messageLive || …`（轮级）也只会挂 1 份，门禁依然绿。只有**不折叠且多段**时，
   * `messageLive` 才真正乘到 N 条上。这里让这一轮"失败"：按现有规则失败轮不折叠
   *（用户要看到它做过什么），而轮级 live 依然为真。
   */
  const messages = [
    { id: "u-1", role: "user", text: "做事", blocks: [{ type: "text", text: "做事" }] },
    {
      id: "a-1", role: "assistant", text: "",
      blocks: [{ type: "toolCall", id: "t1", name: "bash", arguments: {}, result: "ok", isError: false }],
      failure: "aborted", error: "This operation was aborted", stopReason: "aborted", at: Date.now() - 5000,
    },
    { id: "a-2", role: "assistant", text: "再看看", blocks: [{ type: "text", text: "再看看" }], at: Date.now() - 4000 },
    { id: "a-3", role: "assistant", text: "正在写", blocks: [{ type: "text", text: "正在写" }], at: Date.now() - 3000 },
  ];
  const app = await openApp({ messages, running: true });
  const snap = await app.page.evaluate(() => {
    const nodes = [...document.querySelectorAll('[data-testid="turn-status"]')];
    const replies = [...document.querySelectorAll('[data-testid="message"][data-role="assistant"]')];
    return {
      replies: replies.length,
      notices: nodes.length,
      bars: document.querySelectorAll('[data-testid="response-bar"]').length,
      hostIndex: nodes.length === 0 ? -1 : replies.indexOf(nodes[0].closest('[data-testid="message"]')),
    };
  });
  check("I8 前置条件：不折叠的一轮真的渲染了 3 条回复（多段 + 正在跑）", snap.replies === 3,
    `replies=${snap.replies} bars=${snap.bars}`);
  /*
   * I9 是"结构性不变量"而不是"这一次能复现"：
   * 场景 4 在修后是零结论节点（生成中不写结论），所以它只能证明"没有乘成 3 份"，
   * 无法单独证明"宿主唯一"。宿主唯一由 `test/turn-fold.test.mjs` 的 T0040-8/9/15 把它锁住
   *（那里直接用 200 段夹具判 `conclusionHostOf`）。
   *
   * 为什么不在浏览器里把重复复现回来：复现它需要"正在流式 + 有回合文案"同时成立，
   * 而那正是本次要消灭的非法组合。用一个非法组合当夹具会把"修好了"写成"依赖非法输入"。
   */
  check("I9 多段 + 正在跑：结论节点不超过 1 个（不按段数乘）", snap.notices <= 1,
    `notices=${snap.notices} host=${snap.hostIndex}`);
  await app.close();
}

await browser.close();

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
if (failed.length > 0) {
  console.log("失败：");
  for (const f of failed) console.log(`  ✖ ${f.name}`);
  process.exitCode = 1;
}
