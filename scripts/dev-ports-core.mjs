// 开发实例的端口分配与登记（Task 0016；登记键见 Task 0032 · S1 契约 §4）。
// 为什么要有它：条文曾经把端口写死成 43130/5174，所有 Agent 照抄同一个号 → 同一台机器第二个实例必然撞车，
// supervisor 每秒 EADDRINUSE 崩溃重启、日志涨到 91 万行（共享层案例 C160）。
// 职责只有一件：把"号从哪里来"从人的记忆变成一次可登记、可复查的分配。
// 权威是活进程探测（真的能 listen 才算空闲）；登记表只回答"这个号属于哪个 Task"。
//
// ## 登记键为什么是 `<agentId>/<projectId>/<NNNN>`
//
// 协议 §3.7：Task ID **只在 Agent × Project 内唯一**。原来用裸编号当键（`instances["0003"]`），
// 于是两个 Agent 的同号 Task 会撞同一组端口 —— 这不是理论问题：同一台机器上 coder 的 0003 与
// frontend-developer 的 0003 都是 2026-11 里真实存在的 Task。
// 新键与协议 §3.7 的**分支名**同构（`dev/<agent>/<project>/<NNNN>`），一眼能对上。
import { createServer } from "node:net";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

/** 保留号：用户实例所有，任何开发实例都不得占用（Task 0016 D2）。 */
export const RESERVED = { backend: [43120], web: [5173] };
/** 可分配号段（含两端）。 */
export const POOL = { backend: [43130, 43199], web: [5174, 5199] };

export const isReserved = (kind, port) => RESERVED[kind].includes(port);
export const inPool = (kind, port) => {
  const [lo, hi] = POOL[kind];
  return Number.isInteger(port) && port >= lo && port <= hi;
};

/** 真的能 listen 才算空闲：不靠 ps、不靠猜，PID 复用也不会骗人。 */
export function isPortFree(port, host = "127.0.0.1") {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => server.close(() => resolve(true)));
    server.listen(port, host);
  });
}

/**
 * 端口是否已被占用。**IPv4 与 IPv6 都要探**：Vite 默认监听 `[::1]`，
 * 只探 127.0.0.1 会把活着的实例判成"已停"（Task 0016 演练实测踩到）。
 */
export async function isPortBusy(port) {
  const [v4free, v6free] = await Promise.all([
    isPortFree(port, "127.0.0.1"),
    isPortFree(port, "::1").catch(() => true),
  ]);
  return !(v4free && v6free);
}

// ——————————————————————————————————————————————————————————————
// 登记键
// ——————————————————————————————————————————————————————————————

const TASK_ID = /^\d{4}$/;

/**
 * 登记键 = `<agentId>/<projectId>/<NNNN>`。**只有这一处拼接**（读、写、迁移、CLI 全用它），
 * 否则某一条路径写成 `agent:project:task` 就会出现"同一实例两个键"，那正是本任务要消灭的撞号。
 */
export function taskKeyOf({ agentId, projectId, taskId }) {
  for (const [name, value] of [["agentId", agentId], ["projectId", projectId], ["taskId", taskId]]) {
    if (typeof value !== "string" || value.trim() === "") throw new Error(`登记键需要 ${name}`);
  }
  if (!TASK_ID.test(taskId)) throw new Error(`Task 编号必须是四位数字：${taskId}`);
  if (agentId.includes("/") || projectId.includes("/")) throw new Error("agentId / projectId 不能含斜杠");
  return `${agentId}/${projectId}/${taskId}`;
}

/** 登记键 → 三段（形状不对返回 undefined，**不猜**）。 */
export function parseTaskKey(key) {
  if (typeof key !== "string") return undefined;
  const parts = key.split("/");
  if (parts.length !== 3) return undefined;
  const [agentId, projectId, taskId] = parts;
  if (agentId === "" || projectId === "" || !TASK_ID.test(taskId ?? "")) return undefined;
  return { agentId, projectId, taskId };
}

/**
 * 从 worktree 路径反推归属：`…/agents/<a>/projects/<p>/tasks/<NNNN>-<标题>/(repo|evidence/…)`。
 *
 * 两种合法形态（协议 §3.7）：建 Task 自动建的 `repo/`，与 2026-11 之前历史 Task 的 `evidence/worktree`。
 * 反推不出来就返回 undefined —— 迁移时**丢弃**这条登记（登记表只是"这张纸"，权威是活进程）。
 */
