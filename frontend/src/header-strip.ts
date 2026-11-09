// 头部状态条（header strip）分段容器（Task 0002）：
// header 副标题 = 若干分段（agent/project/model/thinking/task）按序 join(" · ")；
// 增删/调整 = 增删段；将来给某段挂 action（点击切换模型/思考等）不改容器。
// 纯函数：frontend 2.7（可穷举测试）；测试 test/header-strip.test.mjs。
export type HeaderSegment = { id: string; text: string };

/**
 * 会话在列表里的**扁平**查找（跨项目）。
 *
 * 为什么需要它（2026-11-05 修的 bug）：头部大字标题原来是从「**选中项目**」的分组里找
 * 「当前会话」（`currentGroup?.sessions.find(...)`）。而 `selectedProjectId` 与 `sessionId`
 * 是两份独立状态：点另一个项目的会话行、或点另一个项目的分组头，两者就会不一致 ——
 * 于是 `find` 返回 undefined、标题变成空串，最后回落成产品名「Life OS」。
 *
 * 会话的身份包含它所属的项目（session ∈ Agent × Project），所以查会话**不需要**先知道项目：
 * 跨所有分组找，谁命中就是谁。
 */
export function findSessionRow<T extends { sessionId: string }>(
  groups: readonly { project: { id: string }; sessions: readonly T[] }[] | undefined,
  sessionId: string | undefined,
): T | undefined {
  if (groups === undefined || sessionId === undefined) return undefined;
  for (const group of groups) {
    const found = group.sessions.find((item) => item.sessionId === sessionId);
    if (found !== undefined) return found;
  }
  return undefined;
}

/**
 * 聊天区顶部大字标题（`header h1`）的取值规则。
 *
 * 三条分支，与列表里那一行**同一份派生**（列表用 `titleOf(item)`）：
 * 1. 没有会话 → 草稿态，显示「新会话」；
 * 2. 有会话、有显示名 → 显示名；
 * 3. 有会话、没有显示名 → `会话 <id 前 8 位>`（与列表兜底相同）。
 *
 * **不再回落到产品名**：产品名不是这条会话的任何信息，它只会让用户以为标题坏了。
 * 参考（2026-11-05 核对）：Open WebUI `src/lib/components/chat/Navbar.svelte:128` 的
 * `title || chat?.chat?.title || $i18n.t('New Chat')` —— 空标题回落的是**中性占位**，不是产品名。
 */
export function headerTitleOf(input: { sessionId: string | undefined; displayTitle: string }): string {
  if (input.sessionId === undefined) return "新会话";
  const display = input.displayTitle.trim();
  return display !== "" ? display : `会话 ${input.sessionId.slice(0, 8)}`;
}

/** 任务标题缓存的键：**必须带 agent + project**，否则切 Agent 后同号 Task 会串标题（C120）。 */
export function taskTitleKey(agentId: string, projectId: string, taskId: string): string {
  return `${agentId}\u0000${projectId}\u0000${taskId}`;
}

/** 头部 task 段的取值来源。 */
export type HeaderTask = { id: string; title?: string };

/**
 * task 段显示哪一个 Task。
 *
 * 规则（有依据）：Task 是**会话级**状态（activeTaskId 存在会话文件里），所以
 * - 有会话：只显示该会话的 Task；会话没有 Task 时不拿默认 Task 顶上（那会撒谎——下一轮并不进默认 Task）。
 * - 无会话：显示**项目的默认 Task**（`src/tasks.ts` 的 ensureDefaultTask，isDefault: true）。
 *   依据：新建会话必然绑到默认 Task（createSession → ensureDefaultTask），首条消息就落在这里。
 */
export function headerTaskOf(input: {
  hasSession: boolean;
  sessionTaskId?: string | null;
  sessionTaskTitle?: string;
  projectDefaultTask?: HeaderTask;
}): HeaderTask | undefined {
  if (input.hasSession) {
    if (input.sessionTaskId == null || input.sessionTaskId === "") return undefined;
    return {
      id: input.sessionTaskId,
      ...(input.sessionTaskTitle !== undefined ? { title: input.sessionTaskTitle } : {}),
    };
  }
  return input.projectDefaultTask;
}

export type HeaderStripInput = {
  agentName: string;
  /**
   * 对端 Agent（Task 0015 · T17）。
   *
   * 只在 **Agent ↔ Agent** 的会话里给：那时 `agentName` 是"这条会话归谁"，
   * `peerName` 才是"正在和谁谈"——两者不同，必须都写出来。
   * 用户 ↔ Agent 的会话不给（对端就是 agentName 本身，写了是重复）。
   */
  peerName?: string;
  projectName: string;
  sessionTitle: string;
  headerModel: { provider: string; id: string } | null;
  thinkingLevel: string | undefined;
  activeTaskId: string | undefined;
  taskTitle: string | undefined;
};

export function buildHeaderSegments(input: HeaderStripInput): HeaderSegment[] {
  const segments: HeaderSegment[] = [];
  // 项目名去重（2026-10-24 用户指出）：会话标题已经显示项目名时，不再重复一段
  const agent = input.agentName !== "" ? input.agentName : undefined;
  const project = input.projectName !== "" && input.projectName !== input.sessionTitle ? input.projectName : undefined;
  if (agent === undefined && project === undefined) {
    segments.push({ id: "empty", text: "选择或新建一个会话" });
  } else {
    if (agent !== undefined) segments.push({ id: "agent", text: agent });
    // Agent ↔ Agent：`agent → peer` 才读得出"谁和谁在谈"
    if (input.peerName !== undefined && input.peerName !== "" && input.peerName !== agent) {
      segments.push({ id: "peer", text: `↔ ${input.peerName}` });
    }
    if (project !== undefined) segments.push({ id: "project", text: project });
  }
  if (input.headerModel != null) segments.push({ id: "model", text: `${input.headerModel.provider}/${input.headerModel.id}` });
  if (input.thinkingLevel != null && input.thinkingLevel !== "") segments.push({ id: "thinking", text: input.thinkingLevel });
  if (input.activeTaskId != null) {
    segments.push({ id: "task", text: input.taskTitle ? `${input.activeTaskId} ${input.taskTitle}` : input.activeTaskId });
  }
  return segments;
}

export function joinHeaderSegments(segments: readonly HeaderSegment[]): string {
  return segments.map((segment) => segment.text).join(" · ");
}

