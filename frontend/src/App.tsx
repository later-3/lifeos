import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import {
  IconArrowDown, IconArrowLeft, IconChevronLeft, IconFileText, IconFolder, IconFolderPlus, IconHistory, IconLayoutSidebarRight, IconMessageCircle,
  IconInfoCircle, IconMenu2, IconPencil, IconPhoto, IconTrash, IconX,
} from "@tabler/icons-react";
import {
  addImage, attachmentSummary, IMAGE_MIME_TYPES, removeImage, scaledSize, shouldCompressImage,
  CLIENT_JPEG_QUALITY, toRequestImages, type PendingImage,
} from "./attachments";
import { useFold } from "./design/fold";
import { useAnnotations } from "./annotation-store";
import type { Annotation, AnnotationAuthor } from "./annotations";
import { AnnotationPanel } from "./annotation-panel";
import { annotationsMessage, hasSendableAnnotation } from "./annotation-message";
import { rebuildHighlightStyles } from "./annotations";
import { useToast } from "./design/toast";
import { AgentConfigModal } from "./AgentConfig";
import { AgentAvatar, type AgentAvatarSpec } from "./agent-avatar";
import { UserAvatar, type UserProfile } from "./user-avatar";
import { DisplayPrefsPanel, loadPrefs, savePrefs } from "./display-prefs-panel";
import {
  avatarSizeOf, fontVars, parsePrefs, widthVar, type DisplayPrefs,
} from "./display-prefs";
import { hasProcess, statsOf, type ProcessStats } from "./process-stats";
import { groupIntoSpans } from "./turn-group";
import { DirectoryPicker } from "./DirectoryPicker";
import { ImageTrigger } from "./design/image-viewer";
import { FileTree } from "./FileTree";
import { FilePanel } from "./FilePanel";
import { useColumnWidth } from "./useColumnWidth";
import {
  AddProjectButton, GroupBody, GroupHeader, GroupsColumnHeader, PanelEmpty, PanelFooter, ParticipantToken, SessionRow,
} from "./groups-panel";
import { layout } from "./design/layout";
import { useFilePanel } from "./useFilePanel";
import { MessageView, type Block } from "./Message";
import { TurnStatusBar } from "./turn-status";
import { MobileNav, type Level } from "./mobile-nav";
import { useAppHeight, useEdgeBack, useIsMobile } from "./use-mobile";
import { nextActionOfMessages, resendPlan, turnOutcomeOfMessages } from "./resend";
import { failureLabel, fixHint, type FailureKind } from "./failure-text";
import type { TurnStep } from "./working";
import { applyStreamEvent, blocksOfStream, createStreamState, finalTextOfStream, textOfBlocks, type Phase, type StreamEvent } from "./stream-blocks";
import { TurnInspector } from "./SessionHistory";
import { PeerPanel, type PeerTarget } from "./PeerPanel";
import { NavRail } from "./design/rail";
import { ConfirmDialog } from "./design/overlay";
import { ComposerButton, EmptyState, IconButton, Label, Row, Skeleton } from "./design/ui";
import { buildHeaderSegments, headerTaskOf, isPeerSessionOf, joinHeaderSegments, taskTitleKey } from "./header-strip";
import type { SessionRow as SessionRowData } from "../../src/session-rows.ts";
import type { RowActivity, RowFailureKind, RowPhase } from "../../src/row-activity.ts";

// 三级级联菜单：第1列 Agent → 第2列 其 Projects → 第3列 该项目的所有事情 → 主区聊天。
// 折叠态统一走 44px 单轨（design/rail.tsx），成本不随层数增长；宽度全部由 design/layout.ts 计算。
// 视觉：tokens（design/tokens.css）+ primitive（design/ui.tsx），页面层只组装。
type Agent = { id: string; name: string; description?: string; avatar?: AgentAvatarSpec };
type Project = { id: string; name: string; isDefault: boolean; path?: string };
type UsageSummary = { input: number; output: number; cacheRead: number; cacheWrite: number; cost: number; totalTokens: number };
/**
 * 状态标记（项目行与助手行共用）：三个**数量**，不是"有/无"。
 *
 * ## 为什么是三个数字（Task 0005 · 用户 2026-11-03 裁决）
 *
 * 改之前：运行 = 一个呼吸点（不管几个在跑），未读 = 数字。
 * 两个问题：① "3 个会话在跑"和"1 个在跑"长得一样；② 助手层数字是**项目个数**、
 * 项目层数字是**会话个数**，单位不同 → "助手显示 1，点进去看到 6 个未读"没法解释。
 *
 * 现在三层统一为会话数：正在工作 / 已完成待查看 / 失败。
 *
 * ## 样式依据
 *
 * - 运行中（呼吸）：用户裁决 A —— 整个徽标呼吸（与行上脉冲点同一节奏 `animate-pulse`）
 * - 待查看：沿用既有样式（`success-soft` 底 + `success` 字），不新造
 * - 失败：镜像待查看（`danger-soft` 底 + `danger` 字），三种都用同一尺寸，只换色
 * - 排列：运行中(左) → 待查看(中) → 失败(右)（用户指定；与"越需要处理越靠右"一致）
 * - 零值不渲染（照 pi-web `SessionSidebar.tsx:2009`）
 * - `aria-label` 带数量（照 Rocket.Chat `RoomListItem.stories.tsx:55` 的门禁方式，
 *   比按 class 断言稳）
 */
/**
 * 状态徽标（助手行与项目行共用）：**三个计数，都不看已读**。
 *
 * 用户裁决（2026-11-04）：三个徽标 ——
 *   ① 正在跑（呼吸绿）  ② 已正常结束（固定绿）  ③ 异常结束（固定红）
 *
 * 为什么没有"未读"徽标：徽标回答「发生过什么」，不回答「我看没看」。
 * 早期把 ② 做成"未读"，用户点开一个完成的会话后数字从 6 掉到 5 —— 历史事实不该因读过而消失。
 * 「有未读」由**会话行的绿点**表达（那里才需要已读语义）。
 *
 * 零值不渲染（照 pi-web `SessionSidebar.tsx:2009`）；`99+` 规则见 `design-language.md:217`。
 */
/**
 * 状态徽标（助手行与项目行共用）：**三个数字，全部看已读**（用户 2026-11-04 定稿）。
 *
 * 未读只有一种概念：一次回合结束了、用户还没看过。它有两个结果 ——
 * 正常结束（绿）与异常结束（红），**规则完全相同：看过就消失，不持久记录**。
 * 所以徽标回答「有几件事要你看」，与**会话行的点永远同步**：点进去了，点和数字一起减。
 *
 * ## 为什么"正在跑"要和"已完成"用不同底色
 *
 * 两个都是绿色会混淆。区分靠**色系深浅 + 动效**，不靠新增色相：
 *   · 正在跑 → 实心 `success` 底 + 白字 + 呼吸（最抢眼：它是活的）
 *   · 已完成 → `success-soft` 底 + `success` 字（安静：它只是等你点一下）
 *   · 异常   → `danger-soft` 底 + `danger` 字
 * 零值不渲染（pi-web `SessionSidebar.tsx:2009`）；>99 显示 `99+`（`design-language.md:217`）。
 */
function CountBadge({ count, kind, unit }: { count: number; kind: "running" | "unreadDone" | "unreadError"; unit: "会话" }) {
  if (count <= 0) return null;
  const text = count > 99 ? "99+" : String(count);
  const label = kind === "running"
    ? `${count} 个${unit}正在工作`
    : kind === "unreadDone"
      ? `${count} 个${unit}已完成待查看`
      : `${count} 个${unit}失败待查看`;
  const tone = kind === "running"
    ? "bg-success text-white animate-pulse"
    : kind === "unreadDone"
      ? "bg-success-soft text-success"
      : "bg-danger-soft text-danger";
  return (
    // 状态徽标是动态数据：截图基线遮掉，只比骨架（testing 2.9）
    <span className={`inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1.5 text-micro font-medium tabular-nums ${tone}`}
      role="status" aria-label={label} title={label} data-state-count={kind}>
      {text}
    </span>
  );
}

function StatusMarks({ status, unit }: { status: { running: number; unreadDone: number; unreadError: number } | undefined; unit: "会话" }) {
  if (status === undefined) return null;
  if (status.running === 0 && status.unreadDone === 0 && status.unreadError === 0) return null;   // 零值不渲染
  return (
    <span className="flex shrink-0 items-center gap-1" data-shot-mask="status-marks">
      <CountBadge count={status.running} kind="running" unit={unit} />
      <CountBadge count={status.unreadDone} kind="unreadDone" unit={unit} />
      <CountBadge count={status.unreadError} kind="unreadError" unit={unit} />
    </span>
  );
}

/** 全局事件流上所有会走分流的事件名（与服务端 StreamEvent / 回合级事件一致）。 */
const STREAM_EVENT_NAMES = [
  "turn", "done", "error", "agents_changed", "row",
  "message_start", "message_end", "delta", "thinking", "thinking_end",
  "tool_call", "tool_start", "tool_update", "tool_result", "retrying", "retry_end",
] as const;

/** 流陈旧阈值 = 服务端心跳间隔的 2.5 倍；看门狗检查间隔。 */
const STREAM_STALE_MS = 25_000;
/** 运行态对账间隔：与 SSE 心跳无关的兜底，收敛"漏掉 done 事件"的绿点。 */
const RUN_RECONCILE_MS = 30_000;
/**
 * 运行耗时的本地心跳（任务 0005 · D4）：**秒数不走网络**。
 * 服务端只在 phase/tool 变化时推补丁（≥1000ms 节流）；"跑了多少秒"由前端每秒自己重算。
 * 取值依据：pi-web 的 `CLOCK_TICK_MS = 60_000` 是给"5分钟前"这种粗粒度用的，
 * 而运行耗时是用户盯着看的活数 —— 1 秒是"没卡住"的最小可感知粒度（`05-basis.md` §1.2）。
 */
const ELAPSED_TICK_MS = 1000;
const STREAM_WATCHDOG_MS = 5_000;

/** 全局快照（连接即发）：connectionId 用于焦点上报；seq 是事件基线；running/unread 是服务端真相。 */
type StreamSnapshot = {
  connectionId: string;
  seq: number;
  // 两者都是**跨 Agent** 的全量事实（服务端 `globalSnapshot()`）：左侧助手列要靠它们显示数字，
  // 不能只依赖"当前选中 Agent 的会话列表"。`projectId` 服务端一直有，此前类型漏写。
  running: Array<{ agentId: string; sessionId: string; projectId?: string; turnId?: string; startedAt: string }>;
  unread: Array<{ agentId: string; sessionId: string; projectId?: string; completedAt: string }>;
  /**
   * 跨 Agent 的数量聚合（服务端 `aggregateStatus()` 算好，Task 0005 · P8-3）。
   * 左侧助手列与项目行直接吃它 —— 前端不再自己判断四态（那会重写 `running > failure > unread` 的优先级）。
   */
  aggregate?: Array<{ agentId: string; projectId?: string; running: number; unreadDone: number; unreadError: number }>;
};

/** 落盘前去掉纯展示态（ui）：展开/钉住/拖动偏移是"当下正在看"的状态，不存。 */
function stripUi(anno: Annotation): Omit<Annotation, "ui"> {
  const { ui: _ui, ...rest } = anno;
  return rest;
}

type SessionMeta = {
  model: { provider: string; id: string } | null; thinkingLevel: string; running?: boolean; modelOverridden?: boolean;
  activeTaskId?: string | null; usage?: UsageSummary; context?: { percent: number | null; window: number } | null;
  /** 请求体画像（Task 0012 P1）：图片/文本字节 + 上限来源 */
  payload?: { images: number; text: number; estimated: number; effective?: number; limit: number | null; source: string | null; triggerBytes: number | null; targetBytes: number | null };
};
/**
 * 会话行（任务 0005）：**直接复用后端的 SessionRow 类型**，前端不再自己拼一份投影。
 *
 * 为什么要 import 而不是再声明一遍：以前这里声明了 `{title: string, messages: number, peer: ..., failure: ...}`，
 * 与后端实际返回的形状各自演化（`peer` 一处字符串一处对象），改一边另一边不知道。
 * 现在类型只有一处（`src/session-rows.ts`），tsc 会把所有漏改点爆出来。
 */
type SessionItem = SessionRowData;
/**
 * 行补丁的载荷（任务 0005）：与服务端 `src/events.ts` 的 `RowPatch` 对应。
 * 这里独立声明成"可空"版本 —— 线上可能收到老版本/新版本客户端不认识的值，
 * 未知键一律忽略（前向兼容）。
 */
type RowPatchPayload = {
  /** 会话已被删除：把这一行移出列表（Task 0005 · P8 补）。 */
  removed?: true;
  /** 删除前它在聚合里占哪一格；据此把助手行/项目行的数字减一。 */
  was?: "running" | "unreadDone" | "unreadError";
  running?: { since: string; phase?: RowPhase; tool?: string } | null;
  unread?: { since: string } | null;
  failure?: { kind: RowFailureKind; detail: string; at?: string } | null;
  lastActivityAt?: string;
  title?: { raw: string; display: string };
  task?: { id: string; title: string; status: string; type: string } | null;
};
type TaskItem = { id: string; title: string; status: string; type: string; category: string; date?: string; isDefault?: boolean };
type Message = {
  role: "user" | "assistant"; text: string; blocks: Block[]; streaming?: boolean; at?: number; error?: string; failure?: FailureKind;
  /** ★ 消息身份（Task 0003 · P1）：后端 messagesOf 透出的 session entry id。
   *  历史消息必有；客户端刚推送的流式消息还没有（下一轮 loadMessages 才补上）。 */
  id?: string;
  /** 这一段的生成耗时（ms）与 token（input+output）：过程条统计用（2026-11-02） */
  durationMs?: number; tokens?: number;
  /**
   * Pi 的回合终态（Task 0007）：`done` / `lost` 的唯一判据输入。
   * 后端 `messagesOf()` 原样透出；前端交给 `turnOutcomeOf()` 判，不再用"文本是否为空"猜。
   */
  stopReason?: string;
};
type Group = { project: Project; sessions: SessionItem[] };
// 流事件（思考/文本/工具）与运行边界（done/error）都在一条 SSE 上；事件名 = 事件类型。
type PaletteItem = { key: string; label: string; hint?: string; run: () => void; /** 当前状态下不可用（草稿态）：置灰、说明原因，点了不执行 */ disabled?: boolean };
type TurnEventSegment = { type: "turn"; turnId: string; state: "running" | "done" | "error" };
type AgentEvent = { seq: number; agentId?: string; sessionId?: string } & (StreamEvent | { type: "done" } | { type: "error"; message?: string } | { type: "agents_changed" } | TurnEventSegment);

const LAST_AGENT = "lifeos.lastAgent";
const DRAFT_PREFIX = "lifeos.draft.";   // 草稿归属会话（切会话换草稿、刷新不丢）
const lastSessionKey = (agentId: string) => `lifeos.lastSession.${agentId}`;

function readLast(key: string): string | undefined {
  try { return localStorage.getItem(key) ?? undefined; } catch { return undefined; }
}
function writeLast(key: string, value: string | undefined) {
  try { if (value === undefined) localStorage.removeItem(key); else localStorage.setItem(key, value); } catch { /* 忽略 */ }
}

/**
 * 运行耗时的显示形态（任务 0005）：`12s` / `1m 05s` / `1h 02m`。
 *
 * 为什么带 `tick` 参数：函数本身是纯的，但 React 需要知道"每秒都要重算"——
 * 把 tick 传进来成为依赖，比在组件里塞一个假的 state 读更明确。
 */
function formatElapsed(ms: number, tick: number): string {
  void tick;   // 只为让调用点的渲染依赖它
  const totalSeconds = Math.floor(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${String(minutes % 60).padStart(2, "0")}m`;
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return "刚刚";
  if (min < 60) return `${min}分钟前`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours}小时前`;
  if (hours < 48) return "昨天";
  const date = new Date(iso);
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

/** 列头：40px，11px 小标签 + 收起钮（唯一收起入口）。列头只写"这一列是什么"，徽标留给行内数据。 */
/**
 * 折叠键迁移（Task 0015 · T15）：旧的两个键 `projects` / `sessions` → 一个 `groups`。
 *
 * 为什么"任一展开就展开"：合并后一列同时承担两个作用。宁可多开一列（用户点一下就能收），
 * 也不要让老用户的展开状态在升级后变成"点了没反应"。
 * 只在读不到 `groups` 键时参考旧键（`useFold` 的 initial 只在没有存量值时生效）。
 */
function legacyGroupsOpen(): boolean {
  try {
    if (localStorage.getItem("lifeos.fold.groups") !== null) return true;   // 有存量就不看旧键
    const projects = localStorage.getItem("lifeos.fold.projects");
    const sessions = localStorage.getItem("lifeos.fold.sessions");
    return projects !== "0" || sessions !== "0";
  } catch { return true; }
}

function ColumnHeader({ label, hint, count, onHide }: { label: string; hint?: string; count?: number; onHide: () => void }) {
  return (
    <div className="flex h-10 shrink-0 items-center gap-1.5 px-2 pl-3">
      <Label className="min-w-0 truncate">{label}</Label>
      {/* 数据统计：列头里的总数（助手/项目/会话各自有多少个），安静地跟在标题后面 */}
      {count !== undefined && (
        <span aria-label={`${label} ${count} 个`} data-shot-mask="column-count" className="inline-flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-hover px-1.5 text-micro font-medium tabular-nums text-ink-700">{count}</span>
      )}
      {hint !== undefined && <span className="min-w-0 truncate text-micro text-ink-500">· {hint}</span>}
      <span className="ml-auto" />
      <IconButton size="sm" label="收起此列" onClick={onHide}><IconChevronLeft size={16} /></IconButton>
    </div>
  );
}

/** 拖宽把手：6px 命中区，hover 才显 2px accent。 */
function DragHandle({ onStart }: { onStart: (event: ReactMouseEvent) => void }) {
  return (
    <div className="group flex w-1.5 shrink-0 cursor-col-resize justify-center" onMouseDown={onStart}>
      <div className="h-full w-px bg-line transition-colors group-hover:bg-accent" />
    </div>
  );
}

/** 读成 data URL 的 base64 部分（不含前缀）。 */
function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      const comma = result.indexOf(",");
      if (comma < 0) reject(new Error("读取图片失败"));
      else resolve(result.slice(comma + 1));
    };
    reader.onerror = () => reject(new Error("读取图片失败"));
    reader.readAsDataURL(file);
  });
}

/**
 * 按 pi-web 上游的档位压缩（docs/design/image-input.md 约束表）：
 * 超过 1MB 才压、最长边 1024、JPEG 0.85；压缩结果由调用方按字节比较，不更小就用原图。
 */
async function fileToImage(file: File): Promise<{ data: string; mimeType: string }> {
  const original = async () => ({ data: await readAsBase64(file), mimeType: file.type });
  if (!shouldCompressImage(file.size, file.type) || typeof createImageBitmap !== "function") return original();
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (bitmap === null) return original();
  try {
    const size = scaledSize(bitmap.width, bitmap.height);
    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext("2d");
    if (context === null) return original();
    context.fillStyle = "#fff";                 // JPEG 无透明：先铺白，否则透明区会变黑
    context.fillRect(0, 0, size.width, size.height);
    context.drawImage(bitmap, 0, 0, size.width, size.height);
    const dataUrl = canvas.toDataURL("image/jpeg", CLIENT_JPEG_QUALITY);
    const comma = dataUrl.indexOf(",");
    const data = comma < 0 ? "" : dataUrl.slice(comma + 1);
    if (data === "") return original();
    return { data, mimeType: "image/jpeg" };
  } catch {
    return original();
  } finally {
    bitmap.close();
  }
}

/** 本地回显的用户消息块：文字在前、图片在后，与后端 messagesOf 的顺序一致。 */
function userBlocks(text: string, images: readonly PendingImage[]): Block[] {
  const blocks: Block[] = [];
  if (text !== "") blocks.push({ type: "text", text });
  for (const image of images) blocks.push({ type: "image", data: image.data, mimeType: image.mimeType });
  return blocks;
}

