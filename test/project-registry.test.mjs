import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, stat } from "node:fs/promises";
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
  assert.equal((await listGlobalProjects()).size, 2);
  assert.equal((await readGlobalProject(first.id))?.path, a);
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

  const again = await registerProject("lifeosagent", dir);
  assert.ok(!("code" in again));
  assert.equal(again.created, false, "同 path 再次打开是幂等");
  const listed = await listAgentProjects("lifeosagent");
  assert.ok(listed.some((item) => item.id === one.project.id && item.path === dir));
});
