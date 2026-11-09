// S4-b：评论接口（GET/POST /api/review/comments）——失败路径先写（backend 2.5）。
//
// 参考：本仓既有接口的失败形状（`src/server.ts` 的 `problem()`：`{error:{code,message}}` + 状态码语义）；
// 语义分类依据 `specs/code/api/api.md` 2.3（409 打架 / 400 参数 / 404 不存在）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { start } from "./server-harness.mjs";

const TASK_DIR = "/tmp/s4b-api-task";

const comment = (over = {}) => ({
  taskId: "0010",
  author: { kind: "user", id: "xu-later" },
  anchor: { source: "worktree", path: "README.md", side: "new", start: 3, end: 5, snapshot: "a\nb\nc" },
  body: "这条要同步 protocol.md 吗",
  marks: ["query"],
  ...over,
});

test("S4bAPI·1 GET 空 → { items: [] }（列表统一包 items）", async () => {
  const { server, base } = await start();
  try {
    const r = await fetch(`${base}/api/review/comments?taskDir=${encodeURIComponent(TASK_DIR)}`);
    assert.equal(r.status, 200);
    assert.deepEqual((await r.json()).items, []);
  } finally { server.close(); }
});

test("S4bAPI·2 GET 缺 taskDir → 400 invalid_request", async () => {
  const { server, base } = await start();
  try {
    const r = await fetch(`${base}/api/review/comments`);
    assert.equal(r.status, 400);
    assert.equal((await r.json()).error.code, "invalid_request");
  } finally { server.close(); }
});

test("S4bAPI·3 POST add → 201，返回落盘后的评论（含 id/state）", async () => {
  const { server, base } = await start();
  try {
    const r = await fetch(`${base}/api/review/comments`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ taskDir: TASK_DIR, op: "add", comment: comment() }),
    });
    assert.equal(r.status, 201);
    const body = await r.json();
    assert.ok(body.comment?.id, JSON.stringify(body));
    assert.equal(body.comment.state, "open", "S4-e：新评论默认 open");
    assert.equal(body.comment.awaiting, null);
    assert.equal(body.comment.canClose, "author-or-user");
    assert.deepEqual(body.comment.marks, ["query"]);
  } finally { server.close(); }
});

test("S4bAPI·4 POST 非法 op → 400；缺 comment → 400（错误说清原因）", async () => {
  const { server, base } = await start();
  try {
    const badOp = await fetch(`${base}/api/review/comments`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ taskDir: TASK_DIR, op: "explode", comment: comment() }),
    });
    assert.equal(badOp.status, 400);
    assert.match((await badOp.json()).error.message, /op/);

    const noComment = await fetch(`${base}/api/review/comments`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ taskDir: TASK_DIR, op: "add" }),
    });
    assert.equal(noComment.status, 400);
    assert.equal((await noComment.json()).error.code, "invalid_request");
  } finally { server.close(); }
});

test("S4bAPI·5 POST 评论字段不合法（side 非法 / 行号 0）→ 400，不落盘", async () => {
  const { server, base } = await start();
  const dir = `${TASK_DIR}-invalid`;
  try {
    const bad = await fetch(`${base}/api/review/comments`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ taskDir: dir, op: "add", comment: comment({ anchor: { source: "worktree", path: "a.ts", side: "middle", start: 1, end: 1 } }) }),
    });
    assert.equal(bad.status, 400);
    const list = await fetch(`${base}/api/review/comments?taskDir=${encodeURIComponent(dir)}`);
    assert.deepEqual((await list.json()).items, [], "非法条目不能被落盘");
  } finally { server.close(); }
});

test("S4bAPI·6 POST remove → 200；删除不存在的 id 仍 200（幂等，removed:false）", async () => {
  const { server, base } = await start();
  const dir = `${TASK_DIR}-remove`;
  try {
    const created = await fetch(`${base}/api/review/comments`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ taskDir: dir, op: "add", comment: comment() }),
    });
    const id = (await created.json()).comment.id;
    const removed = await fetch(`${base}/api/review/comments`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ taskDir: dir, op: "remove", id }),
    });
    assert.equal(removed.status, 200);
    assert.equal((await removed.json()).removed, true);

    const again = await fetch(`${base}/api/review/comments`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ taskDir: dir, op: "remove", id }),
    });
    assert.equal(again.status, 200);
    assert.equal((await again.json()).removed, false, "幂等：第二次 removed=false");
  } finally { server.close(); }
});

test("S4bAPI·7 按 taskDir 隔离：两个目录互不可见", async () => {
  const { server, base } = await start();
  try {
    await fetch(`${base}/api/review/comments`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ taskDir: `${TASK_DIR}-A`, op: "add", comment: comment() }),
    });
    const b = await fetch(`${base}/api/review/comments?taskDir=${encodeURIComponent(`${TASK_DIR}-B`)}`);
    assert.deepEqual((await b.json()).items, [], "B 目录看不到 A 的评论");
  } finally { server.close(); }
});

