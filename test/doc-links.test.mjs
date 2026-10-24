// 文档门禁（协议 §5.2 / §3.3 可检查）：① .lifeos 与根文档里的相对链接必须解析；② 根 AGENTS.md
// 场景入口地图所指的 .md 必须存在；③ 扫描量下限，避免"检查代码被删也全绿"的假活。
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, stat, readdir } from "node:fs/promises";
import { join, dirname, resolve } from "node:path";

const repo = process.cwd();

async function walk(dir, out = []) {
  for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    if (entry.name.startsWith(".") || entry.name === "pi") continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) await walk(path, out);
    else if (entry.name.endsWith(".md")) out.push(path);
  }
  return out;
}

test("相对链接全部可解析（模板 .lifeos + 根 AGENTS.md/README.md）", async () => {
  const files = [...await walk(join(repo, ".lifeos")), join(repo, "AGENTS.md"), join(repo, "README.md")];
  let checked = 0;
  const broken = [];
  for (const file of files) {
    const text = await readFile(file, "utf8").catch(() => null);
    if (text === null) continue;
    for (const match of text.matchAll(/\]\(([^)\s]+)(#[^)]*)?\)/g)) {
      const target = match[1];
      if (/^(https?:)?\/\//.test(target) || target.startsWith("#")) continue;
      checked += 1;
      const path = resolve(dirname(file), target);
      if (await stat(path).then(() => true, () => false) === false) broken.push(`${file.replace(repo, ".")} -> ${target}`);
    }
  }
  assert.ok(checked >= 15, `相对链接扫描量过少（${checked}），检查可能已失效`);
  assert.deepEqual(broken, [], "断链：\n" + broken.join("\n"));
});

test("根 AGENTS.md 的场景入口地图：所指 .md 全部存在，条目数有下限", async () => {
  const text = await readFile(join(repo, "AGENTS.md"), "utf8");
  const paths = [...text.matchAll(/`(\.[^\s`]*\.md)`/g)].map((match) => match[1]);
  assert.ok(paths.length >= 10, `入口地图条目过少（${paths.length}）`);
  const broken = [];
  for (const path of paths) {
    if (path.includes("<页面>")) continue;   // 模板式占位不检查
    if (await stat(join(repo, path)).then(() => true, () => false) === false) broken.push(path);
  }
  assert.deepEqual(broken, [], "入口地图断链：" + broken.join(", "));
});
