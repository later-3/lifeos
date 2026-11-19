// 结构校验必须跟得上 Task 工作区形态（协议 §3.7）：Task 的文档在工作区里，主区只有两个挂载点。
//
// 覆盖两个方向，两边都不能丢：
//   假阳性消失：工作区形态的 Task 不被判缺 task.md / 缺 AGENTS.md；home/、repo/、外部检出不被当协作层
//   真阳性保住：缺说明文件、缺骨架、共享层缺 project.json 仍然报
//
// 依据（2026-11-19 真实家目录实测，359 处错误里 265 处是假阳性）：
//   195 条来自旧式 worktree/ 被递归、24 条来自挂载点自身被要求说明文件、
//   42 条来自不穿透工作区、4 条来自把「必需文档」的人写批注当路径。
//
// 隔离：临时家目录（`specs/code/testing/testing.md` 2.1），绝不碰 ~/.lifeos。
import { test } from "node:test";
import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installHome } from "../src/home.ts";
import { checkHome } from "../src/home-check.ts";
import { createTask } from "../src/tasks.ts";

const ctx = { agentId: "lifeosagent", projectId: "workspace" };

async function freshHome() {
  const home = await mkdtemp(join(tmpdir(), "lifeos-hc-"));
  await installHome(process.cwd(), home);
  process.env.LIFEOS_HOME = home;
  return home;
}

/** 建成「工作区形态」：文档搬进 <taskDir>/home/agents/<a>/projects/<p>/tasks/<dir>/，主区只剩两个挂载点。 */
async function toWorktreeShape(home, task) {
  const { rm } = await import("node:fs/promises");
  const worktreeDoc = join(task.path, "home", "agents", ctx.agentId, "projects", ctx.projectId, "tasks", task.dirName);
  // 先抄到 Task 之外再挂进去：`cp` 不允许把目录抄进自己的子目录。
  const staging = await mkdtemp(join(tmpdir(), "lifeos-doc-"));
  await cp(task.path, staging, { recursive: true });
  await mkdir(worktreeDoc, { recursive: true });
  await cp(staging, worktreeDoc, { recursive: true });
  await rm(staging, { recursive: true, force: true });
  // 工作区是真 git worktree：`.git` 是文件、根上还有机器可读标记（协议 §3.7）
  await writeFile(join(task.path, "home", ".git"), "gitdir: /nowhere\n", "utf8");
  await writeFile(join(task.path, "home", ".lifeos-worktree.json"), JSON.stringify({ kind: "home", taskId: task.id }), "utf8");
  await mkdir(join(task.path, "repo"), { recursive: true });
  await writeFile(join(task.path, "repo", ".git"), "gitdir: /nowhere\n", "utf8");
  // 主区不再有文档（真实形态：`git worktree` 的检出不在主区）
  for (const name of ["task.md", "AGENTS.md", "concept-space.md", "flywheel.md", "specs", "cases", "knowledge", "tools", "todo"]) {
    await rm(join(task.path, name), { recursive: true, force: true });
  }
  return worktreeDoc;
}

const errorsOf = (report, needle) => report.errors.filter((line) => line.includes(needle));

test("T-A 工作区形态的 Task：不报缺 task.md、不报 Task 根缺 AGENTS.md、不报挂载点缺 AGENTS.md", async () => {
  const home = await freshHome();
  const created = await createTask(ctx, { title: "工作区形态", category: "G", type: "general" });
  assert.ok(!("code" in created), `createTask 失败：${JSON.stringify(created)}`);
  const task = created.task;
  await toWorktreeShape(home, task);

  const report = await checkHome(home);
  assert.deepEqual(errorsOf(report, `${task.dirName}/`).filter((line) => line.includes("缺少 task.md")), [], "工作区里有 task.md，不该判缺失");
  assert.deepEqual(errorsOf(report, `${task.dirName}/`), [], `工作区形态的 Task 不该有任何错误：\n${errorsOf(report, task.dirName).join("\n")}`);
  assert.deepEqual(errorsOf(report, `${task.dirName}/home/`), [], "home/ 是挂载点，不该要求说明文件");
  assert.deepEqual(errorsOf(report, `${task.dirName}/repo/`), [], "repo/ 是挂载点，不该要求说明文件");

  // 活性：工作区里的必需文档缺失时仍要报（穿透之后检查没有变成"什么都不查"）
  const { rm } = await import("node:fs/promises");
  const worktreeDoc = join(task.path, "home", "agents", ctx.agentId, "projects", ctx.projectId, "tasks", task.dirName);
  await rm(join(worktreeDoc, "tasks-placeholder"), { force: true });
  await rm(join(worktreeDoc, "flywheel.md"), { force: true });
  const after = await checkHome(home);
  assert.ok(errorsOf(after, task.dirName).some((line) => line.includes("flywheel.md")), "工作区里真缺 flywheel.md 时必须报：\n" + errorsOf(after, task.dirName).join("\n"));
});

