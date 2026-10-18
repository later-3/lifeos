import { useEffect, useRef, useState } from "react";
import { IconChevronLeft, IconChevronRight, IconFolderPlus, IconLayoutSidebarRight, IconPencil, IconPlus, IconTrash, IconX } from "@tabler/icons-react";
import { DirectoryPicker } from "./DirectoryPicker";
import { FileTree } from "./FileTree";
import { FilePanel } from "./FilePanel";
import { useColumnWidth, type ColumnKey } from "./useColumnWidth";
import { useFilePanel } from "./useFilePanel";

// 三级级联菜单：第1列 Agent → 第2列 其 Projects → 第3列 该项目的所有事情 → 主区聊天。
// 折叠**完全独立**（收第2级不牵连第3级）：藏起的列在其原位留一条窄边（chevron），点边即展开（2026-10-17 用户更正）。
// 每列可拖宽（宽度持久化）；图标语言与 Pi Web 一致（Tabler、纯图标 + title 提示、静音 hover）。
type Agent = { id: string; name: string };
type Project = { id: string; name: string; isDefault: boolean; path?: string };   // path = 外部项目（注册过才有）
type SessionItem = { sessionId: string; title: string; updatedAt: string; messages: number; isDefault?: boolean; running?: boolean };
type Block =
  | { type: "text"; text: string }
  | { type: "thinking"; text: string }
  | { type: "toolCall"; id?: string; name: string; arguments?: unknown; result?: string; isError?: boolean };
type Message = { role: "user" | "assistant"; text: string; blocks: Block[] };
type Group = { project: Project; sessions: SessionItem[] };
type AgentEvent = { seq: number; sessionId: string; type: "delta" | "done" | "error"; text?: string; message?: string };

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

/** 头像：auto = 由稳定 id 推导色阶 + 首字母（agent.md §5.1）。 */
const AVATAR_TONES = ["bg-neutral-900", "bg-neutral-700", "bg-neutral-500"];
function avatarTone(id: string): string {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return AVATAR_TONES[Math.abs(hash) % AVATAR_TONES.length]!;
}

