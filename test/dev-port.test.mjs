// T-0016 dev-port 的端口分配（任务 0016）；登记键改 `<agent>/<project>/<NNNN>`（Task 0032 · S1 契约 §4）。
//
// 为什么单测：这套逻辑决定"号从哪里来"；错了就是又一例多份实例抢同一端口（共享层案例 C160）。
// 键为什么必须带归属：协议 §3.7 说 Task ID **只在 Agent × Project 内唯一** ——
// 裸编号当键时，两个 Agent 的 0003 会撞同一组端口（本机真实存在 coder/0003 与 frontend-developer/0003）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  POOL, RESERVED, claimPorts, inPool, isReserved, listInstances, migrateRegistry, parseTaskKey, parseTaskRef,
  prune, readRegistry, releaseByTaskNumber, releasePorts, resolveRef, taskKeyOf, writeRegistry,
} from "../scripts/dev-ports-core.mjs";

const withHome = async (fn) => {
  const home = await mkdtemp(join(tmpdir(), "dev-port-"));
  try { return await fn(home); } finally { await rm(home, { recursive: true, force: true }); }
};
/** 可编程的假探测：busy 里的端口视为被占用。 */
const probeWith = (busy = []) => async (port) => !busy.includes(port);

/** 一个合法的 Task 工作区路径（协议 §3.7 形态）。 */
const worktreeOf = (agentId, projectId, taskId) =>
  `/Users/x/.lifeos/agents/${agentId}/projects/${projectId}/tasks/${taskId}-某标题/repo`;

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
  const first = await claimPorts({ home, agentId: "coder", projectId: "lifeos", taskId: "0032", worktree: "/w/a", probe });
  const second = await claimPorts({ home, agentId: "coder", projectId: "lifeos", taskId: "0033", worktree: "/w/b", probe });
  assert.deepEqual([first.backend, first.web], [43130, 5174]);
  assert.deepEqual([second.backend, second.web], [43131, 5175]);
  assert.notEqual(first.backend, second.backend);
  const registry = await readRegistry(home);
  assert.equal(registry.instances["coder/lifeos/0032"].worktree, "/w/a");
  assert.equal(registry.instances["coder/lifeos/0033"].backend, 43131);
}));

// —— 本任务的核心用例（S1 契约 §4）：两个 Agent 的同号 Task 不撞 ——
test("T0032-1 两个 Agent 的同号 Task 拿到不同端口，且各自复用自己那组", () => withHome(async (home) => {
  const probe = probeWith();
  const coder = await claimPorts({ home, agentId: "coder", projectId: "lifeos", taskId: "0003", probe });
  const frontend = await claimPorts({ home, agentId: "frontend-developer", projectId: "lifeos", taskId: "0003", probe });
  assert.notEqual(coder.backend, frontend.backend, "同号不同 Agent 必须是不同端口");
  assert.notEqual(coder.web, frontend.web, "前端端口同理");
  assert.equal(coder.key, "coder/lifeos/0003");
  assert.equal(frontend.key, "frontend-developer/lifeos/0003");

  // 各自重新 claim：复用自己那组，不会因为"另一个 Agent 的 0003 占着"而换号
  const coderAgain = await claimPorts({ home, agentId: "coder", projectId: "lifeos", taskId: "0003", probe });
  const frontendAgain = await claimPorts({ home, agentId: "frontend-developer", projectId: "lifeos", taskId: "0003", probe });
  assert.deepEqual([coderAgain.backend, coderAgain.web], [coder.backend, coder.web]);
  assert.deepEqual([frontendAgain.backend, frontendAgain.web], [frontend.backend, frontend.web]);

  // 同一 Agent 的不同项目也是不同的键（项目内编号各自从 0001 起）
  const otherProject = await claimPorts({ home, agentId: "coder", projectId: "workspace", taskId: "0003", probe });
  assert.notEqual(otherProject.key, coder.key);
  assert.notEqual(otherProject.backend, coder.backend);

  const registry = await readRegistry(home);
  assert.deepEqual(Object.keys(registry.instances).sort(), ["coder/lifeos/0003", "coder/workspace/0003", "frontend-developer/lifeos/0003"]);
}));

test("T0032-2 只给 --task 时拒绝分配（Task ID 不唯一，不许猜）", () => withHome(async (home) => {
  await assert.rejects(
    () => claimPorts({ home, taskId: "0003", probe: probeWith() }),
    /Task ID 只在 Agent × Project 内唯一/,
  );
  // 三种合法说法都落到同一个键
  assert.deepEqual(resolveRef({ key: "coder/lifeos/0032" }), { agentId: "coder", projectId: "lifeos", taskId: "0032" });
  assert.deepEqual(resolveRef({ agentId: "coder", projectId: "lifeos", taskId: "0032" }), { agentId: "coder", projectId: "lifeos", taskId: "0032" });
  assert.deepEqual(resolveRef({ worktree: worktreeOf("coder", "lifeos", "0032") }), { agentId: "coder", projectId: "lifeos", taskId: "0032" });
  assert.deepEqual(resolveRef({ worktree: "/Users/x/.lifeos/agents/a/projects/p/tasks/0016-x/evidence/worktree" }), { agentId: "a", projectId: "p", taskId: "0016" });
  // 反推不出来的路径：显式失败，不猜
  assert.throws(() => resolveRef({ worktree: "/Users/x/Code/lifeos" }), /无法确定是哪个 Task/);
}));

