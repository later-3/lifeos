import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import {
  IconArrowDown, IconArrowLeft, IconChevronLeft, IconFileText, IconFolder, IconFolderPlus, IconHistory, IconLayoutSidebarRight, IconMessageCircle,
  IconGitCompare, IconInfoCircle, IconMenu2, IconPencil, IconPhoto, IconSettings, IconSelector, IconTrash, IconX,
} from "@tabler/icons-react";
import {
  addImage, attachmentSummary, IMAGE_MIME_TYPES, removeImage, scaledSize, shouldCompressImage,
  CLIENT_JPEG_QUALITY, toRequestImages, type PendingImage,
} from "./attachments";
import { useFold } from "./design/fold";
import { useAnnotations } from "./annotation-store";
import type { Annotation, AnnotationAuthor } from "./annotations";
import { annotationsMessage, hasSendableAnnotation } from "./annotation-message";
import { addCommentRef, attachableComment, commentRefLabel, commentRefPreview, removeCommentRef, type CommentRef } from "./composer-comment-refs";
import { commentsToText } from "./review-comment-copy";
import { groupAnnotationsByReply } from "./anno-groups";
import { rebuildHighlightStyles } from "./annotations";
import { useToast } from "./design/toast";
import { AgentConfigModal } from "./AgentConfig";
import { AgentAvatar, type AgentAvatarSpec } from "./agent-avatar";
import { UserAvatar, type UserProfile } from "./user-avatar";
import { DisplayPrefsPanel, loadPrefs } from "./display-prefs-panel";
import { fetchUiPrefs, persistBadgePrefs, persistDisplayPrefs, persistTheme, persistSelectionPrefs, cachedSelectionPrefs } from "./ui-prefs-client";
import type { SelectionPrefs } from "./selection-prefs";
import { quoteDraftOf } from "./selection-quote";
import { SelectionToolbar } from "./selection-toolbar";
import { SettingsSurface } from "./settings-surface";
import { applySurfaceTokens, applyTheme, calculatePalette, hex, loadTheme, saveTheme, type ThemeState } from "./design/theme";
import {
  avatarSizeOf, fontVars, parsePrefs, widthVar, type DisplayPrefs,
} from "./display-prefs";
import { BADGE_DEFAULTS, badgeSoft, badgeVarsOf, type BadgePrefs } from "./badge-prefs";
import { cachedBadgePrefs } from "./ui-prefs-client";
import { hasProcess, statsOf, type ProcessStats } from "./process-stats";
import { processOpenOf } from "./response-fold";
import { SessionBar, type SessionBarTurn } from "./session-bar";
import { sessionTotalsOf } from "./session-totals";
import { groupIntoSpans } from "./turn-group";
import { lastUserAtMs, turnWallMsOf } from "./turn-duration";
import { DirectoryPicker } from "./DirectoryPicker";
import { ImageTrigger } from "./design/image-viewer";
import { FileTree } from "./FileTree";
import { FilePanel } from "./FilePanel";
import { ReviewPanel, type ReviewData, type TaskCandidateView } from "./ReviewPanel";
import { DEFAULT_REVIEW_RATIO, MIN_REVIEW, reviewRatioOfPx } from "./design/layout";
import { useColumnWidth } from "./useColumnWidth";
import {
  AddProjectButton, GroupBody, GroupHeader, GroupsColumnHeader, PanelEmpty, PanelFooter, ParticipantToken, SessionRow,
} from "./groups-panel";
import { layout } from "./design/layout";
import { useFilePanel } from "./useFilePanel";
import { MessageView, type Block } from "./Message";
import { MobileNav, type Level } from "./mobile-nav";
import { useAppHeight, useEdgeBack, useIsMobile } from "./use-mobile";
import { nextActionOfMessages, resendPlan, turnOutcomeOfMessages } from "./resend";
import { failureLabel, fixHint, type FailureKind } from "./failure-text";
import type { TurnStep } from "./working";
import { applyStreamEvent, blocksOfStream, createStreamState, finalTextOfStream, textOfBlocks, type Phase, type StreamEvent } from "./stream-blocks";
import { TurnInspector } from "./SessionHistory";
import { PeerPanel, type PeerTarget } from "./PeerPanel";
import { NavRail } from "./design/rail";
import { DragHandle, ResizeColumn } from "./design/resize-column";
import { ConfirmDialog } from "./design/overlay";
import { ComposerButton, EmptyState, IconButton, Label, Row, Skeleton } from "./design/ui";
import { buildHeaderSegments, findSessionRow, headerTaskOf, headerTitleOf, joinHeaderSegments, taskTitleKey } from "./header-strip";
import { mergeTaskTitles, shouldRequest } from "./task-title-cache";
import { historyNavigate, inputHistoryOf, NO_HISTORY_CURSOR, type HistoryCursor } from "./input-history";
import type { SessionRow as SessionRowData } from "../../src/session-rows.ts";
import { rowActivityOf, type RowActivity, type RowFailureKind, type RowPhase } from "../../src/row-activity.ts";
import { useCopyOnSelect } from "./use-copy-on-select";
import { CopyFeedbackToast } from "./copy-toast";
import { ProjectOverviewCard } from "./project-overview";

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
 * ## 样式（用户 2026-11-05 选定：P1 配色 + 薄底药丸 + 圆点缩放呼吸）
 *
 * 三种状态**三个色相**，全部「薄底 + 同色深字」：
 *   · 正在跑 → `running` 蓝（#1d4ed8 / #eef2ff）← 换了色相，理由见下
 *   · 已完成 → `success` 绿（#067647 / #ecfdf3）
 *   · 失败   → `danger` 红（#b42318 / #fef3f2）
 *
 * 为什么换掉"实心绿 + 白字"（用户两次指出）：
 *   ① 结构不协调 —— 另外两个是彩色字，只有它是白字，并排看"白 1"和"绿 3"不像一套东西；
 *   ② 颜色撞车 —— 在跑与完成都是绿，实测两个 14px 色块 ΔRGB = **0**，
 *      只靠"在不在呼吸"区分；关掉动画（prefers-reduced-motion）就彻底分不出。
 *   换蓝后 ΔRGB：run↔done 152、run↔err 248、done↔err 198 —— 两两都远。
 *   全套对比度 ≥5.4:1（WCAG AA 正文达标）。
 *
 * 为什么是蓝而不是橙/灰：橙与 danger 红 ΔRGB 只有 32（13px 上几乎一样）；
 * 灰不表达"进行中"。蓝是全行业「进行中」的默认色（进度条 / 加载）。
 *
 * 呼吸：**圆点缩放**（`animate-badge-dot`），不是整体明暗 —— 实心色块整体变淡会让人
 * 以为数字要消失了；只让圆点缩放，数字始终清晰。光环（halo）留给未来的角标形态。
 *
 * 零值不渲染（照 pi-web `SessionSidebar.tsx:2009`）；>99 显示 `99+`（`design-language.md:217`）。
 */
