// 家目录安装语义：模板整树复制；已有内容 → 只提醒不动；空目录视为可安装；占位文件不进家目录。
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readdir, readFile, writeFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installHome } from "../src/home.ts";
import { checkHome } from "../src/home-check.ts";

async function tempPath(prefix) {
  const base = await mkdtemp(join(tmpdir(), prefix));
  const target = join(base, "home");
  await access(target).catch(() => undefined);
  return target;
}

test("家目录不存在 → 从 .lifeos 模板整树复制并写收据", async () => {
  const home = await tempPath("lifeos-install-");
  const result = await installHome(process.cwd(), home);
  assert.equal(result.status, "installed");
  assert.ok(result.items.length > 0);
  for (const file of [
    "interaction-harness/protocol.md",
    "interaction-harness/AGENTS.md",
    "agents/lifeosagent/agent.json",
    "agents/lifeosagent/AGENTS.md",
    "agents/lifeosagent/projects/workspace/AGENTS.md",
    "agents/lifeosagent/projects/workspace/flywheel.md",
    "agents/lifeosagent/projects/workspace/concept-space.md",
    "agents/lifeosagent/projects/workspace/sessions",
    "agents/lifeosagent/projects/workspace/specs/index.json",
    "agents/lifeosagent/projects/workspace/tasks/0001-default/task.md",
    "agents/lifeosagent/projects/workspace/tasks/0001-default/daily/AGENTS.md",
    "agents/lifeosagent/projects/lifeos/tasks/0001-default/task.md",
    "projects/workspace/project.json",
    "projects/workspace/flywheel.md",
    "projects/workspace/specs/index.json",
    "projects/lifeos/project.json",
    "projects/lifeos/specs/index.json",
    "interaction-harness/skeleton/layer-project.md",
    "interaction-harness/task-types/daily/template.json",
    "install-receipt.json",
  ]) await access(join(home, file));
  // 顶层 projects 是共享层，必须随模板安装；logs/runtime 仍不建
  for (const gone of ["logs", "runtime"]) {
    await assert.rejects(access(join(home, gone)), "家目录不该建 " + gone + "/");
  }
  const receipt = JSON.parse(await readFile(join(home, "install-receipt.json"), "utf8"));
  assert.equal(receipt.schemaVersion, 1);
  assert.equal(receipt.template, ".lifeos");
  assert.ok(receipt.items.some((item) => item.path === "interaction-harness/protocol.md"));
});

test(".gitkeep 占位文件不复制进家目录", async () => {
  const home = await tempPath("lifeos-gitkeep-");
  await installHome(process.cwd(), home);
  const keepers = [];
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) await walk(join(dir, entry.name));
      else if (entry.name === ".gitkeep") keepers.push(join(dir, entry.name));
    }
  }
  await walk(home);
  assert.deepEqual(keepers, []);
});

test("家目录已有内容 → exists，且不改动任何文件", async () => {
  const home = await tempPath("lifeos-exists-");
  await mkdir(home, { recursive: true });
  const marker = join(home, "my-stuff.txt");
  await writeFile(marker, "用户数据");
  const result = await installHome(process.cwd(), home);
  assert.equal(result.status, "exists");
  assert.equal(await readFile(marker, "utf8"), "用户数据");
  await access(join(home, "install-receipt.json")).then(
    () => assert.fail("不应写入安装收据"),
    () => undefined,
  );
});

test("家目录存在但为空 → 视为可安装", async () => {
  const home = await tempPath("lifeos-empty-");
  await mkdir(home, { recursive: true });
  const result = await installHome(process.cwd(), home);
  assert.equal(result.status, "installed");
});

test("安装后：默认 Task 与 LifeOS 项目身份（仓库路径占位已替换）", async () => {
  const home = await tempPath("lifeos-install-check-");
  await installHome(process.cwd(), home);
  const project = JSON.parse(await readFile(join(home, "projects", "lifeos", "project.json"), "utf8"));
  assert.equal(project.path, process.cwd(), "project.json 的 path 应为安装时的仓库根");
  const task = await readFile(join(home, "agents", "lifeosagent", "projects", "workspace", "tasks", "0001-default", "task.md"), "utf8");
  assert.match(task, /^ID: 0001$/m);
  assert.match(task, /^类型：daily$/m);
});

test("安装出来的家目录通过结构校验（协议 §5、§6）", async () => {
  const home = await tempPath("lifeos-install-valid-");
  await installHome(process.cwd(), home);
  const report = await checkHome(home);
  assert.deepEqual(report.errors, [], "结构错误：\n" + report.errors.join("\n"));
});
