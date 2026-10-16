// 家目录安装：创建目录结构、安装随包资产、写安装收据。幂等：内容相同则跳过。
import { createHash } from "node:crypto";
import { cp, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, relative } from "node:path";

/** 家目录：默认 ~/.lifeos，可用 LIFEOS_HOME 覆盖（引导/测试用）。 */
export function resolveHome(): string {
  const fromEnv = process.env.LIFEOS_HOME?.trim();
  return fromEnv === undefined || fromEnv === "" ? join(homedir(), ".lifeos") : fromEnv;
}

const DIRS = ["config", "interaction-harness", "agents", "projects", "workspaces", "runtime", "logs"] as const;
const ASSETS = [
  { id: "interaction-harness", from: "assets/interaction-harness", to: "interaction-harness" },
  { id: "agents", from: "assets/agents", to: "agents" },
] as const;

type Item = { id: string; kind: "dir" | "asset" | "file"; path: string; action: "created" | "kept" | "updated" };

async function listFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) out.push(...await listFiles(path));
    else if (entry.isFile()) out.push(path);
  }
  return out.sort();
}

async function sha256(file: string): Promise<string> {
  return createHash("sha256").update(await readFile(file)).digest("hex");
}

/** 执行安装，返回收据条目。 */
export async function installHome(repoRoot: string, home = resolveHome()): Promise<ReadonlyArray<Item>> {
  const items: Item[] = [];
  for (const dir of DIRS) {
    const path = join(home, dir);
    const existed = await stat(path).then(() => true, () => false);
    await mkdir(path, { recursive: true, mode: 0o700 });
    items.push({ id: `dir.${dir}`, kind: "dir", path: dir, action: existed ? "kept" : "created" });
  }
  for (const asset of ASSETS) {
    const from = join(repoRoot, asset.from);
    const to = join(home, asset.to);
    for (const source of await listFiles(from)) {
      const rel = relative(from, source);
      const target = join(to, rel);
      await mkdir(join(target, ".."), { recursive: true, mode: 0o700 });
      const same = await stat(target).then(() => true, () => false)
        && await sha256(source) === await sha256(target);
      if (!same) await cp(source, target, { force: true });
      items.push({ id: `${asset.id}:${rel}`, kind: "asset", path: join(asset.to, rel), action: same ? "kept" : "updated" });
    }
  }
  const receipt = { schemaVersion: 1, installedAt: new Date().toISOString(), home, items };
  const receiptPath = join(home, "install-receipt.json");
  await writeFile(receiptPath, JSON.stringify(receipt, null, 2) + "\n", "utf8");
  items.push({ id: "install-receipt", kind: "file", path: "install-receipt.json", action: "updated" });
  return items;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const home = resolveHome();
  const items = await installHome(process.cwd(), home);
  const count = (action: Item["action"]) => items.filter(item => item.action === action).length;
  console.log(`家目录: ${home}`);
  console.log(`created ${count("created")} / updated ${count("updated")} / kept ${count("kept")}`);
  for (const item of items) console.log(`  ${item.action.padEnd(7)} ${item.path}`);
}
