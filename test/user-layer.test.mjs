// Task 0035 · S1.5 地基：用户层（`users/<uid>/`）与全局项目同构。
//
// 断言原则（testing 2.5）：断用户可观察的结构与行为，不断实现细节。
// 每条用例都在**临时家目录**里跑（testing 2.1），不碰真实数据。
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installHome } from "../src/home.ts";
import { checkHome } from "../src/home-check.ts";
import { ensureUserLayer, ensureUserProjectLayer } from "../src/project-skeleton.ts";
import { registerGlobalProject } from "../src/project-registry.ts";
import { backfillUserLayer } from "../src/user-layer-backfill.ts";
import { worktreeProfileOf } from "../src/worktree-profile.ts";
import { readGlobalProject } from "../src/project-registry.ts";

const freshHome = async () => {
  const home = await mkdtemp(join(tmpdir(), "user-layer-"));
  await installHome(process.cwd(), home);
  process.env.LIFEOS_HOME = home;
  return home;
};
const cleanup = (path) => rm(path, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }).catch(() => {});
const userErrors = (errors) => errors.filter((line) => line.includes("users/"));

/** 造一个"只有 user.json"的用户层（这就是现状：`~/.lifeos/users/xu/` 里只有一个文件）。 */
async function bareUser(home, uid = "xu") {
  const dir = join(home, "users", uid);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "user.json"), `{"schemaVersion":1,"id":"${uid}","name":"${uid}"}\n`, "utf8");
  return dir;
}

/** 全局项目 id 清单（有 `project.json` 的那些；`longagentshare` 没有，所以不在这里）。 */
async function globalIds(home) {
  const ids = [];
  for (const entry of await readdir(join(home, "projects"), { withFileTypes: true }).catch(() => [])) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const manifest = await readGlobalProject(entry.name).catch(() => undefined);
    if (manifest !== undefined) ids.push(manifest.id);
  }
  return ids.sort();
}

// —— 验收句 1：home:check 能校验用户层，且对现状零假阳性 ——

test("S1.5-1 改前：只有 user.json 的用户层，home:check 报缺 AGENTS.md 与缺 projects/", async () => {
  const home = await freshHome();
  try {
    await bareUser(home);
    const report = await checkHome(home);
    const errs = userErrors(report.errors);
    assert.ok(errs.some((line) => line.includes("AGENTS.md")), `应报缺 AGENTS.md：${JSON.stringify(errs)}`);
    assert.ok(errs.some((line) => line.includes("projects/")), `应报缺 projects/：${JSON.stringify(errs)}`);
  } finally { await cleanup(home); }
});

test("S1.5-1b 空家目录（没有 users/）不报用户层错误（没用户 = 结构还没建，不是缺陷）", async () => {
  const home = await freshHome();
  try {
    const report = await checkHome(home);
    assert.deepEqual(userErrors(report.errors), [], "没有 users/ 时不该报用户层");
  } finally { await cleanup(home); }
});

test("S1.5-1c 用户层出现 sessions/ → 必须报错（P6：不提供对话能力）", async () => {
  const home = await freshHome();
  try {
    const dir = await bareUser(home);
    await ensureUserLayer(dir);
    await mkdir(join(dir, "sessions"), { recursive: true });
    const report = await checkHome(home);
    const errs = userErrors(report.errors);
    assert.ok(errs.some((line) => line.includes("sessions")), `必须报 sessions/：${JSON.stringify(errs)}`);
  } finally { await cleanup(home); }
});

test("S1.5-1d 用户层出现 tasks/ 或 task-types/ → 必须报错（Task 属于 Agent × project）", async () => {
  const home = await freshHome();
  try {
    const dir = await bareUser(home);
    await ensureUserLayer(dir);
    await mkdir(join(dir, "tasks"), { recursive: true });
    await mkdir(join(dir, "task-types"), { recursive: true });
    const report = await checkHome(home);
    const errs = userErrors(report.errors);
    assert.ok(errs.some((line) => line.includes("tasks")), "必须报 tasks/");
    assert.ok(errs.some((line) => line.includes("task-types")), "必须报 task-types/");
  } finally { await cleanup(home); }
});

// —— 验收句 2：每个全局项目一份（对账） ——

test("S1.5-2 补齐后每个全局项目各一份（含 workspace），目录名 = project.json 的 id", async () => {
  const home = await freshHome();
  try {
    const dir = await bareUser(home);
    await ensureUserLayer(dir);
    // 造两个外部项目（出厂家目录已带 lifeos 与 workspace）
    const extA = await mkdtemp(join(tmpdir(), "ul-a-"));
    const extB = await mkdtemp(join(tmpdir(), "ul-b-"));
    try {
      const a = await registerGlobalProject(extA);
      const b = await registerGlobalProject(extB);
      // 出厂家目录本来就带 `lifeos` 与 `workspace` 两个全局项目；它们不会重走注册路径，
      // 所以由启动时的 `backfillUserLayer` 补齐（这就是"存量也要有"的机制）。
      await backfillUserLayer(home);
      const ids = (await globalIds(home)).sort();
      assert.ok(ids.includes("workspace"), "workspace 本身也是全局项目");
      const present = (await readdir(join(dir, "projects"), { withFileTypes: true }))
        .filter((e) => e.isDirectory()).map((e) => e.name).sort();
      assert.deepEqual(present, ids, `用户侧 projects/ 必须与全局项目逐项相等：${JSON.stringify({ present, ids })}`);
      assert.ok(present.includes(a.id) && present.includes(b.id), "新注册的两个项目都要出现");
    } finally { await cleanup(extA); await cleanup(extB); }
  } finally { await cleanup(home); }
});

