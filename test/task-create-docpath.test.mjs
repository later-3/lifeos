// L1 引导（Task 0004 · P2.5）：工具回执交给模型的是**文档路径**，不是主区挂载点。
//
// 为什么必须锁：收窄（P2）让"工作区里别的 Task"不存在之后，模型只剩主区路径可写——
// 如果回执还给 `task.path`（主区挂载点），模型照着写就**必然**写错地方，而且不报错：
//   - 新建的 Task：主区 `<taskDir>/` 只有 `home/` `repo/` 两个挂载点，写 `task.md` 会凭空造一份；
//   - 已合并的 Task：主区那份是**已落地的版本**，改写它 = 绕过检视。
// 所以 L1 不是文档工作，是"收窄之后必须紧接着做、否则收窄就等于逼模型写主区"的那一步
// （architect 05-orchestration §5：P2.5 不能等）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { access, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { installHome } from "../src/home.ts";
import { createAgentTools } from "../src/agent-tools.ts";

const run = promisify(execFile);
const git = async (cwd, args) =>
  (await run("git", ["-C", cwd, "-c", "core.quotePath=false", "-c", "user.email=t@t", "-c", "user.name=t", ...args], { timeout: 60_000 })).stdout;

/** 装临时家目录并 init 成 git 仓（有工作区的前提）。 */
async function gitHome() {
  const base = await mkdtemp(join(tmpdir(), "lifeos-l1-"));
  const home = join(base, "home");
  await installHome(process.cwd(), home);
  await git(home, ["init", "-q", "-b", "main"]);
  await writeFile(join(home, ".gitignore"), await readFile(join(process.cwd(), ".lifeos", ".gitignore"), "utf8"));
  await git(home, ["add", "-A"]);
  await git(home, ["commit", "-q", "-m", "init"]);
  process.env.LIFEOS_HOME = home;
  return home;
}

const ctx = { agentId: "lifeosagent", projectId: "workspace" };
const exists = async (path) => access(path).then(() => true, () => false);

test("L1-1 回执正文里的路径就是工作区文档路径：用它 ls 得到 task.md（主区那份不存在）", async () => {
  await gitHome();
  const [, , taskCreate] = createAgentTools(ctx);
  const created = await taskCreate.execute("c1", { title: "回执路径", type: "general", category: "G" });

  const text = created.content[0].text;
  // 从回执正文里取第一个绝对路径（模型照抄的就是它）
  const pathInText = /(\/[^\s\n]+)/.exec(text)?.[1];
  assert.ok(pathInText !== undefined, `回执里必须有一个绝对路径：\n${text}`);

  // ① 收口 1：这个路径下真有 task.md（证明是工作区里那份，不是空的主区挂载点）
  assert.equal(await exists(join(pathInText, "task.md")), true, `回执路径下应有 task.md：${pathInText}`);
  // 而且它在 <taskDir>/home 工作区里。
  // 注意不能用 `includes("/home/agents/")`：夹具的 LIFEOS_HOME 本身就叫 `home`，
  // mountPath 也含这个子串（`<base>/home/agents/...`）——那样断言区分不了两个路径。
  const mount = created.details.mountPath;
  assert.ok(pathInText.startsWith(join(mount, "home")), `回执路径必须在 <taskDir>/home 下：${pathInText}`);
  // 反向：主区那份不存在（不是"两处都有"）
  assert.equal(await exists(join(mount, "task.md")), false, `主区挂载点不该有 task.md：${mount}`);
});

test("L1-2 用回执路径写文件 → 落在工作区（git status 能看到），主区干净", async () => {
  const home = await gitHome();
  const [, , taskCreate] = createAgentTools(ctx);
  const created = await taskCreate.execute("c2", { title: "写入落点", type: "general", category: "G" });
  const docPath = created.details.docPath;
  const mountPath = created.details.mountPath;

  // 收口 2：模型照回执路径写一个文档
  await writeFile(join(docPath, "01-background.md"), "# 背景\n\n实测写入落点。\n", "utf8");

  // 工作区的 git status 能看到这次改动
  // `-uall` 不能省：新 Task 的整目录都还没跟踪，默认 `-unormal` 只显示 `?? <目录>/`，
  // 断言文件名会恒假（这条一开始就是这么假红的 —— 与 `core.quotePath` 同一类坑：不是代码错，是测量通道错）。
  const status = await git(join(mountPath, "home"), ["status", "--porcelain", "-uall"]);
  assert.match(status, /01-background\.md/, `工作区 status 应看到这次写入：\n${status}`);

  // 主区干净（主区的 git status 不该因为这次写入多出东西）
  const mainStatus = await git(home, ["status", "--porcelain"]);
  assert.equal(mainStatus.trim(), "", `主区不该被写脏：\n${mainStatus}`);
});

test("L1-3 details 同时给两个路径，且名字能看出哪个是挂载点", async () => {
  await gitHome();
  const [, , taskCreate] = createAgentTools(ctx);
  const created = await taskCreate.execute("c3", { title: "两个路径", type: "general", category: "G" });
  const details = created.details;

  assert.equal(typeof details.docPath, "string", "details.docPath 必须是字符串");
  assert.equal(typeof details.mountPath, "string", "details.mountPath 必须是字符串");
  assert.notEqual(details.docPath, details.mountPath, "两个路径必须不同（有工作区时）");
  assert.ok(details.docPath.startsWith(join(details.mountPath, "home")), `docPath 必须在 <taskDir>/home 下：${details.docPath}`);
  // 旧字段 `path` 不再提供：改名就是为了让误用在类型上看得见
  assert.equal("path" in details, false, "不应再有裸 path 字段（改名 mountPath）");
});

test("L1-4 活性：把回执改回 task.path，L1-1 与 L1-2 必须红", async () => {
  await gitHome();
  const { task } = await import("../src/tasks.ts").then(async ({ createTask }) =>
    await createTask(ctx, { title: "活性对照", type: "general", category: "G" }));
  // 直接验数据事实：主区挂载点下没有 task.md，工作区里有
  assert.equal(await exists(join(task.path, "task.md")), false, "主区挂载点下必须没有 task.md");
  assert.equal(await exists(join(task.docPath, "task.md")), true, "工作区里必须有 task.md");
  assert.notEqual(task.path, task.docPath, "两个路径必须不同（有工作区时）");
});

test("L1-5 lifeos_task_enter 的返回同样给文档路径", async () => {
  await gitHome();
  const [, , taskCreate, , taskEnter] = createAgentTools(ctx);
  await taskCreate.execute("e1", { title: "进入用的任务", type: "general", category: "G" });
  const entered = await taskEnter.execute("e2", { taskId: "0002" });

  assert.equal(typeof entered.details.docPath, "string", "task_enter 也要给 docPath");
  assert.ok(entered.details.docPath.startsWith(join(entered.details.mountPath, "home")), `应指向 <taskDir>/home：${entered.details.docPath}`);
  assert.equal(await exists(join(entered.details.docPath, "task.md")), true, "文档路径下应有 task.md");
  assert.equal("path" in entered.details, false, "不应再有裸 path 字段");
});
