// S2·A5 草稿持久化的单测（storage 用内存 mock，不碰真实 localStorage）。
//
// 用例对齐 difit `useLocalComments.test.ts`（16 条，MIT）的清单：
// 空 / 载入 / 增 / 删 / 改正文 / 清空 / 按 commit 隔离（我们换成按 task+file 隔离）。
import test from "node:test";
import assert from "node:assert/strict";
import {
  DRAFT_SCHEMA_VERSION, MAX_DRAFTS_PER_TASK, DRAFT_STORAGE_KEY,
  draftKeyOf, draftsOfFile, draftsOfTask, findDraft, readDrafts, removeDraft, toReviewDraft, upsertDraft,
} from "../frontend/src/review-drafts.ts";

/** 内存 storage（真实 localStorage 的 getItem/setItem 子集）。 */
function memStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    dump: () => Object.fromEntries(map),
  };
}

const base = {
  taskDir: "/t/0010", source: "worktree", filePath: "src/a.ts", side: "new", start: 3, end: 5,
  snapshot: "l3\nl4\nl5", note: "这里为什么这么写？",
};

test("A5·1 空存储 → 空数组", () => {
  assert.deepEqual(readDrafts(memStorage()), []);
});

test("A5·2 坏 JSON / 版本不符 / 坏条目 → 安全降级（不抛）", () => {
  assert.deepEqual(readDrafts(memStorage({ [DRAFT_STORAGE_KEY]: "not json" })), []);
  assert.deepEqual(readDrafts(memStorage({ [DRAFT_STORAGE_KEY]: JSON.stringify({ version: 99, drafts: [{}] }) })), []);
  const bad = JSON.stringify({ version: DRAFT_SCHEMA_VERSION, drafts: [{ id: "x" }, null, 3] });
  assert.deepEqual(readDrafts(memStorage({ [DRAFT_STORAGE_KEY]: bad })), [], "坏条目逐条跳过");
});

test("A5·3 新增一条后能读回（含 snapshot 与 note）", () => {
  const s = memStorage();
  const saved = upsertDraft(s, base, "2026-11-05T10:00:00.000Z");
  const all = readDrafts(s);
  assert.equal(all.length, 1);
  assert.equal(all[0].id, saved.id);
  assert.equal(all[0].note, base.note);
  assert.equal(all[0].snapshot, base.snapshot);
  assert.equal(all[0].createdAt, "2026-11-05T10:00:00.000Z");
});

test("A5·4 同键（task+source+file+side+range）再写 → 覆盖，不新增", () => {
  const s = memStorage();
  const first = upsertDraft(s, base);
  const second = upsertDraft(s, { ...base, note: "改了想法" });
  const all = readDrafts(s);
  assert.equal(all.length, 1);
  assert.equal(all[0].id, first.id, "id 不变（还是同一条草稿）");
  assert.equal(all[0].createdAt, first.createdAt, "createdAt 不变");
  assert.equal(all[0].note, "改了想法");
  assert.equal(second.id, first.id);
});

test("A5·5 行号反序（end<start）→ 归一成 min..max，键相同", () => {
  const s = memStorage();
  upsertDraft(s, { ...base, start: 5, end: 3 });
  assert.equal(readDrafts(s).length, 1);
  assert.equal(draftKeyOf({ ...base, start: 3, end: 5 }), draftKeyOf({ ...base, start: 5, end: 3 }));
});

test("A5·6 同一文件不同范围 → 两条独立草稿", () => {
  const s = memStorage();
  upsertDraft(s, { ...base, start: 3, end: 5 });
  upsertDraft(s, { ...base, start: 20, end: 20, note: "另一处" });
  assert.equal(readDrafts(s).length, 2);
  assert.equal(draftsOfFile(s, "/t/0010", "worktree", "src/a.ts").length, 2);
});

test("A5·7 跨 Task 隔离（同文件路径、不同 taskDir → 互不可见）", () => {
  const s = memStorage();
  upsertDraft(s, base);
  upsertDraft(s, { ...base, taskDir: "/t/0011" });
  assert.equal(draftsOfTask(s, "/t/0010").length, 1);
  assert.equal(draftsOfTask(s, "/t/0011").length, 1);
  assert.equal(draftsOfFile(s, "/t/0010", "worktree", "src/a.ts").length, 1);
});

test("A5·8 跨源隔离（worktree vs lifeos，同路径）", () => {
  const s = memStorage();
  upsertDraft(s, base);
  upsertDraft(s, { ...base, source: "lifeos" });
  assert.equal(draftsOfTask(s, "/t/0010").length, 2);
  assert.equal(draftsOfFile(s, "/t/0010", "worktree", "src/a.ts").length, 1);
});

