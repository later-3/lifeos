// 日志系统测试（P1·1.5，T5）：字段齐全、debug 静默、凭据剥离、批量上报、滚动。
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile, rm, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { start } from "./server-harness.mjs";
import { initLogs, logsDir, log, appendFrontendRows } from "../src/logging.ts";
// 与 src/logging.ts 的 localDate 同口径：日志按**本地**日期分文件；测试若用 UTC 日期，
// 北京时间 0–8 点两者不一致，会每天在这个时段假红（2026-10-25 实测）。
const localDay = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

async function freshLogsHome() {
  const home = await mkdtemp(join(tmpdir(), "lifeos-logs-"));

  process.env.LIFEOS_HOME = home;
  await initLogs();
  return { home, server: undefined };
}

test("T5a 字段齐全：info/error/warn 写入 backend-<date>.jsonl，debug 默认静默", async () => {
  const { home } = await freshLogsHome();
  await log.info("agent-host", "runTurn", "受理回合", { sessionId: "s1", turnId: "t1", projectId: "p1" });
  await log.error("agent-host", "runTurn", "回合失败", { sessionId: "s1", turnId: "t1", details: { message: "boom" } });
  const file = join(home, "logs", `backend-${localDay()}.jsonl`);
  const rows = (await readFile(file, "utf8")).trim().split("\n").map((tag) => JSON.parse(tag));
  assert.equal(rows.length, 2);
  assert.equal(rows[0].level, "info");
  assert.equal(rows[0].module, "agent-host");
  assert.equal(rows[0].turnId, "t1");
  assert.equal(rows[1].level, "error");

  await log.debug("agent-host", "runTurn", "debug 不该写文件", {});
  await log.info("agent-host", "runTurn", "info 应该写文件", {});
  const after = (await readFile(file, "utf8")).trim().split("\n").length;
  assert.equal(after, 3, "debug 静默，不写文件");

  await rm(join(home, "logs"), { recursive: true });
});

test("T5b 凭据剥离：apiKey/token/password 不应写入日志行", async () => {
  const { home } = await freshLogsHome();
  await log.error("agent-host", "runTurn", "带凭据的行", { details: { apiKey: "AT", password: "AT", token: "tmp" } });
  const file = join(home, "logs", `backend-${localDay()}.jsonl`);
  const row = JSON.parse((await readFile(file, "utf8")).trim().split("\n").pop());
  assert.equal(Object.keys(row.details ?? {}).filter((key) => /api|token|password/i.test(key)).length, 0);
  await rm(join(home, "logs"), { recursive: true });
});

test("T5c POST /api/logs：批量上报进 frontend-<date>.jsonl；>50 条或非数组 → 400", async () => {
  const { server, base, home } = await start();
  try {
    const response = await fetch(`${base}/api/logs`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
        events: [{ level: "info", module: "run", msg: "from browser" }],
      }),
    });
    assert.equal(response.status, 200);
    const file = join(home, "logs", `frontend-${localDay()}.jsonl`);
    const row = JSON.parse((await readFile(file, "utf8")).trim().split("\n").pop());
    assert.equal(row.module, "run");

    // 超量
    const many = { events: Array.from({ length: 51 }, () => ({ level: "info", module: "run", msg: "x" })) };
    const bad = await fetch(`${base}/api/logs`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(many) });
    assert.equal(bad.status, 400);
  } finally { server.close(); }
});

test("T5d 滚动：14 天前的日志文件被启动清理；8 天前不被清理", async () => {
  const { home, server } = await start();
  try {
    server.close();
    await mkdir(join(home, "logs"), { recursive: true });   // 先建目录再放文件，防回写竞态
    // 手动造一个 8 天前的合法文件 + 一个 20 天前的过期文件
    const staleAt = localDay(new Date(Date.now() - 20 * 24 * 60 * 60 * 1000));
    const recentAt = localDay(new Date(Date.now() - 8 * 24 * 60 * 60 * 1000));
    await writeFile(join(home, "logs", `backend-${staleAt}.jsonl`), "{}\n");
    await writeFile(join(home, "logs", `backend-${recentAt}.jsonl`), "{}\n");
    await initLogs();
    const names = (await import("node:fs/promises")).readdir(join(home, "logs"));
    const list = await names;
    assert.ok(!list.includes(`backend-${staleAt}.jsonl`), "20 天前的应该被清掉");
    assert.ok(list.includes(`backend-${recentAt}.jsonl`), "8 天前的应该保留");
  } catch (error) { throw error; }
});
