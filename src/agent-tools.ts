// Life OS 自有工具（Pi 生态内实现：defineTool + createAgentSession({ customTools })，
// 不自己造工具系统——文档依据：pi/packages/coding-agent/docs/extensions.md §Tools）。
//
// 两个工具都只是"薄封装"：真正的动作在 src/agents.ts（创建 / 归档），与 HTTP 接口共用同一份实现。
// 名字必须加进 createAgentSession 的 tools allowlist（那是白名单："When provided, only matching
// tools are enabled"），否则注册了也调不到。
import { Type } from "@earendil-works/pi-ai";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { archiveAgent, createAgent } from "./agents.ts";
import { createTask, listTasks, type TaskCategory } from "./tasks.ts";
import { bindProject, listAgentProjects, unbindProject } from "./projects.ts";

/** Life OS 自有工具名（与内置 8 工具一起显式钉进 allowlist，见 agent-host.ts · ALL_TOOL_NAMES）。 */
export const LIFEOS_TOOL_NAMES = [
  "lifeos_agent_create", "lifeos_agent_delete",
  "lifeos_task_create", "lifeos_task_list",
  "lifeos_project_add", "lifeos_project_remove", "lifeos_project_list",
] as const;

/** 工具要绑定"当前会话是谁、在哪个项目"——都由会话自身推导，模型不用传（也不会传错）。 */
export type ToolContext = { agentId: string; projectId: string };

export function createAgentTools(ctx: ToolContext) {
  const create = defineTool({
    name: "lifeos_agent_create",
    label: "Create Life OS agent",
    description:
      "Create a new Life OS agent (a long-lived assistant with its own identity, workspace project, daily/cases/todo records and sessions). "
      + "The id is generated once and stays stable — renaming the display name never changes it, so never archive and recreate an agent just to change an id. "
      + "Creating with an existing agent name returns that agent unchanged (no duplicates). Non-ASCII names get an opaque id such as agent-3f9a; that is expected. "
      + "The agent gets its standard skeleton (agent.json, identity.md, workspace project with AGENTS.md/concept-space.md/sessions/daily/cases/todo). "
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
            + `Files: ${result.dir}/agent.json · identity.md (skeleton) · projects/workspace/{project.json,AGENTS.md,concept-space.md,sessions,daily,cases,todo}\n`
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
      "Create a numbered task for the current project: a task directory with task.md (single source of truth) and the required documents for its type/category. "
      + "Type development: category A changes product behavior (01-background, 02-design, 03-phase, 04-plan, phases/), B changes collaboration rules (01-background, 02-plan), C only produces a conclusion (01-background). "
      + "Type general: a normal task that is neither product nor collaboration work (errands, research, one-off operations) — category G, only 01-background + 02-plan (background + simple steps). "
      + "task.md also records which harness rules and project guides the task must follow; fill in referenced cases afterwards.",
    promptSnippet: "Create a numbered task (development A/B/C or general G) with task.md + required docs",
    promptGuidelines: [
      "Use lifeos_task_create when the user asks for real work (a requirement, a fix, a review, or a normal task to track) — then fill 01-background with facts before planning.",
      "Pick type=general only when the task changes neither product behavior nor collaboration rules; otherwise use development with A/B/C.",
      "Keep task.md as the single place for status; update 当前指针 as you go.",
    ],
    parameters: Type.Object({
      title: Type.String({ description: "Task title, e.g. '文件面板：删除已注册根'. Chinese is fine; it becomes the directory name." }),
      type: Type.Optional(Type.Union([Type.Literal("development"), Type.Literal("general")], {
        description: "development (default) for product/collaboration/conclusion work; general for a normal task that is neither (background + simple steps).",
      })),
      category: Type.Union([Type.Literal("A"), Type.Literal("B"), Type.Literal("C"), Type.Literal("G")], {
        description: "development: A = changes product behavior, B = changes collaboration rules, C = conclusion only. general: G (only value).",
      }),
      goal: Type.Optional(Type.String({ description: "One-line verifiable goal. Defaults to the title; editable later." })),
    }),
    async execute(_toolCallId, params) {
      const result = await createTask(ctx, {
        title: params.title,
        ...(params.type !== undefined ? { type: params.type } : {}),
        category: params.category as TaskCategory,
        ...(params.goal !== undefined ? { goal: params.goal } : {}),
      });
      if ("code" in result) throw new Error(result.message);
      const task = result.task;
      const files = task.docs ?? [];
      return {
        content: [{
          type: "text" as const,
          text: `Created task ${task.id} (${task.type} · ${task.category}) at ${task.path}\n`
            + `Files: task.md${files.length > 0 ? ` · ${files.join(" · ")}` : ""}${task.category.startsWith("A") ? " · phases/" : ""}\n`
            + `Next: fill 01-background with current facts and the acceptance criteria, then the plan.`,
        }],
        details: { id: task.id, number: task.number, path: task.path },
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

  return [create, remove, taskCreate, taskList, projectAdd, projectRemove, projectList];
}
