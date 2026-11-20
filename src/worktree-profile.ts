// Task 工作区的 sparse 裁剪规则（协议 §3.7「Task 的工作区」、§4.2 的分层）。
//
// 为什么单独一个纯函数：这条规则决定"Agent 的工作区里到底有哪些路径"。
// 多写一条 = 把别的 Agent 或未绑定的共享 project 塞进他的工作区；
// 少写一条 = 他新绑定的项目在自己的工作区里**不存在**，`write` 会静默写到主区去。
// 两种都不报错。所以规则不碰文件系统：输入是绑定事实，输出是路径模式，可以穷举断言
// （`specs/code/backend/code.md` 2.7：判定抽纯函数、可穷举）。
//
// **两种形态**（2026-11-19 · Task 0004）：
// - **未收窄**（不传 `taskDirName`）：整个 `agents/<自己>/` 都放行，含它全部的 Task。
//   这是 2026-11 之前建的 28 个工作区的形态，必须继续能读（协议 §11 历史不改写）。
// - **收窄**（传 `taskDirName`）：只放行**本 Task** 那一个 `tasks/<dir>/`，
//   但 `agents/<自己>/projects/<pid>/` 下**非 Task 的内容**（specs/devices/tools/knowledge）仍放行——
//   实测（reviewer 全量复核 28 个工作区）它们会被改，不放行就写失败或落主区。
//
// 判据是「被读路径 ∪ 实测会被写的层」，不是"只留被读的"：Agent × project 层的 `specs/`
// 当前没有读路径指向它，但实测被改过（`agent-e776/workspace/0009`）。
// 按"只留被读的"会把它排掉，然后 L2 只拦 `tasks/<NNNN>/` → **静默绕过检视**（`architecture.md` §3.13：按实测，不想当然）。

/** 共享 workspace 的 project id（协议 §4.4）：所有 Agent 共享的一层。 */
export const SHARED_WORKSPACE = "workspace";

export type WorktreeProfileInput = {
  /** 这个工作区属于谁。 */
  agentId: string;
  /** 该 Agent 绑定的共享 project id（`agents/<agentId>/projects/*` 的目录名，协议 §5.2）。 */
  boundProjects: string[];
  /**
   * 本工作区属于哪个 Task（**收窄态**）。
   * 传了它 = 只放行这一个 Task；不传 = 未收窄形态（整个 Agent 目录），存量工作区就是这一种。
   *
   * 为什么是目录名（`0028-连接池修复：…`）而不是 Task id：sparse 模式匹配的是**路径**，
   * 路径里是目录名。用编号要再查一次目录，多一次 IO 且可能查错（architect 02-design §2.1）。
   */
  taskDirName?: string;
  /**
   * 本任务在**哪个 project** 下（收窄态必填，与 `taskDirName` 成对）。
   * 只放行**这一个** pid 下的 tasks，别的 pid 的 tasks 一并排掉。
   */
  projectId?: string;
};

/**
 * gitignore 模式里必须转义的字符（`glob(7)` 的元字符）。
 *
 * 为什么需要：Task 目录名来自用户写的标题，`sanitizeSegment` 只去掉路径分隔符与控制字符，
 * 所以 `[` `]` `*` `?` 与原样保留的反斜杠都可能出现在目录名里。
 * 实测（git 2.37.1）：目录名含 `[` 时**裸写模式匹配不上**（本 Task 自己都不检出），转义后才对。
 * `]` `*` `?` 的裸写恰好能匹配上，但那是"碰巧"，同一条规则不能靠巧合。
 */
export function escapeGlob(segment: string): string {
  return segment.replace(/[\\*?[\]]/g, (ch) => `\\${ch}`);
}

/**
 * 家目录工作区的裁剪模式，喂给 `git sparse-checkout set --no-cone <模式…>`。
 *
 * 读法（gitignore 语义，**后写的覆盖先写的**）：
 * - `/*`              根下的一切（`.gitignore`、`interaction-harness/`、`users/`、共享层…）
 * - `!/agents/*`      先排掉所有 Agent，再单独放行自己
 * - 未收窄态：`/agents/<自己>/` 整个放行（含全部 Task）
 * - 收窄态：只放行自己的身份/工具/记忆 + 本 Task 所在 project 层 + **本 Task**；
 *   顺序硬约束：**先**排除所有 `tasks/*`，**再**放行本 Task（颠倒 = 本 Task 自己也没了）
 * - `!/projects/*`    先排掉所有共享 project，再单独放行 workspace 与绑定的
 */
export function worktreeProfileOf(input: WorktreeProfileInput): string[] {
  const patterns = ["/*", "!/agents/*"];

  if (input.taskDirName === undefined) {
    // 未收窄形态：今天的全部行为，一条不改（存量工作区与 P5 共存验证都依赖它）。
    patterns.push(`/agents/${escapeGlob(input.agentId)}/`);
  } else {
    const agent = `/agents/${escapeGlob(input.agentId)}`;
    patterns.push(
      `${agent}/AGENTS.md`,
      `${agent}/agent.json`,
      `${agent}/identity.md`,
      `${agent}/avatar/`,
      `${agent}/memory/`,
      `${agent}/tools/`,                                    // 协议 §4.1：Agent 本身的工具
    );
    if (input.projectId === undefined) {
      // 没给 pid 就无法定位本 Task（Task ID 只在 Agent × Project 内唯一，协议 §3.7）。
      // 明确失败，不猜一个：猜错 = 工作区里没有本 Task 的文档，`write` 静默落主区。
      throw new Error("worktreeProfileOf：传了 taskDirName 就必须同时传 projectId（Task ID 只在 Agent × Project 内唯一）");
    }
    patterns.push(
      `${agent}/projects/${escapeGlob(input.projectId)}/`,   // Agent×project 层：specs / devices / tools / knowledge
      `!${agent}/projects/*/tasks/*`,                       // ① 先排除所有 tasks/*
      `${agent}/projects/${escapeGlob(input.projectId)}/tasks/${escapeGlob(input.taskDirName)}/`,   // ② 再放行本 Task
    );
  }

  patterns.push("!/projects/*", `/projects/${SHARED_WORKSPACE}/`);
  for (const project of input.boundProjects) {
    if (project === SHARED_WORKSPACE) continue;
    patterns.push(`/projects/${escapeGlob(project)}/`);
  }
  return patterns;
}

/** 从模式里反推出"这个 profile 放行了哪些共享 project"（诊断与测试用）。 */
export function allowedProjectsOf(patterns: string[]): string[] {
  const excluded = patterns.includes("!/projects/*");
  if (!excluded) return [];
  return patterns
    .filter((pattern) => pattern.startsWith("/projects/"))
    .map((pattern) => pattern.slice("/projects/".length).replace(/\/$/, ""))
    // 转义过的名字还原给人看（`a\[b` → `a[b`）
    .map((pattern) => pattern.replace(/\\(.)/g, "$1"));
}
