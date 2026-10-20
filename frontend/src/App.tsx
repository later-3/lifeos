import { useEffect, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import {
  IconChevronLeft, IconFileText, IconFolder, IconFolderPlus, IconHistory, IconLayoutSidebarRight, IconMessageCircle,
  IconPencil, IconPlus, IconTrash, IconX,
} from "@tabler/icons-react";
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
import { MessageView, WorkingRow, type Block } from "./Message";
import { resendPlan } from "./resend";
import { applyStreamEvent, blocksOfStream, createStreamState, textOfBlocks, type Phase, type StreamEvent } from "./stream-blocks";
import { TurnInspector } from "./SessionHistory";
import { NavRail } from "./design/rail";
import { ConfirmDialog } from "./design/overlay";
import { Button, EmptyState, IconButton, Label, Row, Skeleton } from "./design/ui";

// 三级级联菜单：第1列 Agent → 第2列 其 Projects → 第3列 该项目的所有事情 → 主区聊天。
// 折叠态统一走 44px 单轨（design/rail.tsx），成本不随层数增长；宽度全部由 design/layout.ts 计算。
// 视觉：tokens（design/tokens.css）+ primitive（design/ui.tsx），页面层只组装。
type Agent = { id: string; name: string; description?: string; avatar?: AgentAvatarSpec };
type Project = { id: string; name: string; isDefault: boolean; path?: string };
type SessionItem = { sessionId: string; title: string; updatedAt: string; messages: number; isDefault?: boolean; running?: boolean };
type Message = { role: "user" | "assistant"; text: string; blocks: Block[]; streaming?: boolean; error?: string };
type Group = { project: Project; sessions: SessionItem[] };
// 流事件（思考/文本/工具）与运行边界（done/error）都在一条 SSE 上；事件名 = 事件类型。
type PaletteItem = { key: string; label: string; hint?: string; run: () => void };
type AgentEvent = { seq: number; sessionId?: string } & (StreamEvent | { type: "done" } | { type: "error"; message?: string } | { type: "agents_changed" });

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
function ColumnHeader({ label, hint, onHide }: { label: string; hint?: string; onHide: () => void }) {
  return (
    <div className="flex h-10 shrink-0 items-center gap-1.5 px-2 pl-3">
      <Label className="min-w-0 truncate">{label}</Label>
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

export default function App() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [agent, setAgent] = useState<Agent>();
  const [groups, setGroups] = useState<Group[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>();
  const [sessionId, setSessionId] = useState<string>();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInputState] = useState("");
  const [busy, setBusy] = useState(false);

  // 输入法组字：组字中/刚提交 100ms 内的 Enter 不发送（照 Pi Web ChatInput 的判定，见 reference-baseline）
  const composingRef = useRef(false);
  const lastCompositionEndRef = useRef(0);
  const busyRef = useRef(false);          // 供回调读的即时 busy（state 有渲染延迟）
  const submittingRef = useRef(false);    // 防快速连按 Enter 重复提交
  const lastEventAtRef = useRef(0);       // 心跳：最近一次流事件时间（判断"跑丢了"）
  const sentHistoryRef = useRef<string[]>([]);   // 输入历史（↑/↓ 浏览，本进程内）
  const historyIndexRef = useRef(-1);
  // 补发必须走 ref 里的最新 sendText：SSE 订阅只建一次（deps 不含 sessionId），
  // 直接调用闭包里的 sendText 会拿订阅那一帧的 sessionId（实测：内容被静默丢弃／发去旧会话）。
  const sendTextRef = useRef<(raw: string) => void>(() => {});
  const [streamSeq, setStreamSeq] = useState(0);
  const streamRef = useRef(createStreamState());   // 本轮块槽位（思考/文本/工具按 contentIndex 归并）
  const [phase, setPhase] = useState<Phase>("waiting");
  const [retry, setRetry] = useState<{ attempt: number; maxAttempts: number; delayMs: number; message: string } | undefined>();
  const [meta, setMeta] = useState<{ model: { provider: string; id: string } | null; thinkingLevel: string } | undefined>();
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
  const snapshotSeq = useRef(0);
  const streaming = useRef(false);
  const endRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLElement>(null);
  const followTail = useRef(true);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { current.current = sessionId; if (sessionId !== undefined && agent !== undefined) writeLast(lastSessionKey(agent.id), sessionId); }, [sessionId, agent?.id]);
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

  // 只在"贴底"时跟随，否则用户可以往上翻历史
  useEffect(() => {
    if (followTail.current) endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  useEffect(() => {
    // URL 三键反映当前状态：切到"没有会话的项目"也要更新（否则刷新会退回旧项目/旧会话）
    if (agent === undefined) return;
    const params = new URLSearchParams();
    params.set("agent", agent.id);
    if (selectedProjectId !== undefined) params.set("project", selectedProjectId);
    if (sessionId !== undefined) params.set("session", sessionId);
    window.history.replaceState(null, "", `?${params.toString()}`);
  }, [agent?.id, selectedProjectId, sessionId]);

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
    setHistory(undefined);
    const previous = restoreFolds.current;
    if (previous !== undefined) {
      restoreFolds.current = undefined;
      setShowNav(previous.nav); setShowProjects(previous.projects); setShowSessions(previous.sessions);
    }
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
  useEffect(() => { if (panelOpen && !box.panelFits) setPanelOpen(false); }, [panelOpen, box.panelFits, setPanelOpen]);

  // 输入框自适应高度（1–8 行）
  useEffect(() => {
    const node = inputRef.current;
    if (node === null) return;
    node.style.height = "auto";
    node.style.height = `${Math.min(node.scrollHeight, 176)}px`;
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
      messages: Message[]; meta?: { model: { provider: string; id: string } | null; thinkingLevel: string };
    };
    followTail.current = true;
    setMessages(data.messages ?? []);
    if (data.meta !== undefined) setMeta(data.meta);
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
    streamRef.current = createStreamState();
    setPhase("waiting");
    setRetry(undefined);
    setActiveTool(undefined);
    setSessionId(sid);
    streaming.current = false;
    setBusy(false);
    await loadMessages(a.id, sid);
  }

  async function selectAgent(a: Agent) {
    setAgent(a);
    ctx.current = { agentId: a.id };
    setStreamSeq(0);
    snapshotSeq.current = 0;
    streaming.current = false;
    setBusy(false);
    setSessionId(undefined);
    setMessages([]);
    setShowProjects(true);
    setShowSessions(true);
    const next = await fetchGroups(a.id);
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
    const group = groups.find((item) => item.project.id === project.id);
    const latest = pickLatest(group?.sessions ?? []);
    if (latest !== undefined) await openSession(agent, latest.sessionId);
  }

  async function reloadGroups() {
    const id = ctx.current.agentId;
    if (id === undefined) return undefined;
    const next = await fetchGroups(id);
    setGroups(next);
    return next;
  }

  useEffect(() => {
    const agentId = agent?.id;
    if (agentId === undefined) return;
    const stream = new EventSource(`/api/agents/${agentId}/events?since=${streamSeq}`);
    stream.addEventListener("snapshot", (event) => {
      const snapshot = JSON.parse((event as MessageEvent).data) as { seq: number; running: { sessionId: string }[] };
      snapshotSeq.current = snapshot.seq;
      setStreamSeq(snapshot.seq);
      lastEventAtRef.current = Date.now();
      const running = snapshot.running.some((run) => run.sessionId === current.current);
      // 断线重连时快照说"不在跑"但 UI 还在生成态 → 说明那一轮已丢（后端重启等）→ 收尾并重载
      if (!running && busyRef.current) recoverLostRun("运行已中断（连接恢复时该会话已不在运行）");
      busyRef.current = running;
      setBusy(running);
    });
    // 一条助手消息里的块是有序的（思考/文本/工具交替），全部交给 stream-blocks 的纯函数归并。
    const onStream = (event: Event) => {
      const payload = JSON.parse((event as MessageEvent).data) as AgentEvent;
      setStreamSeq(payload.seq);
      if (payload.seq <= snapshotSeq.current) return;
      if (payload.sessionId !== current.current) return;
      if (payload.type === "done" || payload.type === "error" || payload.type === "agents_changed") return;
      lastEventAtRef.current = Date.now();
      const tailIsStreaming = streaming.current;
      if (!tailIsStreaming) streamRef.current = createStreamState();   // 前一条不是本轮的占位消息 → 从空状态起
      const next = applyStreamEvent(streamRef.current, payload);
      streamRef.current = next;
      setPhase(next.phase);
      setActiveTool(next.activeTool);
      const blocks = blocksOfStream(next);
      const text = textOfBlocks(blocks);
      busyRef.current = true;
      setBusy(true);
      streaming.current = true;
      setMessages((list) => {
        const last = list[list.length - 1];
        if (!tailIsStreaming || last === undefined || last.role !== "assistant") {
          return [...list, { role: "assistant", text, blocks, streaming: true }];
        }
        return [...list.slice(0, -1), { ...last, text, blocks, streaming: true }];
      });
    };
    for (const name of ["delta", "thinking", "thinking_end", "tool_call", "tool_result"] as const) stream.addEventListener(name, onStream);
    // Pi 的自动重试：显示"失败原因 + 第几次/共几次"，结束后收起
    stream.addEventListener("retrying", (event) => {
      const payload = JSON.parse((event as MessageEvent).data) as { sessionId?: string; attempt: number; maxAttempts: number; delayMs: number; message: string };
      if (payload.sessionId !== undefined && payload.sessionId !== current.current) return;
      lastEventAtRef.current = Date.now();
      setRetry({ attempt: payload.attempt, maxAttempts: payload.maxAttempts, delayMs: payload.delayMs, message: payload.message });
      busyRef.current = true;
      setBusy(true);
    });
    stream.addEventListener("retry_end", (event) => {
      const payload = JSON.parse((event as MessageEvent).data) as { sessionId?: string };
      if (payload.sessionId !== undefined && payload.sessionId !== current.current) return;
      lastEventAtRef.current = Date.now();
      setRetry(undefined);
    });
    const finish = (event: MessageEvent) => {
      const payload = JSON.parse(event.data) as AgentEvent;
      setStreamSeq(payload.seq);
      void reloadGroups();                                  // 别的会话结束也要更新列表的"运行中"点
      if (payload.sessionId !== current.current) return;    // 不是当前会话 → 不动 busy（否则会提前结束生成态）
      streaming.current = false;
      busyRef.current = false;
      setBusy(false);
      setRetry(undefined);
      if (current.current !== undefined) void loadMessages(agentId, current.current);
    };
    stream.addEventListener("done", finish);
    stream.addEventListener("error", finish);
    // 助手列表变化（新建/归档，工具与 HTTP 都会广播）→ 自动重取，无需手动刷新
    stream.addEventListener("agents_changed", () => {
      void (async () => {
        const data = (await (await fetch("/api/agents")).json()) as { items: Agent[] };
        setAgents(data.items);
        if (agent !== undefined && !data.items.some((item) => item.id === agent.id) && data.items[0] !== undefined) {
          await selectAgent(data.items[0]);
        } else {
          await reloadGroups();   // 项目/会话也可能变了（lifeos_project_* 工具的写操作走这条），不刷新=没闭环
        }
      })();
    });
    return () => stream.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent?.id, streamSeq === 0]);

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
    const data = await response.json() as { project?: { id: string }; error?: { message: string } };
    if (!response.ok || data.project === undefined) return data.error?.message ?? "注册失败";
    const pid = data.project.id;
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
      else { setSelectedProjectId(undefined); setSessionId(undefined); setMessages([]); }
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
      else { setSessionId(undefined); setMessages([]); }
    }
  }

  /**
   * 发送（行业通行做法）：
   * - 生成中按 Enter **不丢内容** → 记入排队，本轮结束后自动发送（并显示“已排队”）；
   * - 发送失败（网络/4xx）→ **回填草稿**，不静默吃掉用户输入；
   * - `submittingRef` 防快速连按 Enter 重复提交。
   */
  async function sendText(raw: string) {
    const text = raw.trim();
    if (text === "" || agent === undefined) return;
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
      // 生成中投入输入 = Pi 原生 steer（插进当前思考）；失败再退回普通发送
      const response = await fetch(`/api/agents/${agent.id}/sessions/${sid}/messages`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text, behavior: "steer" }),
      }).catch(() => undefined);
      if (response?.ok === true) {
        setInput("");
        setMessages((list) => [...list, { role: "user", text, blocks: [{ type: "text", text }] }]);
        toast("已插话（steer，不影响当前轮继续）");
        return;
      }
    }
    if (submittingRef.current) return;
    submittingRef.current = true;
    setInput("");                       // 事务开始：清该会话草稿（失败会回填）
    streamRef.current = createStreamState();
    setPhase("waiting");
    setActiveTool(undefined);
    busyRef.current = true;
    setBusy(true);
    streaming.current = true;
    followTail.current = true;
    setMessages((list) => [...list, { role: "user", text, blocks: [{ type: "text", text }] }, { role: "assistant", text: "", blocks: [], streaming: true }]);
    const fail = (message: string) => {
      setMessages((list) => [...list.slice(0, -1), { role: "assistant", text: message, blocks: [{ type: "text", text: message }] }]);
      setInput(text);                   // 失败回填草稿
      busyRef.current = false;
      setBusy(false);
    };
    try {
      const response = await fetch(`/api/agents/${agent.id}/sessions/${sid}/messages`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text }),
      });
      if (!response.ok) {
        const error = await response.json() as { error?: { message?: string } };
        fail(`[出错] ${error.error?.message ?? "请求失败"}`);
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

  // 切换后必须重读会话：头部的"当前模型/思考级别"来自接口 meta，不刷新就会一直显示旧值
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
    if (agent === undefined || sessionId === undefined) return;
    const response = await fetch(`/api/agents/${agent.id}/sessions/${sessionId}/abort`, { method: "POST" }).catch(() => undefined);
    toast(response?.ok === true ? "已请求打断" : "打断失败", response?.ok === true ? "success" : "error");
  }

  /** 运行"跑丢了"（后端重启 / 断线）：清生成态、重载消息，尾部空回复处会给重试。 */
  function recoverLostRun(reason: string) {
    if (!busyRef.current) return;
    busyRef.current = false;
    streaming.current = false;
    setBusy(false);
    setRetry(undefined);
    toast(reason, "error");
    if (agent !== undefined && current.current !== undefined) void loadMessages(agent.id, current.current);
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
      if (!busyRef.current) return;
      const since = Date.now() - lastEventAtRef.current;
      if (lastEventAtRef.current > 0 && since > 60_000) recoverLostRun("运行已中断（超过 60 秒没有响应）");
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

  const leftColumns = (
    <>
      {!folded.nav && (
        <>
          <aside style={{ width: box.c1 }} className="flex shrink-0 flex-col bg-sunken">
            <ColumnHeader label="助手" onHide={() => setShowNav(false)} />
            <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-1.5 pb-2">
              {!loaded && <Skeleton rows={3} />}
              {agents.map((item) => (
                <Row key={item.id} selected={item.id === agent?.id} onClick={() => void selectAgent(item)}>
                  <button aria-label={`配置 ${item.name}`} title="配置助手"
                    onClick={(event) => { event.stopPropagation(); setConfigAgent(item); }}
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition-transform hover:scale-105">
                    <AgentAvatar id={item.id} name={item.name} avatar={item.avatar} size={22} />
                  </button>
                  <span className="min-w-0 flex-1 truncate">{item.name}</span>
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
            <ColumnHeader label="项目" onHide={() => setShowProjects(false)} />
            <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-1.5 pb-2">
              {!loaded && <Skeleton rows={2} />}
              {loaded && groups.length === 0 && <EmptyState title="还没有项目" hint="把外部目录注册为一个项目后，这里会出现。" />}
              {groups.map((group) => (
                <Row key={group.project.id} selected={group.project.id === selectedProjectId}
                  onClick={() => void selectProject(group.project)}>
                  {/* 行里只写名称：默认项目不标注（圆点会被误读成"运行中"，与状态点语义冲突） */}
                  <span className="min-w-0 flex-1 truncate">{group.project.name}</span>
                  {/* 固定槽位：计数常显，操作图标原地显隐 → hover 不位移 */}
                  <span className="relative flex w-11 shrink-0 items-center justify-end">
                    <span className="text-micro tabular-nums text-ink-500 transition-opacity group-hover:opacity-0 group-focus-within:opacity-0">{group.sessions.length}</span>
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
              onHide={() => setShowSessions(false)} />
            <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-2">
              {currentGroup === undefined && <EmptyState title="先选择项目" />}
              {currentGroup !== undefined && currentGroup.sessions.length === 0 && (
                <EmptyState title="该项目暂无会话" hint="直接在右下输入框发消息，会自动新建会话。" />
              )}
              {currentGroup?.sessions.map((item) => (
                <Row key={item.sessionId} selected={item.sessionId === sessionId}
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
                    {item.running
                      ? <span className="h-1.5 w-1.5 rounded-full bg-success" title="生成中" />
                      : <span className="text-micro text-ink-500 transition-opacity group-hover/session:opacity-0 group-focus-within/session:opacity-0">{timeAgo(item.updatedAt)}</span>}
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

  return (
    <div className="relative flex h-dvh bg-surface text-ink-900">
      <NavRail items={railItems} />

      {/* 左三列：宽窗口并列；窄窗口改浮层抽屉（聊天保底不被压破） */}
      {!box.overlayLeft && leftColumns}

      {/* 主区 · 聊天（历史作为右侧并列列，不覆盖） */}
      <div className="flex h-dvh min-w-0 flex-1 flex-col bg-surface">
        <header className="flex h-11 shrink-0 items-center gap-2 px-4">
          <div className="min-w-0">
            <h1 className="truncate text-body font-semibold text-ink-900">{sessionTitle !== "" ? sessionTitle : "Life OS"}</h1>
            <p className="truncate text-micro text-ink-500" data-testid="header-meta">
              {[agent?.name, currentGroup?.project.name].filter((part) => part !== undefined && part !== "").join(" · ") || "选择或新建一个会话"}
              {meta?.model != null && ` · ${meta.model.provider}/${meta.model.id}`}
            </p>
          </div>
          <span className="ml-auto" />
          <IconButton label="完整历史" size="lg" active={history !== undefined} disabled={sessionId === undefined}
            onClick={() => { if (sessionId !== undefined) { if (history !== undefined) closeHistory(); else openHistory(sessionId, sessionTitle); } }}>
            <IconHistory size={16} />
          </IconButton>
          <IconButton label={panelOpen ? "收起文件面板" : "展开文件面板"} size="lg" active={panelOpen}
            onClick={() => { if (!panelOpen && history !== undefined) closeHistory(); setPanelOpen(!panelOpen); }}>
            <IconLayoutSidebarRight size={16} />
          </IconButton>
        </header>

        <main ref={scrollRef}
          onScroll={(event) => {
            const node = event.currentTarget;
            followTail.current = node.scrollHeight - node.scrollTop - node.clientHeight < 60;
          }}
          className="min-h-0 w-full flex-1 overflow-y-auto px-6 py-5">
          <div className="mx-auto flex w-full max-w-reading flex-col gap-4" data-shot-mask="chat-body">
            {sessionId === undefined && (selectedProjectId === undefined
              ? <EmptyState icon={<IconMessageCircle size={22} />} title="先选择项目" hint="左侧第 2 列选一个项目。" />
              : <EmptyState icon={<IconMessageCircle size={22} />} title="发一条消息开始对话" hint="直接输入并发送，会自动为该项目新建会话。" />)}
            {sessionId !== undefined && messages.length === 0 && <EmptyState icon={<IconMessageCircle size={22} />} title="发一条消息开始对话" hint="输入并发送即可，第一条消息会写进这个会话。" />}
            {messages.map((message, index) => {
              // 失败属于那一轮：动作挂在最后那条消息的动作条里，不另起一行（否则位置随列表浮动、和消息脱开）
              const plan = index === messages.length - 1 ? resendPlan(messages, busy) : undefined;
              return (
                <MessageView key={index} role={message.role} blocks={message.blocks} busy={message.streaming === true}
                  {...(message.error !== undefined ? { error: message.error } : {})}
                  {...(plan !== undefined ? { onRetry: () => void sendText(plan.text) } : {})}
                  {...(plan?.note !== undefined ? { failureNote: plan.note } : {})} />
              );
            })}
            {busy && <WorkingRow phase={phase} {...(activeTool !== undefined ? { activeTool } : {})} {...(retry !== undefined ? { retry } : {})} />}
            <div ref={endRef} />
          </div>
        </main>

        <footer className="shrink-0 px-6 pb-4">
          <div className="mx-auto w-full max-w-reading">
            {palette !== undefined && (
              <div className="mb-1.5 max-h-56 overflow-y-auto overflow-hidden rounded-panel bg-surface p-1 shadow-sm ring-1 ring-line">
                {palette.items.map((item, index) => (
                  <button key={item.key} type="button"
                    onMouseEnter={() => setPalette({ ...palette, index })}
                    onClick={() => { setPalette(undefined); item.run(); }}
                    className={`flex w-full items-center gap-2 rounded-control px-2 py-1.5 text-left text-meta transition-colors ${index === palette.index ? "bg-hover text-ink-900" : "text-ink-700"}`}>
                    <span className="shrink-0 font-mono">{item.label}</span>
                    {item.hint !== undefined && <span className="ml-auto min-w-0 truncate text-micro text-ink-500">{item.hint}</span>}
                  </button>
                ))}
              </div>
            )}
            <div className="flex items-end gap-2 rounded-panel bg-surface p-1.5 ring-1 ring-line focus-within:ring-accent">
              <textarea ref={inputRef} value={input} rows={1}
                placeholder="输入消息 · Enter 发送 · 生成中 Enter 插话 · Esc 打断 · / 查看命令"
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
                    const delta = event.key === "ArrowUp" ? -1 : 1;
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
                className="max-h-44 flex-1 resize-none bg-transparent px-2.5 py-1.5 text-content leading-relaxed text-ink-900 placeholder:text-ink-500" />
              {busy ? (
                <IconButton label="停止（Esc）" size="lg" tone="solid" onClick={() => void stop()}>
                  <IconPlayerStopIcon />
                </IconButton>
              ) : (
                <IconButton label="发送" size="lg" tone="solid" disabled={input.trim() === "" || selectedProjectId === undefined}
                  onClick={() => void send()}>
                  <IconArrowUpIcon />
                </IconButton>
              )}
            </div>
          </div>
        </footer>
      </div>

      {/* 完整历史 · 右侧并列列 */}
      {history !== undefined && box.history > 0 && (
        <>
          <DragHandle onStart={(event) => beginDrag("c5", event)} />
          <aside style={{ width: box.history }} className="flex shrink-0 overflow-hidden">
            <TurnInspector agentId={agent?.id ?? ""} sessionId={history.sessionId} title={history.title}
              agentName={agent?.name ?? "助手"} avatar={agent?.avatar} onClose={closeHistory} />
          </aside>
        </>
      )}

      {/* 右侧文件面板 */}
      {panelOpen && box.panel > 0 && (
        <>
          <DragHandle onStart={(event) => beginDrag("c4", event)} />
          <aside style={{ width: box.panel }} className="flex shrink-0 overflow-hidden bg-surface">
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
                onSelectTab={setActiveFileTabId} onCloseTab={closeFileTab} onPrefsChange={updateTabPrefs} />
            </div>
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
      {box.overlayLeft && anyLeftOpen && (
        <>
          <div className="absolute inset-0 z-20 bg-ink-900/20" onClick={closeAllLeft} aria-hidden="true" />
          <div className="absolute inset-y-0 left-11 z-30 flex shadow-lg">
            {leftColumns}
          </div>
        </>
      )}
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
