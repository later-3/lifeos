// 家目录安装：模板 = 仓库根 .lifeos/，安装 = 一次性整树复制。
// 语义（2026-10-17 定）：家目录已有内容 → 只提醒并停止，一个字节都不改；不存在/为空 → 复制 + 写收据。
// 服务启动不执行安装（见 main.ts），只校验家目录存在。
import { chmod, cp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

/** 家目录：默认 ~/.lifeos，可用 LIFEOS_HOME 覆盖（引导/测试用）。 */
export function resolveHome(): string {
  const fromEnv = process.env.LIFEOS_HOME?.trim();
  return fromEnv === undefined || fromEnv === "" ? join(homedir(), ".lifeos") : fromEnv;
}

/** 家目录模板（仓库根）：骨架与内容的唯一事实源，代码里不再另写目录清单。 */
export const TEMPLATE_DIR = ".lifeos";

export async function pathExists(path: string): Promise<boolean> {
  return stat(path).then(() => true, () => false);
}

type Item = { kind: "dir" | "file"; path: string; action: "created" };

export type InstallResult = { status: "installed" | "exists"; items: ReadonlyArray<Item> };

async function listFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) out.push(...await listFiles(path));
    else if (entry.isFile()) out.push(path);
  }
  return out.sort();
}

/** 去掉模板占位文件（.gitkeep 是 Git 跟踪空目录的手段，不进家目录）。 */
async function stripGitkeep(root: string): Promise<void> {
  for (const path of await listFiles(root)) {
    if (path.endsWith("/.gitkeep") || path.endsWith("\\.gitkeep")) await rm(path, { force: true });
  }
}

/** 模板里的仓库路径占位（`__REPO_ROOT__`，目前只用于 LifeOS 项目身份）替换成真实仓库路径。 */
export const REPO_ROOT_PLACEHOLDER = "__REPO_ROOT__";

async function fillRepoRoot(root: string, repoRoot: string): Promise<void> {
  for (const path of await listFiles(root)) {
    if (!path.endsWith(".json") && !path.endsWith(".md")) continue;
    const text = await readFile(path, "utf8");
    if (!text.includes(REPO_ROOT_PLACEHOLDER)) continue;
    await writeFile(path, text.split(REPO_ROOT_PLACEHOLDER).join(repoRoot), { encoding: "utf8", mode: 0o600 });
  }
}

/** 隐私收敛：家目录目录 0700、文件 0600。 */
async function tightenPermissions(root: string): Promise<void> {
  const entries = await readdir(root, { withFileTypes: true });
  await chmod(root, 0o700);
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) await tightenPermissions(path);
    else if (entry.isFile()) await chmod(path, 0o600);
  }
}

/**
 * 执行安装。
 * - 家目录已有内容 → 不动任何东西，返回 { status: "exists" }（调用方负责提醒并停止）；
 * - 家目录不存在或为空 → 从模板整树复制、清理占位文件、收敛权限、写安装收据。
 */
export async function installHome(repoRoot: string, home = resolveHome()): Promise<InstallResult> {
  const template = join(repoRoot, TEMPLATE_DIR);
  if (!await pathExists(template)) {
    throw new Error(`找不到家目录模板：${template}（仓库不完整？）`);
  }
  const existing = await readdir(home).then((entries) => entries.length > 0, () => false);
  if (existing) return { status: "exists", items: [] };

  const sources = await listFiles(template);
  await cp(template, home, { recursive: true, force: true });
  await fillRepoRoot(home, resolve(repoRoot));
  await stripGitkeep(home);
  await tightenPermissions(home);

  const items: Item[] = [];
  for (const source of sources) {
    const rel = source.slice(template.length + 1);
    if (rel.endsWith(".gitkeep")) continue;
    items.push({ kind: "file", path: rel, action: "created" });
  }
  const receipt = { schemaVersion: 1, installedAt: new Date().toISOString(), home, template: TEMPLATE_DIR, items };
  await writeFile(join(home, "install-receipt.json"), JSON.stringify(receipt, null, 2) + "\n", { encoding: "utf8", mode: 0o600 });
  items.push({ kind: "file", path: "install-receipt.json", action: "created" });
  return { status: "installed", items };
}
