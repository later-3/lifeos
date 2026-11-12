// supervisor 的启动自检（任务 0016）：把"实例隔离"从靠人记条文变成启动即拒绝。
// 依据：2026-11-02 三份实例照条文用同一个 43130，每秒 EADDRINUSE 崩溃重启、日志涨到 91 万行（案例 C160）。
// 纯函数 + 可注入探测，便于穷举测试；node:net 的实测在 dev-supervisor.mjs 里注入。
export const RESERVED_BACKEND = 43120;
export const DEFAULT_LOG = "/tmp/lifeos-dev-supervisor.log";

/**
 * 启动者是谁：用户自己手敲终端，还是 Agent 起的 shell。
 *
 * 为什么需要它（2026-11-03）：初版自检不区分启动者，结果**拦住了用户自己**
 * 用 `pnpm dev:all` 起主实例（报"保留号/用户家目录/主 worktree"等 7 条），
 * 而真正该拦的 Agent 改主 worktree 却完全没被碰到。判据是 Pi 在 shell 里
 * 注入的 `PI_*` 环境变量：用户手敲的终端没有，Agent 的命令一律有。
 */
export function launchKind(env = process.env) {
  const keys = Object.keys(env);
  if (keys.some((key) => key === "PI_CODING_AGENT" || key === "PI_SESSION_ID" || key === "PI_SESSION_FILE")) return "agent";
  return keys.some((key) => key.startsWith("PI_")) ? "agent" : "user";
}

/**
 * **用户实例**（用户手敲终端起的）：主 worktree + 用户家目录 + 43120/5173 都合法，
 * 一条隔离检查都不该跑。这里只回答"能不能起"，永远能起；风险交给运行时守卫。
 */
export function checkUserInstance() {
  return [];
}

/**
 * **开发实例**（Agent 起的）：一组参数是否构成"隔离实例"。返回问题清单，空数组 = 通过。
 * probe: { busy, owner } 端口探测结果；
 * registration: { taskId, backend, web } 登记表里该端口对应的条目（undefined = 没人登记过）。
 */
export function checkIsolation({ port, home, worktree, logFile, expectedHome, expectedWorktree, probe, registration, requireRegistration = false }) {
  const problems = [];
  if (!Number.isInteger(port) || port <= 0 || port > 65535) problems.push(`端口不合法：${String(port)}`);
  else if (port === RESERVED_BACKEND) {
    problems.push(`端口 ${port} 是用户实例的保留号，开发实例不得占用（用 node scripts/dev-port.mjs claim 分配）`);
  }
  if (typeof home !== "string" || home === "") problems.push("LIFEOS_HOME 未设置：开发实例必须用独立家目录");
  else if (expectedHome !== undefined && home === expectedHome) {
    problems.push(`LIFEOS_HOME 指向用户家目录（${home}）：会写坏真实会话/任务数据`);
  }
  if (typeof worktree !== "string" || worktree === "") problems.push("取不到 worktree 路径");
  else if (expectedWorktree !== undefined && worktree === expectedWorktree) {
    problems.push(`在用户主 worktree 里启动（${worktree}）：开发实例必须用独立 worktree`);
  }
  if (typeof logFile !== "string" || logFile === "") problems.push("日志路径为空");
  else if (logFile === DEFAULT_LOG) {
    problems.push(`日志用了共享默认路径（${logFile}）：多实例会混成一份，真因会被埋掉（设 LIFEOS_SUPERVISOR_LOG）`);
  }
  if (probe !== undefined && probe.busy === true) problems.push(`端口 ${String(port)} 已被占用：${probe.owner ?? "占用者未知"}`);
  // 来源检查（必须）：端口必须由工具分配。少了这条，Agent 自己挑一个没人用的号就能"合法"启动，
  // 撞车只是时间问题（2026-11-02 三份实例正是各自"合理"地挑了同一个号）。
  if (requireRegistration === true && registration === undefined) {
    problems.push(`端口 ${String(port)} 不在 dev-port 登记表里：先 node scripts/dev-port.mjs claim --task <NNNN>`);
  }
  // worktree 位置检查：必须在某个 Task 的工作区下。
  // 两种合法形态：tasks/<NNNN>/repo/（协议 §3.7，2026-11-10 增补的建 Task 自动工作区）
  // 或 tasks/<NNNN>/evidence/…（2026-11 之前的历史位置）。0018 是首个使用 repo/ 形态的 Task：
  // 守卫没跟上增补时，合规实例会被这条挡死（实测：supervisor 拒绝启动）。
  if (typeof worktree === "string" && worktree !== "" && requireRegistration === true) {
    const inTaskWorkspace = /\/tasks\/[^/]+\/(repo(\/|$)|evidence\/)/.test(worktree);
    if (!inTaskWorkspace) {
      problems.push(`worktree 不在 Task 工作区下（${worktree}）：应为 tasks/<NNNN>/repo/（协议 §3.7）或历史 evidence/worktree/`);
    }
  }
  return problems;
}

/**
 * src/ 改动后该不该重启后端。
 *
 * - 用户实例：**不重启**，只报警（"guard"）。旧行为一律重启，等于忠实执行
 *   "改了就要重启"，Agent 在主仓一存盘就把用户后端打断（2026-11-03 实际发生）。
 * - 开发实例：按原逻辑（等回合结束再重启）。
 */
export function srcChangeAction({ kind, allowMainEdits = false }) {
  return kind === "user" && !allowMainEdits ? "guard" : "restart";
}

/**
 * 崩溃熔断：后端连续快速退出时不要无限重启。
 * 依据：2026-11-02 三份实例 EADDRINUSE 导致每秒重启、日志涨到 91 万行；
 * 2026-11-03 演练中无效家目录又出现一次 1 秒一次的重启。
 */
export const CRASH_WINDOW_MS = 60_000;
export const CRASH_LIMIT = 5;

/** history: 最近若干次退出的时间戳（毫秒）。返回 true = 应当停止重启。 */
export function shouldGiveUp({ history, now, windowMs = CRASH_WINDOW_MS, limit = CRASH_LIMIT }) {
  const recent = history.filter((at) => now - at <= windowMs);
  return recent.length >= limit;
}
