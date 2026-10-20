// Life OS 自有工具的离线测试（不经过模型）：直接调 execute，看它把 ~/.lifeos 建成什么样。
// 依据：pi/packages/coding-agent/docs/extensions.md §Tools（throw = 失败结果；content + details 必填）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, access, stat, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installHome } from "../src/home.ts";
import { LIFEOS_TOOL_NAMES, createAgentTools } from "../src/agent-tools.ts";
import { subscribeAgent } from "../src/agent-host.ts";

async function freshHome() {
  const home = await mkdtemp(join(tmpdir(), "lifeos-tools-"));
  await installHome(process.cwd(), home);
  process.env.LIFEOS_HOME = home;
  return home;
}

const run = async (tool, params) => await tool.execute("test-call", params);

test("工具定义：名字钉死、英文描述、参数 schema 齐全；删除工具带 destructive 标注", () => {
  const tools = createAgentTools({ agentId: "lifeosagent", projectId: "workspace" });
  assert.deepEqual(tools.map((tool) => tool.name), [...LIFEOS_TOOL_NAMES]);
  for (const tool of tools) {
    assert.ok(tool.description.length > 60, `${tool.name} 描述要让模型知道能干什么`);
    assert.ok(typeof tool.promptSnippet === "string", `${tool.name} 要有 promptSnippet（进默认 prompt 的工具清单）`);
    assert.ok(tool.parameters !== undefined && typeof tool.execute === "function");
  }
  assert.equal(tools[1].annotations?.destructiveHint, true, "归档是破坏性动作，标注要让权限扩展能拦一道");
  const projectRemove = tools.find((tool) => tool.name === "lifeos_project_remove");
  assert.equal(projectRemove.annotations?.destructiveHint, true, "从列表移除要标注（可能被误当删除）");
  assert.equal(projectRemove.annotations?.idempotentHint, true, "重复移除同一个项目是幂等的");
  const memoryRecord = tools.find((tool) => tool.name === "lifeos_memory_record");
  assert.ok(memoryRecord.description.includes("scope is REQUIRED"), "记忆写入必须说明 scope 必填");
  const memoryDelete = tools.find((tool) => tool.name === "lifeos_memory_delete");
  assert.equal(memoryDelete.annotations?.destructiveHint, true, "硬删除要标注");
  assert.ok(memoryDelete.description.includes("irreversible"), "描述写明不可恢复");
});

