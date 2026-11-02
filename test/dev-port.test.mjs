// T-0016 dev-port 的端口分配（任务 0016）：保留号不可分配、占用要跳过、登记要幂等、幽灵条目不占号。
// 为什么单测：这套逻辑决定"号从哪里来"；错了就是又一例三份实例抢同一端口（共享层案例 C160）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  POOL, RESERVED, claimPorts, inPool, isReserved, listInstances, prune, readRegistry, releasePorts, writeRegistry,
} from "../scripts/dev-ports-core.mjs";

const withHome = async (fn) => {
  const home = await mkdtemp(join(tmpdir(), "dev-port-"));
  try { return await fn(home); } finally { await rm(home, { recursive: true, force: true }); }
};
/** 可编程的假探测：busy 里的端口视为被占用。 */
const probeWith = (busy = []) => async (port) => !busy.includes(port);

test("T0016-1 保留号与号段：43120/5173 永不分配，43130-43199 / 5174-5199 之外不可用", () => {
  assert.deepEqual(RESERVED, { backend: [43120], web: [5173] });
  assert.equal(isReserved("backend", 43120), true);
  assert.equal(isReserved("web", 5173), true);
  assert.equal(inPool("backend", 43129), false);
  assert.equal(inPool("backend", 43130), true);
  assert.equal(inPool("backend", 43200), false);
  assert.equal(inPool("web", 5174), true);
  assert.equal(inPool("web", 5200), false);
  assert.deepEqual(POOL, { backend: [43130, 43199], web: [5174, 5199] });
});

test("T0016-2 claim 从号段起点开始，两个 Task 拿到不同端口，并写进登记表", () => withHome(async (home) => {
  const probe = probeWith();
  const first = await claimPorts({ home, taskId: "0016", worktree: "/w/a", probe });
  const second = await claimPorts({ home, taskId: "0017", worktree: "/w/b", probe });
  assert.deepEqual([first.backend, first.web], [43130, 5174]);
  assert.deepEqual([second.backend, second.web], [43131, 5175]);
  assert.notEqual(first.backend, second.backend);
  const registry = await readRegistry(home);
  assert.equal(registry.instances["0016"].worktree, "/w/a");
  assert.equal(registry.instances["0017"].backend, 43131);
}));

test("T0016-3 已被实际占用的端口跳过；已被别的 Task 登记的端口也跳过", () => withHome(async (home) => {
  const probe = probeWith([43130]);
  const first = await claimPorts({ home, taskId: "0016", probe });
  assert.equal(first.backend, 43131);
  // 0017：43130 实际被占、43131 被 0016 登记 → 拿到 43132
  const second = await claimPorts({ home, taskId: "0017", probe });
  assert.equal(second.backend, 43132);
}));

test("T0016-4 同一 Task 重新 claim 复用同一组号（重启后地址不变）", () => withHome(async (home) => {
  const probe = probeWith();
  const first = await claimPorts({ home, taskId: "0016", probe });
  const again = await claimPorts({ home, taskId: "0016", probe });
  assert.deepEqual(again, first);
}));

test("T0016-5 release 幂等：第一次 true，第二次 false，释放后号可再分配", () => withHome(async (home) => {
  const probe = probeWith();
  await claimPorts({ home, taskId: "0016", probe });
  assert.equal(await releasePorts({ home, taskId: "0016" }), true);
  assert.equal(await releasePorts({ home, taskId: "0016" }), false);
  const next = await claimPorts({ home, taskId: "0017", probe });
  assert.equal(next.backend, 43130);
}));

test("T0016-6 幽灵条目不占号：pid 已死的登记被 prune 清掉，端口可再分配（权威是活进程）", () => withHome(async (home) => {
  await writeRegistry(home, { schemaVersion: 1, instances: { "0016": { backend: 43130, web: 5174, worktree: "/w/a" } } });
  // 模拟"进程已死"：两个端口都空闲（能 listen）
  const dropped = await prune({ home, probe: probeWith() });
  assert.deepEqual(dropped, ["0016"]);
  assert.deepEqual(await readRegistry(home), { schemaVersion: 1, instances: {} });
}));

