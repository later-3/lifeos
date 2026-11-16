// 工作区的提交身份（协议 §3.7「提交与署名」）。
//
// 要解决的问题（2026-11-16 实测）：Agent 的提交署名**靠记性**。会写 `git -c user.name=…`
// 的那几个 Agent 有署名（coder 31 条、frontend-developer 33 条），其余 314 条全落成用户的
// 全局身份 `later-3`；2026-11-12 改用 Task 工作区之后，`-c` 写法消失，署名一并归零
// （`--since=2026-11-11` 的 Agent 署名提交 0 条）。于是"这段代码是谁写的"只能靠分支名反查。
//
// 做法：身份写进**工作区自己**的 git 配置，由建工作区的动作完成，不依赖 Agent 传参。
// - `.git/config`（仓公共）只加一行 `extensions.worktreeConfig=true`——per-worktree 配置的前提；
// - `.git/worktrees/<name>/config.worktree`（这个工作区独占）写 `user.name` / `user.email`；
// - 主区不写 `user.*`，所以用户在 main 上的提交仍是他的全局身份。
//
// 实测（git 2.37.1，临时仓）：开扩展后 `worktree add` 与 `merge --no-ff` 均正常；
// 工作区提交 = `agent-a <a@lifeos.local>`、主区提交 = 全局身份，互不干扰；
// 已存在的工作区在开扩展后仍可提交（回落全局），补 `--worktree` 配置后立刻生效。
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

/** Agent 身份的邮箱域：本地部分就是 agentId，机器可解析出"谁写的"。 */
export const IDENTITY_DOMAIN = "lifeos.local";

/** 系统自动存档的身份（建工作区前存档、合入前存档）：**不得**冒充 Agent。 */
export const SYSTEM_IDENTITY = { name: "Life OS", email: "lifeos@localhost" };

export type Identity = { name: string; email: string };

/** 某个 Agent 在工作区里应有的提交身份。 */
export function identityOf(agentId: string): Identity {
  return { name: agentId, email: `${agentId}@${IDENTITY_DOMAIN}` };
}

/** 邮箱是不是本协议的 Agent 身份（`<agentId>@lifeos.local`）。 */
export function agentIdOfEmail(email: string): string | undefined {
  const at = `@${IDENTITY_DOMAIN}`;
  if (!email.endsWith(at)) return undefined;
  const local = email.slice(0, -at.length);
  return local === "" ? undefined : local;
}

export type IdentityJudgement = {
  /** ok = 身份正确；missing = 工作区没设身份（提交会落成用户身份）；wrong = 设错了；no-extension = 仓没开 worktreeConfig。 */
  state: "ok" | "missing" | "wrong" | "no-extension";
  /** 给人看的一句话，能直接判断下一步做什么。 */
  detail: string;
};

/**
 * 判断一个工作区的身份现状（纯函数，喂给测试与 `pnpm worktree:identity --check`）。
 *
 * `worktreeConfig` 是该工作区**生效**的 `user.name`/`user.email`（未设置就是 undefined）；
 * `extension` 是仓公共配置里 `extensions.worktreeConfig` 是否为 true。
 */
export function judgeIdentity(input: {
  agentId: string;
  /** 工作区级（`git config --worktree`）的 user.name。 */
  worktreeName?: string;
  /** 工作区级（`git config --worktree`）的 user.email。 */
  worktreeEmail?: string;
  extension: boolean;
}): IdentityJudgement {
  const expected = identityOf(input.agentId);
  if (!input.extension) {
    return {
      state: "no-extension",
      detail: "仓没开 extensions.worktreeConfig：工作区无法单独设置身份（提交会落成用户的全局身份）",
    };
  }
  if (input.worktreeName === undefined || input.worktreeEmail === undefined) {
    return {
      state: "missing",
      detail: `工作区没设身份：提交会落成用户的全局身份，应设为 ${expected.name} <${expected.email}>`,
    };
  }
  if (input.worktreeName !== expected.name || input.worktreeEmail !== expected.email) {
    return {
      state: "wrong",
      detail: `身份不对：现在是 ${input.worktreeName} <${input.worktreeEmail}>，应为 ${expected.name} <${expected.email}>`,
    };
  }
  return { state: "ok", detail: `身份正确：${expected.name} <${expected.email}>` };
}

export type ApplyResult = { ok: true } | { ok: false; reason: string };

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await run("git", ["-C", cwd, "-c", "core.quotePath=false", ...args], {
    timeout: 60_000,
    maxBuffer: 4 * 1024 * 1024,
    env: { ...process.env, LC_ALL: "C" },
  });
  return stdout;
}

/** 建工作区之后调用：把身份写进这个工作区（幂等）。`repo` 是仓的任一路径（工作区自身也行）。 */
export async function applyWorktreeIdentity(input: {
  worktree: string;
  agentId: string;
}): Promise<ApplyResult> {
  const expected = identityOf(input.agentId);
  try {
    // ① 仓公共配置：per-worktree 开关。已开时 set 同值是幂等操作，不报错。
    await git(input.worktree, ["config", "extensions.worktreeConfig", "true"]);
    // ② 这个工作区独占的配置：只写它自己的 identity。
    await git(input.worktree, ["config", "--worktree", "user.name", expected.name]);
    await git(input.worktree, ["config", "--worktree", "user.email", expected.email]);
    return { ok: true };
  } catch (error) {
    // 失败不静默（后端规范 2.9）：交给调用方写进建 Task 的回执，Agent 看到后按协议显式传 `-c`。
    const detail = error instanceof Error ? error.message.split("\n")[0] ?? "" : String(error);
    return { ok: false, reason: `工作区身份写入失败（${detail || "未知错误"}）：提交前显式传 -c user.name=${expected.name} -c user.email=${expected.email}` };
  }
}

/** 读一个工作区**当前生效**的身份（`--worktree` 只读工作区独占的那份，没设置就是 undefined）。 */
export async function readWorktreeIdentity(worktree: string): Promise<{
  extension: boolean;
  worktreeName?: string;
  worktreeEmail?: string;
}> {
  const read = async (args: string[]): Promise<string | undefined> => {
    try {
      const value = (await git(worktree, args)).trim();
      return value === "" ? undefined : value;
    } catch {
      return undefined;
    }
  };
  const extension = (await read(["config", "--get", "extensions.worktreeConfig"])) === "true";
  const worktreeName = await read(["config", "--worktree", "--get", "user.name"]);
  const worktreeEmail = await read(["config", "--worktree", "--get", "user.email"]);
  return {
    extension,
    ...(worktreeName === undefined ? {} : { worktreeName }),
    ...(worktreeEmail === undefined ? {} : { worktreeEmail }),
  };
}
