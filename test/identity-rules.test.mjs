// Task 0015 · T10 / T12：id 归一与 Task 参与者。
// 守护点：url 类 id 必须 ASCII（不再静默给 agent-xxxx）；fs 类保留中文；
// Task 参与者能表达"可不含用户"，且排除 owner。
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { entityId, isUrlSafeId, sanitizeSegment, uniqueId } from "../src/segments.ts";
import { installHome } from "../src/home.ts";
import { createTask, listTasks } from "../src/tasks.ts";

test("entityId(url)：ASCII 名字 → 小写 slug", () => {
  assert.deepEqual(entityId("Xu Later", "url"), { ok: true, id: "xu-later", derived: true });
  assert.deepEqual(entityId("Home Devices", "url"), { ok: true, id: "home-devices", derived: true });
  assert.deepEqual(entityId("Pi-Agent", "url"), { ok: true, id: "pi-agent", derived: true });
});

test("entityId(url)：中文/非 ASCII → 明确失败（不再产出 agent-3909 这种看不懂的 id）", () => {
  for (const name of ["云起", "徐之后", "评审助手", "Zhiji 植记"]) {
    const result = entityId(name, "url");
    assert.equal(result.ok, false, `${name} 不该生成 id`);
    if (!result.ok) {
      assert.equal(result.reason, "needs_ascii_name");
      assert.match(result.message, /非 ASCII|英文|拼音/, "错误信息要告诉人怎么办");
    }
  }
});

test("entityId(url)：空名与全符号也失败，不返回垃圾", () => {
  for (const name of ["", "   ", "!!!", "---"]) {
    assert.equal(entityId(name, "url").ok, false, `${JSON.stringify(name)} 不该生成 id`);
  }
});

test("entityId(fs)：保留中文（Task 目录名不进 URL，可读优先）", () => {
  assert.deepEqual(entityId("状态条误报 4/4", "fs"), { ok: true, id: "状态条误报-4-4", derived: true });
  assert.equal(sanitizeSegment("徐之后"), "徐之后");
});

test("isUrlSafeId / uniqueId：重名加序号，不覆盖", () => {
  assert.equal(isUrlSafeId("lifeos"), true);
  assert.equal(isUrlSafeId("LifeOS"), false, "大写不是合法 url id");
  assert.equal(isUrlSafeId("中文"), false);
  assert.equal(uniqueId("a", new Set()), "a");
  assert.equal(uniqueId("a", new Set(["a"])), "a-2");
  assert.equal(uniqueId("a", new Set(["a", "a-2"])), "a-3");
});

test("Task 参与者：可以没有其他参与者（纯 Agent 自己干的活）", async () => {
  const home = await mkdtemp(join(tmpdir(), "lifeos-part-"));
  process.env.LIFEOS_HOME = home;
  await installHome(process.cwd(), home);
  try {
    const ctx = { agentId: "lifeosagent", projectId: "workspace" };
    const created = await createTask(ctx, { title: "solo work", type: "general", category: "G" });
    assert.ok("task" in created);
    const text = await readFile(join(created.task.path, "task.md"), "utf8");
    assert.match(text, /^归属：lifeosagent\/workspace\/\d{4}$/m);
    assert.match(text, /^参与者：—$/m, "没有参与者就写 —（用户不必参与）");

    const listed = await listTasks(ctx);
    const mine = listed.find((task) => task.id === created.task.id);
    assert.deepEqual(mine?.participants, []);
  } finally { await rm(home, { recursive: true, force: true }); }
});

test("Task 参与者：写了参与者就解析出来，且排除 owner", async () => {
  const home = await mkdtemp(join(tmpdir(), "lifeos-part2-"));
  process.env.LIFEOS_HOME = home;
  await installHome(process.cwd(), home);
  try {
    const { writeFile } = await import("node:fs/promises");
    const ctx = { agentId: "lifeosagent", projectId: "workspace" };
    const created = await createTask(ctx, { title: "with peers", type: "general", category: "G" });
    assert.ok("task" in created);
    const file = join(created.task.path, "task.md");
    const before = await readFile(file, "utf8");
    const after = before.replace(/^参与者：—$/m, "参与者：coder, reviewer, xu");
    await writeFile(file, after, "utf8");

    const listed = await listTasks(ctx);
    const mine = listed.find((task) => task.id === created.task.id);
    assert.deepEqual(mine?.participants, ["coder", "reviewer", "xu"]);
  } finally { await rm(home, { recursive: true, force: true }); }
});

test("Task 参与者：兼容旧 task.md（记录者与负责人不同 → 记录者是参与者）", async () => {
  const home = await mkdtemp(join(tmpdir(), "lifeos-part3-"));
  process.env.LIFEOS_HOME = home;
  await installHome(process.cwd(), home);
  try {
    const { writeFile } = await import("node:fs/promises");
    const ctx = { agentId: "lifeosagent", projectId: "workspace" };
    const created = await createTask(ctx, { title: "legacy task", type: "general", category: "G" });
    assert.ok("task" in created);
    const file = join(created.task.path, "task.md");
    const before = await readFile(file, "utf8");
    // 把新字段换回旧格式（模拟历史 task.md）
    const legacy = before
      .replace(/^归属：.*$/m, "负责人：lifeosagent ｜ 记录者：lifeosagent")
      .replace(/^参与者：.*$/m, "");
    await writeFile(file, legacy, "utf8");
    assert.deepEqual((await listTasks(ctx)).find((t) => t.id === created.task.id)?.participants, [], "同一个人不算额外参与者");

    // 记录者不同 → 那个人是参与者
    await writeFile(file, legacy.replace("记录者：lifeosagent", "记录者：coder"), "utf8");
    assert.deepEqual((await listTasks(ctx)).find((t) => t.id === created.task.id)?.participants, ["coder"]);
  } finally { await rm(home, { recursive: true, force: true }); }
});