const rowBase = "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-300";
const rowActive = "bg-white font-medium text-neutral-900 shadow-sm ring-1 ring-neutral-200";
const rowIdle = "text-neutral-700 hover:bg-neutral-100";
const iconBtn = "rounded-md p-0.5 text-neutral-300 transition-colors hover:bg-neutral-200/70 hover:text-neutral-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-300";

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
  const [showNav, setShowNav] = useState(true);        // 第1列（独立折叠）
  const [showProjects, setShowProjects] = useState(true);
  const [showSessions, setShowSessions] = useState(true);
  const [showTree, setShowTree] = useState(() => localStorage.getItem("lifeos.fileTree") !== "0");   // 面板内树列（独立折叠）
  const [renaming, setRenaming] = useState<{ sid: string; value: string } | undefined>();              // 会话行内重命名
  const [addingProject, setAddingProject] = useState(false);                                              // 注册外部项目（DirectoryPicker 模态）
  // 文件面板（页签/开合）与列宽（拖拽/视口钳制）各自成模块（2026-10-17 坏味道清理）
  const { panelOpen, setPanelOpen, fileTabs, activeFileTabId, setActiveFileTabId, openFile, closeFileTab, updateTabPrefs } = useFilePanel();
  const { widths, beginDrag, panelWidth, treeWidth, panelFits } = useColumnWidth({ nav: showNav, projects: showProjects, sessions: showSessions });
  const current = useRef<string | undefined>(undefined);
  const ctx = useRef<{ agentId?: string }>({});
  const snapshotSeq = useRef(0);
  const streaming = useRef(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => { current.current = sessionId; }, [sessionId]);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); });
  useEffect(() => { localStorage.setItem("lifeos.fileTree", showTree ? "1" : "0"); }, [showTree]);
  // URL 三键（2026-10-18 拍板）：agent → project → session，切换即 replaceState（刷新/分享可恢复）。
  useEffect(() => {
    if (agent === undefined || sessionId === undefined) return;
    const params = new URLSearchParams();
    params.set("agent", agent.id);
    if (selectedProjectId !== undefined) params.set("project", selectedProjectId);
    params.set("session", sessionId);
    window.history.replaceState(null, "", `?${params.toString()}`);
  }, [agent?.id, selectedProjectId, sessionId]);
  async function fetchGroups(id: string): Promise<Group[]> {
    const projects = (await (await fetch(`/api/agents/${id}/projects`)).json()) as { items: Project[] };
    return await Promise.all(projects.items.map(async (project) => {
      const list = (await (await fetch(`/api/agents/${id}/projects/${project.id}/sessions`)).json()) as { items: SessionItem[] };
      return { project, sessions: list.items };
    }));
  }

  async function loadMessages(id: string, sid: string) {
    const data = await (await fetch(`/api/agents/${id}/sessions/${sid}`)).json() as { messages: Message[] };
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

  /** 选中 Agent：级联下钻（选默认 project、开最近会话、展开下游两列）。 */
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
    const home = next.find((group) => group.project.isDefault) ?? next[0];
    setSelectedProjectId(home?.project.id);
    const latest = pickLatest(home?.sessions ?? []);
    if (latest !== undefined) await openSession(a, latest.sessionId);
  }

  /** 选中 project：第 3 列换成它的会话，打开其最近会话。 */
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

  // 一条流承载当前 Agent 的所有会话（换 Agent 时 streamSeq 归零重订）。
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

  // 首屏：读 URL 三键恢复（无效键逐级降级）；无 URL → 第一个 agent → 最近会话。
  useEffect(() => {
    void (async () => {
      const params = new URLSearchParams(window.location.search);
      const wantAgent = params.get("agent");
      const wantProject = params.get("project");
      const wantSession = params.get("session");
      const data = (await (await fetch("/api/agents")).json()) as { items: Agent[] };
      setAgents(data.items);
      const found = data.items.find((item) => item.id === wantAgent) ?? data.items[0];
      if (found === undefined) return;
      setAgent(found);
      ctx.current = { agentId: found.id };
      const groups = await fetchGroups(found.id);
      setGroups(groups);
      // 一致性：session 所在 group 是事实源（三键必须同链，不匹配的键降级忽略）
      const owner = wantSession !== null ? groups.find((g) => g.sessions.some((s) => s.sessionId === wantSession)) : undefined;
      const group = owner ?? groups.find((g) => g.project.id === wantProject) ?? groups.find((g) => g.project.isDefault) ?? groups[0];
      setSelectedProjectId(group?.project.id);
      const target = wantSession !== null && group?.sessions.some((s) => s.sessionId === wantSession)
        ? wantSession
        : pickLatest(group?.sessions ?? [])?.sessionId;
      if (target !== undefined) await openSession(found, target);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function newSession() {
    if (agent === undefined) return;
    const created = await (await fetch(`/api/agents/${agent.id}/projects/${selectedProjectId ?? "workspace"}/sessions`, { method: "POST" })).json() as { sessionId: string };
    await reloadGroups();
    // 新会话就建在当前选中的 project 下（2026-10-18：按 project 创建后，不再跳回默认项目）
    setShowSessions(true);
    await openSession(agent, created.sessionId);
  }

  /** 注册外部项目（合成入口：注册+绑定一步）；成功后直接进入该项目（URL 三键随之更新）。 */
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

  /** 解绑：仅移出清单；项目注册与会话/记录全部保留（agent.md §5.6）。 */
  async function unbindProject(project: Project) {
    if (agent === undefined) return;
    if (!window.confirm(`从该助手移除「${project.name}」？\n项目注册与该项目下的会话、记录都会保留。`)) return;
    const response = await fetch(`/api/agents/${agent.id}/projects/${project.id}`, { method: "DELETE" });
    if (!response.ok) {
      const error = await response.json() as { error?: { message?: string } };
      window.alert(error.error?.message ?? "移除失败");
      return;
    }
    const next = await reloadGroups();
    if (selectedProjectId === project.id) {
      const fallback = (next ?? []).find((g) => g.project.isDefault) ?? (next ?? [])[0];
      if (fallback !== undefined) await selectProject(fallback.project);
      else { setSelectedProjectId(undefined); setSessionId(undefined); setMessages([]); }
    }
  }

  /** 行内重命名（Pi Web 同型）：Enter 保存，Esc/失焦取消；写 session_info（name 机制）。 */
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
    if (!window.confirm(`删除会话「${session.title || "未命名"}」？此操作不可恢复。`)) return;
    const response = await fetch(`/api/agents/${agent.id}/sessions/${session.sessionId}`, { method: "DELETE" });
    if (!response.ok) {
      const error = await response.json() as { error?: { message?: string } };
      window.alert(error.error?.message ?? "删除失败");
      return;
    }
    const next = await reloadGroups();
    if (session.sessionId === sessionId) {
      // 回退保持三键一致：先在当前 project 内找兄弟会话；本项目空了才整体切到默认项目（selectProject 会同步 URL）
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
    setMessages((list) => [...list, { role: "user", text, blocks: [{ type: "text", text }] }, { role: "assistant", text: "", blocks: [] }]);
    const response = await fetch(`/api/agents/${agent.id}/sessions/${sessionId}/messages`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text }),
    });
    if (!response.ok) {
      const error = await response.json() as { error?: { message?: string } };
      setMessages((list) => [...list.slice(0, -1), { role: "assistant", text: `[出错] ${error.error?.message ?? "请求失败"}`, blocks: [{ type: "text", text: `[出错] ${error.error?.message ?? "请求失败"}` }] }]);
      setBusy(false);
    }
  }

  const currentGroup = groups.find((group) => group.project.id === selectedProjectId);

  // 视口挤压保护：装不下“面板+聊天保底”就先收面板（宽度数学全部在 useColumnWidth）。
  useEffect(() => {
    if (panelOpen && !panelFits) setPanelOpen(false);
  }, [panelOpen, panelFits]);
  // 显示链（用户 2026-10-17 定，对齐 Pi Web、无兜底）：session_info.name ‖ 首条用户消息（后端返全文，UI 截 50）
  const titleOf = (item?: SessionItem) => (item?.title ?? "").slice(0, 50);

  /** 列头：小标题 + 纯图标收起按钮（Pi Web 式：icon + title 提示）。 */
  const ColumnHeader = ({ label, onHide }: { label: React.ReactNode; onHide: () => void }) => (
    <div className="flex h-9 shrink-0 items-center justify-between border-b border-neutral-200 px-3">
      <span className="min-w-0 truncate text-[11px] font-medium tracking-wide text-neutral-400">{label}</span>
      <button aria-label="收起此列" title="收起此列" onClick={onHide} className={iconBtn}><IconChevronLeft size={15} /></button>
    </div>
  );

  /** 藏起的列在其原位留一条窄边，点边即展开（独立、保空间记忆）。 */
  const FoldStrip = ({ label, onShow }: { label: string; onShow: () => void }) => (
    <button aria-label={label} title={label} onClick={onShow}
      className="flex w-5 shrink-0 items-center justify-center border-r border-neutral-200 bg-neutral-50 text-neutral-300 transition-colors hover:bg-neutral-100 hover:text-neutral-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-300">
      <IconChevronRight size={13} />
    </button>
  );

  const DragHandle = ({ k }: { k: ColumnKey }) => (
    <div className="group w-1.5 shrink-0 cursor-col-resize" onMouseDown={(event) => beginDrag(k, event)}>
      <div className="mx-auto h-full w-px bg-neutral-200 transition-colors group-hover:bg-neutral-400" />
    </div>
  );

  return (
    <div className="flex h-dvh bg-white text-neutral-900">
      {/* 第1列 · Agent（独立折叠） */}
      {showNav ? (
        <>
          <aside style={{ width: widths.c1 }} className="flex shrink-0 flex-col border-r border-neutral-200 bg-neutral-50">
            <ColumnHeader label="助手" onHide={() => setShowNav(false)} />
            <div className="flex-1 space-y-0.5 overflow-y-auto p-2">
              {agents.map((item) => (
                <button key={item.id} onClick={() => void selectAgent(item)}
                  className={`${rowBase} ${item.id === agent?.id ? rowActive : rowIdle}`}>
                  <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] text-white ${avatarTone(item.id)}`}>{item.name.slice(0, 1)}</span>
                  <span className="truncate">{item.name}</span>
                </button>
              ))}
            </div>
          </aside>
          <DragHandle k="c1" />
        </>
      ) : <FoldStrip label="展开助手列" onShow={() => setShowNav(true)} />}

      {/* 第2列 · 当前 Agent 的 Projects（独立折叠） */}
      {showProjects ? (
        <>
          <aside style={{ width: widths.c2 }} className="flex shrink-0 flex-col border-r border-neutral-200 bg-neutral-50">
            <ColumnHeader label="项目" onHide={() => setShowProjects(false)} />
            <div className="flex-1 space-y-0.5 overflow-y-auto p-2">
              {groups.length === 0 && <p className="px-2 py-6 text-center text-xs text-neutral-400">该助手还没有项目</p>}
              {groups.map((group) => (
                <div key={group.project.id} onClick={() => void selectProject(group.project)}
                  className={`group flex w-full cursor-pointer items-center gap-1 rounded-lg px-2 py-1.5 text-[13px] transition-colors ${group.project.id === selectedProjectId ? rowActive : rowIdle}`}>
                  <span className="min-w-0 flex-1 truncate">{group.project.name}</span>
                  {group.project.isDefault && <span className="shrink-0 rounded-md bg-neutral-200/80 px-1.5 py-px text-[10px] font-normal text-neutral-500">默认</span>}
                  <span className="shrink-0 text-[10px] font-normal text-neutral-400 group-hover:hidden" title={group.project.path ?? ""}>{group.sessions.length}</span>
                  {group.project.path !== undefined && (
                    <span className="hidden shrink-0 items-center group-hover:flex">
                      <button title="从该助手移除（项目与会话保留）" aria-label="从该助手移除项目"
                        onClick={(event) => { event.stopPropagation(); void unbindProject(group.project); }}
                        className="rounded-md p-1 text-neutral-300 transition-colors hover:bg-neutral-200 hover:text-neutral-700"><IconX size={13} /></button>
                    </span>
                  )}
                </div>
              ))}
            </div>
            <div className="border-t border-neutral-200 p-2">
              <button onClick={() => setAddingProject(true)}
                className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-neutral-200 bg-white py-1.5 text-[13px] text-neutral-600 transition-colors hover:border-neutral-300 hover:text-neutral-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-300">
                <IconFolderPlus size={14} /> 添加项目
              </button>
            </div>
            {addingProject && (
              <DirectoryPicker onCancel={() => setAddingProject(false)} onSelect={registerProject} />
            )}
          </aside>
          <DragHandle k="c2" />
        </>
      ) : <FoldStrip label="展开项目列" onShow={() => setShowProjects(true)} />}

      {/* 第3列 · 选中 Project 下的所有事情（独立折叠） */}
      {showSessions ? (
        <>
          <aside style={{ width: widths.c3 }} className="flex shrink-0 flex-col border-r border-neutral-200 bg-neutral-50">
            <ColumnHeader
              label={<span className="flex items-center gap-1.5">
                <span className="truncate">{currentGroup?.project.name ?? "会话"}</span>
                {currentGroup?.project.isDefault && <span className="rounded-md bg-neutral-200/80 px-1.5 py-px text-[10px] text-neutral-500">默认</span>}
              </span>}
              onHide={() => setShowSessions(false)} />
            <div className="min-h-0 flex-1 overflow-y-auto p-2">
              {currentGroup === undefined && <p className="px-2 py-6 text-center text-xs text-neutral-400">先在左侧选择项目</p>}
              {currentGroup !== undefined && currentGroup.sessions.length === 0 && (
                <p className="px-2 py-6 text-center text-xs text-neutral-400">该项目暂无会话</p>
              )}
              {currentGroup?.sessions.map((item) => (
                <div key={item.sessionId}
                  className={`group flex w-full cursor-pointer items-center gap-1 rounded-lg px-2 py-1.5 text-[13px] transition-colors ${item.sessionId === sessionId ? rowActive : rowIdle}`}
                  onClick={() => agent !== undefined && void openSession(agent, item.sessionId)}>
                  {renaming?.sid === item.sessionId ? (
                    <input autoFocus
                      value={renaming.value}
                      onFocus={(event) => event.currentTarget.select()}
                      onChange={(event) => setRenaming({ sid: item.sessionId, value: event.target.value })}
                      onKeyDown={(event) => {
                        // 提交读 DOM 当前值（currentTarget.value），避免极快输入时闭包值过期
                        if (event.key === "Enter") { event.preventDefault(); void commitRename(item, event.currentTarget.value); }
                        if (event.key === "Escape") { event.preventDefault(); setRenaming(undefined); }
                      }}
                      onBlur={() => setRenaming(undefined)}
                      onClick={(event) => event.stopPropagation()}
                      className="min-w-0 flex-1 rounded-md border border-neutral-400 bg-white px-1 py-0.5 text-[13px] outline-none focus:border-neutral-500" />
                  ) : (
                    <span className="min-w-0 flex-1 truncate">{titleOf(item)}</span>
                  )}
                  {item.running
                    ? <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" title="生成中" />
                    : <span className="shrink-0 text-[10px] text-neutral-400 group-hover:hidden">{timeAgo(item.updatedAt)}</span>}
                  <span className="hidden shrink-0 items-center gap-0.5 group-hover:flex">
                    <button title="重命名" aria-label="重命名会话"
                      onClick={(event) => { event.stopPropagation(); setRenaming({ sid: item.sessionId, value: item.title }); }}
                      className="rounded-md p-1 text-neutral-300 transition-colors hover:bg-neutral-200 hover:text-neutral-700"><IconPencil size={13} /></button>
                    <button title="删除" aria-label="删除会话"
                      onClick={(event) => { event.stopPropagation(); void removeSession(item); }}
                      className="rounded-md p-1 text-neutral-300 transition-colors hover:bg-neutral-200 hover:text-neutral-700"><IconTrash size={13} /></button>
                  </span>
                </div>
              ))}
            </div>

            <div className="border-t border-neutral-200 p-2">
              <button onClick={() => void newSession()}
                className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-neutral-200 bg-white py-1.5 text-[13px] text-neutral-600 transition-colors hover:border-neutral-300 hover:text-neutral-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-300">
                <IconPlus size={14} /> 新建会话
              </button>
            </div>
          </aside>
          <DragHandle k="c3" />
        </>
      ) : <FoldStrip label="展开会话列" onShow={() => setShowSessions(true)} />}

      {/* 主区 · 聊天（列收起后占满） */}
      <div className="flex h-dvh min-w-0 flex-1 flex-col bg-white">
        <header className="flex h-12 shrink-0 items-center border-b border-neutral-200 px-4">
          <h1 className="text-sm font-semibold tracking-tight text-neutral-900">Life OS</h1>
          {/* 面板开合钮贴右缘（Pi Web top bar 同位）；不放任何未要求的面包屑 */}
          <button aria-label="文件面板" title={panelOpen ? "收起文件面板" : "展开文件面板"}
            onClick={() => setPanelOpen((prev) => !prev)}
            className={`ml-auto rounded-md p-1.5 transition-colors ${panelOpen ? "bg-neutral-100 text-neutral-800" : "text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"}`}>
            <IconLayoutSidebarRight size={16} />
          </button>
        </header>

        <main className="flex w-full flex-1 flex-col gap-2.5 overflow-y-auto px-6 py-5">
          {sessionId === undefined && <p className="mt-8 text-center text-sm text-neutral-400">选择或新建一个会话开始。</p>}
          {messages.length === 0 && sessionId !== undefined && <p className="mt-8 text-center text-sm text-neutral-400">发一条消息开始对话。</p>}
          {messages.map((message, index) => message.role === "user" ? (
            <div key={index} className="flex justify-end">
              <div className="max-w-[80%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-neutral-900 px-4 py-2.5 text-sm leading-relaxed text-white">{message.text}</div>
            </div>
          ) : (
            <div key={index} className="flex flex-col items-start gap-2">
              {message.blocks.length === 0
                ? <div className="max-w-[80%] rounded-2xl rounded-bl-md bg-neutral-100 px-4 py-2.5 text-sm">{busy ? "…" : ""}</div>
                : message.blocks.map((block, blockIndex) => <BlockView key={blockIndex} block={block} busy={busy} />)}
            </div>
          ))}
          <div ref={endRef} />
        </main>

        <footer className="border-t border-neutral-200 p-3">
          <div className="flex items-end gap-2">
            <textarea
              value={input} rows={1} placeholder="输入消息，Enter 发送，Shift+Enter 换行"
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(); } }}
              className="max-h-32 flex-1 resize-none rounded-xl border border-neutral-200 bg-neutral-50/60 px-3.5 py-2.5 text-sm outline-none transition-colors focus:border-neutral-400 focus:bg-white"
            />
            <button onClick={() => void send()} disabled={busy || input.trim() === "" || sessionId === undefined}
              className="rounded-xl bg-neutral-900 px-4 py-2.5 text-sm text-white transition-opacity hover:bg-neutral-800 disabled:opacity-40">
              {busy ? "生成中" : "发送"}
            </button>
          </div>
        </footer>
      </div>

      {/* 右侧文件面板：独立区域 = [文件夹树 | 查看器]，左右可各自拖宽（用户 2026-10-17） */}
      {panelOpen && (
        <>
          <DragHandle k="c4" />
          <aside style={{ width: panelWidth }} className="flex shrink-0 overflow-hidden border-l border-neutral-200 bg-white">
            {showTree ? (
              <>
                <div style={{ width: treeWidth }} className="flex min-w-0 shrink-0 flex-col overflow-hidden border-r border-neutral-200">
                  <FileTree onOpenFile={openFile} onHide={() => setShowTree(false)} />
                </div>
                <DragHandle k="c4t" />
              </>
            ) : <FoldStrip label="展开文件树" onShow={() => setShowTree(true)} />}
            <div className="min-w-0 flex-1 overflow-hidden">
              <FilePanel tabs={fileTabs} activeId={activeFileTabId} onSelectTab={setActiveFileTabId}
                onCloseTab={closeFileTab} onPrefsChange={updateTabPrefs} />
            </div>
          </aside>
        </>
      )}
    </div>
  );
}

/** 结构化块渲染（参考 Pi Web MessageView：思考与工具折叠展示）。 */
function BlockView({ block, busy }: { block: Block; busy: boolean }) {
  if (block.type === "text") {
    return (
      <div className="max-w-[80%] whitespace-pre-wrap rounded-2xl rounded-bl-md bg-neutral-100 px-4 py-2.5 text-sm leading-relaxed">
        {block.text === "" && busy ? "…" : block.text}
      </div>
    );
  }
  if (block.type === "thinking") {
    return (
      <details className="max-w-[80%] overflow-hidden rounded-xl border border-neutral-200 bg-neutral-50 text-sm">
        <summary className="cursor-pointer select-none px-3 py-2 text-xs text-neutral-500 transition-colors hover:text-neutral-700">思考过程</summary>
        <div className="whitespace-pre-wrap border-t border-neutral-200 px-3 py-2 text-xs leading-relaxed text-neutral-600">{block.text}</div>
      </details>
    );
  }
  const status = block.isError ? "（出错）" : block.result !== undefined ? "（已完成）" : "（执行中…）";
  return (
    <details className="max-w-[80%] overflow-hidden rounded-xl border border-neutral-200 bg-neutral-50 text-sm">
      <summary className="cursor-pointer select-none px-3 py-2 text-xs text-neutral-500 transition-colors hover:text-neutral-700">工具 · {block.name}{status}</summary>
      <div className="border-t border-neutral-200">
        <pre className="overflow-x-auto whitespace-pre-wrap px-3 py-2 text-xs text-neutral-600">{JSON.stringify(block.arguments ?? {}, null, 2)}</pre>
        {block.result !== undefined && (
          <pre className="max-h-40 overflow-y-auto whitespace-pre-wrap border-t border-neutral-200 bg-white px-3 py-2 text-xs text-neutral-500">{block.result}</pre>
        )}
      </div>
    </details>
  );
}
