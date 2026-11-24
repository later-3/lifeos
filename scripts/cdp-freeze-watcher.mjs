/**
 * **常驻看守**（Task 0033 · P5 的最终形态）。
 *
 * ## 为什么必须是"常驻"而不是"事后抢救"
 *
 * 实测数据（`diag-enable-timing.mjs` + 两次真事故）：
 *
 * | 场景 | `Debugger.enable` | `Debugger.pause` |
 * |---|---|---|
 * | 页面正常时先 enable | **93ms** | **304ms** 拿到栈 |
 * | 页面已冻死后才 enable | **超时 90s**（3 × 30s 全失败） | 从未到达 |
 *
 * 2026-11-24 的真实事故（Chrome pid 38427，满核 9 小时）：
 * 用户在卡死后 ~19 分钟告诉我，我两次尝试事后 enable，**全部 30 秒超时**。
 * 所以"事后抢救"这条路不可靠 —— 必须提前把 Debugger 挂上。
 *
 * ## 设计要点（每一条都对应一个踩过的坑）
 *
 * 1. **先 enable，再等**：启动时页面正常，enable 必然成功（93ms）；
 * 2. **不能用 `Runtime.evaluate("1+1")` 探活**：实测 renderer 满核 100% 时它仍 1ms 返回 2
 *    （DevTools agent 会回"已排队"）。唯一可靠判据是 `Debugger.pause` 之后**顶部帧有没有 url**；
 * 3. **会话死了要能自愈**：标签页重载/关掉后 session 失效 → 重新 attach + enable；
 * 4. **抓到栈立刻落盘**，不等收尾（进程可能马上被杀）；
 * 5. **卡片式输出**：一行 `👉 卡在：xxx @ src/App.tsx:1247:31`，不用读整份栈。
 *
 * ## 用法
 *
 *   node scripts/cdp-freeze-watcher.mjs                  # 看 9222（Chrome）
 *   node scripts/cdp-freeze-watcher.mjs --port 9223      # 看 9223（Edge）
 *   node scripts/cdp-freeze-watcher.mjs --ports 9222,9223 # 同时看两个
 *   node scripts/cdp-freeze-watcher.mjs --once-check     # 只检查一次就退（自测）
 *
 * Ctrl-C 退出。落盘目录：`~/.lifeos/logs/freeze-stacks/`。
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createWriteStream, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { firstNonEmpty, loadSourceMapFor, translateFrames } from "./sourcemap-translate.mjs";

const args = process.argv.slice(2);
const argOf = (name, fallback) => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : fallback;
};
const has = (name) => args.includes(name);

const PORTS = (argOf("--ports", argOf("--port", "9222")) ?? "9222").split(",").map((value) => Number(value.trim()));
const APP_PATTERN = argOf("--app", "43120");
const PROBE_MS = Number(argOf("--probe-ms", 1500));
const PAUSE_WAIT_MS = Number(argOf("--pause-wait", 20_000));
const ONCE_CHECK = has("--once-check");
const SELFTEST = has("--selftest");
const DEBUG = has("--debug");
/** 报"卡死"的 CPU 门槛：实测三次真事故都是 95–103%，正常渲染 20–40%。 */
const CPU_THRESHOLD = Number(argOf("--cpu-threshold", 70));
/** 用来在 `ps` 里认出"这个实例的 renderer"（一般是 user-data-dir 的名字）。 */
const MARKER = argOf("--marker", "lifeos-debug");

const HOME = process.env.LIFEOS_HOME ?? join(homedir(), ".lifeos");
const OUT_DIR = join(HOME, "logs", "freeze-stacks");
mkdirSync(OUT_DIR, { recursive: true });

const run = promisify(execFile);
const clock = () => new Date().toLocaleTimeString();
const say = (tag, message) => console.log(`[${clock()}] ${tag} ${message}`);

/* ───────────────────────── 极简 CDP ───────────────────────── */

