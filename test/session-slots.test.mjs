// 徽标槽位状态机（Task 0037）：**一条补丁里的多个字段必须各自求值**。
//
// 回归对象（用户 2026-11-24 实测）：
//   「这里都没有会话在运行了，为什么还有呼吸的 1 呢？」
//   根因是 `applySlotFromPatch()` 的 else-if 链把 `{running: null, unread: null}`
//   只交给了 `clearUnreadSlot()`，而它对 running 槽位直接 return →
//   `running: null` 静默失效；当前 Agent 靠重取自愈，**别的 Agent 没有重取**，于是永久残留。
//
// 打桩红线：`evidence/P6-repro-other-agent-terminal.mjs`（真页面，改前红、改后绿）。
// 本文件把同一条规则压成纯函数穷举，覆盖 UI 探针造不出来的组合。
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  nextSlotEntry,
  reconcileRunningSlots,
  slotAfterPatch,
  slotOfActivity,
  staleRunningSlots,
} from "../frontend/src/api/session-slots.ts";

const entry = (slot, agentId = "a", projectId = "p1") => ({ agentId, ...(projectId !== undefined ? { projectId } : {}), slot });
const since = "2026-11-24T12:00:00.000Z";

// ── T80：本次根因 ──────────────────────────────────────────────
// 服务端"用户就停在这个会话上"时推的终止补丁：`pushTerminal` 强制带 `running: null`
// （`src/row-patch.ts:132`），`agent-host.ts:1061` 再带 `unread: null`。
test("T80 {running:null, unread:null} 必须清掉 running（不能只清未读）", () => {
  assert.equal(slotAfterPatch("running", { running: null, unread: null }), undefined);
  assert.equal(slotAfterPatch("unreadDone", { running: null, unread: null }), undefined);
  // 真·终止补丁还有 lastActivityAt：它不参与状态判断，不得改变结论
  assert.equal(slotAfterPatch("running", { running: null, unread: null, failure: null }), undefined);
});

test("T80b 真·终止补丁（带 lastActivityAt / failure:null）同结论", () => {
  const patch = { running: null, unread: null, failure: null, lastActivityAt: since };
  assert.equal(slotAfterPatch("running", patch), undefined);
});

// ── T81：2026-11-05 的保护语义不变 ─────────────────────────────
// 只带 `unread: null` 的补丁（点开正在跑的会话 / focus 端点）**不得**把 running 一起清掉。
test("T81 只带 {unread:null} 不清掉 running（2026-11-05 的保护）", () => {
  assert.equal(slotAfterPatch("running", { unread: null }), "running");
  assert.equal(slotAfterPatch("unreadDone", { unread: null }), undefined, "未读被看过 → 不再占格");
});

// ── T82：正常终态 ─────────────────────────────────────────────
test("T82 {running:null, unread:{since}} → 完成待查看", () => {
  assert.equal(slotAfterPatch("running", { running: null, unread: { since } }), "unreadDone");
});

test("T83 带 failure 的终态 → 失败待查看（不是完成）", () => {
  const failure = { kind: "auth", detail: "401" };
  assert.equal(slotAfterPatch("running", { running: null, unread: { since }, failure }), "unreadError");
  assert.equal(slotAfterPatch(undefined, { unread: { since }, failure }), "unreadError");
});

// ── T84：开跑与"与状态无关的补丁" ─────────────────────────────
test("T84 开跑补丁 → running（即使同一补丁也带了 unread）", () => {
  assert.equal(slotAfterPatch(undefined, { running: { since } }), "running");
  assert.equal(slotAfterPatch("unreadDone", { running: { since } }), "running");
  // 开跑优先于未读（与后端四态 running > failure > unread 同序）
  assert.equal(slotAfterPatch("unreadError", { running: { since }, unread: { since }, failure: { kind: "auth", detail: "" } }), "running");
});

test("T85 与状态无关的补丁（只带 title / task / 空对象）不改槽位", () => {
  assert.equal(slotAfterPatch("running", { title: { raw: "x", display: "x" } }), "running");
  assert.equal(slotAfterPatch(undefined, {}), undefined);
  assert.equal(slotAfterPatch("unreadDone", { task: null }), "unreadDone");
});

