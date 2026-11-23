// 写入守卫（Task 0004 · P4 · L2）：Agent 的 `write` / `edit` / `bash` 只能落在**当前 Task 的工作区**里。
//
// 为什么需要（02-design §2.4b）：git 的 ort 策略对"主区未提交的改动"不设防——
// 两边改同一行、主区脏，`merge` 返回 0、零冲突零提示，改动被**静默冲掉**。
// 所以"只写 Task worktree"的价值不只是整洁：它把"发现不了的丢失"变成"一定在某个分支里、git 一定看得见"。
//
// 为什么不能靠"目录不存在"（e2e 实测）：Pi 的 `write` 工具会 `mkdir -p` 父目录
// （`pi/packages/coding-agent/src/core/tools/write.ts:63-66`），收窄后写别的 Task **不会**自然报错，
// 目录会被自动创建；越界写还会把 sparse 的 `S` 标记降级成 `H`（此后工作区看起来"文件都在"）。
// 所以守卫必须落**工具层**（`tool_call` 钩子），拦的是工具调用不是文件系统——
// `git merge` 不经过工具层，因此"合并写入主区"自动合法，条文能落地。
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path";
import { promisify } from "node:util";
import type { InlineExtension } from "@earendil-works/pi-coding-agent";
import { resolveHome } from "./home.ts";
import { existingUserId } from "./profile.ts";
import { taskDocRootOf } from "./task-doc-path.ts";
import { HOME_DIR, isRegisteredWorktree, REPO_DIR } from "./task-worktree.ts";
import { worktreeMountOf } from "./worktree-mount.ts";
import { resolveTaskDir } from "./tasks.ts";

const run = promisify(execFile);

export type GuardScope = { agentId: string; projectId: string };

/**
 * 程序专属目录：**只有程序写**，Agent 一律拒（判据 ③，在「git 看不见就放行」之前）。
 *
 * 这份清单**逐条对着 `.lifeos/.gitignore` 抄**，不自己发明（reviewer 2026-11-19 要求）：
 *
 * | .gitignore 行 | 条目 | 为什么必须拒 |
 * |---|---|---|
 * | 5  | `config/` | `models.json` 有 9 个 provider 的明文 apiKey；写坏 = 全部 Agent 无法调模型 |
 * | 10 | `** /projects/<pid>/sessions/` | Agent 若写这个，能造假的会话 JSONL，**污染会话原始记录** |
 * | 11 | `** /memory/(…)/data/` | 记忆库二进制（sqlite 同族），写坏 = 记忆丢失 |
 * | 12 | `** /memory/daemon/` | 记忆守护进程的运行时目录 |
 * | 13 | `** /memory/skills/` | 同上 |
 * | 14 | `** /memory/logs/` | 同上 |
 *
 * 不在这份清单里的 ignored 目录（`logs/` `state/` `tmp/` `attachments/` `reference/`
 * `tasks/<NNNN>/evidence/` …）走判据 ④ 放行——那些是程序/工具写的结果，Agent 写它们不算绕过检视。
 */
const PROGRAM_ONLY: Array<{ pattern: RegExp; why: string }> = [
  { pattern: /^config(\/|$)/, why: "config/ 只由程序写：models.json 含明文 apiKey，写坏会让所有 Agent 无法调模型（配模型走 PUT /api/agents/<id>/config）" },
  { pattern: /projects\/[^/]+\/sessions(\/|$)/, why: "sessions/ 是会话原始记录（JSONL），Agent 写它会污染对话正文" },
  // **中间层必须允许**（e2e 2026-11-19 抓出）：`.gitignore:23` 是 `**/memory/**/data/` 形态，
  // 真实布局是 `memory/user/default/data/memos.db-wal`——写成 `memory/(data|daemon|...)` 只匹配紧邻层，
  // 会把真实布局漏掉（第一版就是这么错的）。四个名字统一放宽，与 .gitignore 的 `**` 语义对齐。
  { pattern: /memory\/(.*\/)?(data|daemon|skills|logs)(\/|$)/, why: "memory 的 data/daemon/skills/logs 是记忆库的运行时存储，写坏 = 记忆丢失" },
  // `.gitignore:43` 根级 `.lifeos-worktree.json`：工作区的**注册标记**，只由建工作区的动作写。
  // 它本身不构成 mount（`worktreeMountOf` 只看目录名），所以"不加固也无害"；
  // 但它正好是"伪造工作区"那条路的**第一步**——守卫在工具执行前跑，拒掉这一次就等于
  // 让"先造 marker 再写假树"永远走不通（鸡生不出蛋）。
  { pattern: /^\.lifeos-worktree\.json$/, why: "工作区注册标记，只由建工作区的动作写" },
];

/** 命中程序专属目录？返回原因，否则 undefined。`relative` 是相对家目录仓根的路径（POSIX 分隔符）。
 *  导出给测试与探针用：要能断言"这条路径命中的是 PROGRAM_ONLY，不是判据⑤兜底"（`R6`）。 */
export function programOnlyOf(relative: string | undefined): string | undefined {
  if (relative === undefined) return undefined;
  for (const entry of PROGRAM_ONLY) if (entry.pattern.test(relative)) return entry.why;
  return undefined;
}

