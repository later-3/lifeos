#!/usr/bin/env node
/**
 * S4-b/c/d 端到端验收脚本（**不用大模型**，纯 HTTP + Playwright）。
 *
 * 七个场景（对应 phases/S4bcd-delivery-plan.md §5）：
 *   E1 写一条 → 刷新 → 还在
 *   E2 **清 localStorage** → 刷新 → 还在          ← 核心验收
 *   E3 新浏览器上下文（无痕） → 还在
 *   E4 **重启后端**（独立端口 + 独立家目录副本） → 还在
 *   E5 切 Task 再切回 → 只看到本 Task 的
 *   E6 Agent 身份写一条（POST） → 前端能看到、作者是 agent
 *   E7 worktree 新提交后 → 还在
 *
 * 用法：
 *   APP_URL=http://127.0.0.1:5178 API=http://127.0.0.1:43133 \
 *   E2E_HOME=~/.lifeos-dev/0010/e2e-copy node scripts/e2e-review-comments.mjs
 *
 * E4 会**复制一份家目录**到 E2E_HOME（不碰开发实例/用户真实数据），在那里起临时后端。
 */
import { execFile, spawn } from "node:child_process";
import { cp, mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { existsSync, rmSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);

/**
 * 取一个**当前空闲**的端口。
 *
 * 为什么要动态取（2026-11-08 实测踩到）：脚本里写死 `E2E_PORT ?? 43199`，
 * 同时跑两份（或上一份没退干净）时两份共用一个端口 + 共用一个 `0010-restart` 目录，
 * 后一份 `rm -rf` 会把前一份正在用的家目录删掉 → E4 报「家目录不存在」，
 * 看起来像代码坏了，其实是**测试自己打架**。
 * 让系统分配（bind 0）再释放，是唯一不靠约定就正确的做法。
 */
async function freePort() {
  const net = await import("node:net");
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const APP = process.env.APP_URL ?? "http://127.0.0.1:5178";
const API = process.env.API ?? "http://127.0.0.1:43133";
const HOME = process.env.E2E_HOME ?? join(tmpdir(), "lifeos-e2e-home");
/** 临时后端端口：env 显式指定优先，否则每次运行现取一个空闲端口（见 `freePort`）。 */
const TEMP_PORT = process.env.E2E_PORT === undefined ? undefined : Number(process.env.E2E_PORT);

const PLAYWRIGHT = [
  process.env.PLAYWRIGHT_CORE,
  join(homedir(), ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.js"),
].filter(Boolean).find((p) => p !== undefined && existsSync(p));
const CHROME = process.env.CHROME ?? join(homedir(), "Library/Caches/ms-playwright/chromium-1179/chrome-mac/Chromium.app/Contents/MacOS/Chromium");

const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok, detail }); };

/** 找一个真实的 Task 目录（有 worktree 的那个），返回 taskDir + taskId */
async function findTask() {
  const { stdout } = await run("find", [join(HOME, "agents"), "-type", "d", "-path", "*/evidence/worktree", "-maxdepth", "8"]);
  const worktree = stdout.split("\n").filter(Boolean)[0];
  if (worktree === undefined) throw new Error(`在 ${HOME} 下找不到 evidence/worktree，先用开发实例造点数据`);
  const taskDir = dirname(dirname(worktree));
  const taskId = (/^(\d{4})/.exec(taskDir.split("/").pop() ?? "") ?? [])[1] ?? "0001";
  return { taskDir: worktree.replace(/\/evidence\/worktree$/, ""), taskId, worktree };
}

const commentsOf = async (api, taskDir) => {
  const r = await fetch(`${api}/api/review/comments?taskDir=${encodeURIComponent(taskDir)}`);
  if (!r.ok) return null;
  return ((await r.json()).items ?? []);
};

const write = async (api, taskDir, taskId, author, body, start = 3) => {
  const r = await fetch(`${api}/api/review/comments`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({
      taskDir, op: "add",
      comment: { taskId, author, anchor: { source: "worktree", path: "README.md", side: "new", start, end: start }, body, marks: ["query"], state: "open" },
    }),
  });
  return r.status;
};

/**
 * 打开检视面板并**全部展开**。
 * 为什么必须展开：文件数 > 5 时卡片默认折叠，而头像针渲染在 diff 行末 → 折叠时 DOM 里没有针。
 * 这不是实现问题，是"评论针只在可见行上"的既定设计（S4-a 的折叠形态）。
 */
