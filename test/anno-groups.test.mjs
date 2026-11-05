/**
 * 批注按轮分组（Task 0008 · P2 修订）—— 用户 2026-11-04 的规则：
 *
 *  1. pending（未发送）→ 全部显示在【最新一轮】Agent 回复的 MarkBar（不管标的是哪轮的文字）；
 *  2. consumed（已发送）→ 显示在【被发送那一轮】的 MarkBar（历史不动）；
 *  3. 被取代的旧版本（supersededBy）不显示；
 *  4. 一条回复最多一个 MarkBar；多个轮次各有各的。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { groupAnnotationsByReply } from "../frontend/src/anno-groups.ts";

/** 造消息序列：spec = ["u"|"a", id]。 */
const msgs = (...spec) =>
  spec.map(([role, id]) => ({ role: role === "u" ? "user" : "assistant", id }));

const anno = (id, over = {}) => ({
  id, author: { kind: "user", id: "u" }, messageId: "whatever", blockIndex: 0,
  start: 0, end: 2, quote: "q", marks: ["critic"], note: "", ...over,
});

test("分组-1 pending 全部挂到最新一轮的回复（哪怕标的是第一轮的文字）", () => {
  const messages = msgs(["u", "u1"], ["a", "a1"], ["u", "u2"], ["a", "a2"]);
  const annos = [
    anno("x1", { messageId: "a1" }),   // 标在第一轮回复上
    anno("x2", { messageId: "a2" }),   // 标在第二轮回复上
  ];
  const groups = groupAnnotationsByReply(annos, messages, "a2");
  assert.deepEqual([...groups.get("a2") ?? []].map((a) => a.id), ["x1", "x2"], "都挂到最新一轮");
  assert.equal(groups.has("a1"), false, "第一轮不挂");
});

test("分组-2 consumed 挂在被发送那一轮（历史不动）", () => {
  const messages = msgs(["u", "u1"], ["a", "a1"], ["u", "u2"], ["a", "a2"]);
  const annos = [
    anno("old", { messageId: "a1", consumedBy: "u1" }),   // 随第一轮发出的
    anno("fresh", { messageId: "a2" }),                    // 新标的
  ];
  const groups = groupAnnotationsByReply(annos, messages, "a2");
  assert.deepEqual([...groups.get("a1") ?? []].map((a) => a.id), ["old"], "已发送的留在第一轮");
  assert.deepEqual([...groups.get("a2") ?? []].map((a) => a.id), ["fresh"], "pending 在最新一轮");
});

test("分组-3 两轮各有 consumed：各挂各的（同一对话多个 MarkBar）", () => {
  const messages = msgs(["u", "u1"], ["a", "a1"], ["u", "u2"], ["a", "a2"]);
  const annos = [
    anno("g1", { messageId: "a1", consumedBy: "u1" }),
    anno("g2", { messageId: "a2", consumedBy: "u2" }),
  ];
  const groups = groupAnnotationsByReply(annos, messages, "a2");
  assert.deepEqual([...groups.get("a1") ?? []].map((a) => a.id), ["g1"]);
  assert.deepEqual([...groups.get("a2") ?? []].map((a) => a.id), ["g2"]);
});

test("分组-4 被取代的旧版本不显示", () => {
  const messages = msgs(["u", "u1"], ["a", "a1"]);
  const annos = [
    anno("v1", { messageId: "a1", consumedBy: "u1", supersededBy: "v2" }),
    anno("v2", { messageId: "a1" }),
  ];
  const groups = groupAnnotationsByReply(annos, messages, "a1");
  assert.deepEqual([...groups.get("a1") ?? []].map((a) => a.id), ["v2"], "只显示最新");
});

test("分组-5 一轮多条回复：consumed 挂在该轮【最后一条】回复上", () => {
  const messages = msgs(["u", "u1"], ["a", "a1a"], ["a", "a1b"]);
  const annos = [anno("g", { messageId: "a1a", consumedBy: "u1" })];
  const groups = groupAnnotationsByReply(annos, messages, "a1b");
  assert.equal(groups.has("a1a"), false, "不挂中间那条");
  assert.deepEqual([...groups.get("a1b") ?? []].map((a) => a.id), ["g"], "挂轮末（一个轮只有一个 MarkBar）");
});

test("分组-6 最新轮还没有回复（用户刚发消息）：pending 无处挂、不丢数据", () => {
  const messages = msgs(["u", "u1"], ["a", "a1"], ["u", "u2"]);   // u2 之后还没有回复
  const annos = [
    anno("old", { messageId: "a1", consumedBy: "u1" }),
    anno("new", { messageId: "a1" }),
  ];
  const groups = groupAnnotationsByReply(annos, messages, undefined);
  assert.deepEqual([...groups.get("a1") ?? []].map((a) => a.id), ["old"], "已发送的照常显示");
  assert.equal(groups.get("a1")?.some((a) => a.id === "new"), false, "pending 暂不显示（等回复出现）");
  // 数据本身没丢：调用方仍持有 annotations，回复出现后自然挂上
});

test("分组-7 空会话/空批注不炸", () => {
  assert.equal(groupAnnotationsByReply([], [], undefined).size, 0);
  const groups = groupAnnotationsByReply([anno("a")], msgs(["u", "u1"]), "a1");
  assert.deepEqual([...groups.get("a1") ?? []].map((a) => a.id), ["a"], "隐式孤儿轮的批注挂到唯一回复");
});