test("S1.5-2b 用户侧多一个全局里没有的目录 → 报错（对账是双向的）", async () => {
  const home = await freshHome();
  try {
    const dir = await bareUser(home);
    await ensureUserLayer(dir);
    await ensureUserProjectLayer(join(dir, "projects", "不存在的项目"));
    const report = await checkHome(home);
    const errs = userErrors(report.errors);
    assert.ok(errs.some((line) => line.includes("不存在的项目")), `多余目录必须报：${JSON.stringify(errs)}`);
  } finally { await cleanup(home); }
});

// —— 验收句 3：没有 sessions/，也没有"给用户发消息"的入口 ——

test("S1.5-3 用户层结构与验收句一致：四类内容 + AGENTS.md + user.json，无 sessions/tasks/memory/specs", async () => {
  const home = await freshHome();
  try {
    const dir = await bareUser(home);
    await ensureUserLayer(dir);
    const projectDir = join(dir, "projects", "workspace");
    const projectEntries = (await readdir(projectDir, { withFileTypes: true })).map((e) => e.name).sort();
    assert.deepEqual(projectEntries, ["AGENTS.md", "daily", "knowledge", "todo", "tools"], `用户 × 项目只该有这五样：${projectEntries}`);
    for (const forbidden of ["sessions", "tasks", "task-types", "memory", "specs", "cases"]) {
      const info = await stat(join(dir, forbidden)).catch(() => undefined);
      assert.equal(info, undefined, `用户层不该有 ${forbidden}/`);
    }
  } finally { await cleanup(home); }
});

// —— 验收句 4：注册新全局项目 → 用户侧自动补齐（不靠人记得） ——

test("S1.5-4 注册新全局项目 → 用户侧自动出现对应目录（走 registerGlobalProject 同一个 ensure 路径）", async () => {
  const home = await freshHome();
  try {
    const dir = await bareUser(home);
    await ensureUserLayer(dir);
    const ext = await mkdtemp(join(tmpdir(), "ul-new-"));
    try {
      const project = await registerGlobalProject(ext);
      const userProjectDir = join(dir, "projects", project.id);
      const info = await stat(userProjectDir).catch(() => undefined);
      assert.ok(info?.isDirectory() === true, `注册后用户侧必须有 ${project.id}/：${userProjectDir}`);
      // 而且它是有结构的一份，不是一个空目录
      for (const sub of ["knowledge", "daily", "todo", "tools"]) {
        assert.ok((await stat(join(userProjectDir, sub)).catch(() => undefined))?.isDirectory() === true, `缺 ${sub}/`);
      }
      assert.ok((await stat(join(userProjectDir, "AGENTS.md")).catch(() => undefined))?.isFile() === true, "缺 AGENTS.md");
    } finally { await cleanup(ext); }
  } finally { await cleanup(home); }
});