export type WriteVerdict = { allow: true } | { allow: false; reason: string };

/**
 * 目标落在某个工作区挂载点之下时，那个挂载点必须**真的是**注册过的工作区。
 *
 * 三个放行点（①docRoot ②repo ④git 看不见）都要过这一道，所以只写一份
 * （`specs/code/api/api.md` 2.7：一个事实一处实现）。命中"假挂载点"返回拒绝理由。
 */
async function fakeWorktreeOf(home: string, scope: GuardScope, taskId: string | undefined, target: string): Promise<string | undefined> {
  const mount = worktreeMountOf(target);
  if (mount === undefined) return undefined;                 // 不在任何挂载点下：与本案无关
  if (await isRegisteredWorktree(mount.path)) return undefined;
  return fakeWorktreeReason(home, scope, taskId, target, mount.path);
}

/**
 * 工作区**内部的范围**：一个 Task 的 home 工作区里，哪些路径是它该有的。
 *
 * 为什么要这一条（e2e 2026-11-19 抓出的 P0）：`fakeWorktreeOf` 只判"目标落在某个挂载点下、
 * 那个挂载点是否注册过"——但 **"挂载点是真的" ≠ "路径在该挂载点允许的范围内"**。
 * `…/tasks/<A>/home/agents/…/tasks/<B>/01-background.md` 找到的挂载点是 `<A>/home`（确实注册过），
 * 于是被判"不是假工作区"而放行。可它在 A 的 fork 里给 B 造主区文档：
 * 不进任何检视源，`git add -A` 还会因 sparse 拒绝 → **用户以为写进去了，其实丢了**。
 *
 * 判据（只看 home 工作区；`repo/` 与历史 `worktree/` 是完整检出，内部不做范围限制）：
 * 目标在 `<taskDir>/home` 之下时，把相对段与**这个工作区自己的 Task 镜像**比：
 *
 * | 相对路径 | 允许？ | 为什么 |
 * |---|---|---|
 * | `agents/<owner>/…`（身份/工具/记忆、Agent×project 层） | ✅ | 收窄白名单里的层，实测会被改 |
 * | `agents/<owner>/projects/<ownerPid>/tasks/<ownerDir>/…` | ✅ | 本 Task 自己的镜像 |
 * | `agents/<owner>/projects/<ownerPid>/tasks/<别的 dir>/…` | ❌ | 给别的 Task 造文件（本 Task 的工作区不含它） |
 * | `agents/<别的 agent>/…` | ❌ | 别的 Agent 的身份/任务不在本工作区 |
 * | `projects/<共享>/…`、`interaction-harness/…` | ✅ | 共享层与根上的协议层 |
 * | `users/<uid>/`、`users/<uid>/projects/<本 pid>/…` | ✅ | 用户实体本身 + 本 Task 那个项目的用户空间（协议 §4.2.1） |
 * | `users/<uid>/projects/<别的 pid>/…` | ❌ | 本 Task 的工作区不含别的项目的用户空间（写进去 git 也不 stage） |
 * | `users/<别的 uid>/…` | ❌ | 一个家目录一个使用者；别的 uid 不在本工作区 |
 *
 * owner 从**挂载点路径本身**反推（`<taskDir>/home` 的 taskDir 就是 `agents/<a>/projects/<p>/tasks/<dir>`），
 * 不读 marker、不查仓：这样对 4 个只有 `.git` 的存量工作区同样成立。
 */
export type HomeScopeOptions = {
  /**
   * 当前使用者的 uid（协议 §4.2.1 · Task 0035）。
   *
   * **唯一来源**是调用方从 `profile.ts` 的 `currentUserId(home)` 取；本函数纯函数、**不读盘**。
   * 不传 = 不做"别的 uid"这层判定（存量调用点与不认识用户层的场景，行为与改动前一致）。
   */
  userId?: string;
};

