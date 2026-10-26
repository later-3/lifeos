import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import {
  IconArrowDown, IconArrowLeft, IconChevronLeft, IconFileText, IconFolder, IconFolderPlus, IconHistory, IconLayoutSidebarRight, IconMessageCircle,
  IconMenu2, IconPencil, IconPhoto, IconPlus, IconTrash, IconX,
} from "@tabler/icons-react";
import {
  addImage, attachmentSummary, IMAGE_MIME_TYPES, removeImage, scaledSize, shouldCompressImage,
  CLIENT_JPEG_QUALITY, toRequestImages, type PendingImage,
} from "./attachments";
import { useFold } from "./design/fold";
import { useToast } from "./design/toast";
import { AgentConfigModal } from "./AgentConfig";
import { AgentAvatar, type AgentAvatarSpec } from "./agent-avatar";
import { DirectoryPicker } from "./DirectoryPicker";
import { FileTree } from "./FileTree";
import { FilePanel } from "./FilePanel";
import { useColumnWidth } from "./useColumnWidth";
import { layout } from "./design/layout";
import { useFilePanel } from "./useFilePanel";
import { MessageView, type Block } from "./Message";
import { TurnStatusBar } from "./turn-status";
import { MobileNav, type Level } from "./mobile-nav";
import { useAppHeight, useEdgeBack, useIsMobile } from "./use-mobile";
import { resendPlan } from "./resend";
import { failureLabel, type FailureKind } from "./failure-text";
import type { TurnStep } from "./working";
import { applyStreamEvent, blocksOfStream, createStreamState, finalTextOfStream, textOfBlocks, type Phase, type StreamEvent } from "./stream-blocks";
import { TurnInspector } from "./SessionHistory";
import { NavRail } from "./design/rail";
import { ConfirmDialog } from "./design/overlay";
import { Button, EmptyState, IconButton, Label, Row, Skeleton } from "./design/ui";
import { buildHeaderSegments, headerTaskOf, joinHeaderSegments, taskTitleKey } from "./header-strip";

// 三级级联菜单：第1列 Agent → 第2列 其 Projects → 第3列 该项目的所有事情 → 主区聊天。
// 折叠态统一走 44px 单轨（design/rail.tsx），成本不随层数增长；宽度全部由 design/layout.ts 计算。
// 视觉：tokens（design/tokens.css）+ primitive（design/ui.tsx），页面层只组装。
type Agent = { id: string; name: string; description?: string; avatar?: AgentAvatarSpec };
type Project = { id: string; name: string; isDefault: boolean; path?: string };
type UsageSummary = { input: number; output: number; cacheRead: number; cacheWrite: number; cost: number; totalTokens: number };
/**
 * 状态标记（任务 0008，项目行与 Agent 行共用）：运行中 = 绿色呼吸点；未读 = 数量徽标（个数，>0 才显示）。
 * 颜色与拍板语义一致：未读是绿色（不是蓝色——蓝色是交互态）。
 */