test("T0032-3 登记键的拼装与解析是同一个形状（含斜杠与四位数字的边界）", () => {
  assert.equal(taskKeyOf({ agentId: "coder", projectId: "lifeos", taskId: "0032" }), "coder/lifeos/0032");
  assert.deepEqual(parseTaskKey("coder/lifeos/0032"), { agentId: "coder", projectId: "lifeos", taskId: "0032" });
  assert.equal(parseTaskKey("0032"), undefined, "裸编号不是新键");
  assert.equal(parseTaskKey("coder/lifeos/32"), undefined, "编号必须四位");
  assert.equal(parseTaskKey("coder/lifeos"), undefined);
  assert.throws(() => taskKeyOf({ agentId: "coder", projectId: "a/b", taskId: "0032" }), /不能含斜杠/);
  assert.throws(() => taskKeyOf({ agentId: "", projectId: "p", taskId: "0032" }), /需要 agentId/);
  assert.throws(() => taskKeyOf({ agentId: "a", projectId: "p", taskId: "32" }), /四位数字/);
  assert.deepEqual(parseTaskRef("/x/agents/a/projects/p/tasks/0007-t/repo"), { agentId: "a", projectId: "p", taskId: "0007" });
});

test("T0032-4 存量裸编号键：能按 worktree 反推的迁移，推不出的丢弃（纯函数）", () => {
  const { registry, migrated, dropped } = migrateRegistry({
    "0003": { backend: 43132, web: 5175, worktree: worktreeOf("coder", "workspace", "0003") },
    "0030": { backend: 43133, web: 5178, worktree: worktreeOf("coder", "lifeos", "0030") },
    "0022": { backend: 43137, web: 5181, worktree: "" },
    "0020": { backend: 43131, web: 5176 },
    "coder/lifeos/0031": { backend: 43140, web: 5190, worktree: "/w/x", agentId: "coder", projectId: "lifeos", taskId: "0031" },
  });
  assert.deepEqual(Object.keys(registry.instances).sort(), ["coder/lifeos/0030", "coder/lifeos/0031", "coder/workspace/0003"]);
  assert.equal(registry.instances["coder/workspace/0003"].backend, 43132, "迁移保留端口（同一实例重启用同一组号）");
  assert.equal(registry.instances["coder/lifeos/0030"].taskId, "0030");
  assert.equal(migrated.length, 2);
  assert.deepEqual(dropped.sort(), ["0020", "0022"], "推不出归属的丢弃（权威是活进程）");
  assert.equal(registry.schemaVersion, 2);
});

test("T0032-5 读登记表时把迁移真的写回磁盘（否则下次 claim 又看到旧键）", () => withHome(async (home) => {
  await writeRegistry(home, { schemaVersion: 1, instances: {
    "0030": { backend: 43133, web: 5178, worktree: worktreeOf("coder", "lifeos", "0030") },
    "0022": { backend: 43137, web: 5181, worktree: "" },
  } });
  const registry = await readRegistry(home);
  assert.deepEqual(Object.keys(registry.instances), ["coder/lifeos/0030"]);
  const onDisk = JSON.parse(await readFile(join(home, "state", "dev-ports.json"), "utf8"));
  assert.equal(onDisk.schemaVersion, 2);
  assert.deepEqual(Object.keys(onDisk.instances), ["coder/lifeos/0030"], "迁移必须落盘");
  // 幂等：再读一次不再变（也不报错）
  assert.deepEqual(Object.keys((await readRegistry(home)).instances), ["coder/lifeos/0030"]);
}));

test("T0016-3 已被实际占用的端口跳过；已被别的 Task 登记的端口也跳过", () => withHome(async (home) => {
  const probe = probeWith([43130]);
  const first = await claimPorts({ home, agentId: "coder", projectId: "lifeos", taskId: "0016", probe });
  assert.equal(first.backend, 43131);
  // 0017：43130 实际被占、43131 被 0016 登记 → 拿到 43132
  const second = await claimPorts({ home, agentId: "coder", projectId: "lifeos", taskId: "0017", probe });
  assert.equal(second.backend, 43132);
}));

test("T0016-4 同一 Task 重新 claim 复用同一组号（重启后地址不变）", () => withHome(async (home) => {
  const probe = probeWith();
  const first = await claimPorts({ home, agentId: "coder", projectId: "lifeos", taskId: "0016", probe });
  const again = await claimPorts({ home, agentId: "coder", projectId: "lifeos", taskId: "0016", probe });
  assert.deepEqual([again.backend, again.web, again.key], [first.backend, first.web, first.key]);
}));

