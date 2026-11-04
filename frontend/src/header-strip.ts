// 头部状态条（header strip）分段容器（Task 0002）：
// header 副标题 = 若干分段（agent/project/model/thinking/task）按序 join(" · ")；
// 增删/调整 = 增删段；将来给某段挂 action（点击切换模型/思考等）不改容器。
// 纯函数：frontend 2.7（可穷举测试）；测试 test/header-strip.test.mjs。
export type HeaderSegment = { id: string; text: string };

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

/**
 * 当前会话是不是"与其他 Agent 的对话"（peer 会话）。
 *
 * 这类会话由对端 Agent 驱动，`POST /messages` 会 409，批注在里面**禁用**。
 *
 * **注意 peer 的类型是 `RowPeer | null`**（`src/session-rows.ts:53`），不是 `undefined`。
 * 2026-11-04 的 bug：写成 `item.peer !== undefined`，而普通会话的 peer 是 `null`，
 * `null !== undefined` 恒为 true → 所有会话都被判成 peer → 批注在全站被禁用，
 * 表现是"拖选文字什么都不弹"，看起来像功能没上线。
 * 所以这里用 `!= null`（null 与 undefined 都为假），并有单测锁住。
 */
export function isPeerSessionOf(
  sessionId: string | undefined,
  sessions: readonly { sessionId: string; peer?: unknown }[] | undefined,
): boolean {
  if (sessionId === undefined) return false;
  return sessions?.some((item) => item.sessionId === sessionId && item.peer != null) === true;
}