function StatusMarks({ status, unit }: { status: { running: boolean; unread: number } | undefined; unit: "会话" | "项目" }) {
  if (status === undefined) return null;
  return (
    // 状态徽标是动态数据（随用户正常使用变化）：截图基线遮掉，只比骨架（testing 2.9）
    <span className="flex shrink-0 items-center gap-1" data-shot-mask="status-marks">
      {status.running && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-success" title="生成中" />}
      {status.unread > 0 && (
        // 数字语义（任务 0009）：Project 层 = 待查看的会话个数；Agent 层 = 待查看的 Project 个数
        <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-success-soft px-1.5 text-micro font-medium tabular-nums text-success"
          aria-label={`${status.unread} 个${unit}待查看`} title={`${status.unread} 个${unit}待查看`}>
          {status.unread}
        </span>
      )}
    </span>
  );
}

/** 全局事件流上所有会走分流的事件名（与服务端 StreamEvent / 回合级事件一致）。 */
const STREAM_EVENT_NAMES = [
  "turn", "done", "error", "agents_changed",
  "message_start", "message_end", "delta", "thinking", "thinking_end",
  "tool_call", "tool_start", "tool_update", "tool_result", "retrying", "retry_end",
] as const;

/** 流陈旧阈值 = 服务端心跳间隔的 2.5 倍；看门狗检查间隔。 */
const STREAM_STALE_MS = 25_000;
const STREAM_WATCHDOG_MS = 5_000;

/** 全局快照（连接即发）：connectionId 用于焦点上报；seq 是事件基线；running/unread 是服务端真相。 */
type StreamSnapshot = {
  connectionId: string;
  seq: number;
  running: Array<{ agentId: string; sessionId: string; turnId?: string; startedAt: string }>;
  unread: Array<{ agentId: string; sessionId: string; completedAt: string }>;
};

type SessionMeta = { model: { provider: string; id: string } | null; thinkingLevel: string; running?: boolean; modelOverridden?: boolean; activeTaskId?: string | null; usage?: UsageSummary; context?: { percent: number | null; window: number } | null };
type SessionItem = { sessionId: string; title: string; updatedAt: string; messages: number; isDefault?: boolean; running?: boolean };
type TaskItem = { id: string; title: string; status: string; type: string; category: string; date?: string; isDefault?: boolean };
type Message = { role: "user" | "assistant"; text: string; blocks: Block[]; streaming?: boolean; at?: number; error?: string; failure?: FailureKind };
type Group = { project: Project; sessions: SessionItem[] };
// 流事件（思考/文本/工具）与运行边界（done/error）都在一条 SSE 上；事件名 = 事件类型。
type PaletteItem = { key: string; label: string; hint?: string; run: () => void };
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
  const [groups, setGroups] = useState<Group[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>();
  const [sessionId, setSessionId] = useState<string>();
  const [messages, setMessages] = useState<Message[]>([]);
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
  const runFactsRef = useRef(runFacts);
  runFactsRef.current = runFacts;

  const streamRef = useRef(createStreamState());   // 本轮块槽位（思考/文本/工具按 contentIndex 归并）
  const [phase, setPhase] = useState<Phase>("waiting");
  const [retry, setRetry] = useState<{ attempt: number; maxAttempts: number; delayMs: number; message: string; startedAt: number } | undefined>();
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
  // 头部状态条 task 段：activeTaskId → 任务标题（Task 0002）；缺失时按需拉一次清单（缺段只显示 ID）。
  const [taskTitles, setTaskTitles] = useState<Record<string, string>>({});
  /** 项目默认 Task 缓存（key = taskTitleKey(agent, project, "default")）：无会话时头部显示它 */
  const [projectDefaultTasks, setProjectDefaultTasks] = useState<Record<string, { id: string; title: string }>>({});
  const [activeTool, setActiveTool] = useState<string>();
  const toast = useToast();
  const [loaded, setLoaded] = useState(false);
  const [showNav, setShowNav] = useFold("agents");
  const [showProjects, setShowProjects] = useFold("projects");
  const [showSessions, setShowSessions] = useFold("sessions");
  const [showTree, setShowTree] = useFold("tree");
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
  const restoreFolds = useRef<{ nav: boolean; projects: boolean; sessions: boolean } | undefined>(undefined);
  const { panelOpen, setPanelOpen, fileTabs, activeFileTabId, setActiveFileTabId, openFile, closeFileTab, updateTabPrefs } = useFilePanel();
  const { box, beginDrag, viewport, widths } = useColumnWidth({
    folded: { nav: !showNav, projects: !showProjects, sessions: !showSessions },
    panelOpen,
    historyOpen: history !== undefined,
  });

  const current = useRef<string | undefined>(undefined);
  const ctx = useRef<{ agentId?: string }>({});
  const selectedProjectRef = useRef<string | undefined>(undefined);
  useEffect(() => { selectedProjectRef.current = selectedProjectId; }, [selectedProjectId]);
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
  useEffect(() => { if (sessionId !== undefined) setRunFacts((f) => markViewed(f, sessionId)); }, [sessionId]);   // 成为焦点即清未读（协议 P1·1.4）
  // 焦点上报（任务 0007）：切会话/切 Agent/页面可见性变化 → 服务端据此路由细节流，并在可见时记已读
  useEffect(() => { sendFocus(); }, [agent?.id, sessionId]);
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
  function setInput(text: string) {
    setInputState(text);
    if (draftKey === undefined) return;
    try {
      if (text === "") localStorage.removeItem(`${DRAFT_PREFIX}${draftKey}`);
      else localStorage.setItem(`${DRAFT_PREFIX}${draftKey}`, text);
    } catch { /* 忽略 */ }
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
    const trial = layout({ viewport, widths, requested: { nav: false, projects: false, sessions: false }, panelOpen: false, historyOpen: true });
    // 并排要"对话够宽"才有意义：对话挤到 560 以下就先把左三列收进导航轨（关闭时恢复）
    if (trial.history === 0 || trial.chat < 560) {
      restoreFolds.current = { nav: showNav, projects: showProjects, sessions: showSessions };
      setShowNav(false); setShowProjects(false); setShowSessions(false);
    }
    setHistory({ sessionId: sid, title: name });
  }
  function closeHistory() {
    dismissMobile(() => {
      setHistory(undefined);
      const previous = restoreFolds.current;
      if (previous !== undefined) {
        restoreFolds.current = undefined;
        setShowNav(previous.nav); setShowProjects(previous.projects); setShowSessions(previous.sessions);
      }
    });
  }

  // 窗口变窄导致历史列放不下：自动收左三列（保持并排），收起面板
  useEffect(() => {
    if (history === undefined) return;
    if (box.history === 0 && (showNav || showProjects || showSessions)) {
      restoreFolds.current ??= { nav: showNav, projects: showProjects, sessions: showSessions };
      setShowNav(false); setShowProjects(false); setShowSessions(false);
    }
  }, [history, box.history, showNav, showProjects, showSessions, setShowNav, setShowProjects, setShowSessions]);

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
  async function refreshAgentDefaultModel(id: string) {
    const response = await fetch(`/api/agents/${id}/config`).catch(() => undefined);
    const data = response?.ok === true
      ? await response.json().catch(() => ({})) as {
        config?: { defaultProvider?: string; defaultModel?: string } | null;
        effective?: { defaultProvider?: string; defaultModel?: string } | null;
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
  }

  function pickLatest(list: SessionItem[]): SessionItem | undefined {
    return [...list].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))[0];
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

  async function openSession(a: Agent, sid: string) {
    setHistory(undefined);
    setTurnMetrics(undefined);
    turnMetricsPendingRef.current = false;
    streamRef.current = createStreamState();
    setPhase("waiting");
    setRetry(undefined);
    setTurnStatus(undefined);
    setActiveTool(undefined);
    setSessionId(sid);
    current.current = sid;                 // 同步生效：下面的异步结果据此判断"是否已切走"（C120）
    activeTurnIdRef.current = null;
    busySessionRef.current = undefined;
    busyRef.current = false;
    streaming.current = false;
    setBusy(false);
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
      void fetch(`/api/agents/${a.id}/sessions/${sid}/turns/last`)
        .then((response) => (response.ok ? response.json() as Promise<{ turn?: { state: string } | null }> : undefined))
        .then((body) => {
          if (current.current !== sid) return;
          const notice = lostNoticeFor(body?.turn);
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
    setShowProjects(true);
    setShowSessions(true);
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
    setShowSessions(true);
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
          streamHandlers.current?.event(JSON.parse(data) as AgentEvent);
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
      body: JSON.stringify({ connectionId, agentId: focus.agentId, sessionId: focus.sessionId, visible: focus.visible }),
    }).catch(() => undefined);
  }

  /** 快照（连接即发，之后只推快照之后的事件）：运行与未读以服务端为准；当前会话在跑则补齐消息。 */
  function onStreamSnapshot(snapshot: StreamSnapshot): void {
    connectionRef.current = snapshot.connectionId;
    baselineRef.current = snapshot.seq;
    setRunFacts((f) => applySnapshotFacts(f, { running: snapshot.running, unread: snapshot.unread }, Date.now()));
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
        if (payload.type === "retry_end") { lastEventAtRef.current = Date.now(); setRetry(undefined); return; }
        applyStreamMessage(payload);
        return;
      case "refresh-groups":
        if (action.agentId === ctx.current.agentId) void reloadGroups();   // 列表的运行点/未读点随之刷新
        return;
      case "completion": {
        const sid = action.sessionId;
        const agentName = agents.find((item) => item.id === action.agentId)?.name ?? "助手";
        const known = groups.flatMap((group) => group.sessions).find((item) => item.sessionId === sid)?.title;
        const announce = (label: string) => toast(`${agentName} · ${label} ${action.outcome === "done" ? "已完成" : "失败"}`, action.outcome === "done" ? "success" : "error", {
          label: "查看",
          run: () => void openFromNotice(action.agentId, sid),
        });
        if (known !== undefined && known !== "") { announce(known.slice(0, 24)); return; }
        // 后台 Agent 的列表没有加载：按需取该 Agent 的会话标题（取不到就用短 id，提示照常出现）
        void fetch(`/api/agents/${action.agentId}/sessions`)
          .then((response) => (response.ok ? response.json() as Promise<{ items: Array<{ sessionId: string; title?: string }> }> : undefined))
          .then((body) => {
            const title = body?.items.find((item) => item.sessionId === sid)?.title;
            announce(title !== undefined && title !== "" ? title.slice(0, 24) : `会话 ${sid.slice(-6)}`);
          })
          .catch(() => announce(`会话 ${sid.slice(-6)}`));
        return;
      }
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
      const target = candidates.find((sid) => group?.sessions.some((session) => session.sessionId === sid)) ?? pickLatest(group?.sessions ?? [])?.sessionId;
      if (target !== undefined) await openSession(found, target);
      setLoaded(true);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function newSession() {
    if (agent === undefined) return;
    const created = await (await fetch(`/api/agents/${agent.id}/projects/${selectedProjectId ?? "workspace"}/sessions`, { method: "POST" })).json() as { sessionId: string };
    await reloadGroups();
    setShowSessions(true);
    await openSession(agent, created.sessionId);
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
    if (agent === undefined || trimmed === "" || trimmed === session.title) return;
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
      if (pending.length > 0) { setAttachments([...pending]); attachmentsRef.current = [...pending]; }
      busyRef.current = false;
      busySessionRef.current = undefined;
      setBusy(false);
      setTurnStep(4);
      turnMetricsPendingRef.current = false;
    };
    try {
      const response = await fetch(`/api/agents/${agent.id}/sessions/${sid}/messages`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify(pending.length > 0 ? { text, images: toRequestImages(pending) } : { text }),
      });
      if (!response.ok) {
        const error = await response.json() as { error?: { message?: string } };
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

  const COMMANDS: PaletteItem[] = [
    { key: "/compact", label: "/compact", hint: "压缩上下文（Pi 原生 compact）", run: () => void compactNow() },
    { key: "/model", label: "/model", hint: "切换本会话模型", run: () => void openModelPalette() },
    { key: "/thinking", label: "/thinking", hint: "切换思考级别", run: () => setPalette({ items: ["off", "minimal", "low", "medium", "high", "xhigh", "max"].map((level) => ({ key: level, label: level, hint: meta?.thinkingLevel === level ? "当前" : "思考级别", run: () => { void applyThinking(level); } })), index: 0 }) },
    { key: "/name", label: "/name <名称>", hint: "重命名会话", run: () => setInput("/name ") },
    { key: "/new", label: "/new", hint: "新建会话", run: () => void newSession() },
    { key: "/copy", label: "/copy", hint: "复制最后一条回复", run: copyLastAssistant },
    { key: "/export", label: "/export", hint: "导出为 Markdown", run: exportMarkdown },
    { key: "/abort", label: "/abort", hint: "打断当前回复（Esc）", run: () => void stop() },
  ];

  async function runSlash(command: string) {
    const [name, ...rest] = command.trim().split(/\s+/);
    const arg = rest.join(" ").trim();
    if (name === "/name" && arg !== "") {
      if (agent === undefined || sessionId === undefined) return;
      const response = await fetch(`/api/agents/${agent.id}/sessions/${sessionId}`, {
        method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: arg }),
      }).catch(() => undefined);
      toast(response?.ok === true ? "已重命名会话" : "重命名失败", response?.ok === true ? "success" : "error");
      if (response?.ok === true) { setInput(""); void reloadGroups(); }
      return;
    }
    const hit = COMMANDS.find((item) => item.key === name);
    if (hit !== undefined) { setInput(""); hit.run(); return; }
    toast(`未知命令 ${name}（按 / 看列表）`, "error");
  }

  /** 打断：Pi 原生 abort()；run 的 finally 会发 done，前端据此收尾。 */
  async function stop() {
    if (sessionId !== undefined) setRunFacts((f) => queueClear(f, sessionId));

    if (agent === undefined || sessionId === undefined) return;
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
    if (raw.startsWith("/")) { void runSlash(raw); return; }
    if (raw !== "") { sentHistoryRef.current = [...sentHistoryRef.current.slice(-49), raw]; historyIndexRef.current = -1; }
    void sendText(raw);
  }

  const currentGroup = groups.find((group) => group.project.id === selectedProjectId);
  const sessionTitle = currentGroup?.sessions.find((item) => item.sessionId === sessionId)?.title ?? "";

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

  const titleOf = (item?: SessionItem) => (item?.title ?? "").slice(0, 50);

  const folded = box.folded;
  // 图标轨常驻（VS Code Activity Bar 范式）：高亮 = 该列展开；点当前图标 = 收起；点未展开的 = 展开。
  // 展开前若右侧（完整历史/文件面板）开着，先关掉它——宽度预算同一套，避免挤爆聊天区。
  function toggleRail(key: "nav" | "projects" | "sessions") {
    const open = key === "nav" ? showNav : key === "projects" ? showProjects : showSessions;
    const set = key === "nav" ? setShowNav : key === "projects" ? setShowProjects : setShowSessions;
    if (open) { set(false); return; }
    if (history !== undefined) closeHistory();
    else if (panelOpen) setPanelOpen(false);
    set(true);
  }
  const railItems = [
    { key: "nav", label: "助手", active: showNav, icon: <AgentAvatar id={agent?.id ?? "?"} name={agent?.name ?? "?"} avatar={agent?.avatar} size={20} />, onToggle: () => toggleRail("nav") },
    { key: "projects", label: "项目", active: showProjects, icon: <IconFolder size={18} />, onToggle: () => toggleRail("projects") },
    { key: "sessions", label: "会话", active: showSessions, icon: <IconMessageCircle size={18} />, onToggle: () => toggleRail("sessions") },
  ];

  /** Agent 级注意点（任务 0007）：该 Agent 下有会话在跑 → 运行点；有完成未读 → 未读点。 */
  // 状态映射（任务 0008）：会话 → 项目 → Agent 的运行与未读全部由同一份会话事实派生
  const statusFacts: StatusFacts = {
    sessions: runFacts.meta,
    running: [...new Set([...runFacts.snapRunning, ...Object.keys(runFacts.lastTurn).filter((sid) => runFacts.lastTurn[sid]?.state === "running")])],
    unread: Object.keys(runFacts.unread).filter((sid) => runFacts.unread[sid] === true),
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
                  <StatusMarks status={derived.agents[item.id]} unit="项目" />
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

      {/* 第2列 · 项目 */}
      {!folded.projects && (
        <>
          <aside style={{ width: box.c2 }} className="flex shrink-0 flex-col bg-sunken">
            <ColumnHeader label="项目" count={groups.length} onHide={() => setShowProjects(false)} />
            {/* 行内容=用户数据（名称/计数会变）：截图基线只比骨架，不把数据纳入契约 */}
            <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-1.5 pb-2" data-shot-mask="project-rows">
              {!loaded && <Skeleton rows={2} />}
              {loaded && groups.length === 0 && <EmptyState title="还没有项目" hint="把外部目录注册为一个项目后，这里会出现。" />}
              {groups.map((group) => (
                <Row key={group.project.id} selected={group.project.id === selectedProjectId}
                  onClick={() => void selectProject(group.project)}>
                  {/* 行里只写名称：默认项目不标注（圆点会被误读成"运行中"，与状态点语义冲突） */}
                  <span className="min-w-0 flex-1 truncate">{group.project.name}</span>
                  <StatusMarks status={derived.projects[projectKey(agent?.id ?? "", group.project.id)]} unit="会话" />
                  {/* 行右侧只表达"待查看"（绿点 / 数字）：会话总数在列头统计里，不在这里重复（同一位置两种含义会混淆）。操作图标原地显隐 → hover 不位移 */}
                  <span className="relative flex w-11 shrink-0 items-center justify-end">
                    {group.project.path !== undefined && (
                      <span className="absolute right-0 flex items-center opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                        <IconButton label="从该助手移除项目" size="sm"
                          onClick={(event) => {
                            event.stopPropagation();
                            setConfirm({
                              title: `移除「${group.project.name}」`,
                              message: "只从该助手移除；项目注册、该项目下的会话与记录都会保留。",
                              confirmLabel: "移除",
                              run: () => void unbindProject(group.project),
                            });
                          }}>
                          <IconX size={14} />
                        </IconButton>
                      </span>
                    )}
                  </span>
                </Row>
              ))}
            </div>
            <div className="px-1.5 py-2">
              <Button size="sm" className="w-full" onClick={() => setAddingProject(true)}>
                <IconFolderPlus size={14} /> 添加项目
              </Button>
            </div>
          </aside>
          <DragHandle onStart={(event) => beginDrag("c2", event)} />
        </>
      )}

      {/* 第3列 · 会话 */}
      {!folded.sessions && (
        <>
          <aside style={{ width: box.c3 }} className="flex shrink-0 flex-col bg-sunken">
            {/* 第3列列头：项目列可见时写"会话"（避免与相邻行重复）；项目列收起时才写项目名（补回上下文） */}
            <ColumnHeader label={folded.projects ? currentGroup?.project.name ?? "会话" : "会话"}
              hint={folded.projects ? "会话" : undefined}
              count={currentGroup?.sessions.length}
              onHide={() => setShowSessions(false)} />
            <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-2" data-shot-mask="session-rows">
              {currentGroup === undefined && <EmptyState title="先选择项目" />}
              {currentGroup !== undefined && currentGroup.sessions.length === 0 && (
                <EmptyState title="该项目暂无会话" hint="直接在右下输入框发消息，会自动新建会话。" />
              )}
              {currentGroup?.sessions.map((item) => (
                <Row key={item.sessionId} testId={item.sessionId} selected={item.sessionId === sessionId}
                  onClick={() => agent !== undefined && void openSession(agent, item.sessionId)}
                  className="group/session">
                  {renaming?.sid === item.sessionId ? (
                    <input autoFocus value={renaming.value}
                      onFocus={(event) => event.currentTarget.select()}
                      onChange={(event) => setRenaming({ sid: item.sessionId, value: event.target.value })}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") { event.preventDefault(); void commitRename(item, event.currentTarget.value); }
                        if (event.key === "Escape") { event.preventDefault(); setRenaming(undefined); }
                      }}
                      onBlur={() => setRenaming(undefined)}
                      onClick={(event) => event.stopPropagation()}
                      className="min-w-0 flex-1 rounded bg-surface px-1 text-body text-ink-900 ring-1 ring-accent" />
                  ) : (
                    <span className="min-w-0 flex-1 truncate">{titleOf(item)}</span>
                  )}
                  <span className="relative flex w-24 shrink-0 items-center justify-end">
                    {(() => { const own = derived.sessions[item.sessionId]; const runNow = item.running || own?.running === true || isRunning(runFacts, item.sessionId); const unread = own !== undefined ? own.unread : hasUnread(runFacts, item.sessionId);
                      if (runNow) return <span className={`h-1.5 w-1.5 rounded-full bg-success animate-pulse`} title="生成中" />;
                      if (unread) return <span className="h-1.5 w-1.5 rounded-full bg-success" title="完成未读（查看后消失）" />;
                      return <span className="text-micro text-ink-500 transition-opacity group-hover/session:opacity-0 group-focus-within/session:opacity-0">{timeAgo(item.updatedAt)}</span>;
                    })()}
                    <span className="absolute right-0 flex items-center opacity-0 transition-opacity group-hover/session:opacity-100 group-focus-within/session:opacity-100">
                      <IconButton label="会话历史" size="sm"
                        onClick={(event) => {
                          event.stopPropagation();
                          openHistory(item.sessionId, titleOf(item));
                        }}>
                        <IconHistory size={14} />
                      </IconButton>
                      <IconButton label="重命名会话" size="sm"
                        onClick={(event) => {
                          event.stopPropagation();
                          setRenaming({ sid: item.sessionId, value: item.title });
                        }}>
                        <IconPencil size={14} />
                      </IconButton>
                      <IconButton label="删除会话" size="sm"
                        onClick={(event) => {
                          event.stopPropagation();
                          setConfirm({
                            title: "删除会话",
                            message: `删除「${item.title || "未命名"}」？此操作不可恢复。`,
                            confirmLabel: "删除",
                            run: () => void removeSession(item),
                          });
                        }}>
                        <IconTrash size={14} />
                      </IconButton>
                    </span>
                  </span>
                </Row>
              ))}
            </div>
            <div className="px-1.5 py-2">
              <Button size="sm" className="w-full" onClick={() => void newSession()}>
                <IconPlus size={14} /> 新建会话
              </Button>
            </div>
          </aside>
          <DragHandle onStart={(event) => beginDrag("c3", event)} />
        </>
      )}
    </>
  );
  const anyLeftOpen = showNav || showProjects || showSessions;
  const closeAllLeft = () => { setShowNav(false); setShowProjects(false); setShowSessions(false); };
  // 重发计划：指向"最后一条用户消息"（失败属于那一轮；动作挂在被重发的那条消息上）
  const resend = resendPlan(messages, busy);
  // 显示规则（用户 2026-10-22）：用过 /model → 显示会话覆盖模型；
  // 没用过 → 显示 Agent 的**有效默认**（配置 → 系统 → 清单第一项），不是拿会话值反猜。
  // 没有有效默认时才退回 meta.model（例如后端模型清单为空）。
  const headerModel = sessionId !== undefined
    ? (meta?.modelOverridden === true ? meta?.model : (agentDefaultModel ?? meta?.model))
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
            <h1 className="truncate text-body font-semibold text-ink-900">{sessionTitle !== "" ? sessionTitle : "Life OS"}</h1>
            <p className="truncate text-micro text-ink-500" data-testid="header-meta">
              {joinHeaderSegments(buildHeaderSegments({
                agentName: agent?.name ?? "",
                projectName: currentGroup?.project.name ?? "",
                sessionTitle,
                headerModel: headerModel ?? null,
                thinkingLevel: sessionId !== undefined ? meta?.thinkingLevel : undefined,
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
              {messages.map((message, index) => {
                // 动作挂在"被重发的那条用户消息"上（不是助手的错误提示）；不另起一行
                const plan = resend?.index === index ? resend : undefined;
                return (
                  <MessageView key={index} role={message.role} blocks={message.blocks} busy={message.streaming === true}
                    {...(message.at !== undefined ? { at: message.at } : {})}
                    {...(message.error !== undefined ? { error: message.error } : {})}
                    {...(message.failure !== undefined ? { failure: message.failure } : {})}
                    {...(message.failure !== undefined && index !== messages.length - 1 ? { historical: true } : {})}
                    {...(plan !== undefined ? { onRetry: () => void sendText(plan.text) } : {})} />
                );
              })}
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
              className={`${!(isMobile && !busy && turnStatus === undefined && turnMetrics === undefined && (meta?.usage === undefined || meta.usage.totalTokens === 0)) ? "" : "hidden"} flex min-h-7 items-center gap-3 px-1 pb-1`}>
              <div className="min-w-0 flex-1" data-testid="turn-status-bar">
                <TurnStatusBar busy={busy} step={turnStep} phase={phase}
                  {...(runFacts.lastTurn[sessionId ?? ""] !== undefined ? { turnId: runFacts.lastTurn[sessionId ?? ""]!.turnId } : {})}
                  {...(activeTool !== undefined ? { activeTool } : {})}
                  {...(retry !== undefined ? { retry } : {})}
                  {...(turnStatus !== undefined ? { status: turnStatus } : {})}
                  {...(turnMetrics !== undefined ? { metrics: turnMetrics } : {})}
                  {...(meta?.usage !== undefined ? { usage: meta.usage } : {})}
                  {...(meta?.context !== undefined ? { context: meta.context } : {})} />
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
              className="rounded-panel bg-surface ring-1 ring-line focus-within:ring-accent">
              {palette !== undefined && (
                <div aria-label="斜杠命令" className="max-h-56 overflow-y-auto overflow-hidden border-b border-line bg-sunken p-1">
                  {palette.items.map((item, index) => (
                    <button key={item.key} type="button"
                      onMouseEnter={() => setPalette({ ...palette, index })}
                      onClick={() => { setPalette(undefined); item.run(); }}
                      className={`flex w-full items-center gap-2 rounded-control px-2 py-1.5 text-left text-meta transition-colors max-sm:min-h-11 ${index === palette.index ? "bg-hover text-ink-900" : "text-ink-700"}`}>
                      <span className="shrink-0 font-mono">{item.label}</span>
                      {item.hint !== undefined && <span className="ml-auto min-w-0 truncate text-micro text-ink-500">{item.hint}</span>}
                    </button>
                  ))}
                </div>
              )}
              {/* 附件托盘：只有有图时出现，所以无图的基线不变 */}
              {attachments.length > 0 && (
                <div data-testid="composer-attachments" className="flex flex-wrap items-end gap-2 border-b border-line px-3 py-2">
                  {attachments.map((image) => (
                    <div key={image.id} className="relative">
                      <img src={`data:${image.mimeType};base64,${image.data}`} alt="" data-shot-mask="attachment-thumb"
                        className="h-14 w-14 rounded object-cover ring-1 ring-line" />
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
                      setPalette({ ...palette, index: (palette.index + delta + palette.items.length) % palette.items.length });
                      return;
                    }
                    if (event.key === "Enter") {
                      event.preventDefault();
                      const item = palette.items[palette.index];
                      setPalette(undefined);
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
                className="composer-autogrow w-full min-w-0 resize-none bg-transparent px-4 pt-2 pb-2 text-content leading-relaxed text-ink-900 placeholder:text-ink-500" />
              {/* 底部工具行：次要工具居左、hint、主操作（发送/停止）居右；同属 composer 容器（chat.md §3.5） */}
              <div className="flex items-center gap-2 px-2 pb-2">
                {isMobile && (
                  <IconButton label="添加图片" onClick={() => fileInputRef.current?.click()}
                    data-testid="attach-image" className="shrink-0">
                    <IconPhoto size={16} />
                  </IconButton>
                )}
                {busy ? (
                  <IconButton label="停止（Esc）" size="xl" tone="solid" onClick={() => void stop()}
                    className="ml-auto rounded-full">
                    <IconPlayerStopIcon />
                  </IconButton>
                ) : (
                  <IconButton label="发送" size="xl" tone="solid" disabled={input.trim() === "" || selectedProjectId === undefined}
                    onClick={() => void send()}
                    className="ml-auto rounded-full">
                    <IconArrowUpIcon />
                  </IconButton>
                )}
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

      {/* 右侧文件面板 */}
      {panelOpen && (isMobile || box.panel > 0) && (
        <>
          {!isMobile && <DragHandle onStart={(event) => beginDrag("c4", event)} />}
          <aside style={{ width: isMobile ? "100%" : box.panel }}
            className={`flex shrink-0 overflow-hidden bg-surface ${isMobile ? "fixed inset-0 z-40" : ""}`}>
            {isMobile ? (
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
                {showTree ? (
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
        agents={agents} groups={groups} {...(agent !== undefined ? { agent } : {})}
        {...(selectedProjectId !== undefined ? { projectId: selectedProjectId } : {})}
        {...(sessionId !== undefined ? { sessionId } : {})}
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
import { emptyRunFacts, markViewed, applyRunEvent, applySnapshotFacts, isRunning, hasUnread, queueAdd, queueClear, rememberMeta, settleStopped } from "./run-facts";
import { isStreamStale, routeEvent, type RouteAction, type RouteEvent, type RouteFocus } from "./event-router";
import { deriveStatus, projectKey, type StatusFacts } from "./status-map";
import { lostNoticeFor } from "./turn-notice";
import { busyBelongsTo, isStaleTerminal } from "./event-guards";