test("T0016-5 release 幂等：第一次 true，第二次 false，释放后号可再分配", () => withHome(async (home) => {
  const probe = probeWith();
  await claimPorts({ home, agentId: "coder", projectId: "lifeos", taskId: "0016", probe });
  assert.equal(await releasePorts({ home, agentId: "coder", projectId: "lifeos", taskId: "0016" }), true);
  assert.equal(await releasePorts({ home, agentId: "coder", projectId: "lifeos", taskId: "0016" }), false);
  const next = await claimPorts({ home, agentId: "coder", projectId: "lifeos", taskId: "0017", probe });
  assert.equal(next.backend, 43130);
}));

test("T0032-6 release 只给裸编号时，唯一匹配才释放；多条匹配报错并列出候选", () => withHome(async (home) => {
  const probe = probeWith();
  await claimPorts({ home, agentId: "coder", projectId: "lifeos", taskId: "0003", probe });
  const single = await releaseByTaskNumber({ home, taskId: "0003" });
  assert.equal(single.released, true);
  assert.equal(single.key, "coder/lifeos/0003");

  await claimPorts({ home, agentId: "coder", projectId: "lifeos", taskId: "0003", probe });
  await claimPorts({ home, agentId: "frontend-developer", projectId: "lifeos", taskId: "0003", probe });
  await assert.rejects(() => releaseByTaskNumber({ home, taskId: "0003" }), /请用 --key 指定其中一个/);
  // 报错不改登记表（不替用户挑一个）
  assert.equal(Object.keys((await readRegistry(home)).instances).length, 2);
  assert.deepEqual(await releaseByTaskNumber({ home, taskId: "9999" }), { released: false, key: undefined, candidates: [] });
}));

test("T0016-6 幽灵条目不占号：pid 已死的登记被 prune 清掉，端口可再分配（权威是活进程）", () => withHome(async (home) => {
  await writeRegistry(home, { schemaVersion: 2, instances: { "coder/lifeos/0016": { agentId: "coder", projectId: "lifeos", taskId: "0016", backend: 43130, web: 5174, worktree: "/w/a" } } });
  // 模拟"进程已死"：两个端口都空闲（能 listen）
  const dropped = await prune({ home, probe: probeWith() });
  assert.deepEqual(dropped, ["coder/lifeos/0016"]);
  assert.deepEqual(await readRegistry(home), { schemaVersion: 2, instances: {} });
}));

test("T0016-7 仍在运行的实例不被 prune 清掉", () => withHome(async (home) => {
  await claimPorts({ home, agentId: "coder", projectId: "lifeos", taskId: "0016", probe: probeWith() });
  const dropped = await prune({ home, probe: probeWith([43130]) });   // 后端还被占着 = 还活着
  assert.deepEqual(dropped, []);
  const rows = await listInstances({ home, probe: probeWith([43130]) });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].agentId, "coder");
  assert.equal(rows[0].projectId, "lifeos");
  assert.equal(rows[0].taskId, "0016");
}));

test("T0016-8 号段耗尽时显式失败，不返回越界或保留号", () => withHome(async (home) => {
  // 把 43130-43198 都登记掉，只剩 43199 可用
  const instances = {};
  for (let port = 43130; port <= 43198; port += 1) {
    instances[`a/p/${String(port).slice(-4)}`] = { agentId: "a", projectId: "p", taskId: String(port).slice(-4), backend: port, web: 5200 + (port - 43130) };
  }
  await writeRegistry(home, { schemaVersion: 2, instances });
  const result = await claimPorts({ home, agentId: "coder", projectId: "lifeos", taskId: "0016", probe: probeWith() });
  assert.equal(result.backend, 43199);
  await assert.rejects(
    () => claimPorts({ home, agentId: "coder", projectId: "lifeos", taskId: "9999", probe: probeWith() }),
    /已无空闲端口/,
  );
}));

test("T0016-9 登记表损坏时按空表处理，不崩、不误占", () => withHome(async (home) => {
  const { mkdir, writeFile } = await import("node:fs/promises");
  await mkdir(join(home, "state"), { recursive: true });
  await writeFile(join(home, "state", "dev-ports.json"), "{ 这不是 JSON", "utf8");
  assert.deepEqual(await readRegistry(home), { schemaVersion: 2, instances: {} });
  const result = await claimPorts({ home, agentId: "coder", projectId: "lifeos", taskId: "0016", probe: probeWith() });
  assert.equal(result.backend, 43130);
  // 原子写：没有残留 .tmp
  const raw = await readFile(join(home, "state", "dev-ports.json"), "utf8");
  assert.match(raw, /"coder\/lifeos\/0016"/);
}));

test("T0016-10 claim 缺归属时报错（不静默分配）", async () => {
  await assert.rejects(() => claimPorts({ home: "/tmp", taskId: "  " }), /无法确定是哪个 Task/);
  await assert.rejects(() => claimPorts({ home: "/tmp" }), /无法确定是哪个 Task/);
});

test("T0016-11 Vite 监听 [::1]（只占 IPv6）也算被占用，不能判成已停", () => withHome(async () => {
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
