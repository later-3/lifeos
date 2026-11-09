// 前端事件路由（任务 0007 P4）：纯函数，"事件 + 焦点 + 基线 → 动作"。
// App 只执行动作，不在组件里做判断——这样多 Agent 的分流规则可以穷举测试。
//
// 规则（与服务端 events.ts 的两级投递对应）：
// - 基线之前的事件（快照之前的重放）→ 丢弃（C119 的快照优先，推广到全局流）；
// - 回合级（turn）→ 只更新运行事实（任何会话都要更新列表的运行点）；
// - 终态（done/error）→ 刷新该 Agent 的会话列表；若是焦点会话 → 进消息管道；
//   若不是"正在看的焦点会话"（或页面不可见）且不是用户打断 → 完成提示（带动作，可切过去）；
// - 细节级（delta/tool/…）→ 只属于焦点会话；其他会话的细节必须丢弃，不得串进当前消息。

export type RouteFocus = { agentId?: string | undefined; sessionId?: string | undefined; visible: boolean };

export type RouteEvent = {
  seq: number;
  type: string;
  agentId?: string | undefined;
  sessionId?: string | undefined;
  /** 行补丁带它：删除时客户端要靠它定位该减哪个分组的数字。 */
  projectId?: string | undefined;
  turnId?: string | undefined;
  state?: string | undefined;
  aborted?: boolean | undefined;
  message?: string | undefined;
  /** `type === "row"` 时的局部补丁（任务 0005）。 */
  patch?: unknown;
};

export type RouteAction =
  | { kind: "drop"; reason: "stale" | "other-session" }
  | { kind: "run"; event: RouteEvent }
  | { kind: "message"; event: RouteEvent }
  | { kind: "refresh-groups"; agentId: string }
  | { kind: "completion"; agentId: string; sessionId: string; outcome: "done" | "error" }
  | { kind: "agents-changed" }
  /** 一行的局部补丁（任务 0005）：只更新那一行，**不重取列表**。 */
  | { kind: "row"; agentId: string; sessionId: string; projectId?: string; patch: unknown }
  /**
   * Agent 请求打开检视面板（D32）：`lifeos_review_open` 广播的 `review_open`。
   * 与 `agents-changed` 同级（回合级事件，所有连接都收）——但要**只在当前 agent×project 上生效**，
   * 否则用户在 A 项目里会被 B 项目的请求打断。
   */
  | { kind: "review-open"; taskId: string; taskDir: string; agentId: string; projectId: string };

const TERMINAL = new Set(["done", "error"]);

export function routeEvent(event: RouteEvent, focus: RouteFocus, baseline: number): RouteAction[] {
  if (event.seq <= baseline) return [{ kind: "drop", reason: "stale" }];
  if (event.type === "agents_changed") return [{ kind: "agents-changed" }];
  /**
   * `review_open`（D32）：Agent 请求打开检视面板。
   * 带上 agentId/projectId 原样交给 App 判"是不是我现在待的地方"——
   * 判断放 App（它知道当前选中），router 只做分流（与既有规则一致）。
   */
  if (event.type === "review_open") {
    const payload = event as unknown as { taskId?: string; taskDir?: string; agentId?: string; projectId?: string };
    if (payload.taskId === undefined || payload.taskDir === undefined) return [{ kind: "drop", reason: "stale" }];
    return [{
      kind: "review-open",
      taskId: payload.taskId,
      taskDir: payload.taskDir,
      agentId: payload.agentId ?? "",
      projectId: payload.projectId ?? "",
    }];
  }
  // 行补丁：**不再触发 refresh-groups**（那会全量重取 1+N 个请求）；
  // 也不做焦点过滤 —— 列表里每个会话的运行态都需要更新，不只当前打开那条。
  if (event.type === "row") {
    const agentId = event.agentId ?? "";
    const sessionId = event.sessionId ?? "";
    if (sessionId === "") return [{ kind: "drop", reason: "stale" }];
    return [{
      kind: "row", agentId, sessionId,
      ...(event.projectId !== undefined ? { projectId: event.projectId } : {}),
      patch: (event as { patch?: unknown }).patch,
    }];
  }

  const agentId = event.agentId ?? "";
  const sessionId = event.sessionId ?? "";
  const matchesFocus = focus.agentId === agentId && focus.sessionId === sessionId;

  if (event.type === "turn") return [{ kind: "run", event }];

  if (TERMINAL.has(event.type)) {
    const actions: RouteAction[] = [{ kind: "refresh-groups", agentId }];
    if (matchesFocus) actions.push({ kind: "message", event });
    const watching = matchesFocus && focus.visible;
    // 用户主动打断的回合不算"完成"，不弹提示（与服务端 aborted 的未读规则一致）
    if (!watching && event.type === "done" && event.aborted !== true) {
      actions.push({ kind: "completion", agentId, sessionId, outcome: "done" });
    }
    if (!watching && event.type === "error") {
      actions.push({ kind: "completion", agentId, sessionId, outcome: "error" });
    }
    return actions;
  }

  // 细节级：只属于焦点会话
  if (!matchesFocus) return [{ kind: "drop", reason: "other-session" }];
  return [{ kind: "message", event }];
}

/**
 * 流是否陈旧（看门狗判定）：服务端每 10 秒发一次具名心跳；超过阈值没有任何帧 = 连接已死。
 * 为什么要有：经代理（如 Vite 开发代理）的 SSE 断开时，浏览器可能收不到 error，EventSource 不会自己重连。
 */
export function isStreamStale(lastSeenMs: number, nowMs: number, staleMs: number): boolean {
  return nowMs - lastSeenMs >= staleMs;
}