test("T-B 外部检出不是协作层：无论叫什么名字（旧式 worktree/ 与带 .git 的其它名字）都不递归", async () => {
  const home = await freshHome();
  const created = await createTask(ctx, { title: "外部检出", category: "G", type: "general" });
  const task = created.task;

  // ① 历史形态：tasks/NNNN-x/worktree/（协议 §3.7「2026-11 之前创建的 Task 留在原状」）
  const legacy = join(task.path, "worktree");
  await mkdir(join(legacy, "dist"), { recursive: true });
  await writeFile(join(legacy, ".git"), "gitdir: /nowhere\n", "utf8");
  await writeFile(join(legacy, "dist", "index.js"), "module.exports = {};\n", "utf8");
  // ② 任何名字的检出（这里故意不用保留名，验证判据是结构而不是名单）
  const clone = join(task.path, "vendor-clone");
  await mkdir(join(clone, "packages", "ai", "src"), { recursive: true });
  await writeFile(join(clone, ".git"), "gitdir: /nowhere\n", "utf8");
  await writeFile(join(clone, "packages", "ai", "src", "index.ts"), "export {};\n", "utf8");

  const report = await checkHome(home);
  assert.deepEqual(errorsOf(report, "/worktree/"), [], "旧式 worktree/ 内部不该被检查：\n" + errorsOf(report, "/worktree/").join("\n"));
  assert.deepEqual(errorsOf(report, "/vendor-clone/"), [], "检出内部不该被检查：\n" + errorsOf(report, "/vendor-clone/").join("\n"));
  assert.deepEqual(errorsOf(report, `${task.dirName}/worktree/`), [], "worktree/ 自身也不该要求说明文件");
});

test("T-C 过程资料：evidence/ 自己要有说明文件（真阳性），内部不递归；必需文档在 evidence/ 时看两处", async () => {
  const home = await freshHome();
  const created = await createTask(ctx, { title: "过程证据", category: "G", type: "general" });
  const task = created.task;
  const evidence = join(task.path, "evidence");
  await mkdir(join(evidence, "screens"), { recursive: true });
  await writeFile(join(evidence, "screens", "a.png"), "x", "utf8");
  // 必需文档里点名 evidence/（合法写法：它的文件不进工作区，·只存在于主区）
  const taskMdPath = join(task.path, "task.md");
  const text = await readFile(taskMdPath, "utf8");
  await writeFile(taskMdPath, text.replace(/^必需文档：.*$/m, "必需文档：01-background.md · evidence/"), "utf8");

  const report = await checkHome(home);
  assert.ok(errorsOf(report, `${task.dirName}/evidence/`).some((line) => line.includes("缺少说明文件")), "evidence/ 缺说明文件必须报：\n" + report.errors.join("\n"));
  assert.deepEqual(errorsOf(report, `${task.dirName}/evidence/screens/`), [], "evidence/ 内部（screens/）不该被检查：\n" + report.errors.join("\n"));
  assert.deepEqual(errorsOf(report, "必需文档缺失"), [], "evidence/ 存在于主区，不该判必需文档缺失");

  // 补上说明文件后通过
  await writeFile(join(evidence, "AGENTS.md"), "# evidence\n\n过程证据。\n", "utf8");
  const after = await checkHome(home);
  assert.deepEqual(errorsOf(after, `${task.dirName}/evidence/`), [], "补上说明文件后不该再报");
});