export function worktreeScopeOf(target: string, options: HomeScopeOptions = {}): { mount: string; reason?: string } | { mount: undefined } {
  const mount = worktreeMountOf(target);
  if (mount === undefined) return { mount: undefined };
  if (mount.kind !== HOME_DIR) return { mount: mount.path };       // repo/ 与历史 worktree/ 是完整检出

  const paths = ownerOfHomeMount(mount.path);
  if (paths === undefined) return { mount: mount.path };           // 路径形状不认识：不额外限制
  const owner = { ...paths, userId: options.userId };

  const rel = target.slice(mount.path.length).split(sep).filter((part) => part !== "");
  if (rel.length === 0) return { mount: mount.path };

  if (rel[0] === "users") {
    // 用户层（协议 §4.2.1 · Task 0035）：与 `agents/` 同形的范围判定。
    //
    // 为什么需要：`** /tasks/*/home/` 在 `.gitignore` 里 → 走到判据 ④（"git 看不见"）被放行，
    // 于是"在 A 的 fork 里写 B 项目的用户空间"会**成功**但 git 不 stage —— 正是下面
    // `scopeReasonOf` 说的"看起来写进去了，合并后却是旧值"（architect 2026-11-24 实测）。
    const uid = rel[1];
    if (uid === undefined) return { mount: mount.path };
    if (owner.userId !== undefined && uid !== owner.userId) {
      return { mount: mount.path, reason: `这里只检出用户「${owner.userId}」的空间，不含「${uid}」` };
    }
    // users/<uid>/projects/<pid>/…
    if (rel[2] === "projects") {
      const pid = rel[3];
      // 本 Task 所在的那个 pid + workspace（用户层默认项目）放行；其余一律拒。
      if (pid !== undefined && pid !== owner.projectId && pid !== "workspace") {
        return { mount: mount.path, reason: `本 Task 的工作区只检出「${owner.projectId}」的用户空间，不含「${pid}」` };
      }
    }
    return { mount: mount.path };
  }

  if (rel[0] === "agents") {
    const agent = rel[1];
    if (agent === undefined) return { mount: mount.path };
    if (agent !== owner.agentId) {
      return { mount: mount.path, reason: `这里是「${owner.agentId}」的工作区，不含 Agent「${agent}」的文件` };
    }
    // agents/<owner>/projects/<pid>/tasks/<dir>/…
    const tasksAt = rel.indexOf("tasks");
    if (rel[2] === "projects" && tasksAt !== -1) {
      const pid = rel[3];
      const dir = rel[tasksAt + 1];
      if (pid !== undefined && pid !== owner.projectId) {
        return { mount: mount.path, reason: `这里只检出「${owner.projectId}」的 Task，不含其它 project` };
      }
      if (dir !== undefined && dir !== owner.dirName) {
        return { mount: mount.path, reason: `本 Task 的工作区不含其他 Task（「${dir}」）；要改它请在该 Task 里做` };
      }
    }
  }
  return { mount: mount.path };
}

/** ①.5 的拒绝文案：说清"哪个工作区、不含什么"，并给出该往哪写。 */
function scopeReasonOf(target: string, reason: string): string {
  return `拒绝写入 ${target}\n原因：${reason}。\n`
    + `在这种位置写文件不会进任何检视源（工作区是 sparse 检出，git add -A 也会拒绝），\n`
    + `看起来写成功了，合并后却是旧值。要改别的 Task，请在那个 Task 里做。`;
}

/**
 * 从 `<taskDir>/home` 反推 owner（`agents/<a>/projects/<p>/tasks/<dir>`）。形状不认识 → undefined。
 *
 * `userId` 不在这里反推（路径里没有它）：由调用方从 `profile.currentUserId(home)` 取后
 * 经 `HomeScopeOptions` 传入。**纯函数不读盘**（与 `worktree-profile.ts` 同一条纪律）。
 */
function ownerOfHomeMount(mount: string): { agentId: string; projectId: string; dirName: string } | undefined {
  const parts = dirname(mount).split(sep);
  const n = parts.length;
  if (n < 5) return undefined;
  if (parts[n - 2] !== "tasks" || parts[n - 4] !== "projects") return undefined;
  const dirName = parts[n - 1];
  const projectId = parts[n - 3];
  const agentId = parts[n - 5];
  if (dirName === undefined || projectId === undefined || agentId === undefined) return undefined;
  return { agentId, projectId, dirName };
}

/** `parent` 是不是 `child` 的祖先（含相等）；按路径分隔符判，避免 `/a/bc` 误判 `/a/b`。 */
export function isUnder(parent: string, child: string): boolean {
  if (child === parent) return true;
  const withSep = parent.endsWith(sep) ? parent : `${parent}${sep}`;
  return child.startsWith(withSep);
}

/** 去掉 shell 参数外层的引号（`"a b"` → `a b`）：引号是语法，不是路径的一部分。
 *  这一步不能省：`bash "${script}"` 与 `git -C "…" add` 里路径是带引号的，
 *  不去引号会让 `readFile`/`isInsideWorktree` 全部落空 → 守卫静默失效（实测踩到）。 */