// ── S4-e：状态接口（A18/A19）────────────────────────────────────────────────
test("S4eAPI·1 op=state 关闭 → 200，state=resolved，记录 resolvedBy", async () => {
  const { server, base } = await start();
  const dir = `${TASK_DIR}-state1`;
  try {
    const created = await fetch(`${base}/api/review/comments`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ taskDir: dir, op: "add", comment: comment() }),
    });
    const id = (await created.json()).comment.id;
    const closed = await fetch(`${base}/api/review/comments`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ taskDir: dir, op: "state", id, state: "resolved", by: { kind: "user", id: "xu-later" } }),
    });
    assert.equal(closed.status, 200);
    const body = await closed.json();
    assert.equal(body.comment.state, "resolved");
    assert.equal(body.comment.resolvedBy.id, "xu-later");
    assert.ok(body.comment.resolvedAt);
  } finally { server.close(); }
});

test("S4eAPI·2 别的 Agent 关闭别人的评论 → **403 forbidden**（不是 400，也不是静默）", async () => {
  const { server, base } = await start();
  const dir = `${TASK_DIR}-state2`;
  try {
    const created = await fetch(`${base}/api/review/comments`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ taskDir: dir, op: "add", comment: comment({ author: { kind: "agent", id: "coder" } }) }),
    });
    const id = (await created.json()).comment.id;
    const denied = await fetch(`${base}/api/review/comments`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ taskDir: dir, op: "state", id, state: "resolved", by: { kind: "agent", id: "reviewer" } }),
    });
    assert.equal(denied.status, 403);
    const err = await denied.json();
    assert.equal(err.error.code, "forbidden");
    assert.match(err.error.message, /coder/, "错误要指出谁能关");
    // 状态没被改
    const list = await fetch(`${base}/api/review/comments?taskDir=${encodeURIComponent(dir)}`);
    assert.equal((await list.json()).items[0].state, "open", "被拒绝后状态不变（S4-e 默认是 open）");
  } finally { server.close(); }
});

test("S4eAPI·3 提出者自己能关 → 200", async () => {
  const { server, base } = await start();
  const dir = `${TASK_DIR}-state3`;
  try {
    const created = await fetch(`${base}/api/review/comments`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ taskDir: dir, op: "add", comment: comment({ author: { kind: "agent", id: "coder" } }) }),
    });
    const id = (await created.json()).comment.id;
    const ok = await fetch(`${base}/api/review/comments`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ taskDir: dir, op: "state", id, state: "resolved", by: { kind: "agent", id: "coder" } }),
    });
    assert.equal(ok.status, 200);
  } finally { server.close(); }
});

test("S4eAPI·4 state 参数非法 → 400；id 不存在 → 404", async () => {
  const { server, base } = await start();
  const dir = `${TASK_DIR}-state4`;
  try {
    const badState = await fetch(`${base}/api/review/comments`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ taskDir: dir, op: "state", id: "x", state: "exploded", by: { kind: "user", id: "u" } }),
    });
    assert.equal(badState.status, 400);
    const badBy = await fetch(`${base}/api/review/comments`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ taskDir: dir, op: "state", id: "x", state: "resolved", by: { kind: "robot", id: "u" } }),
    });
    assert.equal(badBy.status, 400);
    const missing = await fetch(`${base}/api/review/comments`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ taskDir: dir, op: "state", id: "nope", state: "resolved", by: { kind: "user", id: "u" } }),
    });
    assert.equal(missing.status, 404);
    assert.equal((await missing.json()).error.code, "comment_not_found");
  } finally { server.close(); }
});

// ── S4-h：回复 / awaiting 的接口（失败路径先写）────────────────────────────

/** 建一条根评论，返回 id。 */
async function makeRoot(base, taskDir, over = {}) {
  const r = await fetch(`${base}/api/review/comments`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ taskDir, op: "add", comment: comment(over) }),
  });
  return (await r.json()).comment.id;
}

test("S4hAPI·1 POST reply → 201，返回带 replies 的线程；awaiting 交棒给 user", async () => {
  const { server, base } = await start();
  const dir = `${TASK_DIR}-reply`;
  try {
    const id = await makeRoot(base, dir);
    const r = await fetch(`${base}/api/review/comments`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ taskDir: dir, op: "reply", id, reply: { author: { kind: "agent", id: "coder" }, body: "已同步" } }),
    });
    assert.equal(r.status, 201);
    const body = await r.json();
    assert.equal(body.comment.replies.length, 1);
    assert.equal(body.comment.replies[0].body, "已同步");
    assert.equal(body.comment.awaiting, "user", "Agent 回复要交棒给用户");
  } finally { server.close(); }
});

