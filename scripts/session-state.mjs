#!/usr/bin/env node
/**
 * 会话状态核对工具（Task 0005 · "数字/点对不上"的定位入口）
 *
 * ## 为什么有这个工具
 *
 * 用户报「徽标显示未读 1，但列表里没有绿点」这类问题时，我原来的做法是零散地
 * fetch 几个接口、打开浏览器截图、翻 state 文件 —— 得到的是"看起来好像一致"，
 * 得不出"错在第几层"。用户的原话：
 *
 *   > 每一个位置该显示什么内容，那个数字它是怎么来的。我说了不正确之后，
 *   > 你应该能快速收集信息，判断那些数字或者数字的来源能不能对得上。
 *   > 如果前端展示的数字来源没问题，那前端一定能正常展示；如果前端没正常展示，
 *   > 那是前端展示的问题；如果本身就没有这个数字，前端也没法展示。
 *
 * 所以这个工具只做一件事：**把同一条会话在每一层的事实并排放出来，指第一处不一致**。
 *
 * ## 四层（从事实源到屏幕）
 *
 * | 层 | 名字 | 从哪读 | 它回答什么 |
 * |---|---|---|---|
 * | L1 | `disk` | `~/.lifeos/state/session-views.json` | 落盘的索引（重启后唯一能恢复的事实） |
 * | L2 | `sse`  | `/api/events` 第一帧的 `running` / `unread` / `aggregate` | **服务端此刻认为的真相**（内存） |
 * | L3 | `api`  | `/api/agents/:a/projects/:p/rows` 的 `activity.state` | 一次列表请求会返回什么 |
 * | L4 | `dom`  | 浏览器里真实渲染的徽标与点 | 用户实际看到的 |
 *
 * L1 与 L2 不同 = **落盘/内存不一致**（重启会丢未读，或刚写的还没落盘）；
 * L2 与 L3 不同 = **后端两条路径不一致**（`unread()` 与 `rowActivityOf()` 说了两套话）；
 * L3 与 L4 不同 = **前端渲染 bug**（数据对了，画面不对）；
 * 各层都一致但用户看错 = **视觉问题**（颜色/尺寸不够分明），不是逻辑 bug。
 *
 * ## 用法
 *
 *   node scripts/session-state.mjs                          # 对着 43120 全量查
 *   node scripts/session-state.mjs --no-ui                  # 跳过浏览器（快，只看 L1-L3）
 *   node scripts/session-state.mjs --agent coder            # 只看一个 Agent
 *   node scripts/session-state.mjs --session 01a1a583       # 只看一条（前缀匹配）
 *   node scripts/session-state.mjs --json                   # 机器可读（给测试用）
 *   node scripts/session-state.mjs --base http://127.0.0.1:43131
 *
 * ## 纪律
 *
 * - **只读**：不点会话（点开会把未读标成已看，会把现场毁掉）、不发消息、不删东西。
 * - **不改服务端**：不写入任何 state 文件，不要求重启。
 * - 退出码：0 = 四层一致；1 = 有一致性问题（可用于 CI 或 supervisor 巡检）。
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

// —— 参数 ——
const argv = process.argv.slice(2);
const has = (name) => argv.includes(`--${name}`);
const flag = (name, fallback) => { const i = argv.indexOf(`--${name}`); return i === -1 ? fallback : argv[i + 1]; };
const BASE = flag("base", process.env.LIFEOS_BASE ?? "http://127.0.0.1:43120").replace(/\/$/, "");
const ONLY_AGENT = flag("agent", undefined);
const ONLY_SESSION = flag("session", undefined);
const JSON_OUT = has("json");
const WITH_UI = !has("no-ui");
/**
 * 前端地址（L4 用）。**必须与后端分开**：开发实例的前端跑在 vite（5174），
 * 后端（43131）没有 `frontend/dist` 时根本不服务页面 —— 第一次写这个工具时
 * 用 BASE 打开，页面是空的，于是把"画面没有点"报成了前端 bug（假阳性）。
 */
