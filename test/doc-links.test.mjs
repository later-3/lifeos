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

test("相对链接全部可解析（模板 .lifeos + 根 AGENTS.md + 全部 README + docs）", async () => {
  // 两个 README 双语 + docs/ 下的用户文档都要进扫描（Task 0022）：
  // 只扫 README.md 时，中文版与 docs/getting-started.md 的断链抓不到（实测：加中文版前门禁全绿）。
  const files = [
    ...await walk(join(repo, ".lifeos")),
    ...await walk(join(repo, "docs")),
    join(repo, "AGENTS.md"),
    join(repo, "README.md"),
    join(repo, "README.zh-CN.md"),
  ];
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

/**
 * 双语 README 的四条一致性（Task 0022 · 02-design 链路 4）。
 *
 * 为什么要有：两份文件是手写的，最容易出的不是错字而是**漂移**——
 * 一边加了章节、另一边忘了；一边换了图、另一边还是旧图。这些靠人眼查不出来。
 */
test("两份 README：章节序列一致、语言互链、图片集合相同、媒体与代码块不塌缩", async () => {
  const en = await readFile(join(repo, "README.md"), "utf8");
  const zh = await readFile(join(repo, "README.zh-CN.md"), "utf8");

  const headings = (text) => [...text.matchAll(/^(#{2,3}) /gm)].map((match) => match[1]);
  assert.deepEqual(headings(zh), headings(en), "两份 README 的 ## / ### 层级序列不一致（章节漂移）");

  // 首屏语言切换是 HTML `<a href>`（居中排版要用 HTML，markdown 链接做不到居中）。
  // 断言按**真实写法**来：两种写法都接受，避免"门禁要求一种、实现用另一种"的假红。
  const hasLink = (text, target) =>
    new RegExp(`(\\]\\(|href=")\\./${target.replace(".", "\\.")}`).test(text);
  assert.ok(hasLink(en, "README.zh-CN.md"), "英文版缺少指向中文版的链接");
  assert.ok(hasLink(zh, "README.md"), "中文版缺少指向英文版的链接");

  const imagesOf = (text) => [...new Set([...text.matchAll(/docs\/images\/([\w.-]+)/g)].map((match) => match[1]))].sort();
  assert.deepEqual(imagesOf(zh), imagesOf(en), "两份 README 引用的图片集合不同（一边换了图另一边没换）");

  // 下限断言：防止有人把内容删空后门禁仍然全绿（testing 规 2.4 的活性要求）
  const mediaCount = imagesOf(en).length;
  const gifCount = imagesOf(en).filter((name) => name.endsWith(".gif")).length;
  const headingCount = headings(en).length;
  const fenceCount = (en.match(/^```/gm) ?? []).length / 2;
  assert.ok(mediaCount >= 15, `图片引用过少（${mediaCount}），门禁可能已失效`);
  assert.ok(gifCount >= 6, `动图过少（${gifCount}），用户要求"能上动图的地方不省"`);
  assert.ok(headingCount >= 18, `章节过少（${headingCount}），结构可能被压塌`);
  assert.ok(fenceCount >= 5, `代码围栏过少（${fenceCount}），命令块可能被删`);
});

test("LICENSE 与赞助配置存在（README 敢写 MIT 的前提）", async () => {
  const license = await readFile(join(repo, "LICENSE"), "utf8");
  assert.ok(license.includes("MIT License"), "LICENSE 不是 MIT 正文");
  const funding = await readFile(join(repo, ".github", "FUNDING.yml"), "utf8");
  assert.ok(funding.length > 0, "FUNDING.yml 为空");
});