test("S1.5-4b 存量补齐（backfillUserLayer）：一次补全所有全局项目，且幂等", async () => {
  const home = await freshHome();
  try {
    const dir = await bareUser(home);
    const first = await backfillUserLayer(home);
    assert.ok(first !== undefined, "回填应当成功");
    const ids = await globalIds(home);
    assert.equal(first.projects, ids.length, `回填的项目数应等于全局项目数：${JSON.stringify({ first, ids })}`);
    const present = (await readdir(join(dir, "projects"), { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name).sort();
    assert.deepEqual(present, ids);
    // 幂等：再跑一次不改动既有文件（create-only）
    const again = await backfillUserLayer(home);
    assert.equal(again.projects, first.projects);
  } finally { await cleanup(home); }
});

// —— 验收句 5：工作区裁剪不误伤用户层 ——

test("S1.5-5 收窄态工作区：用户实体 + workspace + 本 pid 在；别的 pid 与别的 uid 不在", async () => {
  const patterns = worktreeProfileOf({
    agentId: "coder", boundProjects: ["lifeos"], taskDirName: "0035-x", projectId: "lifeos", userId: "xu",
  });
  const usersPart = patterns.filter((p) => p.includes("users"));
  assert.ok(usersPart.includes("/users/xu/"), "用户实体本身必须显式放行");
  assert.ok(usersPart.includes("!/users/xu/projects/*"), "必须先排掉所有用户项目");
  assert.ok(usersPart.includes("/users/xu/projects/workspace/"), "默认项目必须放行");
  assert.ok(usersPart.includes("/users/xu/projects/lifeos/"), "本 Task 所在的 pid 必须放行");
  // 顺序硬约束：排除必须在放行之前（后写的覆盖先写的）
  const excludeAt = patterns.indexOf("!/users/xu/projects/*");
  const allowAt = patterns.indexOf("/users/xu/projects/lifeos/");
  assert.ok(excludeAt !== -1 && allowAt !== -1 && excludeAt < allowAt, "先排除后放行，顺序不能颠倒");
  // 别的 pid 没有单独放行（只可能靠 `/*` 兜；那是原型，不是白名单条目）
  assert.equal(patterns.includes("/users/xu/projects/ziji/"), false, "别的 pid 不得有白名单条目");
});

test("S1.5-5b 不传 userId（存量 / 未收窄）时不产出任何 users 模式（行为与改动前一致）", async () => {
  const withOut = worktreeProfileOf({ agentId: "coder", boundProjects: ["lifeos"], taskDirName: "0035-x", projectId: "lifeos" });
  assert.deepEqual(withOut.filter((p) => p.includes("users")), [], "不传 uid 就不该有 users 条目");
  const legacy = worktreeProfileOf({ agentId: "coder", boundProjects: ["lifeos"] });
  assert.deepEqual(legacy.filter((p) => p.includes("users")), [], "未收窄形态同样不加 users 条目");
});

// —— P5b：写守卫的 users 范围（architect 2026-11-24 实测：别的 pid 会“写成功但 git 不 stage”）——

test("S1.5-6 写守卫：users/<本 uid>/projects/<别的 pid>/… 必须拒（与 agents/ 同形）", async () => {
  const { worktreeScopeOf } = await import("../src/write-guard.ts");
  const mount = "/x/.lifeos/agents/coder/projects/lifeos/tasks/0035-x/home";
  const own = worktreeScopeOf(`${mount}/users/xu/projects/lifeos/daily/2026-11-24.md`, { userId: "xu" });
  assert.equal(own.reason, undefined, "本 pid 的用户空间应当放行");

  const other = worktreeScopeOf(`${mount}/users/xu/projects/ziji/knowledge/note.md`, { userId: "xu" });
  assert.ok(other.reason !== undefined, "别的 pid 必须拒");
  assert.match(other.reason, /ziji/, "拒绝文案要点名是哪个 pid");

  const otherUser = worktreeScopeOf(`${mount}/users/other/xk.md`, { userId: "xu" });
  assert.ok(otherUser.reason !== undefined, "别的 uid 必须拒");

  const workspacePid = worktreeScopeOf(`${mount}/users/xu/projects/workspace/todo/todo.md`, { userId: "xu" });
  assert.equal(workspacePid.reason, undefined, "workspace 是用户层默认项目，放行");
});

test("S1.5-6b 不传 userId 时：别的 pid 仍然拒（那是与 uid 无关的范围判定），只是不做「别的 uid」那层", async () => {
  const { worktreeScopeOf } = await import("../src/write-guard.ts");
  const mount = "/x/.lifeos/agents/coder/projects/lifeos/tasks/0035-x/home";
  // 别的 pid：范围判定只看"本 Task 所在 pid"，与 uid 是否传入无关 → 仍拒。
  // 这是有意的：**范围**与**身份**是两件事，前者不该因为拿不到 uid 而失效。
  const otherPid = worktreeScopeOf(`${mount}/users/xu/projects/ziji/knowledge/note.md`);
  assert.ok(otherPid.reason !== undefined, "不传 uid 时别的 pid 仍要拒");
  // 本 pid 照常放行
  const ownPid = worktreeScopeOf(`${mount}/users/xu/projects/lifeos/daily/x.md`);
  assert.equal(ownPid.reason, undefined, "本 pid 照常放行");
});

// —— P2-3（2026-11-24 复核）：容器自身与子目录的 AGENTS.md 都要校验 ——

test("S1.5-1e 删掉 users/AGENTS.md（容器自身）→ home:check 必须报", async () => {
  const home = await freshHome();
  try {
    const dir = await bareUser(home);
    await ensureUserLayer(dir);
    await backfillUserLayer(home);
    await rm(join(home, "users", "AGENTS.md"));
    const report = await checkHome(home);
    assert.ok(report.errors.some((line) => line.includes("用户层容器")),
      `容器缺说明文件必须报：${JSON.stringify(userErrors(report.errors))}`);
  } finally { await cleanup(home); }
});

test("S1.5-1f 删掉 projects/<pid>/knowledge/AGENTS.md → home:check 必须报", async () => {
  const home = await freshHome();
  try {
    const dir = await bareUser(home);
    await ensureUserLayer(dir);
    await backfillUserLayer(home);
    await rm(join(dir, "projects", "workspace", "knowledge", "AGENTS.md"));
    const report = await checkHome(home);
    assert.ok(report.errors.some((line) => line.includes("knowledge/AGENTS.md")),
      `子目录缺说明文件必须报：${JSON.stringify(userErrors(report.errors))}`);
  } finally { await cleanup(home); }
});