const WEB = (flag("web", process.env.LIFEOS_WEB ?? BASE)).replace(/\/$/, "");
const HOME = process.env.LIFEOS_HOME ?? join(homedir(), ".lifeos");

// —— 小工具 ——
const iso = (value) => (typeof value === "string" && value !== "" ? value : undefined);
const short = (id) => (typeof id === "string" ? id.slice(0, 10) : "—");
const sameIso = (a, b) => (a === undefined && b === undefined) || (a !== undefined && b !== undefined && Date.parse(a) === Date.parse(b));

/** 一层对一条会话的判定（四态 + 计数格）。 */
const STATE = { RUNNING: "running", UNREAD_DONE: "unreadDone", UNREAD_ERROR: "unreadError", IDLE: "idle" };

/** 未读判定：与 `src/session-views.ts` 的 `unread()` **同一规则**（失败优先，各自判已读）。 */
function unreadOfEntry(entry) {
  if (entry === undefined) return undefined;
  const unseenFailure = entry.failureAt !== undefined
    && (entry.failureSeenAt === undefined || Date.parse(entry.failureAt) > Date.parse(entry.failureSeenAt));
  if (unseenFailure) return { state: "error", at: entry.failureAt, kind: entry.failureKind };
  if (entry.completedAt === undefined) return undefined;
  const seen = entry.viewedAt !== undefined && Date.parse(entry.viewedAt) >= Date.parse(entry.completedAt);
  if (seen) return undefined;
  return { state: entry.lastState ?? "unknown", at: entry.completedAt };
}

// ——————————————————————————————————————————————————————————————
// L1 磁盘索引
// ——————————————————————————————————————————————————————————————
async function layerDisk() {
  const file = join(HOME, "state", "session-views.json");
  const out = new Map();   // "agent\0session" -> entry
  if (!existsSync(file)) return { file, missing: true, entries: out };
  const text = await readFile(file, "utf8");
  const parsed = JSON.parse(text);
  for (const [key, entry] of Object.entries(parsed)) {
    const [agentId, sessionId] = key.split("\u0000");
    if (agentId === undefined || sessionId === undefined) continue;
    out.set(`${agentId}\u0000${sessionId}`, entry);
  }
  return { file, missing: false, entries: out, mtime: (await import("node:fs/promises")).stat(file).then((s) => s.mtime.toISOString()) };
}

// ——————————————————————————————————————————————————————————————
// L2 SSE 快照（服务端此刻的真相）
// ——————————————————————————————————————————————————————————————
async function layerSse() {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(`${BASE}/api/events`, { headers: { Accept: "text/event-stream" }, signal: ctrl.signal });
    if (!res.ok || res.body === null) return { error: `HTTP ${res.status}` };
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const at = buf.indexOf("\n\n");
      if (at < 0) continue;
      const line = buf.slice(0, at).split("\n").find((l) => l.startsWith("data:"));
      if (line === undefined) continue;
      const snap = JSON.parse(line.slice(5));
      ctrl.abort();
      return {
        running: new Map((snap.running ?? []).map((r) => [`${r.agentId}\u0000${r.sessionId}`, r])),
        unread: new Map((snap.unread ?? []).map((u) => [`${u.agentId}\u0000${u.sessionId}`, u])),
        aggregate: snap.aggregate ?? [],
      };
    }
    return { error: "没有收到快照帧" };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timer);
  }
}

// ——————————————————————————————————————————————————————————————
// L3 行对象 API
// ——————————————————————————————————————————————————————————————
async function layerApi(agents) {
  const rows = new Map();       // "agent\0session" -> row
  const errors = [];
  const projectsOfAgent = new Map();
  for (const agent of agents) {
    const projectsRes = await fetch(`${BASE}/api/agents/${agent.id}/projects`).catch(() => undefined);
    if (projectsRes?.ok !== true) { errors.push(`${agent.id}: /projects 失败`); continue; }
    const projects = (await projectsRes.json()).items ?? [];
    projectsOfAgent.set(agent.id, projects.map((p) => p.id));
    for (const project of projects) {
      const res = await fetch(`${BASE}/api/agents/${agent.id}/projects/${project.id}/rows`).catch(() => undefined);
      if (res?.ok !== true) { errors.push(`${agent.id}/${project.id}: /rows 失败`); continue; }
      for (const row of (await res.json()).items ?? []) {
        rows.set(`${agent.id}\u0000${row.sessionId}`, { ...row, projectId: project.id });
      }
    }
  }
  return { rows, projectsOfAgent, errors };
}

