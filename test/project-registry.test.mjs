import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installHome } from "../src/home.ts";
import { registerGlobalProject, readGlobalProject, listGlobalProjects } from "../src/project-registry.ts";
import { registerProject, listAgentProjects } from "../src/projects.ts";

async function freshHome() {
  const home = await mkdtemp(join(tmpdir(), "lifeos-registry-"));
  await installHome(process.cwd(), home);
  process.env.LIFEOS_HOME = home;
  return home;
}

test("全局项目注册表：同 path 幂等、同名不同 path 加后缀、project.json 落盘", async () => {
  const home = await freshHome();
  const a = join(home, "work", "same");
  const b = join(home, "other", "same");
  await mkdir(a, { recursive: true });
  await mkdir(b, { recursive: true });

  const first = await registerGlobalProject(a);
  const again = await registerGlobalProject(a);
  assert.equal(first.id, again.id, "同 path 必须复用同一个全局 id");
  assert.equal(first.path, a);

  const second = await registerGlobalProject(b);
  assert.equal(second.id, "same-2", "同名不同 path 加后缀");
  assert.notEqual(second.id, first.id);

  const onDisk = JSON.parse(await readFile(join(home, "projects", first.id, "project.json"), "utf8"));
  assert.equal(onDisk.id, first.id);
  assert.equal(onDisk.path, a);
  assert.equal((await listGlobalProjects()).size, 3, "两个外部项目 + 共享 workspace");
  assert.equal((await readGlobalProject(first.id))?.path, a);
  const workspace = await readGlobalProject("workspace");
  assert.equal(workspace?.id, "workspace", "共享 workspace 必须有全局身份");
  assert.equal(workspace?.path, undefined, "workspace 不对应一个用户目录");
  assert.ok((await stat(join(home, "projects", "workspace", "specs", "agent-collaboration", "AGENTS.md"))).isFile(), "共享 workspace 带协作规范");
});

test("Agent 绑定使用全局 id；两个 Agent 打开同一目录得到同一个项目 id", async () => {
  const home = await freshHome();
  const dir = join(home, "repo");
  await mkdir(dir, { recursive: true });

  const one = await registerProject("lifeosagent", dir);
  assert.ok(!("code" in one));
  const two = await registerProject("coder", dir);
  assert.ok(!("code" in two));
  assert.equal(one.project.id, two.project.id, "同一目录在全局只有一个 id");

  const binding = join(home, "agents", "lifeosagent", "projects", one.project.id, "project.json");
  assert.equal(JSON.parse(await readFile(binding, "utf8")).id, one.project.id);
  assert.ok((await stat(join(home, "projects", one.project.id, "project.json"))).isFile());
  assert.ok((await stat(join(home, "projects", one.project.id, "memory"))).isDirectory(), "项目共享记忆目录应存在");
  assert.ok((await stat(join(home, "projects", one.project.id, "memory", "AGENTS.md"))).isFile(), "共享记忆目录带 AGENTS.md");

  const again = await registerProject("lifeosagent", dir);
  assert.ok(!("code" in again));
  assert.equal(again.created, false, "同 path 再次打开是幂等");
  const listed = await listAgentProjects("lifeosagent");
  assert.ok(listed.some((item) => item.id === one.project.id && item.path === dir));
});

test("项目绑定目录带 harness 骨架；老绑定在列出时补齐；不覆盖已有文件", async () => {
  const home = await freshHome();
  const dir = join(home, "repo2");
  await mkdir(dir, { recursive: true });
  const { project } = await registerProject("lifeosagent", dir);
  const bindDir = join(home, "agents", "lifeosagent", "projects", project.id);

  for (const file of ["AGENTS.md", "concept-space.md"]) {
    assert.ok((await stat(join(bindDir, file))).isFile(), `${file} 应存在`);
  }
  for (const sub of ["sessions", "daily", "cases", "todo", "memory", "specs"]) {
    assert.ok((await stat(join(bindDir, sub))).isDirectory(), `${sub}/ 应存在`);
  }
  assert.ok((await stat(join(bindDir, "specs", "index.json"))).isFile(), "specs/index.json 预建");
  assert.ok((await stat(join(bindDir, "tasks"))).isDirectory(), "tasks/ 预建");
  assert.ok((await stat(join(bindDir, "tasks", "AGENTS.md"))).isFile(), "tasks/AGENTS.md 预建");
  assert.deepEqual((await readdir(join(bindDir, "tasks"))), ["AGENTS.md"], "不预建具体任务目录");
  for (const sub of ["sessions", "daily", "cases", "todo", "memory", "tasks", "specs"]) {
    assert.ok((await stat(join(bindDir, sub, "AGENTS.md"))).isFile(), `${sub}/AGENTS.md 应存在`);
  }

  await writeFile(join(bindDir, "AGENTS.md"), "自定义内容\n");
  await listAgentProjects("lifeosagent");
  assert.equal(await readFile(join(bindDir, "AGENTS.md"), "utf8"), "自定义内容\n", "已存在文件不覆盖");

  await rm(join(bindDir, "AGENTS.md"));
  await rm(join(bindDir, "daily"), { recursive: true });
  await listAgentProjects("lifeosagent");
  assert.ok((await stat(join(bindDir, "AGENTS.md"))).isFile(), "老绑定在列出时补 AGENTS.md");
  assert.ok((await stat(join(bindDir, "daily"))).isDirectory(), "老绑定在列出时补 daily/");
});
