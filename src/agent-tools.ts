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

/** Life OS 自有工具名（与内置 8 工具一起显式钉进 allowlist，见 agent-host.ts · ALL_TOOL_NAMES）。 */
export const LIFEOS_TOOL_NAMES = [
  "lifeos_agent_create", "lifeos_agent_delete",
  "lifeos_task_create", "lifeos_task_list",
  "lifeos_project_add", "lifeos_project_remove", "lifeos_project_list",
  "lifeos_memory_search", "lifeos_memory_record", "lifeos_memory_delete",
] as const;

/** 工具要绑定"当前会话是谁、在哪个项目"——都由会话自身推导，模型不用传（也不会传错）。 */
export type ToolContext = {
  agentId: string;
  projectId: string;
  /** 进入一个 Task（建 Task 即进入它）：由宿主把会话指针指向它，下一轮装配生效。 */
  onEnterTask?: (taskId: string) => void;
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
      ctx.onEnterTask?.(task.id);
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
        details: { project: result.project, created: result.created },
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

  return [create, remove, taskCreate, taskList, projectAdd, projectRemove, projectList, memorySearch, memoryRecord, memoryDelete];
}
