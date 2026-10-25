// 全局事件总线（任务 0007 P1）：一条连接承载所有 Agent 的事件，按类型分两级投递。
//
// - 回合级（turn / done / error / agents_changed）：发给**所有**连接。数量少（每回合几条），必须零丢失，
//   后台 Agent 的完成/失败靠它实时可见（列表点、Agent 点、提示）。
// - 细节级（delta / thinking / tool_* / retrying …）：只发给**焦点**连接（该连接当前查看的 agentId+sessionId）。
//   并发回合越多，token 洪泛越狠；非焦点会话的细节对用户没有意义，不应占用连接与界面线程。
//
// 投递契约（对齐 C119 的快照优先，推广到全局）：
// 1) 订阅先于快照：订阅后、ready 前到达的事件先缓冲，ready 后按序补发（不丢、不重）；
// 2) 过载即摘除：连接 offer 失败（积压超限或连接已断）→ 摘除并回调 overflowed，由 HTTP 层关闭连接，
//    客户端重连拿新快照。绝不静默丢弃。
// 为什么单独成模块：写操作要在共用实现里广播（工具与 HTTP 两条入口自动闭环），且不能反向 import agent-host（循环）。
import type { StreamEvent } from "./stream-events.ts";
import type { FailureKind } from "./failure.ts";

export type AgentEventPayload =
  | ({ sessionId: string } & StreamEvent)
  | { sessionId: string; projectId?: string | undefined; type: "done"; turnId?: string; aborted?: boolean }
  | { sessionId: string; projectId?: string | undefined; type: "turn"; turnId: string; state: "running" | "done" | "error" }
  | { sessionId: string; projectId?: string | undefined; type: "error"; message: string; kind: FailureKind; turnId?: string }
  // 助手/项目列表变了（写操作在共享实现里广播）：前端收到后重取，无需手动刷新
  | { type: "agents_changed" };

/** 信封：全局序号 + 来源 Agent（agents_changed 等全局事件没有 agentId）。 */
export type AgentEvent = AgentEventPayload & { seq: number; agentId?: string };

/** 回合级事件类型：发给所有连接，不做焦点过滤。 */
const TURN_LEVEL = new Set(["turn", "done", "error", "agents_changed"]);
export const isDetailEvent = (type: string): boolean => !TURN_LEVEL.has(type);

export type Focus = { agentId: string; sessionId: string; visible: boolean };

export type Subscriber = {
  readonly id: string;
  focus?: Focus | undefined;
  /** 投递一条事件；返回 false = 过载或已断开，总线据此摘除。 */
  offer(event: AgentEvent): boolean;
  /** 被摘除时回调（HTTP 层在此关闭连接）。 */
  overflowed(): void;
};

/** 快照生成期间最多缓冲的事件条数；超过即视为过载（与 offer 的字节上限是两道闸）。 */
const PRE_READY_LIMIT = 10_000;

type Registration = { sub: Subscriber; ready: boolean; buffer: AgentEvent[] };
const registry = new Map<string, Registration>();
let seq = 0;

function matchesFocus(focus: Focus | undefined, event: AgentEvent): boolean {
  return focus !== undefined && focus.agentId === event.agentId && focus.sessionId === (event as { sessionId?: string }).sessionId;
}

function deliver(reg: Registration, event: AgentEvent): void {
  if (isDetailEvent(event.type) && !matchesFocus(reg.sub.focus, event)) return;
  if (reg.sub.offer(event)) return;
  registry.delete(reg.sub.id);
  reg.sub.overflowed();
}

function dispatch(event: AgentEvent): void {
  for (const reg of Array.from(registry.values())) {
    if (registry.get(reg.sub.id) !== reg) continue;   // 前面的投递可能已摘除它
    if (!reg.ready) {
      reg.buffer.push(event);
      if (reg.buffer.length > PRE_READY_LIMIT) {
        registry.delete(reg.sub.id);
        reg.sub.overflowed();
      }
      continue;
    }
    deliver(reg, event);
  }
}

/**
 * 订阅总线。返回的 seq 是订阅时刻的全局序号（快照的基线）；
 * ready() 之前到达的事件都在缓冲里，ready() 时按序补发（它们的 seq 必然大于基线）。
 */
export function subscribeBus(sub: Subscriber): { seq: number; ready(): void; close(): void } {
  const reg: Registration = { sub, ready: false, buffer: [] };
  registry.set(sub.id, reg);
  const baseline = seq;
  return {
    seq: baseline,
    ready() {
      if (registry.get(sub.id) !== reg || reg.ready) return;
      reg.ready = true;
      const pending = reg.buffer.splice(0);
      for (const event of pending) {
        if (registry.get(sub.id) !== reg) break;
        deliver(reg, event);
      }
    },
    close() {
      if (registry.get(sub.id) === reg) registry.delete(sub.id);
    },
  };
}

/** 更新连接焦点（PUT /api/events/focus）。未知连接返回 false，由 HTTP 层返回 404。 */
export function setFocusOf(connectionId: string, focus: Focus | undefined): boolean {
  const reg = registry.get(connectionId);
  if (reg === undefined) return false;
  reg.sub.focus = focus;
  return true;
}

/** 此刻是否有连接正在可见地查看这个会话（完成时据此决定要不要记为未读）。 */
export function isFocusedVisible(agentId: string, sessionId: string): boolean {
  for (const reg of registry.values()) {
    const f = reg.sub.focus;
    if (f !== undefined && f.visible && f.agentId === agentId && f.sessionId === sessionId) return true;
  }
  return false;
}

/** 发布一条按会话的事件（thinking/delta/tool/…/done/error）。 */
export function publish(agentId: string, event: AgentEventPayload): AgentEvent {
  const full = { ...event, agentId, seq: ++seq } as AgentEvent;
  dispatch(full);
  return full;
}

/** 全局广播（不绑定某个会话）：助手/项目是跨 Agent 的实体。 */
export function broadcast(event: { type: "agents_changed" }): AgentEvent {
  const full = { ...event, seq: ++seq } as AgentEvent;
  dispatch(full);
  return full;
}

/** 当前全局序号（快照用）。 */
export function eventsSeq(): number {
  return seq;
}

/** 当前连接数（诊断与测试用）。 */
export function connectionCount(): number {
  return registry.size;
}
