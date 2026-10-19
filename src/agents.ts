// Agent 生命周期：创建 / 归档（2026-10-19 用户拍板：先做创建与删除；删除 = 归档，可恢复；至少保留 1 个）。
// 工具（lifeos_agent_create / lifeos_agent_delete）与 HTTP 接口共用这一份实现
// （foundation §2：业务逻辑下沉模块，HTTP 层只是薄适配）。不自己造工具循环——工具由 Pi 承载。
//
// 事实（本文件是唯一写入点）：
// - 一个 Agent = 一个目录 `agents/<id>/`（目录名 = id = URL 那一段，slug 规则见 foundation §5.1）；
// - 创建 = 建目录 + agent.json + identity.md 骨架 + workspace 骨架（project.json / AGENTS.md / daily / cases / todo）；
//   **不写 defaultSessionId**（出厂预置会话只随 lifeosagent 模板，协议 §12.2）；不建 avatar/（自动头像按 id 推导）。
// - 归档 = agent.json 写 `archivedAt`：列表与详情都不再返回它，目录与会话/记录**全部保留**（可恢复：删掉该字段）。
// - 护栏：有会话正在跑 → 拒绝（同删除会话的 409）；非归档 Agent 只剩 1 个 → 拒绝（保留最后一个）。
import { mkdir, readFile, readdir, rm, stat, writeFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { resolveHome } from "./home.ts";

export type AgentRecord = { schemaVersion: 1; id: string; name: string; description?: string; defaultProjectId: string; archivedAt?: string };
export type AgentError = { code: string; message: string; status: 400 | 404 | 409 };

const agentsRoot = () => join(resolveHome(), "agents");
const agentDir = (id: string) => join(agentsRoot(), id);
const isSlug = (id: string) => /^[a-z0-9][a-z0-9-]{0,63}$/.test(id);

const readJson = async (path: string): Promise<Record<string, unknown> | undefined> =>
  readFile(path, "utf8").then((text) => JSON.parse(text) as Record<string, unknown>, () => undefined);

/** 写 JSON（原子替换 + 0600），目录按 0700 建。 */
async function writeJson(path: string, data: unknown): Promise<void> {
  const tmp = `${path}.tmp`;
  await writeFile(tmp, JSON.stringify(data, null, 2) + "\n", { encoding: "utf8", mode: 0o600 });
  await rename(tmp, path);
}

/** name → slug（目录名 / URL id）；中文等非 ASCII 名字转不出合法 slug 时退到 "agent-" 前缀。 */
export function slugify(name: string): string {
  const base = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);
  const id = base === "" ? "agent" : base;
  return isSlug(id) ? id : `agent-${id}`.slice(0, 64);
}

/** 扫描全部 Agent（含已归档：查重与"最后一个"判断都要看全量）。 */
async function allAgents(): Promise<Array<{ id: string; record: AgentRecord }>> {
  const entries = await readdir(agentsRoot(), { withFileTypes: true }).catch(() => []);
  const out: Array<{ id: string; record: AgentRecord }> = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const raw = await readJson(join(agentsRoot(), entry.name, "agent.json"));
    if (raw !== undefined && typeof raw.id === "string") out.push({ id: entry.name, record: raw as AgentRecord });
  }
  return out;
}

export type CreateAgentInput = { name: string; description?: string; identity?: string };

const identitySkeleton = (name: string) => `# ${name}

## 身份与职责

（这个 Agent 是谁、长期负责什么、不该做什么。）

## 人格与性格

（口吻、风格、与用户协作的边界。）
`;

const workspaceAgentsMd = `# 工作区（本 Agent 的默认项目）

- 会话、每日记录、案例、Todo 都落在本目录下，跟当前工作项目走。
- 交互 harness 的规则与资料在 ~/.lifeos/interaction-harness/（协议正文 protocol.md）。
`;

/** 创建一个 Agent（原子性：中途失败就删掉半成品目录）。 */
export async function createAgent(input: CreateAgentInput): Promise<
  { id: string; name: string; dir: string } | AgentError
> {
  const name = (input.name ?? "").trim();
  if (name === "") return { code: "invalid_name", message: "name 不能为空", status: 400 };
  const base = slugify(name);
  const existing = new Set((await allAgents()).map((entry) => entry.id));
  let id = base;
  for (let n = 2; existing.has(id); n += 1) id = `${base.slice(0, 58)}-${n}`;
  if (!isSlug(id)) return { code: "invalid_id", message: "无法从 name 生成合法 id", status: 400 };

  const dir = agentDir(id);
  try {
    if (await stat(dir).catch(() => undefined) !== undefined) {
      return { code: "id_taken", message: `目录已存在：${id}`, status: 400 };
    }
    await mkdir(join(dir, "projects", "workspace", "daily"), { recursive: true, mode: 0o700 });
    await mkdir(join(dir, "projects", "workspace", "cases"), { recursive: true, mode: 0o700 });
    await mkdir(join(dir, "projects", "workspace", "todo"), { recursive: true, mode: 0o700 });
    const record: AgentRecord = {
      schemaVersion: 1, id, name,
      ...(input.description !== undefined && input.description.trim() !== "" ? { description: input.description.trim() } : {}),
      defaultProjectId: "workspace",
    };
    await writeJson(join(dir, "agent.json"), record);
    await writeFile(join(dir, "identity.md"),
      input.identity !== undefined && input.identity.trim() !== "" ? input.identity.trim() : identitySkeleton(name),
      { encoding: "utf8", mode: 0o600 });
    const workspace = join(dir, "projects", "workspace");
    await writeJson(join(workspace, "project.json"), { schemaVersion: 1, id: "workspace", name: "工作区" });
    await writeFile(join(workspace, "AGENTS.md"), workspaceAgentsMd, { encoding: "utf8", mode: 0o600 });
    return { id, name, dir };
  } catch (error) {
    await rm(dir, { recursive: true, force: true }).catch(() => { /* 尽力回滚半成品 */ });
    return { code: "create_failed", message: error instanceof Error ? error.message : String(error), status: 400 };
  }
}

/** 归档一个 Agent（= "删除"，可恢复）：写 archivedAt，目录与数据全部保留。 */
export async function archiveAgent(id: string): Promise<{ archived: string } | AgentError> {
  if (!isSlug(id)) return { code: "not_found", message: "找不到这个 Agent", status: 404 };
  const path = join(agentDir(id), "agent.json");
  const raw = await readJson(path);
  if (raw === undefined || typeof raw.id !== "string") return { code: "not_found", message: "找不到这个 Agent", status: 404 };
  if (raw.archivedAt !== undefined) return { code: "not_found", message: "该 Agent 已归档", status: 404 };
  // 运行状态在 agent-host 里；动态引入只为避免 agent-host → agent-tools → agents 的静态循环
  const { snapshotOf } = await import("./agent-host.ts");
  if (snapshotOf(id).running.length > 0) return { code: "agent_running", message: "该 Agent 有会话正在运行，先等它结束", status: 409 };
  const alive = (await allAgents()).filter((entry) => entry.record.archivedAt === undefined);
  if (alive.length <= 1) return { code: "last_agent", message: "至少保留一个 Agent", status: 400 };
  await writeJson(path, { ...raw, archivedAt: new Date().toISOString() });
  return { archived: id };
}
