// 协议全流程模拟（协议 §3.7、§6、§7、§9）：一个用户长期和 Agent 交互——
// 日常闲聊 → 开一个开发 Task → 切回日常 → 跨天 → 普通 Task → 新 Agent / 外部项目。
// 每一步都检查：装配只带当前 Task 的内容、其他 Task 的内容不进 prompt、家目录结构始终符合协议。
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, stat, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installHome } from "../src/home.ts";
import { checkHome } from "../src/home-check.ts";
import { buildPromptParts } from "../src/assembly.ts";
import { createSession, getSession, setSessionTask, deleteSession, ensureTurnShard } from "../src/agent-host.ts";
import { createTask, ensureDefaultTask, listTasks } from "../src/tasks.ts";
import { createAgent } from "../src/agents.ts";
import { createAgentTools } from "../src/agent-tools.ts";
import { registerProject } from "../src/projects.ts";

async function freshHome() {
  const home = await mkdtemp(join(tmpdir(), "lifeos-flow-"));
  await installHome(process.cwd(), home);
  process.env.LIFEOS_HOME = home;
  return home;
}

async function expectValid(home, step) {
  const report = await checkHome(home);
  assert.deepEqual(report.errors, [], `${step}：结构不符合协议\n${report.errors.join("\n")}`);
}