function CountBadge({ count, kind, unit }: { count: number; kind: "running" | "unreadDone" | "unreadError"; unit: "会话" }) {
  if (count <= 0) return null;
  const text = count > 99 ? "99+" : String(count);
  const label = kind === "running"
    ? `${count} 个${unit}正在工作`
    : kind === "unreadDone"
      ? `${count} 个${unit}已完成待查看`
      : `${count} 个${unit}失败待查看`;
  // 薄底 + 同色深字（三态结构一致）；只有"在跑"加圆点缩放的呼吸。
  const tone = kind === "running"
    ? "bg-running-soft text-running animate-badge-breathe"
    : kind === "unreadDone"
      ? "bg-success-soft text-success"
      : "bg-danger-soft text-danger";
  return (
    // 状态徽标是动态数据：截图基线遮掉，只比骨架（testing 2.9）
    // 尺寸：16×16（h-4 min-w-4 px-1）。14px 时字几乎顶满色块（用户："像色块"），
    // 16px 留出内边距才"透气"。px-1（8px）+ 11px 字的数字宽 7.5px = 15.5 → 取 16 的正方形；
    // 用 px-1.5 会撑到 19.5px 宽（比高宽一圈，又变回"色块"）。双数字靠 min-w 自然撑开。
    //
    // 扩散环颜色统一走 keyframes 的 color-mix(--color-running)（badge-prefs 层派生），不再逐元素写死。
    <span className={`inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-micro font-medium leading-none tabular-nums ${tone}`}
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
  /** 未读事实：`state` 区分"完成待看"与"失败待看"（后端 `unread()` 提供）。 */
  unread: Array<{ agentId: string; sessionId: string; projectId?: string; completedAt: string; state?: "done" | "error" }>;
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
/**
 * 这一条 user 消息是谁说的（Task 0014 · D8′）。
 *
 * 后端 `messagesOf()` 从会话里的 `lifeos_turn_origin` 配对得出；没有记录的老会话回落 `{kind:"user"}`。
 * 为什么需要它：Pi 只有 role 级身份（`pi/packages/ai/src/types.ts:564-568` 的 `UserMessage` 无 author），
 * 所以 Agent↔Agent 会话里那条 user 消息会被界面当成"我说的话"——LobeHub 的注释把同一个错误写得很清楚：
 * 「instead of hard-coding the viewer's own avatar」（`packages/types/src/message/ui/chat.ts:320-331`）。
 */
type MessageSpeaker = { kind: "user" } | { kind: "agent"; agentId: string; name?: string; via?: string };
type Message = {
  role: "user" | "assistant"; text: string; blocks: Block[]; streaming?: boolean; at?: number; error?: string; failure?: FailureKind;
  /** 仅 `role === "user"` 时有值：这一轮是谁发起的（见上面 `MessageSpeaker`）。 */
  speaker?: MessageSpeaker;
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
/**
 * ResponseBar 过程区折叠态，**按 session 持久**（Task 0008 · P3，用户定案：
 * "只要折叠了就一直折叠……不要一会儿开一会儿关"）。
 * 值："open" | "folded"；没写过 = undefined（默认：生成中展开、完成后折叠）。
 */
const RESPONSE_PREF_PREFIX = "lifeos.response.";

/** 读 ResponseBar 的 per-session 折叠偏好。 */
function readResponsePref(sessionId: string | undefined): "open" | "folded" | undefined {
  if (sessionId === undefined) return undefined;
  try { const v = localStorage.getItem(`${RESPONSE_PREF_PREFIX}${sessionId}`); return v === "open" || v === "folded" ? v : undefined; } catch { return undefined; }
}
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

/** 分组折叠状态的持久化键（只存收起的项目 id）。 */
const COLLAPSED_GROUPS_KEY = "lifeos.collapsedGroups";

function readCollapsedGroups(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(COLLAPSED_GROUPS_KEY);
    if (raw === null) return {};
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: Record<string, boolean> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (value === true) out[key] = true;   // 只认 true；其它一律当展开
    }
    return out;
  } catch { return {}; }
}

function writeCollapsedGroups(value: Record<string, boolean>): void {
  try {
    const keys = Object.keys(value).filter((key) => value[key] === true);
    if (keys.length === 0) localStorage.removeItem(COLLAPSED_GROUPS_KEY);
    else localStorage.setItem(COLLAPSED_GROUPS_KEY, JSON.stringify(Object.fromEntries(keys.map((key) => [key, true]))));
  } catch { /* 忽略：存不下时退化为不持久，不影响功能 */ }
}

function ColumnHeader({ label, hint, count, onHide }: { label: string; hint?: string; count?: number; onHide: () => void }) {
  return (
    // 列内边距 8（design-language §5.1 / D21）：与助手行、分组头同一左缘。
    // 旧值 pl-3(12) 与行的 px-1.5(6) / 分组头的 pl-2(8) 各自平行，一列三条左缘。
    <div className="flex h-10 shrink-0 items-center gap-1.5 px-2">
      <Label tone="nav" className="min-w-0 truncate">{label}</Label>
      {/* 数据统计：列头里的总数（助手/会话各自有多少个），安静地跟在标题后面 */}
      {count !== undefined && (
        <span aria-label={`${label} ${count} 个`} data-shot-mask="column-count" className="inline-flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-nav-accent px-1.5 text-micro font-medium tabular-nums text-nav-muted">{count}</span>
      )}
      {hint !== undefined && <span className="min-w-0 truncate text-micro text-nav-muted">· {hint}</span>}
      <span className="ml-auto" />
      <IconButton size="sm" label="收起此列" onClick={onHide}><IconChevronLeft size={16} /></IconButton>
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
  /** 状态徽标偏好（2026-11-10 用户：速率/幅度/强度单独可调）：缓存先顶上，服务端真值随后覆盖。 */
  const [badges, setBadges] = useState<BadgePrefs>(() => cachedBadgePrefs());
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth);
  /** 设置表面（Task 0009 · P1-3）：全页设置，入口 = 头部"显示设置"按钮（原弹层升级，功能不减）。 */
  const [settingsOpen, setSettingsOpen] = useState(false);
  /**
   * 头部「显示」快捷弹层（2026-11-09 用户："还是应该在外面搞一个配置，就是原来的老位置，
   * 因为之前是改动配置，用户能实时看到工作区的改变"）。
   *
   * 与设置页的关系：**这里是快捷入口，设置页是总入口**，两者读写同一份 prefs，不存在第二份状态。
   * 只在桌面渲染（`hidden sm:inline-flex` 交给外层容器）：手机头部已有 6 个图标、标题只剩 38px。
   */
  const [displayPrefsOpen, setDisplayPrefsOpen] = useState(false);
  // 打开设置落在**导航第一项**（主题）：与 Twenty/LibreChat「进入落第一项」一致。
  // 旧默认是 display —— 那是入口还叫"显示设置"时的遗留，当时设置页只有显示一个分区。
  const [settingsSection, setSettingsSection] = useState<Parameters<typeof SettingsSurface>[0]["section"]>("appearance");
  /** 主题（Task 0009 · P1-1）：状态 → applyTheme 写 :root → saveTheme 持久化。启动时恢复。 */
  const [theme, setTheme] = useState<ThemeState>(() => loadTheme());
  useEffect(() => {
    applyTheme(theme);
    applySurfaceTokens(theme.mode);   // L3：圆角/阴影/动效/字距（三家择优）
    persistTheme(theme);              // 缓存 + 防抖同步到 ~/.lifeos/config/ui.json
  }, [theme]);
  /**
   * 启动时拉一次服务端偏好（2026-11-09 用户："是否重启就丢了配置？"）。
   *
   * 服务端是事实源（`~/.lifeos/config/ui.json`），localStorage 只是首屏缓存。
   * **只在服务端有值时覆盖** —— 首次使用（服务端没存过）时保持本地已调过的值，
   * 不拿默认值把用户刚才的调整盖掉（那是"重置"而不是"恢复"）。
   * 失败静默：偏好丢了不该让界面打不开，本地缓存仍在。
   */
  useEffect(() => {
    let alive = true;
    void fetchUiPrefs().then((remote) => {
      if (!alive || remote === undefined) return;
      if (remote.theme !== undefined) setTheme(remote.theme);
      if (remote.display !== undefined) setPrefs(remote.display);
      if (remote.badges !== undefined) setBadges(remote.badges);
      if (remote.selection !== undefined) setSelectionPrefs(remote.selection);
    });
    return () => { alive = false; };
  }, []);

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

  /**
   * 把一批批注标成"已发送"并落盘（**一次请求**，不是 N 次）。
   *
   * 为什么单开一个而不是循环调 `persistAnnotation("update")`：
   * 标记总是一批一起发生（这次发送带走的全部批注）。N 次 update 会写 N 次盘、
   * 发 N 个请求，中途失败还会留下"一半已标、一半没标"的坏状态——
   * 那正好会造成"下一轮把剩下的一半又发一遍"，也就是我们要修的那个 bug。
   */
  const persistConsume = useCallback((
    ids: readonly string[],
    sendId: string,
    targetSessionId: string | undefined,
  ) => {
    const aid = agent?.id;
    if (aid === undefined || targetSessionId === undefined || ids.length === 0) return;
    void fetch(`/api/agents/${aid}/sessions/${targetSessionId}/annotations`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ op: "consume", ids: [...ids], consumedBy: sendId }),
    }).then((r) => { if (!r.ok) toastRef.current?.("批注已发送，但状态没存住（刷新后可能重复发送）", "error"); })
      .catch(() => { toastRef.current?.("批注已发送，但状态没存住（网络错误）", "error"); });
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
  /**
   * 等待打标记的批注 id：发送受理成功后记下，等 `loadMessages` 拉回**带 id 的用户消息**
   * 再用它的 id 作 `consumedBy`。
   *
   * 为什么不能用一次性随机 id：consumedBy 还承担**归属**——已发送的批注要显示在
   * "它被发送的那一轮"的 MarkBar 里（用户 2026-11-04 规则 2）。随机 id 无法反查轮次，
   * 只有落盘的用户消息 id 能。
   */
  const pendingConsumeIdsRef = useRef<readonly string[] | undefined>(undefined);

  /** 批注面板折叠态（默认展开）。 */

  /**
   * 批注列表（表格用）：按"消息顺序 + 段内偏移"排序。
   * 用 messages 的 id 序列当消息顺序，避免按数组下标排（下标会随重渲染变）。
   */
  /** 消息 id 顺序（MarkBar 与发送共用同一套排序，保证"看到的=发出去的"）。 */
  const messageOrderForAnnos = useMemo(
    () => messages.map((m) => m.id).filter((id): id is string => id !== undefined),
    [messages],
  );

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
    if (wasPinned) {
      // 取消钉住 = 收卡（Task 0008）：hover 收起已删，否则卡片永不退场。
      window.dispatchEvent(new CustomEvent("lifeos:annotation-close", { detail: { id } }));
      return;
    }
    anno.open(id);
    // 打开并定位到原文（MarkBar 行点击是卡片唯一的打开入口，用户 2026-11-05 裁决）
    window.dispatchEvent(new CustomEvent("lifeos:annotation-locate", { detail: { id } }));
    window.requestAnimationFrame(() => {
      const host = document.querySelector(
        `[data-message-id="${target.messageId}"] [data-testid="message-text"][data-block-index="${target.blockIndex}"]`,
      );
      if (host instanceof HTMLElement) host.scrollIntoView({ block: "center", behavior: "smooth" });
    });
  }, [anno]);

  /**
   * ResponseBar 过程区的 per-session 展开态（用户手动点过的才记；没记过的用默认规则）。
   * `undefined` = 该 session 用户从未点过。
   */
  const [responsePrefs, setResponsePrefs] = useState<Record<string, "open" | "folded">>(() => ({}));
  /**
   * 切换过程区的展开态（Task 0015 · P2）。
   *
   * **参数是用户眼前看到的那个值**（`processOpenOf(...)` 的渲染结果），不再自己拿
   * `busyRef` 推一遍——以前两处 live 不同源（渲染用 `messageLive`、点击用 `busyRef`），
   * 两者不一致时点一下会算出与预期相反的 next（"点了没反应"）。
   */
  const toggleResponseProcess = useCallback((currentOpen: boolean) => {
    if (sessionId === undefined) return;
    const next = currentOpen ? "folded" : "open";
    // 副作用放在 updater **外面**：updater 必须是纯函数（StrictMode 会双调用，
    // 写在里面会写两次盘，实测得到与界面相反的值）
    try { localStorage.setItem(`${RESPONSE_PREF_PREFIX}${sessionId}`, next); } catch { /* 忽略 */ }
    setResponsePrefs((prev) => ({ ...prev, [sessionId]: next }));
  }, [sessionId]);

  /** 这条批注当前是否钉住（列表行据此高亮，也让"再点一次取消"可被看见）。 */
  const annoPinnedOf = useCallback(
    (id: string) => anno.annotations.find((a) => a.id === id)?.ui.pinned === true,
    [anno.annotations],
  );

  const [input, setInputState] = useState("");
  const [busy, setBusy] = useState(false);
  /** 草稿作用域（会话 id；无会话时 agent/project）——文字草稿与图片附件共用同一归属。 */
  const draftKey = sessionId ?? (agent !== undefined && selectedProjectId !== undefined ? `${agent.id}/${selectedProjectId}` : undefined);
  // —— 图片附件（docs/design/image-input.md）：**按会话归属**存内存（draftKey → 图片数组），
  // 切会话即换（与文字草稿同一语义；此前是整页单份，切到哪个会话都显示同一批图，用户 2026-11-14 报告）。
  // 发送成功才清当前键；不落 localStorage：单张上限 10MB 的 base64 超出其 ~5MB 配额，落盘不可行，页面刷新即丢。 ——
  const [attachmentMap, setAttachmentMap] = useState<Record<string, PendingImage[]>>({});
  const attachments = draftKey !== undefined ? attachmentMap[draftKey] ?? [] : [];
  /** 写**当前作用域**的附件；没有归属（无会话且无项目）时丢弃写入。 */
  function setAttachments(next: PendingImage[]) {
    if (draftKey === undefined) return;
    setAttachmentMap((map) => ({ ...map, [draftKey]: next }));
  }
  /**
   * 检视评论引用（A8 + G3）：**结构化条目**，不是拼进正文的文本。
   * 发送时由 `commentsToText()` 合成（同一条实现，不新造格式）；发送成功清空、失败回填。
   */
  const [commentRefs, setCommentRefs] = useState<CommentRef[]>([]);
  const commentRefsRef = useRef<CommentRef[]>([]);
  /** 附件与该 ref 的**作用域一致**（Task 0019）：[key=draftKey, images] 成对存，
   *  跨渲染回调读到时能判断“这份图是不是当前会话的”，不会把 A 的图发到 B。 */
  const attachmentsRef = useRef<{ key: string | undefined; images: PendingImage[] }>({ key: undefined, images: [] });
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
  /**
   * 输入历史（↑/↓ 浏览）的游标 —— Task 0012。
   *
   * 历史**不在这里存**：它由当前会话的消息派生（`inputHistoryOf(messages)`，见下面 `inputHistory`）。
   * 这里只存"浏览到第几条"，并且**带上它属于哪个作用域**（会话或草稿键）：
   * 作用域一变（切会话/切 Agent/发首条消息从草稿变会话），游标自动作废，
   * 不依赖 React effect 的执行时机去"记得清"（那正是老实现漏清的原因）。
   */
  const historyCursorRef = useRef<HistoryCursor>(NO_HISTORY_CURSOR);
  // 补发必须走 ref 里的最新 sendText：SSE 订阅只建一次（deps 不含 sessionId），
  // 直接调用闭包里的 sendText 会拿订阅那一帧的 sessionId（实测：内容被静默丢弃／发去旧会话）。
  const sendTextRef = useRef<(raw: string) => void>(() => {});
  // 运行事实（协议 P1·1.4）：三态列表、turn 事件、排队区的唯一事实源；呈现层只读它
  const [runFacts, setRunFacts] = useState(emptyRunFacts);
  /** 每秒 +1：只为让"运行耗时"重算（不触发任何请求、不改数据）。 */
  const [elapsedTick, setElapsedTick] = useState(0);
  /** 服务端给的跨 Agent 聚合（P8-3）；未收到快照前为空，此时只靠当前 Agent 的行。 */
  /** 每会话"上次是否在跑"（只在翻转时改聚合数字，避免节流重复补丁导致重复加）。 */
  const runningRef = useRef(new Map<string, boolean>());
  const unreadRef = useRef(new Map<string, boolean>());
  /** 每会话当前计进了哪一格（查看时才知道该减 unreadDone 还是 unreadError）。 */
  const unreadSlotRef = useRef(new Map<string, "unreadDone" | "unreadError">());
  /**
   * **所有 Agent 的逐会话状态**（唯一事实源，2026-11-04 重写）。
   *
   * 用户的原话：「这不就是个状态机吗」—— 对。此前用"每 Agent 每项目三个计数器"（+1/-1），
   * 那个模型天生会错：重复补丁重复加、别的 Agent 的补丁被过滤、漏一条就永久错位，
   * 每条路径（查看/删除/重连）都要记得对称地减。
   * 现在只存"这条会话现在是什么状态"，数字由 deriveStatus **数出来**，永不漂移。
   *
   * 三态互斥（与后端 aggregateSlotOf 一致）：running / unreadDone / unreadError；
   * 不在表里 = 不计数（已看过、或从未结束）。
   */
  const [sessionSlots, setSessionSlots] = useState<Map<string, { agentId: string; projectId?: string; slot: "running" | "unreadDone" | "unreadError" }>>(() => new Map());
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
  /**
   * 发送失败的**可见残留**（Task 0014 · S11）。
   *
   * 为什么不能放进 `messages`：`fail()` 之后会 `loadMessages()` 用服务端事实整体替换 `messages`，
   * 而"发送被拒"这条在服务端根本不存在（后端没受理），于是刚塞进去的错误气泡会被**立刻冲掉**。
   * 实测现场：用户连点 5 次 409，界面全程无提示，只能来问"为什么发不出去"。
   *
   * 所以错误放独立状态：只有用户发起下一个动作（再发一条 / 切会话）才清。
   * 参考：LibreChat `steer` 的拒绝码要告诉客户端**怎么降级**（`request.ts:384-387`），
   * 我们的 toast 直接用服务端的 `message`（它已写明三种出口）。
   */
  const [tailError, setTailError] = useState<string | undefined>();
  const [turnStep, setTurnStep] = useState<TurnStep>(1);

  const turnStartedAtRef = useRef(0);


  const [meta, setMeta] = useState<SessionMeta | undefined>();
  // 没有会话时，头部也要显示「这个 Agent 的默认模型」；配置保存后由 agents_changed 刷新。
  const [agentDefaultModel, setAgentDefaultModel] = useState<{ provider: string; id: string }>();
  /** 无会话时头部 thinking 段用：新会话将拿到的档位（Agent 配置 → settings → Pi 默认） */
  const [agentDefaultThinking, setAgentDefaultThinking] = useState<string>();
  // 头部状态条 task 段：activeTaskId → 任务标题（Task 0002）；缺失时按需拉一次清单（缺段只显示 ID）。
  const [taskTitles, setTaskTitles] = useState<Record<string, string>>({});
  /** 项目默认 Task 缓存（key = taskTitleKey(agent, project, "default")）：无会话时头部显示它 */
  const [projectDefaultTasks, setProjectDefaultTasks] = useState<Record<string, { id: string; title: string }>>({});
  /**
   * 已经**请求过**任务清单的 key（Task 0008 修复）。
   *
   * 守卫不能用"缓存里有值"：清单里没有该 taskId（task.md 缺字段、项目搬过）或项目
   * 连默认 Task 都没有时，缓存永远补不上 → effect 每次渲染都重发一次。
   * 实测：`{"items":[]}` 的应答让页面 **3 秒发了 2664 次** /tasks。
   * 规则与单测见 `frontend/src/task-title-cache.ts` / `test/task-title-cache.test.mjs`。
   */
  const requestedTaskTitles = useRef<Set<string>>(new Set());
  const requestedDefaultTasks = useRef<Set<string>>(new Set());
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
  /** 检视面板打开时临时收起的左列（关闭时恢复，与 openHistory 的 restoreFolds 同构） */
  const restoreReviewFolds = useRef<{ nav: boolean; groups: boolean } | undefined>(undefined);
  /** 检视"放不下"只提示一次，避免 resize 时反复弹 toast */
  const reviewWarned = useRef(false);
  const [showTree, setShowTree] = useFold("tree");
  /**
   * 分组折叠（Task 0015 · T15）：`{ [projectId]: true }` = 该组收起。
   * P-02 D12 说"折叠状态存单键数组"；这里用"只存收起的组"（默认全展开），
   * 因为项目通常 3–5 个，全展开是常态，只记住用户明确收起的那几个更省存储也更直观。
   */
  /**
   * 分组折叠状态，**按项目 id 持久化**（layout-model §1.2-3「切换 tab 不丢列表状态」；
   * novu `NavigationGroup` 同法：`navigation-group.tsx:5-21` 用 localStorage 存收起集）。
   *
   * 为什么不能只放 state：刷新/切 tab/切助手后折叠全被重置，用户每次都要重新收一遍。
   * 只存**收起的**那几个（默认全展开）——项目通常 3–5 个，全展开是常态。
   */
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>(readCollapsedGroups);
  useEffect(() => { writeCollapsedGroups(collapsedGroups); }, [collapsedGroups]);
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
  // 项目概览卡（Task 0010）：入口 = 分组头计数药丸；锚 = 药丸按钮（Popover 定位用）。
  // 对话数不在 state 里——从 groups 现算（行上同一份，卡与行永远一致）。
  const overviewAnchor = useRef<HTMLElement | null>(null);
  const [overview, setOverview] = useState<{ agentId: string; projectId: string; name: string } | undefined>();
  // 会话历史 = 主区视图（v2：不再塞进文件面板查看器槽，避免 200px 挤压与 ≤1280 静默失效）
  const [history, setHistory] = useState<{ sessionId: string; title: string } | undefined>();
  const { panelOpen, setPanelOpen, fileTabs, activeFileTabId, setActiveFileTabId, openFile, closeFileTab, updateTabPrefs } = useFilePanel();
  // 检视模式（Task 0010 · P2）：用户指名 Task（D15c）→ 打开面板加载两组 diff。
  // 比例存 localStorage（D12：存比例不存 px）；与文件面板并存不互斥（D10）。
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewRatio, setReviewRatio] = useState<number>(() => {
    const raw = Number(localStorage.getItem("lifeos.reviewRatio"));
    return Number.isFinite(raw) && raw > 0 && raw < 1 ? raw : DEFAULT_REVIEW_RATIO;
  });
  /** 当前检视的 taskDir —— **唯一状态源**（Task 0018 简化：之前拆成 ref + 异步 data 两处，
   *  标题同步变、内容等响应，谁晚到谁说了算，实测撕裂成“标题 0018 内容 0015”。
   *  现在标题与 reload 都从这里推导；网络晚到由 loadReview 的序号守卫丢弃。） */
  const [reviewTask, setReviewTask] = useState<string | undefined>(undefined);
  const [reviewData, setReviewData] = useState<ReviewData | null>(null);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewFailed, setReviewFailed] = useState<string | null>(null);
  const [reviewTaskPaths, setReviewTaskPaths] = useState<Record<string, string>>({});
  /**
   * D31：检视候选（哪些 Task 有东西可检视）。
   * 懒加载——只在**打开面板时**拉一次（实测 15 个 Task 0.93s；不打开面板不付这个钱）。
   */
  const [reviewCandidates, setReviewCandidates] = useState<readonly TaskCandidateView[]>([]);
  const [reviewCandidatesLoading, setReviewCandidatesLoading] = useState(false);
  const { box, beginDrag, viewport, widths } = useColumnWidth({
    folded: { nav: !showNav, groups: !showGroups },
    panelOpen,
    historyOpen: history !== undefined,
    reviewOpen,
    reviewRatio,
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
  /** 检视面板的容器（可复制区域之一；与 `<main>` 是兄弟节点，必须单独列）。 */
  const reviewRef = useRef<HTMLElement>(null);
  /**
   * 选中行为设置（Task 0018 D7-D10）：copyOnSelect 默认开 = Task 0013 现状。
   * 首屏用 localStorage 缓存（ui-prefs-client 的同一套首屏纪律），拉到真值就覆盖。
   */
  const [selectionPrefs, setSelectionPrefs] = useState<SelectionPrefs>(() => cachedSelectionPrefs());
  const setSelectionPrefsAndPersist = useCallback((next: SelectionPrefs) => {
    setSelectionPrefs(next);
    persistSelectionPrefs(next);
  }, []);
  /**
   * 选中行为（Task 0013 复制 + 0018 功能条）：
   * 对话区域（`<main>`，允许功能条）与检视面板（只复制，不弹条——D11）里拖选/双击/三击：
   *  - 「选中后自动复制」开（默认）：松手即写剪贴板 + 「已复制 · N 字」胶囊 1000ms + 功能条（无复制按钮）；
   *  - 关：松手只弹功能条（复制/批注/引用），点复制才复制（同一个胶囊反馈）。
   * 判据与动作组合都在纯函数层（copy-on-select.ts 的 shouldCopy/selectionAction），这里只挂事件与渲染。
   */
  const { feedback: copyFeedback, toolbar, closeToolbar, submitCopy } = useCopyOnSelect(
    useMemo(() => [
      // getter 对象：事件时现取 ref（main 允许功能条；检视面板不弹）
      { get current() { return scrollRef.current; }, toolbar: true },
      { get current() { return reviewRef.current; } },
    ], []),
    selectionPrefs,
    (message) => toast(message, "error"),
  );

  /**
   * 批注的外部触发（Task 0018）：功能条点「批注」→ 按 messageId 路由到对应块。
   * 锚点计算留在块内（index/text 都在那）；块处理完调 onDraftHandled 清除。
   */
  const draftNonce = useRef(0);
  const [draftRequest, setDraftRequest] = useState<{ messageId: string; nonce: number } | null>(null);
  /** 块处理完清请求（防重复触发）。 */
  const onDraftHandled = useCallback(() => setDraftRequest(null), []);
  const onAnnotateFromToolbar = useCallback(() => {
    if (toolbar === null || toolbar.messageId === undefined) return;
    draftNonce.current += 1;
    setDraftRequest({ messageId: toolbar.messageId, nonce: draftNonce.current });
    closeToolbar();
  }, [toolbar, closeToolbar]);

  /** 引用（D15）：格式化后追加进输入框（不覆盖已有草稿），焦点交给用户接话。 */
  const onQuoteFromToolbar = useCallback(() => {
    if (toolbar === null) return;
    const quote = quoteDraftOf(toolbar.text, toolbar.speaker);
    if (quote !== "") {
      setInput(input === "" ? quote : `${input}\n\n${quote}`);
      focusComposer();
    }
    closeToolbar();
  }, [toolbar, closeToolbar, input]);
  const followTail = useRef(true);
  const [atBottom, setAtBottom] = useState(true);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  /** 程序化聚焦 composer（2026-11-14 用户报"重新进入输入时光标跑到最前"）：
   *  `focus()` 不设置 selection——textarea 如果当前 selection 停在 0/0（刚挂载、或浏览器失焦时
   *  重置了 selection），聚焦后光标就在最前，接着打字插到文字开头。
   *  聚焦后把"最前且有文字"的光标移到末尾；鼠标点击的路径由 textarea 的 `onClick` 调同一规则。 */
  function focusComposer() {
    const el = inputRef.current;
    if (el === null) return;
    el.focus();
    correctCaret(el);
  }

  /** 光标纠正的唯一规则：**有文字且 selection 停在 0/0** → 移到末尾。
   *
   * 为什么需要两个调用点（实测依据：`evidence/caret/README.md`）：
   *  · 程序聚焦：`focus()` 同步触发，`selection` 保持原值不动 → 0/0 时直接在 focus 后纠正；
   *  · 鼠标点击：聚焦发生在 **mousedown**，浏览器在 **mouseup** 时才按点击位置设 selection。
   *    点在文字的左侧 padding / 首行上方空白 → 浏览器把 caret 放到行首（0/0）→ 用户感受到"跑到最前"。
   *    所以点击路径的纠正必须等 mouseup（在 `onClick` 里做）。
   *  · 点文字中间 / 拖选 / 多行行首：selection 不是 0/0 或已非空 → 不干预（保留浏览器语义）。 */
  function correctCaret(el: HTMLTextAreaElement) {
    if (el.value !== "" && el.selectionStart === 0 && el.selectionEnd === 0) {
      el.setSelectionRange(el.value.length, el.value.length);
    }
  }

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
  // 显示偏好：写缓存（刷新不丢）+ 防抖同步到服务端（换设备/换 origin 也在）
  useEffect(() => { persistDisplayPrefs(prefs); }, [prefs]);
  useEffect(() => {
    const root = document.documentElement;
    for (const [name, value] of Object.entries(fontVars(prefs.font))) root.style.setProperty(name, value);
    root.style.setProperty("--container-reading-width", widthVar(prefs.width));
  }, [prefs]);
  // —— 状态徽标：动画周期/幅度变量 + 三个 soft 底（从语义色派生，深浅色方向都向上） ——
  // soft 必须随 theme/gallery 同步：换主题（色相、深浅）后,徽标底的色相应与语义色同源。
  useEffect(() => { persistBadgePrefs(badges); }, [badges]);
  useEffect(() => {
    const root = document.documentElement.style;
    document.documentElement.dataset.badgeStrength = badges.strength;
    const palette = calculatePalette(theme);
    const toHex = (key: keyof typeof palette): string => hex(palette[key][0], palette[key][1], palette[key][2]);
    const surfaceHex = toHex("surface");
    for (const [name, value] of Object.entries(badgeVarsOf(badges))) root.setProperty(name, value);
    root.setProperty("--color-running-soft",
      badgeSoft("running", theme.mode, badges.strength, toHex("running"), surfaceHex));
    root.setProperty("--color-success-soft",
      badgeSoft("success", theme.mode, badges.strength, toHex("success"), surfaceHex));
    root.setProperty("--color-danger-soft",
      badgeSoft("danger", theme.mode, badges.strength, toHex("danger"), surfaceHex));
  }, [badges, theme]);
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
  // （draftKey 声明已上移到附件状态处：两者共用同一归属。）
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

  /**
   * 本会话的输入历史（最近一条在前）—— Task 0012。
   *
   * **派生，不自记**：事实源是服务端会话消息（`messages` 由 `GET …/sessions/:id` 或流事件重建），
   * 所以切会话天然隔离、刷新也不丢，不需要"发送时往一个数组里塞"这条第二事实源。
   * 为什么不用 localStorage：Pi TUI 是在打开会话时用该会话消息 `populateHistory` 重置，
   * pi-web 直接派生（`ChatWindow.tsx:822-833`）；三家都不额外持久化一份发送流水（见 01-background 行业参考）。
   */
  const inputHistory = useMemo(() => inputHistoryOf(messages), [messages]);
  /** 历史的作用域：有会话 = 会话 id；草稿 = agent/项目。切作用域即换历史（游标随 scope 作废）。 */
  const historyScope = draftKey ?? "";

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
  /**
   * 检视面板的宽度拖拽：比例制（D12）——拖动改 `reviewRatio`（不存 px）。
   *
   * 关键（2026-11-05 修）：比例与像素用**同一对纯函数**换算（`reviewPxOfRatio` / `reviewRatioOfPx`），
   * 且上限取 `box.reviewBudget`（layout 算出的右侧预算）——拖动与布局共用一把尺子，
   * 不会出现"拖到头还在存更大的比例"（旧实现导致 163px 死区 + 换屏跳变）。
   */
  function beginReviewDrag(event: ReactMouseEvent) {
    event.preventDefault();
    // 锚点会随夹紧**重设**：拖过上下限后立刻重设，回拖 1px 面板就跟着动（无死区）。
    // 比例与像素共用 layout 的 `reviewRatioOfPx`（分母 = 视口，上限 = box.reviewBudget），
    // 与布局同源——旧实现分母是"视口 − 聊天保底"，拖起来只跟手一半（用户报的“拖动有问题”）。
    let anchorX = event.clientX;
    let anchorWidth = box.review;
    const budget = box.reviewBudget;
    const startViewport = viewport;
    const move = (moveEvent: MouseEvent) => {
      // 把手在检视面板左缘 → 右拉=面板变小（与 c4/c5 同号语义）
      const raw = anchorWidth - (moveEvent.clientX - anchorX);
      const clamped = Math.min(budget, Math.max(MIN_REVIEW, raw));
      if (clamped !== raw) { anchorX = moveEvent.clientX; anchorWidth = clamped; }
      const next = reviewRatioOfPx(startViewport, clamped, budget);
      setReviewRatio(next);
      localStorage.setItem("lifeos.reviewRatio", String(next));
    };
    const stop = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", stop);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", stop);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }

  /** 检视 diff 请求序号：只有**最后一次发起**的请求有权写状态（Task 0018 竞态修复）。
   *  用户实测：连续切换 0015/0017/0018 时，先发出的慢响应晚到覆盖新选择 —— 标题显示 0018、
   *  内容却是 0015（前端规 2.12：切走后旧终态不得改新视图）。 */
  const reviewLoadSeq = useRef(0);
  async function loadReview(taskDir: string) {
    const seq = ++reviewLoadSeq.current;
    setReviewLoading(true);
    setReviewFailed(null);
    try {
      const response = await fetch("/api/review/diff", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ taskDir }),
      });
      const body = await response.json().catch(() => undefined) as { items?: ReviewData["items"]; error?: { message?: string } } | undefined;
      if (seq !== reviewLoadSeq.current) return;   // 已被更新的请求取代：丢弃，不覆盖新选择
      if (!response.ok || body?.items === undefined) {
        setReviewFailed(body?.error?.message ?? `加载失败（HTTP ${response.status}）`);
        setReviewData(null);
        return;
      }
      setReviewData({ items: body.items });
    } catch (error) {
      if (seq !== reviewLoadSeq.current) return;   // 旧请求的错误同样不得覆盖
      setReviewFailed(error instanceof Error ? error.message : String(error));
      setReviewData(null);
    } finally {
      if (seq === reviewLoadSeq.current) setReviewLoading(false);   // loading 只由最新请求收口
    }
  }

  /** 进入检视：用户指名 Task 目录（D15c）。Agent 代开（D16a）走工具→同此函数的语义。 */
  /**
   * D31：拉检视候选。只在打开面板时调（懒加载），失败静默降级（选择器退化成"只有当前 Task"，
   * 检视本身仍然可用——候选列表是"方便"，不是"必需"）。
   */
  function loadReviewCandidates() {
    const aid = ctx.current.agentId;
    const pid = currentGroup?.project.id ?? selectedProjectId;
    if (aid === undefined || pid === undefined) return;
    setReviewCandidatesLoading(true);
    void fetch(`/api/agents/${aid}/projects/${pid}/review-candidates`)
      .then((response) => response.ok ? response.json() as Promise<{ items?: TaskCandidateView[] }> : undefined)
      .then((data) => { if (data?.items !== undefined) setReviewCandidates(data.items); })
      .catch(() => { /* 失败静默：选择器留空，检视功能不受影响 */ })
      .finally(() => setReviewCandidatesLoading(false));
  }

  function openReview(taskDir: string) {
    setReviewTask(taskDir);
    setReviewOpen(true);
    void loadReview(taskDir);
    loadReviewCandidates();
  }

  function closeReview() {
    setReviewOpen(false);
    setReviewTask(undefined);
    setReviewData(null);
    setReviewFailed(null);
    const previous = restoreReviewFolds.current;
    if (previous !== undefined) {
      restoreReviewFolds.current = undefined;
      setShowNav(previous.nav); setShowGroups(previous.groups);
    }
  }

  // 检视放不下时（窄屏 / 文件面板 + 历史同时开）：先收左列（同 openHistory 的降级），
  // 仍放不下就**明确提示**，不静默消失（2026-11-05 实测：1366 + 文件面板时点了没反应）。
  useEffect(() => {
    if (!reviewOpen || box.reviewFits) { reviewWarned.current = false; return; }
    if (showNav || showGroups) {
      restoreReviewFolds.current ??= { nav: showNav, groups: showGroups };
      setShowNav(false); setShowGroups(false);
      return;
    }
    if (!reviewWarned.current) {
      reviewWarned.current = true;
      toast("右侧放不下检视面板：先关掉文件面板或完整历史，或把窗口放宽", "error");
    }
  }, [reviewOpen, box.reviewFits, showNav, showGroups, setShowNav, setShowGroups, toast]);

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

    /**
     * 批注生命周期（Task 0008）：发送受理成功后挂起的批注，在这里补打 `consumedBy`。
     *
     * 锚点 = **这条用户消息的真实 id**：现在消息已从服务端拉回、带着落盘的 entry id。
     * 为什么等到这里：乐观插入的那条 user 消息没有 id（App 不知道后端生成的 id），
     * 而锚点必须落盘、可反查轮次（已发送的批注要显示在"被发送那一轮"的 MarkBar）。
     */
    const waitingIds = pendingConsumeIdsRef.current;
    if (waitingIds !== undefined && waitingIds.length > 0) {
      const lastUser = [...(data.messages ?? [])].reverse().find((m) => m.role === "user" && m.id !== undefined);
      pendingConsumeIdsRef.current = undefined;
      if (lastUser?.id !== undefined) {
        anno.markConsumed(waitingIds, lastUser.id);
        persistConsume(waitingIds, lastUser.id, sid);
      }
      // 找不到 user 消息（异常）：保持挂起，下次 loadMessages 再试——不丢、也不会误标到别轮
    }

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

  /** 换会话与开草稿共用的清理：流、历史、状态条、busy 归零；消息清空；**输入上下文一并换新**
   *  （评论引用/命令面板是"这一轮"的暂存，切走即清——规范 2.12；附件不清：按会话缓存，切回仍在）。
   *  `current` / `sessionId` 由调用方设置——两者必须同步生效，异步结果据此判断“是否已切走”（C120）。 */
  function resetChatState() {
    setHistory(undefined);
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
    setCommentRefs([]);                  // 评论引用来自旧会话的检视上下文，切走即清（Task 0019）
    commentRefsRef.current = [];
    setPalette(undefined);               // 命令面板的可用性按旧会话算，残留会误导（Task 0019）
  }

  async function openSession(a: Agent, sid: string) {
    resetChatState();
    setTailError(undefined);              // 切会话：旧会话的失败残留不带到新会话
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

  /**
   * 重取会话列表。
   *
   * **同时校正状态机**（2026-11-08 修）：`sessionSlots` 是数字的唯一事实源，
   * 但它只由「快照重建」和「row 补丁」维护 —— 一旦某条补丁发早了/发漏了，
   * 数字就会永久错位（用户实测：绿色 1 挂着但行上没有绿点，因为补丁说未读、
   * 重取之后行的绿点没了，而槽位没人减）。
   *
   * 修法：重取回来的每一行**就是服务端此刻的真相**，用它覆盖槽位。
   * 这样任何"补丁与事实不一致"都会被下一次重取自愈，不需要再补一堆对称的减一。
   */
  async function reloadGroups() {
    const id = ctx.current.agentId;
    if (id === undefined) return undefined;
    const next = await fetchGroups(id);
    rememberGroups(id, next);
    setGroups(next);
    setSessionSlots((previous) => {
      let changed = false;
      const slots = new Map(previous);
      for (const group of next) {
        for (const item of group.sessions) {
          const state = item.activity.state;
          const want: "running" | "unreadDone" | "unreadError" | undefined =
            state === "running" ? "running"
              : state === "unread" ? "unreadDone"
                : state === "failure" ? "unreadError"
                  : undefined;
          const current = slots.get(item.sessionId);
          if (want === undefined) {
            if (current === undefined) continue;
            // 行说这条没有状态了 → 槽位也不该有（这正是"绿点消失但数字还在"的修复点）
            slots.delete(item.sessionId);
            changed = true;
            continue;
          }
          const effectiveProject = group.project.id;
          if (current !== undefined && current.slot === want && current.agentId === id && current.projectId === effectiveProject) continue;
          slots.set(item.sessionId, { agentId: id, projectId: group.project.id, slot: want });
          changed = true;
        }
      }
      return changed ? slots : previous;
    });
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
    // 快照 = 服务端全量事实：用它**重建**逐会话状态（不是累加）。
    // 每条 running 里的会话 → running；每条 unread 里的会话 → 按服务端给的 state 分格。
    // 这同时修掉了"切换 Agent 后别的 Agent 数字停住"—— 快照里本来就带所有 Agent。
    setSessionSlots(() => {
      const next = new Map<string, { agentId: string; projectId?: string; slot: "running" | "unreadDone" | "unreadError" }>();
      for (const r of snapshot.running ?? []) {
        if (r.sessionId === undefined || r.agentId === undefined) continue;
        next.set(r.sessionId, { agentId: r.agentId, ...(r.projectId !== undefined ? { projectId: r.projectId } : {}), slot: "running" });
      }
      for (const u of snapshot.unread ?? []) {
        if (u.sessionId === undefined || u.agentId === undefined) continue;
        if (next.has(u.sessionId)) continue;   // 在跑的优先（互斥）
        const slot = (u as { state?: string }).state === "error" ? "unreadError" as const : "unreadDone" as const;
        next.set(u.sessionId, { agentId: u.agentId, ...(u.projectId !== undefined ? { projectId: u.projectId } : {}), slot });
      }
      return next;
    });
    // **行的点也要跟着快照走**（2026-11-04）：`sessionSlots` 重建了聚合，
    // 但 `groups` 里那一行的 `activity.state` 还是旧的 —— 重连后会出现
    // "徽标说有 1 条未读、行上却没有绿点"（或反过来）的不一致。
    // 用与后端**同一个** `rowActivityOf` 重建行的四态，保证行与徽标说同一套话。
    setGroups((previous) => previous.map((group) => ({
      ...group,
      sessions: group.sessions.map((item) => {
        const runningEntry = (snapshot.running ?? []).find((r) => r.sessionId === item.sessionId);
        const unreadEntry = (snapshot.unread ?? []).find((u) => u.sessionId === item.sessionId);
        if (runningEntry === undefined && unreadEntry === undefined && item.activity.state === "idle") return item;
        const next = rowActivityOf({
          ...(runningEntry !== undefined ? { runningSince: runningEntry.startedAt } : {}),
          ...(unreadEntry !== undefined ? { unreadSince: unreadEntry.completedAt } : {}),
          now: Date.now(),
        });
        return next.state === item.activity.state && item.activity.state === "idle" ? item : { ...item, activity: next };
      }),
    })));
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
  /**
   * 记一条会话的状态（唯一事实源）。`slot` 为 `undefined` = 这条不再计数。
   *
   * 为什么是"设值"而不是"加一"：加一要求每条路径都对称地减（查看、删除、重连、
   * 别的 Agent 的补丁…），漏一条就永久错位；设值只关心"这条现在是什么状态"，
   * 同一个补丁收到十次也不会算十次。
   */
  function setSlot(sessionId: string, agentId: string, projectId: string | undefined, slot: "running" | "unreadDone" | "unreadError" | undefined): void {
    setSessionSlots((previous) => {
      const current = previous.get(sessionId);
      if (slot === undefined) {
        if (current === undefined) return previous;
        const next = new Map(previous);
        next.delete(sessionId);
        return next;
      }
      // **projectId 只增不减**（2026-11-05）：有些补丁不带 projectId（例如 focus 端点
      // 历史上传的是 undefined），若直接覆盖，这条会话的数字会从"某个项目"掉进
      // "该 Agent 的无项目桶"——项目行上的数字就消失了，用户看到"项目后面没有状态"。
      const effective = projectId ?? current?.projectId;
      if (current !== undefined && current.slot === slot && current.agentId === agentId && current.projectId === effective) return previous;
      const next = new Map(previous);
      next.set(sessionId, { agentId, ...(effective !== undefined ? { projectId: effective } : {}), slot });
      return next;
    });
  }

  /**
   * **只清"未读"，不动"在跑"**（2026-11-05 修，用户实测的 bug）。
   *
   * 症状（用户截图）：一个正在跑的会话，行上蓝点在呼吸，但项目行/助手行**没有数字**。
   *
   * 根因：点开一个正在跑的会话会触发 focus → 服务端 `markSessionViewed()` →
   * 推 `{ unread: null }`；这里原来一律 `setSlot(..., undefined)`，
   * 把这条会话的槽位**整个删掉** —— 包括它正在跑的 running 态。
   * 于是"行上有蓝点（applyRowPatch 只删 unread、running 没动），上级没有数字"。
   *
   * `{ unread: null }` 的语义只能是"这条不再有未读"，不是"这条不再有任何状态"。
   * 在跑的会话本来就没有未读可清，收到这种补丁应当**什么都不做**。
   */
  function clearUnreadSlot(sessionId: string, agentId: string): void {
    setSessionSlots((previous) => {
      const current = previous.get(sessionId);
      if (current === undefined) return previous;
      if (current.slot === "running") return previous;   // 在跑的不受"已读"影响
      void agentId;
      const next = new Map(previous);
      next.delete(sessionId);
      return next;
    });
  }

  /**
   * 从一条补丁更新"这条会话现在是什么状态"（状态机的**唯一入口**）。
   *
   * 所有 Agent 的补丁都走这里 —— 别的 Agent 的行不在当前列表里，但它的数字必须在。
   * 数字由 deriveStatus 数出来，所以这里只描述状态，不做加减。
   */
  function applySlotFromPatch(sessionId: string, agentId: string, projectId: string | undefined, patch: RowPatchPayload): void {
    if (patch.removed === true) {
      setSlot(sessionId, agentId, projectId, undefined);
    } else if ("unread" in patch && patch.unread !== null && patch.unread !== undefined) {
      // 终态：带 failure 就是失败待看，否则完成待看
      setSlot(sessionId, agentId, projectId, patch.failure !== undefined && patch.failure !== null ? "unreadError" : "unreadDone");
    } else if ("unread" in patch && patch.unread === null) {
      // 用户点开 / 已读 → **只清未读**，在跑的保持不动（见 clearUnreadSlot 注释）
      clearUnreadSlot(sessionId, agentId);
    } else if ("running" in patch && patch.running !== null && patch.running !== undefined) {
      setSlot(sessionId, agentId, projectId, "running");
    } else if ("running" in patch && patch.running === null) {
      setSlot(sessionId, agentId, projectId, undefined);
    }
  }

  function applyRowPatch(agentId: string, sessionId: string, patch: RowPatchPayload | undefined, projectId?: string): void {
    if (patch === undefined || patch === null) return;
    // 不再提前返回（2026-11-04）：别的 Agent 的行不在当前列表里，但它的**数字**必须在。
    // 用户实测：「我给 frontend agent 下发了 session，切回当前会话后那边没有呼吸的 1」。
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
      // 删了 → 这条不再有状态（数字由数出来，自然少一）
      setSlot(sessionId, agentId, projectId, undefined);
      return;
    }
    // 只有当前 Agent 的行在列表里：别的 Agent 的补丁跳过列表更新，
    // 但**状态更新不受影响**（它在函数末尾，所有 Agent 都执行）。
    if (agentId !== ctx.current.agentId) {
      applySlotFromPatch(sessionId, agentId, projectId, patch);
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

    // 状态机：所有 Agent 都更新（不受是否当前 Agent 影响 —— 用户实测的那个 bug）
    applySlotFromPatch(sessionId, agentId, projectId, patch);

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
      case "review-open": {
        /**
         * D32：Agent 请求打开检视面板。
         * **只在"我现在待的这个 agent×project"上生效**——否则用户在 A 项目里会被 B 项目的请求把面板抢走。
         * 不在当前项目时给一条提示（用户要知道"别处有东西找我看"），但不强切上下文。
         */
        const hereAgent = ctx.current.agentId;
        const hereProject = currentGroup?.project.id ?? selectedProjectId;
        if (hereAgent === action.agentId && (hereProject === undefined || hereProject === action.projectId)) {
          openReview(action.taskDir);
        } else {
          // 不在当前项目：提示但**不强切上下文**（切项目会打断用户手上的事）
          toast(`Agent 想让你检视 Task ${action.taskId} 的改动（在另一个项目里）`);
        }
        return;
      }
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
    if (!isMobile) requestAnimationFrame(focusComposer);
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
    if (!isMobile) requestAnimationFrame(focusComposer);
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
    // 会话没了，它那份未发送的图片草稿也失去归属：不清理就会在长开标签里永久占着 base64（单张上限 10MB）
    setAttachmentMap((map) => {
      if (map[session.sessionId] === undefined) return map;
      const { [session.sessionId]: _dropped, ...rest } = map;
      return rest;
    });
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
  // 附件状态与 ref 同步：sendText 可能从跨渲染的回调（sendTextRef）进来，读 ref 才不会拿到旧值。
  // **ref 带作用域**（Task 0019）：图已按会话分区，ref 若只是"最后一份数组"，
  // 跨渲染回调会在切会话后读到别的会话的图。读侧一律用 `pendingImages()`。
  useEffect(() => { attachmentsRef.current = { key: draftKey, images: attachments }; }, [draftKey, attachments]);
  /** 本次渲染/回调要发的图：ref 属于同一作用域就用它（跨渲染回调），否则用当前渲染的 state。 */
  function pendingImages(): PendingImage[] {
    return attachmentsRef.current.key === draftKey ? attachmentsRef.current.images : attachments;
  }
  useEffect(() => { commentRefsRef.current = commentRefs; }, [commentRefs]);

  /** 把用户选的/粘贴的/拖入的文件逐个变成附件；超限或非法时提示并跳过。 */
  async function collectImages(files: readonly File[]) {
    if (files.length === 0) return;
    let next = pendingImages();
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
    if (added > 0) { setAttachments(next); attachmentsRef.current = { key: draftKey, images: next }; }
  }

  async function sendText(raw: string) {
    const text = raw.trim();
    const pending = pendingImages();      // 本次发送携带的图片（发送成功才真正清空）
    if ((text === "" && pending.length === 0) || agent === undefined) return;
    if (!busyRef.current) {
      setTurnStep(1);
      turnStartedAtRef.current = Date.now();
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
        if (pending.length > 0) { setAttachments([]); attachmentsRef.current = { key: draftKey, images: [] }; }
        toast("已插话（steer，不影响当前轮继续）");
        if (sid !== undefined) setRunFacts((f) => queueAdd(f, sid, { behavior: "steer", text }));
        return;
      }
    }
    if (submittingRef.current) return;
    submittingRef.current = true;
    setTailError(undefined);             // 用户发起新动作：清掉上一次的失败残留（tailError 的唯一清理点之一）
    activeTurnIdRef.current = null;      // C119：新回合等 turn(running) 事件来认领 turnId
    setInput("");                       // 事务开始：清该会话草稿（失败会回填）
    setAttachments([]); attachmentsRef.current = { key: draftKey, images: [] };
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
      // 错误放独立状态（不进 messages）：否则紧接着的 loadMessages 会把它整体冲掉（见 tailError 注释）
      setTailError(message);
      toast(message, "error");           // 立刻可见，用户马上知道"没发出去"以及为什么
      setMessages((list) => list.slice(0, -1));   // 撤掉乐观插入的那条空 assistant，不伪造一条假回复
      setInput(text);                   // 失败回填草稿
      // 批注也要回填：否则"发送失败"等于把用户刚写的一批批注也弄丢了
      const snapshot = pendingAnnoRestore.current;
      if (snapshot !== undefined) { anno.restore(snapshot); pendingAnnoRestore.current = undefined; }
      if (pending.length > 0) { setAttachments([...pending]); attachmentsRef.current = { key: draftKey, images: [...pending] }; }
      // 评论引用也回填：否则"发送失败"等于把用户刚挑的几条评论弄丢了
      const refsSnapshot = commentRefsRef.current;
      if (refsSnapshot.length > 0) { setCommentRefs(refsSnapshot); commentRefsRef.current = refsSnapshot; }
      busyRef.current = false;
      busySessionRef.current = undefined;
      setBusy(false);
      setTurnStep(4);
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
          // resetChatState 会清评论引用（Task 0019）：退回草稿态后用户还要重发，先抓快照再回填
          const refsSnapshot = commentRefsRef.current;
          resetChatState();
          setSessionId(undefined);
          current.current = undefined;
          setInputState(text);
          setTurnStep(1);
          if (pending.length > 0) { setAttachments([...pending]); attachmentsRef.current = { key: draftKey, images: [...pending] }; }
          if (refsSnapshot.length > 0) { setCommentRefs(refsSnapshot); commentRefsRef.current = refsSnapshot; }
          void reloadGroups();
          toast(`发送失败：${error.error?.message ?? "请求被拒绝"}`, "error");
          return;
        }
        fail(`[出错] ${error.error?.message ?? "请求失败"}`);
      } else {
        setTurnStep(2);   // 2/4：后端受理（202）
        // 评论引用已被这次发送消费 → 清空（失败路径不动它，用户还能重发）
        setCommentRefs([]); commentRefsRef.current = [];
        window.setTimeout(() => { if (busyRef.current) setTurnStep(3); }, 250);   // 3/4：模型处理（含等待/思考/工具/输出）

        /**
         * **受理成功**才给批注打"已消费"（用户 2026-11-04 定案）。
         *
         * 为什么在受理后而不是回合跑完之后：`consumedBy` 的语义是"这一批已经随这条用户消息发出去了"。
         * 后端一旦 202，消息就进了模型上下文；回合后续失败也不该重发这批批注
         * （重发等于让 Agent 收到两遍同样的意见）。
         */
        // consume 推迟到 loadMessages 之后：consumedBy 需要**这条用户消息的真实 id**，
        // 而 id 只有在服务端落盘、前端重新拉取后才知道（乐观插入的那条没有 id）。
        // 推迟期间：批注既不清空也不标记（失败仍会带上，符合用户规则 3）。
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

    /**
     * 检视评论引用（A8/G3）：发送时**在这里**合成文本（同一条 `commentsToText`），
     * 与批注共用"一次模型调用"的原则（N 条合一条消息，不 N 次调用）。
     * 合成顺序：评论 → 批注 → 用户自己写的话（越靠近用户输入越"新"，与批注同一套约定）。
     */
    const pendingRefs = commentRefsRef.current;
    const refsText = pendingRefs.length === 0 ? "" : commentsToText(pendingRefs.map((ref) => ({ ...ref, replies: ref.replies ?? [] })));

    /**
     * 只发**待发送**的批注（用户 2026-11-04 定案）。
     *
     * `consumedBy` 有值 = 这条记录已经完成生命周期，**永不重发**；
     * `supersededBy` 有值 = 它被新版本取代了，只显示最新那条。
     *
     * **状态跟记录走、不跟内容走**：用户重新编辑产生的是新记录，
     * 即使文字和旧记录一模一样，它也是 pending，必须能再发。
     * 所以这里只判 id/状态，**不做任何内容比对**。
     */
    /** 三路内容合成：评论引用 + 批注 + 用户输入，最终只发**一条**消息 */
    const composeText = (base: string): string => {
      const parts = [refsText, base].filter((part) => part.trim() !== "");
      return parts.join("\n");
    };

    const pendingAnnos = annoOrdered.filter((a) => a.consumedBy === undefined && a.supersededBy === undefined);
    if (pendingAnnos.length > 0) {
      const annosText = annotationsMessage(pendingAnnos, {
        order: messages.map((m) => m.id).filter((id): id is string => id !== undefined),
      });
      // 全是"功能"标记（存档/待办）时 annosText 为空：它们不发给 Agent（用户 2026-11-03）。
      // 这时若用户也没写字，就没有可发的内容——不发，也不清空批注（清空等于把用户的分类丢了）。
      if (annosText === "") {
        if (raw !== "" || refsText !== "") void sendText(composeText(raw));
        return;
      }
      const merged = composeText(raw === "" ? annosText : `${annosText}\n${raw}`);
      // 失败要能重发：记下这一批的 id 与当时的内容（回滚用）。
      pendingAnnoRestore.current = [...anno.annotations];
      pendingConsumeIdsRef.current = pendingAnnos.map((a) => a.id);
      // 不再 die 掉全部批注：它们要保留（MarkBar 常驻），只是下面打上"已消费"
      void sendText(merged);
      return;
    }

    if (raw !== "" || refsText !== "") void sendText(composeText(raw));
  }

  const currentGroup = groups.find((group) => group.project.id === selectedProjectId);
  /**
   * 当前打开的会话：**跨项目扁平查找**，不是从「选中项目」的分组里找。
   *
   * 为什么（Task 0011 的根因）：`selectedProjectId` 与 `sessionId` 是两份独立状态 ——
   * 点另一个项目的会话行、或点另一个项目的分组头，两者就会不一致；从选中项目的分组里
   * `find` 当前会话必然落空，头部大字标题于是变成空、回落产品名「Life OS」。
   * 会话自带项目归属（session ∈ Agent × Project），查它不需要先知道"当前项目"。
   */
  const currentSessionItem = findSessionRow(groups, sessionId);
  /**
   * 头部大字标题（`header h1`）：**只来自会话自己**，与列表同一份派生（Task 0011）。
   *
   * 改前的写法是 `sessionTitle !== "" ? sessionTitle : "Life OS"` —— 产品名兜底。
   * 产品名不是这条会话的任何信息：一旦出现，就说明"选中项目 ≠ 会话所属项目"，
   * 用户看到的却是一个像标题的假名字。规则已抽进 `headerTitleOf()`（纯函数，单测锁住）。
   */
  const sessionTitle = currentSessionItem?.title.display ?? "";
  const headerTitle = headerTitleOf({ sessionId, displayTitle: sessionTitle });

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
    if (!shouldRequest(requestedTaskTitles.current, key)) return;
    let cancelled = false;
    void fetch(`/api/agents/${aid}/projects/${pid}/tasks`)
      .then((response) => response.ok ? response.json() as Promise<{ items?: TaskItem[] }> : undefined)
      .then((data) => {
        // 200 就算请求过（哪怕清单里没有这个 key）：这正是"永远补不上"的那个 key。
        if (cancelled || data?.items === undefined) return;
        requestedTaskTitles.current.add(key);
        setTaskTitles((previous) => mergeTaskTitles(previous, (id) => taskTitleKey(aid, pid, id), data.items!));
      })
      .catch(() => { /* 失败可见性：task 段回退为只显示 ID；没记 attempted，依赖变化时会重试 */ });
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
    if (!shouldRequest(requestedDefaultTasks.current, key)) return;
    let cancelled = false;
    void fetch(`/api/agents/${aid}/projects/${pid}/tasks`)
      .then((response) => response.ok ? response.json() as Promise<{ items?: TaskItem[] }> : undefined)
      .then((data) => {
        if (cancelled || data?.items === undefined) return;
        // 200 就算请求过：项目还没有默认 Task 时缓存也补不上，不记就是死循环。
        requestedDefaultTasks.current.add(key);
        const fallback = data.items.find((task) => task.isDefault === true);
        if (fallback === undefined) return;   // 项目还没有默认 Task：该段缺席，不编造
        setProjectDefaultTasks((previous) => ({ ...previous, [key]: { id: fallback.id, title: fallback.title } }));
      })
      .catch(() => { /* 失败可见性：该段缺席即可；没有默认 Task 时也不重发 */ });
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
  /** 当前打开的会话：上面 `findSessionRow(groups, sessionId)` 已算好（跨项目查找，唯一一处）。 */

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
    // 设置页开着时，点任何 rail 项都**先退出设置**（用户 2026-11-09：不要"只能再点设置才能退出"）。
    // 退出后按原逻辑处理该列，用户视线直接落到他点的那一列上。
    if (settingsOpen) setSettingsOpen(false);
    const open = key === "nav" ? showNav : showGroups;
    const set = key === "nav" ? setShowNav : setShowGroups;
    if (open) { set(false); return; }
    if (history !== undefined) closeHistory();
    else if (panelOpen) setPanelOpen(false);
    set(true);
  }
  /**
   * rail 内容（Task 0009 · 布局模型 L1；2026-11-09 用户二次裁决后定稿）。
   *
   * **两个列开关 + 一个功能页**：
   * - `助手`（toggle，showNav）：高亮 = 助手列展开，点击 = 开关该列（与改动前完全一致）；
   * - `对话`（toggle，showGroups）：高亮 = 会话列展开，点击 = 开关该列（与改动前完全一致）；
   * - `设置`（tab，settingsOpen）：高亮 = 当前在设置页，点击 = 进/出设置（rail 底部）。
   *
   * 为什么不把两个列合并成一个「对话」tab（上一版试过）：Agent × Project × Session 三级里，
   * 助手列与会话列是**两个可各自收起的列**——用户 2026-11-09：
   * 「这里的会话按钮还是不能少的，这是我们跟其他的项目不一样的，相当于你把我们之前的功能都减少了」。
   * 所以 rail 保留"列开关"这一层能力，同时用 `mode` 区分它与"功能页"（设置）。
   */
  const railGroups = [
    {
      id: "columns",
      items: [
        {
          key: "nav", label: "助手", mode: "toggle" as const, active: showNav,
          icon: agent === undefined
            ? <IconMessageCircle size={18} />
            : <AgentAvatar id={agent.id} name={agent.name} avatar={agent.avatar} size={20} />,
          onClick: () => toggleRail("nav"),
        },
        {
          key: "groups", label: "对话", mode: "toggle" as const, active: showGroups,
          icon: <IconMessageCircle size={18} />,
          onClick: () => toggleRail("groups"),
        },
      ],
    },
  ];
  const railBottom = [
    {
      key: "settings", label: "设置", mode: "tab" as const, active: settingsOpen,
      icon: <IconSettings size={18} />,
      onClick: () => setSettingsOpen((open) => !open),
    },
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
  /**
   * 聚合输入 = **逐会话状态数出来的**（2026-11-04 状态机重写）。
   *
   * `sessionSlots` 是唯一事实源：每条会话在 running / unreadDone / unreadError 里最多占一格，
   * 不占 = 不计数。这里只是把它按 Agent × 项目数一数 —— 没有计数器，所以不会漂移。
   *
   * 快照到达时用它重建（服务端是全量事实）；`row` 补丁到达时用 setSlot 改单条。
   * 两条路径写的是**同一份数据的不同部分**，不会互相覆盖。
   */
  const agentAggregate = (() => {
    const buckets = new Map<string, { agentId: string; projectId?: string; running: number; unreadDone: number; unreadError: number }>();
    for (const { agentId: aid, projectId: pid, slot } of sessionSlots.values()) {
      const key = `${aid}\u0000${pid ?? ""}`;
      let entry = buckets.get(key);
      if (entry === undefined) {
        entry = { agentId: aid, ...(pid !== undefined ? { projectId: pid } : {}), running: 0, unreadDone: 0, unreadError: 0 };
        buckets.set(key, entry);
      }
      entry[slot] += 1;
    }
    return [...buckets.values()];
  })();
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
          {/* 列自己画右缘 1px 边（Task 0006）：不再由把手盒子充当分界。
              `relative` 是把手绝对定位的锚点；把手 overflow 到列外 4px，不占布局宽度。 */}
          <ResizeColumn resizeKey="c1" width={box.c1} ariaLabel="助手列" onStart={(event) => beginDrag("c1", event)}
            className="flex-col border-r border-nav-line bg-nav-bg">
            <ColumnHeader label="助手" count={agents.length} onHide={() => setShowNav(false)} />
            {/* 助手行是用户数据（名字、增减助手都会变）：截图基线只比骨架（规范 2.9） */}
            <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 pb-2" data-shot-mask="agent-rows">
              {!loaded && <Skeleton rows={3} />}
              {agents.map((item) => (
                <Row key={item.id} selected={item.id === agent?.id} onClick={() => void selectAgent(item)}
                  status={<StatusMarks status={derived.agents[item.id]} unit="会话" />}
                  actions={
                    <>
                      <IconButton label={`配置 ${item.name}`} size="sm" onClick={() => setConfigAgent(item)}>
                        <IconSettings size={14} />
                      </IconButton>
                      <IconButton label="删除助手" size="sm"
                      onClick={() => {
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
                    </>
                  }>
                  {/*
                    * **不能再嵌套 button**（2026-11-09 axe：`nested-interactive` 34 次）：
                    * 行本身已经是 `role="button"`，里面再放一个真 `<button>` 是非法结构，
                    * 读屏与键盘都会出现“两个可点目标叠在一起”。
                    * 改成语义化 span：`role="button"` + tabIndex + Enter/Space，行为不变，
                    * 但不构成嵌套交互元素。
                    */}
                  {/*
                    * 头像**不做交互元素**（2026-11-09 axe `nested-interactive`）：
                    * 行本身就是 role=button，行内再放任何可聚焦/可点的东西都构成“交互元素嵌套”。
                    * 配置入口移到行尾的 actions 区（hover 才出现）—— 与“删除助手”同一处，
                    * 两个动作在同一区域，也不再用“点头像”这种隐藏入口。
                    */}
                  <AgentAvatar id={item.id} name={item.name} avatar={item.avatar} size={22} />
                  <span className="min-w-0 flex-1 truncate">{item.name}</span>
                </Row>
              ))}
            </div>
          </ResizeColumn>
        </>
      )}

      {/* 第2列 · 对话（项目分组 → 会话行）：Task 0015 · T15 合并后的一列 */}
      {!folded.groups && (
        <>
          <ResizeColumn resizeKey="c2" width={box.c2} ariaLabel="会话列" onStart={(event) => beginDrag("c2", event)}
            testId="groups-panel" className="flex-col border-r border-nav-line bg-nav-bg">
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
                      // 概览卡入口 = 计数药丸（Task 0010）：锚 = 药丸按钮本身。
                      onOverview={(anchor) => {
                        if (agent === undefined) return;
                        overviewAnchor.current = anchor;
                        setOverview({ agentId: agent.id, projectId: group.project.id, name: group.project.name });
                      }}
                      actions={<StatusMarks status={status} unit="会话" />} />
                    {open && (
                      <GroupBody>
                        {group.sessions.length === 0 && (
                          <p className="px-1 py-2 text-micro text-nav-muted">该项目还没有会话 · 在右下输入框发消息即可新建</p>
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
                                ? <span className="h-1.5 w-1.5 rounded-full bg-running animate-dot-breathe" data-state-dot="running" title="生成中" />
                                : failure !== undefined
                                  // 失败优先于未读：同一槽位一种含义，失败是更需要处理的那个（§5.2 四态互斥）
                                  ? <span className="h-1.5 w-1.5 rounded-full bg-danger" title={`失败：${failureLabel(failure.kind)}`} />
                                  : unread
                                    ? <span className="h-1.5 w-1.5 rounded-full bg-success" title="完成未读（查看后消失）" />
                                    : <span className="text-micro text-nav-muted">{timeAgo(item.time.lastActivityAt)}</span>} />
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
          </ResizeColumn>
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
   * 当前回合（Task 0015 · P3/P5）：用户 2026-11-07 要求"在 session bar 里面添加"，
   * 并要求**动态状态只在这一处**（"放在 session bar 里面，这样也别做两套了"）。
   *
   * 只在**焦点会话正在跑**时给出（`busy` 已带归属守卫：`busySessionRef` 必须是当前会话），
   * 空闲时不传 —— `SessionBar` 整段不渲染，不留空行。
   *
   * `startedAtMs` 的优先级（**锚点必须与完成后摘要同一个**，否则数字会跳）：
   * 1. 本轮用户消息的 `at`（`lastUserAtMs`）—— `turnWallMsOf()` 的起点就是它，
   *    所以"进行中最后一秒看到的数"与"完成后摘要里的数"能对上；
   * 2. 服务端 `running[].startedAt` —— 刚受理、user 消息还没落盘（`at` 缺失）时兜底；
   * 3. 不传 —— `WorkingRow` 回落到自己的挂载时刻（最后兜底，正常路径不会走到）。
   */
  const sessionTurn: SessionBarTurn | undefined = useMemo(() => {
    const live = busy && sessionId !== undefined && busySessionRef.current === sessionId;
    if (!live) return undefined;
    const anchor = lastUserAtMs(messages) ?? startedAtOf(runFacts, sessionId);
    const startedAtMs = anchor ?? (turnStartedAtRef.current > 0 ? turnStartedAtRef.current : undefined);
    return {
      step: turnStep,
      phase,
      ...(activeTool !== undefined ? { activeTool } : {}),
      ...(retry !== undefined ? { retry } : {}),
      ...(startedAtMs !== undefined ? { startedAtMs } : {}),
    };
    // runFacts.startedAt 每次快照/事件都会换新对象；只取这一个字段作依赖，避免无关变化触发重算
  }, [busy, sessionId, turnStep, phase, activeTool, retry, runFacts.startedAt, messages]);

  /**
   * 会话累计事实（Task 0008 · P3 修订）：轮次/工具调用/生成耗时/token/平均速度。
   *
   * 口径与来源写在 `session-totals.ts` 的文档注释里（那边有单测锁住）。
   * 这里只在 messages / meta 变化时重算——它是随消息增长的线性统计，别放进每次渲染里裸跑。
   */
  const sessionTotals = useMemo(
    () => sessionTotalsOf(messages, meta?.usage !== undefined
      ? { input: meta.usage.input, output: meta.usage.output, totalTokens: meta.usage.totalTokens }
      : undefined),
    [messages, meta?.usage],
  );
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
      {!isMobile && <NavRail groups={railGroups} bottom={railBottom} />}

      {/* 左三列：宽窗口并列；窄窗口改浮层抽屉（聊天保底不被压破） */}
      {!isMobile && !box.overlayLeft && leftColumns}

      {/* 选中即复制的提示（Task 0013）：fixed 定位，不参与任何列布局 */}
      <CopyFeedbackToast feedback={copyFeedback} />
      {/* 项目概览卡（Task 0010）：分组头计数药丸点开；fixed 定位，不参与列布局。
          对话数 = 行同一份 groups 数据（现算，不存 state）；移除项目从卡里走（confirm 复用，
          确认后同时关卡——项目已不在列表上，卡继续开着只会展示旧事实）。 */}
      <ProjectOverviewCard open={overview !== undefined} onClose={() => setOverview(undefined)}
        anchorRef={overviewAnchor}
        agentId={overview?.agentId ?? ""} projectId={overview?.projectId ?? ""} name={overview?.name ?? ""}
        sessionCount={groups.find((group) => group.project.id === overview?.projectId)?.sessions.length ?? 0}
        {...(overview !== undefined && groups.find((group) => group.project.id === overview.projectId)?.project.path !== undefined
          ? {
              onRemove: () => {
                const target = groups.find((group) => group.project.id === overview.projectId);
                if (target === undefined) return;
                setConfirm({
                  title: `移除「${target.project.name}」`,
                  message: "只从该助手移除；项目注册、该项目下的会话与记录都会保留。",
                  confirmLabel: "移除",
                  run: () => { setOverview(undefined); void unbindProject(target.project); },
                });
              },
            }
          : {})} />
      {/* 选中功能条（Task 0018）：portal 到 body，fixed 定位；按钮组合弹出时已定死 */}
      {toolbar !== null && (
        <SelectionToolbar
          state={{
            text: toolbar.text,
            anchor: toolbar.anchor,
            annotatable: toolbar.annotatable,
            speaker: toolbar.speaker,
            buttons: toolbar.buttons,
          }}
          onClose={closeToolbar}
          onCopy={submitCopy}
          onAnnotate={onAnnotateFromToolbar}
          onQuote={onQuoteFromToolbar}
        />
      )}

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
            <h1 className="truncate text-body font-semibold text-ink-900">{headerTitle}</h1>
            {/* truncate 时必须带 title：手机上实测只剩 "Life Agent · workspace · …"，
                后半段（模型 / 档位 / 任务）被截掉且没有悬停提示 = 信息不可达。 */}
            <p className="truncate text-micro text-ink-500" data-testid="header-meta"
              title={joinHeaderSegments(buildHeaderSegments({
                agentName: agent?.name ?? "",
                ...(currentSessionItem?.peer != null ? { peerName: currentSessionItem.peer.name } : {}),
                projectName: currentGroup?.project.name ?? "",
                sessionTitle,
                headerModel: headerModel ?? null,
                thinkingLevel: sessionId !== undefined ? meta?.thinkingLevel : agentDefaultThinking,
                activeTaskId: headerTask?.id,
                taskTitle: headerTask?.title,
              }))}>
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
          {/* 快捷显示设置（老位置）：桌面显示、手机隐藏（手机去设置页）。
              className 里用 `hidden sm:inline-flex` 会让 IconButton 自带的 inline-flex 失效，
              所以外面套一层条件渲染的容器 —— 与页面里其它"手机不渲染"的写法一致。 */}
          {!isMobile && (
            <DisplayPrefsPanel prefs={prefs} viewport={viewportWidth} onChange={setPrefs}
              open={displayPrefsOpen} onOpenChange={setDisplayPrefsOpen} />
          )}
          <IconButton label="完整历史" size="lg" active={history !== undefined} disabled={sessionId === undefined}
            onClick={() => { if (sessionId !== undefined) { if (history !== undefined) closeHistory(); else openHistory(sessionId, sessionTitle); } }}>
            <IconHistory size={16} />
          </IconButton>
          <IconButton label="检视当前 Task 的改动" size="lg" active={reviewOpen}
            onClick={() => {
              const aid = agent?.id;
              const pid = currentGroup?.project.id ?? selectedProjectId ?? "workspace";
              const taskId = meta?.activeTaskId ?? projectDefaultTasks[taskTitleKey(aid ?? "", pid, "default")]?.id;
              if (aid === undefined || taskId === undefined) { toast("当前没有可检视的 Task", "error"); return; }
              const key = taskTitleKey(aid, pid, taskId);
              const known = reviewTaskPaths[key];
              if (known !== undefined) { if (!reviewOpen) openReview(known); else closeReview(); return; }
              void fetch(`/api/agents/${aid}/projects/${pid}/tasks/${taskId}/review-sources`)
                .then((response) => response.ok ? response.json() as Promise<{ taskDir?: string; items?: Array<{ kind: string; path: string }> }> : undefined)
                .then((data) => {
                  const lifeos = data?.items?.find((item) => item.kind === "lifeos");
                  if (lifeos === undefined) { toast("拿不到这个 Task 的目录", "error"); return; }
                  // 面板要的是 **taskDir**（diff 接口的口径）：items[].path 是源目录（lifeos 源 =
                  // <taskDir>/home），拿它开面板等于把 worktree 根当 Task 目录 → 永远空
                  //（2026-11-12 实测：手点按钮后面板全空）。新后端直接回 taskDir；老后端回退拼回去。
                  const taskDir = typeof data?.taskDir === "string" ? data.taskDir : lifeos.path.replace(/\/home$/, "");
                  setReviewTaskPaths((prev) => ({ ...prev, [key]: taskDir }));
                  if (!reviewOpen) openReview(taskDir); else closeReview();
                })
                .catch(() => toast("检视面板打开失败", "error"));
            }}>
            <IconGitCompare size={18} />
          </IconButton>
          {/*
            A3 的「箭头」：主按钮看当前 Task，这个按钮打开面板并把焦点放到"检视对象"选择器上。
            为什么不做真正的 split button 下拉：面板里已经有原生 `<select>`（键盘可达、无自绘成本），
            再自绘一个下拉等于同一类 UI 两套实现（frontend-spec 2.3）。
          */}
          <IconButton label="选择要检视的 Task" size="lg"
            onClick={() => {
              const current = reviewTask;
              if (current === undefined) { toast("先点左边的检视按钮打开面板"); return; }
              openReview(current);
              window.setTimeout(() => {
                document.querySelector<HTMLSelectElement>("[data-review-switcher-select]")?.focus();
              }, 350);
            }}>
            <IconSelector size={16} />
          </IconButton>
          <IconButton label={panelOpen ? "收起文件面板" : "展开文件面板"} size="lg" active={panelOpen}
            onClick={() => {
              if (!panelOpen && history !== undefined) closeHistory();
              if (!panelOpen && isMobile && fileTabs.length === 0) setShowTree(true);
              if (panelOpen) closeFilePanel(); else setPanelOpen(true);
            }}>
            <IconLayoutSidebarRight size={16} />
          </IconButton>
          {/* 设置入口（Task 0009 · 2026-11-09 用户裁决）：桌面在图标轨底部；
              手机无图标轨，只有头部入口。**条件渲染**而不是 hidden 类——
              IconButton 自带 inline-flex，类名顺序会让 hidden 失效（2026-11-09 用户抓到重复入口）。 */}
          {isMobile && (
            <IconButton label="打开设置" size="lg" active={settingsOpen}
              onClick={() => setSettingsOpen((open) => !open)}>
              <IconSettings size={16} />
            </IconButton>
          )}
        </header>

        <div className="relative min-h-0 flex-1">
          {!settingsOpen && <main ref={scrollRef}
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
                /**
                 * 批注按**轮**分组（Task 0008 · P2 修订，用户 2026-11-04 规则）：
                 *
                 *  - **未发送**（pending）→ 全部显示在【最新一轮】Agent 回复的 MarkBar 下，
                 *    不管它标的是哪一轮的文字——它们语义上属于"下一次要发出的消息"；
                 *  - **已发送**（consumedBy = 该轮用户消息 id）→ 显示在**被发送那一轮**的 MarkBar，
                 *    历史不动。
                 *
                 *  这样每条 Agent 回复下面最多一个 MarkBar；一个对话里多个轮次各有各的。
                 */
                const latestReplyId = (() => {
                  const last = spans[spans.length - 1];
                  if (last === undefined) return undefined;
                  const replies = last.replyIndexes.map((i) => messages[i]).filter((m): m is Message => m !== undefined && m.role === "assistant" && m.id !== undefined);
                  return replies[replies.length - 1]?.id;    // 最新轮最后一条回复（占位回复也算）
                })();
                // 各轮"MarkBar 挂点"：轮末回复若被过程条折叠，改挂**该轮第一条可见回复**。
                //
                // 为什么是第一条：过程条挂在轮的第一条回复上，同轮其余回复全部被收进去不渲染
                //（见渲染循环里的 `folded.add`——它在循环里才执行，这里必须**独立复算同一规则**，
                //  否则 MarkBar 会挂到一条不渲染的消息上跟着消失，2026-11-04 实测）。
                // 折叠条件与循环里一致：`process.stats.tools > 0 || thinking > 0` 且该轮不是首条。
                const visibleLastReplyByUserMessageId = new Map<string, string>();
                for (const span of spans) {
                  if (span.userIndex < 0) continue;
                  const user = messages[span.userIndex];
                  if (user?.id === undefined) continue;
                  const replyMsgs = span.replyIndexes.map((i) => messages[i]).filter((m): m is Message => m !== undefined);
                  if (replyMsgs.length === 0) continue;
                  const hasProcess = (m: Message): boolean => {
                    const blocks = m.blocks ?? [];
                    return blocks.some((b) => b.type === "toolCall" || b.type === "thinking");
                  };
                  // 首条回复永远可见（过程条宿主）；只有当"轮内存在其他可见回复"时轮末才算可见。
                  // 规则：若轮内任何一条非首条回复**没有**过程块（单独渲染的最终正文），轮末可见；
                  //      否则（全部折叠）可见轮末 = 首条回复。
                  const anchorable = replyMsgs.some((m, i) => i > 0 && !hasProcess(m));
                  const anchor = anchorable ? replyMsgs[replyMsgs.length - 1] : replyMsgs[0];
                  if (anchor.id !== undefined) visibleLastReplyByUserMessageId.set(user.id, anchor.id);
                }
                const annoGroups = groupAnnotationsByReply(anno.annotations, messages, latestReplyId, visibleLastReplyByUserMessageId);
                // ResponseBar 的过程区展开态（本 session 用户点过则听用户的，否则按 live 定）
                const responsePref = responsePrefs[sessionId ?? ""] ?? readResponsePref(sessionId);
                // 会话级指标挂哪一条：最后一条 assistant（全列表唯一，避免重复）
                let lastAssistantIndex = -1;
                messages.forEach((m, i) => { if (m.role === "assistant") lastAssistantIndex = i; });
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
                  /** 本轮是否还在生成（轮级；多段回复时挂在第一段上的过程条也要跟着展开）。 */
                  const replyLive = replyMessages.some((m) => m.streaming === true);
                  if (!isUser && isFirstReply) {
                    const allBlocks = replyMessages.flatMap((m) => m.blocks);
                    // 时长（Task 0015 · P4）：**墙钟**，与 SessionBar 的累计口径、以及「当前回合」
                    // 进行中那个秒数是同一个函数（`turnWallMsOf`）算出来的。
                    // 以前这里用 Σassistant.durationMs（纯模型时间），跑完会比跑的时候小，
                    // 数字往回跳（实测 sleep 6 的回合：墙钟 34417ms vs ΣdurationMs 28323ms，案例 C004）。
                    // **进行中不算时长**：那一刻的墙钟由 SessionBar 的「当前回合」在显示（它每秒在走）。
                    // 这里只在**完成后**给一个定值，避免同一个数在两个地方各说一套（案例 C004）。
                    const span = spanByIndex.get(index);
                    const wallMs = replyLive || span === undefined ? undefined : turnWallMsOf(messages, span);
                    const tokens = replyMessages.reduce((sum, m) => sum + (m.tokens ?? 0), 0);
                    const stats = statsOf(allBlocks, {
                      ...(wallMs !== undefined && wallMs > 0 ? { durationMs: wallMs } : {}),
                      ...(tokens > 0 && !replyLive ? { tokens } : {}),
                    });
                    const live = replyLive;
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
                  // 头像与名字（Task 0014 · D8′）：user 消息看后端给的 `speaker`——
                  // 用户本人 → 你的档案头像；"某个 Agent 发起的" → 那个 Agent 的头像与名字。
                  // 助手侧一律是当前 Agent。左右对齐不变（D10：保持现状，只换头像名字）。
                  // 头像尺寸随字号缩放（用户 2026-11-02：字号变大而头像不变会畸形）
                  const avatarSize = avatarSizeOf(22, prefs.font.scale);
                  // 先取出 agent 分支的 speaker（TS 窄化：`speaker?.kind === "agent"` 在闭包里会丢，所以提前落到局部常量）
                  const agentSpeaker = isUser && message.speaker?.kind === "agent" ? message.speaker : undefined;
                  const speakerAgent = agentSpeaker === undefined ? undefined : (() => {
                    const known = agents.find((item) => item.id === agentSpeaker.agentId);
                    // 发起方可能已被归档/删除：有 id 就够画头像（AgentAvatar 由 id 推导色阶 + 首字母）
                    return { id: agentSpeaker.agentId, name: known?.name ?? agentSpeaker.name ?? agentSpeaker.agentId, avatar: known?.avatar };
                  })();
                  const avatarNode = speakerAgent !== undefined
                    ? <AgentAvatar id={speakerAgent.id} name={speakerAgent.name} {...(speakerAgent.avatar !== undefined ? { avatar: speakerAgent.avatar } : {})} size={avatarSize} />
                    : isUser
                      ? (profile === undefined ? undefined : <UserAvatar profile={profile} size={avatarSize} />)
                      : (agent === undefined ? undefined : <AgentAvatar id={agent.id} name={agent.name} avatar={agent.avatar} size={avatarSize} />);
                  const authorName = speakerAgent !== undefined ? speakerAgent.name : (isUser ? profile?.name : agent?.name);

                  // 折叠时 blocks 用合并后的全轮块；不折叠时就是本条消息的块
                  const renderBlocks = mergedBlocks ?? message.blocks;

                  /**
                   * MarkBar 的数据（Task 0008 · P2 修订）：按**轮**分组后挂在本回复下的批注。
                   * - pending 全部挂在最新一轮（不管标在哪个轮次的文字上）；
                   * - consumed 挂在被发送那一轮；
                   * 分组逻辑见 `anno-groups.ts`（纯函数 + 单测）。
                   */
                  /**
                   * ResponseBar 的数据（Task 0008 · P3 修订）。
                   *
                   * 只说**这一轮**：过程统计 + 进行中状态 + 回合结论文案。
                   * 会话累计指标（轮次/工具/耗时/token/平均速度/上下文/请求体）归输入框上方的
                   * `SessionBar`（用户 2026-11-05："turnstat bar 把一些信息换为累计的信息"），
                   * 不再挂在回复上——两处都显示同一份数字就是重复。
                   */
                  const isThisStreaming = message.streaming === true;
                  /**
                   * 这一轮是否还在跑（**轮级**，不是"这条消息在跑"）。
                   *
                   * 为什么分开：一轮可能有多个 assistant 段，过程块只挂在**第一段**上（`isFirstReply`），
                   * 而流式标志常在后来的段上。用"这条在流式"判断，会让挂着过程的 bar 在生成期间
                   * 一直是折叠的（实测：工具跑起来了，bar 还显示"查看过程"）。
                   * 老 ProcessBar 用的就是轮级 live（`process.live`），这里保持一致。
                   */
                  const messageLive = isThisStreaming || replyLive;
                  /** 过程区**当前是否展开**（渲染与点击共用这一个值，Task 0015 · P2）：
                   *  以前点击自己拿 `busyRef` 再算一遍，两处 live 不同源时点一下会算出相反的 next。 */
                  const messageProcessOpen = processOpenOf(responsePref, messageLive);
                  const messageResponseBar = message.role === "assistant"
                    ? {
                        // 进行中：轮在跑 → live（等待过渡 / 过程块展开）；占位（无 blocks）→ 等待过渡
                        ...(messageLive ? { live: true, waiting: (message.blocks?.length ?? 0) === 0 } : {}),
                        // **动态状态不在这里**（Task 0015 · P5，用户 2026-11-07）：
                        // "关于动态的东西……直接放到 session bar 里面，这样也别做两套了。只是每一次
                        //  response bar 完成之后，他自己的信息自己给他那儿展示，在正在完成的过程当中，
                        //  就还是显示在 session bar"。
                        // 所以 step / phase / activeTool / retry / 秒数全部只由 SessionBar 的「当前回合」显示，
                        // 这里只在**完成后**给出过程摘要（stats，见 process）。
                        // 回合结论文案（对账成功/中断原因等）：跟着进行中/最新那条走
                        ...((messageLive || index === lastAssistantIndex) && renderStatus !== undefined ? { status: renderStatus } : {}),
                        // 过程区受控展开（per-session 持久；规则唯一来源 processOpenOf）
                        processOpen: messageProcessOpen,
                        onToggleProcess: () => toggleResponseProcess(messageProcessOpen),
                      }
                    : undefined;

                  const messageMarkBar = message.role === "assistant" && message.id !== undefined
                    ? (() => {
                        const list = annoGroups.get(message.id) ?? [];
                        return list.length === 0 ? undefined : {
                          annotations: list,
                          messageOrder: messageOrderForAnnos,
                          onRowClick: onAnnoRowClick,
                          pinnedOf: annoPinnedOf,
                          onRemove: annoActions.remove,
                          onRemoveAll: () => {
                            for (const a of list) annoActions.remove(a.id);
                          },
                        };
                      })()
                    : undefined;

                  return (
                    <MessageView key={message.id ?? index} role={message.role} blocks={renderBlocks} messageId={message.id} busy={message.streaming === true}
                      annotationsOfBlock={message.id === undefined ? undefined : (blockIndex) => anno.ofBlock(message.id as string, blockIndex)}
                      annotationActions={annoActions}
                      draftRequest={draftRequest !== null && draftRequest.messageId === message.id ? draftRequest : null}
                      {...(onDraftHandled !== undefined ? { onDraftHandled } : {})}
                      {...(messageResponseBar !== undefined ? { responseBar: messageResponseBar } : {})}
                      {...(messageMarkBar !== undefined ? { markBar: messageMarkBar } : {})}
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
          </main>}
          {!settingsOpen && !atBottom && (
            <div className={`pointer-events-none absolute inset-x-0 bottom-3 ${LAYER_CLASS.rail} flex justify-center`}>
              <IconButton label="回到底部" size="lg" data-testid="jump-to-latest"
                onClick={jumpToLatest}
                className="pointer-events-auto rounded-full border border-line bg-surface sm:h-9 sm:w-9"
                style={surfaceStyle("popover")}>
                <IconArrowDown size={16} />
              </IconButton>
            </div>
          )}
        </div>

        <footer className="shrink-0 px-4 pb-safe sm:px-6 sm:pb-4">
          <div className="mx-auto w-full max-w-reading">
            {/* SessionBar（Task 0008 · P3 修订）：输入框上方的**会话累计**事实条 + 添加图片。
                用户 2026-11-05："turnstat bar 把一些信息换为累计的信息……图片那个可以融入到
                turnstatusbar 了，或不叫 turnstatusbar？换一个名字" → 改名 SessionBar，图片并进来。
                手机上仍回 composer 底行（那里已有添加图片）。
                **Task 0015 · P3**：用户 2026-11-07 要求把"当前回合"加回来——
                "这个能不能就直接在 session bar 里面呢？就跟之前在 turnstatusbar 里面一样，
                 而 Response bar 里面的还不能取消，相当于是在 session bar 里面添加！"
                所以 `turn` 只在生成中传（空闲时整段不渲染）；ResponseBar 那边一行不改。 */}
            <div data-testid="composer-dock" className={`${isMobile ? "hidden" : ""} px-1 pb-1`}>
              <SessionBar totals={sessionTotals}
                {...(meta?.context !== undefined ? { context: meta.context } : {})}
                {...(meta?.payload !== undefined ? { payload: { estimated: meta.payload.effective ?? meta.payload.estimated, limit: meta.payload.limit } } : {})}
                {...(runFacts.lastTurn[sessionId ?? ""] !== undefined ? { turnId: runFacts.lastTurn[sessionId ?? ""]!.turnId } : {})}
                {...(sessionTurn !== undefined ? { turn: sessionTurn } : {})}
                onAttachImage={() => fileInputRef.current?.click()} />
            </div>
            {/* 模型 A：单容器 composer（chat.md §3.5）；palette 与未来横幅都属于这个对象。 */}
            {/* 失败残留（Task 0014 · S11）：发送被拒/网络错误时留在这里，不被随后的重新拉取冲掉。
                与排队区同一容器（"输入区是一个对象"，frontend-spec §5）；下一次发送或切会话才清。 */}
            {tailError !== undefined && (
              <div data-testid="send-error" role="alert"
                className="mb-1 flex items-start gap-2 rounded-panel bg-danger-soft px-3 py-2 text-micro text-danger ring-1 ring-danger/30">
                <IconInfoCircle size={12} className="mt-0.5 shrink-0" aria-hidden="true" />
                <span className="min-w-0 flex-1">{tailError}</span>
                <button type="button" aria-label="关闭提示" onClick={() => setTailError(undefined)}
                  className="shrink-0 rounded p-0.5 text-danger transition-colors hover:bg-danger/10">
                  <IconX size={12} />
                </button>
              </div>
            )}
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
              {/* 检视评论引用 chip（A8/G3）：一条一个，可单独移除；发送时才合成文本 */}
              {commentRefs.length > 0 && (
                <div data-testid="composer-comment-refs" className="flex flex-wrap items-center gap-1.5 border-b border-line px-3 py-1.5">
                  {commentRefs.map((ref) => (
                    <span key={ref.id} data-comment-ref={ref.id}
                      className="group/ref relative flex max-w-full items-center gap-1 rounded-inner bg-anno-query-soft px-1.5 py-0.5 text-micro text-anno-query ring-1 ring-anno-query-soft">
                      <span className="shrink-0 font-mono" data-comment-ref-label>{commentRefLabel(ref)}</span>
                      <span className="min-w-0 truncate text-ink-700" data-comment-ref-preview>{commentRefPreview(ref)}</span>
                      <button type="button" aria-label={`移除评论引用 ${commentRefLabel(ref)}`}
                        onClick={() => setCommentRefs((prev) => removeCommentRef(prev, ref.id))}
                        data-comment-ref-remove
                        className="shrink-0 rounded-full p-0.5 text-anno-query hover:bg-hover hover:text-danger">
                        <IconX size={10} />
                      </button>
                    </span>
                  ))}
                  <span className="pb-0.5 text-micro text-ink-500">{commentRefs.length} 条评论引用（发送时一并带上）</span>
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
                        onClick={() => { const next = removeImage(pendingImages(), image.id); setAttachments(next); attachmentsRef.current = { key: draftKey, images: next }; }}
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
              {/* 间距收口（Task 0009 · P2-2）：demo 实测四层叠加（8+16 / 8+8+8）比参考厚一倍，收成单层语义。
              命中区与功能不动：发送/停止 44 触达、附件、palette、历史键程全部保持。 */}
              <div className="flex items-end gap-1.5 py-1.5 pl-2 pr-1.5">
                <textarea ref={inputRef} value={input} rows={1} aria-label="输入消息"
                  placeholder={isMobile ? "输入消息" : "输入消息 · Enter 发送 · Esc 打断 · / 命令"}
                onChange={(event) => {
                  const next = event.target.value;
                  // 用户一打字就退出历史浏览（Pi TUI 里每个编辑动作都调 exitHistoryBrowsing）。
                  // 只认 textarea 的 change（只有用户输入会触发它，程序 setInput 不会），
                  // 不用"文字是否等于历史某条"去猜（规范 2.1：禁止靠值比较猜语义）。
                  historyCursorRef.current = NO_HISTORY_CURSOR;
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
                  // 输入历史：↑/↓ 浏览**本会话**发过的消息（chat.md §3.5）——Task 0012。
                  // 规则全在纯函数里（frontend/src/input-history.ts，逐条契约见 test/input-history.test.mjs）：
                  //   · 历史从当前会话消息派生，切会话即换（不再有"整页一份、切换忘了清"的问题）；
                  //   · ↑ = 更旧、↓ = 更新，方向与"最近一条在前"的数组同向（Pi TUI editor.ts:456-486）；
                  //   · 已在浏览时输入框非空也继续走（`input === ""` 只是**进入**浏览的条件，
                  //     老实现把它当成每一次按键的前提，于是第一下之后再也按不动）。
                  if (event.key === "ArrowUp" || event.key === "ArrowDown") {
                    const step = historyNavigate({
                      cursor: historyCursorRef.current,
                      scope: historyScope,
                      history: inputHistory,
                      direction: event.key === "ArrowUp" ? "older" : "newer",
                      inputEmpty: input === "",
                    });
                    if (step !== undefined) {
                      event.preventDefault();
                      historyCursorRef.current = step.cursor;
                      setInput(step.text);
                      return;
                    }
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
                onClick={(event) => correctCaret(event.currentTarget)}
                onCompositionEnd={() => { composingRef.current = false; lastCompositionEndRef.current = Date.now(); }}
                className="composer-autogrow w-full min-w-0 flex-1 resize-none bg-transparent pl-2 pr-1 pt-2 pb-2 text-content leading-relaxed text-ink-900 placeholder:text-ink-500" />
                {/* 发送/停止钮与 textarea 同行对齐（ChatGPT 同型），不占独立区域 */}
                  <div className="flex items-end justify-end gap-2 pb-0 pl-2 pr-2">
                  {/* 图片入口：手机一直在 composer 内；桌面上在 SessionBar 里（用户 2026-11-05 要求并进那条）。
                      但**空会话时 SessionBar 整条不渲染**（2026-11-09 审核：空白条 + 孤立图标看着像坏了），
                      这时入口回落到 composer 内 —— 功能一个都不能少，位置随状态走。 */}
                  {(isMobile || sessionTotals.turns === 0) && (
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
                    <ComposerButton label="发送" disabled={(input.trim() === "" && !hasSendableAnnotation(anno.annotations) && commentRefs.length === 0) || selectedProjectId === undefined}
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
          <ResizeColumn resizeKey="c5" side={isMobile ? "right" : "left"} ariaLabel="完整历史" width={isMobile ? "100%" : box.history}
            onStart={(event) => beginDrag("c5", event)}
            className={`border-l border-nav-line ${isMobile ? `fixed inset-0 ${LAYER_CLASS.drawer} bg-surface` : ""}`}>
            <div className="flex min-w-0 flex-1 overflow-hidden">
              <TurnInspector agentId={agent?.id ?? ""} sessionId={history.sessionId} title={history.title}
                agentName={agent?.name ?? "助手"} avatar={agent?.avatar} onClose={closeHistory} />
            </div>
          </ResizeColumn>
        </>
      )}

      {/* 右侧面板：文件面板，或"与其他 Agent 对话"的详情（抽屉打开时强制显示） */}
      {(panelOpen || peerTarget !== undefined) && (isMobile || box.panel > 0) && (
        <>
          <ResizeColumn resizeKey="c4" side={isMobile ? "right" : "left"} ariaLabel="文件面板" width={isMobile ? "100%" : box.panel}
            onStart={(event) => beginDrag("c4", event)}
            className={`border-l border-nav-line bg-surface ${isMobile ? `fixed inset-0 ${LAYER_CLASS.drawer}` : ""}`}>
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
                    <ResizeColumn resizeKey="c4t" width={box.tree} onStart={(event) => beginDrag("c4t", event)}
                      as="div" className="min-w-0 flex-col">
                      {/* 裁切留在内层：ResizeColumn 自己是 overflow-visible（否则把手会被裁掉一半） */}
                      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
                        <FileTree onOpenFile={openFile} onHide={() => setShowTree(false)} />
                      </div>
                    </ResizeColumn>
                  </>
                ) : (
                  <nav aria-label="收起的列" className="flex w-11 shrink-0 flex-col items-center border-r border-nav-line bg-nav-bg py-1.5">
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
          </ResizeColumn>
        </>
      )}

      {/* 设置表面（Task 0009 · P1-3）：全页——覆盖除图标轨外的所有区域（含 composer）。
          参照 Twenty/LobeHub：设置是独立页面，不是叠在对话上的浮层。 */}
      {settingsOpen && !isMobile && (
        <div className={`absolute inset-y-0 right-0 left-11 ${LAYER_CLASS.drawer}`}>
          <SettingsSurface section={settingsSection} onSection={setSettingsSection} selection={selectionPrefs} onSelection={setSelectionPrefsAndPersist}
            theme={theme} onTheme={setTheme}
            prefs={prefs} badges={badges} viewport={viewportWidth} onPrefs={setPrefs}
            onPrefsReset={() => setPrefs(parsePrefs({}))}
            onBadges={setBadges} onBadgesReset={() => setBadges(BADGE_DEFAULTS)}
            onClose={() => setSettingsOpen(false)} />
        </div>
      )}
      {settingsOpen && isMobile && (
        <div className={`fixed inset-0 ${LAYER_CLASS.drawer} bg-surface`}>
          <SettingsSurface section={settingsSection} onSection={setSettingsSection} selection={selectionPrefs} onSelection={setSelectionPrefsAndPersist}
            theme={theme} onTheme={setTheme}
            prefs={prefs} badges={badges} viewport={viewportWidth} onPrefs={setPrefs}
            onPrefsReset={() => setPrefs(parsePrefs({}))}
            onBadges={setBadges} onBadgesReset={() => setBadges(BADGE_DEFAULTS)}
            onClose={() => setSettingsOpen(false)} />
        </div>
      )}

      {/* 检视面板（Task 0010）：与文件面板并存不互斥（D10）；手机上走全屏表面（mobile 模型，D17a 本期不做手机——这段只在桌面渲染） */}
      {reviewOpen && !isMobile && box.review > 0 && (
        <>
          {/* 把手必须贴面板左缘且命中区在面板内：DragHandle 是 absolute，
              放在 aside 外面时包含块是主容器 → 把手跑到视口左缘外（x=-4，探针实测）。
              放进 aside（relative）内部 + !left-0 收进面板，aside 的 overflow-hidden 才不裁它。 */}
          <aside ref={reviewRef} style={{ width: box.review }} data-testid="review-aside" className="relative flex shrink-0 overflow-hidden">
            <DragHandle onStart={(event) => beginReviewDrag(event)} side="left" className="!left-0" />
            <ReviewPanel taskDir={reviewTask ?? ""} data={reviewData}
              loading={reviewLoading} failed={reviewFailed} onReload={() => { if (reviewTask !== undefined) void loadReview(reviewTask); }}
              onClose={closeReview}
              /* D31：换检视对象（候选由 App 拉，面板不认识 agentId/projectId） */
              onSwitchTask={(taskDir) => openReview(taskDir)}
              candidates={reviewCandidates}
              candidatesLoading={reviewCandidatesLoading}
              currentTaskId={reviewCandidates.find((item) => item.taskDir === reviewTask)?.taskId}
              /* A8/G3：把评论作为**结构化引用**挂到输入框（chip 可逐条移除）；发送时才合成文本，不自动发 */
              onAttachComments={(refs) => {
                const usable = refs.filter((ref) => attachableComment(ref));
                if (usable.length === 0) return;
                setCommentRefs((prev) => usable.reduce((list, ref) => addCommentRef(list, ref), prev));
                focusComposer();
              }} />
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
          <div className={`absolute inset-0 ${LAYER_CLASS.rail} ${SCRIM_CLASS}`} onClick={closeAllLeft} aria-hidden="true" />
          <div className={`absolute inset-y-0 left-11 right-0 ${LAYER_CLASS.drawer} flex overflow-x-auto`}
            style={surfaceStyle("popover")}>
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
import { emptyRunFacts, markViewed, applyRunEvent, applyRunningFacts, applySnapshotFacts, queueAdd, queueClear, rememberMeta, settleStopped, startedAtOf } from "./run-facts";
import { isStreamStale, routeEvent, type RouteAction, type RouteEvent, type RouteFocus } from "./event-router";
import { deriveStatus, projectKey, type StatusFacts } from "./status-map";
import { outcomeOfTurn, turnNoticeOf } from "./turn-notice";
import { busyBelongsTo, isStaleTerminal } from "./event-guards";
import { LAYER_CLASS, SCRIM_CLASS, surfaceStyle } from "./design/surface";