function connect(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    let nextId = 0;
    const pending = new Map();
    const methods = new Map();
    const handlers = new Map();
    let closed = false;

    const fail = () => {
      closed = true;
      for (const slot of pending.values()) slot.rej(new Error("连接已断开"));
      pending.clear();
    };

    socket.addEventListener("open", () => resolve({
      get closed() { return closed; },
      send(method, params = {}, sessionId) {
        if (closed) return Promise.reject(new Error("连接已断开"));
        const id = ++nextId;
        const message = { id, method, params };
        if (sessionId !== undefined) message.sessionId = sessionId;
        socket.send(JSON.stringify(message));
        return new Promise((res, rej) => { methods.set(id, method); pending.set(id, { res, rej }); });
      },
      on(method, handler) {
        if (!handlers.has(method)) handlers.set(method, []);
        handlers.get(method).push(handler);
      },
      close() { closed = true; try { socket.close(); } catch { /* 已关 */ } },
    }));

    socket.addEventListener("error", () => { fail(); reject(new Error("ws error")); });
    socket.addEventListener("close", () => fail());
    socket.addEventListener("message", (event) => {
      if (typeof event.data !== "string") return;
      let message;
      try { message = JSON.parse(event.data); } catch { return; }
      if (message.id != null) {
        const slot = pending.get(message.id);
        if (slot === undefined) return;
        const method = methods.get(message.id) ?? "?";
        pending.delete(message.id);
        methods.delete(message.id);
        if (message.error) slot.rej(new Error(`${method}: ${message.error.message}`));
        else slot.res(message.result);
        return;
      }
      if (typeof message.method === "string") {
        for (const handler of handlers.get(message.method) ?? []) handler(message.params, message.sessionId);
      }
    });
  });
}

/** 带超时的调用（超时不代表失败，只代表"这次没等到"）。 */
function race(promise, ms) {
  return Promise.race([
    promise.then((value) => ({ ok: true, value })),
    new Promise((resolve) => setTimeout(() => resolve({ ok: false }), ms)),
  ]);
}

/* ───────────────────────── 一个端口的看守 ───────────────────────── */