test("A5·9 旧侧与新侧是两条（同范围）", () => {
  const s = memStorage();
  upsertDraft(s, { ...base, side: "new" });
  upsertDraft(s, { ...base, side: "old" });
  assert.equal(readDrafts(s).length, 2);
});

test("A5·10 删除按 id，其余不受影响", () => {
  const s = memStorage();
  const a = upsertDraft(s, base);
  upsertDraft(s, { ...base, start: 30, end: 30 });
  removeDraft(s, a.id);
  assert.equal(readDrafts(s).length, 1);
  assert.equal(findDraft(s, a.id), undefined);
  removeDraft(s, "不存在的 id");  // 幂等
  assert.equal(readDrafts(s).length, 1);
});

test("A5·11 note 可以为空串（先圈上、稍后再写是正常动作）", () => {
  const s = memStorage();
  upsertDraft(s, { ...base, note: "" });
  assert.equal(readDrafts(s)[0].note, "");
});

test("A5·12 snapshot 可缺省（老数据/取不到原文时不存）", () => {
  const s = memStorage();
  const { snapshot, ...without } = base;
  upsertDraft(s, without);
  assert.equal(readDrafts(s)[0].snapshot, undefined);
});

test(`A5·13 单个 Task 超过 ${MAX_DRAFTS_PER_TASK} 条时丢最旧的，别的 Task 不受影响`, () => {
  const s = memStorage();
  // 先放一条别的 Task 的（它必须活下来）
  upsertDraft(s, { ...base, taskDir: "/t/other", start: 1, end: 1 }, "2026-01-01T00:00:00.000Z");
  for (let i = 0; i < MAX_DRAFTS_PER_TASK + 5; i++) {
    upsertDraft(s, { ...base, start: i + 1, end: i + 1 },
      new Date(Date.UTC(2026, 10, 5, 10, 0, i)).toISOString());
  }
  assert.equal(draftsOfTask(s, "/t/0010").length, MAX_DRAFTS_PER_TASK);
  assert.equal(draftsOfTask(s, "/t/other").length, 1, "别的 Task 不被裁");
  // 留下的是最新的：第一条应是 start=6（前 5 条被丢）
  const kept = draftsOfTask(s, "/t/0010");
  assert.equal(kept[0].start, 6);
});

test("A5·14 按 Task 取草稿按 createdAt 升序（渲染顺序稳定）", () => {
  const s = memStorage();
  upsertDraft(s, { ...base, start: 50, end: 50 }, "2026-11-05T12:00:00.000Z");
  upsertDraft(s, { ...base, start: 10, end: 10 }, "2026-11-05T10:00:00.000Z");
  const kept = draftsOfTask(s, "/t/0010");
  assert.deepEqual(kept.map((d) => d.start), [10, 50]);
});

test("A5·15 toReviewDraft：缺字段/类型错/行号 0 → undefined", () => {
  assert.equal(toReviewDraft(null), undefined);
  assert.equal(toReviewDraft({}), undefined);
  assert.equal(toReviewDraft({ ...base, id: "" }), undefined);
  assert.equal(toReviewDraft({ ...base, id: "x", start: 0 }), undefined);
  assert.equal(toReviewDraft({ ...base, id: "x", source: "git" }), undefined);
  // 合法的要能通过（base 缺 id/createdAt，补齐后应可读）
  const ok = toReviewDraft({ ...base, id: "x", createdAt: "2026-11-05T10:00:00.000Z" });
  assert.equal(ok?.filePath, "src/a.ts", "补齐必填字段后应合法");
  assert.equal(toReviewDraft({ ...base, id: "x" }), undefined, "缺 createdAt 应拒绝");
});

test("A5·16 键里含 NUL 分隔（路径里有空格/中文也不会串）", () => {
  const k1 = draftKeyOf({ ...base, filePath: "docs/有 空格的 文件.md" });
  const k2 = draftKeyOf({ ...base, filePath: "docs/有", start: 5, end: 5 });
  assert.notEqual(k1, k2);
  assert.ok(k1.includes("\u0000"));
});


// ── 作者身份（用户 2026-11-05 要求：存 id、展示名字与头像）───────────────────────

