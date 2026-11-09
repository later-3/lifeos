// S4-d：前端 CommentStore 的契约测试（**同一套断言跑两种实现**，保证行为一致）。
//
// 为什么要"同一套断言跑两边"：
//  - HttpStore（服务端）与 LocalStore（离线兜底）会被 UI 无差别使用；行为不一致就会出现
//    "在线时能删、离线时删不掉"这类诡异现象（C187 的教训：夹具/实现分叉时，测试要能抓出来）。
//
// 参考：difit `useLocalComments.test.ts` 的用例清单（空/载入/增/删/改/清空/坏数据/顺序）。
import test from "node:test";
import assert from "node:assert/strict";
import {
  createHttpStore, createLocalStore, hasLocalOnlyComments, localCommentsOf,
} from "../frontend/src/review-comment-store.ts";

/** 内存 storage（localStorage 子集）。 */
function memStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
    clear: () => map.clear(),
    key: (i) => [...map.keys()][i] ?? null,
    get length() { return map.size; },
  };
}

/** 在内存里模拟服务端（与 `src/review-comments.ts` 同语义：键含作者、同键覆盖）。 */
function fakeServer() {
  const byTask = new Map();
  const keyOf = (c) => `${c.author.kind}:${c.author.id}|${c.anchor.source}|${c.anchor.path}|${c.anchor.side}|${Math.min(c.anchor.start, c.anchor.end)}-${Math.max(c.anchor.start, c.anchor.end)}`;
  let seq = 0;
  let down = false;
  return {
    down: (v) => { down = v; },
    get calls() { return byTask; },
    fetch: async (input, init) => {
      if (down) return { ok: false, status: 503, json: async () => ({ error: { code: "unavailable" } }) };
      const url = new URL(input, "http://x");
      const taskDir = url.searchParams.get("taskDir");
      if (init?.method !== "POST") {
        return { ok: true, status: 200, json: async () => ({ items: byTask.get(taskDir) ?? [] }) };
      }
      const body = JSON.parse(init.body);
      const dir = body.taskDir;
      const list = byTask.get(dir) ?? [];
      if (body.op === "remove") {
        const next = list.filter((c) => c.id !== body.id);
        byTask.set(dir, next);
        return { ok: true, status: 200, json: async () => ({ removed: next.length !== list.length }) };
      }
      if (body.op === "state") {
        const at = list.findIndex((c) => c.id === body.id);
        if (at < 0) return { ok: false, status: 404, json: async () => ({ error: { code: "comment_not_found", message: "找不到这条评论" } }) };
        const next = { ...list[at], state: body.state, ...(body.state === "resolved" ? { resolvedBy: body.by } : {}) };
        list[at] = next;
        byTask.set(dir, list);
        return { ok: true, status: 200, json: async () => ({ comment: next }) };
      }
      // S4-h：线程动作（与 `src/review-comments.ts` 同语义，否则契约测试测的不是真语义）
      if (body.op === "reply" || body.op === "reply-remove" || body.op === "awaiting") {
        const at = list.findIndex((c) => c.id === body.id);
        if (at < 0) return { ok: false, status: 404, json: async () => ({ error: { code: "comment_not_found", message: "找不到这条评论" } }) };
        const current = list[at];
        if (body.op === "reply") {
          if (current.state === "resolved") return { ok: false, status: 403, json: async () => ({ error: { message: "已关闭的评论不能回复，请先重开" } }) };
          const next = { ...current, replies: [...(current.replies ?? []), { id: `rr_${++seq}`, author: body.reply.author, body: body.reply.body, createdAt: "2026-11-05T00:00:00Z" }], awaiting: body.reply.author.kind === "agent" ? "user" : "agent" };
          list[at] = next;
          byTask.set(dir, list);
          return { ok: true, status: 201, json: async () => ({ comment: next }) };
        }
        if (body.op === "reply-remove") {
          const target = (current.replies ?? []).find((r) => r.id === body.replyId);
          if (target === undefined) return { ok: true, status: 200, json: async () => ({ comment: current }) };
          const sameAuthor = target.author.kind === body.by.kind && target.author.id === body.by.id;
          if (!sameAuthor && body.by.kind !== "user") return { ok: false, status: 403, json: async () => ({ error: { message: "只有回复作者或用户本人可以删除" } }) };
          const next = { ...current, replies: (current.replies ?? []).filter((r) => r.id !== body.replyId) };
          list[at] = next;
          byTask.set(dir, list);
          return { ok: true, status: 200, json: async () => ({ comment: next }) };
        }
        const next = { ...current, awaiting: body.awaiting };
        list[at] = next;
        byTask.set(dir, list);
        return { ok: true, status: 200, json: async () => ({ comment: next }) };
      }
      const incoming = { ...body.comment, id: body.comment.id ?? `srv_${++seq}`, state: body.comment.state ?? "draft", createdAt: "2026-11-05T00:00:00Z", updatedAt: "2026-11-05T00:00:00Z" };
      const at = list.findIndex((c) => keyOf(c) === keyOf(incoming));
      if (at >= 0) list[at] = { ...list[at], ...incoming, id: list[at].id };
      else list.push(incoming);
      byTask.set(dir, list);
      return { ok: true, status: 201, json: async () => ({ comment: at >= 0 ? list[at] : incoming }) };
    },
  };
}

