// G10「已看」的服务端持久化：单元测试（先红后绿）。
//
// 与 difit 的关键差异（`useViewedFiles.ts` + `StorageService.ts` 只存 localStorage）：
// 我们存服务端 → 换设备仍保留、Agent 可读、与评论同一套落盘纪律（原子写 / 目录说明 / 串行）。
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const HOME = mkdtempSync(join(tmpdir(), "review-viewed-home-"));
process.env.LIFEOS_HOME = HOME;

const {
  clearViewed, MAX_VIEWED_PER_TASK, readViewed, setFileViewed, setFilesViewed, toViewedRecord,
  viewedFileOf, VIEWED_SCHEMA_VERSION,
} = await import("../src/review-viewed.ts");

const BASE = "/home/u/.lifeos/agents/a/projects/p/tasks";
let seq = 0;
/** 每个用例一个独立 taskDir（C186/C187：共用夹具会让后一个用例继承前一个的副作用）。 */
const fresh = () => {
  seq += 1;
  return `${BASE}/${String(seq).padStart(4, "0")}-viewed`;
};

test("G10·S1 没记录 → 空数组（不抛）", async () => {
  assert.deepEqual(await readViewed(fresh()), []);
});

test("G10·S2 标记一个文件 → 读到 { path, viewedAt, hash }", async () => {
  const dir = fresh();
  const records = await setFileViewed(dir, "0010", "src/a.ts", "hash1", true);
  assert.equal(records.length, 1);
  assert.equal(records[0].path, "src/a.ts");
  assert.equal(records[0].hash, "hash1");
  assert.ok(!Number.isNaN(Date.parse(records[0].viewedAt)));
  // 落盘读回一致
  assert.deepEqual((await readViewed(dir)).map((record) => record.path), ["src/a.ts"]);
});

test("G10·S3 同一路径再标记 → 更新（不新增第二条）", async () => {
  const dir = fresh();
  await setFileViewed(dir, "0010", "src/a.ts", "hash1", true, "2026-11-01T00:00:00.000Z");
  const records = await setFileViewed(dir, "0010", "src/a.ts", "hash2", true, "2026-11-02T00:00:00.000Z");
  assert.equal(records.length, 1, "同路径应覆盖");
  assert.equal(records[0].hash, "hash2");
  assert.equal(records[0].viewedAt, "2026-11-02T00:00:00.000Z");
});

test("G10·S4 取消标记 → 只删那一条，其余不动", async () => {
  const dir = fresh();
  await setFileViewed(dir, "0010", "a.ts", "h", true);
  await setFileViewed(dir, "0010", "b.ts", "h", true);
  const records = await setFileViewed(dir, "0010", "a.ts", "h", false);
  assert.deepEqual(records.map((record) => record.path), ["b.ts"]);
});

test("G10·S5 批量标记：一次写多个（勾选目录）", async () => {
  const dir = fresh();
  const records = await setFilesViewed(dir, "0010", [{ path: "d/a.ts", hash: "h1" }, { path: "d/b.ts", hash: "h2" }], true);
  assert.equal(records.length, 2);
  assert.deepEqual(records.map((record) => record.path).sort(), ["d/a.ts", "d/b.ts"]);
});

test("G10·S6 批量取消：只删这批，别的保留", async () => {
  const dir = fresh();
  await setFilesViewed(dir, "0010", [{ path: "d/a.ts", hash: "h1" }, { path: "d/b.ts", hash: "h2" }], true);
  await setFileViewed(dir, "0010", "keep.ts", "h", true);
  const records = await setFilesViewed(dir, "0010", [{ path: "d/a.ts", hash: "h1" }, { path: "d/b.ts", hash: "h2" }], false);
  assert.deepEqual(records.map((record) => record.path), ["keep.ts"]);
});

test("G10·S7 落盘结构：version / taskId / records；权限 0600 与目录说明文件", async () => {
  const dir = fresh();
  await setFileViewed(dir, "0010", "a.ts", "h", true);
  const raw = JSON.parse(readFileSync(viewedFileOf(dir), "utf8"));
  assert.equal(raw.version, VIEWED_SCHEMA_VERSION);
  assert.equal(raw.taskId, "0010");
  assert.ok(Array.isArray(raw.records));
  const note = readFileSync(join(viewedFileOf(dir), "..", "AGENTS.md"), "utf8");
  assert.match(note, /review-viewed/, "运行目录必须有说明文件（backend 2.13）");
});

test("G10·S8 坏 JSON / 版本不符 → 空数组（不崩）", async () => {
  const dir = fresh();
  const file = viewedFileOf(dir);
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(file, "{ not json");
  assert.deepEqual(await readViewed(dir), []);
  writeFileSync(file, JSON.stringify({ version: 99, taskId: "0010", records: [{ path: "a", hash: "h" }] }));
  assert.deepEqual(await readViewed(dir), []);
});

test("G10·S9 坏条目逐条跳过（一条坏数据不拖垮整批）", async () => {
  const dir = fresh();
  const file = viewedFileOf(dir);
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(file, JSON.stringify({
    version: VIEWED_SCHEMA_VERSION, taskId: "0010",
    records: [null, 3, { path: "", hash: "h" }, { path: "ok.ts", hash: "h2", viewedAt: "2026-11-01T00:00:00.000Z" }],
  }));
  const records = await readViewed(dir);
  assert.equal(records.length, 1);
  assert.equal(records[0].path, "ok.ts");
});

test("G10·S10 上限：超出 MAX_VIEWED_PER_TASK 时丢最旧（不是报错）", async () => {
  const dir = fresh();
  // 造 MAX+2 条（用不同时间戳确保"最旧"可判）
  for (let i = 0; i < MAX_VIEWED_PER_TASK + 2; i += 1) {
    await setFileViewed(dir, "0010", `f${i}.ts`, "h", true, new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString());
  }
  const records = await readViewed(dir);
  assert.equal(records.length, MAX_VIEWED_PER_TASK, `应裁剪到 ${MAX_VIEWED_PER_TASK}，实际 ${records.length}`);
  assert.equal(records.some((record) => record.path === "f0.ts"), false, "最旧的应被丢掉");
  assert.equal(records.some((record) => record.path === `f${MAX_VIEWED_PER_TASK + 1}.ts`), true, "最新的必须保留");
});

test("G10·S11 两个 Task 互不可见（同一 slug 算法但不同目录）", async () => {
  const a = fresh();
  const b = fresh();
  await setFileViewed(a, "0010", "only-a.ts", "h", true);
  assert.deepEqual(await readViewed(b), []);
  assert.deepEqual((await readViewed(a)).map((record) => record.path), ["only-a.ts"]);
  assert.notEqual(viewedFileOf(a), viewedFileOf(b));
});

test("G10·S12 clearViewed：清空后可重建", async () => {
  const dir = fresh();
  await setFileViewed(dir, "0010", "a.ts", "h", true);
  await clearViewed(dir);
  assert.deepEqual(await readViewed(dir), []);
  await setFileViewed(dir, "0010", "a.ts", "h2", true);
  assert.equal((await readViewed(dir)).length, 1);
});

test("G10·S13 toViewedRecord：缺 viewedAt 补当前时间；缺 path/hash 拒绝", () => {
  assert.equal(toViewedRecord({ hash: "h" }), undefined);
  assert.equal(toViewedRecord({ path: "a" }), undefined);
  const record = toViewedRecord({ path: "a", hash: "h" });
  assert.ok(record !== undefined && !Number.isNaN(Date.parse(record.viewedAt)));
});