test("协议全流程模拟：日常 → 开发 Task → 切回日常 → 跨天 → 普通 Task，装配只带当前 Task", async () => {
  const home = await freshHome();
  const ctx = { agentId: "lifeosagent", projectId: "workspace" };
  const day1 = "2026-10-24";
  const day2 = "2026-10-25";

  // 第 1 天：用户随便聊，会话指向默认 Task（0001）
  const sessionId = await createSession("lifeosagent", home, "workspace");
  let state = await getSession("lifeosagent", sessionId, home);
  assert.equal(state?.taskId, "0001", "新会话指向默认 Task");
  const defaultTask = await ensureDefaultTask(ctx);
  const beforeAnyTurn = (await readdir(join(defaultTask.path, "daily"))).filter((name) => name !== "AGENTS.md");
  assert.deepEqual(beforeAnyTurn, [], "只是建会话、还没有交互：不建分片（没有交互的日子没有文件）");
  // 发起对话（一轮交互）：这一天的分片在这时才建
  const shard1 = await ensureTurnShard("lifeosagent", sessionId, day1);
  await writeFile(shard1.file, "# 2026-10-24\n\n- 闲聊：想先看文件面板的交互\nMARK-DAILY-DAY1\n");
  await expectValid(home, "第 1 天日常");

  // 用户："我们来做输入框优化" → 建开发 Task（0002），会话切过去
  const made = await createTask(ctx, { title: "流程探针任务", type: "development", category: "A", goal: "输入框历史与排队可验收" });
  assert.ok(!("code" in made));
  assert.equal(made.task.id, "0002");
  await writeFile(join(made.task.path, "log.md"), "# 日志\n\n- 读现状，MARK-LOG-TASK2\n");
  await writeFile(join(made.task.path, "cases", "2026-10-24.md"), "## C001（正例）MARK-CASE-TASK2\n");
  await writeFile(join(made.task.path, "flywheel.md"), "# 飞轮\n\n- MARK-FLY-TASK2\n");
  await expectValid(home, "建开发 Task 后");

  assert.equal((await setSessionTask("lifeosagent", sessionId, "0002")).ok, true);
  state = await getSession("lifeosagent", sessionId, home);
  assert.equal(state?.taskId, "0002", "指针切到开发 Task");
  let parts = await buildPromptParts("lifeosagent", "workspace", "0002");
  assert.match(parts.harnessSection, /当前 Task · 0002-流程探针任务\/AGENTS\.md/, "当前 Task 的说明进 prompt");
  assert.match(parts.harnessSection, /当前 Task · 0002-流程探针任务\/task\.md/, "当前 Task 的状态进 prompt");
  assert.match(parts.harnessSection, /任务类型规则 · development\/AGENTS\.md/, "开发类的类型规则进 prompt");
  assert.doesNotMatch(parts.harnessSection, /MARK-DAILY-DAY1/, "默认 Task 的日常分片不进开发 Task 的 prompt");
  assert.doesNotMatch(parts.harnessSection, /MARK-CASE-TASK2/, "案例正文不常驻 prompt（按需读取）");
  assert.doesNotMatch(parts.harnessSection, /MARK-FLY-TASK2/, "飞轮正文不常驻 prompt（按需读取）");
  assert.doesNotMatch(parts.harnessSection, /当前 Task · 0001-default/, "默认 Task 的说明不进开发 Task 的 prompt");
  assert.match(parts.harnessSection, /当前 Task 0002-流程探针任务：.*AGENTS\.md/, "说明文件索引列出当前 Task");

  // 用户："先回到闲聊" → 切回默认 Task：只带默认 Task 的说明，不带开发 Task 的内容
  await setSessionTask("lifeosagent", sessionId, "0001");
  parts = await buildPromptParts("lifeosagent", "workspace", "0001");
  assert.match(parts.harnessSection, /当前 Task · 0001-default\/AGENTS\.md/);
  assert.match(parts.harnessSection, /任务类型规则 · daily\/AGENTS\.md/);
  assert.doesNotMatch(parts.harnessSection, /流程探针任务/, "开发 Task 的内容不进默认 Task 的 prompt");
  assert.doesNotMatch(parts.harnessSection, /MARK-LOG-TASK2/);

  // 第 2 天：跨午夜。会话仍指向默认 Task；默认 Task 仍只有一个；新分片出现
  const shard2 = await ensureTurnShard("lifeosagent", sessionId, day2);
  assert.equal(shard2.file, join(defaultTask.path, "daily", `${day2}.md`), "跨天：新的一天写进新分片");
  await writeFile(shard2.file, "# 2026-10-25\n\n- 闲聊延续\n");
  const defaults = (await listTasks(ctx)).filter((task) => task.isDefault);
  assert.equal(defaults.length, 1, "默认 Task 只有一个");
  const shards = (await readdir(join(defaultTask.path, "daily"))).filter((name) => name !== "AGENTS.md").sort();
  assert.deepEqual(shards, [`${day1}.md`, `${day2}.md`], "只有发生交互的日子有分片，文件名 YYYY-MM-DD.md");
  assert.ok(shards.every((name) => /^\d{4}-\d{2}-\d{2}\.md$/.test(name)), "分片名都是日期");
  // 中间没有会话的那几天（day1 与 day2 之间）不会凭空出现分片：分片只跟交互走
  assert.equal(shards.length, 2);
  state = await getSession("lifeosagent", sessionId, home);
  assert.equal(state?.taskId, "0001", "会话指针不因跨天改变");
  await expectValid(home, "跨天之后");

  // 用户："整理一下资料" → 普通 Task（general，无 log.md，有共同结构）
  const general = await createTask(ctx, { title: "整理资料", type: "general", category: "G" });
  assert.ok(!("code" in general));
  assert.equal(general.task.id, "0003");
  await assert.rejects(stat(join(general.task.path, "log.md")), "普通类型没有 log.md");
  await expectValid(home, "普通 Task 之后");

  // 结束：删除会话历史不影响 Task 目录里的沉淀（协议 §7）
  await deleteSession("lifeosagent", sessionId);
  assert.match(await readFile(join(made.task.path, "log.md"), "utf8"), /MARK-LOG-TASK2/, "沉淀不随会话删除");
  assert.match(await readFile(shard1.file, "utf8"), /MARK-DAILY-DAY1/, "日常分片不随会话删除");
  await expectValid(home, "删除会话历史之后");
});

