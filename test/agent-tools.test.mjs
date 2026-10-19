// Life OS 自有工具的离线测试（不经过模型）：直接调 execute，看它把 ~/.lifeos 建成什么样。
// 依据：pi/packages/coding-agent/docs/extensions.md §Tools（throw = 失败结果；content + details 必填）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, access, stat, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installHome } from "../src/home.ts";
import { AGENT_TOOL_NAMES, createAgentTools } from "../src/agent-tools.ts";

async function freshHome() {
  const home = await mkdtemp(join(tmpdir(), "lifeos-tools-"));
  await installHome(process.cwd(), home);
  process.env.LIFEOS_HOME = home;
  return home;
}

const run = async (tool, params) => await tool.execute("test-call", params);

test("工具定义：名字钉死、英文描述、参数 schema 齐全；删除工具带 destructive 标注", () => {
  const tools = createAgentTools();
  assert.deepEqual(tools.map((tool) => tool.name), [...AGENT_TOOL_NAMES]);
  for (const tool of tools) {
    assert.ok(tool.description.length > 60, `${tool.name} 描述要让模型知道能干什么`);
    assert.ok(typeof tool.promptSnippet === "string", `${tool.name} 要有 promptSnippet（进默认 prompt 的工具清单）`);
    assert.ok(tool.parameters !== undefined && typeof tool.execute === "function");
  }
  assert.equal(tools[1].annotations?.destructiveHint, true, "归档是破坏性动作，标注要让权限扩展能拦一道");
});

test("lifeos_agent_create：id 由 name 自动生成、骨架齐、不写预置会话、冲突加序号", async () => {
  const home = await freshHome();
  const [create] = createAgentTools();

  const result = await run(create, { name: "Code Reviewer", description: "评审助手" });
  const id = result.details.id;
  assert.equal(id, "code-reviewer", "英文名 → slug");
  assert.ok(result.content[0].text.includes(id), "结果文本要回报新 id");

  // 骨架（全部在 agent 私有层；不写用户目录、不建 avatar/sessions）
  await access(join(home, "agents", id, "agent.json"));
  await access(join(home, "agents", id, "identity.md"));
  await access(join(home, "agents", id, "projects", "workspace", "project.json"));
  await access(join(home, "agents", id, "projects", "workspace", "daily"));
  await access(join(home, "agents", id, "projects", "workspace", "cases"));
  await access(join(home, "agents", id, "projects", "workspace", "todo"));
  await stat(join(home, "agents", id, "projects", "workspace", "daily")).then((info) => assert.equal(info.mode & 0o777, 0o700));
  const record = JSON.parse(await readFile(join(home, "agents", id, "agent.json"), "utf8"));
  assert.equal(record.defaultProjectId, "workspace");
  assert.equal("defaultSessionId" in record, false, "预置会话只随出厂模板，新 Agent 不写");
  assert.equal(record.description, "评审助手");
  assert.equal("archivedAt" in record, false);

  // 同名再建 → 不冲突（序号后缀）；中文名 → 合法 slug
  const again = await run(create, { name: "Code Reviewer" });
  assert.equal(again.details.id, "code-reviewer-2");
  const zh = await run(create, { name: "评审助手" });
  assert.match(zh.details.id, /^[a-z0-9][a-z0-9-]{0,63}$/, `中文名也要得到合法 id：${zh.details.id}`);

  // 骨架 = 出厂模板同构（模板是「当前 Agent 包含啥」的唯一事实源；只差预置会话文件，协议 §12.2）
  const templateAgent = join(process.cwd(), ".lifeos", "agents", "lifeosagent");
  assert.deepEqual((await readdir(join(home, "agents", zh.details.id))).sort(), (await readdir(templateAgent)).sort(),
    "Agent 顶层与模板同构（agent.json / identity.md / projects）");
  assert.deepEqual(
    (await readdir(join(home, "agents", zh.details.id, "projects", "workspace"))).sort(),
    (await readdir(join(templateAgent, "projects", "workspace"))).sort(),
    "workspace 骨架与模板同构（AGENTS/concept-space/project/sessions/daily/cases/todo）");

  // identity.md：只有骨架（用户没批准过传身份内容的入口，见 C029）
  const skeleton = await readFile(join(home, "agents", zh.details.id, "identity.md"), "utf8");
  assert.match(skeleton, /## 身份与职责/, "identity.md 装骨架");
  assert.match(skeleton, /评审助手/, "骨架标题用 name");

  // 空 name → 失败（throw = 失败的工具结果）
  await assert.rejects(() => run(create, { name: "   " }), /name 不能为空/);
});

test("lifeos_agent_delete：归档可恢复、数据全留；最后一个与不存在的都拒绝", async () => {
  await freshHome();
  const [create, remove] = createAgentTools();

  const a = await run(create, { name: "A" });
  const b = await run(create, { name: "B" });
  const home = process.env.LIFEOS_HOME;

  const result = await run(remove, { id: a.details.id });
  assert.ok(result.content[0].text.includes(a.details.id));
  const record = JSON.parse(await readFile(join(home, "agents", a.details.id, "agent.json"), "utf8"));
  assert.ok(typeof record.archivedAt === "string", "归档 = 写 archivedAt（可恢复）");
  // 数据全留：identity、workspace 记录目录都还在
  await access(join(home, "agents", a.details.id, "identity.md"));
  await access(join(home, "agents", a.details.id, "projects", "workspace", "daily"));

  // 重复归档 → 失败
  await assert.rejects(() => run(remove, { id: a.details.id }), /已归档/);
  // 不存在 → 失败
  await assert.rejects(() => run(remove, { id: "no-such-agent" }), /找不到/);

  // 归档 B：还剩 lifeosagent 1 个 → 允许（把最后一个也归档才拦）
  await run(remove, { id: b.details.id });
  // 最后一个（出厂 lifeosagent）→ 拒绝
  await assert.rejects(() => run(remove, { id: "lifeosagent" }), /至少保留一个/);
  const last = JSON.parse(await readFile(join(home, "agents", "lifeosagent", "agent.json"), "utf8"));
  assert.equal("archivedAt" in last, false, "拒绝时不留半写状态");
  // 其余全是归档状态（isAlive 口径：只有 lifeosagent 一个）
  const recordB = JSON.parse(await readFile(join(home, "agents", b.details.id, "agent.json"), "utf8"));
  assert.ok(typeof recordB.archivedAt === "string");
});
