// 压缩状态派生（Task 0041 · P2 / S5）。纯函数，无 IO、无 DOM、不依赖真模型。
//
// 覆盖三态（idle / running / failed）+ 重放幂等 + 中止不算失败 + 兜底文案。
import assert from "node:assert/strict";
import test from "node:test";
import {
  applyCompactionEvent,
  compactionLabelOf,
  FALLBACK_FAILURE_MESSAGE,
  IDLE_COMPACTION,
  reasonTextOf,
  reduceCompactionEvents,
} from "../frontend/src/api/compaction-state.ts";

const ev = (over) => ({ type: "compaction", ...over });

test("初始状态是 idle，不显示任何文案", () => {
  assert.deepEqual(IDLE_COMPACTION, { kind: "idle" });
  assert.equal(compactionLabelOf(IDLE_COMPACTION), undefined);
});

test("start → running，带 reason 与 overflow 标记", () => {
  const running = applyCompactionEvent(IDLE_COMPACTION, ev({ phase: "start", reason: "threshold" }));
  assert.deepEqual(running, { kind: "running", reason: "threshold", overflow: false });
  assert.equal(compactionLabelOf(running), "正在压缩上下文…");

  const overflow = applyCompactionEvent(IDLE_COMPACTION, ev({ phase: "start", reason: "overflow", overflow: true }));
  assert.deepEqual(overflow, { kind: "running", reason: "overflow", overflow: true });
  assert.equal(compactionLabelOf(overflow), "正在压缩上下文（上一轮已溢出）…");
});

test("end + ok → 回到 idle（成功不在状态条常显，结果在历史卡片里）", () => {
  const running = applyCompactionEvent(IDLE_COMPACTION, ev({ phase: "start", reason: "manual" }));
  const done = applyCompactionEvent(running, ev({ phase: "end", reason: "manual", ok: true, tokensBefore: 900000 }));
  assert.deepEqual(done, { kind: "idle" });
  assert.equal(compactionLabelOf(done), undefined);
});

test("end + aborted → 回到 idle（用户打断不是失败，不该报错）", () => {
  const running = applyCompactionEvent(IDLE_COMPACTION, ev({ phase: "start", reason: "manual" }));
  const aborted = applyCompactionEvent(running, ev({ phase: "end", reason: "manual", ok: false, aborted: true }));
  assert.deepEqual(aborted, { kind: "idle" }, "中止必须收敛成 idle，否则界面会报一个不存在的错误");
});

test("end + 失败 → failed，带原因", () => {
  const running = applyCompactionEvent(IDLE_COMPACTION, ev({ phase: "start", reason: "threshold" }));
  const failed = applyCompactionEvent(running, ev({
    phase: "end", reason: "threshold", ok: false, aborted: false,
    errorMessage: "Summarization failed: generation hit the token cap",
  }));
  assert.deepEqual(failed, {
    kind: "failed", reason: "threshold",
    message: "Summarization failed: generation hit the token cap",
  });
  assert.equal(compactionLabelOf(failed), "压缩失败：Summarization failed: generation hit the token cap");
});

test("end + 失败但没有原因 → 用兜底文案，不显示空白", () => {
  for (const errorMessage of [undefined, "", "   "]) {
    const failed = applyCompactionEvent(IDLE_COMPACTION, ev({
      phase: "end", reason: "overflow", ok: false, aborted: false, errorMessage,
    }));
    assert.equal(failed.kind, "failed");
    assert.equal(failed.message, FALLBACK_FAILURE_MESSAGE, `errorMessage=${String(errorMessage)}`);
  }
});

test("幂等：同一事件重复到达结果不变（重连重放是常态）", () => {
  const start = ev({ phase: "start", reason: "threshold" });
  let state = IDLE_COMPACTION;
  for (let i = 0; i < 5; i += 1) state = applyCompactionEvent(state, start);
  assert.deepEqual(state, { kind: "running", reason: "threshold", overflow: false });

  const end = ev({ phase: "end", reason: "threshold", ok: true });
  for (let i = 0; i < 5; i += 1) state = applyCompactionEvent(state, end);
  assert.deepEqual(state, { kind: "idle" });
});

test("乱序：先收到 end 再收到 start（重放场景）→ 以最后的 start 为准", () => {
  const end = ev({ phase: "end", reason: "manual", ok: true });
  const start = ev({ phase: "start", reason: "manual" });
  let state = IDLE_COMPACTION;
  state = applyCompactionEvent(state, end);
  state = applyCompactionEvent(state, start);
  assert.equal(state.kind, "running", "最后的 start 说明又开了一次压缩");
});

test("reduceCompactionEvents：整条事件流里挑出压缩事件，忽略其余", () => {
  const state = reduceCompactionEvents([
    { type: "delta", index: 0, text: "hi" },
    ev({ phase: "start", reason: "threshold" }),
    { type: "tool_start", id: "c1", name: "read", arguments: {} },
    ev({ phase: "end", reason: "threshold", ok: false, errorMessage: "boom" }),
    { type: "retry_end", success: true },
  ]);
  assert.deepEqual(state, { kind: "failed", reason: "threshold", message: "boom" });
});

test("reduceCompactionEvents：空流 → idle", () => {
  assert.deepEqual(reduceCompactionEvents([]), { kind: "idle" });
});

test("reduceCompactionEvents：形状不对的压缩事件被跳过（不猜）", () => {
  const state = reduceCompactionEvents([
    { type: "compaction", phase: "bogus", reason: "manual" },
    { type: "compaction", phase: "start", reason: "bogus" },
    { type: "compaction", phase: "start" },
    null,
    "junk",
    42,
  ]);
  assert.deepEqual(state, { kind: "idle" });
});

test("reasonTextOf：三种 reason 都有人话（不暴露 Pi 的枚举名）", () => {
  assert.equal(reasonTextOf("manual"), "手动触发");
  assert.equal(reasonTextOf("threshold"), "上下文接近上限");
  assert.equal(reasonTextOf("overflow"), "上一轮已溢出");
});

// 活性自检（testing.md 2.4）：把「aborted 当失败」的实现改回来，上面那条必须变红。
// 这里额外锁住语义：aborted 与 ok=false 同时出现时，必须收敛成 idle。
test("活性：aborted 必须优先于 ok=false（否则会把中止报成失败）", () => {
  const failedIfWrong = applyCompactionEvent(IDLE_COMPACTION, ev({
    phase: "end", reason: "manual", ok: false, aborted: true, errorMessage: "should be ignored",
  }));
  assert.equal(failedIfWrong.kind, "idle", "aborted 优先；把判断顺序写反会让这条变红");
});
