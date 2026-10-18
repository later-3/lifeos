import { useEffect, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import {
  IconChevronLeft, IconFileText, IconFolder, IconFolderPlus, IconLayoutSidebarRight, IconMessageCircle,
  IconPencil, IconPlus, IconTrash, IconX,
} from "@tabler/icons-react";
import { useFold } from "./design/fold";
import { AgentConfigModal } from "./AgentConfig";
import { AgentAvatar, type AgentAvatarSpec } from "./agent-avatar";
import { DirectoryPicker } from "./DirectoryPicker";
import { FileTree } from "./FileTree";
import { FilePanel } from "./FilePanel";
import { useColumnWidth } from "./useColumnWidth";
import { useFilePanel } from "./useFilePanel";
import { MessageView, type Block } from "./Message";
import { NavRail } from "./design/rail";
import { ConfirmDialog } from "./design/overlay";
import { Button, EmptyState, IconButton, Label, Row, Skeleton } from "./design/ui";

// 三级级联菜单：第1列 Agent → 第2列 其 Projects → 第3列 该项目的所有事情 → 主区聊天。
// 折叠态统一走 44px 单轨（design/rail.tsx），成本不随层数增长；宽度全部由 design/layout.ts 计算。
// 视觉：tokens（design/tokens.css）+ primitive（design/ui.tsx），页面层只组装。
type Agent = { id: string; name: string; description?: string; avatar?: AgentAvatarSpec };
type Project = { id: string; name: string; isDefault: boolean; path?: string };
type SessionItem = { sessionId: string; title: string; updatedAt: string; messages: number; isDefault?: boolean; running?: boolean };
type Message = { role: "user" | "assistant"; text: string; blocks: Block[] };
type Group = { project: Project; sessions: SessionItem[] };
type AgentEvent = { seq: number; sessionId: string; type: "delta" | "done" | "error"; text?: string; message?: string };

const LAST_AGENT = "lifeos.lastAgent";
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
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [streamSeq, setStreamSeq] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [showNav, setShowNav] = useFold("agents");
  const [showProjects, setShowProjects] = useFold("projects");
  const [showSessions, setShowSessions] = useFold("sessions");
  const [showTree, setShowTree] = useFold("tree");
  const [renaming, setRenaming] = useState<{ sid: string; value: string } | undefined>();
  const [addingProject, setAddingProject] = useState(false);
  const [configAgent, setConfigAgent] = useState<Agent>();
  const [confirm, setConfirm] = useState<{ title: string; message: string; confirmLabel: string; run: () => void }>();
  const { panelOpen, setPanelOpen, fileTabs, activeFileTabId, setActiveFileTabId, openFile, closeFileTab, updateTabPrefs } = useFilePanel();
  const { box, beginDrag } = useColumnWidth({
    folded: { nav: !showNav, projects: !showProjects, sessions: !showSessions },
    panelOpen,
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

  // 只在"贴底"时跟随，否则用户可以往上翻历史
  useEffect(() => {
    if (followTail.current) endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  useEffect(() => {
    if (agent === undefined || sessionId === undefined) return;
    const params = new URLSearchParams();
    params.set("agent", agent.id);
    if (selectedProjectId !== undefined) params.set("project", selectedProjectId);
    params.set("session", sessionId);
    window.history.replaceState(null, "", `?${params.toString()}`);
  }, [agent?.id, selectedProjectId, sessionId]);

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
    const data = await (await fetch(`/api/agents/${id}/sessions/${sid}`)).json() as { messages: Message[] };
    followTail.current = true;
    setMessages(data.messages ?? []);
  }

  function pickLatest(list: SessionItem[]): SessionItem | undefined {
    return [...list].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))[0];
  }

  async function openSession(a: Agent, sid: string) {
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
      setBusy(snapshot.running.some((run) => run.sessionId === current.current));
    });
    stream.addEventListener("delta", (event) => {
      const payload = JSON.parse((event as MessageEvent).data) as AgentEvent;
      setStreamSeq(payload.seq);
      if (payload.seq <= snapshotSeq.current) return;
      if (payload.sessionId !== current.current) return;
      const delta = payload.text ?? "";
      setBusy(true);
      setMessages((list) => {
        const last = list[list.length - 1];
        if (!streaming.current || last === undefined || last.role !== "assistant") {
          streaming.current = true;
          return [...list, { role: "assistant", text: delta, blocks: [{ type: "text", text: delta }] }];
        }
        const blocks = [...last.blocks];
        const tail = blocks[blocks.length - 1];
        if (tail?.type === "text") blocks[blocks.length - 1] = { type: "text", text: tail.text + delta };
        else blocks.push({ type: "text", text: delta });
        return [...list.slice(0, -1), { ...last, text: last.text + delta, blocks }];
      });
    });
    const finish = (event: MessageEvent) => {
      setStreamSeq((JSON.parse(event.data) as AgentEvent).seq);
      streaming.current = false;
      setBusy(false);
      if (current.current !== undefined) {
        void loadMessages(agentId, current.current);
        void reloadGroups();
      }
    };
    stream.addEventListener("done", finish);
    stream.addEventListener("error", finish);
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
      const remembered = readLast(lastSessionKey(found.id));
      const candidates = [wantSession, remembered].filter((value): value is string => value !== null && value !== undefined);
      const owner = candidates.length === 0 ? undefined : groups.find((g) => g.sessions.some((s) => candidates.includes(s.sessionId)));
      const group = owner ?? groups.find((g) => g.project.id === wantProject) ?? groups.find((g) => g.project.isDefault) ?? groups[0];
      setSelectedProjectId(group?.project.id);
      const target = candidates.find((sid) => group?.sessions.some((s) => s.sessionId === sid)) ?? pickLatest(group?.sessions ?? [])?.sessionId;
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

  async function send() {
    const text = input.trim();
    if (text === "" || agent === undefined || sessionId === undefined || busy) return;
    setInput("");
    setBusy(true);
    streaming.current = true;
    followTail.current = true;
    setMessages((list) => [...list, { role: "user", text, blocks: [{ type: "text", text }] }, { role: "assistant", text: "", blocks: [] }]);
    const response = await fetch(`/api/agents/${agent.id}/sessions/${sessionId}/messages`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text }),
    });
    if (!response.ok) {
      const error = await response.json() as { error?: { message: string } };
      const failure = `[出错] ${error.error?.message ?? "请求失败"}`;
      setMessages((list) => [...list.slice(0, -1), { role: "assistant", text: failure, blocks: [{ type: "text", text: failure }] }]);
      setBusy(false);
    }
  }

  const currentGroup = groups.find((group) => group.project.id === selectedProjectId);
  const sessionTitle = currentGroup?.sessions.find((item) => item.sessionId === sessionId)?.title ?? "";
  const titleOf = (item?: SessionItem) => (item?.title ?? "").slice(0, 50);

  // 收起态的列 → 单轨条目（成本常数 44px）
  // disabled = 用户本来要打开、但窗口太窄被自动收起（点了也没用，给出准确提示）
  const folded = box.folded;
  const railItems = [
    ...(!folded.nav ? [] : [{ key: "nav", label: "助手", disabled: showNav === true, icon: <AgentAvatar id={agent?.id ?? "?"} name={agent?.name ?? "?"} avatar={agent?.avatar} size={20} />, onOpen: () => setShowNav(true) }]),
    ...(!folded.projects ? [] : [{ key: "projects", label: "项目", disabled: showProjects === true, icon: <IconFolder size={18} />, onOpen: () => setShowProjects(true) }]),
    ...(!folded.sessions ? [] : [{ key: "sessions", label: "会话", disabled: showSessions === true, icon: <IconMessageCircle size={18} />, onOpen: () => setShowSessions(true) }]),
  ];

  return (
    <div className="flex h-dvh bg-surface text-ink-900">
      {box.rail > 0 && <NavRail items={railItems} />}

      {/* 第1列 · 助手 */}
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
                <EmptyState title="该项目暂无会话" hint="新建一个会话开始对话。" />
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
                  <span className="relative flex w-14 shrink-0 items-center justify-end">
                    {item.running
                      ? <span className="h-1.5 w-1.5 rounded-full bg-success" title="生成中" />
                      : <span className="text-micro text-ink-500 transition-opacity group-hover/session:opacity-0 group-focus-within/session:opacity-0">{timeAgo(item.updatedAt)}</span>}
                    <span className="absolute right-0 flex items-center opacity-0 transition-opacity group-hover/session:opacity-100 group-focus-within/session:opacity-100">
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

      {/* 主区 · 聊天 */}
      <div className="flex h-dvh min-w-0 flex-1 flex-col bg-surface">
        <header className="flex h-11 shrink-0 items-center gap-2 px-4">
          <div className="min-w-0">
            <h1 className="truncate text-body font-semibold text-ink-900">{sessionTitle !== "" ? sessionTitle : "Life OS"}</h1>
            <p className="truncate text-micro text-ink-500">
              {[agent?.name, currentGroup?.project.name].filter((part) => part !== undefined && part !== "").join(" · ") || "选择或新建一个会话"}
            </p>
          </div>
          <span className="ml-auto" />
          <IconButton label={panelOpen ? "收起文件面板" : "展开文件面板"} size="lg" active={panelOpen} onClick={() => setPanelOpen(!panelOpen)}>
            <IconLayoutSidebarRight size={16} />
          </IconButton>
        </header>

        <main ref={scrollRef}
          onScroll={(event) => {
            const node = event.currentTarget;
            followTail.current = node.scrollHeight - node.scrollTop - node.clientHeight < 60;
          }}
          className="min-h-0 w-full flex-1 overflow-y-auto px-6 py-5">
          <div className="mx-auto flex w-full max-w-reading flex-col gap-4">
            {sessionId === undefined && <EmptyState icon={<IconMessageCircle size={22} />} title="选择或新建一个会话" hint="左侧第 3 列是该项目下的所有对话。" />}
            {sessionId !== undefined && messages.length === 0 && <EmptyState icon={<IconMessageCircle size={22} />} title="发一条消息开始对话" />}
            {messages.map((message, index) => (
              <MessageView key={index} role={message.role} blocks={message.blocks} busy={busy} />
            ))}
            <div ref={endRef} />
          </div>
        </main>

        <footer className="shrink-0 px-6 pb-4">
          <div className="mx-auto w-full max-w-reading">
            <div className="flex items-end gap-2 rounded-panel bg-surface p-1.5 ring-1 ring-line focus-within:ring-accent">
              <textarea ref={inputRef} value={input} rows={1}
                placeholder="输入消息，Enter 发送 · Shift+Enter 换行"
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(); } }}
                className="max-h-44 flex-1 resize-none bg-transparent px-2.5 py-1.5 text-content leading-relaxed text-ink-900 placeholder:text-ink-500" />
              <IconButton label={busy ? "生成中" : "发送"} size="lg" tone="solid"
                disabled={busy || input.trim() === "" || sessionId === undefined}
                onClick={() => void send()}>
                <IconArrowUpIcon />
              </IconButton>
            </div>
          </div>
        </footer>
      </div>

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
              <FilePanel tabs={fileTabs} activeId={activeFileTabId} onSelectTab={setActiveFileTabId}
                onCloseTab={closeFileTab} onPrefsChange={updateTabPrefs} />
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
        <ConfirmDialog title={confirm.title} message={confirm.message} confirmLabel={confirm.confirmLabel} danger
          onCancel={() => setConfirm(undefined)}
          onConfirm={() => { const run = confirm.run; setConfirm(undefined); run(); }} />
      )}
    </div>
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