test("lifeos_agent_create：id 由 name 生成（中文名 agent-xxxx）、骨架齐、同名幂等", async () => {
  const home = await freshHome();
  const [create] = createAgentTools({ agentId: "lifeosagent", projectId: "workspace" });

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

  // 同名再建 → 幂等（create-or-return）：返回同一个 Agent，不造第二个实体
  const again = await run(create, { name: "Code Reviewer" });
  assert.equal(again.details.id, id, "同名幂等：返回已有 Agent 的 id");
  assert.equal(again.details.created, false, "同名时 created=false");
  assert.match(again.content[0].text, /already exists/, "结果要告诉模型：已存在、没有新建");
  assert.equal((await readdir(join(home, "agents"))).filter((n) => n.startsWith("code-reviewer")).length, 1, "磁盘上只有一个目录");

  // 中文名 → 不透明随机后缀（agent-xxxx），不再是过通用的 "agent"（Kubernetes generateName 同款）
  const zh = await run(create, { name: "评审助手" });
  assert.match(zh.details.id, /^agent-[0-9a-f]{4}$/, `中文名应得到 agent-xxxx，实际 ${zh.details.id}`);

  // 骨架 = 出厂模板同构（模板是「当前 Agent 包含啥」的唯一事实源；只差预置会话文件，协议 §12.2）
  const templateAgent = join(process.cwd(), ".lifeos", "agents", "lifeosagent");
  assert.deepEqual((await readdir(join(home, "agents", zh.details.id))).sort(), (await readdir(templateAgent)).sort(),
    "Agent 顶层与模板同构（agent.json / identity.md / projects）");
  assert.deepEqual(
    (await readdir(join(home, "agents", zh.details.id, "projects", "workspace"))).sort(),
    (await readdir(join(templateAgent, "projects", "workspace"))).sort(),
    "workspace 骨架与模板同构（AGENTS/concept-space/project/sessions/tasks/daily/cases/todo/memory）");

  // identity.md：只有骨架，且标题结构与模板同构（## 身份 / ## 人格）
  const skeleton = await readFile(join(home, "agents", zh.details.id, "identity.md"), "utf8");
  assert.match(skeleton, /^# 评审助手/, "骨架标题用 name");
  assert.match(skeleton, /## 身份/, "标题结构与模板同构：身份");
  assert.match(skeleton, /## 人格/, "标题结构与模板同构：人格");
  assert.match(skeleton, /- 名称：评审助手/, "身份节含名称");

  // workspace/AGENTS.md：与模板同源的项目私有层指引（不是我发明的三行），且不写"出厂预置会话"这种不成立的话
  const workspaceGuide = await readFile(join(home, "agents", zh.details.id, "projects", "workspace", "AGENTS.md"), "utf8");
  assert.match(workspaceGuide, /以协议正文为准/, "指引与模板同源（含协议指向）");
  assert.match(workspaceGuide, /不复制通用正文/, "指引与模板同源（含不复制原则）");
  assert.equal(workspaceGuide.includes("出厂默认会话预置于此"), false, "新 Agent 没有预置会话，模板那半句不照抄");

  // 校验与 PUT 一致：name 截 60、description 截 300
  const long = await run(create, { name: "x".repeat(80), description: "d".repeat(500) });
  const longRecord = JSON.parse(await readFile(join(home, "agents", long.details.id, "agent.json"), "utf8"));
  assert.equal(longRecord.name.length, 60, "name 与 PUT 一致截 60");
  assert.equal(longRecord.description.length, 300, "description 与 PUT 一致截 300");

  // 空 name → 失败（throw = 失败的工具结果）
  await assert.rejects(() => run(create, { name: "   " }), /name 不能为空/);
});

test("lifeos_agent_delete：归档可恢复、数据全留；最后一个与不存在的都拒绝", async () => {
  await freshHome();
  const [create, remove] = createAgentTools({ agentId: "lifeosagent", projectId: "workspace" });

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


test("lifeos_task_create：编号连续、中文标题、按类别生成文档、task.md 是唯一状态源", async () => {
  const home = await freshHome();
  const [, , taskCreate] = createAgentTools({ agentId: "lifeosagent", projectId: "workspace" });

  const first = await taskCreate.execute("t1", { title: "删除已注册根", category: "A" });
  assert.equal(first.details.number, 1);
  assert.equal(first.details.id, "0001-删除已注册根", "编号 + 中文标题（用户会翻文件系统）");
  const dir = join(home, "agents", "lifeosagent", "projects", "workspace", "tasks", "0001-删除已注册根");
  for (const file of ["task.md", "01-background.md", "02-design.md", "03-phase.md", "04-plan.md"]) await access(join(dir, file));
  await access(join(dir, "phases"));
  const taskMd = await readFile(join(dir, "task.md"), "utf8");
  assert.match(taskMd, /类型：development/, "任务类型自动填");
  assert.match(taskMd, /类别：A 改产品行为/);
  assert.match(taskMd, /状态：进行中/);
  assert.match(taskMd, /负责人：lifeosagent/);
  assert.match(taskMd, /目标：删除已注册根/, "goal 没给时先用 title");
  assert.match(taskMd, /## 本任务遵守/, "引用规范区块");
  assert.match(taskMd, /interaction-harness\/protocol\.md/);
  assert.match(taskMd, /本项目指引/, "指向项目私有层 AGENTS.md");
  assert.match(taskMd, /## 引用的案例/, "案例位留给模型补");

  // 编号递增；B/C 类别只生成各自的必需文档
  const second = await taskCreate.execute("t2", { title: "改协作规范", category: "B", goal: "规范里写清任务编号" });
  assert.equal(second.details.id, "0002-改协作规范");
  const bDir = join(home, "agents", "lifeosagent", "projects", "workspace", "tasks", "0002-改协作规范");
  await access(join(bDir, "01-background.md"));
  await access(join(bDir, "02-plan.md"));
  await access(join(bDir, "02-design.md")).then(() => assert.fail("B 类不该有 02-design")).catch(() => {});
  assert.match(await readFile(join(bDir, "task.md"), "utf8"), /目标：规范里写清任务编号/);

  const third = await taskCreate.execute("t3", { title: "只出结论", category: "C" });
  const cDir = join(home, "agents", "lifeosagent", "projects", "workspace", "tasks", "0003-只出结论");
  await access(join(cDir, "01-background.md"));
  await access(join(cDir, "02-plan.md")).then(() => assert.fail("C 类不该有 02-plan")).catch(() => {});
  assert.equal(third.details.number, 3);

  // 非法输入
  await assert.rejects(() => taskCreate.execute("x", { title: "  ", category: "A" }), /title 不能为空/);
  await assert.rejects(() => taskCreate.execute("x", { title: "t", category: "D" }), /category 必须是/);
});

test("lifeos_task_list：按编号列出任务的状态/类别/目标", async () => {
  await freshHome();
  const [, , taskCreate, taskList] = createAgentTools({ agentId: "lifeosagent", projectId: "workspace" });
  const empty = await taskList.execute("l0", {});
  assert.match(empty.content[0].text, /No tasks/);

  await taskCreate.execute("t1", { title: "第二个", category: "B" });
  await taskCreate.execute("t2", { title: "第一个", category: "A", goal: "可验收的目标" });
  const listed = await taskList.execute("l1", {});
  assert.equal(listed.details.tasks.length, 2);
  assert.deepEqual(listed.details.tasks.map((task) => task.number), [1, 2], "按编号排序");
  assert.equal(listed.details.tasks[1].goal, "可验收的目标");
  assert.match(listed.content[0].text, /0002-第一个/);
});

test("lifeos_project_add / list / remove：绑定、幂等、移除后不再列出、数据保留、默认项目不可移除", async () => {
  const home = await freshHome();
  // 闭环在写实现里广播（src/projects.ts）：这里订阅事件流来断言，而不是让工具自己 notify
  const events = [];
  const unsubscribe = subscribeAgent("lifeosagent", 0, (event) => { if (event.type === "agents_changed") events.push(event); });
  const tools = createAgentTools({ agentId: "lifeosagent", projectId: "workspace" });
  const tool = (name) => tools.find((item) => item.name === name);
  const dir = await mkdtemp(join(tmpdir(), "lifeos-proj-"));

  const added = await run(tool("lifeos_project_add"), { path: dir });
  const id = added.details.project.id;
  assert.equal(added.details.created, true);
  assert.equal(added.details.project.path, dir);
  assert.deepEqual(await readdir(dir), [], "不往用户的目录里写任何东西");
  assert.equal(events.length, 1, "写操作在共享实现里广播（界面自动刷新）");

  const again = await run(tool("lifeos_project_add"), { path: dir });
  assert.equal(again.details.created, false, "同一路径幂等");
  assert.equal(again.details.project.id, id);
  assert.equal(events.length, 1, "幂等重复添加不广播");

  const list = await run(tool("lifeos_project_list"), {});
  assert.ok(list.details.projects.some((project) => project.id === id), "列表里要能看到新项目");
  assert.ok(list.details.projects.some((project) => project.id === "workspace" && project.isDefault), "workspace 是默认项目");

  await run(tool("lifeos_project_remove"), { id });
  assert.equal(events.length, 2, "移除要广播");
  const after = await run(tool("lifeos_project_list"), {});
  assert.ok(!after.details.projects.some((project) => project.id === id), "移除后不再列出");
  assert.ok((await stat(join(home, "agents", "lifeosagent", "projects", id))).isDirectory(), "目录与数据要保留");

  const back = await run(tool("lifeos_project_add"), { path: dir });
  assert.equal(back.details.created, false, "重新添加同一路径 = 复用并重新出现");
  assert.equal(events.length, 3, "重新出现 = 真的变了，要广播");
  assert.ok((await run(tool("lifeos_project_list"), {})).details.projects.some((project) => project.id === id));

  await assert.rejects(run(tool("lifeos_project_remove"), { id: "workspace" }), /默认项目不可解绑/);
  await assert.rejects(run(tool("lifeos_project_remove"), { id: "nope" }), /没有这个项目/);
  await assert.rejects(run(tool("lifeos_project_add"), { path: join(dir, "nope") }), /目录不存在/);
  assert.equal(events.length, 3, "失败/无变化不广播");
  unsubscribe();
  void home;
});

test("lifeos_task_create：普通任务（general/G）只生成背景+步骤，不建 phases/；类型与类别必须匹配", async () => {
  await freshHome();
  const [, , taskCreate, taskList] = createAgentTools({ agentId: "lifeosagent", projectId: "workspace" });

  const created = await taskCreate.execute("g1", { title: "整理资料", type: "general", category: "G" });
  assert.equal(created.details.number, 1);
  const dir = created.details.path;
  const taskMd = await readFile(join(dir, "task.md"), "utf8");
  assert.match(taskMd, /类型：general/);
  assert.match(taskMd, /类别：G 普通任务/);
  assert.match(taskMd, /必需文档：01-background\.md · 02-plan\.md/);
  assert.match(taskMd, /任务类型细则：.*task-types\/general\/TEMPLATE\.md/, "引用对应类型的细则");
  assert.deepEqual((await readdir(dir)).sort(), ["01-background.md", "02-plan.md", "task.md"], "普通任务只有两份文档 + task.md");
  assert.deepEqual((await readdir(join(dir, "01-background.md")).catch(() => null)), null);

  const listed = await taskList.execute("g2", {});
  assert.match(listed.content[0].text, /general\/G 普通任务/, "列表要带类型");

  await assert.rejects(taskCreate.execute("g3", { title: "错配", type: "general", category: "A" }), /普通任务（general）的 category 必须是 G/);
  await assert.rejects(taskCreate.execute("g4", { title: "错配", type: "development", category: "G" }), /开发任务（development）的 category 必须是 A \/ B \/ C/);
});

test("lifeos_task_create：general 任务重新读取后 type 字段保留（listTasks 解析 task.md）", async () => {
  await freshHome();
  const [, , taskCreate, taskList] = createAgentTools({ agentId: "lifeosagent", projectId: "workspace" });
  await taskCreate.execute("h1", { title: "环境维护", type: "general", category: "G" });
  const listed = await taskList.execute("h2", {});
  assert.match(listed.content[0].text, /^0001-[^ ]* · general\/G 普通任务 · 进行中 · 环境维护/m);
});