test("T86 removed 一律不占格", () => {
  assert.equal(slotAfterPatch("running", { removed: true }), undefined);
  assert.equal(slotAfterPatch("unreadError", { removed: true, was: "unreadError" }), undefined);
});

// ── T87–T89：归属（projectId 只增不减、agentId 跟着补丁走） ──────
test("T87 不带 projectId 的补丁不把槽位挪进「无项目桶」", () => {
  const next = nextSlotEntry(entry("running"), "a", undefined, { running: { since } });
  assert.deepEqual(next, { agentId: "a", projectId: "p1", slot: "running" });
});

test("T88 不带 projectId 的终态补丁同样保住归属", () => {
  const next = nextSlotEntry(entry("running"), "a", undefined, { running: null, unread: { since } });
  assert.deepEqual(next, { agentId: "a", projectId: "p1", slot: "unreadDone" });
});

test("T89 清空槽位时不给空壳对象", () => {
  assert.equal(nextSlotEntry(entry("running"), "a", "p1", { running: null, unread: null }), undefined);
  assert.equal(nextSlotEntry(undefined, "a", "p1", { unread: null }), undefined);
});

// ── T90–T92：运行集合对账（推送丢了也要收敛） ───────────────────
test("T90 对账：服务端不在跑 → 清掉残留的 running 槽位", () => {
  const slots = new Map([["s1", entry("running")]]);
  const next = reconcileRunningSlots(slots, []);
  assert.equal(next?.get("s1"), undefined);
});

test("T91 对账：服务端在跑 → 补上漏掉的 running（只补 running，不动未读）", () => {
  const slots = new Map([["s2", entry("unreadDone")]]);
  const next = reconcileRunningSlots(slots, [{ sessionId: "s1", agentId: "a", projectId: "p1" }]);
  assert.deepEqual(next?.get("s1"), { agentId: "a", projectId: "p1", slot: "running" });
  assert.equal(next?.get("s2")?.slot, "unreadDone", "未读的真相不在运行接口里，不能顺手清掉");
});

test("T92 对账：一致时不产生新 Map（避免无意义重渲染）", () => {
  const slots = new Map([["s1", entry("running")], ["s2", entry("unreadDone")]]);
  assert.equal(reconcileRunningSlots(slots, [{ sessionId: "s1", agentId: "a", projectId: "p1" }]), undefined);
});

test("T93 对账：服务端给的归属是权威（显式 projectId 覆盖旧值）", () => {
  const slots = new Map([["s1", entry("running")]]);
  const next = reconcileRunningSlots(slots, [{ sessionId: "s1", agentId: "a", projectId: "p2" }]);
  assert.deepEqual(next?.get("s1"), { agentId: "a", projectId: "p2", slot: "running" });
});

test("T93b 对账：服务端没给 projectId 时不得把已有归属揭掉（只增不减）", () => {
  // 槽位里是未读，运行集合里是同一条会话且缺 projectId → 变成 running，但归属保住 p1
  const slots = new Map([["s1", entry("unreadDone")]]);
  const next = reconcileRunningSlots(slots, [{ sessionId: "s1", agentId: "a" }]);
  assert.deepEqual(next?.get("s1"), { agentId: "a", projectId: "p1", slot: "running" });
});

// ── T95：哪些 running 槽位服务端已经不认了（只在"有残留"时才多一次列表重取） ──
test("T95 staleRunningSlots 只报服务端不认的 running 槽位", () => {
  const slots = new Map([
    ["s1", entry("running")],        // 服务端说还在跑 → 不是残留
    ["s2", entry("running")],        // 服务端说没在跑 → 残留
    ["s3", entry("unreadDone")],     // 未读不归运行集合管 → 永远不算残留
  ]);
  assert.deepEqual(staleRunningSlots(slots, [{ sessionId: "s1" }]), ["s2"]);
  assert.deepEqual(staleRunningSlots(slots, [{ sessionId: "s1" }, { sessionId: "s2" }]), []);
});

// ── T94：行的四态 → 槽位（与 rowActivityOf 同源，重取时校正槽位用） ──
test("T94 行的四态映射到槽位", () => {
  assert.equal(slotOfActivity({ state: "running" }), "running");
  assert.equal(slotOfActivity({ state: "unread" }), "unreadDone");
  assert.equal(slotOfActivity({ state: "failure" }), "unreadError");
  assert.equal(slotOfActivity({ state: "idle" }), undefined);
});
