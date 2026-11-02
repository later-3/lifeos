// supervisor 的启动自检（任务 0016）：把"实例隔离"从靠人记条文变成启动即拒绝。
// 依据：2026-11-02 三份实例照条文用同一个 43130，每秒 EADDRINUSE 崩溃重启、日志涨到 91 万行（案例 C160）。
// 纯函数 + 可注入探测，便于穷举测试；node:net 的实测在 dev-supervisor.mjs 里注入。
export const RESERVED_BACKEND = 43120;
export const DEFAULT_LOG = "/tmp/lifeos-dev-supervisor.log";

/**
 * 一组参数是否构成"隔离实例"。返回问题清单，空数组 = 通过。
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
  // worktree 位置检查：必须在某个 Task 的 evidence/ 下（协议 §3.7/§12）。
  if (typeof worktree === "string" && worktree !== "" && requireRegistration === true) {
    if (!/\/tasks\/[^/]+\/evidence\//.test(worktree)) {
      problems.push(`worktree 不在 Task 的 evidence/ 下（${worktree}）：按协议 §3.7/§12 应建在 tasks/<NNNN>/evidence/`);
    }
  }
  return problems;
}