// ——————————————————————————————————————————————————————————————
// L4 前端 DOM（可选）
// ——————————————————————————————————————————————————————————————
async function loadPlaywright() {
  const candidates = [
    process.env.PLAYWRIGHT_CORE,
    join(HERE, "../frontend/node_modules/playwright-core/index.js"),
    join(HERE, "../node_modules/playwright-core/index.js"),
    join(homedir(), ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright-core/index.js"),
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue;
    const mod = await import(candidate);
    return mod.default ?? mod;
  }
  return undefined;
}

/**
 * 读一个页面上真实渲染的状态。
 *
 * **只读**：不点击任何行（点会话会把未读标成已看，现场就没了）。
 * 用 `?agent=&project=` 直接定位，避免"先点助手再点项目"那串会改状态的交互。
 */
async function layerDom(playwright, agentId, projectId, expectedRows) {
  const browser = await playwright.chromium.launch({
    executablePath: process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    headless: true,
  });
  try {
    const page = await (await browser.newContext({ viewport: { width: 1500, height: 950 } })).newPage();
    const url = `${WEB}/?agent=${encodeURIComponent(agentId)}${projectId !== undefined ? `&project=${encodeURIComponent(projectId)}` : ""}`;
    await page.goto(url, { waitUntil: "domcontentloaded" });
    // 等行出现（实测首屏要 12–16 秒；等不够会得到"全 0"的假结论 —— 见 Task 0005 的 C173 坑）
    // 等**行真的渲染齐**再读（C173 坑 3：等不够会得到"全 0"的假结论）。
    // 判据不是"等 N 秒"，而是"DOM 里的会话行数 ≥ 服务端行对象给的条数"——
    // 第一版只等了第一个选择器，实测漏掉后面几行，把"画面 0"报成了 bug。
    await page.waitForSelector('[data-shot-mask="session-rows"] [data-testid]', { timeout: 30_000 }).catch(() => undefined);
    if (expectedRows !== undefined && expectedRows > 0) {
      await page.waitForFunction(
        (target) => document.querySelectorAll('[data-shot-mask="session-rows"] [data-testid]').length >= target,
        expectedRows,
        { timeout: 30_000 },
      ).catch(() => undefined);
    } else {
      await page.waitForTimeout(1200);
    }
    return await page.evaluate(() => {
      const readBadge = (el) => {
        const rect = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        return {
          kind: el.dataset.stateCount,
          text: (el.textContent ?? "").trim(),
          visible: rect.width > 0 && rect.height > 0,
          size: `${Math.round(rect.width)}x${Math.round(rect.height)}`,
          bg: style.backgroundColor,
          fg: style.color,
          animation: style.animationName,
        };
      };
      /** 徽标只在"有数字"时渲染 → 缺席即 0。 */
      const marksOf = (root) => {
        const out = { running: 0, unreadDone: 0, unreadError: 0 };
        for (const el of root?.querySelectorAll("[data-state-count]") ?? []) {
          const badge = readBadge(el);
          if (badge.kind in out && badge.visible) out[badge.kind] = Number(badge.text.replace("+", "")) || 0;
        }
        return out;
      };
      const agentRoot = document.querySelector('[data-shot-mask="agent-rows"]');
      const agentRows = [...(agentRoot?.querySelectorAll(":scope > *") ?? [])].map((el) => {
        // 行的文字形如 "coder 2" / "Frontend Developer 1" → 去掉尾部的数字即名字
        const lines = (el.innerText ?? "").split("\n").map((t) => t.trim()).filter((t) => t !== "");
        // 名字取**最长的那一行文字**：头像的首字母（"F"）、徽标数字（"1"）都很短，
        // 真正的名字（"Frontend Developer"）一定更长。第一版取 lines[0] 拿到的是头像字母，
        // 导致助手行永远匹配不上、报了一个假的不一致（工具自己的 bug）。
        const name = lines.reduce((best, line) => (line.length > best.length ? line : best), "");
        return {
          name: name.replace(/\s*\d+$/, "").trim(),
          text: lines.slice(0, 3).join(" "),
          marks: marksOf(el),
          badges: [...el.querySelectorAll("[data-state-count]")].map(readBadge),
        };
      });
      const panel = document.querySelector('[data-testid="groups-panel"]');
      const projectRows = [...(panel?.querySelectorAll("[data-project-id]") ?? [])].map((el) => ({
        projectId: el.getAttribute("data-project-id"),
        marks: marksOf(el.querySelector('[data-testid="group-header"]') ?? el),
        badges: [...(el.querySelector('[data-testid="group-header"]') ?? el).querySelectorAll("[data-state-count]")].map(readBadge),
      }));
      const sessions = [...(panel?.querySelectorAll('[data-shot-mask="session-rows"] [data-testid]') ?? [])]
        .filter((el) => el.getAttribute("data-testid") !== "group-header")
        .map((el) => {
          // **只认真正的点**：几何尺寸 ≤12px（点是 6×6）。
          // 教训：第一版用 /生成中|完成未读|失败/ 匹配 title，把「0003 生成中实时 token 速度显示」
          // 这类 **Task 名字**也匹配上了（实测 168×13）—— 工具自己报了一个假 bug。
          // 判据必须落在"这个元素是不是那个点"上，而不是"它的文字像不像状态"。
          const dot = [...el.querySelectorAll("[title]")]
            .map((d) => ({ title: d.getAttribute("title") ?? "", el: d, rect: d.getBoundingClientRect() }))
            .filter((d) => d.rect.width > 0 && d.rect.width <= 12 && d.rect.height <= 12)
            .filter((d) => /生成中|完成未读|失败/.test(d.title))[0];
          const rect = dot?.rect;
          return {
            sessionId: el.getAttribute("data-testid"),
            dot: dot === undefined ? undefined : {
              title: dot.title,
              visible: rect !== undefined && rect.width > 0 && rect.height > 0,
              size: rect === undefined ? "0x0" : `${Math.round(rect.width * 10) / 10}x${Math.round(rect.height * 10) / 10}`,
              bg: getComputedStyle(dot.el).backgroundColor,
              animation: getComputedStyle(dot.el).animationName,
            },
          };
        });
      return { agentRows, projectRows, sessions, panelText: (panel?.innerText ?? "").split("\n").slice(0, 6) };
    });
  } finally {
    await browser.close();
  }
}

// ——————————————————————————————————————————————————————————————
// 判定
// ——————————————————————————————————————————————————————————————

/**
 * 由 L2（服务端真相）推出一条会话**应该**是什么状态。
 *
 * 顺序照 `src/row-activity.ts` 的 `rowActivityOf()`：running > failure > unread > idle。
 */
function expectedStateOf(key, sse, disk) {
  if (sse.error !== undefined) return undefined;
  if (sse.running.has(key)) return STATE.RUNNING;
  const unread = sse.unread.get(key);
  if (unread !== undefined) return unread.state === "error" ? STATE.UNREAD_ERROR : STATE.UNREAD_DONE;
  return STATE.IDLE;
}

/** L3 行对象的 `activity.state` → 本工具的语汇（unread / failure 要分开）。 */
function stateOfRow(row) {
  if (row === undefined) return "noRow";
  const activity = row.activity ?? {};
  if (activity.state === "running") return STATE.RUNNING;
  if (activity.state === "failure") return STATE.UNREAD_ERROR;
  if (activity.state === "unread") return STATE.UNREAD_DONE;
  return STATE.IDLE;
}

/** L4 DOM 的点 → 语汇。 */
function stateOfDot(dot) {
  if (dot === undefined || dot.visible !== true) return STATE.IDLE;
  if (dot.title.includes("生成中")) return STATE.RUNNING;
  if (dot.title.includes("失败")) return STATE.UNREAD_ERROR;
  return STATE.UNREAD_DONE;
}

const LABEL = {
  [STATE.RUNNING]: "蓝点·在跑",
  [STATE.UNREAD_DONE]: "绿点·完成未读",
  [STATE.UNREAD_ERROR]: "红点·失败",
  [STATE.IDLE]: "无点",
  noRow: "行不存在",
  unknown: "未知",
};

/**
 * 人读的差异说明。返回 `undefined` 表示这条没问题；返回字符串表示有问题。
 *
 * 判定顺序（先上游后下游，报第一处不一致 —— 后面的差异通常是被前面引起的）：
 *   L2 服务端真相 → L3 行对象 → L4 画面
 *
 * **L1（磁盘）不参与判定**：`running` 是纯内存态，**不落盘是正确设计**
 * （进程重启后本来就没有在跑的回合）。把"磁盘没有 running"当不一致是判定写错了。
 * L1 只用于回答另一个问题：「重启后这条未读还会在吗」，所以只在 L3 不一致时作为补充信息。
 */
function explain(disk, expected, api, dom, rowExists) {
  // ① 行不存在：会话文件不在了（索引残留 / 打错 projectId），单独一类
  if (rowExists === false) return undefined;   // 由调用方归入 notes，不算 problem
  // ② 服务端真相 vs 行对象
  if (expected !== undefined && api !== expected) {
    if (expected === STATE.RUNNING && api === STATE.IDLE) return "服务端说在跑，行对象说空闲 → runningOf() 与 rowActivityOf() 用了不同来源";
    if (expected === STATE.UNREAD_DONE && api === STATE.IDLE) return "服务端说未读，行对象说空闲 → 行的 unreadSince 没拿到（unread() 的 key 与行对不上）";
    if (expected === STATE.UNREAD_ERROR && api !== STATE.UNREAD_ERROR) return "服务端说失败待看，行对象没报 failure";
    if (expected !== STATE.RUNNING && api === STATE.RUNNING) return "服务端说不在跑，行对象说在跑 → runningOf() 与行口径不一致";
    return `服务端=${LABEL[expected] ?? expected}，行对象=${LABEL[api] ?? api}`;
  }
  // ③ 行对象 vs 画面
  if (expected !== undefined && dom !== undefined && dom !== expected) {
    const hint = dom === STATE.IDLE
      ? "画面没有点 → 前端没收到/没应用这个状态（补丁丢了？行没重建？）"
      : `画面=${LABEL[dom]}`;
    return `行对象说 ${LABEL[expected]}，画面 ${hint} → 前端渲染问题`;
  }
  return undefined;
}

// ——————————————————————————————————————————————————————————————
// 主流程
// ——————————————————————————————————————————————————————————————
async function main() {
  const report = { base: BASE, web: WEB, home: HOME, at: new Date().toISOString(), layers: {}, sessions: [], problems: [], notes: [], stale: [] };

  // —— 收集 ——
  const agentsRes = await fetch(`${BASE}/api/agents`).catch(() => undefined);
  if (agentsRes?.ok !== true) {
    console.error(`无法连接 ${BASE}（/api/agents）。实例在跑吗？`);
    process.exit(2);
  }
  const agents = ((await agentsRes.json()).items ?? []).filter((a) => ONLY_AGENT === undefined || a.id === ONLY_AGENT);

  const disk = await layerDisk();
  const sse = await layerSse();
  const api = await layerApi(agents);
  report.layers = {
    disk: { file: disk.file, missing: disk.missing === true, entries: disk.entries.size },
    sse: sse.error !== undefined ? { error: sse.error } : { running: sse.running.size, unread: sse.unread.size, aggregate: sse.aggregate.length },
    api: { rows: api.rows.size, errors: api.errors },
    dom: WITH_UI ? "pending" : "skipped",
  };
  if (sse.error !== undefined) report.problems.push(`L2 SSE 快照失败：${sse.error}`);

  // —— L4 ——
  let domByAgent = new Map();
  if (WITH_UI && sse.error === undefined) {
    const playwright = await loadPlaywright();
    if (playwright === undefined) {
      report.notes.push("找不到 playwright-core，跳过 L4（DOM）。用 --no-ui 可显式跳过。");
      report.layers.dom = "unavailable";
    } else {
      const targets = ONLY_AGENT !== undefined
        ? [ONLY_AGENT]
        : agents.filter((a) => (sse.aggregate ?? []).some((g) => g.agentId === a.id)).map((a) => a.id);
      for (const agentId of targets) {
        const projectId = flag("project", undefined) ?? (report.layers.projectsOfAgent?.[agentId] ?? undefined);
        try {
          const expectedRows = [...api.rows.entries()]
            .filter(([key]) => key.startsWith(`${agentId}\u0000`))
            .length;
          const dom = await layerDom(playwright, agentId, projectId, expectedRows);
          domByAgent.set(agentId, dom);
        } catch (error) {
          report.notes.push(`L4 DOM(${agentId}) 失败：${error instanceof Error ? error.message : String(error)}`);
        }
      }
      report.layers.dom = `${domByAgent.size} 个 Agent 已读`;
    }
  }

  // —— 逐会话对照 ——
  const seen = new Set();
  const keys = new Set([...api.rows.keys(), ...disk.entries.keys()]);
  if (sse.error === undefined) for (const key of sse.running.keys()) keys.add(key);
  if (sse.error === undefined) for (const key of sse.unread.keys()) keys.add(key);

  for (const key of keys) {
    const [agentId, sessionId] = key.split("\u0000");
    if (agentId === undefined || sessionId === undefined) continue;
    if (ONLY_AGENT !== undefined && agentId !== ONLY_AGENT) continue;
    if (ONLY_SESSION !== undefined && !sessionId.startsWith(ONLY_SESSION)) continue;
    seen.add(key);

    const row = api.rows.get(key);
    const diskEntry = disk.entries.get(key);
    const diskUnread = unreadOfEntry(diskEntry);
    const expected = expectedStateOf(key, sse, disk);
    const apiState = stateOfRow(row);

    // DOM：只有"当前页面打开了该 Agent"时才有值
    const dom = domByAgent.get(agentId);
    const domSession = dom?.sessions.find((s) => s.sessionId === sessionId);
    const domState = dom === undefined ? undefined : stateOfDot(domSession?.dot);

    const diskState = diskUnread === undefined
      ? (diskEntry === undefined ? undefined : STATE.IDLE)
      : diskUnread.state === "error" ? STATE.UNREAD_ERROR : diskUnread.state === "unknown" ? "unknown" : STATE.UNREAD_DONE;

    const rowExists = api.rows.has(key);
    const detail = explain(diskState, expected, apiState, domState, rowExists);
    if (!rowExists) {
      report.stale.push(`${agentId}/${short(sessionId)}`);
      continue;   // 不进对照表，不算 problem
    }
    const item = {
      agentId,
      sessionId,
      projectId: row?.projectId ?? (sse.error === undefined ? sse.unread.get(key)?.projectId ?? sse.running.get(key)?.projectId : undefined),
      title: (row?.title?.display ?? "").slice(0, 34),
      disk: diskState,
      sse: expected,
      api: apiState,
      dom: domState,
      dotGeom: domSession?.dot?.size,
      dotAnim: domSession?.dot?.animation,
      agree: detail === undefined,
      detail,
    };
    report.sessions.push(item);
    if (detail !== undefined) report.problems.push(`${agentId}/${short(sessionId)}：${detail}`);
  }

  // —— 徽标一致性：L2 aggregate vs L3 行数出来 vs L4 DOM ——
  const marksFromApi = new Map();
  for (const [key, row] of api.rows) {
    const [agentId] = key.split("\u0000");
    const projectId = row.projectId;
    const state = stateOfRow(row);
    if (state === STATE.IDLE || state === "noRow") continue;
    for (const k of [`${agentId}\u0000${projectId}`, `${agentId}\u0000`]) {
      const bucket = marksFromApi.get(k) ?? { running: 0, unreadDone: 0, unreadError: 0 };
      if (state === STATE.RUNNING) bucket.running += 1;
      if (state === STATE.UNREAD_DONE) bucket.unreadDone += 1;
      if (state === STATE.UNREAD_ERROR) bucket.unreadError += 1;
      marksFromApi.set(k, bucket);
    }
  }
  const marks = [];
  const fetchedAgents = new Set(agents.map((a) => a.id));   // 只比"真的抓过行"的 Agent
  if (sse.error === undefined) {
    for (const entry of sse.aggregate) {
      if (!fetchedAgents.has(entry.agentId)) continue;
      const projectKey = `${entry.agentId}\u0000${entry.projectId}`;
      const agentKey = `${entry.agentId}\u0000`;
      const fromApiProject = marksFromApi.get(projectKey) ?? { running: 0, unreadDone: 0, unreadError: 0 };
      const domAgent = domByAgent.get(entry.agentId);
      const domProject = domAgent?.projectRows.find((p) => p.projectId === entry.projectId);
      void domProject;
      const domSessionsInProject = domAgent?.sessions.filter((s) => {
        const row2 = api.rows.get(`${entry.agentId}\u0000${s.sessionId}`);
        return row2?.projectId === entry.projectId;
      }) ?? [];
      const domCounts = { running: 0, unreadDone: 0, unreadError: 0 };
      for (const s of domSessionsInProject) {
        const st = stateOfDot(s.dot);
        if (st === STATE.RUNNING) domCounts.running += 1;
        if (st === STATE.UNREAD_DONE) domCounts.unreadDone += 1;
        if (st === STATE.UNREAD_ERROR) domCounts.unreadError += 1;
      }
      const same = (a, b) => a.running === b.running && a.unreadDone === b.unreadDone && a.unreadError === b.unreadError;
      const line = {
        scope: "项目",
        agentId: entry.agentId,
        projectId: entry.projectId,
        sse: { running: entry.running, unreadDone: entry.unreadDone, unreadError: entry.unreadError },
        api: fromApiProject,
        dom: domProject?.marks,
        ok: same({ running: entry.running, unreadDone: entry.unreadDone, unreadError: entry.unreadError }, fromApiProject),
      };
      marks.push(line);
      if (!line.ok) report.problems.push(`徽标(项目 ${entry.agentId}/${entry.projectId})：SSE ${JSON.stringify(line.sse)} ≠ 行对象数出来 ${JSON.stringify(fromApiProject)}`);
      void agentKey;
    }
    // 助手层：把该项目所有聚合相加
    const byAgent = new Map();
    for (const entry of sse.aggregate) {
      const bucket = byAgent.get(entry.agentId) ?? { running: 0, unreadDone: 0, unreadError: 0 };
      bucket.running += entry.running;
      bucket.unreadDone += entry.unreadDone;
      bucket.unreadError += entry.unreadError;
      byAgent.set(entry.agentId, bucket);
    }
    for (const [agentId, sseMarks] of byAgent) {
      if (!fetchedAgents.has(agentId)) continue;
      const fromApi = marksFromApi.get(`${agentId}\u0000`) ?? { running: 0, unreadDone: 0, unreadError: 0 };
      const same = (a, b) => a.running === b.running && a.unreadDone === b.unreadDone && a.unreadError === b.unreadError;
      // 助手行的徽标：DOM 里只有一行（当前选中的 Agent），读它的三数
      const agentName = agents.find((a) => a.id === agentId)?.name ?? agentId;
      const domMarks = domByAgent.get(agentId)?.agentRows.find((r) => r.name === agentName)?.marks;
      const line = { scope: "助手", agentId, sse: sseMarks, api: fromApi, dom: domMarks, ok: same(sseMarks, fromApi) && (domMarks === undefined || same(sseMarks, domMarks)) };
      marks.push(line);
      if (!line.ok) {
        const where = !same(sseMarks, fromApi) ? `行对象 ${JSON.stringify(fromApi)}` : `画面 ${JSON.stringify(domMarks)}`;
        report.problems.push(`徽标(助手 ${agentId})：SSE ${JSON.stringify(sseMarks)} ≠ ${where}`);
      }
    }
  }
  report.marks = marks;

  if (JSON_OUT) {
    console.log(JSON.stringify(report, null, 2));
    process.exit(report.problems.length === 0 ? 0 : 1);
  }

  // —— 人读输出 ——
  const pad = (text, width) => {
    // 中文按 2 格算，否则列对不齐
    const len = [...String(text)].reduce((sum, ch) => sum + (/[\u4e00-\u9fa5]/.test(ch) ? 2 : 1), 0);
    return String(text) + " ".repeat(Math.max(0, width - len));
  };
  console.log(`\n会话状态核对 · 后端 ${BASE} · 前端 ${WEB}`);
  console.log(`家目录 ${HOME}`);
  console.log(`L1 磁盘  ${report.layers.disk.missing ? "（文件不存在）" : `${report.layers.disk.entries} 条`}  ${report.layers.disk.file}`);
  console.log(`L2 服务端 ${sse.error !== undefined ? `失败：${sse.error}` : `running ${report.layers.sse.running} · unread ${report.layers.sse.unread} · aggregate ${report.layers.sse.aggregate}`}`);
  console.log(`L3 行对象 ${report.layers.api.rows} 行${api.errors.length > 0 ? `（错误：${api.errors.join("; ")}）` : ""}`);
  console.log(`L4 画面  ${report.layers.dom}`);
  for (const note of report.notes) console.log(`  · ${note}`);
  if (report.stale.length > 0) console.log(`  · 索引残留 ${report.stale.length} 条（会话文件已删，前后端都不显示，属正常）：${report.stale.slice(0, 4).join(" ")}${report.stale.length > 4 ? " …" : ""}`);

  const interesting = report.sessions.filter((s) => s.sse !== STATE.IDLE || s.api !== STATE.IDLE || s.dom !== undefined && s.dom !== STATE.IDLE || !s.agree);
  if (interesting.length === 0) {
    console.log("\n没有任何会话处于非空闲状态。\n");
  } else {
    console.log(`\n${pad("会话", 26)}${pad("L1磁盘", 16)}${pad("L2服务端", 16)}${pad("L3行对象", 16)}${pad("L4画面", 16)}说明`);
    console.log("─".repeat(120));
    for (const s of interesting) {
      const mark = s.agree ? " " : "✖";
      console.log(`${mark}${pad(`${s.agentId}/${short(s.sessionId)}`, 25)}${pad(LABEL[s.disk] ?? "—", 16)}${pad(LABEL[s.sse] ?? "—", 16)}${pad(LABEL[s.api] ?? "—", 16)}${pad(LABEL[s.dom] ?? "—", 16)}${s.detail ?? ""}`);
    }
  }

  if (report.marks.length > 0) {
    console.log("\n徽标（数字）：");
    for (const m of report.marks) {
      const fmt = (v) => (v === undefined ? "—" : `跑${v.running} 完${v.unreadDone} 败${v.unreadError}`);
      console.log(`  ${m.ok ? " " : "✖"} ${pad(`${m.scope} ${m.agentId}${m.projectId !== undefined ? `/${m.projectId}` : ""}`, 34)}SSE ${pad(fmt(m.sse), 18)}行对象 ${pad(fmt(m.api), 18)}画面 ${fmt(m.dom)}`);
    }
  }

  console.log("");
  if (report.problems.length === 0) {
    console.log("✅ 四层一致。如果画面上仍然看起来不对，那是视觉问题（颜色/尺寸/动画不够分明），不是逻辑 bug。");
  } else {
    console.log(`❌ 发现 ${report.problems.length} 处不一致：`);
    for (const p of report.problems) console.log(`   · ${p}`);
    console.log("\n判定方法：L2 是服务端此刻的真相（SSE 快照）。");
    console.log("  L2 对、L3 错 → 后端两条路径口径不一致（unread() vs rowActivityOf()）");
    console.log("  L3 对、L4 错 → 前端渲染问题（applyRowPatch / sessionSlots / deriveStatus）");
    console.log("  L1 与 L2 不同 → 落盘/内存不一致（重启会丢未读）");
  }
  console.log("");
  process.exit(report.problems.length === 0 ? 0 : 1);
}

await main();
