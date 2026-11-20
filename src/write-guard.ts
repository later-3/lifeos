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
import { taskDocRootOf } from "./task-doc-path.ts";
import { HOME_DIR, REPO_DIR } from "./task-worktree.ts";
import { resolveTaskDir } from "./tasks.ts";

const run = promisify(execFile);

export type GuardScope = { agentId: string; projectId: string };

export type WriteVerdict = { allow: true } | { allow: false; reason: string };

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
export const writeGuardStats = { checkIgnoreCalls: 0 };

/** 清空缓存（测试用；也用于合并后立刻失效）。 */
export function resetWriteGuardCaches(): void {
  trackedCache.clear();
  ignoreCache.clear();
  writeGuardStats.checkIgnoreCalls = 0;
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

/** 相对于家目录仓根的路径（不在仓内返回 undefined）。 */
function repoRelative(home: string, target: string): string | undefined {
  if (!isUnder(home, target)) return undefined;
  return target.slice(home.length).replace(/^[\\/]/, "");
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
}): Promise<WriteVerdict> {
  const { home, scope, taskId, target } = input;

  // ① 当前 Task 的文档根（有工作区 = 工作区那份；默认 Task / 旧 Task = 主区 Task 目录）
  if (taskId !== undefined) {
    const context = await taskDocContextOf(home, scope, taskId);
    if (context !== undefined) {
      if (isUnder(context.docRoot, target)) return { allow: true };
      // ② 当前 Task 的项目代码工作区（不收窄、完整检出）
      if (isUnder(join(context.taskDir, REPO_DIR), target)) return { allow: true };
    }
  }

  // ③ 唯一显式排除：`config/` 只由程序写。
  //
  // 依据（实测）：`config/models.json` 含 9 个 provider 的明文 apiKey；现有唯一保护是**读时**脱敏
  // （`server.ts` 的 `stripSecrets`），不防写；写坏 → 全部 Agent 无法调模型 → 系统级故障。
  // 也没有"Agent 需要写 config/"的合法场景（配模型走 `PUT /api/agents/:id/config`）。
  if (isUnder(join(home, "config"), target)) {
    return {
      allow: false,
      reason: `拒绝写入 ${target}\n原因：config/ 只由程序写（models.json 里有明文密钥，写坏会让所有 Agent 无法调模型）。\n配模型请用 PUT /api/agents/<id>/config。`,
    };
  }

  // ④ git 完全看不见（ignored 且未 tracked）→ 允许：外部克隆与运行数据。
  //    例：`reference/<clone>/src/x.ts` 允许；`reference/AGENTS.md`（add -f 跟踪了）拒绝。
  if (await gitInvisible(home, target)) return { allow: true };

  // ⑤ 其余一律拒：主区 Task 文档、主区共享层、项目主区…
  return {
    allow: false,
    reason: await denyReason(home, scope, taskId, target),
  };
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

const WRITE_TOOLS = new Set(["write", "edit"]);

/**
 * 挂到会话上的写入守卫。`getTaskId` 每次调用现读（会话中途可切 Task，创建时取一次会永久滞后）。
 */
export function createLifeOsWriteGuardExtension(input: {
  agentId: string; projectId: string; getTaskId: () => string | undefined;
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
          const verdict = await decideWrite({ home, scope, taskId, target });
          if (!verdict.allow) return { block: true, reason: verdict.reason };
          return;
        }

        if (toolName === "bash" || toolName === "powershell") {
          const command = typed.input?.command;
          if (typeof command !== "string" || command.trim() === "") return;
          const verdict = await decideBash({ home, scope, taskId, command, cwd: ctx.cwd });
          if (!verdict.allow) return { block: true, reason: verdict.reason };
        }
      });
    },
  };
}
