import test from "node:test";
import assert from "node:assert/strict";
import { revealActions, visibleActions } from "../frontend/src/action-bar.ts";

test("动作条可见性：状态动作常显，内容动作靠悬停", () => {
  assert.equal(revealActions(false, false, false), false, "普通消息不悬停 → 不显示");
  assert.equal(revealActions(true, false, false), true, "悬停 → 显示");
  assert.equal(revealActions(false, true, false), true, "无悬停设备 → 常显");
  assert.equal(revealActions(false, false, true), true, "有 pinned（失败重发）→ 常显");
});

test("流式抑制：一条动作都不出现（不论是否 pinned）", () => {
  const actions = [
    { key: "copy", label: "复制", run: () => undefined },
    { key: "resend", label: "重新发送", pinned: true, run: () => undefined },
  ];
  assert.deepEqual(visibleActions(actions, true), [], "流式中整体抑制");
  assert.deepEqual(visibleActions(actions, false), actions, "非流式原样返回");
});
