// Life OS 自有工具（Pi 生态内实现：defineTool + createAgentSession({ customTools })，
// 不自己造工具系统——文档依据：pi/packages/coding-agent/docs/extensions.md §Tools）。
//
// 两个工具都只是"薄封装"：真正的动作在 src/agents.ts（创建 / 归档），与 HTTP 接口共用同一份实现。
// 名字必须加进 createAgentSession 的 tools allowlist（那是白名单："When provided, only matching
// tools are enabled"），否则注册了也调不到。
import { Type } from "@earendil-works/pi-ai";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { archiveAgent, createAgent } from "./agents.ts";
import { createTask, listTasks } from "./tasks.ts";
import { bindProject, listAgentProjects, unbindProject } from "./projects.ts";
import { deleteMemory, recordMemory, searchMemory, searchMemoryScopes } from "./memory/index.ts";
import { defaultReadOrder, roleLabel, type MemoryRole } from "./memory/roles.ts";
import { resolveMemoryRole, type MemoryScope } from "./memory/resolve.ts";
import {
  ASK_DEFAULT_TIMEOUT_MS, listPeerAgents, listPeerSessions, namePeerSession, peerConversation,
  peerSessionTitle, peerSnapshot, resolvePeer, snapshotText,
} from "./peer.ts";
import { registerPendingPeer } from "./peer-completion.ts";
import { getSession, queueSessionInput, runTurn } from "./agent-host.ts";
import { resolveHome } from "./home.ts";
import { LIFEOS_TOOL_NAMES } from "./tool-names.ts";

export { LIFEOS_TOOL_NAMES };


/** 工具要绑定"当前会话是谁、在哪个项目"——都由会话自身推导，模型不用传（也不会传错）。 */
export type ToolContext = {
  agentId: string;
  projectId: string;
  /**
   * 当前会话 id（Task 0015 · T7）：`lifeos_send` 要登记"完成后回流到哪"。
   * 缺失时不登记——退化为"只交办、不回流"，而不是报错。
   */
  sessionId?: string | undefined;
  /**
   * 当前会话的 Task（Task 0015 · T1）：lane 的 Task 维度。
   * 缺失时按"不区分 Task"处理（老调用/测试场景）。
   */
  taskId?: string | undefined;
  /** 进入一个 Task：由宿主把会话指针指向它，下一轮装配生效（建 Task 即进入、接手已有 Task 也走这里）。 */
  onEnterTask?: (taskId: string) => void | Promise<void>;
};

