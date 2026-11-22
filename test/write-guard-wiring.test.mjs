// 守卫**挂上了没有**（Task 0004 · P4）：实现正确但没挂到会话上 = 功能不存在，且不报错。
//
// 这里验的是装配点（`createHostedResourceLoader` 的 `extensionFactories`），
// 判据本身的正确性在 `test/write-guard.test.mjs`。
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installHome } from "../src/home.ts";
import { SettingsManager } from "@earendil-works/pi-coding-agent";
import { createHostedResourceLoader } from "../src/agent-host.ts";
import { buildPromptParts } from "../src/assembly.ts";

const run = promisify(execFile);
const git = async (cwd, args) =>
  (await run("git", ["-C", cwd, "-c", "core.quotePath=false", "-c", "user.email=t@t", "-c", "user.name=t", ...args], { timeout: 60_000 })).stdout;

/**
 * 装临时家目录。
 *
 * `withGit: true` 会把它 init 成 git 仓并提交基线——**这是"有工作区"的前提**。
 * 没有 git 就没有工作区，`taskDocRootOf` 会回落主区，那时"写主区 Task 文档"本就该允许
 *（architect 02-design §2.4 的第 1 条就是权威）——第一版 W1 没 init git，
 * 于是断言的场景根本不存在，测出来的是 `[]`（守卫没错，是夹具错）。
 */
async function fixture({ withGit = false } = {}) {
  const base = await mkdtemp(join(tmpdir(), "lifeos-guard-wiring-"));
  const home = join(base, "home");
  await installHome(process.cwd(), home);
  if (withGit) {
    await git(home, ["init", "-q", "-b", "main"]);
    await writeFile(join(home, ".gitignore"), await readFile(join(process.cwd(), ".lifeos", ".gitignore"), "utf8"));
    await git(home, ["add", "-A"]);
    await git(home, ["commit", "-q", "-m", "init"]);
  }
  const project = join(base, "proj");
  await mkdir(project, { recursive: true });
  process.env.LIFEOS_HOME = home;
  const configDir = join(home, "config");
  const parts = await buildPromptParts("lifeosagent", "workspace");
  const settings = () => SettingsManager.create(project, configDir);
  return { base, home, project, configDir, parts, settings };
}

/**
 * 收集 loader 上注册的 tool_call 处理函数。
 *
 * Pi 的形状（`extensions/types.ts:2268-2293`）：
 * - `loader.getExtensions()` 返回 `{ extensions, errors, warnings, runtime }`（**不是数组**——
 *   第一版直接迭代它，抛 `extensions is not iterable`）；
 * - 每个 `Extension` 的名字在 `path` 里（`<inline:lifeos-write-guard>`），
 *   handler 在 `handlers: Map<string, HandlerFn[]>` 里（**不是普通对象**——第二版用对象取，恒 undefined）。
 * 两处都是"读错了形状"，与代码对不对无关；记在这里免得下次再踩。
 */
async function toolCallHandlersOf(loader) {
  const loaded = loader.getExtensions();
  assert.deepEqual(loaded.errors ?? [], [], "扩展加载不该有错误");
  const out = [];
  for (const extension of loaded.extensions ?? []) {
    const handlers = extension.handlers?.get?.("tool_call") ?? [];
    out.push(...handlers);
  }
  return out;
}

/** 扩展是否挂在 loader 上（按 path 里的 `<inline:名字>` 认）。 */
function extensionPathsOf(loader) {
  return (loader.getExtensions().extensions ?? []).map((extension) => extension.path);
}

test("W1 传了 writeGuard → loader 里出现 lifeos-write-guard，且能拦主区写入", async () => {
  const { home, project, configDir, parts, settings } = await fixture({ withGit: true });
  // 建一个**有工作区**的 Task：它的主区目录只剩挂载点，写主区那份必须被拦
  const { createTask } = await import("../src/tasks.ts");
  const created = await createTask({ agentId: "lifeosagent", projectId: "workspace" }, { title: "守卫挂载", type: "general", category: "G" });
  assert.ok(!("code" in created), JSON.stringify(created));
  const task = created.task;

  const loader = await createHostedResourceLoader({
    cwd: project, configDir, settingsManager: settings(), parts,
    writeGuard: { agentId: "lifeosagent", projectId: "workspace", getTaskId: () => task.id },
  });
  assert.ok(extensionPathsOf(loader).includes("<inline:lifeos-write-guard>"),
    `loader 上必须有守卫生成的扩展，实际：${extensionPathsOf(loader).join(", ")}`);
  const handlers = await toolCallHandlersOf(loader);
  assert.ok(handlers.length > 0, "必须至少有一个 tool_call 处理函数（守卫生效的前提）");

  // 主区那份（有工作区时它是"上次合并的版本"）→ 必须 block
  const target = join(task.path, "task.md");
  const results = [];
  for (const handler of handlers) {
    const out = await handler({ toolName: "write", input: { path: target, content: "x" } }, { cwd: project });
    if (out !== undefined) results.push(out);
  }
  assert.ok(results.some((out) => out.block === true), `主区写入必须被拦，实际：${JSON.stringify(results)}`);
  assert.ok(results.some((out) => String(out.reason).includes(task.docPath)), "理由里必须给 docPath");

  // 同一条链上，写工作区那份不 block
  const allowed = [];
  for (const handler of handlers) {
    const out = await handler({ toolName: "write", input: { path: join(task.docPath, "01-background.md"), content: "x" } }, { cwd: project });
    if (out !== undefined) allowed.push(out);
  }
  assert.deepEqual(allowed, [], `工作区写入不该被拦：${JSON.stringify(allowed)}`);
  void home;
});