async function openAndExpand(page) {
  await page.getByRole("button", { name: "检视当前 Task 的改动" }).first().click();
  await page.waitForTimeout(2500);
  const toggle = page.locator("[data-review-toggle-all]").first();
  if ((await toggle.count()) > 0 && (await toggle.getAttribute("aria-pressed")) !== "true") {
    await toggle.click();
    await page.waitForTimeout(1200);
  }
  // 等评论从服务端回来（store 是异步的）
  for (let i = 0; i < 40; i++) {
    if ((await page.locator("[data-review-pin]").count()) > 0) break;
    await page.waitForTimeout(150);
  }
}

const mod = await import(PLAYWRIGHT);
const pw = mod.default ?? mod;

if (!existsSync(CHROME)) throw new Error(`找不到 chromium：${CHROME}`);
const browser = await pw.chromium.launch({ executablePath: CHROME });

/**
 * 独占锁：这个脚本在开头 `op:"clear"` 清空该 Task 的评论，所以**同一时刻只能有一份在跑**。
 *
 * 为什么必须显式拦（2026-11-08 实测）：两份并发时，B 的 clear 会删掉 A 刚写的线程，
 * A 那边的断言接着就是 404/replies=0 —— 一堆"看起来像产品缺陷"的假红，
 * 排查半小时才发现是测试自己打架。宁可**直接拒绝启动**并说清怎么办。
 */
const lockPath = join(tmpdir(), `lifeos-e2e-review-${Buffer.from(HOME).toString("hex").slice(0, 24)}.lock`);
try {
  await writeFile(lockPath, String(process.pid), { flag: "wx" });
} catch {
  const holder = await readFile(lockPath, "utf8").catch(() => "");
  console.error(`这个家目录上已有一份 e2e 在跑（pid ${holder.trim() || "?"}，锁 ${lockPath}）。`);
  console.error("本脚本会清空该 Task 的评论，不能并发。等它跑完；若确认没有在跑，删掉上面的锁文件再试。");
  process.exit(2);
}
process.on("exit", () => { try { rmSync(lockPath, { force: true }); } catch { /* 已经不在 */ } });

