// 打桩验证：一条连接"同时查看"多个会话时，细节事件是否投递正确。
// 场景来源：A 调 lifeos_ask 后右侧抽屉查看对端 Agent 的会话，抽屉要能实时收到对方的 delta/tool 事件。
import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_WATCHING, publish, subscribeBus } from "../src/events.ts";

const makeSub = () => {
  const seen = [];
  const sub = {
    id: `conn-${Math.random().toString(36).slice(2)}`,
    focus: undefined,
    offer(event) { seen.push(event); return true; },
    overflowed() { throw new Error("不该过载"); },
  };
  return { sub, seen };
};

test("细节事件：只投主会话 → 不投对端会话 → 加进 watching 后投递", () => {
  const { sub, seen } = makeSub();
  const reg = subscribeBus(sub);
  try {
    reg.ready();
    sub.focus = { agentId: "a", sessionId: "s-a", visible: true };

    publish("a", { sessionId: "s-a", type: "delta", text: "主会话增量" });           // 主会话 → 投
    publish("b", { sessionId: "s-b", type: "delta", text: "对端增量" });             // 对端未在看在看 → 丢
    assert.deepEqual(seen.map((e) => e.type + ":" + e.agentId), ["delta:a"], "未加入 watching 前不投对端");

    sub.focus = { agentId: "a", sessionId: "s-a", visible: true, watching: [{ agentId: "b", sessionId: "s-b" }] };
    publish("b", { sessionId: "s-b", type: "delta", text: "对端增量" });             // 加进 watching → 投
    publish("c", { sessionId: "s-c", type: "delta", text: "第三会话" });             // 无关会话 → 丢
    assert.deepEqual(seen.slice(1).map((e) => e.type + ":" + e.agentId), ["delta:b"], "只投主会话与 watching 内的会话");
  } finally { reg.close(); }
});

test("回合级事件不受 watching 限制：所有连接都收到（列表/未读靠它）", () => {
  const { sub, seen } = makeSub();
  const reg = subscribeBus(sub);
  try {
    reg.ready();
    sub.focus = { agentId: "a", sessionId: "s-a", visible: true };
    publish("z", { sessionId: "s-z", type: "done" });
    publish("z", { sessionId: "s-z", type: "turn", turnId: "t1", state: "done" });
    assert.equal(seen.filter((e) => e.type === "done").length, 1, "done 必须送达（否则列表状态不更新）");
    assert.equal(seen.filter((e) => e.type === "turn").length, 1);
  } finally { reg.close(); }
});

test("watching 上限常量存在且为正（服务端校验用同一份）", () => {
  assert.ok(Number.isInteger(MAX_WATCHING) && MAX_WATCHING > 0 && MAX_WATCHING <= 10);
});
