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
  turnId?: string | undefined;
  state?: string | undefined;
  aborted?: boolean | undefined;
  message?: string | undefined;
};

export type RouteAction =
  | { kind: "drop"; reason: "stale" | "other-session" }
  | { kind: "run"; event: RouteEvent }
  | { kind: "message"; event: RouteEvent }
  | { kind: "refresh-groups"; agentId: string }
  | { kind: "completion"; agentId: string; sessionId: string; outcome: "done" | "error" }
  | { kind: "agents-changed" };

const TERMINAL = new Set(["done", "error"]);

export function routeEvent(event: RouteEvent, focus: RouteFocus, baseline: number): RouteAction[] {
  if (event.seq <= baseline) return [{ kind: "drop", reason: "stale" }];
  if (event.type === "agents_changed") return [{ kind: "agents-changed" }];

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
