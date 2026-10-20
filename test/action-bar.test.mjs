import test from "node:test";
import assert from "node:assert/strict";
import { actionLabel, actionTone, revealActions, visibleActions } from "../frontend/src/action-bar.ts";

const action = { key: "copy", label: "复制", doneLabel: "已复制", failedLabel: "复制失败", run: () => undefined };

test("动作条可见性：悬停 / 触屏 / 反馈期间（不给任何动作开常显特例）", () => {
  const base = { hovered: false, noHover: false, feedback: false };
  assert.equal(revealActions(base), false, "不悬停 → 隐藏（失败重发也一样）");
  assert.equal(revealActions({ ...base, hovered: true }), true, "悬停 → 显示");
  assert.equal(revealActions({ ...base, noHover: true }), true, "无悬停设备 → 常显");
  assert.equal(revealActions({ ...base, feedback: true }), true, "展示反馈期间 → 保持可见，不随鼠标移开消失");
});

test("流式抑制：一条动作都不出现（不论是否 pinned）", () => {
  const actions = [action, { key: "resend", label: "重新发送", run: () => undefined }];
  assert.deepEqual(visibleActions(actions, true), [], "流式中整体抑制");
  assert.deepEqual(visibleActions(actions, false), actions, "非流式原样返回");
});

test("按钮文案：反馈期间换文案，没配 doneLabel 的动作不假装完成", () => {
  assert.equal(actionLabel(action, undefined), "复制");
  assert.equal(actionLabel(action, "done"), "已复制");
  assert.equal(actionLabel(action, "failed"), "复制失败");
  const silent = { key: "x", label: "执行", run: () => undefined };
  assert.equal(actionLabel(silent, "done"), "完成", "没有 doneLabel 时用兜底文案（调用方不会进 done 态，这条只保证不崩）");
});

test("语气：done=accent / failed=danger / 其余默认", () => {
  assert.equal(actionTone(undefined), "default");
  assert.equal(actionTone("done"), "accent");
  assert.equal(actionTone("failed"), "danger");
});