export function createAgentTools(ctx: ToolContext) {
  const create = defineTool({
    name: "lifeos_agent_create",
    label: "Create Life OS agent",
    description:
      "Create a new Life OS agent (a long-lived assistant with its own identity, a default workspace project with its default task, and sessions). "
      + "The id is generated once and stays stable — renaming the display name never changes it, so never archive and recreate an agent just to change an id. "
      + "Creating with an existing agent name returns that agent unchanged (no duplicates). Non-ASCII names get an opaque id such as agent-3f9a; that is expected. "
      + "The agent gets its standard skeleton (agent.json, identity.md, tools/, memory/, and the workspace project with flywheel, concept-space, cases, knowledge, tools, todo, sessions and tasks/0001-default). "
      + "Nothing is written outside ~/.lifeos/agents/<id>/, and other agents are untouched.",
    promptSnippet: "Create a new Life OS agent (multi-agent)",
    promptGuidelines: [
      "Use lifeos_agent_create when the user asks for a second assistant with a different role or focus; report the returned id so they can switch with ?agent=<id>.",
    ],
    parameters: Type.Object({
      name: Type.String({ description: "Display name of the new agent, e.g. 'Code Reviewer'. Used to generate the id." }),
      description: Type.Optional(Type.String({ description: "One-line summary shown in the agent list (not injected into the prompt)." })),
    }),
    async execute(_toolCallId, params) {
      const result = await createAgent({ name: params.name, ...(params.description !== undefined ? { description: params.description } : {}) });
      if ("code" in result) throw new Error(result.message);
      if (!result.created) {
        return {
          content: [{
            type: "text" as const,
            text: `Agent "${result.name}" already exists (id: ${result.id}); nothing was created.\n`
              + `The id is stable: renaming the display name never changes it — do not archive and recreate an agent to change an id.`,
          }],
          details: { id: result.id, dir: result.dir, created: false },
        };
      }
      return {
        content: [{
          type: "text" as const,
          text: `Created agent "${result.name}" (id: ${result.id}).\n`
            + `Files: ${result.dir}/agent.json · identity.md (skeleton) · projects/workspace/{AGENTS.md,flywheel.md,concept-space.md,specs,cases,knowledge,tools,todo,memory,task-types,sessions,tasks/0001-default}\n`
            + `No preset session: the first message starts a new session.`,
        }],
        details: { id: result.id, dir: result.dir, created: true },
      };
    },
  });

  const remove = defineTool({
    name: "lifeos_agent_delete",
    label: "Archive Life OS agent",
    description:
      "Archive a Life OS agent: hidden from all lists, while its sessions, records and files stay on disk (recoverable by removing archivedAt from its agent.json). "
      + "Fails when the agent has a running session or is the last non-archived agent. "
      + "To discover ids, list ~/.lifeos/agents/ or ask the user.",
    promptSnippet: "Archive a Life OS agent (keeps all data)",
    promptGuidelines: [
      "lifeos_agent_delete only hides an agent; it never deletes conversations. Confirm the agent id with the user before calling it.",
    ],
    annotations: { destructiveHint: true, readOnlyHint: false, idempotentHint: false, openWorldHint: false },
    parameters: Type.Object({
      id: Type.String({ description: "Agent id (the directory name under ~/.lifeos/agents/)." }),
    }),
    async execute(_toolCallId, params) {
      const result = await archiveAgent(params.id);
      if ("code" in result) throw new Error(result.message);
      return {
        content: [{ type: "text" as const, text: `Archived agent ${result.archived} (hidden from lists; sessions and records kept).` }],
        details: { archived: result.archived },
      };
    },
  });

  const taskCreate = defineTool({
    name: "lifeos_task_create",
    label: "Create Life OS task",
    description:
      "Create a numbered task in the current project: a task directory with task.md (single source of truth), the shared task structure and the documents its type declares. "
      + "The type is open-ended: it names a folder under task-types/ that holds the type's template and rules (e.g. development, general). "
      + "If no existing type fits, discuss it with the user and add a new type template instead of forcing one. daily is reserved for the system's default task. "
      + "Creating a task also makes it the current task of this conversation (applied from the next turn).",
    promptSnippet: "Create a numbered task of a declared type (task-types/<type>) with task.md and its documents",
    promptGuidelines: [
      "Use lifeos_task_create when the user asks for real work — then fill the background first, with facts, before planning.",
      "Pick the type whose template fits the work; if none fits, discuss a new type with the user first.",
      "Keep task.md as the single place for status; update 当前指针 as you go. Status is a record, not a lock: the user may reopen a finished task at any time.",
    ],
    parameters: Type.Object({
      title: Type.String({ description: "Task title, e.g. '文件面板：删除已注册根'. Chinese is fine; it becomes the directory name." }),
      type: Type.Optional(Type.String({
        description: "Task type = a folder name under task-types/ (default development). Declared types are described in task-types/*/AGENTS.md. daily is reserved.",
      })),
      category: Type.String({
        description: "Category as declared by the type's template (e.g. development: A / B / C; general: G).",
      }),
      goal: Type.Optional(Type.String({ description: "One-line verifiable goal. Defaults to the title; editable later." })),
    }),
    async execute(_toolCallId, params) {
      const result = await createTask(ctx, {
        title: params.title,
        ...(params.type !== undefined ? { type: params.type } : {}),
        category: params.category,
        ...(params.goal !== undefined ? { goal: params.goal } : {}),
      });
      if ("code" in result) throw new Error(result.message);
      const task = result.task;
      await ctx.onEnterTask?.(task.id);
      const files = task.docs ?? [];
      return {
        content: [{
          type: "text" as const,
          text: `Created task ${task.id} (${task.type} · ${task.category}) at ${task.path}\n`
            + `Files: task.md${files.length > 0 ? ` · ${files.join(" · ")}` : ""}\n`
            + `This conversation now works in task ${task.id} (takes effect from the next turn). Next: fill the background with current facts, then the plan.`,
        }],
        details: { id: task.id, number: task.number, path: task.path, type: task.type },
      };
    },
  });

  const taskList = defineTool({
    name: "lifeos_task_list",
    label: "List Life OS tasks",
    description: "List this project's tasks (number, title, category, status, goal) by reading task.md in each task directory. Newest numbers last.",
    promptSnippet: "List this project's tasks and their status",
    parameters: Type.Object({}),
    async execute() {
      const tasks = await listTasks(ctx);
      if (tasks.length === 0) {
        return { content: [{ type: "text" as const, text: "No tasks in this project yet." }], details: { tasks: [] } };
      }
      const text = tasks.map((task) => `${task.id} · ${task.type}/${task.category} · ${task.status} · ${task.goal}`).join("\n");
      return { content: [{ type: "text" as const, text }], details: { tasks } };
    },
  });

  const taskEnter = defineTool({
    name: "lifeos_task_enter",
    label: "Enter an existing Life OS task",
    description:
      "Point this conversation at an existing task of the current project (takes effect from the next turn). "
      + "Use it when the user names a task to continue or take over — do not create a duplicate task for the same work. "
      + "Task switching happens here, in the conversation: there is no separate UI switch command.",
    promptSnippet: "Enter an existing task of this project by its number (applies from the next turn)",
    promptGuidelines: [
      "Use lifeos_task_enter when the user refers to an existing task ('继续 0002', '接手那个 Task').",
      "Call lifeos_task_list first if you are not sure of the number; never guess an id.",
    ],
    parameters: Type.Object({
      taskId: Type.String({ description: "Task number (e.g. 0002); the full directory name (0002-some-title) is also accepted" }),
    }),
    async execute(_toolCallId, params) {
      const tasks = await listTasks(ctx);
      const wanted = params.taskId.trim();
      const found = tasks.find((task) => task.id === wanted || task.dirName === wanted);
      if (found === undefined) {
        throw new Error(`No task ${wanted} in this project. Use lifeos_task_list to see the available tasks.`);
      }
      await ctx.onEnterTask?.(found.id);
      return {
        content: [{
          type: "text" as const,
          text: `Now working in task ${found.id} · ${found.title} (takes effect from the next turn).`,
        }],
        details: { id: found.id, title: found.title, dirName: found.dirName },
      };
    },
  });

  const projectAdd = defineTool({
    name: "lifeos_project_add",
    label: "Add Life OS project",
    description:
      "Add a directory as a project of this agent: registers it and binds it to the agent so it appears in the project list. "
      + "The path must be an existing directory; nothing is written into it (the manifest lives under ~/.lifeos). "
      + "Adding the same path again is idempotent (returns the existing project, created=false).",
    promptSnippet: "Add a directory as a project of this agent",
    promptGuidelines: [
      "Use lifeos_project_add when the user wants to work on another repository/folder; report the project id so they can select it.",
      "Do not call it for paths that do not exist; ask the user for the correct path instead.",
    ],
    parameters: Type.Object({
      path: Type.String({ description: "Absolute path of an existing directory, e.g. /Users/you/Code/some-project" }),
    }),
    async execute(_toolCallId, params) {
      const result = await bindProject(ctx.agentId, params.path);
      if ("code" in result) throw new Error(result.message);
      // 界面刷新由写实现（src/projects.ts）广播，工具不负责通知
      return {
        content: [{
          type: "text" as const,
          text: result.created
            ? `Added project "${result.project.name}" (id: ${result.project.id}) from ${result.project.path}.`
            : `Project already exists: "${result.project.name}" (id: ${result.project.id}) at ${result.project.path}. Nothing was created.`,
        }],
        details: { project: result.project, created: result.created, defaultTask: result.defaultTask },
      };
    },
  });

  const projectRemove = defineTool({
    name: "lifeos_project_remove",
    label: "Remove Life OS project",
    description:
      "Remove a project from this agent's list so it no longer appears in the UI. "
      + "Files, sessions and records stay on disk and are recoverable by adding the same path again. "
      + "The built-in workspace project and the default project cannot be removed.",
    promptSnippet: "Remove a project from this agent's list (keeps all data)",
    promptGuidelines: [
      "lifeos_project_remove only hides a project from the list; it never deletes the directory or its sessions.",
      "Confirm the project id with the user before removing it.",
    ],
    annotations: { destructiveHint: true, readOnlyHint: false, idempotentHint: true, openWorldHint: false },
    parameters: Type.Object({
      id: Type.String({ description: "Project id (directory name under the agent's projects/), as returned by lifeos_project_list" }),
    }),
    async execute(_toolCallId, params) {
      const result = await unbindProject(ctx.agentId, params.id);
      if (result !== "unbound") throw new Error(result.message);
      return {
        content: [{
          type: "text" as const,
          text: `Removed project "${params.id}" from the list. Its files and sessions are unchanged; add the same path again to restore it.`,
        }],
        details: { removed: params.id },
      };
    },
  });

  const projectList = defineTool({
    name: "lifeos_project_list",
    label: "List Life OS projects",
    description:
      "List this agent's projects (id, display name, path, which one is default) by scanning the agent's projects/ directories. "
      + "Use the returned id wherever a project id is required.",
    promptSnippet: "List this agent's projects",
    parameters: Type.Object({}),
    async execute() {
      const projects = await listAgentProjects(ctx.agentId);
      if (projects.length === 0) {
        return { content: [{ type: "text" as const, text: "No projects yet." }], details: { projects: [] } };
      }
      const text = projects
        .map((project) => `${project.id} · ${project.name}${project.isDefault ? " (default)" : ""}${project.path === undefined ? "" : ` · ${project.path}`}`)
        .join("\n");
      return { content: [{ type: "text" as const, text }], details: { projects } };
    },
  });


  const MEMORY_SCOPES = ["agent_project", "project", "agent", "user"] as const;
  const firstLine = (text: string): string => text.split("\n")[0]?.slice(0, 120) ?? "";

  const memorySearch = defineTool({
    name: "lifeos_memory_search",
    label: "Search Life OS memories",
    description:
      "Search this agent's memories. With no scope, searches and merges in this order: agent's project memory (this agent + this project) → project shared memory (this project) → agent memory (this agent, across projects) → user memory. "
      + "Cross-project: pass a GLOBAL projectId together with scope=project — only that project's shared memory is readable; another agent's private project memory is never readable. "
      + "Results include id + scope so they can be deleted later.",
    promptSnippet: "Search memories (project / agent / user) for this agent",
    promptGuidelines: [
      "Search memories when the user refers to something decided or learned before, or asks what you remember.",
      "Default: only the current project. Do not search other projects unless the user explicitly asks; then use scope=project with that project's global projectId.",
    ],
    parameters: Type.Object({
      query: Type.String({ description: "What to look for (natural language is fine)." }),
      scope: Type.Optional(Type.Union(MEMORY_SCOPES.map((value) => Type.Literal(value)), {
        description: "Restrict to one memory layer. Omit = merged default order (agent's project memory → project shared → agent → user).",
      })),
      projectId: Type.Optional(Type.String({ description: "Global project id. Only allowed with scope=project, for reading another project's shared memory." })),
      limit: Type.Optional(Type.Number({ description: "Max results (default 10)." })),
    }),
    async execute(_toolCallId, params) {
      const limit = params.limit ?? 10;
      if (params.scope === undefined) {
        const roles = defaultReadOrder({ agentId: ctx.agentId, projectId: ctx.projectId });
        const hits = await searchMemoryScopes(roles, params.query, { limit });
        if (hits.length === 0) return { content: [{ type: "text" as const, text: "No memories found." }], details: { hits: [] } };
        const text = hits.map((hit) => `${roleLabel(hit.role)} · ${hit.score.toFixed(2)} · ${hit.id} · ${firstLine(hit.text)}`).join("\n");
        return { content: [{ type: "text" as const, text }], details: { hits } };
      }
      const resolved = resolveMemoryRole({
        agentId: ctx.agentId, currentProjectId: ctx.projectId, scope: params.scope as MemoryScope,
        ...(params.projectId !== undefined ? { targetProjectId: params.projectId } : {}), action: "search",
      });
      if ("error" in resolved) throw new Error(resolved.error);
      const hits = await searchMemory(resolved.role, params.query, { limit });
      if (hits.length === 0) return { content: [{ type: "text" as const, text: "No memories found." }], details: { hits: [] } };
      const text = hits.map((hit) => `${roleLabel(resolved.role)} · ${hit.score.toFixed(2)} · ${hit.id} · ${firstLine(hit.text)}`).join("\n");
      return { content: [{ type: "text" as const, text }], details: { hits } };
    },
  });

  const memoryRecord = defineTool({
    name: "lifeos_memory_record",
    label: "Record a Life OS memory",
    description:
      "Record one fact the user asked to remember. scope is REQUIRED and decides where it goes: "
      + "agent_project = this agent in this project (private), project = shared with all agents in this project, agent = this agent across projects, user = this user across projects. "
      + "Write only the layer the user's instruction implies; do not auto-record whole conversations and do not share/promote by yourself. "
      + "Never store secrets (API keys, passwords, tokens, cookies).",
    promptSnippet: "Record a fact the user asked to remember (scope required)",
    promptGuidelines: [
      "Only record facts the user explicitly asked to keep (preferences, decisions, project conventions, lessons). Do not record every turn.",
      "Choose the layer from the user's words: project conventions → project; user preferences → user; cross-project lessons → agent; this project's gotchas → agent_project.",
    ],
    parameters: Type.Object({
      content: Type.String({ description: "The fact to remember, one or two sentences." }),
      scope: Type.Union(MEMORY_SCOPES.map((value) => Type.Literal(value)), {
        description: "Required. agent_project (private, this project) | project (shared in this project) | agent (this agent, cross-project) | user (this user, cross-project).",
      }),
      projectId: Type.Optional(Type.String({ description: "Global project id; defaults to the current project. Cannot be used to write into another project." })),
    }),
    async execute(_toolCallId, params) {
      const resolved = resolveMemoryRole({
        agentId: ctx.agentId, currentProjectId: ctx.projectId, scope: params.scope as MemoryScope,
        ...(params.projectId !== undefined ? { targetProjectId: params.projectId } : {}), action: "record",
      });
      if ("error" in resolved) throw new Error(resolved.error);
      const result = await recordMemory(resolved.role, { userText: params.content, agentText: "" });
      return {
        content: [{ type: "text" as const, text: `Recorded (${roleLabel(resolved.role)}) id=${result.traceId}` }],
        details: { id: result.traceId, scope: params.scope, episodeId: result.episodeId },
      };
    },
  });

  const memoryDelete = defineTool({
    name: "lifeos_memory_delete",
    label: "Delete a Life OS memory",
    description:
      "Permanently delete one memory by id + scope (hard delete, irreversible, idempotent). "
      + "Call it ONLY when the user explicitly asks to delete that memory; never as cleanup. "
      + "There is no edit or undo: to correct a memory, delete it and record a new one. "
      + "Never bulk-delete on your own; if the user asks for bulk deletion, list the items and counts first and wait for confirmation.",
    promptSnippet: "Delete one memory (hard delete; only on explicit user request)",
    promptGuidelines: [
      "Confirm the exact id and scope with the user before deleting; deletion is permanent.",
      "Do not delete memories to 'clean up' or to resolve contradictions — record a corrected memory instead (or ask the user).",
    ],
    annotations: { destructiveHint: true, readOnlyHint: false, idempotentHint: true, openWorldHint: false },
    parameters: Type.Object({
      id: Type.String({ description: "Memory id from lifeos_memory_search." }),
      scope: Type.Union(MEMORY_SCOPES.map((value) => Type.Literal(value)), {
        description: "The layer the memory lives in (same as returned by search).",
      }),
      projectId: Type.Optional(Type.String({ description: "Global project id; defaults to the current project." })),
    }),
    async execute(_toolCallId, params) {
      const resolved = resolveMemoryRole({
        agentId: ctx.agentId, currentProjectId: ctx.projectId, scope: params.scope as MemoryScope,
        ...(params.projectId !== undefined ? { targetProjectId: params.projectId } : {}), action: "delete",
      });
      if ("error" in resolved) throw new Error(resolved.error);
      const deleted = await deleteMemory(resolved.role, params.id);
      if (!deleted) throw new Error("No memory with that id in this scope (it may already be deleted).");
      return { content: [{ type: "text" as const, text: `Deleted (${roleLabel(resolved.role)}) id=${params.id}` }], details: { id: params.id, scope: params.scope } };
    },
  });

  // ── 与其他 Agent 对话（Task 0013 · M1 → Task 0015 · lane 升级）─────────────
  // 目标 Agent 的会话就是一条普通会话：建在它自己的项目里，出现在列表、有 Task、有未读。
  // lane = (发起方, 目标, 项目, 发起方 taskId)：同一 Task 内复用一个会话，不同 Task 各自一条。
  const peerErrorText = (code: string, target: string, available?: string[], sessionId?: string): string => {
    if (code === "self") return "You cannot message yourself. Pick another Life OS agent.";
    if (code === "archived") return `Agent "${target}" is archived; unarchive it first or pick another agent.`;
    if (code === "session_not_found") {
      return `No peer conversation with session id "${sessionId ?? "(unknown)"}"`
        + `${available !== undefined && available.length > 0 ? `. Known sessions with this agent: ${available.join(", ")}` : " (none with this agent yet)"}.`;
    }
    if (code === "session_not_in_lane") {
      return `That session exists but belongs to a different task lane. Sessions in the current lane: ${available?.join(", ") ?? "(none)"}.`;
    }
    return `No Life OS agent with id "${target}". Use lifeos_agent_list to see the available agents.`;
  };

  /** 当前会话的 Task（lane 的 Task 维度）；读不到就 undefined（= 不按 Task 分）。 */
  const currentTaskId = (): string | undefined => ctx.taskId;

  const ask = defineTool({
    name: "lifeos_ask",
    label: "Ask another Life OS agent (waits for the answer)",
    description:
      "Ask another Life OS agent and WAIT for its answer. The target agent answers in its own full session "
      + "(its own identity, harness rules, task and tools), so treat it as a colleague, not a function. "
      + "Conversations are reused per (task, agent): asking again inside the same task continues the same conversation, "
      + "while a different task gets its own conversation. "
      + "Pass newSession:true to start a fresh conversation with the same agent; pass sessionId to continue a specific one. "
      + "The result is a STATE SNAPSHOT: state/phase/lastReply/next tell you whether it finished, is still running, or failed, "
      + "and what to do next. A timeout is NOT a failure — it returns the same snapshot with state still running.",
    promptSnippet: "Ask another agent and wait; returns a state snapshot (lane = task + agent)",
    promptGuidelines: [
      "Prefer lifeos_ask for questions you need answered before replying; prefer lifeos_send for work that takes a long time.",
      "Write the message as you would to a colleague: state the goal, the constraints, and what you need back.",
      "Check `state` before using `lastReply`: only `idle` means it answered; `running` means it is still working.",
      "If the target replies that it needs clarification, decide yourself: answer it or ask the user — do not loop blindly.",
    ],
    parameters: Type.Object({
      agent: Type.String({ description: "Target Life OS agent id (e.g. 'coder')." }),
      message: Type.String({ description: "What to ask. Include the context the other agent cannot guess." }),
      timeoutMs: Type.Optional(Type.Number({ description: "How long to wait before handing control back (default 10 minutes). Timing out does not cancel the target's turn." })),
      sessionId: Type.Optional(Type.String({ description: "Continue this specific conversation. Omit to continue the most recent one for the current task." })),
      newSession: Type.Optional(Type.Boolean({ description: "Start a NEW conversation with this agent instead of continuing the current task's one." })),
    }),
    async execute(_toolCallId, params) {
      const taskId = currentTaskId();
      const resolved = await resolvePeer(ctx.agentId, params.agent);
      if (!resolved.ok) throw new Error(peerErrorText(resolved.code, params.agent));
      const peer = await peerConversation(ctx.agentId, params.agent, ctx.projectId, resolveHome(), {
        ...(taskId !== undefined ? { taskId } : {}),
        ...(params.sessionId !== undefined ? { sessionId: params.sessionId } : {}),
        ...(params.newSession === true ? { newSession: true } : {}),
      });
      if (!peer.ok) throw new Error(peerErrorText(peer.code, params.agent, peer.available, params.sessionId));
      const { sessionId } = peer.conversation;
      namePeerSession(await getSession(peer.conversation.agentId, sessionId, resolveHome()), resolved.name);

      // 重入守卫（T8）：目标正在跑 → 不投递，直接返回状态快照（不忙等、不谎报失败）。
      const before = await peerSnapshot(peer.conversation.agentId, sessionId, taskId);
      if (before.state === "running") {
        return {
          content: [{ type: "text" as const, text: snapshotText(params.agent, before, "它正在跑，这条消息**没有**发出去——先看它的状态。") }],
          details: { agent: params.agent, conversationCreated: false, timedOut: false, skipped: "target_running", ...before },
        };
      }

      const timeoutMs = params.timeoutMs ?? ASK_DEFAULT_TIMEOUT_MS;
      const turn = runTurn(peer.conversation.agentId, sessionId, params.message);
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<"timeout">((resolve) => { timer = setTimeout(() => resolve("timeout"), timeoutMs); });
      let timedOut = false;
      try {
        const outcome = await Promise.race([turn.then(() => "done" as const), timeout]);
        timedOut = outcome === "timeout";
      } finally {
        if (timer !== undefined) clearTimeout(timer);
      }
      // 不管超时还是跑完，都返回**状态快照**（超时不是失败：02-design §L2）。
      const snapshot = await peerSnapshot(peer.conversation.agentId, sessionId, taskId);
      const hint = timedOut
        ? `等了 ${Math.round(timeoutMs / 1000)}s 它还没结束（对方回合仍在跑，**没有**取消）`
        : undefined;
      return {
        content: [{ type: "text" as const, text: snapshotText(params.agent, snapshot, hint) }],
        details: { agent: params.agent, conversationCreated: peer.conversation.created, timedOut, ...snapshot },
      };
    },
  });

  const send = defineTool({
    name: "lifeos_send",
    label: "Hand work to another Life OS agent (does not wait)",
    description:
      "Hand a task to another Life OS agent and return immediately; this turn ends and the other agent keeps working "
      + "in its own session (visible in the session list). "
      + "When it finishes, a completion message is delivered INTO THIS conversation automatically — do not poll or sleep. "
      + "Conversations are reused per (task, agent), exactly like lifeos_ask; pass newSession:true for a fresh one.",
    promptSnippet: "Hand work to another agent without waiting; its completion comes back into this conversation",
    promptGuidelines: [
      "After lifeos_send, tell the user what you handed off and to whom — do not claim the work is done.",
      "Never sleep or poll for the result in the same turn; the completion arrives as a message in this conversation.",
    ],
    parameters: Type.Object({
      agent: Type.String({ description: "Target Life OS agent id (e.g. 'coder')." }),
      message: Type.String({ description: "The task, with everything the other agent needs to start." }),
      sessionId: Type.Optional(Type.String({ description: "Continue this specific conversation. Omit to continue the most recent one for the current task." })),
      newSession: Type.Optional(Type.Boolean({ description: "Start a NEW conversation with this agent instead of continuing the current task's one." })),
    }),
    async execute(_toolCallId, params) {
      const taskId = currentTaskId();
      const resolved = await resolvePeer(ctx.agentId, params.agent);
      if (!resolved.ok) throw new Error(peerErrorText(resolved.code, params.agent));
      const peer = await peerConversation(ctx.agentId, params.agent, ctx.projectId, resolveHome(), {
        ...(taskId !== undefined ? { taskId } : {}),
        ...(params.sessionId !== undefined ? { sessionId: params.sessionId } : {}),
        ...(params.newSession === true ? { newSession: true } : {}),
      });
      if (!peer.ok) throw new Error(peerErrorText(peer.code, params.agent, peer.available, params.sessionId));
      const { sessionId } = peer.conversation;
      namePeerSession(await getSession(peer.conversation.agentId, sessionId, resolveHome()), resolved.name);

      // 登记回流（T7）：这轮结束后把完成消息送进**本会话**。先登记再投递——投递可能在同一个 tick 里结束。
      const initiatorSessionId = ctx.sessionId;
      if (initiatorSessionId !== undefined) {
        registerPendingPeer(peer.conversation.agentId, sessionId, {
          initiatorAgentId: ctx.agentId,
          initiatorSessionId,
          peerName: resolved.name,
          ...(taskId !== undefined ? { initiatorTaskId: taskId } : {}),
          projectId: ctx.projectId,
        });
      }

      // 重入守卫（T8）：目标正在跑 → 用 Pi 原生的 followUp 排队（不自造队列、不并发 prompt）。
      const before = await peerSnapshot(peer.conversation.agentId, sessionId, taskId);
      const queued = before.state === "running";
      if (queued) {
        // Pi 原生排队：会话在跑时 prompt() 会抛错（agent-session.ts:2103），必须走 followUp。
        const verdict = await queueSessionInput(peer.conversation.agentId, sessionId, params.message, "followUp");
        if ("code" in verdict && verdict.code !== "session_idle") {
          throw new Error(`Could not queue the message for ${params.agent}: ${verdict.code === "error" ? verdict.message : verdict.code}`);
        }
      }
      else void runTurn(peer.conversation.agentId, sessionId, params.message);

      return {
        content: [{
          type: "text" as const,
          text: `Handed off to ${params.agent} (session ${sessionId})${queued ? " — it was already running, so the message is queued after its current turn" : ""}. `
            + "Its completion will be delivered into this conversation; do not poll.",
        }],
        details: {
          agent: params.agent, sessionId, conversationCreated: peer.conversation.created, queued,
          completionWillArriveIn: initiatorSessionId ?? null,
          ...(taskId !== undefined ? { taskId } : {}),
        },
      };
    },
  });

  const agentList = defineTool({
    name: "lifeos_agent_list",
    label: "List Life OS agents",
    description:
      "List the Life OS agents you can talk to (id, name, description, archived). "
      + "Use it before lifeos_ask / lifeos_send when you are not sure the target id exists.",
    promptSnippet: "List the Life OS agents (id + name) you can message",
    promptGuidelines: ["Use the `id` field as the `agent` argument of lifeos_ask / lifeos_send, not the display name."],
    parameters: Type.Object({}),
    async execute() {
      const items = await listPeerAgents(ctx.agentId);
      const lines = items.map((item) =>
        `- ${item.id} — ${item.name}${item.archived ? " (archived)" : ""}${item.description !== undefined ? `：${item.description}` : ""}`);
      return {
        content: [{ type: "text" as const, text: lines.length > 0 ? `Agents you can message (use the id):\n${lines.join("\n")}` : "No other agents exist yet." }],
        details: { items },
      };
    },
  });

  const askList = defineTool({
    name: "lifeos_ask_list",
    label: "List your peer conversations",
    description:
      "List the conversations you already have with other agents. "
      + "Shows sessionId, peer id/name, the task that owns the lane, message count, last activity and whether it is running. "
      + "Use it to find the sessionId to continue a specific conversation, or to see what you already discussed.",
    promptSnippet: "List your existing agent-to-agent conversations (with sessionIds)",
    promptGuidelines: ["Pass `agent` to narrow to one target; pass `includeAllTasks` to see conversations started from other tasks too."],
    parameters: Type.Object({
      agent: Type.Optional(Type.String({ description: "Only list conversations with this agent id." })),
      includeAllTasks: Type.Optional(Type.Boolean({ description: "Include conversations started from other tasks (default: only the current task's lane)." })),
    }),
    async execute(_toolCallId, params) {
      const taskId = currentTaskId();
      const targets = params.agent !== undefined
        ? [{ id: params.agent, name: params.agent }]
        : (await listPeerAgents(ctx.agentId)).map((item) => ({ id: item.id, name: item.name }));
      const rows: Array<Record<string, unknown>> = [];
      const lines: string[] = [];
      for (const target of targets) {
        const sessions = await listPeerSessions(ctx.agentId, target.id, ctx.projectId);
        for (const entry of sessions) {
          const laneTask = entry.marker.initiatorTaskId;
          const sameLane = laneTask === undefined || taskId === undefined || laneTask === taskId;
          if (params.includeAllTasks !== true && !sameLane) continue;
          const title = await peerSessionTitle(target.id, entry.sessionId);
          rows.push({
            sessionId: entry.sessionId, peerAgentId: target.id, peerName: target.name,
            initiatorTaskId: laneTask ?? null, title: title ?? null, messages: entry.messages,
            updatedAt: new Date(entry.updatedAtMs).toISOString(), running: entry.running, sameLane,
          });
          lines.push(
            `- ${entry.sessionId} · ${target.name}${laneTask !== undefined ? ` · task ${laneTask}` : ""}`
            + `${title !== undefined ? ` · ${title}` : ""} · ${entry.messages} msgs${entry.running ? " · running" : ""}`);
        }
      }
      return {
        content: [{
          type: "text" as const,
          text: lines.length > 0
            ? `Your peer conversations${params.includeAllTasks === true ? " (all tasks)" : ` (task ${taskId ?? "(none)"})`}:\n${lines.join("\n")}`
            : "No peer conversations for this selection yet.",
        }],
        details: { items: rows },
      };
    },
  });

  return [create, remove, taskCreate, taskList, taskEnter, projectAdd, projectRemove, projectList, memorySearch, memoryRecord, memoryDelete, ask, send, agentList, askList];
}