const TASK = "/home/u/.lifeos/agents/a/projects/p/tasks/0010-x";
const comment = (over = {}) => ({
  taskId: "0010",
  author: { kind: "user", id: "xu-later" },
  anchor: { source: "worktree", path: "README.md", side: "new", start: 3, end: 5 },
  body: "要同步 protocol.md 吗",
  marks: ["query"],
  ...over,
});

/** 同一套契约，跑两种实现。 */
const CONTRACT = [
  ["C1 空 → 空数组", async (store) => {
    assert.deepEqual(await store.list(TASK), []);
  }],
  ["C2 保存后能读到", async (store) => {
    await store.save(TASK, comment());
    const got = await store.list(TASK);
    assert.equal(got.length, 1);
    assert.equal(got[0].anchor.path, "README.md");
    assert.deepEqual(got[0].marks, ["query"]);
  }],
  ["C3 同键再保存 → 覆盖不新增", async (store) => {
    await store.save(TASK, comment({ body: "改了" }));
    const got = await store.list(TASK);
    assert.equal(got.length, 1, `同键应只有 1 条，实际 ${got.length}`);
    assert.equal(got[0].body, "改了");
  }],
  ["C4 不同作者同键 → 两条独立", async (store) => {
    await store.save(TASK, comment({ author: { kind: "agent", id: "coder" }, body: "建议统一术语" }));
    const got = await store.list(TASK);
    assert.equal(got.length, 2);
    assert.deepEqual(got.map((c) => c.author.id).sort(), ["coder", "xu-later"]);
  }],
  ["C5 删除", async (store) => {
    const all = await store.list(TASK);
    const removed = await store.remove(TASK, all[0].id);
    assert.equal(removed, true);
    assert.equal((await store.list(TASK)).length, 1);
  }],
  ["C6 删除不存在的 id → 幂等 false", async (store) => {
    assert.equal(await store.remove(TASK, "nope"), false);
  }],
  /**
   * C7–C9 只在 Http 实现上有意义（LocalStore 没有线程语义，如实返回 undefined）。
   * 这也是**行为差异的显式声明**：离线时 UI 应该禁用回复/关闭，而不是让用户以为成功了。
   */
];

/**
 * 契约是**有状态的**（C2 造的数据给 C3/C4/C5 用），所以必须在一个 test 里顺序跑。
 * 早先拆成独立 test → 每个 test 新起 server，C4 期望 2 条却只有 1 条（测试结构错，不是实现错）。
 */
test("Store·Http · 6 条契约顺序跑（服务端实现）", async () => {
  const server = fakeServer();
  const store = createHttpStore({ fetch: server.fetch, storage: memStorage() });
  for (const [name, run] of CONTRACT) {
    try { await run(store); } catch (error) {
      assert.fail(`契约「${name}」在 Http 实现上失败：${error.message}`);
    }
  }
});

test("Store·Local · 同一套契约顺序跑（离线实现行为必须一致）", async () => {
  const storage = memStorage();
  const store = createLocalStore(storage);
  for (const [name, run] of CONTRACT) {
    try { await run(store); } catch (error) {
      assert.fail(`契约「${name}」在 Local 实现上失败：${error.message}`);
    }
  }
});

test("Store·Http · 线程动作：reply 追加 + awaiting 交棒；resolve 后 reply 被拒", async () => {
  const server = fakeServer();
  const store = createHttpStore({ fetch: server.fetch, storage: memStorage() });
  const saved = await store.save(TASK, comment());
  const replied = await store.reply(TASK, saved.id, { author: { kind: "agent", id: "coder" }, body: "已同步 protocol.md" });
  assert.equal(replied.replies.length, 1);
  assert.equal(replied.awaiting, "user", "Agent 回复后要交棒给用户");

  await store.setCommentState(TASK, saved.id, "resolved", { kind: "user", id: "xu-later" });
  await assert.rejects(
    () => store.reply(TASK, saved.id, { author: { kind: "agent", id: "coder" }, body: "还想说" }),
    /关闭|重开/,
  );
});