test("T0016-7 仍在运行的实例不被 prune 清掉", () => withHome(async (home) => {
  await claimPorts({ home, taskId: "0016", probe: probeWith() });
  const dropped = await prune({ home, probe: probeWith([43130]) });   // 后端还被占着 = 还活着
  assert.deepEqual(dropped, []);
  assert.equal((await listInstances({ home, probe: probeWith([43130]) })).length, 1);
}));

test("T0016-8 号段耗尽时显式失败，不返回越界或保留号", () => withHome(async (home) => {
  // 把 43130-43198 都登记掉，只剩 43199 可用
  const instances = {};
  for (let port = 43130; port <= 43198; port += 1) instances[`t${port}`] = { backend: port, web: 5200 + (port - 43130) };
  await writeRegistry(home, { schemaVersion: 1, instances });
  const result = await claimPorts({ home, taskId: "0016", probe: probeWith() });
  assert.equal(result.backend, 43199);
  await assert.rejects(() => claimPorts({ home, taskId: "9999", probe: probeWith() }), /已无空闲端口/);
}));

test("T0016-9 登记表损坏时按空表处理，不崩、不误占", () => withHome(async (home) => {
  const { mkdir, writeFile } = await import("node:fs/promises");
  await mkdir(join(home, "state"), { recursive: true });
  await writeFile(join(home, "state", "dev-ports.json"), "{ 这不是 JSON", "utf8");
  assert.deepEqual(await readRegistry(home), { schemaVersion: 1, instances: {} });
  const result = await claimPorts({ home, taskId: "0016", probe: probeWith() });
  assert.equal(result.backend, 43130);
  // 原子写：没有残留 .tmp
  const raw = await readFile(join(home, "state", "dev-ports.json"), "utf8");
  assert.match(raw, /"0016"/);
}));

test("T0016-10 claim 缺 Task 编号时报错（不静默分配）", async () => {
  await assert.rejects(() => claimPorts({ home: "/tmp", taskId: "  " }), /需要一个 Task 编号/);
});

test("T0016-11 Vite 监听 [::1]（只占 IPv6）也算被占用，不能判成已停", () => withHome(async (home) => {
  const { createServer } = await import("node:net");
  const { isPortBusy } = await import("../scripts/dev-ports-core.mjs");
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "::1", resolve));
  const port = server.address().port;
  try {
    assert.equal(await isPortBusy(port), true, "IPv6 监听必须被识别为占用");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}));

test("T0016-12 home:check 不把 evidence/ 里的外部仓库当成协作层（不产生假错误）", async () => {
  // 依据：协议 §3.7 允许 evidence/ 放克隆的项目与 worktree；它们有自己的目录结构。
  // 实测（Task 0016）：一个 worktree 曾让 home:check 报 11 处"缺少 AGENTS.md"假错误。
  const { checkHome } = await import("../src/home-check.ts");
  const { mkdir, writeFile } = await import("node:fs/promises");
  const home = await mkdtemp(join(tmpdir(), "home-check-"));
  try {
    await writeFile(join(home, "AGENTS.md"), "# 根\n", "utf8");
    const repo = join(home, "agents", "a", "projects", "p", "tasks", "0001-t", "evidence", "repos", "x", "packages", "ai", "src");
    await mkdir(repo, { recursive: true });
    await writeFile(join(home, "agents", "a", "projects", "p", "tasks", "0001-t", "evidence", "AGENTS.md"), "# evidence\n", "utf8");
    const report = await checkHome(home);
    const falseErrors = report.errors.filter((line) => line.includes("evidence/repos"));
    assert.deepEqual(falseErrors, [], "evidence/ 内部不应被要求 AGENTS.md");
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
