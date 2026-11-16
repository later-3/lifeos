// 主实例的构建漂移检查（协议 §3.7「提交与署名」的主区边界；开发规范 §7.4）。
//
// 要解决的问题（2026-11-16 实测）：`specs/development-harness/development-harness.md:171` 写着
// **禁止**在主 worktree 执行 `pnpm build`，但这条**没有检查手段**——`dist/` 与 `frontend/dist/`
// 都在 `.gitignore`（`.gitignore:3`、`:5`），`git status` 恒为空，§7.4 那句「`git status --short`
// 显示 `src/` 有 M/?? 即为违规」看不到一次 build。
//
// 那天的真实后果：`frontend/dist` 在 10:29:14 被重建，主实例进程 10:01:44 启动 →
// 浏览器拿到新前端、后端是旧代码，老标签页 60 秒内发现 buildId 不同弹出「有新版本」提示条。
//
// 所以检查改成一个能测的事实：**进程启动时刻 vs 磁盘产物的 mtime**。
// 判定逻辑全是纯函数，方便穷举（`specs/code/backend/code.md` 2.7）。
import { execFileSync } from "node:child_process";
import { stat } from "node:fs/promises";
import { join } from "node:path";

/** 用户实例的保留后端端口（与 `scripts/dev-ports-core.mjs` 的 RESERVED.backend 同源）。 */
export const DEFAULT_PORT = 43120;

/**
 * @typedef {Object} DriftInput
 * @property {number} processStart 主实例进程的启动时刻（ms）。
 * @property {number} [backendArtifact] `dist/server.mjs` 的 mtime（ms）；读不到为 undefined。
 * @property {number} [frontendArtifact] `frontend/dist/index.html` 的 mtime（ms）；读不到为 undefined。
 *
 * @typedef {"clean" | "backend-stale" | "frontend-ahead" | "both-ahead" | "unknown"} DriftState
 * @typedef {{ state: DriftState, detail: string, next: string }} DriftVerdict
 */

/**
 * 判定主实例的构建漂移（纯函数）。
 * @param {DriftInput} input
 * @returns {DriftVerdict}
 */
export function instanceDrift(input) {
  const { processStart, backendArtifact, frontendArtifact } = input;
  if (backendArtifact === undefined && frontendArtifact === undefined) {
    return {
      state: "unknown",
      detail: "读不到构建产物（dist/server.mjs 与 frontend/dist/index.html 都不在）：这个实例可能从未构建过，或跑的不是这个目录",
      next: "确认主实例的工作目录与 --port；产物缺失不是漂移，是没构建",
    };
  }
  const backendAhead = backendArtifact !== undefined && backendArtifact > processStart;
  const frontendAhead = frontendArtifact !== undefined && frontendArtifact > processStart;

  if (backendAhead && frontendAhead) {
    return {
      state: "both-ahead",
      detail: "前后端产物都比进程新：主区在实例运行期间被构建过，内存里跑的还是旧代码",
      next: "这是 §7.4 的违规（Agent 不应在主区构建）。要么在用户同意的时间窗重建并重启，要么接受前后端错版",
    };
  }
  if (backendAhead) {
    return {
      state: "backend-stale",
      detail: "dist/server.mjs 比进程新：后端跑的是旧代码，改动要重启才生效",
      next: "需要重启主实例（由用户在同意的时间窗做）；不是缺陷，是构建没跟上重启",
    };
  }
  if (frontendAhead) {
    return {
      state: "frontend-ahead",
      detail: "frontend/dist 比进程新：浏览器会拿到新前端，而后端仍是旧代码——老标签页会发现构建版本不同并提示「有新版本」",
      next: "确认这是不是 Agent 在主区构建造成的（§7.4 禁止）；是就停下，改在 Task 工作区里构建",
    };
  }
  return {
    state: "clean",
    detail: "进程启动晚于全部构建产物：用户看到的就是磁盘上这份构建",
    next: "无需处理",
  };
}

/** 找占用某端口的进程 pid（没有就 undefined）。 */
export function pidOnPort(port) {
  try {
    const out = execFileSync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"], { encoding: "utf8" });
    const pid = Number.parseInt(out.trim().split("\n")[0] ?? "", 10);
    return Number.isInteger(pid) ? pid : undefined;
  } catch {
    return undefined;
  }
}

/** 进程启动时刻（ms）。取不到就 undefined，不猜。 */
export function processStartOf(pid) {
  try {
    // `lstart` 形如 “Mon 16 Nov 10:01:44 2026”，Date 能直接解析（本地时区）。
    const out = execFileSync("ps", ["-p", String(pid), "-o", "lstart="], { encoding: "utf8" }).trim();
    const parsed = Date.parse(out);
    return Number.isNaN(parsed) ? undefined : parsed;
  } catch {
    return undefined;
  }
}

async function mtimeOf(path) {
  const info = await stat(path).catch(() => undefined);
  return info === undefined ? undefined : Math.round(info.mtimeMs);
}

/**
 * 采集事实（工作目录 → 两个产物的 mtime）。只读，不改任何东西。
 * @param {string} repoRoot 主实例的工作目录（通常是 `/Users/<user>/Code/lifeos`）
 * @param {number} [port]
 */
export async function collectDrift(repoRoot, port = DEFAULT_PORT) {
  const pid = pidOnPort(port);
  const processStart = pid === undefined ? undefined : processStartOf(pid);
  const backendArtifact = await mtimeOf(join(repoRoot, "dist", "server.mjs"));
  const frontendArtifact = await mtimeOf(join(repoRoot, "frontend", "dist", "index.html"));
  if (pid === undefined || processStart === undefined) {
    return {
      port,
      ...(pid === undefined ? {} : { pid }),
      backendArtifact,
      frontendArtifact,
      verdict: {
        state: "unknown",
        detail: `端口 ${port} 上没有监听进程（或读不到它的启动时刻）：无法判断漂移`,
        next: "确认主实例是否在跑（`lsof -nP -iTCP:43120 -sTCP:LISTEN`）；没在跑时该检查不适用",
      },
    };
  }
  const verdict = instanceDrift({
    processStart,
    ...(backendArtifact === undefined ? {} : { backendArtifact }),
    ...(frontendArtifact === undefined ? {} : { frontendArtifact }),
  });
  return { port, pid, processStart, backendArtifact, frontendArtifact, verdict };
}