async function watchPort(port) {
  let browser;
  let sessionId;
  /**
   * `scriptId → url` 映射。
   *
   * ⭐ 必须在 `Debugger.enable` **之前**注册 `Debugger.scriptParsed`：
   * enable 会重放全部已有脚本（实测 165 条），之后再注册就一条也收不到，
   * 于是 `callFrame.url` 恒为空 —— 这正是 2026-11-24 一开始"只能看到 (no url)"的原因。
   */
  const scriptUrls = new Map();
  let pageInfo;
  let paused;
  let lastReportedSignature;
  /**
   * 连续命中同一位置的计数。
   *
   * ## 为什么需要（2026-11-24 实测的误报）
   *
   * 第一版判据是"pause 到带 url 的帧就算冻结"，结果**页面正常工作时也报了一大堆**：
   * `SessionHistory.tsx:77:90`、`react-dom-client.production.js:3950`……
   * 因为 pause 本来就是"打断当前正在执行的代码"，正常渲染也会命中真实帧。
   *
   * 正确判据是**同一个位置重复命中**：真卡死时主线程在原地打转，
   * 每一拍 pause 都命中同一处；正常工作时每拍落在不同地方。
   */
  const HIT_STREAK_TO_REPORT = 3;
  let hitSignature = "";
  let hitStreak = 0;
  let consecutiveFailures = 0;

  const attachFresh = async () => {
    try {
      const version = await (await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(2000) })).json();
      if (browser === undefined || browser.closed) {
        browser = await connect(version.webSocketDebuggerUrl);
        browser.on("Debugger.paused", (params, sid) => { if (sid === sessionId) paused = params; });
        browser.on("Debugger.scriptParsed", (params, sid) => {
          if (sid === undefined || sid === sessionId) {
            if (typeof params?.url === "string" && params.url !== "") scriptUrls.set(params.scriptId, params.url);
          }
        });
      }
      const { targetInfos } = await browser.send("Target.getTargets");
      const page = targetInfos.find((target) => target.type === "page" && String(target.url).includes(APP_PATTERN));
      if (page === undefined) return false;
      pageInfo = { url: page.url, targetId: page.targetId };
      const attached = await browser.send("Target.attachToTarget", { targetId: page.targetId, flatten: true });
      sessionId = attached.sessionId;
      scriptUrls.clear();
      /* enable 之前脚本监听已就位 → enable 期间重放的所有 scriptParsed 都会进映射表 */
      const enabled = await race(browser.send("Debugger.enable", {}, sessionId), 10_000);
      if (!enabled.ok) { say("⚠️", `:${port} Debugger.enable 超时（页面可能已经不健康）`); return false; }
      lastReportedSignature = undefined;
      say("✅", `:${port} 已 attach + Debugger.enable → ${page.url.slice(0, 70)}`);
      return true;
    } catch (error) {
      say("⚠️", `:${port} 连接失败：${String(error.message ?? error).slice(0, 60)}`);
      return false;
    }
  };

  /**
   * 读该浏览器实例里 renderer 的最高 CPU（从 Node 侧 `ps`，不经过页面）。
   *
   * ## 为什么"同一位置重复命中"还不够（2026-11-24 实测）
   *
   * 只用"连续 3 拍命中同一位置"时，**正常渲染**也会触发误报：
   * 实测自测那次报了 `l2 @ react-dom:3950`，而当时页面 CPU 只有 **27.7%** ——
   * 它只是在正常重渲染，pause 反复落在同一个渲染函数里。
   *
   * 真卡死的硬特征是 **renderer 满核**（实测三次事故都是 95–103%）。
   * 所以两个判据必须同时成立：同一位置重复 **且** CPU ≥ 阈值。
   */
  const rendererCpu = async () => {
    try {
      const { stdout } = await run("ps", ["-eo", "pcpu,command"], { maxBuffer: 8 * 1024 * 1024 });
      let best = 0;
      for (const line of stdout.split("\n")) {
        if (!line.includes("--type=renderer")) continue;
        if (MARKER !== "" && !line.includes(MARKER)) continue;
        const match = /^\s*([\d.]+)\s/.exec(line);
        if (match === null) continue;
        const cpu = Number(match[1]);
        if (cpu > best) best = cpu;
      }
      return best;
    } catch {
      return 0;
    }
  };

  const report = async (frames) => {
    const rows = await translateFrames(frames, (url) => loadSourceMapFor(url).catch(() => undefined), scriptUrls);
    const signature = rows.map((row) => `${row.functionName}@${row.source}:${row.line}`).join("|");
    /* 同一段栈不重复落盘（卡死时每次 pause 都会命中同一处） */
    if (signature === lastReportedSignature) return;
    lastReportedSignature = signature;

    const snapshot = {};
    for (const [key, expression] of [
      ["messages", "document.querySelectorAll('[data-message-id]').length"],
      ["domNodes", "document.getElementsByTagName('*').length"],
      ["url", "location.href"],
      ["visibility", "document.visibilityState"],
    ]) {
      const result = await race(browser.send("Runtime.evaluate", { expression, returnByValue: true }, sessionId), 3000);
      if (result.ok) snapshot[key] = result.value.result?.value;
    }

    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const outPath = join(OUT_DIR, `frozen-${port}-${stamp}.json`);
    writeFileSync(outPath, JSON.stringify({
      ts: new Date().toISOString(), port, page: pageInfo, frames: rows, snapshot,
    }, null, 1));

    console.log(`\n${"═".repeat(72)}`);
    console.log(`🚨 [${clock()}] 端口 :${port} 检测到主线程冻结`);
    const top = rows.find((row) => row.source !== "") ?? rows[0];
    console.log(`\n👉 卡在：${top?.functionName} @ ${top?.source}:${top?.line}:${top?.column}`);
    console.log("");
    for (const [index, row] of rows.slice(0, 12).entries()) {
      const where = row.source === "" ? "(no url)" : `${row.source}:${row.line}:${row.column}`;
      console.log(`   ${String(index).padStart(2)}. ${row.functionName.padEnd(30)} ${where}${row.mapped ? "  → 源码" : ""}`);
    }
    if (snapshot.messages !== undefined) {
      console.log(`\n   现场：消息 ${snapshot.messages} 条 · DOM ${snapshot.domNodes} 节点 · ${snapshot.url ?? ""}`);
    }
    console.log(`   落盘：${outPath}`);
    console.log(`${"═".repeat(72)}\n`);
  };

  const tick = async () => {
    if (sessionId === undefined) {
      if (!(await attachFresh())) return;
    }
    /*
     * 判据（唯一可靠的一条）：**pause 之后顶部帧有没有 url**。
     * 不用 `Runtime.evaluate("1+1")` 探活 —— 实测满核 100% 时它仍 1ms 返回 2。
     *
     * ## 为什么等待窗口要分两段（2026-11-24 实测）
     *
     * 空闲页面上 `Debugger.pause` **会返回 ok 但不产生 `Debugger.paused` 事件**
     * （实测连测 5 轮：pause 全部 0–1ms 返回 ok，paused 事件 0 次）。
     * 第一版统一等 `PAUSE_WAIT_MS`（20 秒）→ 每拍卡 20 秒 → 看守看起来"没反应"，
     * 而且 3 拍超时后重连，日志被 attach 刷满。
     *
     * 正确做法：
     *   - 先等 `IDLE_WAIT_MS`（800ms）：正常空闲页面在这一段里不会有 paused 事件；
     *   - 只有等到 paused **且带 url** 才算出栈（真冻结）；
     *   - 等到 paused 但**无 url** → 内部任务，resume 后继续，不算失败；
     *   - 一段都没等到 → 页面空闲，直接返回（**不重连**）。
     */
    const IDLE_WAIT_MS = 800;
    paused = undefined;
    const sent = await race(browser.send("Debugger.pause", {}, sessionId), 5000);
    if (!sent.ok) {
      /* pause 请求本身发不出去 → session 坏了，下拍重连 */
      sessionId = undefined;
      return;
    }
    let deadline = Date.now() + IDLE_WAIT_MS;
    while (paused === undefined && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 100));
    if (DEBUG) {
      const top = paused?.callFrames?.[0];
      const url = top === undefined ? "" : String(top.url ?? top.location?.url ?? scriptUrls.get(top.location?.scriptId) ?? "");
      say("·", `pause→${paused === undefined ? "无事件" : "有事件"} fn=${top?.functionName || "(anon)"} url=${url || "空"} scriptUrls=${scriptUrls.size}`);
    }

    /*
     * 空闲：800ms 内没有 paused 事件 → 这一拍什么都没发生。
     *
     * ⚠️ **仍要发一次 resume**：`Debugger.pause` 返回 ok 之后暂停可能**晚到**
     * （实测空闲页面上 paused 事件经常在 1–2 秒后才来）。如果不 resume 就 return，
     * 下一次 pause 会遇到"已处于 paused 状态"→ 永远不再产生 paused 事件 →
     * 看守从此瞎掉（2026-11-24 实测这次 tick 之后再没抓到任何东西）。
     * resume 对"本来就没暂停"的页面是幂等的（CDP 允许）。
     */
    if (paused === undefined) {
      /* resume 在"本来就没暂停"时会被 CDP 拒绝（"Can only perform operation while paused"），
       * 那是正常情况，必须吞掉 —— 第一版没吞，导致每一拍都抛异常、看守整个瞎掉。 */
      await race(browser.send("Debugger.resume", {}, sessionId).catch(() => undefined), 2000);
      return;
    }

    /*
     * 有 paused：可能是"内部任务"（无 url）或"真冻结"（有 url）。
     * 无 url 时**多等一会**再看会不会升级成有 url 的帧（冻结时 pause 常先命中内部任务）。
     */
    const urlOf = (frame) => firstNonEmpty(frame?.url, frame?.location?.url, scriptUrls.get(frame?.location?.scriptId));
    deadline = Date.now() + PAUSE_WAIT_MS;
    while (Date.now() < deadline) {
      if ((paused?.callFrames ?? []).some((frame) => urlOf(frame) !== "")) break;
      await new Promise((resolve) => setTimeout(resolve, 250));
      if (paused === undefined) break;
    }

    /*
     * ⚠️ 先把 paused 的**值取出来**再清空：上面那个"升级等待"循环里如果 paused 被清空
     * （比如 resume 事件把它冲掉），直接读 `paused.callFrames` 会抛
     * "Cannot read properties of undefined"（2026-11-24 实测日志里那条 tick 异常）。
     */
    const captured = paused;
    const frames = captured?.callFrames ?? [];
    /* 判"这一帧有没有源码位置"：frame.url 常为空，真 url 在 scriptUrls 里（scriptId → url） */
    const frameUrlOf = (frame) => firstNonEmpty(frame?.url, frame?.location?.url, scriptUrls.get(frame?.location?.scriptId));
    const hasUrl = frames.some((frame) => frameUrlOf(frame) !== "");
    paused = undefined;

    if (hasUrl) {
      /* 同一位置连续命中才算卡死（见 HIT_STREAK_TO_REPORT 的注释） */
      const signature = frames
        .map((frame) => `${frame?.functionName}|${frameUrlOf(frame)}|${frame?.location?.lineNumber}`)
        .join(">");
      if (signature === hitSignature) hitStreak += 1;
      else { hitSignature = signature; hitStreak = 1; }
      if (DEBUG) say("·", `命中 ${hitStreak}/${HIT_STREAK_TO_REPORT} 次（同一位置才报）`);
      if (hitStreak >= HIT_STREAK_TO_REPORT) {
        const cpu = await rendererCpu();
        if (DEBUG) say("·", `连续命中 ${hitStreak} 次，renderer CPU ${cpu}%（阈值 ${CPU_THRESHOLD}%）`);
        if (cpu >= CPU_THRESHOLD) await report(frames);
      }
    } else {
      /* 这一拍落在内部任务：重置连续计数（正常的页面活动会让位置不断变化） */
      hitSignature = "";
      hitStreak = 0;
    }
    /* 无论是否命中，都要 resume：不 resume 会让页面永久停住（同样要吞掉"本来没暂停"的错误） */
    await race(browser.send("Debugger.resume", {}, sessionId).catch(() => undefined), 3000);
  };

  await attachFresh();

  /*
   * `--selftest`：由看守**自己**注入一段冻结（同一 session，不引入第二条连接），
   * 用它证明"看守能自动发现并出栈"。
   *
   * 为什么必须同 session：另开一条连接 attach 同一个 target 会让两条 session
   * 互相抢占，pause/resume 交错 → 看起来"抓不到"（2026-11-24 反复踩到）。
   */
  if (SELFTEST) {
    /*
     * ## 关键技巧：给注入的脚本一个 `//# sourceURL`
     *
     * 匿名脚本（`Runtime.evaluate`）的栈帧 `url` **恒为空**，于是看守的
     * "顶部帧有 url 才算真命中"判据永远不成立 —— 我因此自测了好几次都抓不到。
     * 加一行 `//# sourceURL=lifeos-selftest.js` 就会让 `scriptParsed` 带上 url，
     * 栈帧随之可读（这是调试脚本的标准做法，不是 hack）。
     *
     * ## 为什么不靠 `setTimeout`
     *
     * 后台标签页的 `setTimeout` 被节流到 60 秒一次（实测注入后 CPU 只有 8% = 回调没跑）。
     * 所以直接在 evaluate 里同步跑死循环 —— `Runtime.evaluate` 会一直不返回，
     * 但那正是我们要的"满核"。
     */
    const expression = `
      //# sourceURL=lifeos-selftest.js
      (function () {
        const tick = String.fromCharCode(96);
        const pathological = '**' + (tick + tick).repeat(20000) + '**';
        const deadline = Date.now() + 12000;
        let acc = 0;
        while (Date.now() < deadline) { acc += pathological.length; }
        return acc;
      })();
    `;
    browser.send("Runtime.evaluate", { expression, returnByValue: true }, sessionId).catch(() => undefined);
    say("🧪", `:${port} 自测：已注入 12 秒冻结（同一 session）`);
  }

  if (ONCE_CHECK) {
    say("ℹ️", `:${port} 单次检查模式，退出`);
    browser?.close();
    return;
  }

  const timer = setInterval(() => { tick().catch((error) => say("⚠️", `:${port} tick 异常：${error.message}`)); }, PROBE_MS);
  timers.push(timer);
  say("👀", `:${port} 看守中（每 ${PROBE_MS / 1000}s 检查一次）`);
}

const timers = [];

/* ───────────────────────── 主流程 ───────────────────────── */

say("🔧", `看守端口：${PORTS.join(", ")}（目标页面含 "${APP_PATTERN}"）`);
for (const port of PORTS) await watchPort(port);

if (!ONCE_CHECK) {
  say("ℹ️", "Ctrl-C 退出。卡死时这里会自动打印栈并落盘。");
  process.on("SIGINT", () => {
    for (const timer of timers) clearInterval(timer);
    say("👋", "已停止看守");
    process.exit(0);
  });
}