export default function App() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [agent, setAgent] = useState<Agent>();
  // 用户档案（= 你本人，不是 Agent）：名字与头像从 /api/profile 来，缺失时前端不显示头像
  const [profile, setProfile] = useState<UserProfile | undefined>();
  // 显示偏好（两个滑块）：内容宽度 + 字号，落 localStorage
  const [prefs, setPrefs] = useState<DisplayPrefs>(() => loadPrefs(parsePrefs));
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth);
  const [groups, setGroups] = useState<Group[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>();
  const [sessionId, setSessionId] = useState<string>();
  const [messages, setMessages] = useState<Message[]>([]);
  /** 批注（Task 0003 · P2/P3）：独立于消息的一条状态线，不混进 messages。 */
  const anno = useAnnotations();
  /**
   * 批注落盘（Task 0003 · P5）：边标边存，与发消息解耦。
   * 失败只提示不回滚——批注在本机已可见，丢掉它的代价比"存不上"更大；
   * 下次改动会再写一次（事件流最后一条生效）。
   */
  /** toast 在下面才 useToast()，这里用 ref 转发，避免 TDZ（定义顺序问题）。 */
  const toastRef = useRef<((text: string, tone?: "success" | "error") => void) | undefined>(undefined);

  const persistAnnotation = useCallback((
    op: "add" | "update" | "remove",
    payload: Annotation | { id: string },
    targetSessionId: string | undefined,
  ) => {
    const aid = agent?.id;
    if (aid === undefined || targetSessionId === undefined) return;
    void fetch(`/api/agents/${aid}/sessions/${targetSessionId}/annotations`, {
      method: "POST", headers: { "content-type": "application/json" },
      // ui 是纯展示态，不落盘（见 phases/P5 的"哪些字段落盘"）
      body: JSON.stringify({ op, annotation: op === "remove" ? payload : stripUi(payload as Annotation) }),
    }).then((r) => { if (!r.ok) toastRef.current?.("批注保存失败（本机仍可见，下次改动会重试）", "error"); })
      .catch(() => { toastRef.current?.("批注保存失败（网络错误）", "error"); });
  }, [agent?.id]);

  /** 传给消息体的批注操作（用 useMemo 稳定引用，否则每条消息每帧都重建）。 */
  /**
   * 批注作者：当前用户。id 来自 `/api/profile`（`users/<id>/user.json`，实测 `xu-later`）。
   * 拿不到时退回 "user"——宁可 id 不精确，也不要让 `author` 为空字符串。
   */
  const annoAuthor = useMemo<AnnotationAuthor>(
    () => ({ kind: "user", id: profile?.id ?? "user" }),
    [profile?.id],
  );
  const annoActions = useMemo(() => ({
    add: (anchor: Parameters<typeof anno.add>[0], marks: Parameters<typeof anno.add>[1], note: Parameters<typeof anno.add>[2]) => {
      const id = anno.add(anchor, marks, note, annoAuthor);
      persistAnnotation("add", {
        id, author: annoAuthor, messageId: anchor.messageId, blockIndex: anchor.blockIndex,
        start: anchor.start, end: anchor.end, quote: anchor.quote, marks: [...marks], note,
        ui: { mode: "open", pinned: false, dx: 0, dy: 0 },
      }, sessionId);
      return id;
    },
    setMarks: (id: string, marks: readonly string[]) => {
      anno.setMarks(id, marks);
      const next = anno.annotations.find((a) => a.id === id);
      if (next !== undefined) persistAnnotation("update", { ...next, marks: [...marks] }, sessionId);
    },
    setNote: (id: string, note: string) => {
      anno.setNote(id, note);
      const next = anno.annotations.find((a) => a.id === id);
      if (next !== undefined) persistAnnotation("update", { ...next, note }, sessionId);
    },
    togglePinned: anno.togglePinned, setOffset: anno.setOffset,
    remove: (id: string) => {
      anno.remove(id);
      persistAnnotation("remove", { id }, sessionId);
    },
    open: anno.open,
  }), [anno, annoAuthor, persistAnnotation, sessionId]);

  /**
   * 发送失败时要恢复的批注快照。
   * 为什么需要：点发送时批注会被 clear()，而 sendText 的 fail 路径会把文字回填到输入框——
   * 如果不同时恢复批注，用户就丢了刚写的一批批注（实测会丢）。
   */
  const pendingAnnoRestore = useRef<readonly Annotation[] | undefined>(undefined);

  /** 批注面板折叠态（默认展开）。 */
  const [annoPanelFolded, setAnnoPanelFolded] = useState(false);

  /**
   * 批注列表（表格用）：按"消息顺序 + 段内偏移"排序。
   * 用 messages 的 id 序列当消息顺序，避免按数组下标排（下标会随重渲染变）。
   */
  const annoOrdered = useMemo(() => {
    const order = messages.map((m) => m.id).filter((id): id is string => id !== undefined);
    const rank = (id: string): number => { const at = order.indexOf(id); return at < 0 ? Number.MAX_SAFE_INTEGER : at; };
    return [...anno.annotations].sort((a, b) => {
      const byMessage = rank(a.messageId) - rank(b.messageId);
      if (byMessage !== 0) return byMessage;
      if (a.blockIndex !== b.blockIndex) return a.blockIndex - b.blockIndex;
      return a.start - b.start;
    });
  }, [anno.annotations, messages]);

  
  /**
   * 定位：滚到被批注文字处，并展开那条批注的框。
   * 用 DOM 查询 + scrollIntoView；展开通过 store 的 open()（渲染层会按 id 打开）。
   */
  /**
   * 单击批注列表的一行 = **定位 + 钉住**；再点一次 = 取消钉住。
   * （用户 2026-11-03："不用展示那个定位，单击那一行就是定位，就是盯住，
   *   再次单击就是取消钉住。"）
   *
   * 取消钉住时**不滚到原文**——用户是在"收起来"，再把他拉过去没有道理；
   * 也不清偏移（位置是用户摆的，与钉住无关）。
   */
  const onAnnoRowClick = useCallback((id: string) => {
    const target = anno.annotations.find((a) => a.id === id);
    if (target === undefined) return;
    const wasPinned = target.ui.pinned;
    anno.togglePinned(id);
    if (wasPinned) return;                 // 取消钉住：到此为止
    anno.open(id);
    // 通知渲染层"打开并保持一会儿"（否则鼠标还在表格上，220ms 后就被收掉）
    window.dispatchEvent(new CustomEvent("lifeos:annotation-locate", { detail: { id } }));
    window.requestAnimationFrame(() => {
      const host = document.querySelector(
        `[data-message-id="${target.messageId}"] [data-testid="message-text"][data-block-index="${target.blockIndex}"]`,
      );
      if (host instanceof HTMLElement) host.scrollIntoView({ block: "center", behavior: "smooth" });
    });
  }, [anno]);

  /** 这条批注当前是否钉住（列表行据此高亮，也让"再点一次取消"可被看见）。 */
  const annoPinnedOf = useCallback(
    (id: string) => anno.annotations.find((a) => a.id === id)?.ui.pinned === true,
    [anno.annotations],
  );

  const [input, setInputState] = useState("");
  const [busy, setBusy] = useState(false);
  // —— 图片附件（docs/design/image-input.md）：只存在内存草稿里，发送成功才清空 ——
  const [attachments, setAttachments] = useState<PendingImage[]>([]);
  const attachmentsRef = useRef<PendingImage[]>([]);
  const attachmentSeq = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 输入法组字：组字中/刚提交 100ms 内的 Enter 不发送（照 Pi Web ChatInput 的判定，见 reference-baseline）
  const composingRef = useRef(false);
  const lastCompositionEndRef = useRef(0);
  const busyRef = useRef(false);          // 供回调读的即时 busy（state 有渲染延迟）
  /** busy 属于哪个会话：切会话/切 Agent 后旧 busy 不得拿去对账新会话（C120）。 */
  const busySessionRef = useRef<string | undefined>(undefined);
  const submittingRef = useRef(false);    // 防快速连按 Enter 重复提交
  const lastEventAtRef = useRef(0);       // 心跳：最近一次流事件时间（判断"跑丢了"）
  const lostCheckRef = useRef(false);    // 判丢检查互斥（异步查 running 时不要重入）
  const sentHistoryRef = useRef<string[]>([]);   // 输入历史（↑/↓ 浏览，本进程内）
  const historyIndexRef = useRef(-1);
  // 补发必须走 ref 里的最新 sendText：SSE 订阅只建一次（deps 不含 sessionId），
  // 直接调用闭包里的 sendText 会拿订阅那一帧的 sessionId（实测：内容被静默丢弃／发去旧会话）。
  const sendTextRef = useRef<(raw: string) => void>(() => {});
  // 运行事实（协议 P1·1.4）：三态列表、turn 事件、排队区的唯一事实源；呈现层只读它
  const [runFacts, setRunFacts] = useState(emptyRunFacts);
  /** 每秒 +1：只为让"运行耗时"重算（不触发任何请求、不改数据）。 */
  const [elapsedTick, setElapsedTick] = useState(0);
  /** 服务端给的跨 Agent 聚合（P8-3）；未收到快照前为空，此时只靠当前 Agent 的行。 */
  const [agentAggregate, setAgentAggregate] = useState<Array<{ agentId: string; projectId?: string; running: number; unreadDone: number; unreadError: number }>>([]);
  const runFactsRef = useRef(runFacts);
  runFactsRef.current = runFacts;

  const streamRef = useRef(createStreamState());   // 本轮块槽位（思考/文本/工具按 contentIndex 归并）
  const [phase, setPhase] = useState<Phase>("waiting");
  const [retry, setRetry] = useState<{ attempt: number; maxAttempts: number; delayMs: number; message: string; startedAt: number } | undefined>();
  /**
   * 最近一轮失败前，Pi 自动重试了几次（Task 0007 · A1）。
   * 来源是 `auto_retry_end` 的 `attempt`（Pi CLI 同款：`Retry failed after N attempts`）。
   * 只用于失败块的说明文字；换会话/新回合时清空。
   */
  const [retriedTimes, setRetriedTimes] = useState<number | undefined>();
  /** 左侧本轮槽的"结果/中断"说明：属于这一轮（不属于用户消息） */
  const [turnStatus, setTurnStatus] = useState<{ text: string } | undefined>();
  const [turnStep, setTurnStep] = useState<TurnStep>(1);
  const [turnMetrics, setTurnMetrics] = useState<{ output: number; ttftSeconds: number; tokPerSecond: number }>();
  const turnStartedAtRef = useRef(0);
  const turnFirstTokenAtRef = useRef(0);
  const turnUsageStartRef = useRef<UsageSummary | undefined>(undefined);
  const turnMetricsPendingRef = useRef(false);
  const [meta, setMeta] = useState<SessionMeta | undefined>();
  // 没有会话时，头部也要显示「这个 Agent 的默认模型」；配置保存后由 agents_changed 刷新。
  const [agentDefaultModel, setAgentDefaultModel] = useState<{ provider: string; id: string }>();
  /** 无会话时头部 thinking 段用：新会话将拿到的档位（Agent 配置 → settings → Pi 默认） */
  const [agentDefaultThinking, setAgentDefaultThinking] = useState<string>();
  // 头部状态条 task 段：activeTaskId → 任务标题（Task 0002）；缺失时按需拉一次清单（缺段只显示 ID）。
  const [taskTitles, setTaskTitles] = useState<Record<string, string>>({});
  /** 项目默认 Task 缓存（key = taskTitleKey(agent, project, "default")）：无会话时头部显示它 */
  const [projectDefaultTasks, setProjectDefaultTasks] = useState<Record<string, { id: string; title: string }>>({});
  const [activeTool, setActiveTool] = useState<string>();
  const toast = useToast();
  toastRef.current = toast;
  const [loaded, setLoaded] = useState(false);
  const [showNav, setShowNav] = useFold("agents");
  /*
   * 面板合并（Task 0015 · T15）：项目列 + 会话列 → 一列「项目分组 → 会话」。
   * 折叠键合并为一个 `groups`（P-02 D12）。旧的两个键（projects / sessions）
   * 在启动时迁移一次：任一曾展开过 → groups 展开（宁可多开，不让用户点到死点击）。
   */
  const [showGroups, setShowGroups] = useFold("groups", legacyGroupsOpen());
  const restoreFolds = useRef<{ nav: boolean; groups: boolean } | undefined>(undefined);
  const [showTree, setShowTree] = useFold("tree");
  /**
   * 分组折叠（Task 0015 · T15）：`{ [projectId]: true }` = 该组收起。
   * P-02 D12 说"折叠状态存单键数组"；这里用"只存收起的组"（默认全展开），
   * 因为项目通常 3–5 个，全展开是常态，只记住用户明确收起的那几个更省存储也更直观。
   */
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  const [renaming, setRenaming] = useState<{ sid: string; value: string } | undefined>();
  const [addingProject, setAddingProject] = useState(false);
  const [configAgent, setConfigAgent] = useState<Agent>();
  const isMobile = useIsMobile();
  const [mobileNav, setMobileNav] = useState(false);
  const [mobileNavLevel, setMobileNavLevel] = useState<Level>("agents");
  const mobileHistoryPushed = useRef(false);
  const ignoreMobilePop = useRef(false);
  useAppHeight();
  const [confirm, setConfirm] = useState<{ title: string; message: string; confirmLabel: string; danger?: boolean; run: () => void }>();
  // 会话历史 = 主区视图（v2：不再塞进文件面板查看器槽，避免 200px 挤压与 ≤1280 静默失效）
  const [history, setHistory] = useState<{ sessionId: string; title: string } | undefined>();
  const { panelOpen, setPanelOpen, fileTabs, activeFileTabId, setActiveFileTabId, openFile, closeFileTab, updateTabPrefs } = useFilePanel();
  const { box, beginDrag, viewport, widths } = useColumnWidth({
    folded: { nav: !showNav, groups: !showGroups },
    panelOpen,
    historyOpen: history !== undefined,
  });

  const current = useRef<string | undefined>(undefined);
  const ctx = useRef<{ agentId?: string }>({});
  const selectedProjectRef = useRef<string | undefined>(undefined);
  useEffect(() => { selectedProjectRef.current = selectedProjectId; }, [selectedProjectId]);

  // 批注高亮样式表：标记表驱动，运行时生成（加标记不改代码）。
  // 只建一次；标记表变动时重跑即可。
  useEffect(() => { rebuildHighlightStyles(); }, []);


  // 右侧"与其他 Agent 对话"抽屉：点开工具详情时打开（Task 0013 · M1）
  const [peerTarget, setPeerTarget] = useState<PeerTarget | undefined>(undefined);
  const peerTargetRef = useRef<PeerTarget | undefined>(undefined);
  /** 打开对话抽屉之前右侧面板是否已经开着：关闭抽屉时还原，避免留下空面板。 */
  const panelWasOpenBeforePeer = useRef(false);
  useEffect(() => { peerTargetRef.current = peerTarget; }, [peerTarget]);

  /** 关闭对话抽屉：还原"打开前"的右侧面板状态（用户本来没开面板就一并关掉）。 */
  function closePeerPanel(): void {
    setPeerTarget(undefined);
    if (!panelWasOpenBeforePeer.current) setPanelOpen(false);
  }

  /** 全局事件流的基线序号（快照时取得）：不超过它的事件是快照之前的重放，丢弃。 */
  const baselineRef = useRef(0);
  /** 本连接的 id（PUT /api/events/focus 要带）；断线重连后由新快照更新。 */
  const connectionRef = useRef<string | undefined>(undefined);

  /** 当前活动回合的 turnId（C119）：终态必须匹配它，旧回合的 done 不得关闭新回合。 */
  const activeTurnIdRef = useRef<string | null>(null);
  const streaming = useRef(false);
  const scrollRef = useRef<HTMLElement>(null);
  const followTail = useRef(true);
  const [atBottom, setAtBottom] = useState(true);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { current.current = sessionId; if (sessionId !== undefined && agent !== undefined) writeLast(lastSessionKey(agent.id), sessionId); }, [sessionId, agent?.id]);
  // —— 用户档案（你本人）：取一次；失败不阻断界面（只是没头像/用默认名） ——
  useEffect(() => {
    let alive = true;
    void fetch("/api/profile").then((r) => r.ok ? r.json() : undefined)
      .then((data: { id?: unknown; name?: unknown; avatar?: unknown } | undefined) => {
        if (!alive || data === undefined || typeof data.name !== "string") return;
        const avatar = data.avatar as { revision?: unknown } | null | undefined;
        setProfile({
          // 用户是实体（T9）：id 缺失时用名字兜底（老后端），不影响渲染
          id: typeof data.id === "string" ? data.id : data.name,
          name: data.name,
          avatar: avatar === null || avatar === undefined ? null : { file: "", revision: typeof avatar.revision === "number" ? avatar.revision : 0 },
        });
      })
      .catch(() => undefined);
    return () => { alive = false; };
  }, []);
  // —— 显示偏好：落盘 + 把字号与阅读宽度写到根节点（组件只用 token，不感知缩放） ——
  useEffect(() => { savePrefs(prefs); }, [prefs]);
  useEffect(() => {
    const root = document.documentElement;
    for (const [name, value] of Object.entries(fontVars(prefs.font))) root.style.setProperty(name, value);
    root.style.setProperty("--container-reading-width", widthVar(prefs.width));
  }, [prefs]);
  // 宽度滑块把"铺满"存的是 none，换了窗口大小仍铺满；限宽模式下专注宽度随视口变，这里只跟踪视口供滑块取值
  useEffect(() => {
    const onResize = () => setViewportWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  useEffect(() => { if (sessionId !== undefined) setRunFacts((f) => markViewed(f, sessionId)); }, [sessionId]);   // 成为焦点即清未读（协议 P1·1.4）
  // 焦点上报（任务 0007）：切会话/切 Agent/页面可见性变化 → 服务端据此路由细节流，并在可见时记已读
  useEffect(() => { sendFocus(); }, [agent?.id, sessionId]);
  // 打开/关闭"与其他 Agent 对话"抽屉时也要重报：对端会话要加进/移出 watching
  useEffect(() => { sendFocus(); }, [peerTarget]);
  useEffect(() => {
    const onVisibility = () => sendFocus();
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);
  useEffect(() => { if (agent !== undefined) writeLast(LAST_AGENT, agent.id); }, [agent?.id]);

  // 输入草稿：按会话归属（切会话换草稿、刷新不丢）；发送时清空，失败回填。
  // 还没有会话时（新 Agent / 空项目）草稿挂在 agent+project 上——这就是"新会话草稿"（Pi Web 的 newSessionDraftKey）。
  const draftKey = sessionId ?? (agent !== undefined && selectedProjectId !== undefined ? `${agent.id}/${selectedProjectId}` : undefined);
  useEffect(() => {
    if (draftKey === undefined) { setInputState(""); return; }
    try { setInputState(localStorage.getItem(`${DRAFT_PREFIX}${draftKey}`) ?? ""); } catch { setInputState(""); }
  }, [draftKey]);
  function writeDraftFor(key: string | undefined, text: string) {
    if (key === undefined) return;
    try {
      if (text === "") localStorage.removeItem(`${DRAFT_PREFIX}${key}`);
      else localStorage.setItem(`${DRAFT_PREFIX}${key}`, text);
    } catch { /* 忽略 */ }
  }
  function setInput(text: string) {
    setInputState(text);
    writeDraftFor(draftKey, text);
  }

  // 只在"贴底"时跟随；流式期间直接设 scrollTop（smooth 会追不上 delta，产生抖动）。
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el === null || !followTail.current) return;
    el.scrollTop = el.scrollHeight;
  }, [messages]);

  /** 回到最新：只在用户离开底部时出现；点击后恢复跟随。 */
  function jumpToLatest() {
    const el = scrollRef.current;
    followTail.current = true;
    setAtBottom(true);
    if (el === null) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) el.scrollTop = el.scrollHeight;
    else el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }

  useEffect(() => {
    // URL 三键反映当前状态：切到"没有会话的项目"也要更新（否则刷新会退回旧项目/旧会话）
    if (agent === undefined) return;
    const params = new URLSearchParams();
    params.set("agent", agent.id);
    if (selectedProjectId !== undefined) params.set("project", selectedProjectId);
    if (sessionId !== undefined) params.set("session", sessionId);
    window.history.replaceState(window.history.state, "", `?${params.toString()}`);
  }, [agent?.id, selectedProjectId, sessionId]);

  // 手机表面统一进浏览器 history：nav/history/file 至少各有一个可退的 sentinel。
  // 内部层级变化复用同一个 sentinel；系统返回时退一层，再补一个 sentinel，直到根级关闭。
  const mobileSurface = mobileNav ? "nav" : history !== undefined ? "history" : panelOpen ? "file" : undefined;
  useEffect(() => {
    if (!isMobile) return;
    if (mobileSurface === undefined) { mobileHistoryPushed.current = false; return; }
    const state = { ...(window.history.state ?? {}), lifeosMobile: mobileSurface };
    if (!mobileHistoryPushed.current) {
      window.history.pushState(state, "", window.location.href);
      mobileHistoryPushed.current = true;
    } else {
      window.history.replaceState(state, "", window.location.href);
    }
  }, [isMobile, mobileSurface]);

  useEffect(() => {
    if (!isMobile) return;
    const onPop = () => {
      if (ignoreMobilePop.current) { ignoreMobilePop.current = false; mobileHistoryPushed.current = false; return; }
      if (mobileNav) {
        if (mobileNavLevel !== "agents") {
          setMobileNavLevel(mobileNavLevel === "sessions" ? "projects" : "agents");
          window.history.pushState({ ...(window.history.state ?? {}), lifeosMobile: "nav" }, "", window.location.href);
          mobileHistoryPushed.current = true;
        } else {
          setMobileNav(false);
          mobileHistoryPushed.current = false;
        }
        return;
      }
      if (history !== undefined) { setHistory(undefined); mobileHistoryPushed.current = false; return; }
      if (panelOpen) { setPanelOpen(false); mobileHistoryPushed.current = false; }
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [isMobile, mobileNav, mobileNavLevel, history, panelOpen, setPanelOpen]);

  /** 关闭手机表面：先把状态关掉，再消费 sentinel，避免把应用本身退出。 */
  function dismissMobile(close: () => void) {
    close();
    if (isMobile && mobileHistoryPushed.current) {
      ignoreMobilePop.current = true;
      mobileHistoryPushed.current = false;
      window.history.back();
    }
  }

  /** 手机导航返回：优先消费浏览器历史（系统返回/边缘滑动同一套）；根级关闭。 */
  function mobileNavBack() {
    if (mobileNavLevel === "agents") { dismissMobile(() => setMobileNav(false)); return; }
    if (mobileHistoryPushed.current) window.history.back();
    else setMobileNavLevel(mobileNavLevel === "sessions" ? "projects" : "agents");
  }

  // 右边缘向左滑：和系统返回共用 sentinel；只在已有手机表面时触发，不会退出应用。
  useEdgeBack(isMobile, () => {
    if (mobileHistoryPushed.current) window.history.back();
    else if (mobileNav) mobileNavBack();
    else if (history !== undefined) closeHistory();
    else if (panelOpen) closeFilePanel();
  });

  /** 手机导航入口：有会话时是“返回项目”，无会话时是“打开导航”；都从语义父级开始。 */
  function openMobileNav(level: Level = "agents") {
    if (!isMobile) return;
    setMobileNavLevel(level);
    setMobileNav(true);
  }

  /** 文件面板关闭入口：手机需要消费 history sentinel。 */
  function closeFilePanel() {
    dismissMobile(() => setPanelOpen(false));
  }

  /** 打开完整历史：并排优先；若当前列宽下放不下（history=0），临时把左三列收进导航轨，关闭时恢复。 */
  function openHistory(sid: string, name: string) {
    setPanelOpen(false);
    // Folded 语义：true = 收起。这里试算"三列全开"时的并排空间
    const trial = layout({ viewport, widths, requested: { nav: false, groups: false }, panelOpen: false, historyOpen: true });
    // 并排要"对话够宽"才有意义：对话挤到 560 以下就先把左三列收进导航轨（关闭时恢复）
    if (trial.history === 0 || trial.chat < 560) {
      restoreFolds.current = { nav: showNav, groups: showGroups };
      setShowNav(false); setShowGroups(false);
    }
    setHistory({ sessionId: sid, title: name });
  }
  function closeHistory() {
    dismissMobile(() => {
      setHistory(undefined);
      const previous = restoreFolds.current;
      if (previous !== undefined) {
        restoreFolds.current = undefined;
        setShowNav(previous.nav); setShowGroups(previous.groups);
      }
    });
  }

  // 窗口变窄导致历史列放不下：自动收左三列（保持并排），收起面板
  useEffect(() => {
    if (history === undefined) return;
    if (box.history === 0 && (showNav || showGroups)) {
      restoreFolds.current ??= { nav: showNav, groups: showGroups };
      setShowNav(false); setShowGroups(false);
    }
  }, [history, box.history, showNav, showGroups, setShowNav, setShowGroups]);

  // 面板放不下就收起（视口挤压保护）
  useEffect(() => { if (!isMobile && panelOpen && !box.panelFits) setPanelOpen(false); }, [isMobile, panelOpen, box.panelFits, setPanelOpen]);

  // 输入框自适应：支持 field-sizing 的浏览器走 CSS（composer-autogrow，tokens 定义）；
  // 其余浏览器 JS 兜底，直到高度连续 20 帧稳定才停（避开冷启动时样式未注入的假测量）。
  useEffect(() => {
    const node = inputRef.current;
    if (node === null || "field-sizing" in node.style) return;
    const measure = () => {
      node.style.height = "auto";
      const max = parseFloat(getComputedStyle(node).getPropertyValue("--composer-max-height")) || 176;
      node.style.height = `${Math.min(node.scrollHeight, max)}px`;
    };
    let stable = 0;
    let prev = "";
    let rafId = 0;
    const tick = () => {
      measure();
      stable = node.style.height === prev ? stable + 1 : 0;
      prev = node.style.height;
      if (stable < 20) rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [input]);

  async function fetchGroups(id: string): Promise<Group[]> {
    const projects = (await (await fetch(`/api/agents/${id}/projects`)).json()) as { items: Project[] };
    return await Promise.all(projects.items.map(async (project) => {
      const list = (await (await fetch(`/api/agents/${id}/projects/${project.id}/sessions`)).json()) as { items: SessionItem[] };
      return { project, sessions: list.items };
    }));
  }

  async function loadMessages(id: string, sid: string) {
    const data = await (await fetch(`/api/agents/${id}/sessions/${sid}`)).json() as {
      messages: Message[]; meta?: SessionMeta; integrity?: { orphanParents?: number };
    };
    // 会话文件引用断裂（C117）：消息可能"消失"，明确告诉用户，不要静默
    if ((data.integrity?.orphanParents ?? 0) > 0) {
      toast(`会话文件存在断裂分支（${data.integrity?.orphanParents} 处），部分消息可能不显示；已记录日志`, "error");
    }
    followTail.current = true;
    setAtBottom(true);
    setMessages(data.messages ?? []);
    // 批注存在会话 custom entry 里，不在 messages 投影中 → 单独拉一次（Task 0003 · P5）
    void fetch(`/api/agents/${id}/sessions/${sid}/annotations`)
      .then((r) => (r.ok ? r.json() : undefined))
      .then((payload: { annotations?: Annotation[] } | undefined) => {
        if (payload?.annotations === undefined) return;
        // 服务端只存数据字段，ui 用默认值补齐（展开、未钉住、默认位置）
        anno.replaceAll(payload.annotations.map((a) => ({
          ...a,
          ui: { mode: "open" as const, pinned: false, dx: 0, dy: 0 },
        })));
      })
      .catch(() => { /* 拉不到就当没有批注：不阻塞会话打开 */ });
    if (data.meta !== undefined) setMeta(data.meta);
    if (turnMetricsPendingRef.current && current.current === sid && data.meta?.usage !== undefined && turnUsageStartRef.current !== undefined) {
      const output = Math.max(0, data.meta.usage.output - turnUsageStartRef.current.output);
      const started = turnFirstTokenAtRef.current === 0 ? turnStartedAtRef.current : turnFirstTokenAtRef.current;
      const seconds = Math.max(0.1, (Date.now() - started) / 1000);
      const ttft = turnFirstTokenAtRef.current === 0 ? 0 : Math.max(0, (turnFirstTokenAtRef.current - turnStartedAtRef.current) / 1000);
      turnMetricsPendingRef.current = false;
      setTurnMetrics({ output, ttftSeconds: ttft, tokPerSecond: output / seconds });
    }
    return data;
  }

  /** 只刷新头部 meta（模型/思考级别/是否在跑）：不重载消息，避免打断正在流的那一轮。 */
  async function refreshMeta(id: string, sid: string) {
    const data = await (await fetch(`/api/agents/${id}/sessions/${sid}`)).json() as {
      meta?: SessionMeta;
    };
    if (data.meta !== undefined) setMeta(data.meta);
  }

  /** 无会话时刷新头部默认模型；配置保存会广播 agents_changed，最终走到这里。 */
  // 运行态定期对账（2026-10-26）：`done` 事件可能漏掉（标签页后台被节流、半开连接、
  // 或客户端乱序守卫丢弃），而心跳正常时看门狗不会重连，绿色呼吸点就永久亮着。
  // 服务端持事实，所以每 30 秒用 /api/runtime 收敛一次；只动运行态，不碰未读与归属。
  useEffect(() => {
    let cancelled = false;
    const reconcileRunning = async () => {
      if (document.visibilityState !== "visible") return;   // 后台标签页不做无意义请求
      const response = await fetch("/api/runtime").catch(() => undefined);
      if (cancelled || response?.ok !== true) return;
      const data = await response.json().catch(() => undefined) as { running?: Array<{ sessionId: string; agentId?: string; projectId?: string }> } | undefined;
      if (cancelled || data?.running === undefined) return;
      setRunFacts((facts) => applyRunningFacts(facts, data.running ?? [], Date.now()));
    };
    const timer = window.setInterval(() => { void reconcileRunning(); }, RUN_RECONCILE_MS);
    void reconcileRunning();                                  // 打开页面先对一次
    return () => { cancelled = true; window.clearInterval(timer); };
  }, []);

  /**
   * 运行耗时的本地心跳（任务 0005）：每秒让"在跑多久"重算一次。
   * 只在**真有会话在跑**时才启动 —— 空闲页面上不该有每秒的 setState。
   */
  useEffect(() => {
    const anyRunning = groups.some((group) => group.sessions.some((item) => item.activity.state === "running"));
    if (!anyRunning) return;
    const timer = window.setInterval(() => setElapsedTick((n) => n + 1), ELAPSED_TICK_MS);
    return () => window.clearInterval(timer);
  }, [groups]);

  async function refreshAgentDefaultModel(id: string) {
    const response = await fetch(`/api/agents/${id}/config`).catch(() => undefined);
    const data = response?.ok === true
      ? await response.json().catch(() => ({})) as {
        config?: { defaultProvider?: string; defaultModel?: string } | null;
        effective?: { defaultProvider?: string; defaultModel?: string; thinkingLevel?: string } | null;
      }
      : {};
    if (ctx.current.agentId !== id) return;
    // 有效默认：后端已按 Agent 配置 → 系统 settings → 模型清单第一项裁决；
    // 个人配置为空的**新 Agent** 也要显示系统/清单默认，不能再只读 config。
    const effective = data.effective;
    const config = data.config;
    const source = effective ?? config;
    setAgentDefaultModel(
      source?.defaultProvider !== undefined && source.defaultModel !== undefined
        ? { provider: source.defaultProvider, id: source.defaultModel }
        : undefined,
    );
    // 档位与模型同源显示：无会话时它表示"新会话将用哪个档位"，不是编造的值（后端给的就是 Pi 的解析结果）
    setAgentDefaultThinking(typeof effective?.thinkingLevel === "string" ? effective.thinkingLevel : undefined);
  }

  function pickLatest(list: SessionItem[]): SessionItem | undefined {
    return [...list].sort((a, b) => (a.time.lastActivityAt < b.time.lastActivityAt ? 1 : -1))[0];
  }

  /** 归档助手 = 从列表移除（数据全留）；当前选中的被删时回落到第一个。 */
  async function removeAgent(item: Agent) {
    const response = await fetch(`/api/agents/${item.id}`, { method: "DELETE" });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}) as { error?: { message?: string } });
      toast(body.error?.message ?? "删除失败", "error");
      return;
    }
    const next = agents.filter((entry) => entry.id !== item.id);
    setAgents(next);
    toast(`已归档「${item.name}」（会话与记录全部保留，可恢复）`);
    if (agent?.id === item.id && next[0] !== undefined) await selectAgent(next[0]);
  }

  /** 换会话与开草稿共用的清理：流、历史、状态条、busy 归零；消息清空。
   *  `current` / `sessionId` 由调用方设置——两者必须同步生效，异步结果据此判断“是否已切走”（C120）。 */
  function resetChatState() {
    setHistory(undefined);
    setTurnMetrics(undefined);
    turnMetricsPendingRef.current = false;
    streamRef.current = createStreamState();
    setPhase("waiting");
    setRetry(undefined);
    setRetriedTimes(undefined);   // 换会话/开草稿：上一轮的重试次数不再适用于新会话
    setTurnStatus(undefined);
    setActiveTool(undefined);
    activeTurnIdRef.current = null;
    busySessionRef.current = undefined;
    busyRef.current = false;
    streaming.current = false;
    setBusy(false);
    setMessages([]);
    setMeta(undefined);
  }

  async function openSession(a: Agent, sid: string) {
    resetChatState();
    setSessionId(sid);
    current.current = sid;                 // 同步生效：下面的异步结果据此判断"是否已切走"（C120）
    const data = await loadMessages(a.id, sid);
    // 切回来时这一轮可能还在跑：必须恢复生成态，否则下一条会被当成"新回合"（C120）
    if (current.current === sid && data?.meta?.running === true) {
      busyRef.current = true;
      busySessionRef.current = sid;
      setBusy(true);
      setTurnStep(3);
      lastEventAtRef.current = Date.now();
      streaming.current = data.messages.length > 0 && data.messages[data.messages.length - 1]?.role === "assistant";
    } else if (current.current === sid) {
      setRunFacts((f) => settleStopped(f, sid, Date.now()));   // 服务端说不在跑：清掉可能残留的运行点
      // 最近一轮若是被中断（lost）：状态条给出原因，而不是只剩一个"重新发送"按钮（任务 0006）
      // Task 0007：提示与按钮同源——`turnNoticeOf()` 与 `resendPlan()` 向 `turnOutcomeOf()` 问同一个问题；
      // 此处服务端已说不在跑（上面 running 分支进不来），所以 busy=false，提示提按钮时按钮一定在。
      void fetch(`/api/agents/${a.id}/sessions/${sid}/turns/last`)
        .then((response) => (response.ok ? response.json() as Promise<{ turn?: { state: string } | null }> : undefined))
        .then((body) => {
          if (current.current !== sid) return;
          const notice = turnNoticeOf({ outcome: outcomeOfTurn(body?.turn), busy: false });
          if (notice !== undefined) setTurnStatus(notice);
        })
        .catch(() => undefined);
    }
    // 打开会话也要保证“有效默认”已加载：顶部在非覆盖分支显示它。
    void refreshAgentDefaultModel(a.id);
  }

  async function selectAgent(a: Agent) {
    setAgent(a);
    ctx.current = { agentId: a.id };
    current.current = undefined;
    activeTurnIdRef.current = null;
    busySessionRef.current = undefined;
    busyRef.current = false;
    streaming.current = false;
    setBusy(false);
    setSessionId(undefined);
    setMessages([]);
    setMeta(undefined);
    setAgentDefaultModel(undefined);
    setShowGroups(true);
    void refreshAgentDefaultModel(a.id);
    const next = await fetchGroups(a.id);
    rememberGroups(a.id, next);
    setGroups(next);
    const remembered = readLast(lastSessionKey(a.id));
    const owner = next.find((group) => group.sessions.some((item) => item.sessionId === remembered));
    const home = owner ?? next.find((group) => group.project.isDefault) ?? next[0];
    setSelectedProjectId(home?.project.id);
    const target = (remembered !== undefined && owner !== undefined ? remembered : undefined) ?? pickLatest(home?.sessions ?? [])?.sessionId;
    if (target !== undefined) await openSession(a, target);
  }

  async function selectProject(project: Project) {
    if (agent === undefined) return;
    setHistory(undefined);
    setSelectedProjectId(project.id);
    setShowGroups(true);
    setSessionId(undefined);
    setMessages([]);
    setMeta(undefined);
    void refreshAgentDefaultModel(agent.id);
    const group = groups.find((item) => item.project.id === project.id);
    const latest = pickLatest(group?.sessions ?? []);
    if (latest !== undefined) await openSession(agent, latest.sessionId);
  }

  async function reloadGroups() {
    const id = ctx.current.agentId;
    if (id === undefined) return undefined;
    const next = await fetchGroups(id);
    rememberGroups(id, next);
    setGroups(next);
    return next;
  }

  /** 记下列表里每个会话属于哪个 Agent（Agent 级注意点用）。 */
  function rememberGroups(agentId: string, next: Group[]): void {
    setRunFacts((f) => rememberMeta(f, next.flatMap((group) => group.sessions.map((item) => ({ sessionId: item.sessionId, agentId, projectId: group.project.id })))));
  }

  // —— 全局事件流（任务 0007）——
  // 一条连接承载所有 Agent：回合级事件（turn/done/error/agents_changed）发给所有连接，细节事件只给焦点。
  // 分流规则在 event-router.ts（纯函数，有测试）；这里只执行动作。
  // 处理函数每次渲染都换新（读到最新的 agent/会话/列表），由 ref 转发——EventSource 全局只建一次。
  // 被动订阅者（右侧"与其他 Agent 对话"面板要自己挑属于对端会话的事件）。
  // 复用同一条 SSE 连接：服务端把对端会话加进 focus.watching 后，细节事件本来就会推到这里。
  const liveSubscribers = useRef<Set<(event: unknown) => void>>(new Set());
  const liveEvents = useRef({
    subscribe(listener: (event: unknown) => void) {
      liveSubscribers.current.add(listener);
      return () => { liveSubscribers.current.delete(listener); };
    },
  }).current;

  const streamHandlers = useRef<{ snapshot: (snapshot: StreamSnapshot) => void; event: (payload: AgentEvent) => void } | undefined>(undefined);
  streamHandlers.current = { snapshot: onStreamSnapshot, event: onStreamEvent };

  useEffect(() => {
    let stream: EventSource | undefined;
    let lastSeen = Date.now();
    // 建立（或重建）连接：每次都从新快照开始（服务端快照优先，C119/任务 0007）
    const connect = () => {
      stream?.close();
      lastSeen = Date.now();
      stream = new EventSource("/api/events");
      logger.info("transport", "sse-open", {});
      const touch = () => { lastSeen = Date.now(); };
      stream.addEventListener("ping", touch);
      stream.addEventListener("snapshot", (event) => {
        touch();
        logger.debug("transport", "sse-snapshot");   // debug 只本地，不上报
        streamHandlers.current?.snapshot(JSON.parse((event as MessageEvent).data) as StreamSnapshot);
      });
      for (const name of STREAM_EVENT_NAMES) {
        stream.addEventListener(name, (event) => {
          touch();
          const data = (event as MessageEvent).data;
          // 连接级 error（没有 data）不是服务端事件：交给看门狗与 EventSource 自身的重连
          if (typeof data !== "string" || data === "") return;
          const parsed = JSON.parse(data) as AgentEvent;
          streamHandlers.current?.event(parsed);
          for (const listener of liveSubscribers.current) listener(parsed);
        });
      }
    };
    connect();
    // 看门狗：经代理的断开可能不触发 error，EventSource 不会自己重连 → 陈旧就主动重建
    const watchdog = setInterval(() => {
      if (stream === undefined) return;
      if (stream.readyState === EventSource.CLOSED || isStreamStale(lastSeen, Date.now(), STREAM_STALE_MS)) {
        logger.warn("transport", "sse-stale", { readyState: stream.readyState });
        connect();
      }
    }, STREAM_WATCHDOG_MS);
    return () => {
      clearInterval(watchdog);
      stream?.close();
    };
  }, []);

  /** 焦点上报的当前值（只读 ref，任何时候调用都是最新的）。 */
  function currentFocus(): RouteFocus {
    return { agentId: ctx.current.agentId, sessionId: current.current, visible: document.visibilityState === "visible" };
  }

  /** 把焦点告诉服务端（细节流路由 + 可见时记已读）。连接未建立时跳过，连接建立后快照里会再报一次。 */
  function sendFocus(): void {
    const connectionId = connectionRef.current;
    if (connectionId === undefined) return;
    const focus = currentFocus();
    void fetch("/api/events/focus", {
      method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        connectionId, agentId: focus.agentId, sessionId: focus.sessionId, visible: focus.visible,
        // 右侧正在看的对端会话：它的 delta/tool 事件也要投到这个连接（服务端 focus.watching）
        ...(peerTargetRef.current !== undefined
          ? { watching: [{ agentId: peerTargetRef.current.agentId, sessionId: peerTargetRef.current.sessionId }] }
          : {}),
      }),
    }).catch(() => undefined);
  }

  /** 快照（连接即发，之后只推快照之后的事件）：运行与未读以服务端为准；当前会话在跑则补齐消息。 */
  function onStreamSnapshot(snapshot: StreamSnapshot): void {
    connectionRef.current = snapshot.connectionId;
    baselineRef.current = snapshot.seq;
    setRunFacts((f) => applySnapshotFacts(f, { running: snapshot.running, unread: snapshot.unread }, Date.now()));
    setAgentAggregate(snapshot.aggregate ?? []);
    (window as unknown as { __agg?: unknown }).__agg = { got: snapshot.aggregate, keys: Object.keys(snapshot) };
    lastEventAtRef.current = Date.now();
    const aid = ctx.current.agentId;
    const cur = current.current;
    const here = snapshot.running.find((entry) => entry.agentId === aid && entry.sessionId === cur);
    // 断线重连时快照说"不在跑"但本会话 UI 还在生成态 → 只有 busy 属于当前会话才收尾（C120）
    if (here === undefined && busyRef.current && busyBelongsTo(busySessionRef.current, cur)) {
      void reconcileLostRun("运行已中断（连接恢复时该会话已不在运行）");
    }
    if (here !== undefined) {
      activeTurnIdRef.current = here.turnId ?? null;
      if (!busyRef.current && aid !== undefined && cur !== undefined) {
        // 这一轮在后台跑着（或断线期间跑着）：补齐已生成的内容，之后的 delta 由焦点流接上
        void loadMessages(aid, cur).then((data) => {
          if (current.current === cur && data !== undefined) streaming.current = data.messages[data.messages.length - 1]?.role === "assistant";
        });
      }
    }
    busyRef.current = here !== undefined;
    busySessionRef.current = here !== undefined ? cur : undefined;
    setBusy(here !== undefined);
    sendFocus();
  }

  /** 一条事件：路由为动作，逐个执行。 */
  function onStreamEvent(payload: AgentEvent): void {
    if (payload.agentId !== undefined && "sessionId" in payload && typeof payload.sessionId === "string") {
      const sessionId = payload.sessionId;
      const agentId = payload.agentId;
      const projectId = "projectId" in payload && typeof payload.projectId === "string" ? payload.projectId : undefined;
      setRunFacts((f) => rememberMeta(f, [{ sessionId, agentId, projectId }]));
    }
    for (const action of routeEvent(payload as unknown as RouteEvent, currentFocus(), baselineRef.current)) runStreamAction(action, payload);
  }

  /**
   * 一行的局部补丁（任务 0005）：**只重建那一行**，其余行引用不变。
   *
   * 为什么不是 reloadGroups：那样一个字段变化要 1+N 次请求、每次全扫 JSONL
   * （实测 60ms / 5,999B）。这里只做对象合并，零请求。
   *
   * `running` / `unread` / `failure` 传 `null` 表示"清掉"（终态会发 `running: null`）。
   */
  function applyRowPatch(agentId: string, sessionId: string, patch: RowPatchPayload | undefined, projectId?: string): void {
    if (patch === undefined || patch === null) return;
    if (agentId !== ctx.current.agentId) return;   // 别的 Agent 的行不在当前列表里
    // 删除：把这一行移出列表（别的标签页删了它，这边要跟着消失）。
    // 只删这一行，不重取整个列表 —— 与其它补丁一致。
    if (patch.removed === true) {
      setGroups((previous) => previous.map((group) => {
        if (!group.sessions.some((item) => item.sessionId === sessionId)) return group;
        return { ...group, sessions: group.sessions.filter((item) => item.sessionId !== sessionId) };
      }));
      // 数字也要减：助手行/项目行的徽标来自服务端聚合，删除补丁不会触发重发快照，
      // 不在这里减的话，行消失了但数字还在（用户实测：「删了一个未读，数量没有减少」）。
      // `was` 由服务端判定（与 aggregateStatus 共用 aggregateSlotOf），前端不自己推算。
      const was = patch.was;
      if (was !== undefined) {
        setAgentAggregate((previous) => previous.map((entry) => {
          if (entry.agentId !== agentId) return entry;
          if (projectId !== undefined && entry.projectId !== projectId) return entry;
          const next = { ...entry, [was]: Math.max(0, entry[was] - 1) };
          return next;
        }).filter((entry) => entry.running + entry.unreadDone + entry.unreadError > 0));
      }
      return;
    }
    setGroups((previous) => {
      let touched = false;
      const next = previous.map((group) => {
        const index = group.sessions.findIndex((item) => item.sessionId === sessionId);
        if (index === -1) return group;
        touched = true;
        const current = group.sessions[index]!;
        const activity = { ...current.activity };
        if ("running" in patch) {
          if (patch.running === null) { delete activity.running; if (activity.state === "running") activity.state = "idle"; }
          else if (patch.running !== undefined) {
            activity.running = { ...patch.running, elapsedMs: Math.max(0, Date.now() - Date.parse(patch.running.since)) };
            activity.state = "running";
          }
        }
        if ("unread" in patch) {
          if (patch.unread === null) { delete activity.unread; if (activity.state === "unread") activity.state = "idle"; }
          else if (patch.unread !== undefined) { activity.unread = patch.unread; if (activity.running === undefined) activity.state = "unread"; }
        }
        if ("failure" in patch) {
          if (patch.failure === null) { delete activity.failure; if (activity.state === "failure") activity.state = "idle"; }
          else if (patch.failure !== undefined) { activity.failure = patch.failure; if (activity.running === undefined) activity.state = "failure"; }
        }
        const sessions = [...group.sessions];
        sessions[index] = {
          ...current,
          activity,
          ...(patch.title !== undefined ? { title: patch.title } : {}),
          ...("task" in patch ? { task: patch.task ?? null } : {}),
          ...(patch.lastActivityAt !== undefined ? { time: { ...current.time, lastActivityAt: patch.lastActivityAt } } : {}),
        };
        return { ...group, sessions };
      });
      return touched ? next : previous;
    });
  }

  function runStreamAction(action: RouteAction, payload: AgentEvent): void {
    switch (action.kind) {
      case "drop":
        return;
      case "run": {
        setRunFacts((f) => applyRunEvent(f, payload as never, Date.now(), current.current));
        if (payload.type === "turn" && "sessionId" in payload && payload.sessionId === current.current) applyFocusedTurn(payload);
        return;
      }
      case "message":
        if (payload.type === "done") return finishFocused(payload, "done");
        if (payload.type === "error") return finishFocused(payload, "error");
        if (payload.type === "retrying") return applyRetrying(payload);
        if (payload.type === "retry_end") {
          lastEventAtRef.current = Date.now();
          // Pi 的 auto_retry_end 带着"试到第几次"与最终错误（agent-session.ts:1966-1969）；
          // Pi CLI 用它说 "Retry failed after N attempts: <原因>"（interactive-mode.ts:3768）。
          // 留下来给失败块用：否则用户只看到"超时了"，不知道系统已经自动试过 N 次。
          if (payload.success !== true && typeof payload.attempt === "number") setRetriedTimes(payload.attempt);
          setRetry(undefined);
          return;
        }
        applyStreamMessage(payload);
        return;
      case "refresh-groups":
        if (action.agentId === ctx.current.agentId) void reloadGroups();   // 列表的运行点/未读点随之刷新
        return;
      case "completion": {
        const sid = action.sessionId;
        const agentName = agents.find((item) => item.id === action.agentId)?.name ?? "助手";
        const known = groups.flatMap((group) => group.sessions).find((item) => item.sessionId === sid)?.title.display;
        const announce = (label: string) => toast(`${agentName} · ${label} ${action.outcome === "done" ? "已完成" : "失败"}`, action.outcome === "done" ? "success" : "error", {
          label: "查看",
          run: () => void openFromNotice(action.agentId, sid),
        });
        if (known !== undefined && known !== "") { announce(known.slice(0, 24)); return; }
        // 后台 Agent 的列表没有加载：按需取该 Agent 的会话标题（取不到就用短 id，提示照常出现）
        void fetch(`/api/agents/${action.agentId}/sessions`)
          .then((response) => (response.ok ? response.json() as Promise<{ items: Array<{ sessionId: string; title?: { raw: string; display: string } }> }> : undefined))
          .then((body) => {
            const title = body?.items.find((item) => item.sessionId === sid)?.title?.display;
            announce(title !== undefined && title !== "" ? title.slice(0, 24) : `会话 ${sid.slice(-6)}`);
          })
          .catch(() => announce(`会话 ${sid.slice(-6)}`));
        return;
      }
      case "row":
        applyRowPatch(action.agentId, action.sessionId, action.patch as RowPatchPayload, action.projectId);
        return;
      case "agents-changed":
        void onAgentsChanged();
        return;
    }
  }

  /** 焦点会话的一轮开始/结束（回合级事件里属于当前会话的部分）。 */
  function applyFocusedTurn(payload: AgentEvent): void {
    if (payload.type !== "turn" || !("turnId" in payload)) return;
    if (payload.state === "running") {
      activeTurnIdRef.current = payload.turnId;
      busyRef.current = true;
      busySessionRef.current = current.current;
      setBusy(true);
    } else if (activeTurnIdRef.current === payload.turnId) activeTurnIdRef.current = null;
  }

  /** 细节事件（delta/thinking/tool_* …）：焦点会话的消息管道（一条助手消息里的块有序，交给 stream-blocks 归并）。 */
  function applyStreamMessage(payload: AgentEvent): void {
    lastEventAtRef.current = Date.now();
    if (turnFirstTokenAtRef.current === 0) turnFirstTokenAtRef.current = Date.now();
    const tailIsStreaming = streaming.current;
    if (!tailIsStreaming) streamRef.current = createStreamState();   // 前一条不是本轮的占位消息 → 从空状态起
    const next = applyStreamEvent(streamRef.current, payload as never);
    streamRef.current = next;
    setPhase(next.phase);
    setActiveTool(next.activeTool);
    const blocks = blocksOfStream(next);
    // 最终回答取最后一段 text；过程文本仍在 blocks 里可见，不把整轮块拼成一个答案。
    const text = finalTextOfStream(next) || textOfBlocks(blocks);
    busyRef.current = true;
    busySessionRef.current = current.current;
    setBusy(true);
    streaming.current = true;
    setMessages((list) => {
      const last = list[list.length - 1];
      if (!tailIsStreaming || last === undefined || last.role !== "assistant") {
        return [...list, { role: "assistant", text, blocks, streaming: true }];
      }
      return [...list.slice(0, -1), { ...last, text, blocks, streaming: true }];
    });
  }

  /** Pi 的自动重试：显示"失败原因 + 第几次/共几次"。 */
  function applyRetrying(payload: AgentEvent): void {
    if (payload.type !== "retrying") return;
    const data = payload as unknown as { attempt: number; maxAttempts: number; delayMs: number; message: string };
    lastEventAtRef.current = Date.now();
    setRetry({ attempt: data.attempt, maxAttempts: data.maxAttempts, delayMs: data.delayMs, message: data.message, startedAt: Date.now() });
    busyRef.current = true;
    busySessionRef.current = current.current;
    setBusy(true);
  }

  /** 焦点会话的终态：收尾生成态、按需重载消息。非焦点的终态已由路由转成完成提示。 */
  function finishFocused(payload: AgentEvent, outcome: "done" | "error"): void {
    const turnId = "turnId" in payload ? payload.turnId : undefined;
    if (isStaleTerminal(turnId, activeTurnIdRef.current)) return;
    if (outcome === "error" && "message" in payload) {
      const data = payload as unknown as { message?: string; kind?: FailureKind };
      toast(`${failureLabel(data.kind)}${data.message === undefined ? "" : ` · ${data.message}`}`, "error");
    }
    activeTurnIdRef.current = null;
    busySessionRef.current = undefined;
    streaming.current = false;
    busyRef.current = false;
    setBusy(false);
    setTurnStep(4);
    setRetry(undefined);
    const elapsed = Math.max(1, Math.round((Date.now() - turnStartedAtRef.current) / 1000));
    setTurnStatus({ text: `4/4 · ${outcome === "done" ? "完成" : "失败"} · ${elapsed}s` });
    if (current.current !== undefined && ctx.current.agentId !== undefined) void loadMessages(ctx.current.agentId, current.current);
  }

  /** 从完成提示切过去：切 Agent（如需）→ 项目 → 会话。 */
  async function openFromNotice(agentId: string, sessionId: string): Promise<void> {
    const target = agents.find((item) => item.id === agentId);
    if (target === undefined) return;
    await selectAgent(target);
    const next = await fetchGroups(agentId);
    rememberGroups(agentId, next);
    setGroups(next);
    const owner = next.find((group) => group.sessions.some((item) => item.sessionId === sessionId));
    if (owner !== undefined) setSelectedProjectId(owner.project.id);
    await openSession(target, sessionId);
  }

  /** 助手列表变化（新建/归档，工具与 HTTP 都会广播）→ 自动重取，无需手动刷新。 */
  async function onAgentsChanged(): Promise<void> {
    const data = (await (await fetch("/api/agents")).json()) as { items: Agent[] };
    setAgents(data.items);
    if (agent !== undefined && !data.items.some((item) => item.id === agent.id) && data.items[0] !== undefined) {
      await selectAgent(data.items[0]);
    } else {
      const next = await reloadGroups();   // 项目/会话也可能变了（lifeos_project_* 工具的写操作走这条），不刷新=没闭环
      const pid = selectedProjectRef.current;
      if (next !== undefined && pid !== undefined && !next.some((g) => g.project.id === pid)) {
        // 当前项目被工具/别处移除：立即回退到默认/第一个项目，不把选中态留在已删除项目上
        const fallback = next.find((g) => g.project.isDefault) ?? next[0];
        if (fallback !== undefined && agent !== undefined) {
          setSelectedProjectId(fallback.project.id);
          const latest = pickLatest(fallback.sessions);
          if (latest !== undefined) await openSession(agent, latest.sessionId);
          else { setSessionId(undefined); setMessages([]); setMeta(undefined); }
        } else {
          setSelectedProjectId(undefined);
          setSessionId(undefined);
          setMessages([]);
          setMeta(undefined);
        }
      } else if (next !== undefined && current.current !== undefined && !next.some((g) => g.sessions.some((s) => s.sessionId === current.current))) {
        // 当前会话被工具/别处删除：回退到该项目最新会话，没有就清空
        const group = next.find((g) => g.project.id === pid);
        const latest = pickLatest(group?.sessions ?? []);
        if (latest !== undefined && agent !== undefined) await openSession(agent, latest.sessionId);
        else { setSessionId(undefined); setMessages([]); setMeta(undefined); }
      }
      // 默认模型可能变了（配置保存）→ 无会话时刷新默认模型；有会话时刷新 meta
      if (ctx.current.agentId !== undefined) {
        void refreshAgentDefaultModel(ctx.current.agentId);
        if (!busyRef.current && current.current !== undefined) void refreshMeta(ctx.current.agentId, current.current);
      }
    }
  }

  // 页面唤醒 / 网络恢复时以后端为准对账（C119，对齐 pi-web 的 visibility/online reconcile）：
  // 不依赖事件重放；只问"这一轮还在跑吗"，不在跑就交给 reconcileLostRun（完成/中断三分支）。
  useEffect(() => {
    const reconcileTransport = () => {
      const aid = ctx.current.agentId;
      const sid = busySessionRef.current;
      if (aid === undefined || sid === undefined || !busyRef.current || sid !== current.current) return;
      void (async () => {
        try {
          const data = await (await fetch(`/api/agents/${aid}/sessions/${sid}`)).json() as { meta?: { running?: boolean } };
          if (data.meta?.running === true) return;
          void reconcileLostRun("连接恢复：后端已不再运行这一轮", { agentId: aid, sessionId: sid });
        } catch { /* 网络还没恢复：等下一次 */ }
      })();
    };
    const onVisibility = () => { if (document.visibilityState === "visible") reconcileTransport(); };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("online", reconcileTransport);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("online", reconcileTransport);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent?.id, sessionId]);

  // 首屏：URL 三键 > 上次会话 > 上次 agent > 第一个 agent
  useEffect(() => {
    void (async () => {
      const params = new URLSearchParams(window.location.search);
      const wantAgent = params.get("agent");
      const wantProject = params.get("project");
      const wantSession = params.get("session");
      const data = (await (await fetch("/api/agents")).json()) as { items: Agent[] };
      setAgents(data.items);
      const found = data.items.find((item) => item.id === wantAgent)
        ?? data.items.find((item) => item.id === readLast(LAST_AGENT))
        ?? data.items[0];
      if (found === undefined) { setLoaded(true); return; }
      setAgent(found);
      ctx.current = { agentId: found.id };
      void refreshAgentDefaultModel(found.id);
      const groups = await fetchGroups(found.id);
      setGroups(groups);
      // URL 指定了项目 = 用户明确要看这个项目：只在这个项目里找会话，不拿别的项目"记住的会话"顶上
      // （2026-10-19 实测：?project=<空项目> 会被上次的 workspace 会话顶掉）
      const wantGroup = wantProject === null ? undefined : groups.find((g) => g.project.id === wantProject);
      const remembered = readLast(lastSessionKey(found.id));
      const candidates = (wantGroup === undefined
        ? [wantSession, remembered]
        : [wantSession, ...wantGroup.sessions.map((session) => session.sessionId)]
      ).filter((value): value is string => value !== null && value !== undefined);
      const group = wantGroup
        ?? groups.find((g) => g.sessions.some((session) => candidates.includes(session.sessionId)))
        ?? groups.find((g) => g.project.isDefault) ?? groups[0];
      setSelectedProjectId(group?.project.id);
      // URL 给了项目、没给会话 = 草稿（点过“新建会话”的状态）：不打开任何会话（2026-10-29 决策）。
      // 完全没有参数时仍走下面的“接着上次会话”，不改打开应用的习惯。
      if (wantGroup !== undefined && wantSession === null) { setLoaded(true); return; }
      const target = candidates.find((sid) => group?.sessions.some((session) => session.sessionId === sid)) ?? pickLatest(group?.sessions ?? [])?.sessionId;
      if (target !== undefined) await openSession(found, target);
      setLoaded(true);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** 新建会话 = 前端草稿：只清空聊天区，不建任何服务端会话（2026-10-29 用户拍板）。
   *  参考 Pi Web `components/AppShell.tsx:901-954 handleNewSession`：点“新建会话”零请求，首条消息才建会话。
   *  已经处于草稿时不再重复（三个入口已禁用，这里只是兜底）：判据 `sessionId === undefined`。 */
  function newSession() {
    if (agent === undefined || sessionId === undefined) return;
    resetChatState();
    setSessionId(undefined);      // draftKey 随之落到 agent/project；URL 去 session
    current.current = undefined;
    setShowGroups(true);
    // 桌面把光标放进输入框；手机不抢焦点，否则会弹键盘（参考 Pi Web AppShell.tsx:945-953）。
    if (!isMobile) requestAnimationFrame(() => inputRef.current?.focus());
  }

  /**
   * 在**指定的项目**下开新会话草稿（Task 0006）。
   *
   * 与 `newSession()` 的差别只有一件事：归属由参数决定，不由 `selectedProjectId` 的现值决定。
   * 为什么这样更可靠：入口长在那个项目的分组头里，"点谁就在谁下面开"不再依赖"上次选中了谁"；
   * 改前点会话行/点其他分组头都不会改 `selectedProjectId`，于是草稿会落回上一个项目。
   *
   * 为什么不用 `selectProject()`：它会 `openSession(最新会话)`——那是"进入项目"，不是"开草稿"。
   * 这里只复用它的**清理语义**（清会话/清 meta/刷新默认模型），落点是空白草稿。
   */
  function newSessionIn(project: Project) {
    if (agent === undefined) return;
    // 已经在这个项目的草稿里：幂等（本组按钮已禁用，这里是兜底，不重复 reset）
    if (selectedProjectId === project.id && sessionId === undefined) return;
    if (selectedProjectId !== project.id) {
      setHistory(undefined);
      setSelectedProjectId(project.id);
      void refreshAgentDefaultModel(agent.id);
    }
    resetChatState();
    setSessionId(undefined);      // draftKey 随之落到新项目；URL 去 session
    current.current = undefined;
    setShowGroups(true);
    // 折叠的组点了 ＋ 要能看见结果：展开它
    setCollapsedGroups((previous) => ({ ...previous, [project.id]: false }));
    if (!isMobile) requestAnimationFrame(() => inputRef.current?.focus());
  }

  async function registerProject(path: string): Promise<string | null> {
    if (agent === undefined) return "没有当前助手";
    const response = await fetch(`/api/agents/${agent.id}/projects`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ path }),
    });
    const data = await response.json() as {
      project?: { id: string; name?: string };
      defaultTask?: { id: string; title: string };
      error?: { message: string };
    };
    if (!response.ok || data.project === undefined) return data.error?.message ?? "注册失败";
    const pid = data.project.id;
    // 绑定即创建默认 Task（src/projects.ts）：这里是它唯一的用户可见确认，别让它静默发生
    if (data.defaultTask !== undefined) {
      toast(`已添加项目 ${data.project.name ?? pid} · 默认 Task ${data.defaultTask.id} ${data.defaultTask.title}`, "success");
    }
    setAddingProject(false);
    const next = await reloadGroups();
    const target = (next ?? []).find((g) => g.project.id === pid);
    if (target !== undefined) await selectProject(target.project);
    return null;
  }

  async function unbindProject(project: Project) {
    if (agent === undefined) return;
    const response = await fetch(`/api/agents/${agent.id}/projects/${project.id}`, { method: "DELETE" });
    if (!response.ok) return;
    const next = await reloadGroups();
    if (selectedProjectId === project.id) {
      const fallback = (next ?? []).find((g) => g.project.isDefault) ?? (next ?? [])[0];
      if (fallback !== undefined) await selectProject(fallback.project);
      else {
        setSelectedProjectId(undefined);
        setSessionId(undefined);
        setMessages([]);
        setMeta(undefined);
        void refreshAgentDefaultModel(agent.id);
      }
    }
  }

  async function commitRename(session: SessionItem, value: string) {
    setRenaming(undefined);
    const trimmed = value.trim();
    if (agent === undefined || trimmed === "" || trimmed === session.title.raw) return;
    await fetch(`/api/agents/${agent.id}/sessions/${session.sessionId}`, {
      method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: trimmed }),
    });
    await reloadGroups();
  }

  async function removeSession(session: SessionItem) {
    if (agent === undefined) return;
    const response = await fetch(`/api/agents/${agent.id}/sessions/${session.sessionId}`, { method: "DELETE" });
    if (!response.ok) return;
    const next = await reloadGroups();
    if (session.sessionId === sessionId) {
      const currentGroup = (next ?? []).find((g) => g.project.id === selectedProjectId);
      const sibling = pickLatest((currentGroup?.sessions ?? []).filter((s) => s.sessionId !== session.sessionId));
      if (sibling !== undefined) { await openSession(agent, sibling.sessionId); return; }
      const fallbackGroup = (next ?? []).find((g) => g.project.isDefault) ?? (next ?? [])[0];
      if (fallbackGroup !== undefined) await selectProject(fallbackGroup.project);
      else {
        setSessionId(undefined);
        setMessages([]);
        setMeta(undefined);
        void refreshAgentDefaultModel(agent.id);
      }
    }
  }

  /**
   * 发送（行业通行做法）：
   * - 生成中按 Enter **不丢内容** → 记入排队，本轮结束后自动发送（并显示“已排队”）；
   * - 发送失败（网络/4xx）→ **回填草稿**，不静默吃掉用户输入；
   * - `submittingRef` 防快速连按 Enter 重复提交。
   */
  // 附件状态与 ref 同步：sendText 可能从跨渲染的回调（sendTextRef）进来，读 ref 才不会拿到旧值
  useEffect(() => { attachmentsRef.current = attachments; }, [attachments]);

  /** 把用户选的/粘贴的/拖入的文件逐个变成附件；超限或非法时提示并跳过。 */
  async function collectImages(files: readonly File[]) {
    if (files.length === 0) return;
    let next = attachmentsRef.current;
    let added = 0;
    for (const file of files) {
      if (!file.type.startsWith("image/")) { toast(`只能发送图片：${file.name || "未命名"}`, "error"); continue; }
      const converted = await fileToImage(file).catch(() => undefined);
      if (converted === undefined) { toast("读取图片失败", "error"); continue; }
      attachmentSeq.current += 1;
      const verdict = addImage(next, { id: String(attachmentSeq.current), ...converted });
      if (!verdict.ok) { toast(verdict.message, "error"); continue; }
      next = verdict.images;
      added += 1;
    }
    if (added > 0) { setAttachments(next); attachmentsRef.current = next; }
  }

  async function sendText(raw: string) {
    const text = raw.trim();
    const pending = attachmentsRef.current;      // 本次发送携带的图片（发送成功才真正清空）
    if ((text === "" && pending.length === 0) || agent === undefined) return;
    if (!busyRef.current) {
      setTurnStep(1);
      turnStartedAtRef.current = Date.now();
      turnFirstTokenAtRef.current = 0;
      // 新会话没有 meta：从 0 起算；已有会话从当前累计起算。
      turnUsageStartRef.current = meta?.usage ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, totalTokens: 0 };
      turnMetricsPendingRef.current = true;
      setTurnMetrics(undefined);
    }   // 1/4：用户发送（steer 不新起一轮，不改步骤）
    // 还没有会话（新 Agent / 空项目）：**直接输入发送 = 建会话 + 发送**，不必先点"新建会话"
    // （参照 Pi Web 的 new session draft：输入框在无会话时可用，首条消息落地时才真正建会话）
    let sid = sessionId;
    let createdJustNow = false;      // 本次发送才建的会话（失败补偿要删掉它，见下）
    if (sid === undefined) {
      if (selectedProjectId === undefined || submittingRef.current || busyRef.current) return;
      submittingRef.current = true;
      setInput("");
      try {
        const created = await fetch(`/api/agents/${agent.id}/projects/${selectedProjectId}/sessions`, { method: "POST" });
        if (!created.ok) {
          const body = await created.json().catch(() => ({}) as { error?: { message?: string } });
          toast(body.error?.message ?? "新建会话失败", "error");
          setInput(text);
          return;
        }
        sid = ((await created.json()) as { sessionId: string }).sessionId;
        createdJustNow = true;
        setSessionId(sid);
        setMessages([]);
        void reloadGroups();
      } catch {
        toast("网络错误：新建会话失败", "error");
        setInput(text);
        return;
      } finally {
        submittingRef.current = false;
      }
    }
    if (busyRef.current) {
      // 生成中投入输入 = Pi 原生 steer（插进当前思考）；空闲被后端 409（决策 b）→ 改发新回合
      const response = await fetch(`/api/agents/${agent.id}/sessions/${sid}/messages`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text, behavior: "steer" }),
      }).catch(() => undefined);
      if (response?.status === 409 && (await response.json().catch(() => ({ }) as { error?: { code?: string } })).error?.code === "session_idle") {
        toast("会话已空闲：改为新回合发送", "success");     // 决策 b 的透明化：一次提示，随后走普通发送
        // 落入下方普通发送分支（busyRef 会被重置）
        busyRef.current = false; busySessionRef.current = undefined; setBusy(false);
      } else if (response?.ok === true) {
        setInput("");
        busySessionRef.current = sid;
        setMessages((list) => [...list, { role: "user", text, blocks: userBlocks(text, pending) }]);
        if (pending.length > 0) { setAttachments([]); attachmentsRef.current = []; }
        toast("已插话（steer，不影响当前轮继续）");
        if (sid !== undefined) setRunFacts((f) => queueAdd(f, sid, { behavior: "steer", text }));
        return;
      }
    }
    if (submittingRef.current) return;
    submittingRef.current = true;
    activeTurnIdRef.current = null;      // C119：新回合等 turn(running) 事件来认领 turnId
    setInput("");                       // 事务开始：清该会话草稿（失败会回填）
    setAttachments([]); attachmentsRef.current = [];
    streamRef.current = createStreamState();
    setPhase("waiting");
    setRetry(undefined);
    setRetriedTimes(undefined);   // 新回合：重新计数（上一轮试了几次与本轮无关）
    setTurnStatus(undefined);
    setActiveTool(undefined);
    lastEventAtRef.current = Date.now();   // 发送即重置心跳：否则"页面静置>60s 后发送"会被误判成丢轮
    busyRef.current = true;
    busySessionRef.current = sid;
    setBusy(true);
    streaming.current = true;
    followTail.current = true;
    setAtBottom(true);
    setMessages((list) => [...list, { role: "user", text, blocks: userBlocks(text, pending) }, { role: "assistant", text: "", blocks: [], streaming: true }]);
    const fail = (message: string) => {
      setMessages((list) => [...list.slice(0, -1), { role: "assistant", text: message, blocks: [{ type: "text", text: message }] }]);
      setInput(text);                   // 失败回填草稿
      // 批注也要回填：否则"发送失败"等于把用户刚写的一批批注也弄丢了
      const snapshot = pendingAnnoRestore.current;
      if (snapshot !== undefined) { anno.restore(snapshot); pendingAnnoRestore.current = undefined; }
      if (pending.length > 0) { setAttachments([...pending]); attachmentsRef.current = [...pending]; }
      busyRef.current = false;
      busySessionRef.current = undefined;
      setBusy(false);
      setTurnStep(4);
      turnMetricsPendingRef.current = false;
      // 失败后重新拉一次消息：让"消息列表 / 批注渲染层"回到服务端事实。
      // 不这么做的话，上面那次乐观插入 + 回滚会让批注渲染层重建在 DOM 尚未稳定时发生，
      // 高亮不会重画（实测：批注数据回来了，但文字上没有颜色）。
      if (sid !== undefined) void loadMessages(agent.id, sid);
    };
    try {
      const response = await fetch(`/api/agents/${agent.id}/sessions/${sid}/messages`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify(pending.length > 0 ? { text, images: toRequestImages(pending) } : { text }),
      });
      if (!response.ok) {
        const error = await response.json() as { error?: { message?: string } };
        if (createdJustNow) {
          // 首条消息被明确拒绝（非 2xx）：刚建的会话里没有写入任何内容，删掉并退回草稿（2026-10-29 决策）。
          // 参考项目不删（Pi Web 靠列表过滤 + 空闲回收）；我们没有空闲回收，留着就是一个看不见也删不掉的会话。
          await fetch(`/api/agents/${agent.id}/sessions/${sid}`, { method: "DELETE" }).catch(() => undefined);
          const backToDraft = selectedProjectId === undefined ? undefined : `${agent.id}/${selectedProjectId}`;
          writeDraftFor(backToDraft, text);      // 文字挂回项目草稿键（退回草稿后 draftKey 换成它）
          resetChatState();
          setSessionId(undefined);
          current.current = undefined;
          setInputState(text);
          setTurnStep(1);
          if (pending.length > 0) { setAttachments([...pending]); attachmentsRef.current = [...pending]; }
          void reloadGroups();
          toast(`发送失败：${error.error?.message ?? "请求被拒绝"}`, "error");
          return;
        }
        fail(`[出错] ${error.error?.message ?? "请求失败"}`);
      } else {
        setTurnStep(2);   // 2/4：后端受理（202）
        window.setTimeout(() => { if (busyRef.current) setTurnStep(3); }, 250);   // 3/4：模型处理（含等待/思考/工具/输出）
      }
    } catch {
      fail("[出错] 网络错误");
    } finally {
      submittingRef.current = false;
    }
  }

  sendTextRef.current = sendText;      // 每次渲染刷新（跨渲染的回调走 ref，避免拿到旧闭包）

  // —— 斜杠命令（对齐 Pi CLI / Pi Web 的常用项；能力都走 Pi 原生接口） ——
  const [palette, setPalette] = useState<{ items: PaletteItem[]; index: number } | undefined>();

  const copyLastAssistant = () => {
    const tail = [...messages].reverse().find((message) => message.role === "assistant" && message.text !== "");
    if (tail === undefined) { toast("没有可复制的回复", "error"); return; }
    void navigator.clipboard.writeText(tail.text).then(() => toast("已复制最后一条回复"));
  };

  const exportMarkdown = () => {
    const lines = messages.map((message) => `## ${message.role === "user" ? "用户" : "Agent"}\n\n${message.text}`);
    const blob = new Blob([`# ${sessionTitle || "会话"}\n\n${lines.join("\n\n")}`], { type: "text/markdown" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${sessionTitle || "session"}.md`;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  async function compactNow() {
    if (agent === undefined || sessionId === undefined) return;
    if (busyRef.current) { toast("先打断当前回复再压缩", "error"); return; }
    const response = await fetch(`/api/agents/${agent.id}/sessions/${sessionId}/compact`, { method: "POST" }).catch(() => undefined);
    const body = response === undefined ? {} : await response.json().catch(() => ({})) as { summary?: string; error?: { message?: string } };
    if (response?.ok !== true) { toast(body.error?.message ?? "压缩失败", "error"); return; }
    toast(`已压缩上下文${body.summary === undefined ? "" : "（摘要已写入会话）"}`);
    void loadMessages(agent.id, sessionId);
  }

  async function openModelPalette() {
    const response = await fetch("/api/models-config").catch(() => undefined);
    if (response?.ok !== true) { toast("读取模型清单失败", "error"); return; }
    const data = await response.json() as { providers: Array<{ id: string; models: Array<{ id: string }> }> };
    const items: PaletteItem[] = data.providers.flatMap((provider) => provider.models.map((model) => ({
      key: `${provider.id}/${model.id}`,
      label: `${provider.id} / ${model.id}`,
      hint: "切换本会话模型",
      run: () => { void applyModel(provider.id, model.id); },
    })));
    setPalette(items.length === 0 ? undefined : { items, index: 0 });
    if (items.length === 0) toast("模型清单是空的", "error");
  }

  async function applyModel(provider: string, model: string) {
    if (agent === undefined || sessionId === undefined) return;
    const response = await fetch(`/api/agents/${agent.id}/sessions/${sessionId}/model`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ provider, model }),
    }).catch(() => undefined);
    // Pi 的 setModel 会校验 provider 有没有 API key（抛 "No API key for …"）：把真正原因告诉用户，不吞成"切换失败"
    const body = response === undefined ? {} : await response.json().catch(() => ({})) as { error?: { message?: string } };
    const ok = response?.ok === true;
    toast(ok ? `已切到 ${provider}/${model}` : (body.error?.message ?? "切换失败"), ok ? "success" : "error");
    if (ok) void loadMessages(agent.id, sessionId);
  }

  async function applyThinking(level: string) {
    if (agent === undefined || sessionId === undefined) return;
    const response = await fetch(`/api/agents/${agent.id}/sessions/${sessionId}/thinking`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ level }),
    }).catch(() => undefined);
    // Pi 会按模型能力夹取档位：提示里显示实际生效值（用接口回的 level，不回显入参）
    const body = response === undefined ? {} : await response.json().catch(() => ({})) as { level?: string; error?: { message?: string } };
    const ok = response?.ok === true;
    toast(ok ? `思考级别：${body.level ?? level}` : (body.error?.message ?? "切换失败"), ok ? "success" : "error");
    if (ok) void loadMessages(agent.id, sessionId);
  }

  // 草稿态（还没有会话）所有命令都无法执行：置灰并说明“发送后可用”（决策 ②；参考 Open WebUI 只列可用的命令）。
  const draftMode = sessionId === undefined;
  /**
   * `/new` 的落点：**当前项目**（Task 0006）。
   *
   * 按钮已经把归属变成界面位置，但命令没有这层信息，所以它只能落到当前项目。
   * 两者走同一个 `newSessionIn()`，不出现两套“归属规则”。
   * 当前项目在列表里查不到（极少：项目刚被移除）时退回旧行为（保留当前项目不变）。
   */
  function newSessionCommand() {
    const project = groups.find((group) => group.project.id === selectedProjectId)?.project;
    if (project === undefined) { newSession(); return; }
    newSessionIn(project);
  }
  const COMMANDS: PaletteItem[] = [
    { key: "/compact", label: "/compact", hint: "压缩上下文（Pi 原生 compact）", disabled: draftMode, run: () => void compactNow() },
    { key: "/model", label: "/model", hint: "切换本会话模型", disabled: draftMode, run: () => void openModelPalette() },
    { key: "/thinking", label: "/thinking", hint: "切换思考级别", disabled: draftMode, run: () => setPalette({ items: ["off", "minimal", "low", "medium", "high", "xhigh", "max"].map((level) => ({ key: level, label: level, hint: meta?.thinkingLevel === level ? "当前" : "思考级别", run: () => { void applyThinking(level); } })), index: 0 }) },
    { key: "/name", label: "/name <名称>", hint: "重命名会话", disabled: draftMode, run: () => setInput("/name ") },
    { key: "/new", label: "/new", hint: "新建会话", disabled: draftMode, run: () => void newSessionCommand() },
    { key: "/copy", label: "/copy", hint: "复制最后一条回复", disabled: draftMode, run: copyLastAssistant },
    { key: "/export", label: "/export", hint: "导出为 Markdown", disabled: draftMode, run: exportMarkdown },
    { key: "/abort", label: "/abort", hint: "打断当前回复（Esc）", disabled: draftMode, run: () => void stop() },
  ];

  /** 草稿态拒绝执行命令时的说明：/new 是“已经在新会话里”，其余是“发送后才有会话可操作”。 */
  function commandOffNotice(key: string): string {
    return key === "/new" ? "当前已在新建会话" : "发送第一条消息后，命令才可用";
  }

  async function runSlash(command: string) {
    const [name, ...rest] = command.trim().split(/\s+/);
    const arg = rest.join(" ").trim();
    if (name === "/name" && arg !== "") {
      if (agent === undefined || sessionId === undefined) { setInput(""); toast(commandOffNotice("/name"), "error"); return; }
      const response = await fetch(`/api/agents/${agent.id}/sessions/${sessionId}`, {
        method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: arg }),
      }).catch(() => undefined);
      toast(response?.ok === true ? "已重命名会话" : "重命名失败", response?.ok === true ? "success" : "error");
      if (response?.ok === true) { setInput(""); void reloadGroups(); }
      return;
    }
    const hit = COMMANDS.find((item) => item.key === name);
    if (hit !== undefined) {
      // 手敲命令也要拦：否则 "/model" 会被当成一条消息发出去（草稿态没有会话可操作）
      if (hit.disabled === true) { setInput(""); toast(commandOffNotice(hit.key), "error"); return; }
      setInput(""); hit.run(); return;
    }
    toast(`未知命令 ${name}（按 / 看列表）`, "error");
  }

  /** 打断：Pi 原生 abort()；run 的 finally 会发 done，前端据此收尾。 */
  /**
   * 打断（Esc / 停止钮）。
   *
   * 与 Pi CLI 对齐（Task 0007 · A2）：重试退避期间按 Esc，只取消"这次自动重试"，
   * 不打断整轮 —— Pi CLI 在这里调的是 `abortRetry()` 而不是 `abort()`
   * （interactive-mode.ts:3749-3752）。原因：重试中用户的意图通常是"别试了，我自己来"，
   * 而不是"这一轮整个不要了"。没在重试时才退回整套打断语义。
   */
  async function stop() {
    if (sessionId !== undefined) setRunFacts((f) => queueClear(f, sessionId));

    if (agent === undefined || sessionId === undefined) return;
    if (retry !== undefined) {
      const retryResponse = await fetch(`/api/agents/${agent.id}/sessions/${sessionId}/retry/abort`, { method: "POST" }).catch(() => undefined);
      if (retryResponse?.ok === true) {
        // 服务端会在随后发 retry_end(success=false)，由它统一清 retry 状态；这里只给反馈
        toast("已取消自动重试", "success");
        return;
      }
      // 409 not_retrying：已经不在重试了 → 落到下面按整套打断处理
    }
    const response = await fetch(`/api/agents/${agent.id}/sessions/${sessionId}/abort`, { method: "POST" }).catch(() => undefined);
    toast(response?.ok === true ? "已请求打断" : "打断失败", response?.ok === true ? "success" : "error");
  }

  /** 恢复三分支（协议 FR-13）：先对账(1.2 端点/JSONL 兜底)再定文案 —— 已完成 / 中断(带重发) / 不可知·按丢失处理 */
  async function reconcileLostRun(fallbackReason: string, target?: { agentId: string; sessionId: string }) {
    const aid = target?.agentId ?? agent?.id; const sid = target?.sessionId ?? sessionId;
    if (!busyRef.current) return;
    if (aid === undefined || sid === undefined) { recoverLostRun(fallbackReason); return; }
    // C120：只对账 busy 所属、且仍是当前会话的那一轮；切走之后晚到的对账不得改新会话
    if (busySessionRef.current !== sid || sid !== current.current) return;
    logger.warn("run", "reconcile-lost", { reason: fallbackReason, sessionId: sid, turnId: activeTurnIdRef.current ?? undefined });
    try {
      const data = await (await fetch(`/api/agents/${aid}/sessions/${sid}/turns/last`)).json() as { turn?: { state: string } | null };
      if (sid !== current.current) return;   // 等响应期间已切走：不得改新会话（C120）
      const state = data.turn?.state;
      if (state === "done") {
        // 分支1：已完成（响应在下方）—— 不再是"错误"提示
        busyRef.current = false; busySessionRef.current = undefined; streaming.current = false; setBusy(false);
        activeTurnIdRef.current = null;
        setTurnStep(4); setRetry(undefined);
        setTurnStatus({ text: "本轮已完成：连接恢复时对账成功，结果在下方" });
        toast("本轮已完成：连接恢复时对账成功，结果在下方", "success");
        void loadMessages(aid, sid);
        return;
      }
      if (state === "running") {
        // 分支3：仍在运行（快照/连接恢复竞态）—— 保持生成态不清不动
        lastEventAtRef.current = Date.now();
        return;
      }
      recoverLostRun("受理之后中断：后端已不再运行这一轮（带重发）", { agentId: aid, sessionId: sid });   // 分支2：lost/无回合
    } catch {
      recoverLostRun(fallbackReason, { agentId: aid, sessionId: sid });   // 端点不可达：退回旧文案（保守）
    }
  }

  /** 运行"跑丢了"（后端重启 / 断线）：清生成态、重载消息，尾部空回复处会给重试。 */
  function recoverLostRun(reason: string, target?: { agentId: string; sessionId: string }) {
    const aid = target?.agentId ?? agent?.id;
    const sid = target?.sessionId ?? sessionId;
    if (!busyRef.current) return;
    if (sid !== undefined && busySessionRef.current !== sid) return;   // 不收拾别人的回合
    logger.warn("run", "recover-lost", { reason, sessionId: sid });
    activeTurnIdRef.current = null;
    busyRef.current = false;
    busySessionRef.current = undefined;
    streaming.current = false;
    setBusy(false);
    setTurnStep(4);
    setRetry(undefined);
    setTurnStatus({ text: reason });
    toast(reason, "error");
    if (aid !== undefined && sid !== undefined && sid === current.current) void loadMessages(aid, sid);
  }

  // Esc 打断（不在输入法组字、没有对话框打开时）；生成中每 5s 检查一次心跳
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || composingRef.current || !busyRef.current) return;
      if (document.querySelector('[role="dialog"]') !== null) return;
      event.preventDefault();
      void stop();
    };
    document.addEventListener("keydown", onKeyDown);
    const timer = setInterval(() => {
      if (!busyRef.current || lostCheckRef.current) return;
      if (lastEventAtRef.current === 0) return;
      if (Date.now() - lastEventAtRef.current <= 60_000) return;
      // 判丢前先问后端"这一轮还在跑吗"：模型很慢/无流式时，60 秒没有事件不等于丢了
      const agentId = ctx.current.agentId;
      const sid = busySessionRef.current;
      if (agentId === undefined || sid === undefined || sid !== current.current) return;
      lostCheckRef.current = true;
      void (async () => {
        try {
          const response = await fetch(`/api/agents/${agentId}/sessions/${sid}`);
          const data = await response.json() as { meta?: { running?: boolean } };
          if (data.meta?.running === true) { lastEventAtRef.current = Date.now(); return; }   // 还活着：再给一个窗口
          void reconcileLostRun("受理之后中断：后端已不再运行这一轮（进程重启或连接断开）", { agentId, sessionId: sid });
        } catch {
          lastEventAtRef.current = Date.now();   // 连后端都查不到：先不判丢，等下一个窗口
        } finally {
          lostCheckRef.current = false;
        }
      })();
    }, 5000);
    return () => { document.removeEventListener("keydown", onKeyDown); clearInterval(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  function send() {
    const raw = input.trim();
    // 斜杠命令优先：有命令就走命令，不掺批注（命令是会话动作，不是对话内容）
    if (raw.startsWith("/")) { void runSlash(raw); return; }

    // 有批注 → 批注与输入合成**一条**消息（用户 2026-11-03 定：一次发送 = 一次模型调用）
    if (anno.annotations.length > 0) {
      const annosText = annotationsMessage(annoOrdered, {
        order: messages.map((m) => m.id).filter((id): id is string => id !== undefined),
      });
      // 全是"功能"标记（存档/待办）时 annosText 为空：它们不发给 Agent（用户 2026-11-03）。
      // 这时若用户也没写字，就没有可发的内容——不发，也不清空批注（清空等于把用户的分类丢了）。
      if (annosText === "") {
        if (raw !== "") {
          sentHistoryRef.current = [...sentHistoryRef.current.slice(-49), raw];
          historyIndexRef.current = -1;
          void sendText(raw);
        }
        return;
      }
      const merged = raw === "" ? annosText : `${annosText}\n${raw}`;
      if (raw !== "") sentHistoryRef.current = [...sentHistoryRef.current.slice(-49), raw];
      historyIndexRef.current = -1;
      pendingAnnoRestore.current = [...anno.annotations];   // 失败时恢复用
      anno.clear();
      void sendText(merged);
      return;
    }

    if (raw !== "") { sentHistoryRef.current = [...sentHistoryRef.current.slice(-49), raw]; historyIndexRef.current = -1; }
    void sendText(raw);
  }

  const currentGroup = groups.find((group) => group.project.id === selectedProjectId);
  /**
   * 当前会话是不是"与其他 Agent 的对话"。
   * 这类会话由对端 Agent 驱动，`POST /messages` 会 409（`src/server.ts`），
   * 所以批注在这里**先禁用**（用户 2026-11-03 决定；"Agent 互相标注"留给待办 C4）。
   */
  // 判断逻辑抽到 header-strip.ts 的 isPeerSessionOf（纯函数 + 单测），
  // 因为它是"批注能不能用"的总开关，算错一次就是全站失效（2026-11-04 实际发生过）。
  const isPeerSession = isPeerSessionOf(sessionId, currentGroup?.sessions);
  // 任务 0005：头部标题用 `title.display`（与列表同一份派生），避免"列表一个名字、头部另一个名字"
  const sessionTitle = currentGroup?.sessions.find((item) => item.sessionId === sessionId)?.title.display ?? "";

  // 头部 task 段：有会话用会话的 Task，无会话用项目默认 Task（纯函数规则见 header-strip.ts 的 headerTaskOf）
  const headerTaskScope = { agentId: agent?.id ?? "", projectId: currentGroup?.project.id ?? selectedProjectId ?? "workspace" };
  const projectDefaultTask = projectDefaultTasks[taskTitleKey(headerTaskScope.agentId, headerTaskScope.projectId, "default")];
  const headerTask = headerTaskOf({
    hasSession: sessionId !== undefined,
    sessionTaskId: meta?.activeTaskId,
    ...(meta?.activeTaskId != null
      ? { sessionTaskTitle: taskTitles[taskTitleKey(headerTaskScope.agentId, headerTaskScope.projectId, meta.activeTaskId)] }
      : {}),
    ...(projectDefaultTask !== undefined ? { projectDefaultTask } : {}),
  });

  // 头部状态条 task 段：activeTaskId 有值而标题缺失时，按需拉一次任务清单（Task 0002；头部 task 段与默认 Task 共用这个端点）。加载失败时该段回退为只显示 ID。
  useEffect(() => {
    const taskId = meta?.activeTaskId;
    const aid = agent?.id;
    if (aid === undefined || taskId == null) return;
    const pid = currentGroup?.project.id ?? selectedProjectId ?? "workspace";
    const key = taskTitleKey(aid, pid, taskId);
    if (taskTitles[key] !== undefined) return;
    let cancelled = false;
    void fetch(`/api/agents/${aid}/projects/${pid}/tasks`)
      .then((response) => response.ok ? response.json() as Promise<{ items?: TaskItem[] }> : undefined)
      .then((data) => {
        if (cancelled || data?.items === undefined) return;
        setTaskTitles((previous) => ({
          ...previous,
          ...Object.fromEntries(data.items!.map((task) => [taskTitleKey(aid, pid, task.id), task.title])),
        }));
      })
      .catch(() => { /* 失败可见性：task 段回退为只显示 ID，不打断会话 */ });
    return () => { cancelled = true; };
  }, [agent?.id, meta?.activeTaskId, currentGroup?.project.id, selectedProjectId, taskTitles]);

  // 无会话时头部也要有 task 段：显示**项目默认 Task**（新建会话必然绑到它，见 headerTaskOf 的注释）。
  // 有会话时不拉这个列表——会话的 Task 由 activeTaskId 决定，拿默认顶上会撒谎。
  useEffect(() => {
    const aid = agent?.id;
    const pid = currentGroup?.project.id ?? selectedProjectId;
    if (aid === undefined || pid === undefined || sessionId !== undefined) return;
    const key = taskTitleKey(aid, pid, "default");
    if (projectDefaultTasks[key] !== undefined) return;
    let cancelled = false;
    void fetch(`/api/agents/${aid}/projects/${pid}/tasks`)
      .then((response) => response.ok ? response.json() as Promise<{ items?: TaskItem[] }> : undefined)
      .then((data) => {
        if (cancelled || data?.items === undefined) return;
        const fallback = data.items.find((task) => task.isDefault === true);
        if (fallback === undefined) return;   // 项目还没有默认 Task：该段缺席，不编造
        setProjectDefaultTasks((previous) => ({ ...previous, [key]: { id: fallback.id, title: fallback.title } }));
      })
      .catch(() => { /* 失败可见性：该段缺席即可，不打断 */ });
    return () => { cancelled = true; };
  }, [agent?.id, currentGroup?.project.id, selectedProjectId, sessionId, projectDefaultTasks]);

  /**
   * 会话行的显示标题（Task 0015 · T18）。
   *
   * 修复前后：`item?.title ?? ""` —— 没有标题时渲染**空**，比显示 id 更糟
   * （一行空白，用户不知道那是什么）。现在回落到 `会话 <id 前 8 位>`：
   * id 前 8 位是 Pi session id 的时间有序前缀，同一列表内足以区分。
   *
   * 显示规则（07-id-normalization.md §5）：界面永远优先显示可读名；
   * 只有在没有名字时才显示 id，并且**加视觉区分**（等宽 + 弱色），让人知道"这是 id 不是名字"。
   */
  /**
   * 显示用标题（任务 0005）：**直接用后端算好的 `title.display`**，前端不再自己削。
   *
   * 以前这里是 `shortTitleOf(item.title).slice(0, 50)` —— 与后端各算一遍，
   * 同一条会话在列表与头部可能显示成两个不同的名字（01 §3 第 5 条）。
   * 现在规则只在 `src/row-activity.ts` 的 `displayTitleOf()` 一处。
   */
  const titleOf = (item?: SessionItem) => {
    const display = item?.title.display ?? "";
    return display !== "" ? display : `会话 ${(item?.sessionId ?? "").slice(0, 8)}`;
  };
  /** 这一行是不是"没有名字、只能显示 id"（决定要不要加等宽/弱色）。 */
  const isIdFallback = (item?: SessionItem) => (item?.title.raw ?? "").trim() === "";
  /** 当前打开的会话（用于头部显示对端、以及会话行的参与者判断）。 */
  const currentSessionItem = sessionId === undefined
    ? undefined
    : groups.flatMap((group) => group.sessions).find((item) => item.sessionId === sessionId);

  /**
   * 会话列表里的"我"这一方（Task 0015 · T17）：用户本人。
   * 不引入"用户 Agent"实体——用户就是用户，头像走 /api/profile（Task 0014 已定）。
   */
  const meParticipant = {
    id: profile?.id ?? "user",
    name: profile?.name ?? "我",
    kind: "user" as const,
  };

  /**
   * 会话的对端是谁（Task 0015 · T17）。
   *
   * 两种会话都要能显示"和谁在谈"：
   * - **Agent ↔ Agent**：后端已把 `lifeos_peer` 解析成对端 id/name/avatar；
   * - **用户 ↔ Agent**：对端就是**这个会话所属的 Agent**（会话存在 `agents/<agentId>/` 下）——
   *   这不是猜，是存储事实（目录即归属）。
   */
  const peerOfSession = (sid: string) => {
    // 任务 0005：行对象的 `peer` 是**对象或 null**（不再一处字符串一处对象）
    const explicit = groups.flatMap((group) => group.sessions).find((item) => item.sessionId === sid)?.peer;
    if (explicit !== null && explicit !== undefined) return explicit;
    return agent === undefined ? undefined : { id: agent.id, name: agent.name, ...(agent.avatar !== undefined ? { avatar: agent.avatar } : {}) };
  };

  const folded = box.folded;
  // 图标轨常驻（VS Code Activity Bar 范式）：高亮 = 该列展开；点当前图标 = 收起；点未展开的 = 展开。
  // 展开前若右侧（完整历史/文件面板）开着，先关掉它——宽度预算同一套，避免挤爆聊天区。
  function toggleRail(key: "nav" | "groups") {
    const open = key === "nav" ? showNav : showGroups;
    const set = key === "nav" ? setShowNav : setShowGroups;
    if (open) { set(false); return; }
    if (history !== undefined) closeHistory();
    else if (panelOpen) setPanelOpen(false);
    set(true);
  }
  // 合并后只有两个图标（P-02 §5.2）：助手 / 对话
  const railItems = [
    { key: "nav", label: "助手", active: showNav, icon: <AgentAvatar id={agent?.id ?? "?"} name={agent?.name ?? "?"} avatar={agent?.avatar} size={20} />, onToggle: () => toggleRail("nav") },
    { key: "groups", label: "对话", active: showGroups, icon: <IconMessageCircle size={18} />, onToggle: () => toggleRail("groups") },
  ];

  /** Agent 级注意点（任务 0007）：该 Agent 下有会话在跑 → 运行点；有完成未读 → 未读点。 */
  // 状态映射（任务 0008）：会话 → 项目 → Agent 的运行与未读全部由同一份会话事实派生
  /**
   * 聚合的输入 = **全部 Agent 的会话四态**（Task 0005 · 2026-11-04 修）。
   *
   * 此前只喂 `groups`（当前选中 Agent 的会话）→ 左侧助手列里没点进去的 Agent 永远没数字，
   * 表现为"切到哪个 Agent 才有数字"，助手列失去"一眼看出谁有动静"的用途。
   *
   * 三个来源合并（优先级从低到高，后面的覆盖前面的）：
   *   ① `runFacts` 的跨 Agent 事实：SSE 快照的 `running`/`unread` + `turn`/`error` 事件
   *      → 覆盖**所有** Agent（这是助手列能显示数字的关键）；
   *   ② 当前 Agent 的 `groups`：带完整 `activity`（服务端四态，含 failure 的 detail）
   *      → 覆盖 ①，因为同一会话这里的信息更全。
   *
   * 为什么不给每个 Agent 各打一次 `/sessions`：13 个 Agent × 全扫 JSONL，
   * 违背本任务"不为展示重复取数"；而 SSE 已经把跨 Agent 的事实推过来了，零请求。
   */
  /**
   * 聚合输入（Task 0005 · P8-3）：
   *   ① `agentAggregate`：服务端算好的**跨 Agent** 数量（助手列能显示所有 Agent 的数字，靠它）；
   *   ② `groups`：当前打开 Agent 的会话行（用于把数字细到会话级、并扣掉正在看的那条未读）。
   *
   * 四态判定**不在这里**：服务端用 `rowActivityOf()` 算，`deriveStatus` 只做减法。
   * 曾经在这里手写过一份 `stateOf()`（running > failure > unread > idle）——
   * 那是同一个规则的第二份实现，正是本任务要消灭的东西（C163）。
   */
  const statusFacts: StatusFacts = {
    aggregate: agentAggregate,
    sessions: Object.fromEntries(
      groups.flatMap((group) => group.sessions.map((item) => [
        item.sessionId,
        { meta: { agentId: agent?.id ?? "", projectId: group.project.id }, activity: item.activity },
      ])),
    ),
  };
  const derived = deriveStatus(statusFacts, { agentId: agent?.id, sessionId, visible: document.visibilityState === "visible" });
  const leftColumns = (
    <>
      {!folded.nav && (
        <>
          <aside style={{ width: box.c1 }} className="flex shrink-0 flex-col bg-sunken">
            <ColumnHeader label="助手" count={agents.length} onHide={() => setShowNav(false)} />
            {/* 助手行是用户数据（名字、增减助手都会变）：截图基线只比骨架（规范 2.9） */}
            <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-1.5 pb-2" data-shot-mask="agent-rows">
              {!loaded && <Skeleton rows={3} />}
              {agents.map((item) => (
                <Row key={item.id} selected={item.id === agent?.id} onClick={() => void selectAgent(item)}>
                  <button aria-label={`配置 ${item.name}`} title="配置助手"
                    onClick={(event) => { event.stopPropagation(); setConfigAgent(item); }}
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition-transform hover:scale-105">
                    <AgentAvatar id={item.id} name={item.name} avatar={item.avatar} size={22} />
                  </button>
                  <span className="min-w-0 flex-1 truncate">{item.name}</span>
                  <StatusMarks status={derived.agents[item.id]} unit="会话" />
                  <span className="hidden shrink-0 items-center gap-0.5 group-hover:flex">
                    <IconButton label="删除助手" size="sm"
                      onClick={(event) => {
                        event.stopPropagation();
                        setConfirm({
                          title: "删除助手",
                          message: `归档「${item.name}」？它的会话与记录全部保留（可恢复），不会删除任何对话数据。`,
                          confirmLabel: "归档",
                          danger: true,
                          run: () => void removeAgent(item),
                        });
                      }}>
                      <IconTrash size={14} />
                    </IconButton>
                  </span>
                </Row>
              ))}
            </div>
          </aside>
          <DragHandle onStart={(event) => beginDrag("c1", event)} />
        </>
      )}

      {/* 第2列 · 对话（项目分组 → 会话行）：Task 0015 · T15 合并后的一列 */}
      {!folded.groups && (
        <>
          <aside style={{ width: box.c2 }} className="flex shrink-0 flex-col bg-sunken" data-testid="groups-panel">
            <GroupsColumnHeader count={groups.reduce((sum, group) => sum + group.sessions.length, 0)} onHide={() => setShowGroups(false)} />
            {/* 行内容=用户数据（名称/计数会变）：截图基线只比骨架，不把数据纳入契约 */}
            <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2" data-shot-mask="session-rows">
              {!loaded && <Skeleton rows={3} />}
              {loaded && groups.length === 0 && (
                <PanelEmpty title="还没有项目" hint="把外部目录注册为一个项目后，这里会出现。" />
              )}
              {groups.map((group) => {
                const open = collapsedGroups[group.project.id] !== true;
                const status = derived.projects[projectKey(agent?.id ?? "", group.project.id)];
                return (
                  <div key={group.project.id} data-project-id={group.project.id}>
                    <GroupHeader name={group.project.name} count={group.sessions.length} open={open}
                      selected={group.project.id === selectedProjectId}
                      onToggle={() => setCollapsedGroups((previous) => ({ ...previous, [group.project.id]: open }))}
                      onSelect={() => { setSelectedProjectId(group.project.id); setCollapsedGroups((previous) => ({ ...previous, [group.project.id]: false })); }}
                      onNewSession={() => newSessionIn(group.project)}
                      onNewSessionDisabled={group.project.id === selectedProjectId && sessionId === undefined}
                      {...(group.project.path !== undefined ? {
                        onRemove: () => setConfirm({
                          title: `移除「${group.project.name}」`,
                          message: "只从该助手移除；项目注册、该项目下的会话与记录都会保留。",
                          confirmLabel: "移除",
                          run: () => void unbindProject(group.project),
                        }),
                      } : {})}
                      actions={<StatusMarks status={status} unit="会话" />} />
                    {open && (
                      <GroupBody>
                        {group.sessions.length === 0 && (
                          <p className="px-1 py-2 text-micro text-ink-500">该项目还没有会话 · 在右下输入框发消息即可新建</p>
                        )}
                        {group.sessions.map((item) => {
                          // 会话行的三态**只认 `item.activity`**（Task 0005）。
                          // 它同时被两处维护：列表请求（服务端 rowActivityOf 四态）+ SSE `row` 补丁
                          // （applyRowPatch 只重建这一行）。此前这里还叠了 runFacts 一套，
                          // 等于同一个状态两个来源——删掉，四态是唯一判据。
                          const own = derived.sessions[item.sessionId];
                          const runNow = item.activity.state === "running";
                          const unread = item.activity.state === "unread" && own?.unread !== false;
                          const peer = peerOfSession(item.sessionId);
                          const failure = item.activity.failure;
                          // 运行耗时**本地现算**（任务 0005 · D4）：服务端只给 `since`，
                          // 秒数由 `elapsedTick` 每秒推动，零网络。`elapsedTick` 参与计算是为了
                          // 让它成为这个渲染的依赖 —— 没有它，React 不知道要重算。
                          const runningSince = item.activity.running?.since;
                          const elapsedText = runningSince === undefined
                            ? ""
                            : formatElapsed(Math.max(0, Date.now() - Date.parse(runningSince)), elapsedTick);
                          return (
                            <SessionRow key={item.sessionId} testId={item.sessionId}
                              selected={item.sessionId === sessionId}
                              title={titleOf(item)} titleFallback={isIdFallback(item)}
                              onSelect={() => agent !== undefined && void openSession(agent, item.sessionId)}
                              onHistory={() => openHistory(item.sessionId, titleOf(item))}
                              onRename={() => setRenaming({ sid: item.sessionId, value: item.title.raw })}
                              onDelete={() => setConfirm({
                                title: "删除会话",
                                message: `删除「${item.title.display || "未命名"}」？此操作不可恢复。`,
                                confirmLabel: "删除",
                                run: () => void removeSession(item),
                              })}
                              renaming={renaming?.sid === item.sessionId}
                              renameValue={renaming?.sid === item.sessionId ? renaming.value : ""}
                              onRenameChange={(value) => setRenaming({ sid: item.sessionId, value })}
                              onRenameCommit={(value) => void commitRename(item, value)}
                              onRenameCancel={() => setRenaming(undefined)}
                              participants={<ParticipantToken
                                me={meParticipant}
                                them={peer === undefined ? undefined : { id: peer.id, name: peer.name, ...(peer.avatar !== undefined ? { avatar: peer.avatar } : {}) }}
                                showMe={item.peer !== null}
                                ringClass={item.sessionId === sessionId ? "ring-2 ring-surface" : "ring-2 ring-sunken"} />}
                              meta={
                                <>
                                  {/* 对端名字**只在对端不是当前 Agent 时**出现：
                                      右栏里的会话全部属于当前 Agent，把它的名字每行写一遍没有信息增量；
                                      只有 Agent ↔ Agent 的会话，"对方是谁"才是新信息（T17）。 */}
                                  {item.peer !== null && <><span className="text-ink-700">{peer?.name ?? item.peer.id}</span><span> · </span></>}
                                  {/* 任务 0005：Task 名现在直接来自行对象（一次请求即得），不再额外打 /tasks。
                                      编号 + 名字都给：编号用于对照 Task 文档，名字用于人读。 */}
                                  {item.task !== null && <span title={`${item.task.id} ${item.task.title}（${item.task.status}）`}>{item.task.id} {item.task.title}</span>}
                                  {/* 失败态（结论 5）：红点 + 类别。"它挂了"和"它挂在哪"是两件事，
                                      只给红点用户不敢重试（不知道是网络抖还是需求本身有问题）。 */}
                                  {runNow && elapsedText !== "" && (
                                    <><span> · </span><span className="tabular-nums" title="本轮已运行时长">{elapsedText}</span></>
                                  )}
                                  {failure !== undefined && !runNow && (
                                    <><span> · </span><span className="text-danger" title={failure.detail || undefined}>失败：{failureLabel(failure.kind)}</span></>
                                  )}
                                  {/* 运行中**不写阶段文案**（Task 0015 · 10.2 ②）：
                                      `phase` 只有"当前打开会话"一份，列表里每条运行中的会话都用它会显示
                                      同一条文案（真 bug）。列表拿不到"各会话各自的阶段"，就不给——
                                      要看过程点进去，那时状态条给的是真实值。
                                      完成未读也不写字：右侧绿点就是它（design-language §5.2 / D23）。 */}
                                </>
                              }
                              status={runNow
                                ? <span className="h-1.5 w-1.5 rounded-full bg-success animate-pulse" data-state-dot="running" title="生成中" />
                                : failure !== undefined
                                  // 失败优先于未读：同一槽位一种含义，失败是更需要处理的那个（§5.2 四态互斥）
                                  ? <span className="h-1.5 w-1.5 rounded-full bg-danger" title={`失败：${failureLabel(failure.kind)}`} />
                                  : unread
                                    ? <span className="h-1.5 w-1.5 rounded-full bg-success" title="完成未读（查看后消失）" />
                                    : <span className="text-micro text-ink-500">{timeAgo(item.time.lastActivityAt)}</span>} />
                          );
                        })}
                      </GroupBody>
                    )}
                  </div>
                );
              })}
            </div>
            <PanelFooter>
              <AddProjectButton onClick={() => setAddingProject(true)} />
            </PanelFooter>
          </aside>
          <DragHandle onStart={(event) => beginDrag("c2", event)} />
        </>
      )}
    </>
  );
  const anyLeftOpen = showNav || showGroups;
  const closeAllLeft = () => { setShowNav(false); setShowGroups(false); };
  // 重发计划：指向"最后一条用户消息"（失败属于那一轮；动作挂在被重发的那条消息上）
  const resend = resendPlan(messages, busy);
  /**
   * 状态条上的回合提示（Task 0007）：**从与按钮同一份数据派生**。
   *
   * 为什么不用 `turnStatus` 的 state：那个值由打开会话时的一次 `turns/last` 设下，之后回合转 running
   * 也不会被清（`applyFocusedTurn` 只改 busy）。于是出现用户报的现象：提示条还写着"可以点重新发送"，
   * 按钮已经被 busy 抑掉。现在提示由 `resend` 同一个判定得出（同一个 `turnOutcomeOf` + 同一个 `busy`），
   * 从结构上不可能与按钮不一致。`turnStatus` 仍保留，用於非回合类状态文案（对账成功/中断等）。
   */
  const outcomeNotice = turnNoticeOf({ outcome: turnOutcomeOfMessages(messages), busy });
  /**
   * 不可重试错误的出口文案（Task 0007 · 阶段一）：auth / quota / payload_too_large 不给重发，
   * 但必须给"下一步做什么"（`src/next-action.ts` 判 kind=fix，文案在 `failure-text.ts`）。
   * 生成中不显示：那时这一轮还没结束。
   */
  const turnAction = nextActionOfMessages(messages);
  const failureFixHint = !busy && turnAction.kind === "fix" ? fixHint(turnAction.fix) : undefined;
  /**
   * 状态条最终文案：**回合提示优先**（它与按钮同源），否则用 `turnStatus`（非回合类状态，如对账成功）。
   *
   * 两者互斥地覆盖：`outcomeNotice` 在 busy 时也会给出（“正在生成中…”）或不出，所以只要它在，
   * 就不会让一句"可以点重新发送"和"没有按钮"同时出现在屏幕上。
   */
  const renderStatus = outcomeNotice ?? turnStatus;
  /**
   * 头部显示的模型 = **实际运行模型**（Task 0017）。
   *
   * 旧规则（2026-10-22）是：用过 `/model` → 显示覆盖模型；没用过 → 显示 Agent 的有效默认。
   * 它造成了一个真实事故：amr-link 缺凭据，Pi 把实际模型偷偷换成了 deepseek-v4-pro，
   * 而头部因为 `modelOverridden === false` 仍显示 amr-link —— 界面替 bug 打了掩护，
   * 用户直到看见 402 才知道请求打到了别处（实测：`test:ui` 的
   * 「头部显示会话实际模型（与接口 meta 一致）」当场变红）。
   *
   * 现在恒取 `meta.model`（后端 sessionMeta 报的实际模型）。语义上更硬：
   * 头部 = 我发的请求实际打到哪，而不是“我配的是什么”。两者不一致时该被看见，不该被掩盖。
   * 新建会话（还没 meta）时仍用 Agent 默认——那时还没有“实际”。
   */
  const headerModel = sessionId !== undefined
    ? (meta?.model ?? agentDefaultModel)
    : agentDefaultModel;

  return (
    <div className="relative flex bg-surface text-ink-900" style={{ height: "var(--app-height, 100dvh)" }}>
      {!isMobile && <NavRail items={railItems} />}

      {/* 左三列：宽窗口并列；窄窗口改浮层抽屉（聊天保底不被压破） */}
      {!isMobile && !box.overlayLeft && leftColumns}

      {/* 主区 · 聊天（历史作为右侧并列列，不覆盖） */}
      <div className="flex h-full min-w-0 flex-1 flex-col bg-surface">
        <header className="flex h-11 shrink-0 items-center gap-2 px-4 max-sm:h-auto max-sm:min-h-11 max-sm:pt-safe">
          {isMobile && (sessionId !== undefined ? (
            <IconButton label="返回项目" onClick={() => openMobileNav("projects")}><IconArrowLeft size={18} /></IconButton>
          ) : (
            <IconButton label="打开导航" onClick={() => openMobileNav("agents")}><IconMenu2 size={18} /></IconButton>
          ))}
          {/* 头部的标题与元信息是用户数据（会话标题、模型、任务名）：截图基线只比骨架 */}
          <div className="min-w-0" data-shot-mask="header-data">
            <h1 className="truncate text-body font-semibold text-ink-900">{loaded && sessionId === undefined ? "新会话" : sessionTitle !== "" ? sessionTitle : "Life OS"}</h1>
            <p className="truncate text-micro text-ink-500" data-testid="header-meta">
              {joinHeaderSegments(buildHeaderSegments({
                agentName: agent?.name ?? "",
                // 只有 Agent↔Agent 的会话才有对端（用户↔Agent 的对端就是当前 Agent，写了是重复）
                ...(currentSessionItem?.peer != null ? { peerName: currentSessionItem.peer.name } : {}),
                projectName: currentGroup?.project.name ?? "",
                sessionTitle,
                headerModel: headerModel ?? null,
                thinkingLevel: sessionId !== undefined ? meta?.thinkingLevel : agentDefaultThinking,
                activeTaskId: headerTask?.id,
                taskTitle: headerTask?.title,
              }))}
            </p>
          </div>
          <span className="ml-auto" />
          <IconButton label="完整历史" size="lg" active={history !== undefined} disabled={sessionId === undefined}
            onClick={() => { if (sessionId !== undefined) { if (history !== undefined) closeHistory(); else openHistory(sessionId, sessionTitle); } }}>
            <IconHistory size={16} />
          </IconButton>
          <IconButton label={panelOpen ? "收起文件面板" : "展开文件面板"} size="lg" active={panelOpen}
            onClick={() => {
              if (!panelOpen && history !== undefined) closeHistory();
              if (!panelOpen && isMobile && fileTabs.length === 0) setShowTree(true);
              if (panelOpen) closeFilePanel(); else setPanelOpen(true);
            }}>
            <IconLayoutSidebarRight size={16} />
          </IconButton>
          {/* 显示设置（用户 2026-11-02：就放在这两个图标旁边）：两个滑块 = 内容宽度 + 字号 */}
          <DisplayPrefsPanel prefs={prefs} viewport={viewportWidth} onChange={setPrefs} />
        </header>

        <div className="relative min-h-0 flex-1">
          <main ref={scrollRef}
            onScroll={(event) => {
              const node = event.currentTarget;
              const bottom = node.scrollHeight - node.scrollTop - node.clientHeight < 60;
              followTail.current = bottom;
              setAtBottom(bottom);
            }}
            className="h-full w-full overflow-y-auto px-4 py-4 sm:px-6 sm:py-5">
            <div className="mx-auto flex w-full max-w-reading flex-col gap-4" data-shot-mask="chat-body">
              {sessionId === undefined && (selectedProjectId === undefined
                ? <EmptyState icon={<IconMessageCircle size={22} />} title="先选择项目" hint="左侧第 2 列选一个项目。" />
                : <EmptyState icon={<IconMessageCircle size={22} />} title="发一条消息开始对话" hint="直接输入并发送，会自动为该项目新建会话。" />)}
              {sessionId !== undefined && messages.length === 0 && <EmptyState icon={<IconMessageCircle size={22} />} title="发一条消息开始对话" hint="输入并发送即可，第一条消息会写进这个会话。" />}
              {(() => {
                // 折叠粒度 = **一轮**（用户发一句话 → 下一条用户消息之前）
                // 实测本会话每轮 assistant 消息数中位 6、最多 198：按消息折会碎成上百块，必须按轮分。
                const spans = groupIntoSpans(messages);
                // 反查：任意一条消息（包括没有 user 的孤儿段）→ 它属于哪一轮
                const spanByIndex = new Map<number, (typeof spans)[number]>();
                for (const span of spans) {
                  if (span.userIndex >= 0) spanByIndex.set(span.userIndex, span);
                  for (const reply of span.replyIndexes) spanByIndex.set(reply, span);
                }
                const folded = new Set<number>();   // 已被上面某一轮的过程条收进去的回复下标
                return messages.map((message, index) => {
                  if (folded.has(index)) return null;
                  // 动作挂在"被重发的那条用户消息"上（不是助手的错误提示）；不另起一行
                  const plan = resend?.index === index ? resend : undefined;
                  const isUser = message.role === "user";
                  // 该轮的全部回复（用户消息之后、下一条用户消息之前）
                  const replies = spanByIndex.get(index)?.replyIndexes ?? [];
                  const replyMessages = replies.map((i) => messages[i]).filter((m): m is Message => m !== undefined);

                  // 过程折叠只处理助手侧，且只在"有过程"时生效（0 工具 0 思考 = 纯聊天，不折）
                  // 折叠后的容器是这一轮的**第一条**回复（通常是 assistant）；其余回复被收进它的过程条
                  let process: { stats: ProcessStats; live: boolean; textIndexes: readonly number[] } | undefined;
                  let mergedBlocks: Block[] | undefined;
                  const isFirstReply = replies.length > 0 && replies[0] === index;
                  if (!isUser && isFirstReply) {
                    const allBlocks = replyMessages.flatMap((m) => m.blocks);
                    const durationMs = replyMessages.reduce((sum, m) => sum + (m.durationMs ?? 0), 0);
                    const tokens = replyMessages.reduce((sum, m) => sum + (m.tokens ?? 0), 0);
                    const stats = statsOf(allBlocks, {
                      ...(durationMs > 0 ? { durationMs } : {}),
                      ...(tokens > 0 ? { tokens } : {}),
                    });
                    const live = replyMessages.some((m) => m.streaming === true);
                    // 失败/中断的轮次保持展开：用户要能看到它做过什么（沿用现有 forceOpen 语义）
                    const failed = replyMessages.some((m) => m.failure !== undefined || m.error !== undefined);
                    if (hasProcess(stats) && !failed) {
                      // "最终正文"= 本轮**最后一段** text（chat.md §3.3：最终回答取最后一段 text），
                      // 其余所有块进过程区。中间过渡语是过程独白，不是回复。
                      const textIndexes: number[] = [];
                      let cursor = 0;
                      let lastText = -1;
                      for (const m of replyMessages) {
                        m.blocks.forEach((block, bi) => {
                          if (block.type === "text" && block.text.trim() !== "") lastText = cursor + bi;
                        });
                        cursor += m.blocks.length;
                      }
                      if (lastText >= 0) textIndexes.push(lastText);
                      process = { stats, live, textIndexes };
                      // 这一轮的块已合并：渲染时用**全部回复的块**，否则最终正文在后面的回复里就丢了
                      mergedBlocks = allBlocks;
                      // 标记：其余回复消息已被过程条收进去，不再单独渲染
                      for (const i of replies) if (i !== index) folded.add(i);
                    }
                  }
                  // 头像与名字：用户 = 你本人（/api/profile），助手 = 当前 Agent
                  // 头像尺寸随字号缩放（用户 2026-11-02：字号变大而头像不变会畸形）
                  const avatarSize = avatarSizeOf(22, prefs.font.scale);
                  const avatarNode = isUser
                    ? (profile === undefined ? undefined : <UserAvatar profile={profile} size={avatarSize} />)
                    : (agent === undefined ? undefined : <AgentAvatar id={agent.id} name={agent.name} avatar={agent.avatar} size={avatarSize} />);
                  const authorName = isUser ? profile?.name : agent?.name;

                  // 折叠时 blocks 用合并后的全轮块；不折叠时就是本条消息的块
                  const renderBlocks = mergedBlocks ?? message.blocks;
                  return (
                    <MessageView key={message.id ?? index} role={message.role} blocks={renderBlocks} messageId={message.id} busy={message.streaming === true}
                      annotationsOfBlock={message.id === undefined ? undefined : (blockIndex) => anno.ofBlock(message.id as string, blockIndex)}
                      annotationActions={isPeerSession ? undefined : annoActions}
                      onOpenPeer={(target) => {
                        // 抽屉靠右侧面板承载（layout.ts：panel 宽度要求 panelOpen），所以必须一并打开
                        panelWasOpenBeforePeer.current = panelOpen;
                        setPeerTarget(target);
                        setPanelOpen(true);
                      }}
                      {...(avatarNode !== undefined ? { avatar: avatarNode } : {})}
                      {...(authorName !== undefined ? { authorName } : {})}
                      {...(process !== undefined ? { process } : {})}
                      {...(message.at !== undefined ? { at: message.at } : {})}
                      {...(message.error !== undefined ? { error: message.error } : {})}
                      {...(message.failure !== undefined ? { failure: message.failure } : {})}
                      {...(message.failure !== undefined && index !== messages.length - 1 ? { historical: true } : {})}
                      {...(retriedTimes !== undefined && index === messages.length - 1 ? { retriedTimes } : {})}
                      {...(failureFixHint !== undefined && index === messages.length - 1 ? { fixHintText: failureFixHint } : {})}
                      {...(plan !== undefined ? { onRetry: () => void sendText(plan.text) } : {})} />
                  );
                });
              })()}
            </div>
          </main>
          {!atBottom && (
            <div className="pointer-events-none absolute inset-x-0 bottom-3 z-10 flex justify-center">
              <IconButton label="回到底部" size="lg" data-testid="jump-to-latest"
                onClick={jumpToLatest}
                className="pointer-events-auto rounded-full border border-line bg-surface shadow-md sm:h-9 sm:w-9">
                <IconArrowDown size={16} />
              </IconButton>
            </div>
          )}
        </div>

        <footer className="shrink-0 px-4 pb-safe sm:px-6 sm:pb-4">
          <div className="mx-auto w-full max-w-reading">
            {/* composer dock：一张卡两个分区（用户拍板 Task 0002 2026-10-26）。
                左区=回合事实（TurnStatusBar 数据对象不变，只是渲染进卡）；右区=输入工具注册槽（可扩展）。
                手机上工具钮回 composer 底行，且左区无内容时整张 dock 隐藏（避免空卡耗空间）。 */}
            {/* composer dock：一行共享、不带壳（2026-10-26 用户反馈“框框丑”“——裸行才是低位状态条该有的样子）。
                左区=回合事实（TurnStatusBar 数据对象不变）；右区=输入工具注册槽。
                手机上工具钮回 composer 底行，且左区无内容时整行隐藏。 */}
            <div data-testid="composer-dock"
              className={`${!(isMobile && !busy && renderStatus === undefined && turnMetrics === undefined && (meta?.usage === undefined || meta.usage.totalTokens === 0)) ? "" : "hidden"} flex min-h-7 items-center gap-3 px-1 pb-1`}>
              <div className="min-w-0 flex-1" data-testid="turn-status-bar">
                <TurnStatusBar busy={busy} step={turnStep} phase={phase}
                  {...(runFacts.lastTurn[sessionId ?? ""] !== undefined ? { turnId: runFacts.lastTurn[sessionId ?? ""]!.turnId } : {})}
                  {...(activeTool !== undefined ? { activeTool } : {})}
                  {...(retry !== undefined ? { retry } : {})}
                  {...(renderStatus !== undefined ? { status: renderStatus } : {})}
                  {...(turnMetrics !== undefined ? { metrics: turnMetrics } : {})}
                  {...(meta?.usage !== undefined ? { usage: meta.usage } : {})}
                  {...(meta?.context !== undefined ? { context: meta.context } : {})}
                  {...(meta?.payload !== undefined ? { payload: { estimated: meta.payload.effective ?? meta.payload.estimated, limit: meta.payload.limit } } : {})} />
              </div>
              {!isMobile && (
                <div data-testid="composer-tools" className="flex shrink-0 items-center gap-1">
                  <IconButton label="添加图片" onClick={() => fileInputRef.current?.click()}
                    data-testid="attach-image" className="shrink-0">
                    <IconPhoto size={16} />
                  </IconButton>
                </div>
              )}
            </div>
            {/* 模型 A：单容器 composer（chat.md §3.5）；palette 与未来横幅都属于这个对象。 */}
            {/* 排队区（P2·2.2）：本期仅可见（显示≠功能）；回合收尾/打断自动清 */}
            {sessionId !== undefined && (runFacts.queue[sessionId] ?? []).length > 0 && (
              <div data-testid="run-queue" className="mb-1 space-y-1">
                {(runFacts.queue[sessionId] ?? []).map((item, i) => (
                  <div key={i} className="inline-flex items-center gap-2 rounded bg-surface px-2 py-1 text-micro text-ink-500 ring-1 ring-line">
                    <span>{item.behavior === "steer" ? "已插话（steer · 随本轮处理）" : "已排队（followUp · 下一轮发送）"}</span>
                    <span className="max-w-40 truncate">{item.text}</span>
                  </div>
                ))}
              </div>
            )}
            <div data-testid="composer"
              onDragOver={(event) => { if (event.dataTransfer.types.includes("Files")) { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; } }}
              onDrop={(event) => {
                const files = Array.from(event.dataTransfer.files);
                if (files.length === 0) return;
                event.preventDefault();
                void collectImages(files);
              }}
              className="relative flex flex-col rounded-panel bg-surface ring-1 ring-line focus-within:ring-accent">
              {/* 批注面板（Task 0003 · P4）：放在输入框上方，与输入框互不污染。
                  peer 会话不显示（由对端驱动，不能往里发消息，见 server.ts:564-570）。 */}
              {!isPeerSession && anno.annotations.length > 0 && (
                <div className="border-b border-line p-2">
                  <AnnotationPanel
                    annotations={annoOrdered}
                    messageOrder={messages.map((m) => m.id).filter((id): id is string => id !== undefined)}
                    folded={annoPanelFolded}
                    onToggleFold={() => setAnnoPanelFolded((v) => !v)}
                    onRowClick={onAnnoRowClick}
                    pinnedOf={annoPinnedOf}
                    onRemove={annoActions.remove}
                    onClearAll={() => {
                      // 必须走 annoActions.remove（会落盘），不能直接调 anno.remove（只改内存）。
                      // 2026-11-04 用户追问"删除都测了吗"时发现：清空全部原本调的是内存版，
                      // 刷新后批注全回来了。单条删除走的是持久化版，所以那条没暴露。
                      for (const a of anno.annotations) annoActions.remove(a.id);
                    }}
                  />
                </div>
              )}
              {palette !== undefined && (
                <div aria-label="斜杠命令" className="max-h-56 overflow-y-auto overflow-hidden rounded-t-panel border-b border-line bg-sunken p-1">
                  {/* 草稿态：一句说明放在面板顶部，下面各行只留命令名（不逐行重复“发送后可用”） */}
                  {draftMode && (
                    <p className="mb-1 flex items-center gap-1.5 border-b border-line px-2 pb-1.5 pt-1 text-micro text-ink-700">
                      <IconInfoCircle size={12} className="shrink-0 text-ink-500" aria-hidden="true" />
                      发送第一条消息后，命令才可用
                    </p>
                  )}
                  {palette.items.map((item, index) => {
                    const off = item.disabled === true;
                    return (
                      <button key={item.key} type="button" disabled={off}
                        onMouseEnter={() => { if (!off) setPalette({ ...palette, index }); }}
                        onClick={() => { setPalette(undefined); item.run(); }}
                        className={`flex w-full items-center gap-2 rounded-control px-2 py-1.5 text-left text-meta transition-colors max-sm:min-h-11 disabled:cursor-not-allowed ${
                          off ? "text-ink-500" : index === palette.index ? "bg-hover text-ink-900" : "text-ink-700"
                        }`}>
                        <span className="shrink-0 font-mono">{item.label}</span>
                        {item.hint !== undefined && (
                          <span className={`ml-auto min-w-0 truncate text-micro ${off ? "text-ink-500/70" : "text-ink-500"}`}>{item.hint}</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
              {/* 附件托盘：只有有图时出现，所以无图的基线不变 */}
              {attachments.length > 0 && (
                <div data-testid="composer-attachments" className="flex flex-wrap items-end gap-2 border-b border-line px-3 py-2">
                  {attachments.map((image) => (
                    <div key={image.id} className="relative">
                      <ImageTrigger src={`data:${image.mimeType};base64,${image.data}`} alt="待发送的图片" testId="attachment-thumb-trigger">
                        <img src={`data:${image.mimeType};base64,${image.data}`} alt="" data-shot-mask="attachment-thumb"
                          className="h-14 w-14 rounded object-cover ring-1 ring-line" />
                      </ImageTrigger>
                      <button type="button" aria-label="移除图片"
                        onClick={() => { const next = removeImage(attachmentsRef.current, image.id); setAttachments(next); attachmentsRef.current = next; }}
                        className="absolute -right-1 -top-1 rounded-full bg-ink-900 p-0.5 text-surface ring-1 ring-line">
                        <IconX size={10} />
                      </button>
                    </div>
                  ))}
                  <span className="pb-1 text-micro text-ink-500">{attachmentSummary(attachments)}</span>
                </div>
              )}
              <input ref={fileInputRef} type="file" hidden multiple
                accept={IMAGE_MIME_TYPES.join(",")}
                onChange={(event) => {
                  const files = Array.from(event.target.files ?? []);
                  event.target.value = "";           // 允许连续选同一张图
                  void collectImages(files);
                }} />
              {/* 输入行：textarea 与发送/停止钮在同一 flex 行（items-end），末行对齐、互相占位 */}
              <div className="flex items-end gap-2 py-2 pl-2 pr-2">
                <textarea ref={inputRef} value={input} rows={1} aria-label="输入消息"
                  placeholder={isMobile ? "输入消息" : "输入消息 · Enter 发送 · Esc 打断 · / 命令"}
                onChange={(event) => {
                  const next = event.target.value;
                  setInput(next);
                  if (next.startsWith("/") && !next.includes(" ") && !next.includes("\n")) {
                    const items = COMMANDS.filter((item) => item.key.startsWith(next.trim()));
                    setPalette(items.length === 0 ? undefined : { items, index: 0 });
                  } else if (palette !== undefined && !next.startsWith("/")) {
                    setPalette(undefined);
                  }
                }}
                onPaste={(event) => {
                  const files = Array.from(event.clipboardData?.files ?? []).filter((file) => file.type.startsWith("image/"));
                  if (files.length === 0) return;   // 纯文本粘贴走默认行为
                  event.preventDefault();
                  void collectImages(files);
                }}
                onKeyDown={(event) => {
                  // 调色板打开时：↑/↓ 选择、Enter 执行、Esc 关闭
                  if (palette !== undefined) {
                    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                      event.preventDefault();
                      const delta = event.key === "ArrowDown" ? 1 : -1;
                      const total = palette.items.length;
                      let next = palette.index;
                      // 跳过置灰项：焦点不会停在“按了也没反应”的条目上
                      for (let step = 1; step <= total; step += 1) {
                        const candidate = (palette.index + delta * step + total * total) % total;
                        if (palette.items[candidate]?.disabled !== true) { next = candidate; break; }
                      }
                      setPalette({ ...palette, index: next });
                      return;
                    }
                    if (event.key === "Enter") {
                      event.preventDefault();
                      const item = palette.items[palette.index];
                      setPalette(undefined);
                      if (item?.disabled === true) { toast(commandOffNotice(item.key), "error"); return; }
                      item?.run();
                      return;
                    }
                    if (event.key === "Escape") { event.preventDefault(); setPalette(undefined); return; }
                  }
                  // 输入历史：空输入时 ↑/↓ 浏览（对齐 Pi CLI 的 historyPrevious/Next）
                  if ((event.key === "ArrowUp" || event.key === "ArrowDown") && input === "" && sentHistoryRef.current.length > 0) {
                    event.preventDefault();
                    // ↑ 走向更早历史（索引 +1），↓ 走回更新/清空（索引 -1）。
                    const delta = event.key === "ArrowUp" ? 1 : -1;
                    const next = Math.max(-1, Math.min(sentHistoryRef.current.length - 1, historyIndexRef.current + delta));
                    historyIndexRef.current = next;
                    setInput(next === -1 ? "" : sentHistoryRef.current[next] ?? "");
                    return;
                  }
                  if (event.key !== "Enter" || event.shiftKey) return;
                  const native = event.nativeEvent;
                  // 组字中（输入法正在选词）不发送：把 Enter 让给输入法去确认候选词
                  const composing = composingRef.current || native.isComposing || native.keyCode === 229;
                  // 组字刚结束的 100ms 内也不发送：某些浏览器会把"确认候选词的那次 Enter"再冒泡一次
                  const recentlyComposed = Date.now() - lastCompositionEndRef.current < 100;
                  if (composing || recentlyComposed) {
                    if (recentlyComposed) event.preventDefault();
                    return;
                  }
                  event.preventDefault();
                  void send();
                }}
                onCompositionStart={() => { composingRef.current = true; }}
                onCompositionEnd={() => { composingRef.current = false; lastCompositionEndRef.current = Date.now(); }}
                className="composer-autogrow w-full min-w-0 flex-1 resize-none bg-transparent pl-4 pr-2 pt-2 pb-2 text-content leading-relaxed text-ink-900 placeholder:text-ink-500" />
                {/* 发送/停止钮与 textarea 同行对齐（ChatGPT 同型），不占独立区域 */}
                  <div className="flex items-end justify-end gap-2 pb-0 pl-2 pr-2">
                  {isMobile && (
                    <IconButton label="添加图片" onClick={() => fileInputRef.current?.click()}
                      data-testid="attach-image" className="shrink-0">
                      <IconPhoto size={16} />
                    </IconButton>
                  )}
                  {busy ? (
                    <ComposerButton label="停止（Esc）" onClick={() => void stop()}>
                      <IconPlayerStopIcon />
                    </ComposerButton>
                  ) : (
                    <ComposerButton label="发送" disabled={(input.trim() === "" && !hasSendableAnnotation(anno.annotations)) || selectedProjectId === undefined}
                      onClick={() => void send()}>
                      <IconArrowUpIcon />
                    </ComposerButton>
                  )}
                </div>
              </div>
            </div>
          </div>
        </footer>
      </div>

      {/* 完整历史 · 右侧并列列 */}
      {history !== undefined && (isMobile || box.history > 0) && (
        <>
          {!isMobile && <DragHandle onStart={(event) => beginDrag("c5", event)} />}
          <aside style={{ width: isMobile ? "100%" : box.history }}
            className={`flex shrink-0 overflow-hidden ${isMobile ? "fixed inset-0 z-40 bg-surface" : ""}`}>
            <TurnInspector agentId={agent?.id ?? ""} sessionId={history.sessionId} title={history.title}
              agentName={agent?.name ?? "助手"} avatar={agent?.avatar} onClose={closeHistory} />
          </aside>
        </>
      )}

      {/* 右侧面板：文件面板，或"与其他 Agent 对话"的详情（抽屉打开时强制显示） */}
      {(panelOpen || peerTarget !== undefined) && (isMobile || box.panel > 0) && (
        <>
          {!isMobile && <DragHandle onStart={(event) => beginDrag("c4", event)} />}
          <aside style={{ width: isMobile ? "100%" : box.panel }}
            className={`flex shrink-0 overflow-hidden bg-surface ${isMobile ? "fixed inset-0 z-40" : ""}`}>
            {peerTarget !== undefined ? (
              <div className="min-w-0 flex-1 overflow-hidden">
                <PeerPanel target={peerTarget} liveEvents={liveEvents} onClose={closePeerPanel} />
              </div>
            ) : isMobile ? (
              showTree ? (
                <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
                  <FileTree onOpenFile={(path, name) => { openFile(path, name); setShowTree(false); }}
                    onHide={closeFilePanel} hideLabel="关闭文件面板" />
                </div>
              ) : (
                <div className="min-w-0 flex-1 overflow-hidden">
                  <FilePanel tabs={fileTabs} activeId={activeFileTabId}
                    onSelectTab={setActiveFileTabId} onCloseTab={closeFileTab} onPrefsChange={updateTabPrefs}
                    onClose={closeFilePanel} onShowTree={() => setShowTree(true)} />
                </div>
              )
            ) : (
              <>
                {peerTarget !== undefined ? (
                  <div className="min-w-0 flex-1 overflow-hidden">
                    <PeerPanel target={peerTarget} liveEvents={liveEvents} onClose={closePeerPanel} />
                  </div>
                ) : showTree ? (
                  <>
                    <div style={{ width: box.tree }} className="flex min-w-0 shrink-0 flex-col overflow-hidden">
                      <FileTree onOpenFile={openFile} onHide={() => setShowTree(false)} />
                    </div>
                    <DragHandle onStart={(event) => beginDrag("c4t", event)} />
                  </>
                ) : (
                  <nav aria-label="收起的列" className="flex w-11 shrink-0 flex-col items-center border-r border-line bg-sunken py-1.5">
                    <IconButton label="展开文件树" onClick={() => setShowTree(true)}><IconFileText size={18} /></IconButton>
                  </nav>
                )}
                <div className="min-w-0 flex-1 overflow-hidden">
                  <FilePanel tabs={fileTabs} activeId={activeFileTabId}
                    onSelectTab={setActiveFileTabId} onCloseTab={closeFileTab} onPrefsChange={updateTabPrefs}
                    onClose={closeFilePanel} onShowTree={() => setShowTree(true)} />
                </div>
              </>
            )}
          </aside>
        </>
      )}

      {configAgent !== undefined && (
        <AgentConfigModal agent={configAgent}
          onSaved={(updated) => {
            setAgents((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
            if (agent?.id === updated.id) setAgent(updated);
          }}
          onClose={() => setConfigAgent(undefined)} />
      )}

      {addingProject && (
        <DirectoryPicker onCancel={() => setAddingProject(false)} onSelect={registerProject} />
      )}

      {confirm !== undefined && (
        <ConfirmDialog title={confirm.title} message={confirm.message} confirmLabel={confirm.confirmLabel} danger={confirm.danger === true}
          onCancel={() => setConfirm(undefined)}
          onConfirm={() => { const run = confirm.run; setConfirm(undefined); run(); }} />
      )}

      {/* 窄窗口：左三列浮层（点空白处收起全部；参照 Pi Web / 通用 AppShell 的 overlay 抽屉） */}
      {!isMobile && box.overlayLeft && anyLeftOpen && (
        <>
          <div className="absolute inset-0 z-20 bg-ink-900/20" onClick={closeAllLeft} aria-hidden="true" />
          <div className="absolute inset-y-0 left-11 right-0 z-30 flex overflow-x-auto shadow-lg">
            {leftColumns}
          </div>
        </>
      )}

      <MobileNav open={isMobile && mobileNav} level={mobileNavLevel}
        onLevelChange={setMobileNavLevel}
        onBack={mobileNavBack}
        onClose={() => dismissMobile(() => setMobileNav(false))}
        agents={agents}
        groups={groups.map((group) => ({
          project: group.project,
          sessions: group.sessions.map((session) => ({
            sessionId: session.sessionId,
            title: titleOf(session),
            ...(session.activity.state === "running" ? { running: true } : {}),
          })),
        }))}
        {...(agent !== undefined ? { agent } : {})}
        {...(selectedProjectId !== undefined ? { projectId: selectedProjectId } : {})}
        {...(sessionId !== undefined ? { sessionId } : {})}
        canNewSession={sessionId !== undefined}
        onSelectAgent={async (item) => { const full = agents.find((entry) => entry.id === item.id); if (full !== undefined) await selectAgent(full); }}
        onSelectProject={async (project) => { const full = groups.find((group) => group.project.id === project.id)?.project; if (full !== undefined) await selectProject(full); }}
        onOpenSession={(sid) => { dismissMobile(() => setMobileNav(false)); if (agent !== undefined) void openSession(agent, sid); }}
        onNewSession={() => { dismissMobile(() => setMobileNav(false)); void newSession(); }}
        onAddProject={() => { dismissMobile(() => setMobileNav(false)); setAddingProject(true); }}
        onConfigAgent={() => { dismissMobile(() => setMobileNav(false)); if (agent !== undefined) setConfigAgent(agent); }} />
    </div>
  );
}

/** 停止按钮图标（方框；与发送箭头同尺寸规范） */
function IconPlayerStopIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <rect x="6" y="6" width="12" height="12" rx="1.5" />
    </svg>
  );
}

/** 发送按钮图标（向上箭头；与 IconUser 等一起走 Tabler 尺寸规范 16/18） */
function IconArrowUpIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 19V5" /><path d="m5 12 7-7 7 7" />
    </svg>
  );
}
import { logger } from "./logger";
import { emptyRunFacts, markViewed, applyRunEvent, applyRunningFacts, applySnapshotFacts, queueAdd, queueClear, rememberMeta, settleStopped } from "./run-facts";
import { isStreamStale, routeEvent, type RouteAction, type RouteEvent, type RouteFocus } from "./event-router";
import { deriveStatus, projectKey, type StatusFacts } from "./status-map";
import { outcomeOfTurn, turnNoticeOf } from "./turn-notice";
import { busyBelongsTo, isStaleTerminal } from "./event-guards";
