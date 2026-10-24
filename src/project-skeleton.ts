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
export async function ensureSharedLayer(dir: string, project: { id: string; name: string; path?: string }): Promise<void> {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const manifest = {
    schemaVersion: 1,
    id: project.id,
    name: project.name,
    ...(project.path !== undefined ? { path: project.path } : {}),
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