test("新 Agent 与外部项目：都带默认 Task，结构符合协议", async () => {
  const home = await freshHome();
  const created = await createAgent({ name: "研究员", description: "做资料整理" });
  assert.ok(!("code" in created), "创建 Agent");
  await expectValid(home, "新建 Agent 后");
  const defaults = await ensureDefaultTask({ agentId: created.id, projectId: "workspace" });
  assert.equal(defaults.id, "0001", "新 Agent 的默认 Task 是 0001");

  const dir = await mkdtemp(join(tmpdir(), "lifeos-flow-proj-"));
  const registered = await registerProject(created.id, dir);
  assert.ok(!("code" in registered), "绑定外部项目");
  const pid = registered.project.id;
  assert.equal((await ensureDefaultTask({ agentId: created.id, projectId: pid })).id, "0001", "外部项目也有自己的默认 Task");
  await expectValid(home, "绑定外部项目后");

  // 外部项目的身份在共享层，绑定目录只有结构（协议 §5.3）
  const identity = JSON.parse(await readFile(join(home, "projects", pid, "project.json"), "utf8"));
  assert.equal(identity.path, dir);
  await assert.rejects(stat(join(home, "agents", created.id, "projects", pid, "project.json")), "绑定目录没有 project.json");
  await mkdir(join(home, "agents", created.id, "projects", pid, "tasks", "0001-default", "daily"), { recursive: true }).catch(() => undefined);
});

test("类型开放、建 Task 即进入它、daily 保留（协议 §3.7、§7）", async () => {
  const home = await freshHome();
  const ctx = { agentId: "lifeosagent", projectId: "workspace" };
  const entered = [];
  const [, , taskCreate] = createAgentTools({ ...ctx, onEnterTask: (taskId) => entered.push(taskId) });

  // 没有合适的类型：拒绝，并指向"先讨论、再建模板"
  await assert.rejects(taskCreate.execute("n1", { title: "接口联调", type: "backend-api", category: "A" }), /没有合适的类型.*讨论/s);

  // 讨论后建新类型：只需要一个模板目录，不改代码
  const typeDir = join(home, "interaction-harness", "task-types", "backend-api");
  await mkdir(typeDir, { recursive: true });
  await writeFile(join(typeDir, "template.json"), JSON.stringify({
    schemaVersion: 1, type: "backend-api",
    categories: { S: { label: "S 服务端改动", docs: [{ file: "01-background.md", title: "01 背景", sections: ["现状", "验收"] }] } },
  }));
  await writeFile(join(typeDir, "AGENTS.md"), "# 服务端改动\n\n先写背景与验收。\n");
  const made = await taskCreate.execute("n2", { title: "接口联调", type: "backend-api", category: "S" });
  assert.equal(made.details.type, "backend-api");
  assert.deepEqual(entered, [made.details.id], "建 Task 即进入它（会话指针指向新 Task）");

  // daily 保留给默认 Task
  await assert.rejects(taskCreate.execute("n3", { title: "手动日常", type: "daily", category: "D" }), /daily 是系统保留/);

  // 装配：只带当前（新）Task 的类型规则，不带默认 Task 的
  const parts = await buildPromptParts("lifeosagent", "workspace", made.details.id);
  assert.match(parts.harnessSection, /任务类型规则 · backend-api\/AGENTS\.md/);
  assert.doesNotMatch(parts.harnessSection, /任务类型规则 · daily\//);
});

test("没有 Task 的 status 锁：标为已完成后，用户再问可以改回进行中（状态是记录）", async () => {
  const home = await freshHome();
  const ctx = { agentId: "lifeosagent", projectId: "workspace" };
  const made = await createTask(ctx, { title: "一次性整理", type: "general", category: "G" });
  const taskMd = join(made.task.path, "task.md");
  const { readFile: rf, writeFile: wf } = await import("node:fs/promises");
  await wf(taskMd, (await rf(taskMd, "utf8")).replace("状态：进行中", "状态：已完成"));
  // 完成后仍可以继续写、改回进行中，结构不受影响
  await wf(taskMd, (await rf(taskMd, "utf8")).replace("状态：已完成", "状态：进行中"));
  assert.match(await rf(taskMd, "utf8"), /状态：进行中/);
  await expectValid(home, "状态改来改去之后");
});
