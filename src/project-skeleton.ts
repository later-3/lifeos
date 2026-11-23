// 结构骨架（协议 §5）：每个协作层、每个子目录的 AGENTS.md 文字都从协议目录 `interaction-harness/skeleton/` 读取，
// 代码只负责按结构创建（模板是唯一事实源，代码不另写一份说明文字）。
// create-only：已存在的文件绝不覆盖（用户的记录不能被初始化逻辑冲掉）。
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { resolveHome } from "./home.ts";

/** 读协议目录下的骨架模板（安装时已复制到家目录；缺失即明确失败，不静默降级）。 */
export async function skeletonText(name: string): Promise<string> {
  const path = join(resolveHome(), "interaction-harness", "skeleton", `${name}.md`);
  const text = await readFile(path, "utf8").catch(() => undefined);
  if (text === undefined) throw new Error(`缺少骨架模板：${path}（家目录是否安装完整？）`);
  return text;
}

async function writeIfMissing(path: string, content: string): Promise<void> {
  await writeFile(path, content, { encoding: "utf8", mode: 0o600, flag: "wx" }).catch(() => { /* 已存在：不覆盖 */ });
}

/** 建目录并放上它的说明文件（AGENTS.md 模板名 = 目录名，来自协议目录 skeleton/）。 */
async function dirWithNote(dir: string, name: string): Promise<void> {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await writeIfMissing(join(dir, "AGENTS.md"), await skeletonText(name));
}

/** 各协作层共有的子结构（协议 §5.1）：概念、飞轮、规范、案例、知识、工具、待办、记忆、任务类型。 */
async function commonLayer(dir: string, withMemory: boolean): Promise<void> {
  await writeIfMissing(join(dir, "concept-space.md"), await skeletonText("concept-space"));
  await writeIfMissing(join(dir, "flywheel.md"), await skeletonText("flywheel"));
  await dirWithNote(join(dir, "specs"), "specs");
  await writeIfMissing(join(dir, "specs", "index.json"), JSON.stringify({ schemaVersion: 1, specs: [] }, null, 2) + "\n");
  await dirWithNote(join(dir, "cases"), "cases");
  await dirWithNote(join(dir, "knowledge"), "knowledge");
  await dirWithNote(join(dir, "tools"), "tools");
  await dirWithNote(join(dir, "todo"), "todo");
  await dirWithNote(join(dir, "task-types"), "task-types");
  if (withMemory) await dirWithNote(join(dir, "memory"), "memory");
}

/** 共享层（共享 workspace 或共享项目，`projects/<pid>/`）：project.json 只在这一层（协议 §5.3）。 */
export async function ensureSharedLayer(dir: string, project: { id: string; name: string; path?: string; icon?: string }): Promise<void> {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const manifest = {
    schemaVersion: 1,
    id: project.id,
    name: project.name,
    ...(project.path !== undefined ? { path: project.path } : {}),
    ...(project.icon !== undefined ? { icon: project.icon } : {}),
  };
  await writeIfMissing(join(dir, "project.json"), JSON.stringify(manifest, null, 2) + "\n");
  await writeIfMissing(join(dir, "AGENTS.md"), await skeletonText("layer-shared"));
  await commonLayer(dir, true);
}

/** Agent × 项目（`agents/<id>/projects/<pid>/`）：只属于该 Agent；会话与任务在这一层。 */
export async function ensureAgentProjectLayer(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await writeIfMissing(join(dir, "AGENTS.md"), await skeletonText("layer-project"));
  await commonLayer(dir, true);
  await dirWithNote(join(dir, "sessions"), "sessions");
  await dirWithNote(join(dir, "tasks"), "tasks");
}

/** Agent 本身（`agents/<id>/`）：配置、身份、独有的工具与记忆；不设飞轮与案例。 */
export async function ensureAgentLayer(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await writeIfMissing(join(dir, "AGENTS.md"), await skeletonText("layer-agent"));
  await dirWithNote(join(dir, "tools"), "tools");
  await dirWithNote(join(dir, "memory"), "memory");
}

