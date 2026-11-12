// Task 工作区的 sparse 裁剪规则（协议 §3.7「Task 的工作区」、§4.2 的分层）。
//
// 为什么单独一个纯函数：这条规则决定"Agent 的工作区里到底有哪些路径"。
// 多写一条 = 把别的 Agent 或未绑定的共享 project 塞进他的工作区；
// 少写一条 = 他新绑定的项目在自己的工作区里**不存在**，`write` 会静默写到主区去。
// 两种都不报错。所以规则不碰文件系统：输入是绑定事实，输出是路径模式，可以穷举断言
// （`specs/code/backend/code.md` 2.7：判定抽纯函数、可穷举）。

/** 共享 workspace 的 project id（协议 §4.4）：所有 Agent 共享的一层。 */
export const SHARED_WORKSPACE = "workspace";

export type WorktreeProfileInput = {
  /** 这个工作区属于谁。 */
  agentId: string;
  /** 该 Agent 绑定的共享 project id（`agents/<agentId>/projects/*` 的目录名，协议 §5.2）。 */
  boundProjects: string[];
};

/**
 * 家目录工作区的裁剪模式，喂给 `git sparse-checkout set --no-cone <模式…>`。
 *
 * 读法（gitignore 语义，后写的覆盖先写的）：
 * - `/*`              根下的一切（`.gitignore`、`install-receipt.json`、`users/`、`interaction-harness/`）
 * - `!/agents/*`      先排掉所有 Agent，再单独放行自己
 * - `/agents/<自己>/` 自己的全部：身份、记忆配置、projects（含 tasks）
 * - `!/projects/*`    先排掉所有共享 project，再单独放行 workspace 与绑定的
 */
export function worktreeProfileOf(input: WorktreeProfileInput): string[] {
  const patterns = [
    "/*",
    "!/agents/*",
    `/agents/${input.agentId}/`,
    "!/projects/*",
    `/projects/${SHARED_WORKSPACE}/`,
  ];
  for (const project of input.boundProjects) {
    if (project === SHARED_WORKSPACE) continue;
    patterns.push(`/projects/${project}/`);
  }
  return patterns;
}

/** 从模式里反推出"这个 profile 放行了哪些共享 project"（诊断与测试用）。 */
export function allowedProjectsOf(patterns: string[]): string[] {
  const excluded = patterns.includes("!/projects/*");
  if (!excluded) return [];
  return patterns
    .filter((pattern) => pattern.startsWith("/projects/"))
    .map((pattern) => pattern.slice("/projects/".length).replace(/\/$/, ""));
}
