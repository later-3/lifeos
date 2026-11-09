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
  | { type: "agents_changed" }
  /**
   * Agent 请求打开检视（D32）：`lifeos_review_open(taskId)` 工具写这条，
   * 前端收到就把检视面板打开并切到该 Task。
   *
   * 为什么用事件而不是让工具直接改前端状态：工具跑在服务端，界面在浏览器；
   * 这条事件让 Agent 与用户走**同一条路径**（都通过"选某个 Task 的检视对象"进入），
   * 不做第二套语义。参考基线：difit 的对象在进 UI 前就定了、opencode 绑定当前会话，
   * 两家都没有"Agent 主动开面板"，所以这是我们新增的能力（不是"抄来的"）。
   */
  | { type: "review_open"; taskId: string; taskDir: string; agentId: string; projectId: string }
  /**
   * 一行的局部补丁（任务 0005）：只带变了的字段，前端**只更新那一行**，不重取整个列表。
   *
   * 为什么新增事件而不是复用 `turn`：`turn` 已有语义（回合生命周期），塞 phase 会让它变成
   * 两种含义，前端 `event-router` 也要跟着分叉（`specs/code/api/api.md` 2.2 允许"先加映射再进 UI"）。
   *
   * 频率控制（`02-design.md` D4）：服务端每会话 **≥1000ms 至多 1 条**，且**只在值变化时发**。
   * 依据：实测最重会话一次回合 448 次工具调用 / 804 个内容块，逐条推必成风暴；
   * 而"运行了多少秒"由前端本地 1s 计时器负责，不需要服务端每秒发。
   */
  | { sessionId: string; projectId?: string | undefined; type: "row"; patch: RowPatch };

/**
 * 行补丁允许携带的字段（任务 0005）：**只有这些**，且都对应 `SessionRow` 里的同名位置。
 * 不在这里列出的字段不能通过补丁更新 —— 前端收到未列出的键应当忽略（前向兼容）。
 */
export type RowPatch = {
  /** 运行态：`since` 起算，`phase`/`tool` 来自 Pi 的流事件。 */
  running?: { since: string; phase?: string; tool?: string } | null;
  /** 未读：完成即来一条（`null` = 已看过，清掉）。 */
  unread?: { since: string } | null;
  /** 失败：`detail` 为落盘原文。`null` = 恢复正常。 */
  failure?: { kind: string; detail: string; at?: string } | null;
  /** 最后活动时间（终态时推进）。 */
  lastActivityAt?: string;
  /** 标题变化（重命名、首条消息自动命名）。 */
  title?: { raw: string; display: string };
  /**
   * 会话已被删除（Task 0005 · P8 补）：收到即把这一行从列表里移除，并让聚合数字跟着减。
   *
   * 为什么需要：`deleteSession` 清了 `session-views` 索引，但**不通知其他客户端** ——
   * 标签页 B 的助手列数字会一直是旧的，直到它自己刷新或重连。
   */
  removed?: true;
  /** 删除时，这条会话**删除前**在聚合里占哪一格；客户端据此把对应数字减一（Task 0005）。 */
  was?: "running" | "unreadDone" | "unreadError";
  /** Task 变化（切 Task、建 Task 即进入）。 */
  task?: { id: string; title: string; status: string; type: string } | null;
};

/** 信封：全局序号 + 来源 Agent（agents_changed 等全局事件没有 agentId）。 */
export type AgentEvent = AgentEventPayload & { seq: number; agentId?: string };

/** 回合级事件类型：发给所有连接，不做焦点过滤。 */
const TURN_LEVEL = new Set(["turn", "done", "error", "agents_changed", "row", "review_open"]);
export const isDetailEvent = (type: string): boolean => !TURN_LEVEL.has(type);

/**
 * 连接当前在看哪个会话（主会话），外加若干"同时开着看"的会话。
 *
 * `watching` 的用途（代码事实）：A 调用 lifeos_ask/lifeos_send 后，右侧会打开对端 Agent 的会话详情；
 * 那是一条**独立的会话**（另一个 agentId+sessionId），它的 delta/tool 事件原本因 `matchesFocus` 只认主会话
 * 而被丢掉。把对端会话加进 watching，这批细节事件才会投到同一个连接，抽屉里才能实时看到对方在干活。
 *
 * 上限 MAX_WATCHING：防止一个连接订阅无限会话把 token 洪泛放大（与"细节只给在看的人"的初衷一致）。
 */
export const MAX_WATCHING = 3;
export type Focus = { agentId: string; sessionId: string; visible: boolean; watching?: Array<{ agentId: string; sessionId: string }> };

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
  if (focus === undefined) return false;
  const sessionId = (event as { sessionId?: string }).sessionId;
  if (focus.agentId === event.agentId && focus.sessionId === sessionId) return true;
  // 同时开着的对端会话（右侧抽屉）：同样的细节事件也要投给这个连接。
  return (focus.watching ?? []).some((entry) => entry.agentId === event.agentId && entry.sessionId === sessionId);
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
export function broadcast(event: { type: "agents_changed" } | { type: "review_open"; taskId: string; taskDir: string; agentId: string; projectId: string }): AgentEvent {
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
