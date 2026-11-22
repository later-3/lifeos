// P2 收窄规则的纯函数测试（Task 0004 · P2）。
//
// 为什么必须穷举：这条规则写错**不报任何错**——
//   - 多放行一条 → 别的 Task / 别的 Agent / 未绑定的 project 进了工作区（体积、扫描重复）；
//   - 少放行一条 → 模型写不到该写的地方，`write` 静默落到主区去（`worktree-profile.ts` 文件头）。
//
// 两层验证，缺一不可：
//   ① 这一份：纯函数层面锁**模式序列与顺序**（gitignore 后写覆盖先写——顺序颠倒 = 本 Task 自己也没了）；
//   ② `task-worktree.test.mjs` 的 P2 段：真 git 上跑 `sparse-checkout set --no-cone` + `read-tree -mu HEAD`，
//      用 `ls` 断言语义真的成立（纯函数猜不准 git 的实际匹配）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { allowedProjectsOf, escapeGlob, SHARED_WORKSPACE, worktreeProfileOf } from "../src/worktree-profile.ts";

/**
 * 按 gitignore 语义判定"这个路径在不在 profile 里"（后匹配者胜）。
 * 只实现本模块用到的语法：`/*` 表示"根下每一项"，`*` 表示"除 `/` 外任意字符"。
 * 真实语义由 `task-worktree.test.mjs` 的真 git 用例兜底。
 */
function included(patterns, path) {
  let hit = false;
  for (const pattern of patterns) {
    const negated = pattern.startsWith("!");
    const body = negated ? pattern.slice(1) : pattern;
    if (matches(body, path)) hit = !negated;
  }
  return hit;
}

function matches(pattern, path) {
  if (pattern === "/*") return /^\/[^/]+/.test(path);
  const body = pattern.endsWith("/") ? pattern.slice(0, -1) : pattern;
  // gitignore 的转义：`\X` = 字面 X；未转义的 `*` = 除 `/` 外任意字符。
  // 先按这两个规则把模式翻译成正则源，再整体编译（顺序错了会把 `\[` 当字符集）。
  let source = "";
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i];
    if (ch === "\\" && i + 1 < body.length) { source += body[i + 1].replace(/[.+^$()|[\]{}\\*?]/g, "\\$&"); i += 1; }
    else if (ch === "*") source += "[^/]*";
    else source += ch.replace(/[.+^$()|[\]{}\\]/g, "\\$&");
  }
  return new RegExp(`^${source}(?:/.*)?$`).test(path);
}

const SELF = "coder";
const PID = "lifeos";
const TASK = "0028-连接池修复：事件通道换-WebSocket-+-加载超时出口";

const narrowed = (overrides = {}) =>
  worktreeProfileOf({ agentId: SELF, projectId: PID, taskDirName: TASK, boundProjects: ["lifeos"], ...overrides });

test("P2-1 收窄态：本 Task 在，别的 Task 不在（含同一 pid 与别的 pid）", () => {
  const patterns = narrowed();
  assert.equal(included(patterns, `/agents/${SELF}/projects/${PID}/tasks/${TASK}/task.md`), true, "本 Task 必须在");
  assert.equal(included(patterns, `/agents/${SELF}/projects/${PID}/tasks/${TASK}/cases/a.md`), true, "本 Task 的子目录在");
  assert.equal(included(patterns, `/agents/${SELF}/projects/${PID}/tasks/0007-别的/task.md`), false, "同 pid 的别的 Task 不在");
  assert.equal(included(patterns, `/agents/${SELF}/projects/workspace/tasks/0001-default/task.md`), false, "别的 pid 的 Task 也不在");
});

test("P2-2 收窄态：身份 / Agent 工具 / Agent×project 层 / 共享层都要在（reviewer 补的两行）", () => {
  const patterns = narrowed();
  for (const path of [
    `/agents/${SELF}/AGENTS.md`,
    `/agents/${SELF}/agent.json`,
    `/agents/${SELF}/identity.md`,
    `/agents/${SELF}/avatar/avatar.png`,
    `/agents/${SELF}/memory/notes.md`,
    `/agents/${SELF}/tools/README.md`,                       // 协议 §4.1：Agent 本身的工具
    `/agents/${SELF}/projects/${PID}/specs/rules.md`,        // Agent×project 层
    `/agents/${SELF}/projects/${PID}/devices/d.md`,
    "/projects/workspace/specs/a.md",
    "/projects/lifeos/specs/code.md",
    "/interaction-harness/protocol.md",
  ]) {
    assert.equal(included(patterns, path), true, `应放行：${path}`);
  }
});