export function parseTaskRef(worktree) {
  const match = /\/agents\/([^/]+)\/projects\/([^/]+)\/tasks\/(\d{4})-/.exec(worktree ?? "");
  if (match === null) return undefined;
  return { agentId: match[1], projectId: match[2], taskId: match[3] };
}

const statePath = (home) => join(home, "state", "dev-ports.json");
const empty = () => ({ schemaVersion: 2, instances: {} });

/**
 * 存量迁移（一次性，幂等）：裸编号键 → 新键。
 *
 * - 能按 `worktree` 路径反推归属的 → 换成新键，**端口不变**（同一实例重启用同一组号是这套工具的核心好处）；
 * - 反推不出的（`0020`/`0022` 的 worktree 是空串）→ 丢弃。
 *
 * 返回 `{registry, migrated, dropped}`，纯函数（不读不写盘），便于穷举测试。
 */
export function migrateRegistry(instances) {
  const out = {};
  const migrated = [];
  const dropped = [];
  for (const [key, entry] of Object.entries(instances ?? {})) {
    const parsed = parseTaskKey(key);
    if (parsed !== undefined) {
      out[key] = { ...entry, ...parsed };
      continue;
    }
    if (!TASK_ID.test(key)) { dropped.push(key); continue; }   // 不是 Task 编号也不是新键：无法归属
    const ref = parseTaskRef(entry?.worktree);
    if (ref === undefined) { dropped.push(key); continue; }
    out[taskKeyOf(ref)] = { ...entry, ...ref };
    migrated.push(`${key} → ${taskKeyOf(ref)}`);
  }
  return { registry: { schemaVersion: 2, instances: out }, migrated, dropped };
}

/**
 * 读登记表。**读到存量裸编号键时顺手写回一次**（`persist` 默认开）：
 * 迁移必须真的落地，否则下次 `claim` 又看到旧键、两边各算一半。
 * 写是原子的（tmp + rename）且幂等（已经是新键时不再写），所以放在读路径上不会制造并发问题。
 */
export async function readRegistry(home, { persist = true } = {}) {
  let data;
  try {
    data = JSON.parse(await readFile(statePath(home), "utf8"));
  } catch {
    return empty();
  }
  if (data === null || typeof data !== "object" || typeof data.instances !== "object" || data.instances === null) return empty();
  const { registry, migrated } = migrateRegistry(data.instances);
  if (migrated.length > 0 && persist) await writeRegistry(home, registry);
  return registry;
}

/** 原子写：先写临时文件再 rename，避免并发 claim 读到半个文件。 */
export async function writeRegistry(home, registry) {
  const path = statePath(home);
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, `${JSON.stringify(registry, null, 2)}\n`, "utf8");
  await rename(tmp, path);
}

/**
 * 解析"要操作哪个实例"（claim / release 共用）。
 *
 * 三种说法，**都只落到一个键**：
 *  1. `key` 直接给（`<agent>/<project>/<NNNN>`）；
 *  2. `agentId` + `projectId` + `taskId`；
 *  3. 只给 `worktree`（自动反推；CLI 最省事的用法）。
 * 缺项就给可行动的报错，不猜（猜错的代价是操作到别的 Task 的端口上）。
 */
export function resolveRef({ key, agentId, projectId, taskId, worktree }) {
  if (typeof key === "string" && key.trim() !== "") {
    const parsed = parseTaskKey(key.trim());
    if (parsed === undefined) throw new Error(`--key 的形状应是 <agent>/<project>/<NNNN>：${key}`);
    return parsed;
  }
  if (typeof taskId === "string" && taskId.trim() !== "") {
    if (typeof agentId !== "string" || agentId.trim() === "" || typeof projectId !== "string" || projectId.trim() === "") {
      throw new Error(
        "只给 --task 不够：Task ID 只在 Agent × Project 内唯一（协议 §3.7）。"
        + "请同时给 --agent 与 --project，或只给 --worktree 让工具从路径反推。",
      );
    }
    return { agentId: agentId.trim(), projectId: projectId.trim(), taskId: taskId.trim() };
  }
  const inferred = parseTaskRef(worktree ?? "");
  if (inferred !== undefined) return inferred;
  throw new Error("无法确定是哪个 Task：给 --worktree <Task 工作区路径>，或 --agent/--project/--task 三项");
}

// ——————————————————————————————————————————————————————————————
// 分配 / 释放 / 清理 / 列表
// ——————————————————————————————————————————————————————————————

