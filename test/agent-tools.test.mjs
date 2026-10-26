// Life OS 自有工具的离线测试（不经过模型）：直接调 execute，看它把 ~/.lifeos 建成什么样。
// 依据：pi/packages/coding-agent/docs/extensions.md §Tools（throw = 失败结果；content + details 必填）。
import { test } from "node:test";
import { subscribeBus } from "../src/events.ts";
import assert from "node:assert/strict";
import { mkdtemp, readFile, access, stat, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installHome } from "../src/home.ts";

const rejects = async (promise, message) => { await promise.then(() => assert.fail(message), () => undefined); };
import { LIFEOS_TOOL_NAMES, createAgentTools } from "../src/agent-tools.ts";

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

  // 骨架（全部在 agent 私有层；不写用户目录）
  await access(join(home, "agents", id, "agent.json"));
  await access(join(home, "agents", id, "identity.md"));
  await rejects(access(join(home, "agents", id, "projects", "workspace", "project.json")), "绑定目录不写 project.json（协议 §5.3）");
  await access(join(home, "agents", id, "projects", "workspace", "tasks", "0001-default", "daily"));
  await access(join(home, "agents", id, "projects", "workspace", "cases"));
  await access(join(home, "agents", id, "projects", "workspace", "todo"));
  await access(join(home, "agents", id, "projects", "workspace", "flywheel.md"));
  await access(join(home, "agents", id, "tools"));
  await access(join(home, "agents", id, "memory"));
  await stat(join(home, "agents", id, "projects", "workspace", "tasks", "0001-default", "daily")).then((info) => assert.equal(info.mode & 0o777, 0o700));
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
  assert.match(workspaceGuide, /Agent × 项目/, "说明来自协议骨架模板（layer-project）");
  assert.match(workspaceGuide, /默认项目/, "说明里讲清楚默认项目的作用");

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
  await access(join(home, "agents", a.details.id, "projects", "workspace", "tasks", "0001-default", "daily"));

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
  // 0001 是出厂默认 Task（协议 §6.1），用户下达的 Task 从 0002 起
  assert.equal(first.details.number, 2);
  assert.equal(first.details.id, "0002", "Task ID 是四位编号");
  const dir = join(home, "agents", "lifeosagent", "projects", "workspace", "tasks", "0002-删除已注册根");
  for (const file of ["task.md", "01-background.md", "02-design.md", "03-phase.md", "04-plan.md", "log.md", "AGENTS.md", "concept-space.md", "flywheel.md"]) await access(join(dir, file));
  await access(join(dir, "phases"));
  const taskMd = await readFile(join(dir, "task.md"), "utf8");
  assert.match(taskMd, /类型：development/, "任务类型自动填");
  assert.match(taskMd, /类别：A 改产品行为/);
  assert.match(taskMd, /状态：进行中/);
  assert.match(taskMd, /^ID: 0002$/m, "task.md 写 ID");
  assert.match(taskMd, /负责人：lifeosagent/);
  assert.match(taskMd, /目标：删除已注册根/, "goal 没给时先用 title");
  assert.match(taskMd, /## 本任务遵守/, "引用规范区块");
  assert.match(taskMd, /interaction-harness\/protocol\.md/);
  assert.match(taskMd, /Agent × 项目规范/, "指向本层规范");
  assert.match(taskMd, /类型规则：.*task-types/, "指向类型规则");
  assert.doesNotMatch(taskMd, /specs\/code\/frontend\/code\.md/, "workspace 项目没有 code specs → 入口不该列不存在的文件（协议 §12.1 不写不存在路径）");

  // 编号递增；B/C 类别只生成各自的必需文档
  const second = await taskCreate.execute("t2", { title: "改协作规范", category: "B", goal: "规范里写清任务编号" });
  assert.equal(second.details.id, "0003");
  const bDir = join(home, "agents", "lifeosagent", "projects", "workspace", "tasks", "0003-改协作规范");
  await access(join(bDir, "01-background.md"));
  await access(join(bDir, "02-plan.md"));
  await access(join(bDir, "02-design.md")).then(() => assert.fail("B 类不该有 02-design")).catch(() => {});
  assert.match(await readFile(join(bDir, "task.md"), "utf8"), /目标：规范里写清任务编号/);

  const third = await taskCreate.execute("t3", { title: "只出结论", category: "C" });
  const cDir = join(home, "agents", "lifeosagent", "projects", "workspace", "tasks", "0004-只出结论");
  await access(join(cDir, "01-background.md"));
  await access(join(cDir, "02-plan.md")).then(() => assert.fail("C 类不该有 02-plan")).catch(() => {});
  assert.equal(third.details.number, 4);

  // 非法输入
  await assert.rejects(() => taskCreate.execute("x", { title: "  ", category: "A" }), /title 不能为空/);
  await assert.rejects(() => taskCreate.execute("x", { title: "t", category: "D" }), /category 必须是/);
});