test("Store·Http · removeReply：作者能删，用户能删，别的 Agent 403", async () => {
  const server = fakeServer();
  const store = createHttpStore({ fetch: server.fetch, storage: memStorage() });
  const saved = await store.save(TASK, comment());
  const replied = await store.reply(TASK, saved.id, { author: { kind: "agent", id: "coder" }, body: "我的话" });
  const replyId = replied.replies[0].id;
  await assert.rejects(() => store.removeReply(TASK, saved.id, replyId, { kind: "agent", id: "reviewer" }), /作者|权限|本人/);
  const afterUser = await store.removeReply(TASK, saved.id, replyId, { kind: "user", id: "xu-later" });
  assert.deepEqual(afterUser.replies, []);
});

test("Store·Http · setAwaiting：三值都能设（G1 的界面入口用它）", async () => {
  const server = fakeServer();
  const store = createHttpStore({ fetch: server.fetch, storage: memStorage() });
  const saved = await store.save(TASK, comment());
  for (const value of ["agent", "user", null]) {
    const next = await store.setAwaiting(TASK, saved.id, value, { kind: "user", id: "xu-later" });
    assert.equal(next.awaiting, value);
  }
});

test("Store·Local · 线程动作如实返回 undefined（离线不假装成功）", async () => {
  const store = createLocalStore(memStorage());
  const saved = await store.save(TASK, comment());
  assert.equal(await store.reply(TASK, saved.id, { author: { kind: "user", id: "u" }, body: "x" }), undefined);
  assert.equal(await store.removeReply(TASK, saved.id, "rr_x", { kind: "user", id: "u" }), undefined);
  assert.equal(await store.setAwaiting(TASK, saved.id, "agent", { kind: "user", id: "u" }), undefined);
});

test("Store·Http · 服务端不可用 → list 降级读本地（不抛，UI 才能继续用）", async () => {
  const storage = memStorage();
  const server = fakeServer();
  const store = createHttpStore({ fetch: server.fetch, storage });
  await store.save(TASK, comment());          // 正常写一次（也清了本地）
  await store.save(TASK, comment({ anchor: { source: "worktree", path: "offline.md", side: "new", start: 1, end: 1 } }));
  server.down(true);
  // 直接往本地塞一条模拟"离线时写的"
  createLocalStore(storage).save(TASK, comment({ anchor: { source: "worktree", path: "local.md", side: "new", start: 2, end: 2 } }));
  const got = await store.list(TASK);
  assert.ok(got.some((c) => c.anchor.path === "local.md"), "降级后应能读到本地那条");
});

test("Store·Http · 保存失败 → 本地兜底 + 抛错（用户输入不丢，UI 能提示）", async () => {
  const storage = memStorage();
  const server = fakeServer();
  server.down(true);
  const store = createHttpStore({ fetch: server.fetch, storage });
  await assert.rejects(() => store.save(TASK, comment({ anchor: { source: "worktree", path: "x.md", side: "new", start: 1, end: 1 } })));
  assert.equal(localCommentsOf(storage, TASK).length, 1, "失败时本地必须留一份");
});

test("Store·迁移 · 只上送有内容的；已存在同键不覆盖；成功后清本地", async () => {
  const storage = memStorage();
  const server = fakeServer();
  const local = createLocalStore(storage);
  await local.save(TASK, comment({ anchor: { source: "worktree", path: "a.md", side: "new", start: 1, end: 1 }, body: "有内容" }));
  // 空白 body **且** 无语气 → 不上送（有语气标记的算有内容，要上送）
  await local.save(TASK, comment({ anchor: { source: "worktree", path: "b.md", side: "new", start: 1, end: 1 }, body: "   ", marks: [] }));
  const store = createHttpStore({ fetch: server.fetch, storage });
  const sent = await store.migrate(TASK);
  assert.equal(sent, 1, `只应上送 1 条（空白的不算），实际 ${sent}`);
  const after = await store.list(TASK);
  assert.equal(after.length, 1);
  assert.equal(after[0].body, "有内容");
  assert.equal(hasLocalOnlyComments(storage, TASK), false, "有内容的本地副本要清掉；空草稿不算未上送");
  assert.equal(localCommentsOf(storage, TASK).length, 1, "空白那条仍留在本地（它就是本地草稿，不该被上送也不该被清）");
});

test("Store·迁移 · 服务端已有同键 → 不覆盖服务端（服务端更权威）", async () => {
  const storage = memStorage();
  const server = fakeServer();
  const http = createHttpStore({ fetch: server.fetch, storage });
  await http.save(TASK, comment({ body: "服务端版本" }));
  createLocalStore(storage).save(TASK, comment({ body: "本地旧版本" }));
  const sent = await http.migrate(TASK);
  assert.equal(sent, 0, "同键已存在 → 不重复上送");
  assert.equal((await http.list(TASK))[0].body, "服务端版本", "不能被本地旧版本覆盖");
});

test("Store·durable 标记：Http=true / Local=false（UI 据此提示离线）", () => {
  const storage = memStorage();
  assert.equal(createHttpStore({ fetch: fakeServer().fetch, storage }).durable, true);
  assert.equal(createLocalStore(storage).durable, false);
});