test("P2-3 收窄态：别的 Agent 与未绑定的共享 project 一律不给", () => {
  const patterns = narrowed();
  for (const path of [
    "/agents/reviewer/agent.json",
    "/agents/reviewer/projects/lifeos/specs/s.md",
    "/projects/ziji/specs/z.md",
  ]) {
    assert.equal(included(patterns, path), false, `不该放行：${path}`);
  }
});

test("P2-4 顺序是硬约束：先排除所有 tasks/*，再放行本 Task（颠倒 = 本 Task 自己也没了）", () => {
  const patterns = narrowed();
  const excludeAt = patterns.indexOf(`!/agents/${SELF}/projects/*/tasks/*`);
  const allowAt = patterns.findIndex((pattern) => pattern.startsWith(`/agents/${SELF}/projects/`) && pattern.includes(`/tasks/`));
  assert.ok(excludeAt >= 0, "必须有排除所有 tasks/* 的那一条");
  assert.ok(allowAt > excludeAt, `放行本 Task 必须写在排除之后（排除@${excludeAt}, 放行@${allowAt}）`);
});

test("P2-5 活性：颠倒顺序后，本 Task 自己被排掉（这条断言必须能红）", () => {
  const patterns = narrowed();
  const broken = [...patterns];
  const excludeAt = broken.indexOf(`!/agents/${SELF}/projects/*/tasks/*`);
  const allowAt = broken.findIndex((pattern) => pattern.startsWith(`/agents/${SELF}/projects/`) && pattern.includes(`/tasks/`));
  const [allow] = broken.splice(allowAt, 1);
  broken.splice(excludeAt, 0, allow);   // 把放行挪到排除之前
  assert.equal(
    included(broken, `/agents/${SELF}/projects/${PID}/tasks/${TASK}/task.md`),
    false,
    "顺序颠倒时必须变成「排掉本 Task」——这正是 e2e 实测抓到的那个 bug（本 Task 自己也没了，而「没有别的 Task」的断言仍是绿的）",
  );
  assert.equal(included(patterns, `/agents/${SELF}/projects/${PID}/tasks/${TASK}/task.md`), true, "对照组：正确顺序下本 Task 在");
});

test("P2-6 glob 元字符必须转义（未转义的 [ 会被当字符集，Task 目录名就匹配不上）", () => {
  // 实测（git 2.37.1）：目录名含 `[` 时裸写模式 → 本 Task 不检出；转义后 → 检出。
  assert.equal(escapeGlob("0001-a[b]"), "0001-a\\[b\\]");
  assert.equal(escapeGlob("a*b?c"), "a\\*b\\?c");
  assert.equal(escapeGlob("x\\y"), "x\\\\y");
  assert.equal(escapeGlob("普通中文：名字"), "普通中文：名字", "中文与全角冒号不需要转义（实测通过）");
  // 端到端：含元字符的目录名在模式里仍能被匹配上（用本文件的 gitignore 语义模拟）
  const patterns = worktreeProfileOf({ agentId: SELF, projectId: PID, taskDirName: "0001-a[b]", boundProjects: [] });
  assert.equal(included(patterns, `/agents/${SELF}/projects/${PID}/tasks/0001-a[b]/task.md`), true);
});

test("P2-7 未收窄形态（不传 taskDirName）= 今天的行为，逐条不变（存量工作区与 P5 共存）", () => {
  const patterns = worktreeProfileOf({ agentId: SELF, boundProjects: ["lifeos"] });
  assert.deepEqual(patterns, ["/*", "!/agents/*", `/agents/${SELF}/`, "!/projects/*", "/projects/workspace/", "/projects/lifeos/"]);
  // 整个 Agent 目录都在（含它全部 Task）——这是收窄前的形态，P5 要求它仍可用
  assert.equal(included(patterns, `/agents/${SELF}/projects/${PID}/tasks/0016-x/task.md`), true);
});

test("P2-8 allowedProjectsOf 在两种形态下都只反推共享 project（不受 Task 维度影响）", () => {
  assert.deepEqual(allowedProjectsOf(narrowed()), ["workspace", "lifeos"]);
  assert.deepEqual(allowedProjectsOf(worktreeProfileOf({ agentId: SELF, boundProjects: [] })), [SHARED_WORKSPACE]);
});