export function cleanArg(token: string): string {
  const trimmed = token.trim();
  if (trimmed.length >= 2 && ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'")))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

/** `~` 展开 + 相对路径按 `cwd` 解析（判据必须用**解析后的绝对路径**，否则相对路径绕过守卫）。 */
export function resolveTarget(raw: string, cwd: string, home: string): string {
  const trimmed = cleanArg(raw);
  const expanded = trimmed === "~" ? home
    : trimmed.startsWith("~/") ? join(home, trimmed.slice(2))
    : trimmed;
  return isAbsolute(expanded) ? resolve(expanded) : resolve(cwd, expanded);
}

// ── git 可见性（第 4 条判据）─────────────────────────────────────────────
//
// 判据是「git **完全看不见**」= ignored 且 未 tracked，不是"在 .gitignore 里"。
// 实测特例：`reference/AGENTS.md` 既被 `.gitignore:40 reference/` 忽略、又被 `add -f` 跟踪——
// 它是**主区文档**，必须拒；而 `reference/<clone>/src/x.ts` 同样 ignored 但未 tracked，
// 是用户明确允许 Agent 写的（clone 外部仓库）。

type Cache = { at: number; value: Set<string> | boolean };
const TRACKED_TTL_MS = 30_000;
const trackedCache = new Map<string, Cache>();
const ignoreCache = new Map<string, Cache>();

/** 真正 spawn 过 `git check-ignore` 的次数（诊断/测试用：证明"内存 Set 先短路"这层确实生效）。 */
export const writeGuardStats = { checkIgnoreCalls: 0, cacheResets: 0 };

/** 清空缓存（测试用；也用于合并后立刻失效）。 */
export function resetWriteGuardCaches(): void {
  trackedCache.clear();
  ignoreCache.clear();
  writeGuardStats.checkIgnoreCalls = 0;
  writeGuardStats.cacheResets += 1;
}

const git = async (home: string, args: string[]): Promise<string> =>
  (await run("git", ["-C", home, "-c", "core.quotePath=false", ...args], { timeout: 60_000, maxBuffer: 64 * 1024 * 1024 })).stdout;

/** 家目录仓的 tracked 文件集合（内存 Set，实测 3,155 条约 0.27 MB、加载 12 ms、查询 0.03 ms）。 */
export async function trackedFilesOf(home: string): Promise<Set<string>> {
  const cached = trackedCache.get(home);
  if (cached !== undefined && Date.now() - cached.at < TRACKED_TTL_MS && cached.value instanceof Set) return cached.value;
  const out = await git(home, ["ls-files", "-z"]).catch(() => "");
  const set = new Set(out.split("\0").filter((path) => path !== ""));
  trackedCache.set(home, { at: Date.now(), value: set });
  return set;
}

/**
 * 相对于家目录仓根的路径（不在仓内返回 undefined）；统一成 POSIX 分隔符，
 * 因为程序专属目录的匹配是按 `.gitignore` 的写法（`/`）写的。
 */
export function repoRelative(home: string, target: string): string | undefined {
  if (!isUnder(home, target)) return undefined;
  return target.slice(home.length).replace(/^[\\/]/, "").split(sep).join("/");
}

/**
 * git 是否**完全看不见**这个路径 = 未 tracked 且被 ignore。
 * 先查内存 Set（0.03 ms），未命中才跑 `git check-ignore`（10.9 ms，带进程内缓存）。
 */
export async function gitInvisible(home: string, target: string): Promise<boolean> {
  const relative = repoRelative(home, target);
  if (relative === undefined) return false;              // 不在家目录仓里：谈不上"git 看不见"
  const tracked = await trackedFilesOf(home);
  // **这层是性能优化，不是正确性**：实测 `git check-ignore` 对 tracked 文件本身就返回 exit 1
  //（`reference/AGENTS.md` 匹配 `reference/` 但被跟踪 → 不报 ignored）。
  // 所以去掉它行为不变，但每次多花 10.9ms 起进程——一轮写 10 个文件就是 110ms。
  // `writeGuardStats.checkIgnoreCalls` 锁住这一层真的在短路（`test/write-guard.test.mjs` 的 G10）。
  if (tracked.has(relative)) return false;
  const cached = ignoreCache.get(target);
  if (cached !== undefined && Date.now() - cached.at < TRACKED_TTL_MS && typeof cached.value === "boolean") return cached.value;
  writeGuardStats.checkIgnoreCalls += 1;
  const ignored = await run("git", ["-C", home, "check-ignore", "-q", target], { timeout: 30_000 })
    .then(() => true, () => false);
  ignoreCache.set(target, { at: Date.now(), value: ignored });
  return ignored;
}

// ── 当前 Task 的文档根（第 1 条判据）──────────────────────────────────────

export type TaskDocContext = { taskDir: string; docRoot: string };

const taskContextCache = new Map<string, { at: number; value: TaskDocContext | undefined }>();

/** 按 (agentId, projectId, taskId) 解析出 Task 目录与它的文档根；找不到返回 undefined（不猜）。 */
export async function taskDocContextOf(home: string, scope: GuardScope, taskId: string): Promise<TaskDocContext | undefined> {
  const key = `${home}\0${scope.agentId}\0${scope.projectId}\0${taskId}`;
  const cached = taskContextCache.get(key);
  if (cached !== undefined && Date.now() - cached.at < TRACKED_TTL_MS) return cached.value;
  const taskDir = await resolveTaskDir({ agentId: scope.agentId, projectId: scope.projectId }, taskId);
  const value = taskDir === undefined
    ? undefined
    : { taskDir, docRoot: await taskDocRootOf(taskDir, scope, basename(taskDir)) };
  taskContextCache.set(key, { at: Date.now(), value });
  return value;
}

/**
 * 五条判据（02-design §2.4，**顺序不能乱**）。前命中即返回。
 *
 * 顺序的要害：第 1 条必须在第 4 条之前——**工作区也在 `~/.lifeos` 下**
 *（`<taskDir>/home/agents/…`），先判主区会把工作区一起拒掉。
 */
export async function decideWrite(input: {
  home: string; scope: GuardScope; taskId: string | undefined; target: string;
  /** 当前使用者的 uid（协议 §4.2.1 · Task 0035）：只用于"别的 uid / 别的 pid 的用户空间"判定。
   *  由调用方从 `currentUserId(home)` 取；不传则跳过这一层（与改动前行为一致）。 */
  userId?: string;
}): Promise<WriteVerdict> {
  const { home, scope, taskId, target, userId } = input;

  // ① 当前 Task 的文档根（有工作区 = 工作区那份；默认 Task / 旧 Task = 主区 Task 目录）
  if (taskId !== undefined) {
    const context = await taskDocContextOf(home, scope, taskId);
    if (context !== undefined) {
      if (isUnder(context.docRoot, target)) {
        // **docRoot 是主区时，`<taskDir>/home|repo|worktree/…` 也在它之下**——
        // 而工作区已被摘除的 Task 主区里不该有这些挂载点。放行它们等于允许"自己给自己造一份假树"
        // （reviewer 2026-11-19 的 N2）。所以命中挂载点就要求它真是注册过的工作区。
        const fake = await fakeWorktreeOf(home, scope, taskId, target);
        if (fake !== undefined) return { allow: false, reason: fake };
        return { allow: true };
      }
      // ② 当前 Task 的项目代码工作区（不收窄、完整检出）
      if (isUnder(join(context.taskDir, REPO_DIR), target)) {
        // 同一条前置：`repo/` 目录存在但没建成工作区（非 git 项目）时不许往里写。
        const fake = await fakeWorktreeOf(home, scope, taskId, target);
        if (fake !== undefined) return { allow: false, reason: fake };
        return { allow: true };
      }
    }
  }

  // ③ 程序专属目录：`config/`、`sessions/`、`memory/{data,daemon,skills,logs}/` —— 一律拒。
  //    清单逐条对着 `.lifeos/.gitignore` 抄（见 `PROGRAM_ONLY`），**必须先于**判据 ④：
  //    这些坑全在 `.gitignore` 里，靠 ④ 拦不住（`G9`/`N3`/`N4` 锁住这个顺序）。
  const relative = repoRelative(home, target);
  const programOnly = programOnlyOf(relative);
  if (programOnly !== undefined) {
    const isConfig = /^config(\/|$)/.test(relative ?? "");
    return {
      allow: false,
      reason: `拒绝写入 ${target}\n原因：${programOnly}。`
        + (isConfig ? "\n配模型请用 PUT /api/agents/<id>/config。" : ""),
    };
  }

  // ④ git 完全看不见（ignored 且未 tracked）→ 允许：外部克隆与运行数据。
  //    例：`reference/<clone>/src/x.ts` 允许；`reference/AGENTS.md`（add -f 跟踪了）拒绝。
  //
  //    **但有一个前置**（reviewer 2026-11-19 核出的阻塞级缺陷）：`.lifeos/.gitignore:16-17`
  //    忽略 `** /tasks/<NNNN>/home/` 与 `** /tasks/<NNNN>/repo/`，所以这里会把**伪造的工作区**也放行——
  //    Pi 的 `write` 会 `mkdir -p` 父目录（`tools/write.ts:63-66`），主区里真会长出一份假树；
  //    随后 `taskDocRootOf`（只看 `task.md` 在不在，`task-doc-path.ts:27-31`）就把装配读根切过去，
  //    而那份假树没有分支、没有检视源 → 该 Task 从此"看起来在工作区形态"，改动绕过一切检视。
  //    所以：目标落在某个 `<taskDir>/home|repo|worktree` 之下时，那个挂载点必须是**真的**
  //    （`.lifeos-worktree.json` marker 或 `.git`，与 `home-check.ts` 的判定同一件事，
  //    实现复用 `task-worktree.ts` 的 `isRegisteredWorktree`）。
  if (await gitInvisible(home, target)) {
    const fake = await fakeWorktreeOf(home, scope, taskId, target);
    if (fake !== undefined) return { allow: false, reason: fake };
    // **①.5 范围判定**（e2e 2026-11-19 抓出的 P0）：挂载点是真的还不够，
    // 目标必须落在该挂载点**允许的范围**内。区分两种"写别的 Task"：
    //   ① `<B>/home/…/tasks/<B>/x.md`（B 的真工作区）→ 放行：改动进 B 的分支，B 的检视看得见（G8）；
    //   ② `<A>/home/…/tasks/<B>/x.md`（A 的 fork 里给 B 造主区文档）→ 拒：不进任何检视源，
    //      且 `git add -A` 会因 sparse 拒绝 → 用户以为写进去了，其实丢了。
    const scoped = worktreeScopeOf(target, { ...(userId !== undefined ? { userId } : {}) });
    if (scoped.mount !== undefined && scoped.reason !== undefined) {
      return { allow: false, reason: `${scopeReasonOf(target, scoped.reason)}` };
    }
    return { allow: true };
  }

  // ⑤ 其余一律拒：主区 Task 文档、主区共享层、项目主区…
  return {
    allow: false,
    reason: await denyReason(home, scope, taskId, target),
  };
}

/** 假工作区的拒绝文案：说清"缺什么"，并给出本 Task 的 docPath（完成标准 7：错误可行动）。 */
async function fakeWorktreeReason(home: string, scope: GuardScope, taskId: string | undefined, target: string, mount: string): Promise<string> {
  const hint = taskId === undefined ? undefined : await taskDocContextOf(home, scope, taskId);
  return `拒绝写入 ${target}\n`
    + `原因：${mount} 不是一个注册过的工作区（缺 .lifeos-worktree.json 或 .git）。\n`
    + `在工作区路径下写文件会造出一份"假工作区"——没有分支、没有检视源，\n`
    + `而装配器只判 task.md 在不在，会静默把读根切过去，从此这个 Task 的改动绕过检视。\n`
    + (hint === undefined ? "当前会话没有 Task 指针。" : `本 Task 的文档请写在：${hint.docRoot}`);
}

async function denyReason(home: string, scope: GuardScope, taskId: string | undefined, target: string): Promise<string> {
  const hint = taskId === undefined ? undefined : await taskDocContextOf(home, scope, taskId);
  const where = hint === undefined
    ? "当前会话没有 Task 指针"
    : `本 Task 的文档请写在工作区：${hint.docRoot}`;
  return `拒绝写入 ${target}\n原因：Task 的文档与共享层只由**合并**写入主区；直接写会绕过检视，\n`
    + `而且与工作区分支并发时会被 git 静默冲掉（主区未提交的改动 merge 不设防）。\n${where}`;
}

// ── bash 旁路（尽力而为，**不是安全边界**）────────────────────────────────
//
// 协议要明写：bash 守卫是尽力而为，真正的边界是检视——改动要么在某个 Task 的 worktree 里
//（能被检视），要么被拒。8 类已知漏各配一条红测（`test/write-guard.test.mjs`）。

/** 只读的 git 子命令（放行）。写类子命令在主区一律拒，**在工作区里放行**（Agent 要在自己分支上提交）。 */
const GIT_READ_ONLY = new Set([
  "status", "log", "diff", "show", "ls-files", "ls-tree", "rev-parse", "rev-list", "merge-base",
  "cat-file", "describe", "blame", "for-each-ref", "show-ref", "shortlog", "name-rev", "symbolic-ref",
  "diff-tree", "diff-files", "diff-index", "help", "--version", "grep", "check-ignore", "var",
]);

const WRITE_COMMANDS = new Set([
  "rm", "rmdir", "mkdir", "touch", "mv", "cp", "ln", "install", "truncate", "dd", "tee", "chmod", "chown", "patch",
]);

/** 由命令的结果反推"可能会写哪个路径"的形态。 */
const INTERPRETER = /^(python3?|node|perl|ruby|php|deno|bun)$/;

/** 从一段命令里抠出像路径的字符串（引号内、含 `/` 或已知后缀）。 */
function quotedPaths(segment: string): string[] {
  const out: string[] = [];
  for (const match of segment.matchAll(/"([^"]+)"|'([^']+)'/g)) {
    const text = match[1] ?? match[2] ?? "";
    if (text.includes("/") || /\.(md|txt|json|ts|tsx|js|mjs|py|sh|yml|yaml)$/.test(text)) out.push(text);
  }
  return out;
}

/** 把 `VAR=value` 的**字面**赋值抽出来，供第二类（变量拼接）解析；值必须是纯路径。 */
function literalAssignments(segment: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const match of segment.matchAll(/(?:^|[\s;])([A-Za-z_][A-Za-z0-9_]*)=("([^"]*)"|'([^']*)'|([^\s;|&]+))/g)) {
    const name = match[1];
    const value = match[3] ?? match[4] ?? match[5];
    if (name !== undefined && value !== undefined && (value.includes("/") || value.startsWith("~"))) out.set(name, value);
  }
  return out;
}