/**
 * 分配一组端口。已有登记且仍空闲 → 复用（同一 Task 重启用同一组号，便于记地址）。
 * 已被别的实例登记或实际占用 → 跳过。保留号永不分配。
 */
export async function claimPorts({ home, key, agentId, projectId, taskId, worktree = "", now = new Date().toISOString(), probe = isPortFree }) {
  const ref = resolveRef({ key, agentId, projectId, taskId, worktree });
  const target = taskKeyOf(ref);
  const registry = await readRegistry(home);
  const previous = registry.instances[target];
  // "别人占的号"= 所有别的键下的端口。**不同 Agent 的同号 Task 是不同键**，所以不会互相排斥。
  const mine = new Set(Object.entries(registry.instances).filter(([id]) => id !== target).flatMap(([, e]) => [e.backend, e.web]));

  const pick = async (kind) => {
    const reuse = previous?.[kind];
    if (inPool(kind, reuse) && !mine.has(reuse) && await probe(reuse)) return reuse;
    const [lo, hi] = POOL[kind];
    for (let port = lo; port <= hi; port += 1) {
      if (isReserved(kind, port) || mine.has(port)) continue;
      if (await probe(port)) return port;
    }
    throw new Error(`${kind} 号段 ${lo}-${hi} 已无空闲端口`);
  };

  const backend = await pick("backend");
  const web = await pick("web");
  registry.instances[target] = { ...ref, backend, web, worktree, updatedAt: now };
  await writeRegistry(home, registry);
  return { key: target, ...ref, backend, web, worktree };
}

/** 只释放登记，不杀进程（杀进程用 `pnpm stop --port=`）。 */
export async function releasePorts({ home, key, agentId, projectId, taskId, worktree }) {
  const ref = resolveRef({ key, agentId, projectId, taskId, worktree });
  const target = taskKeyOf(ref);
  const registry = await readRegistry(home);
  const existed = target in registry.instances;
  delete registry.instances[target];
  await writeRegistry(home, registry);
  return existed;
}

/**
 * 按裸 Task 编号释放：登记表里**恰好一条**匹配时才释放（唯一命中不算猜），
 * 0 条或多条都报错并列出候选 —— 两个 Agent 的同号 Task 同时存在时，替他挑一个就是撞号事故的开始。
 */
export async function releaseByTaskNumber({ home, taskId }) {
  if (!TASK_ID.test(taskId ?? "")) throw new Error(`Task 编号必须是四位数字：${taskId}`);
  const registry = await readRegistry(home);
  const matches = Object.entries(registry.instances).filter(([id, entry]) => (entry?.taskId ?? parseTaskKey(id)?.taskId) === taskId);
  if (matches.length === 0) return { released: false, key: undefined, candidates: [] };
  if (matches.length > 1) {
    const candidates = matches.map(([id]) => id);
    throw new Error(`${taskId} 有 ${candidates.length} 个实例（不同 Agent × Project）：请用 --key 指定其中一个 —— ${candidates.join(" , ")}`);
  }
  const [target] = matches[0];
  delete registry.instances[target];
  await writeRegistry(home, registry);
  return { released: true, key: target, candidates: [target] };
}

/** 清理 pid 已死/端口已空的幽灵条目：登记表不占号，权威永远是活进程。 */
export async function prune({ home, probe = isPortFree }) {
  const registry = await readRegistry(home);
  const dropped = [];
  for (const [key, entry] of Object.entries(registry.instances)) {
    const alive = !(await probe(entry.backend)) || !(await probe(entry.web));
    if (!alive) { delete registry.instances[key]; dropped.push(key); }
  }
  if (dropped.length > 0) await writeRegistry(home, registry);
  return dropped;
}

/** 表格：一眼看出所有实例的 task / worktree / home / 端口 / 是否活着。 */
export async function listInstances({ home, probe = isPortFree }) {
  const registry = await readRegistry(home);
  const rows = [];
  for (const [key, entry] of Object.entries(registry.instances)) {
    const ref = parseTaskKey(key) ?? {};
    rows.push({
      key,
      taskId: ref.taskId ?? "—",
      agentId: ref.agentId ?? "—",
      projectId: ref.projectId ?? "—",
      worktree: entry.worktree || "—",
      backend: entry.backend,
      web: entry.web,
      backendAlive: !(await probe(entry.backend)),
      webAlive: !(await probe(entry.web)),
      updatedAt: entry.updatedAt ?? "—",
    });
  }
  return rows;
}
