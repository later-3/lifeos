// 开发实例的端口分配与登记（Task 0016）。
// 为什么要有它：条文曾经把端口写死成 43130/5174，所有 Agent 照抄同一个号 → 同一台机器第二个实例必然撞车，
// supervisor 每秒 EADDRINUSE 崩溃重启、日志涨到 91 万行（共享层案例 C160）。
// 职责只有一件：把"号从哪里来"从人的记忆变成一次可登记、可复查的分配。
// 权威是活进程探测（真的能 listen 才算空闲）；登记表只回答"这个号属于哪个 Task"。
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

const statePath = (home) => join(home, "state", "dev-ports.json");
const empty = () => ({ schemaVersion: 1, instances: {} });

export async function readRegistry(home) {
  try {
    const data = JSON.parse(await readFile(statePath(home), "utf8"));
    if (data === null || typeof data !== "object" || typeof data.instances !== "object" || data.instances === null) return empty();
    return { schemaVersion: 1, instances: data.instances };
  } catch {
    return empty();
  }
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
 * 分配一组端口。已有登记且仍空闲 → 复用（同一 Task 重启用同一组号，便于记地址）。
 * 已被别的实例登记或实际占用 → 跳过。保留号永不分配。
 */
export async function claimPorts({ home, taskId, worktree = "", now = new Date().toISOString(), probe = isPortFree }) {
  if (typeof taskId !== "string" || taskId.trim() === "") throw new Error("claim 需要一个 Task 编号");
  const registry = await readRegistry(home);
  const previous = registry.instances[taskId];
  const mine = new Set(Object.entries(registry.instances).filter(([id]) => id !== taskId).flatMap(([, e]) => [e.backend, e.web]));

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
  registry.instances[taskId] = { backend, web, worktree, updatedAt: now };
  await writeRegistry(home, registry);
  return { backend, web, worktree };
}

/** 只释放登记，不杀进程（杀进程用 `pnpm stop --port=`）。 */
export async function releasePorts({ home, taskId }) {
  const registry = await readRegistry(home);
  const existed = taskId in registry.instances;
  delete registry.instances[taskId];
  await writeRegistry(home, registry);
  return existed;
}

/** 清理 pid 已死/端口已空的幽灵条目：登记表不占号，权威永远是活进程。 */
export async function prune({ home, probe = isPortFree }) {
  const registry = await readRegistry(home);
  const dropped = [];
  for (const [taskId, entry] of Object.entries(registry.instances)) {
    const alive = !(await probe(entry.backend)) || !(await probe(entry.web));
    if (!alive) { delete registry.instances[taskId]; dropped.push(taskId); }
  }
  if (dropped.length > 0) await writeRegistry(home, registry);
  return dropped;
}

/** 表格：一眼看出所有实例的 task / worktree / home / 端口 / 是否活着。 */
export async function listInstances({ home, probe = isPortFree }) {
  const registry = await readRegistry(home);
  const rows = [];
  for (const [taskId, entry] of Object.entries(registry.instances)) {
    rows.push({
      taskId,
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