function expandVariables(text: string, vars: Map<string, string>): string {
  return text.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g,
    (whole, braced: string | undefined, bare: string | undefined) => vars.get(braced ?? bare ?? "") ?? whole);
}

/** 把命令切成"段"：`&&` `||` `;` 换行 `|`。heredoc 会自然落到同一段里，由下方单独处理。 */
function segmentsOf(command: string): string[] {
  return command.split(/&&|\|\||;|\n|\|/).map((part) => part.trim()).filter((part) => part !== "");
}

/** 从一段里取出重定向的目标（`> f`、`>> f`、`2> f`）。 */
function redirectTargets(segment: string): string[] {
  const out: string[] = [];
  for (const match of segment.matchAll(/\d?>>?\s*("[^"]+"|'[^']+'|[^\s;&|]+)/g)) {
    const raw = match[1];
    if (raw === undefined) continue;
    const value = raw.replace(/^["']|["']$/g, "");
    if (value !== "" && value !== "/dev/null" && !value.startsWith("&")) out.push(value);
  }
  return out;
}

/** 判断某个 git 调用是不是"写"，以及它作用在哪个仓上。 */
function gitVerdict(segment: string): { writes: boolean; repo?: string } {
  const tokens = segment.trim().split(/\s+/);
  const at = tokens.indexOf("git");
  if (at === -1) return { writes: false };
  let index = at + 1;
  let repo: string | undefined;
  while (index < tokens.length) {
    const token = tokens[index];
    const next = tokens[index + 1];
    if (token === "-C" && next !== undefined) { repo = cleanArg(next); index += 2; continue; }
    if (token !== undefined && token.startsWith("-")) { index += 1; continue; }
    break;
  }
  const sub = tokens[index];
  if (sub === undefined) return { writes: false, ...(repo !== undefined ? { repo } : {}) };
  if (GIT_READ_ONLY.has(sub)) return { writes: false, ...(repo !== undefined ? { repo } : {}) };
  // `git config --get/--list/-l` 是读
  if (sub === "config") {
    const read = tokens.some((token) => token === "--get" || token === "--list" || token === "-l" || token === "--get-regexp");
    return { writes: !read, ...(repo !== undefined ? { repo } : {}) };
  }
  // `git worktree list` 是读
  if (sub === "worktree" && tokens.includes("list")) return { writes: false, ...(repo !== undefined ? { repo } : {}) };
  // `git stash list` 是读
  if (sub === "stash" && tokens[index + 1] === "list") return { writes: false, ...(repo !== undefined ? { repo } : {}) };
  // `git branch` 不带 -d/-D/-m/-M 是读；`git tag` 不带参数是读
  if (sub === "branch") {
    const write = tokens.some((token) => ["-d", "-D", "-m", "-M", "-c", "-C", "--delete", "--move", "--copy", "--set-upstream-to", "--unset-upstream"].includes(token));
    return { writes: write, ...(repo !== undefined ? { repo } : {}) };
  }
  if (sub === "tag") return { writes: false, ...(repo !== undefined ? { repo } : {}) };
  return { writes: true, ...(repo !== undefined ? { repo } : {}) };
}

/** 路径是否落在某个 Task 的工作区里（`tasks/<NNNN>/home|repo|worktree`）。 */
export function isInsideWorktree(target: string): boolean {
  const parts = resolve(target).split(sep);
  // 边界：`.../tasks/<NNNN-x>/home` 的 NNNN 段在倒数第二，所以条件是 `i + 1 < parts.length`。
  // 写成 `i + 2 <` 是差一（实测：工作区根目录本身判不出来 → 放行的反倒被拒）。
  for (let i = 0; i + 1 < parts.length; i += 1) {
    if (/^\d{4}-/.test(parts[i] ?? "") && [HOME_DIR, REPO_DIR, "worktree"].includes(parts[i + 1] ?? "")) return true;
  }
  return false;
}

export type BashVerdict = { allow: true } | { allow: false; reason: string };

/**
 * bash 守卫：从命令里抽出"可能会被写的路径"，逐个走五条判据。
 *
 * 覆盖 8 类已知漏（02-design §2.4）：① `cd` 后写 ② 变量拼接 ③ 脚本里写 ④ git 子命令（分读写）
 * ⑤ 重定向进中间程序（tee / sed -i / perl -i）⑥ heredoc 与多命令 ⑦ mv / cp ⑧ 解释器一行流。
 * **这不是安全边界**：真正的边界是检视（改动要么在某个 Task 的 worktree 里，要么被拒）。
 */
export async function decideBash(input: {
  home: string; scope: GuardScope; taskId: string | undefined; command: string; cwd: string; depth?: number;
}): Promise<BashVerdict> {
  const depth = input.depth ?? 0;
  if (depth > 3) return { allow: true };        // 递归读脚本的上限：不无限展开
  const vars = new Map<string, string>();
  let cwd = input.cwd;

  for (const rawSegment of segmentsOf(input.command)) {
    const segment = expandVariables(rawSegment, vars);

    // ② 变量拼接：先吸收本段里的字面赋值
    for (const [name, value] of literalAssignments(segment)) vars.set(name, value);

    // ① `cd <path>` 之后的操作都相对新目录
    const cd = /^cd\s+("[^"]+"|'[^']+'|\S+)\s*$/.exec(segment);
    if (cd !== null) {
      cwd = resolveTarget((cd[1] ?? "").replace(/^["']|["']$/g, ""), cwd, input.home);
      continue;
    }

    // ④ git：写类子命令只在**工作区内**放行；主区的写（apply/checkout/reset/merge…）一律拒
    if (/(^|\s)git(\s|$)/.test(segment)) {
      const verdict = gitVerdict(segment);
      if (verdict.writes) {
        const repo = resolveTarget(verdict.repo ?? ".", cwd, input.home);
        if (!isInsideWorktree(repo)) {
          return {
            allow: false,
            reason: `拒绝执行：${segment}\n原因：git 写操作会让主区偏离"只由合并写入"（主区未提交的改动 merge 时不设防，会被静默冲掉）。\n`
              + `要在 Task 的分支上做事，请先 \`cd\` 进该 Task 的 repo/ 或 home/ 工作区再执行。`,
          };
        }
      }
    }

    // ③ 脚本 / 解释器：能读就读进来递归分析
    const firstToken = segment.split(/\s+/)[0] ?? "";
    if (["bash", "sh", "zsh", "source", "."].includes(firstToken)) {
      const scriptArg = segment.split(/\s+/).slice(1).find((token) => !token.startsWith("-"));
      if (scriptArg !== undefined) {
        const scriptPath = resolveTarget(scriptArg, cwd, input.home);
        const body = await readFile(scriptPath, "utf8").catch(() => undefined);
        if (body !== undefined) {
          const inner = await decideBash({ ...input, command: body, cwd: dirname(scriptPath), depth: depth + 1 });
          if (!inner.allow) return inner;
        }
      }
      continue;
    }

    // ⑧ 解释器一行流：`python3 -c "…"` / `node -e "…"`——把引号里的路径也拿出来判
    const targets: string[] = [];
    if (INTERPRETER.test(firstToken) && segment.split(/\s+/).some((token) => token === "-c" || token === "-e" || token === "--eval")) {
      targets.push(...quotedPaths(segment));
    }

    // ⑤⑥⑦ 命令类：重定向、tee、sed -i、perl -i、mv/cp/ln/rm/mkdir/touch…
    targets.push(...redirectTargets(segment));
    if (WRITE_COMMANDS.has(firstToken)) {
      const args = segment.split(/\s+/).slice(1).filter((token) => !token.startsWith("-")).map((token) => cleanArg(token));
      if (["mv", "cp", "ln", "install"].includes(firstToken)) {
        const dest = args.at(-1);
        if (dest !== undefined) targets.push(dest);
      } else {
        targets.push(...args);
      }
    }
    if (/(^|\s)sed\s+(-[a-zA-Z]*i|--in-place)/.test(segment) || /(^|\s)perl\s+-[a-zA-Z]*i/.test(segment)) {
      const last = segment.split(/\s+/).at(-1);
      if (last !== undefined) targets.push(last);
    }
    // `dd of=…`
    for (const match of segment.matchAll(/of=("[^"]+"|'[^']+'|\S+)/g)) {
      const raw = match[1]?.replace(/^["']|["']$/g, "");
      if (raw !== undefined) targets.push(raw);
    }
    // `cat > f <<EOF`：重定向已覆盖 f；`<<EOF` 之后的内容由 heredoc 解析跳过（不解析成命令）
    const heredoc = /<<-?\s*'?([A-Za-z_][A-Za-z0-9_]*)'?/.exec(segment);

    for (const raw of targets) {
      if (raw === "" || raw.includes("$") || raw.startsWith("-")) continue;
      const target = resolveTarget(raw, cwd, input.home);
      const verdict = await decideWrite({ home: input.home, scope: input.scope, taskId: input.taskId, target });
      if (!verdict.allow) {
        return {
          allow: false,
          reason: `拒绝执行：${segment}\n（它会写 ${target}）\n${verdict.reason}`,
        };
      }
    }
    void heredoc;
  }
  return { allow: true };
}

// ── 扩展到 Pi（tool_call 钩子）────────────────────────────────────────────

/** 与其它内联扩展用同一个类型（`assembly.ts` 同款导入）：不自定义形状，Pi 改接口时一处报错。 */
type RawExtension = InlineExtension;

/** 按路径写文件的工具（判据直接作用在 `input.path` 上）。**导出**：wiring 测试要盯住它（W4）。 */
export const WRITE_TOOLS: ReadonlySet<string> = new Set(["write", "edit"]);

/** 能间接写文件的命令执行工具（走 `decideBash`）。 */
export const BASH_TOOLS: ReadonlySet<string> = new Set(["bash", "powershell"]);

/**
 * 挂到会话上的写入守卫。`getTaskId` 每次调用现读（会话中途可切 Task，创建时取一次会永久滞后）。
 */
/**
 * 取当前用户 uid，**取不到返回 undefined**（不报错）。
 * 新装家目录在用户第一次改档案前没有 `users/<uid>/user.json` —— 那时"用户层不存在"是正常情形。
 */
async function getCurrentUserIdSafely(): Promise<string | undefined> {
  return existingUserId(resolveHome()).catch(() => undefined);
}

export function createLifeOsWriteGuardExtension(input: {
  agentId: string; projectId: string; getTaskId: () => string | undefined;
  /**
   * 取当前用户 uid（协议 §4.2.1）。由调用方注入，默认走 `profile.currentUserId`。
   * 注入点存在是为了测试能固定 uid，且**纯逻辑不读盘**这条纪律仍然成立。
   */
  getUserId?: () => Promise<string | undefined>;
}): RawExtension {
  const scope: GuardScope = { agentId: input.agentId, projectId: input.projectId };
  return {
    name: "lifeos-write-guard",
    hidden: true,
    factory: (pi) => {
      pi.on("tool_call", async (event, ctx) => {
        const typed = event as { toolName?: unknown; input?: Record<string, unknown> };
        const toolName = typeof typed.toolName === "string" ? typed.toolName : "";
        const home = resolveHome();
        const taskId = input.getTaskId();

        if (WRITE_TOOLS.has(toolName)) {
          const raw = typed.input?.path;
          if (typeof raw !== "string" || raw.trim() === "") return;   // 参数不合法交给工具自己报
          const target = resolveTarget(raw, ctx.cwd, home);
          const userId = await (input.getUserId ?? getCurrentUserIdSafely)();
          const verdict = await decideWrite({ home, scope, taskId, target, ...(userId !== undefined ? { userId } : {}) });
          if (!verdict.allow) return { block: true, reason: verdict.reason };
          return;
        }

        if (BASH_TOOLS.has(toolName)) {
          const command = typed.input?.command;
          if (typeof command !== "string" || command.trim() === "") return;
          const verdict = await decideBash({ home, scope, taskId, command, cwd: ctx.cwd });
          if (!verdict.allow) return { block: true, reason: verdict.reason };
        }
      });
    },
  };
}