test("lifeos_task_list：按编号列出任务的状态/类别/目标", async () => {
  await freshHome();
  const [, , taskCreate, taskList] = createAgentTools({ agentId: "lifeosagent", projectId: "workspace" });
  // 出厂默认 Task（0001-default）已经在列表里（协议 §6.1）
  const empty = await taskList.execute("l0", {});
  assert.match(empty.content[0].text, /^0001 · daily\/D 日常/m);

  await taskCreate.execute("t1", { title: "第二个", category: "B" });
  await taskCreate.execute("t2", { title: "第一个", category: "A", goal: "可验收的目标" });
  const listed = await taskList.execute("l1", {});
  assert.equal(listed.details.tasks.length, 3);
  assert.deepEqual(listed.details.tasks.map((task) => task.number), [1, 2, 3], "按编号排序");
  assert.equal(listed.details.tasks[2].goal, "可验收的目标");
  assert.match(listed.content[0].text, /^0003 · development\/A 改产品行为 · 进行中 · 可验收的目标/m);
});

test("lifeos_project_add / list / remove：绑定、幂等、移除后不再列出、数据保留、默认项目不可移除", async () => {
  const home = await freshHome();
  // 闭环在写实现里广播（src/projects.ts）：这里订阅事件流来断言，而不是让工具自己 notify
  const events = [];
  const bus = subscribeBus({
    id: "agent-tools-test",
    offer: (event) => { if (event.type === "agents_changed") events.push(event); return true; },
    overflowed: () => undefined,
  });
  bus.ready();
  const unsubscribe = () => bus.close();
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
  assert.equal(created.details.number, 2, "0001 是默认 Task");
  const dir = created.details.path;
  const taskMd = await readFile(join(dir, "task.md"), "utf8");
  assert.match(taskMd, /类型：general/);
  assert.match(taskMd, /类别：G 普通任务/);
  assert.match(taskMd, /必需文档：01-background\.md · 02-plan\.md/);
  assert.match(taskMd, /类型规则：.*task-types\/general\/AGENTS\.md/, "引用对应类型的规则");
  const entries = (await readdir(dir)).sort();
  for (const file of ["task.md", "01-background.md", "02-plan.md", "AGENTS.md", "concept-space.md", "flywheel.md"]) assert.ok(entries.includes(file), file);
  assert.equal(entries.includes("log.md"), false, "普通类型没有 log.md（类型决定日志）");
  assert.equal(entries.includes("phases"), false, "普通任务不建 phases/");

  const listed = await taskList.execute("g2", {});
  assert.match(listed.content[0].text, /general\/G 普通任务/, "列表要带类型");

  await assert.rejects(taskCreate.execute("g3", { title: "错配", type: "general", category: "A" }), /类型 general 的 category 必须是 G/);
  await assert.rejects(taskCreate.execute("g4", { title: "错配", type: "development", category: "G" }), /类型 development 的 category 必须是 A \/ B \/ C/);
});