test("T-C2 工作区形态下必需文档点名 evidence/：写在主区也算存在（不逼人把证据挪进工作区）", async () => {
  const home = await freshHome();
  const created = await createTask(ctx, { title: "证据在主区", category: "G", type: "general" });
  const task = created.task;
  // 文档树搬进工作区，但 evidence/ 只留在主区（真实形态：它不进版本控制）
  const worktreeDoc = await toWorktreeShape(home, task);
  const evidence = join(task.path, "evidence");
  await mkdir(join(evidence, "screens"), { recursive: true });
  await writeFile(join(evidence, "screens", "a.png"), "x", "utf8");
  await writeFile(join(evidence, "AGENTS.md"), "# evidence\n\n过程证据。\n", "utf8");
  // 工作区那份 task.md 点名 evidence/
  const taskMdPath = join(worktreeDoc, "task.md");
  const text = await readFile(taskMdPath, "utf8");
  await writeFile(taskMdPath, text.replace(/^必需文档：.*$/m, "必需文档：01-background.md · evidence/"), "utf8");

  const report = await checkHome(home);
  assert.deepEqual(errorsOf(report, "必需文档缺失"), [], "evidence/ 在主区也存在，不该判缺失：\n" + report.errors.join("\n"));
  // 活性：真删掉两边的 evidence 后必须报
  const { rm } = await import("node:fs/promises");
  await rm(evidence, { recursive: true, force: true });
  const after = await checkHome(home);
  assert.ok(errorsOf(after, "必需文档缺失").some((line) => line.includes("evidence")), "两边都没了必须报：\n" + after.errors.join("\n"));
});

test("T-D 真阳性不许被顺手关掉：缺骨架、共享层缺 project.json 仍然报", async () => {
  const home = await freshHome();
  const created = await createTask(ctx, { title: "骨架缺失", category: "G", type: "general" });
  const task = created.task;
  const { rm } = await import("node:fs/promises");
  await rm(join(task.path, "flywheel.md"), { force: true });
  await rm(join(task.path, "specs"), { recursive: true, force: true });
  // 共享层缺 project.json（真实家目录里 projects/longagentshare/ 的形态）
  await mkdir(join(home, "projects", "nosuchshare", "specs"), { recursive: true });

  const report = await checkHome(home);
  assert.ok(errorsOf(report, task.dirName).some((line) => line.includes("flywheel.md")), "缺 flywheel.md 必须报");
  assert.ok(errorsOf(report, task.dirName).some((line) => line.includes("specs/")), "缺 specs/ 必须报");
  assert.ok(errorsOf(report, "nosuchshare").some((line) => line.includes("project.json")), "共享层缺 project.json 必须报");
});

test("T-E 协议层目录的任意深子目录仍被要求说明文件（不许因为跳过名单而少查）", async () => {
  const home = await freshHome();
  const theme = join(home, "agents", ctx.agentId, "projects", "workspace", "specs", "some-theme");
  await mkdir(theme, { recursive: true });
  await writeFile(join(theme, "rule.md"), "# 规则\n", "utf8");
  const toolPart = join(home, "projects", "workspace", "tools", "some-tool", "workflows");
  await mkdir(toolPart, { recursive: true });

  const report = await checkHome(home);
  assert.ok(errorsOf(report, "specs/some-theme/").some((line) => line.includes("缺少说明文件")), "specs/<主题>/ 缺说明文件必须报");
  assert.ok(errorsOf(report, "some-tool/workflows/").some((line) => line.includes("缺少说明文件")), "tools/<工具>/<部件>/ 缺说明文件必须报");
});

test("T-F 必需文档里的人写批注不当路径：phases/（…）与 **08-x.md（…）** 都按文件名判定", async () => {
  const home = await freshHome();
  const created = await createTask(ctx, { title: "批注字段", category: "G", type: "general" });
  const task = created.task;
  await mkdir(join(task.path, "phases"), { recursive: true });
  await writeFile(join(task.path, "08-scope.md"), "# 范围\n", "utf8");
  const taskMdPath = join(task.path, "task.md");
  const text = await readFile(taskMdPath, "utf8");
  await writeFile(taskMdPath, text.replace(
    /^必需文档：.*$/m,
    "必需文档：01-background.md · phases/（P1/P2 已收口：phases/P2-panel.md）· 05-old.md（§3 已作废）· **08-scope.md（唯一工作清单）**",
  ), "utf8");
  await writeFile(join(task.path, "05-old.md"), "# 旧\n", "utf8");

  const report = await checkHome(home);
  assert.deepEqual(errorsOf(report, "必需文档缺失"), [], "带批注的必需文档都真实存在，不该报缺失：\n" + report.errors.join("\n"));
});
