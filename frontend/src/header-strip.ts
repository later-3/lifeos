// 头部状态条（header strip）分段容器（Task 0002）：
// header 副标题 = 若干分段（agent/project/model/thinking/task）按序 join(" · ")；
// 增删/调整 = 增删段；将来给某段挂 action（点击切换模型/思考等）不改容器。
// 纯函数：frontend 2.7（可穷举测试）；测试 test/header-strip.test.mjs。
export type HeaderSegment = { id: string; text: string };

export type HeaderStripInput = {
  agentName: string;
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