try {
  const { taskDir, taskId } = await findTask();
  console.log(`检视对象：${taskDir}（task ${taskId}）`);

  // 清场
  await fetch(`${API}/api/review/comments`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ taskDir, op: "clear" }),
  });

  // ── E1 写一条 → 刷新 → 还在 ─────────────────────────────────────────────
  {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    await page.goto(APP, { waitUntil: "domcontentloaded", timeout: 40000 });
    await page.waitForTimeout(2500);
    await openAndExpand(page);
    // 用 API 写（等价于界面写完），再刷新看界面能否渲染
    const status = await write(API, taskDir, taskId, { kind: "user", id: "xu-later" }, "E1 一条");
    check("E1 写入返回 201", status === 201, String(status));
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2500);
    await openAndExpand(page);
    const pins = await page.locator("[data-review-pin]").count();
    check("E1 刷新后评论仍在界面里（行末头像针）", pins >= 1, `${pins} 个针`);

    // ── E2 清 localStorage → 刷新 → 还在（核心验收）────────────────────
    await page.evaluate(() => localStorage.clear());
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2500);
    await openAndExpand(page);
    const pins2 = await page.locator("[data-review-pin]").count();
    const ls = await page.evaluate(() => localStorage.getItem("lifeos.reviewDrafts"));
    check("E2 清空 localStorage 后评论仍在（本地存储做不到）", pins2 >= 1, `${pins2} 个针`);
    check("E2 此时 localStorage 确实是空的（证明不是本地数据在撑）", ls === null, String(ls).slice(0, 40));
    await context.close();
  }

  // ── E3 新浏览器上下文（无痕）→ 还在 ────────────────────────────────────
  {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    await page.goto(APP, { waitUntil: "domcontentloaded", timeout: 40000 });
    await page.waitForTimeout(2500);
    await openAndExpand(page);
    const pins = await page.locator("[data-review-pin]").count();
    check("E3 全新浏览器上下文（无痕）仍能看到", pins >= 1, `${pins} 个针`);
    await context.close();
  }

  // ── E6 Agent 身份写一条 → 界面显示作者是 agent ─────────────────────────
  {
    const status = await write(API, taskDir, taskId, { kind: "agent", id: "coder" }, "E6 Agent 的意见", 5);
    check("E6 Agent 写入返回 201", status === 201, String(status));
    const all = await commentsOf(API, taskDir);
    const agentOne = (all ?? []).find((c) => c.author?.kind === "agent");
    check("E6 服务端记录了 agent 作者（id 而非名字）", agentOne?.author?.id === "coder", JSON.stringify(agentOne?.author));
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    await page.goto(APP, { waitUntil: "domcontentloaded", timeout: 40000 });
    await page.waitForTimeout(2500);
    await openAndExpand(page);
    const authors = await page.locator("[data-review-pin]").evaluateAll((els) => els.map((e) => e.getAttribute("data-review-pin-author")));
    check("E6 界面上能分辨 agent 与 user", authors.some((a) => (a ?? "").startsWith("agent:")) && authors.some((a) => (a ?? "").startsWith("user:")), JSON.stringify(authors));
    await context.close();
  }

  // ── E5 切 Task 再切回 → 只看到本 Task 的 ───────────────────────────────
  {
    const other = `${taskDir}-other`;
    await write(API, other, `${taskId}-other`, { kind: "user", id: "xu-later" }, "另一个 Task 的");
    const mine = await commentsOf(API, taskDir);
    const theirs = await commentsOf(API, other);
    check("E5 两个 Task 的评论互不可见", (mine ?? []).every((c) => c.body !== "另一个 Task 的") && (theirs ?? []).length === 1,
      `mine=${(mine ?? []).length} theirs=${(theirs ?? []).length}`);
    await fetch(`${API}/api/review/comments`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ taskDir: other, op: "clear" }) });
  }

  // ── E4 重启后端（独立端口 + 家目录副本）→ 还在 ─────────────────────────
  {
    const before = await commentsOf(API, taskDir);
    check("E4 重启前服务端有评论", (before ?? []).length >= 2, `${(before ?? []).length} 条`);

    /**
     * 独立后端起在**家目录副本**上（E4 的要点：换进程后评论还在 = 真落盘）。
     *
     * 四条实测得到的经验（都不是猜的）：
     *  1. 用 `sh -c "… & echo $! > pidfile"` + 输出重定向到文件，不用 `spawn(stdio:"pipe")`
     *     —— 后者在同时跑 Playwright 的父进程里子进程会静默死、拿不到任何输出。
     *  2. 端口用 `bind 0` 现取，副本目录与日志带 pid：否则并发两份脚本会互相 `rm -rf`。
     *  3. **最多试两次**：机器 load 6~7、120+ node 进程时，`--experimental-strip-types` 冷启动
     *     可能 60 秒都起不来（同一份代码 load<2 时 1.5~2.5 秒就绪）。E4 验的是"重启后评论还在"，
     *     不该因为机器忙而红；重试能拿到一个干净进程（比放大单个超时更可靠）。
     *  4. 断言 detail 带**实测耗时与试了几次**：下次一眼分清"代码坏了"还是"机器忙"。
     */
    const bootOnce = async (attempt) => {
      const port = TEMP_PORT ?? await freePort();
      const copy = `${HOME}-restart-${process.pid}-${attempt}`;
      const logPath = join(tmpdir(), `lifeos-e4-${process.pid}-${attempt}.log`);
      const pidPath = join(tmpdir(), `lifeos-e4-${process.pid}-${attempt}.pid`);
      await rm(copy, { recursive: true, force: true });
      await rm(logPath, { force: true });
      await rm(pidPath, { force: true });
      await cp(HOME, copy, { recursive: true });

      let shOut = "";
      try {
        const r = await run("/bin/sh", ["-c",
          `LIFEOS_HOME="${copy}" node --experimental-strip-types src/main.ts --port=${port} > "${logPath}" 2>&1 & echo $! > "${pidPath}"`],
          { cwd: ROOT, env: { ...process.env } });
        shOut = `stdout=${r.stdout.trim()} stderr=${r.stderr.trim()}`;
      } catch (error) {
        shOut = `sh 失败：${String(error).slice(0, 200)}`;
      }

      let up = false;
      let waitedMs = 0;
      for (let i = 0; i < 120; i += 1) {
        await new Promise((r) => setTimeout(r, 500));
        waitedMs += 500;
        try {
          const r = await fetch(`http://127.0.0.1:${port}/api/agents`);
          if (r.ok) { up = true; break; }
        } catch { /* 还在起 */ }
      }
      const childLog = await readFile(logPath, "utf8").catch(() => "");
      const childPid = Number((await readFile(pidPath, "utf8").catch(() => "")).trim()) || undefined;
      const cleanup = async () => {
        if (childPid !== undefined) { try { process.kill(childPid, "SIGKILL"); } catch { /* 已退出 */ } }
        await rm(copy, { recursive: true, force: true });
        await rm(logPath, { force: true });
        await rm(pidPath, { force: true });
      };
      return { up, port, waitedMs, shOut, childLog, cleanup };
    };

    let boot = await bootOnce(1);
    let attempts = 1;
    if (!boot.up) {
      await boot.cleanup();
      boot = await bootOnce(2);
      attempts = 2;
    }

    check("E4 临时后端启动成功（独立端口 + 家目录副本）", boot.up,
      `port ${boot.port} 用时 ${(boot.waitedMs / 1000).toFixed(1)}s（试了 ${attempts} 次）${boot.up ? "" : ` | ${boot.shOut} | 输出：${boot.childLog.slice(-300) || "(空)"}`}`);
    if (boot.up) {
      const after = await commentsOf(`http://127.0.0.1:${boot.port}`, taskDir);
      check("E4 **重启后端后评论仍在**（落盘而非内存）", (after ?? []).length === (before ?? []).length, `${(after ?? []).length} vs ${(before ?? []).length}`);
      check("E4 重启后内容一致（不只数量对）", JSON.stringify((after ?? []).map((c) => c.body).sort()) === JSON.stringify((before ?? []).map((c) => c.body).sort()), "");
    }
    await boot.cleanup();
  }

  // ── E8 闭环链路（S4-h）：用户提 → Agent 回复 → 交棒 → 用户关 → Agent 关不掉 ──
  {
    const { worktree } = await findTask();
    const taskId = (/^(\d{4})/.exec(taskDir.split("/").pop() ?? "") ?? [])[1] ?? taskDir;
    void worktree;
    // 用户提一条（纯 HTTP，无大模型）
    const created = await (await fetch(`${API}/api/review/comments`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ taskDir, op: "add", comment: {
        taskId, author: { kind: "user", id: "xu-later" },
        anchor: { source: "worktree", path: "README.md", side: "new", start: 3, end: 3 },
        body: "E8 用户提的意见", marks: ["query"], state: "open" } }),
    })).json();
    const id = created.comment?.id;
    check("E8 用户提一条评论", typeof id === "string" && id.startsWith("rc_"), String(id));

    // Agent 回复（走同一个接口；Agent 工具是同一条业务的另一个外壳）
    const replied = await (await fetch(`${API}/api/review/comments`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ taskDir, op: "reply", id, reply: { author: { kind: "agent", id: "lifeosagent" }, body: "E8 已闭环：改了 README.md:3" } }),
    })).json();
    check("E8 Agent 回复后 replies=1", (replied.comment?.replies ?? []).length === 1, JSON.stringify(replied.comment?.replies));
    check("E8 Agent 回复后交棒给用户（awaiting=user）", replied.comment?.awaiting === "user", String(replied.comment?.awaiting));

    // Agent 关不掉用户的评论（403）
    const forbidden = await fetch(`${API}/api/review/comments`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ taskDir, op: "state", id, state: "resolved", by: { kind: "agent", id: "lifeosagent" } }),
    });
    check("E8 Agent 关不掉用户的评论（403）", forbidden.status === 403, String(forbidden.status));

    // 用户关闭
    const closed = await (await fetch(`${API}/api/review/comments`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ taskDir, op: "state", id, state: "resolved", by: { kind: "user", id: "xu-later" } }),
    })).json();
    check("E8 用户关闭成功且记录关闭人", closed.comment?.state === "resolved" && closed.comment?.resolvedBy?.kind === "user", JSON.stringify({ s: closed.comment?.state, by: closed.comment?.resolvedBy }));

    // 关闭后不能再回复（先重开）
    const closedReply = await fetch(`${API}/api/review/comments`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ taskDir, op: "reply", id, reply: { author: { kind: "agent", id: "lifeosagent" }, body: "E8 关闭后还想说" } }),
    });
    check("E8 已关闭的线程不能回复（403）", closedReply.status === 403, String(closedReply.status));

    // 界面侧：刷新后这条已关闭的默认不渲染（G7），但数据还在
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1500);
    const stillThere = (await commentsOf(API, taskDir)).some((c) => c.id === id && c.state === "resolved");
    check("E8 关闭后评论数据仍在（只是界面默认收起）", stillThere);
  }

  // ── E7 worktree 新提交后仍在 ───────────────────────────────────────────
  {
    const { worktree } = await findTask();
    const before = (await commentsOf(API, taskDir)) ?? [];
    try {
      await run("git", ["-C", worktree, "-c", "user.email=e2e@x", "-c", "user.name=e2e", "commit", "--allow-empty", "-m", "e2e: empty commit"]);
      const after = (await commentsOf(API, taskDir)) ?? [];
      check("E7 worktree 新提交后评论仍在（不绑 commit）", after.length === before.length, `${after.length} vs ${before.length}`);
    } catch (error) {
      check("E7 worktree 新提交后评论仍在（不绑 commit）", false, `git 失败：${String(error).slice(0, 120)}`);
    }
  }
} finally {
  await browser.close();
  const failed = results.filter((r) => !r.ok);
  for (const r of results) console.log(`${r.ok ? "✔" : "✖"} ${r.name}${r.detail === "" ? "" : `  → ${r.detail}`}`);
  console.log(`\n${results.length - failed.length}/${results.length} 通过${failed.length === 0 ? "" : `；${failed.length} 项失败`}`);
  process.exit(failed.length === 0 ? 0 : 1);
}