/** Task 的共同结构（协议 §5.1）；task.md 与日志（log.md / daily/）由 tasks.ts 按类型写。 */
export async function ensureTaskSkeleton(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await writeIfMissing(join(dir, "AGENTS.md"), await skeletonText("task"));
  await writeIfMissing(join(dir, "concept-space.md"), await skeletonText("concept-space"));
  await writeIfMissing(join(dir, "flywheel.md"), await skeletonText("flywheel"));
  await dirWithNote(join(dir, "specs"), "specs");
  await writeIfMissing(join(dir, "specs", "index.json"), JSON.stringify({ schemaVersion: 1, specs: [] }, null, 2) + "\n");
  await dirWithNote(join(dir, "cases"), "cases");
  await dirWithNote(join(dir, "knowledge"), "knowledge");
  await dirWithNote(join(dir, "tools"), "tools");
  await dirWithNote(join(dir, "todo"), "todo");
}

// ——————————————— 用户层（`users/<uid>/`，协议 §4.2.1 · Task 0035）———————————————
//
// 形状由 architect 2026-11-24 裁定（`0003/phases/S1-delivery.md` §9.1 修正版）：
//   users/<uid>/{user.json, avatar-<rev>.<ext>, AGENTS.md, projects/<pid>/…}
//   users/<uid>/projects/<pid>/{AGENTS.md, knowledge/, daily/, todo/, tools/}
//
// **只有这五样**（全部有现场消费方）：
//   · `knowledge/` —— 成文笔记（B4–B6）；
//   · `daily/`    —— 日记（用户层没有 Task，所以这类内容落在层上）；
//   · `todo/`     —— 用户自己的待办；
//   · `tools/`    —— 用户的工具登记（S4.5 要显示）。
//
// **刻意没有**（每条都有否决理由，别"照着 Agent 层抄"就加回来）：
//   · `sessions/`  —— P6：用户层不提供对话能力（不可协商）；
//   · `tasks/`、`task-types/` —— Task 属于 Agent × project（§3.7）；
//   · `memory/`    —— 用户记忆物理位置仍是 `memory/user/<uid>/`（§3.11、`src/memory/roles.ts:36`），
//                    再放一份 = 第二处事实源；
//   · `specs/`、`cases/`、`flywheel.md`、`concept-space.md` —— 它们的作用是"被装配/被加载"，
//                    而用户层不参与 §4.3 装配（§4.3 已写明）——放一份没人读的正是 architecture 2.1 的陷阱。
//
// `workspace` 也是 `projects/` 下的一份（不是顶层）：它本身就是全局项目
// （`project-registry.ts` 的 `SHARED_WORKSPACE_ID`，`listGlobalProjects()` 一并返回），
// Agent 侧也在 `projects/workspace` —— 否则"每个全局项目一份"要分两类判。

/** 用户 × 项目层的子结构（§9.1 修正版：只有这四样）。 */
async function userProjectLayer(dir: string): Promise<void> {
  await dirWithNote(join(dir, "knowledge"), "knowledge");
  await dirWithNote(join(dir, "daily"), "daily");
  await dirWithNote(join(dir, "todo"), "todo");
  await dirWithNote(join(dir, "tools"), "tools");
}

/**
 * 用户 × project（`users/<uid>/projects/<pid>/`，`workspace` 也走这里）：说明文件 + 四样子结构。
 *
 * create-only（backend 2.2）：这里会碰到用户自己写的笔记与待办，覆盖就是丢用户内容。
 */
export async function ensureUserProjectLayer(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await writeIfMissing(join(dir, "AGENTS.md"), await skeletonText("layer-user-project"));
  await userProjectLayer(dir);
}

/**
 * 用户层根（`users/<uid>/`）：说明文件 + `projects/`（含 workspace 一份）。
 *
 * 不建 `user.json`：实体由 `profile.ts` 的 `writeProfile` 写（唯一来源，§4.2.1）。
 * 两处各写一半会让"谁是用户"有两个答案。
 */
export async function ensureUserLayer(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await writeIfMissing(join(dir, "AGENTS.md"), await skeletonText("layer-user"));
  await ensureUserProjectLayer(join(dir, "projects", "workspace"));
}