test("lifeos_task_create：general 任务重新读取后 type 字段保留（listTasks 解析 task.md）", async () => {
  await freshHome();
  const [, , taskCreate, taskList] = createAgentTools({ agentId: "lifeosagent", projectId: "workspace" });
  await taskCreate.execute("h1", { title: "环境维护", type: "general", category: "G" });
  const listed = await taskList.execute("h2", {});
  assert.match(listed.content[0].text, /^0002 · general\/G 普通任务 · 进行中 · 环境维护/m);
});
test("troubleshooting 类型：A/B/C 三类别合法；daily 在手动 createTask 被拒绝", async () => {
  const home = await freshHome();
  const ctx = { agentId: "lifeosagent", projectId: "workspace" };
  const [, , taskCreate] = createAgentTools({ ...ctx, onEnterTask: () => undefined });

  // troubleshooting 可以通过手动创建
  const a = await taskCreate.execute("tA", { title: "定位一类问题", type: "troubleshooting", category: "A" });
  assert.ok(!("code" in a), "A 类别合法");
  const b = await taskCreate.execute("tB", { title: "修一个小 bug", type: "troubleshooting", category: "B" });
  assert.ok(!("code" in b), "B 类别合法");
  const c = await taskCreate.execute("tC", { title: "查到一个架构层问题", type: "troubleshooting", category: "C" });
  assert.ok(!("code" in c), "C 类别合法");

  // daily 类型仍然是系统保留
  await assert.rejects(taskCreate.execute("tD", { title: "不受支持", type: "daily", category: "D" }), /daily 是系统保留/);
});

test("troubleshooting 自动带 evidence/（过程证据）与类型规则，不带 daily/", async () => {
  const home = process.env.LIFEOS_HOME;
  const { createTask } = await import("../src/tasks.ts");
  const res = await createTask({ agentId: "lifeosagent", projectId: "workspace" }, { title: "证据目录", type: "troubleshooting", category: "B" });
  assert.ok(!("code" in res));
  const dir = join(home, "agents", "lifeosagent", "projects", "workspace", "tasks", res.task.dirName);
  assert.ok((await stat(join(dir, "evidence", "AGENTS.md"))).isFile(), "evidence/ 必须自动创建并带说明文件");
  await assert.rejects(stat(join(dir, "daily")), undefined, "非日常类型不应有 daily/");
});

test("troubleshooting 类型：task.md 遵守区块内容正确", async () => {
  const home = process.env.LIFEOS_HOME;
  const { createTask } = await import("../src/tasks.ts");
  // 在 workspace（没有 code specs 的项目）建 troubleshooting B：task.md 里不写 code specs 路径（不出现幻觉路径）
  const res = await createTask({ agentId: "lifeosagent", projectId: "workspace" }, { title: "fix-bug", type: "troubleshooting", category: "B" });
  if ("code" in res) { assert.fail(`troubleshooting B 合法`); }
  const taskPath2 = join(home, "agents", "lifeosagent", "projects", "workspace", "tasks", res.task.dirName, "task.md");
  const taskFile2 = await readFile(taskPath2, "utf8");
  assert.match(taskFile2, /类型：troubleshooting/);
  assert.match(taskFile2, /类别：B 直接修/);
  assert.doesNotMatch(taskFile2, /specs\/code\/frontend\/code\.md/);  // workspace 没有 code specs，不列
  const taskMd = taskFile2; // shared ref
  assert.ok(taskFile2.includes("类型规则："), "有类型规则引用（troubleshooting 类型规则）");
});

test("lifeos_task_enter：按编号进入已有 Task（含完整目录名），未知编号报错", async () => {
  const { installHome } = await import("../src/home.ts");
  const { mkdtemp } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const home = await mkdtemp(join(tmpdir(), "lifeos-tools-"));
  await installHome(process.cwd(), home);
  process.env.LIFEOS_HOME = home;
  try {
    const entered = [];
    const tools = createAgentTools({ agentId: "lifeosagent", projectId: "workspace", onEnterTask: (taskId) => { entered.push(taskId); } });
    const enter = tools.find((tool) => tool.name === "lifeos_task_enter");
    assert.ok(enter !== undefined, "必须注册 lifeos_task_enter");
    const create = tools.find((tool) => tool.name === "lifeos_task_create");
    const created = await run(create, { title: "enter-probe", type: "general", category: "G" });
    const id = created.details.id;
    entered.length = 0;

    // 只给编号
    const byId = await run(enter, { taskId: id });
    assert.deepEqual(entered, [id]);
    assert.match(byId.content[0].text, new RegExp(`Now working in task ${id}`));
    // 完整目录名也认
    entered.length = 0;
    await run(enter, { taskId: `${id}-enter-probe` });
    assert.deepEqual(entered, [id]);
    // 未知编号：报错，且不改指针
    entered.length = 0;
    await assert.rejects(async () => await run(enter, { taskId: "9999" }), /No task 9999/);
    assert.deepEqual(entered, []);
  } finally { await import("node:fs/promises").then(({ rm }) => rm(home, { recursive: true, force: true })); }
});
