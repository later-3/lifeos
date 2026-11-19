// Task 工作区挂载点的唯一判据（协议 §3.7「Task 的工作区」；Task 0004 · P1）。
//
// 为什么单独一个模块：三处消费方语义相同、写法各异——读文档（`task-doc-path.ts`）、
// 检视定位源（`review.ts`）、结构校验（`home-check.ts`）。每加一个"递归扫描"功能就要
// 有人记得跳一次 `home/`，漏一次就**静默重复、不报错**（Task 0004 02-design §1、§3.1；
// `specs/code/api/api.md` 2.7「一个事实一处实现」）。
//
// 判据分两层，边界是这条模块最要紧的地方：
//
//   ① **名字**：`home` / `repo` / 历史 `worktree`（协议保留名，见 `task-worktree.ts`）。
//   ② **父目录是 Task 目录**（`NNNN-标题`）。
//
// 两条同时成立才算挂载点。所以：
//
//   `<taskDir>/home`                                  → true   （挂载点本身）
//   `<taskDir>/home/agents/a/projects/p/tasks/1/task.md` → false  （挂载点**里面**的深层文件）
//   `reference/lobehub/src/store/home`                 → false  （名字像，父目录不是 Task 目录）
//   `.git/worktrees/home`                              → false  （git 自己的管理目录）
//
// 第二条不能省：只按名字判定的话，外部参考仓库里叫 `home` 的源码目录、
// `.git/worktrees/` 下的 worktree 管理目录都会被当成挂载点跳过（2026-11-19 实测：
// `~/.lifeos` 里有 20 个这样的同名目录）。
//
// 第一条边界同样不能省：如果把"路径里含 `/home/`"当成挂载点，`home:check` 会把
// **整棵子树**当成挂载点跳过，真实漂移静默消失——这正是 `specs/code/testing/testing.md`
// 2.4 说的"门禁要能变红"要防的事。
//
// 本模块是**纯路径判定**：不读盘、不判存在。理由：工作区可能建了一半（`git worktree add`
// 成功、sparse-checkout 失败），那时目录在、内容不在，它仍然**不该**被当成协作层去要求
// 说明文件（`home-check.ts` 头注「两条形态前提」②）。
import { basename, dirname } from "node:path";
import { HOME_DIR, REPO_DIR } from "./task-worktree.ts";

/** 历史形态的挂载点目录名（协议 §3.7 之前的 Task 把 worktree 放在 Task 根下，如 reviewer 0003）。 */
const LEGACY_WORKTREE_DIR = "worktree";

/** 三种挂载点的目录名。顺序即 `worktreeMountKindOf` 的返回类型。 */
export type WorktreeMountKind = typeof HOME_DIR | typeof REPO_DIR | typeof LEGACY_WORKTREE_DIR;

const MOUNT_KINDS = new Set<string>([HOME_DIR, REPO_DIR, LEGACY_WORKTREE_DIR]);

/** Task 目录名：协议 §3.7 `NNNN-标题`（`0001-default` 也在此列）。 */
const TASK_DIR_NAME = /^\d{4}-/;

/**
 * 这个路径**本身**是不是 Task 的工作区挂载点；是则返回种类，否则 `undefined`。
 *
 * 比 `isWorktreeMount` 细一档：检视的扫描分支要**只跳 home**（它是文档源）、
 * 反过来要**认 worktree**（它是历史形态的项目代码源），布尔判定表达不了这个区别。
 * 详见 `review.ts` 的 `locateSources` 与 `test/worktree-mount.test.mjs` 的 T5。
 */
export function worktreeMountKindOf(path: string): WorktreeMountKind | undefined {
  // `basename`/`dirname` 都吃掉末尾分隔符：`<taskDir>/home/` 与 `<taskDir>/home` 等价。
  const name = basename(path);
  if (!MOUNT_KINDS.has(name)) return undefined;
  if (!TASK_DIR_NAME.test(basename(dirname(path)))) return undefined;
  return name as WorktreeMountKind;
}

/**
 * 这个路径本身是 Task 的工作区挂载点吗（`home` / `repo` / 历史 `worktree`）。
 *
 * **只判定"路径本身就是挂载点"，不判定"路径在挂载点里面"**——后者是真阳性，
 * 深层文件必须能被扫描到；混淆会让真问题静默消失（Task 0004 完成标准 9）。
 */
export function isWorktreeMount(path: string): boolean {
  return worktreeMountKindOf(path) !== undefined;
}
