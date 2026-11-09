// S4-e：前端判定与服务端判定**必须一致**（C191 的教训：两份实现分叉时，测试要能抓出来）。
//
// 为什么有两份：服务端 `src/review-comments.ts` 有 `node:fs`，前端不能 import（会白屏）；
// 所以规则写两份，但**同一张用例表跑两边**，任一边改了而另一边没改 → 这里红。
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const HOME = mkdtempSync(join(tmpdir(), "review-parity-home-"));
process.env.LIFEOS_HOME = HOME;

const server = await import("../src/review-comments.ts");
const client = await import("../frontend/src/review-comment-state.ts");

const USER = { kind: "user", id: "xu-later" };
const CODER = { kind: "agent", id: "coder" };
const REVIEWER = { kind: "agent", id: "reviewer" };

/** 同一张用例表：server / client 两边都要得出同一结论。 */
const CASES = [
  ["作者本人（agent）", { author: CODER, canClose: "author-or-user" }, CODER, true],
  ["作者本人（user）", { author: USER, canClose: "author" }, USER, true],
  ["别的 agent", { author: CODER, canClose: "author-or-user" }, REVIEWER, false],
  ["用户关 agent 的（默认策略）", { author: CODER, canClose: "author-or-user" }, USER, true],
  ["用户关 agent 的（author-only）", { author: CODER, canClose: "author" }, USER, false],
  ["agent 关用户的", { author: USER, canClose: "author-or-user" }, CODER, false],
  ["agent 关用户的（author-only）", { author: USER, canClose: "author" }, CODER, false],
  ["用户关用户的", { author: USER, canClose: "author-or-user" }, USER, true],
];

test("S4e·parity·1 canClose 判定：8 个用例在服务端与前端结果一致", () => {
  for (const [name, comment, by, expected] of CASES) {
    const s = server.canCloseComment({ author: comment.author, canClose: comment.canClose }, by);
    const c = client.canCloseCommentBy({ author: comment.author, canClose: comment.canClose }, by);
    assert.equal(s, expected, `服务端判定错：${name}`);
    assert.equal(c, expected, `前端判定错：${name}`);
    assert.equal(s, c, `两边不一致：${name}`);
  }
});

test("S4e·parity·2 awaitingOf：已关闭一律 null，两边一致", () => {
  const rows = [
    { state: "open", awaiting: "agent" },
    { state: "open", awaiting: "user" },
    { state: "open", awaiting: null },
    { state: "resolved", awaiting: "agent" },
    { state: "draft", awaiting: null },
  ];
  for (const row of rows) {
    const s = server.awaitingOf({ state: row.state, awaiting: row.awaiting });
    const c = client.awaitingOfComment({ state: row.state, awaiting: row.awaiting });
    assert.equal(s, c, `不一致：${JSON.stringify(row)}`);
    if (row.state === "resolved") assert.equal(s, null, "已关闭不再等谁");
  }
});

test("S4e·parity·3 isClosed：两边一致", () => {
  for (const state of ["draft", "open", "resolved"]) {
    assert.equal(server.isClosed({ state }), client.isClosedComment({ state }), state);
    assert.equal(server.isClosed({ state }), state === "resolved", state);
  }
});

test.after(() => { rmSync(HOME, { recursive: true, force: true }); });