test("A5·17 作者存 id 不存名字（id 稳定，名字会改）", () => {
  const s = memStorage();
  const saved = upsertDraft(s, { ...base, author: { kind: "user", id: "xu-later" } });
  assert.deepEqual(saved.author, { kind: "user", id: "xu-later" });
  // 换成 agent 也是同一形状
  const agent = upsertDraft(s, { ...base, source: "lifeos", author: { kind: "agent", id: "coder" } });
  assert.deepEqual(agent.author, { kind: "agent", id: "coder" });
  assert.deepEqual(readDrafts(s).map((d) => d.author?.kind).sort(), ["agent", "user"]);
});

test("A5·18 老数据没有 author → 读得出来（不因缺字段整条丢掉）", () => {
  const s = memStorage();
  const bare = { id: "old1", taskDir: "/t/0010", source: "worktree", filePath: "a.ts", side: "new", start: 1, end: 1, note: "", createdAt: "2026-11-01T00:00:00.000Z" };
  s.setItem(DRAFT_STORAGE_KEY, JSON.stringify({ version: DRAFT_SCHEMA_VERSION, drafts: [bare] }));
  const all = readDrafts(s);
  assert.equal(all.length, 1);
  assert.equal(all[0].author, undefined, "缺失就是缺失，展示层按当前用户处理");
});

test("A5·19 author 形状不合法（kind 不是 user/agent / id 空）→ 整条仍保留，只丢 author", () => {
  const s = memStorage();
  upsertDraft(s, base);
  const raw = JSON.parse(s.getItem(DRAFT_STORAGE_KEY));
  raw.drafts[0].author = { kind: "robot", id: "x" };
  s.setItem(DRAFT_STORAGE_KEY, JSON.stringify(raw));
  const all = readDrafts(s);
  assert.equal(all.length, 1, "草稿本身不能因为作者字段坏了就丢");
  assert.equal(all[0].author, undefined);
});

// ── 同一行/同一范围：不同作者各一条（用户 2026-11-05："同一行多个 agent 和用户评论呢"）──
test("A5·20 同一范围不同作者 → 两条独立评论（不互相覆盖）", () => {
  const s = memStorage();
  upsertDraft(s, { ...base, author: { kind: "user", id: "xu-later" } });
  upsertDraft(s, { ...base, author: { kind: "agent", id: "coder" } });
  upsertDraft(s, { ...base, author: { kind: "agent", id: "reviewer" } });
  const all = readDrafts(s);
  assert.equal(all.length, 3, "三个作者各一条");
  assert.deepEqual(all.map((d) => d.author?.id).sort(), ["coder", "reviewer", "xu-later"]);
});

test("A5·21 同一作者同一范围再写 → 覆盖（是编辑，不是新评论）", () => {
  const s = memStorage();
  const a = upsertDraft(s, { ...base, author: { kind: "agent", id: "coder" }, note: "第一次" });
  const b = upsertDraft(s, { ...base, author: { kind: "agent", id: "coder" }, note: "改了" });
  assert.equal(readDrafts(s).length, 1);
  assert.equal(a.id, b.id, "同一条被更新");
  assert.equal(readDrafts(s)[0].note, "改了");
});

test("A5·22 同一作者不同范围 → 两条", () => {
  const s = memStorage();
  upsertDraft(s, { ...base, start: 3, end: 5, author: { kind: "agent", id: "coder" } });
  upsertDraft(s, { ...base, start: 9, end: 9, author: { kind: "agent", id: "coder" } });
  assert.equal(readDrafts(s).length, 2);
});

test("A5·23 键里作者用 \\u0001 分隔，与字段分隔符不冲突", () => {
  const k1 = draftKeyOf({ ...base, authorId: "a" });
  const k2 = draftKeyOf({ ...base, authorId: "b" });
  assert.notEqual(k1, k2);
  assert.ok(k1.includes("\u0001"));
  // 作者为空（老数据）与作者 "x" 不能撞
  assert.notEqual(draftKeyOf(base), draftKeyOf({ ...base, authorId: "x" }));
});

test("A5·24 marks 能落盘与读回（语气复用 marks 体系，不新增 severity）", () => {
  const s = memStorage();
  upsertDraft(s, { ...base, author: { kind: "user", id: "u" }, marks: ["critic"] });
  assert.deepEqual(readDrafts(s)[0].marks, ["critic"]);
  // 改语气
  upsertDraft(s, { ...base, author: { kind: "user", id: "u" }, marks: ["query", "todo"] });
  assert.deepEqual(readDrafts(s)[0].marks, ["query", "todo"]);
  // 空数组 = 不写字段（读回 undefined，语义"没标语气"）
  upsertDraft(s, { ...base, author: { kind: "user", id: "u" }, marks: [] });
  assert.equal(readDrafts(s)[0].marks, undefined);
});
