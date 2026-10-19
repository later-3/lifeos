// Life OS 自有工具（Pi 生态内实现：defineTool + createAgentSession({ customTools })，
// 不自己造工具系统——文档依据：pi/packages/coding-agent/docs/extensions.md §Tools）。
//
// 两个工具都只是"薄封装"：真正的动作在 src/agents.ts（创建 / 归档），与 HTTP 接口共用同一份实现。
// 名字必须加进 createAgentSession 的 tools allowlist（那是白名单："When provided, only matching
// tools are enabled"），否则注册了也调不到。
import { Type } from "@earendil-works/pi-ai";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { archiveAgent, createAgent } from "./agents.ts";

/** 与内置 8 工具一起显式钉进 allowlist（见 agent-host.ts · ALL_TOOL_NAMES）。 */
export const AGENT_TOOL_NAMES = ["lifeos_agent_create", "lifeos_agent_delete"] as const;

export function createAgentTools() {
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

  return [create, remove];
}