test("W2 不传 writeGuard → 没有守卫 handler（离线测试不受影响）", async () => {
  const { project, configDir, parts, settings } = await fixture();
  const loader = await createHostedResourceLoader({ cwd: project, configDir, settingsManager: settings(), parts });
  assert.equal(extensionPathsOf(loader).includes("<inline:lifeos-write-guard>"), false,
    `不传 writeGuard 时不该挂守卫，实际：${extensionPathsOf(loader).join(", ")}`);
});

test("W3 getTaskId 每次现读：切 Task 后守卫立刻按新 Task 判", async () => {
  const { project, configDir, parts, settings } = await fixture({ withGit: true });
  let taskId = "0001-default";
  const loader = await createHostedResourceLoader({
    cwd: project, configDir, settingsManager: settings(), parts,
    writeGuard: { agentId: "lifeosagent", projectId: "workspace", getTaskId: () => taskId },
  });
  const handlers = await toolCallHandlersOf(loader);
  const home = process.env.LIFEOS_HOME;
  // 建第二个 Task 并给它工作区（用 createTask 才会建）
  const { createTask } = await import("../src/tasks.ts");
  const created = await createTask({ agentId: "lifeosagent", projectId: "workspace" }, { title: "第二个", type: "general", category: "G" });
  assert.ok(!("code" in created), JSON.stringify(created));
  const second = created.task;

  const written = join(second.docPath, "01-background.md");
  taskId = second.id;                    // 模拟 lifeos_task_enter 之后
  let blocked;
  for (const handler of handlers) {
    const out = await handler({ toolName: "write", input: { path: written, content: "x" } }, { cwd: project });
    if (out?.block === true) blocked = out;
  }
  assert.equal(blocked, undefined, `切到新 Task 后，它的工作区必须可写：${JSON.stringify(blocked)}`);
});

// ── 3-1：新写工具必须进守卫（reviewer 2026-11-19）────────────────────────
//
// 现状 `ALL_TOOL_NAMES` 里没有 MCP，所以**当前覆盖完整**；但将来注册一个有写语义的工具会静默绕过。
// 这条把约定钉进测试：守卫覆盖的名字集合 == 所有有写语义的工具名。新增写工具而不加守卫 → 红。

test("W4 写语义工具名单 == 守卫覆盖的名单（新增写工具必须同时进守卫）", async () => {
  const { ALL_TOOL_NAMES } = await import("../src/agent-host.ts");
  const { WRITE_TOOLS, BASH_TOOLS } = await import("../src/write-guard.ts");

  // 「有写语义的工具」= 能落盘的内置工具。这里显式列出来（不是从 ALL_TOOL_NAMES 推），
  // 因为它的作用是**反向检查**：Pi 升级新增一个写工具时，这张表要人来看一眼。
  const WRITE_CAPABLE = ["write", "edit", "bash", "powershell"];
  // 断言 ①：每个有写语义的工具都在守卫名单里
  for (const name of WRITE_CAPABLE) {
    assert.ok(
      WRITE_TOOLS.has(name) || BASH_TOOLS.has(name),
      `${name} 有写语义但没进守卫（WRITE_TOOLS ∪ BASH_TOOLS）——新增写工具必须同时加守卫`,
    );
  }
  // 断言 ②：反过来，守卫名单里不该有已经不在 allowlist 里的名字（改名/删除后要同步）
  for (const name of [...WRITE_TOOLS, ...BASH_TOOLS]) {
    assert.ok(ALL_TOOL_NAMES.includes(name), `守卫覆盖的 ${name} 已不在 ALL_TOOL_NAMES 里（工具改名或删除了？）`);
  }
  // 断言 ③：Life OS 自有工具里没有写文件语义的（有的话必须显式判定并加进上面那张表）
  const LIFEOS_WRITE_CAPABLE = ["lifeos_media_avatar_set"];   // 只写自己的 avatar/，不碰 Task 文档
  const { LIFEOS_TOOL_NAMES } = await import("../src/tool-names.ts");
  for (const name of LIFEOS_TOOL_NAMES) {
    if (LIFEOS_WRITE_CAPABLE.includes(name)) continue;
    assert.ok(!/write|edit|save|create_file/i.test(name), `Life OS 工具 ${name} 名字像写工具：请判定它是否需要进守卫`);
  }
});
