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
import { randomBytes } from "node:crypto";
import { mkdir, readFile, readdir, rm, stat, writeFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { resolveHome } from "./home.ts";
import { broadcast } from "./events.ts";
import { runningOf } from "./session-runtime.ts";
import { ensureProjectSkeleton } from "./project-skeleton.ts";

/** agent.json 的唯一形状（读/写共用；旧的 boundProjectIds 读到就清掉，不再写回）。 */
export type AgentDefinition = {
  schemaVersion?: 1;
  id: string;
  name: string;
  description?: string;
  defaultProjectId?: string;
  defaultSessionId?: string;
  hiddenProjectIds?: string[];
  archivedAt?: string;
};
export type AgentRecord = AgentDefinition;
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

/**
 * name → slug（目录名 / URL id）。
 * 中文等非 ASCII 名字转不出合法 slug 时，用**不透明的随机后缀**（`agent-3f9a`）：
 * 参照 Kubernetes `metadata.generateName`（名字 + 随机后缀，id 不承载语义）——
 * 不要生成 `agent` 这种过通用的 id（发生过：模型嫌它通用，自行归档重建，留下重复实体）。
 */
export function slugify(name: string): string {
  const base = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);
  const id = base === "" ? `agent-${randomBytes(2).toString("hex")}` : base;
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

export type CreateAgentInput = { name: string; description?: string };

// 与模板 identity.md 同构（标题结构照搬；正文留给用户/Agent 填，不复制 Life Agent 的个人内容）
const identitySkeleton = (name: string) => `# ${name}

（一句话：这个 Agent 是谁、长期负责什么。）

## 身份

- 名称：${name}
- 角色：（待填）

## 人格

- （待填：口吻、风格、协作边界。）
`;

// 与出厂模板同构（模板 = 当前 Agent 结构的唯一事实源）：concept-space.md 的开头也照模板写。
const workspaceConceptSpace = `# 概念空间（workspace 项目层 · 索引）

规则同通用层（协议 §3.2 / §4）：一词一义、先定义再使用、索引与正文分开。
本层只收**本项目特有**的词；通用词在 \`~/.lifeos/interaction-harness/concept-space/\`，不在此重复。

| 编号 | 词 | 一句话 | 正文 |
|---|---|---|---|
`;

// 与模板 workspace/AGENTS.md 同源（那是通用的项目私有层指引，不含个人内容）；
// 唯一适配：模板"出厂默认会话预置于此"只对出厂 Agent 成立 → 改为"出厂预置只随出厂模板"。
const workspaceAgentsMd = `# 交互 harness · 项目私有层（workspace）

这里是 Agent 默认工作区（内置第一个 project）的指引。**以协议正文为准**：
\`~/.lifeos/interaction-harness/protocol.md\`（尤其 §12 会话、开场与项目私有骨架）。本文件只写本目录的规矩。

- \`sessions/\` 会话（见协议 §12.1；出厂预置的默认会话只随出厂模板）
- \`tasks/\` 任务根（已预建；任务目录 \`<NNNN>-<标题>/\` 按需创建，不预建；日期写在 task.md 字段）
- \`specs/\` 本层规范（按主题分目录；\`index.json\` 索引）
- \`daily/\` 每日记录（按日期分文件，追加，不改写历史）
- \`cases/\` 正例与反例（按日期分文件，编号引用，不改写历史）
- \`todo/\` 一句话待办（不是任务；升级为任务时建 \`tasks/<NNNN>-<标题>/\`）
- \`concept-space.md\` 本项目词索引：先建词条、再用词（协议 §4 自举）

通用层（协议、飞轮、通用概念、任务类型）在 \`~/.lifeos/interaction-harness/\`；
本目录只放**本项目**内容，不复制通用正文（协议 §6 不复制）。
`;

/** 创建一个 Agent（原子性：中途失败就删掉半成品目录）。 */
export async function createAgent(input: CreateAgentInput): Promise<
  { id: string; name: string; dir: string; created: boolean } | AgentError
> {
  // 与 PUT /api/agents/:id 校验一致（不要多不要少）：name 非空截 60、description 截 300
  const name = (input.name ?? "").trim().slice(0, 60);
  if (name === "") return { code: "invalid_name", message: "name 不能为空", status: 400 };
  const description = input.description !== undefined ? input.description.trim().slice(0, 300) : undefined;
  // 按 name 幂等（create-or-return）：同名且未归档 → 直接返回已有的，不再造第二个实体。
  // 参照声明式创建的通行做法（kubectl apply / Terraform：name 是唯一键，重复调用不改结果）——
  // 工具被模型调用时会重试，非幂等就会留下重复 Agent（真实发生过）。
  const live = (await allAgents()).find((entry) => entry.record.archivedAt === undefined && entry.record.name === name);
  if (live !== undefined) {
    return { id: live.id, name: live.record.name, dir: agentDir(live.id), created: false };
  }
  const base = slugify(name);
  const existing = new Set((await allAgents()).map((entry) => entry.id));
  let id = base;
  for (let n = 2; existing.has(id); n += 1) id = `${base.slice(0, 58)}-${n}`;
  if (!isSlug(id)) return { code: "invalid_id", message: "无法从 name 生成合法 id", status: 400 };

  const dir = agentDir(id);
  try {
    try {
      await mkdir(dir, { mode: 0o700 });                    // 非递归：目录已存在就报错（recursive 会静默复用别人目录）
    } catch (error) {
      if (await stat(dir).catch(() => undefined) !== undefined) {
        return { code: "id_taken", message: `目录已存在：${id}`, status: 400 };
      }
      throw error;                                          // 其它错误：外层 catch 回滚半成品
    }
    // workspace 骨架 = 出厂模板同构（agent.json / identity.md / AGENTS.md / concept-space.md /
    // project.json / sessions / daily / cases / todo / memory / tasks），只差"预置会话文件"
    // （协议 §12.2：只随出厂模板）
    const record: AgentRecord = {
      schemaVersion: 1, id, name,
      ...(description !== undefined && description !== "" ? { description } : {}),
      defaultProjectId: "workspace",
    };
    await writeJson(join(dir, "agent.json"), record);
    // identity.md = Agent 结构的一部分，**只装骨架**（用户没批准过"传身份内容"的入口——见 C029）
    await writeFile(join(dir, "identity.md"), identitySkeleton(name), { encoding: "utf8", mode: 0o600 });
    const workspace = join(dir, "projects", "workspace");
    await mkdir(workspace, { recursive: true, mode: 0o700 });
    await writeJson(join(workspace, "project.json"), { schemaVersion: 1, id: "workspace", name: "工作区" });
    await writeFile(join(workspace, "AGENTS.md"), workspaceAgentsMd, { encoding: "utf8", mode: 0o600 });
    await writeFile(join(workspace, "concept-space.md"), workspaceConceptSpace, { encoding: "utf8", mode: 0o600 });
    await ensureProjectSkeleton(workspace, { name: "工作区", path: workspace });
    // 写操作必须闭环到 UI（用户 2026-10-19 点名）：在**共享写实现**里广播，工具/HTTP 两条入口都自动生效
    broadcast({ type: "agents_changed" });
    return { id, name, dir, created: true };
  } catch (error) {
    await rm(dir, { recursive: true, force: true }).catch(() => { /* 尽力回滚半成品 */ });
    return { code: "create_failed", message: error instanceof Error ? error.message : String(error), status: 400 };
  }
}

/** 读 agent.json（不存在/损坏 → undefined）；旧设计遗留字段顺手清掉（一次性、幂等）。 */
export async function readAgent(id: string): Promise<AgentDefinition | undefined> {
  const raw = await readJson(join(agentDir(id), "agent.json"));
  if (raw === undefined || typeof raw.id !== "string") return undefined;
  const { boundProjectIds: legacy, ...clean } = raw as Record<string, unknown> & { boundProjectIds?: unknown };
  if (legacy !== undefined) await writeAgent(clean as AgentDefinition);
  return clean as AgentDefinition;
}

/** 写回 agent.json（改名/项目列表变更等）：原子替换、0600；顺手剥掉旧设计残留字段。 */
export async function writeAgent(agent: AgentDefinition): Promise<void> {
  const { boundProjectIds: _legacy, ...clean } = agent as AgentDefinition & { boundProjectIds?: unknown };
  const path = join(agentDir(agent.id), "agent.json");
  const tmp = `${path}.tmp`;
  await writeFile(tmp, JSON.stringify(clean, null, 2) + "\n", { encoding: "utf8", mode: 0o600 });
  await rename(tmp, path);
}

/** 归档一个 Agent（= "删除"，可恢复）：写 archivedAt，目录与数据全部保留。 */
export async function archiveAgent(id: string): Promise<{ archived: string } | AgentError> {
  if (!isSlug(id)) return { code: "not_found", message: "找不到这个 Agent", status: 404 };
  const path = join(agentDir(id), "agent.json");
  const raw = await readJson(path);
  if (raw === undefined || typeof raw.id !== "string") return { code: "not_found", message: "找不到这个 Agent", status: 404 };
  if (raw.archivedAt !== undefined) return { code: "not_found", message: "该 Agent 已归档", status: 404 };
  if (runningOf(id).length > 0) return { code: "agent_running", message: "该 Agent 有会话正在运行，先等它结束", status: 409 };
  const alive = (await allAgents()).filter((entry) => entry.record.archivedAt === undefined);
  if (alive.length <= 1) return { code: "last_agent", message: "至少保留一个 Agent", status: 400 };
  await writeJson(path, { ...raw, archivedAt: new Date().toISOString() });
  broadcast({ type: "agents_changed" });
  return { archived: id };
}
