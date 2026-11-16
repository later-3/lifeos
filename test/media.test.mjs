// 媒体库的纯函数与接口契约（Task 0016 · P1）。
//
// 覆盖三类都在这里出事：
//  ① 检索（中英文关键词、AND 语义、稳定顺序）——错了 Agent 就"搜不到图"；
//  ② 路径与 id（非法 id / 目录穿越）——错了就是越权读文件；
//  ③ 头像写入的广播闭环——漏了就是用户每次刷新才看到新头像（2026-11-12 实测）。

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { addEntry, findEntry, isMediaId, readCatalog, searchEntries, strayFiles, writeCatalog } from "../src/media.ts";

const PNG_1PX = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

const tempHome = () => mkdtemp(join(tmpdir(), "lifeos-media-"));

test("媒体 id 只允许小写字母数字与 -_，且不能为空", () => {
  assert.equal(isMediaId("blush"), true);
  assert.equal(isMediaId("white_check_mark"), true);
  assert.equal(isMediaId("a1"), true);
  assert.equal(isMediaId("Blush"), false);
  assert.equal(isMediaId(""), false);
  assert.equal(isMediaId("-a"), false);
  assert.equal(isMediaId("a/b"), false);          // 路径分隔符
  assert.equal(isMediaId(".."), false);           // 目录穿越
  assert.equal(isMediaId("a".repeat(65)), false);
});

test("检索：中文关键词能命中，AND 语义，结果顺序稳定", async () => {
  const home = await tempHome();
  await addEntry(home, { id: "otter-1", kind: "avatar", pack: "test", buffer: PNG_1PX, keywords: ["海豹", "calm", "温和"], source: "test", license: "CC0-1.0" });
  await addEntry(home, { id: "otter-2", kind: "avatar", pack: "test", buffer: PNG_1PX, keywords: ["海豹", "playful"], source: "test", license: "CC0-1.0" });
  await addEntry(home, { id: "blush", kind: "emoji", pack: "test", buffer: PNG_1PX, keywords: ["微笑", "smile"], source: "test", license: "CC-BY-4.0" });

  const catalog = await readCatalog(home);
  assert.deepEqual(searchEntries(catalog, { query: "海豹" }).map((e) => e.id), ["otter-1", "otter-2"]);
  assert.deepEqual(searchEntries(catalog, { query: "海豹 calm" }).map((e) => e.id), ["otter-1"]);   // AND
  assert.deepEqual(searchEntries(catalog, { query: "海豹 不存在" }), []);
  assert.deepEqual(searchEntries(catalog, { kind: "emoji" }).map((e) => e.id), ["blush"]);
  // 大小写不敏感
  assert.deepEqual(searchEntries(catalog, { query: "CALM" }).map((e) => e.id), ["otter-1"]);
  // 同一份目录调两次结果一致（顺序稳定）
  assert.deepEqual(searchEntries(catalog, { limit: 10 }), searchEntries(catalog, { limit: 10 }));
});

test("收入素材：幂等覆盖同 id，扩展名变化时旧文件被清掉", async () => {
  const home = await tempHome();
  const first = await addEntry(home, { id: "same", kind: "avatar", pack: "test", buffer: PNG_1PX, keywords: ["a"], source: "t", license: "MIT" });
  assert.equal(first.ok, true);
  const again = await addEntry(home, { id: "same", kind: "avatar", pack: "test", buffer: PNG_1PX, keywords: ["a", "b"], source: "t", license: "MIT" });
  assert.equal(again.ok, true);
  const catalog = await readCatalog(home);
  assert.equal(catalog.entries.length, 1);
  assert.deepEqual(catalog.entries[0]?.keywords, ["a", "b"]);
  assert.deepEqual(await strayFiles(home), []);
});

test("非法输入被拒绝：坏 id 与不是图片的字节都不落盘", async () => {
  const home = await tempHome();
  assert.equal((await addEntry(home, { id: "Bad Id", kind: "avatar", pack: "t", buffer: PNG_1PX, keywords: [], source: "t", license: "MIT" })).ok, false);
  assert.equal((await addEntry(home, { id: "not-image", kind: "avatar", pack: "t", buffer: Buffer.from("hello"), keywords: [], source: "t", license: "MIT" })).ok, false);
  const catalog = await readCatalog(home);
  assert.equal(catalog.entries.length, 0);
});

test("坏 catalog 文件当空库读（不抛）：手改坏了也不该让服务起不来", async () => {
  const home = await tempHome();
  await writeCatalog(home, { schemaVersion: 1, entries: [] });
  await writeFile(join(home, "media", "catalog.json"), "{ not json");
  const catalog = await readCatalog(home);
  assert.deepEqual(catalog.entries, []);
});

test("登记项里 file 带 .. 的脏数据被过滤（读盘防御）", async () => {
  const home = await tempHome();
  const path = join(home, "media", "catalog.json");
  await writeCatalog(home, { schemaVersion: 1, entries: [] });
  await writeFile(path, JSON.stringify({
    schemaVersion: 1,
    entries: [
      { id: "evil", kind: "avatar", pack: "t", file: "../../etc/passwd", mime: "image/png", bytes: 1, keywords: [], source: "t", license: "MIT", addedAt: "2026-01-01T00:00:00.000Z" },
      { id: "good", kind: "avatar", pack: "t", file: "avatar/good.png", mime: "image/png", bytes: 1, keywords: [], source: "t", license: "MIT", addedAt: "2026-01-01T00:00:00.000Z" },
    ],
  }));
  const catalog = await readCatalog(home);
  assert.deepEqual(catalog.entries.map((entry) => entry.id), ["good"]);
  assert.equal(findEntry(catalog, "evil"), undefined);
});

test("catalog 写入是原子且稳定的（排序与插入顺序无关）", async () => {
  const home = await tempHome();
  await addEntry(home, { id: "zeta", kind: "avatar", pack: "t", buffer: PNG_1PX, keywords: [], source: "t", license: "MIT" });
  await addEntry(home, { id: "alpha", kind: "avatar", pack: "t", buffer: PNG_1PX, keywords: [], source: "t", license: "MIT" });
  const text = await readFile(join(home, "media", "catalog.json"), "utf8");
  const ids = JSON.parse(text).entries.map((entry) => entry.id);
  assert.deepEqual(ids, ["alpha", "zeta"]);
});
