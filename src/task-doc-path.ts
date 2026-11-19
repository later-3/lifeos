// Task 的文档读根（协议 §3.7「Task 的工作区」「读侧能穿透」）。
//
// 为什么单独一个模块：这条判定有两个消费者——业务层（`tasks.ts` 的 `taskDocPathOf`、装配、
// review）与结构校验（`home-check.ts` 的 `checkTask`）。两处各写一份就会出现"业务读到工作区版、
// 校验读主区版"，而且**不会报错**（2026-11-19 实测：`home:check` 因此报了 42 条假阳性）。
// 所以路径公式只在这里一份（`specs/code/api/api.md` 2.7：一个事实一处实现）。
//
// 判据是「工作区里那份 `task.md` 在不在」，**不看目录是否存在**：工作区可能建了一半
// （`git worktree add` 之后 sparse-checkout 失败），那时目录在、文档不在，读它等于读空。
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { HOME_DIR } from "./task-worktree.ts";

export type TaskScope = { agentId: string; projectId: string };

/**
 * 家目录工作区里这份 Task 文档的目录（**只算路径，不看存在**）。
 *
 * 形状：`<taskDir>/home/agents/<agentId>/projects/<projectId>/tasks/<NNNN-标题>/`
 * —— 工作区是整份家目录的检出，所以 Task 在里面的相对位置与主区一致。
 */
function taskWorktreeDocPathOf(taskDir: string, scope: TaskScope, dirName: string): string {
  return join(taskDir, HOME_DIR, "agents", scope.agentId, "projects", scope.projectId, "tasks", dirName);
}

/** 文档读根：工作区里有 `task.md` 就是工作区里那份，否则退回主区（`taskDir` 本身）。 */
export async function taskDocRootOf(taskDir: string, scope: TaskScope, dirName: string): Promise<string> {
  const inWorktree = taskWorktreeDocPathOf(taskDir, scope, dirName);
  const info = await stat(join(inWorktree, "task.md")).catch(() => undefined);
  return info?.isFile() === true ? inWorktree : taskDir;
}