test("S4hAPI·2 POST reply 缺 id / 缺 reply / author 非法 → 400（三种参数病各一条）", async () => {
  const { server, base } = await start();
  const dir = `${TASK_DIR}-reply-bad`;
  try {
    const id = await makeRoot(base, dir);
    const post = (payload) => fetch(`${base}/api/review/comments`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload),
    });
    assert.equal((await post({ taskDir: dir, op: "reply", reply: { author: { kind: "user", id: "u" }, body: "x" } })).status, 400);
    assert.equal((await post({ taskDir: dir, op: "reply", id })).status, 400);
    assert.equal((await post({ taskDir: dir, op: "reply", id, reply: { author: { kind: "robot", id: "x" }, body: "x" } })).status, 400);
  } finally { server.close(); }
});

test("S4hAPI·3 已关闭的线程 reply → 403（不是 400：这是状态不允许，不是参数错）", async () => {
  const { server, base } = await start();
  const dir = `${TASK_DIR}-reply-closed`;
  try {
    const id = await makeRoot(base, dir);
    const close = await fetch(`${base}/api/review/comments`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ taskDir: dir, op: "state", id, state: "resolved", by: { kind: "user", id: "xu-later" } }),
    });
    assert.equal(close.status, 200);
    const r = await fetch(`${base}/api/review/comments`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ taskDir: dir, op: "reply", id, reply: { author: { kind: "agent", id: "coder" }, body: "还想说" } }),
    });
    assert.equal(r.status, 403);
    assert.match((await r.json()).error.message, /关闭|重开/);
  } finally { server.close(); }
});

test("S4hAPI·4 reply-remove：作者删自己的成功；别的 Agent 删 → 403；不存在的 reply → 幂等 200", async () => {
  const { server, base } = await start();
  const dir = `${TASK_DIR}-reply-remove`;
  try {
    const id = await makeRoot(base, dir);
    const added = await fetch(`${base}/api/review/comments`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ taskDir: dir, op: "reply", id, reply: { author: { kind: "agent", id: "coder" }, body: "我说的话" } }),
    });
    const replyId = (await added.json()).comment.replies[0].id;
    const post = (payload) => fetch(`${base}/api/review/comments`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload),
    });

    const denied = await post({ taskDir: dir, op: "reply-remove", id, replyId, by: { kind: "agent", id: "reviewer" } });
    assert.equal(denied.status, 403, "别的 Agent 删掉了别人的回复");

    const ok = await post({ taskDir: dir, op: "reply-remove", id, replyId, by: { kind: "agent", id: "coder" } });
    assert.equal(ok.status, 200);
    assert.deepEqual((await ok.json()).comment.replies, []);

    const idempotent = await post({ taskDir: dir, op: "reply-remove", id, replyId: "rr_nope", by: { kind: "user", id: "xu-later" } });
    assert.equal(idempotent.status, 200, "删不存在的回复应幂等成功");
  } finally { server.close(); }
});

test("S4hAPI·5 awaiting：user/agent/null 三值各一条；非法值 400；不存在的评论 404", async () => {
  const { server, base } = await start();
  const dir = `${TASK_DIR}-awaiting`;
  try {
    const id = await makeRoot(base, dir);
    const post = (payload) => fetch(`${base}/api/review/comments`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload),
    });
    for (const value of ["agent", "user", null]) {
      const r = await post({ taskDir: dir, op: "awaiting", id, awaiting: value, by: { kind: "user", id: "xu-later" } });
      assert.equal(r.status, 200, `awaiting=${value}`);
      assert.equal((await r.json()).comment.awaiting, value);
    }
    assert.equal((await post({ taskDir: dir, op: "awaiting", id, awaiting: "nobody", by: { kind: "user", id: "xu-later" } })).status, 400);
    assert.equal((await post({ taskDir: dir, op: "awaiting", id: "nope", awaiting: "agent", by: { kind: "user", id: "xu-later" } })).status, 404);
  } finally { server.close(); }
});

test("S4hAPI·6 reply-update：改正文成功；别人改 → 403", async () => {
  const { server, base } = await start();
  const dir = `${TASK_DIR}-reply-update`;
  try {
    const id = await makeRoot(base, dir);
    const added = await fetch(`${base}/api/review/comments`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ taskDir: dir, op: "reply", id, reply: { author: { kind: "agent", id: "coder" }, body: "错字" } }),
    });
    const replyId = (await added.json()).comment.replies[0].id;
    const post = (payload) => fetch(`${base}/api/review/comments`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload),
    });
    const denied = await post({ taskDir: dir, op: "reply-update", id, reply: { id: replyId, author: { kind: "agent", id: "reviewer" }, body: "我改" } });
    assert.equal(denied.status, 403);
    const ok = await post({ taskDir: dir, op: "reply-update", id, reply: { id: replyId, author: { kind: "agent", id: "coder" }, body: "改好了" } });
    assert.equal(ok.status, 200);
    assert.equal((await ok.json()).comment.replies[0].body, "改好了");
  } finally { server.close(); }
});
