// 首屏就绪状态（Task 0019）——「加载中」是第三种状态，不能拿空数组冒充。
//
// 这些断言锁的是**互斥与不撒谎**两条：
//   ① 有内容就画内容，骨架绝不与真实行同框（listSurfaceOf）；
//   ② 还没拿到的东西不写结论（chatSurfaceOf 的 loading 分支、headerTitleOf 的 restoring）；
//   ③ 状态只前进不后退（"内容 → 加载" 在矩阵里不存在，见最后一条穷举）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { chatSurfaceOf, columnCountOf, listSurfaceOf } from "../frontend/src/api/boot-state.ts";
import { headerTitleOf } from "../frontend/src/api/header-strip.ts";

// ---------- 列表：骨架 / 空 / 有内容 ----------

test("列表：没就绪且没内容 = 加载中", () => {
  assert.equal(listSurfaceOf({ ready: false, count: 0 }), "loading");
});

test("列表：没就绪但**已有内容**（缓存/接口先到）= 直接画内容，不出骨架", () => {
  // 这就是用户截图里那一帧：14 个助手行 + 12 条骨架同框。
  assert.equal(listSurfaceOf({ ready: false, count: 14 }), "ready");
});

test("列表：就绪且空 = 真空态（不是骨架）", () => {
  assert.equal(listSurfaceOf({ ready: true, count: 0 }), "empty");
});

test("列表：就绪且有内容 = 内容", () => {
  assert.equal(listSurfaceOf({ ready: true, count: 3 }), "ready");
});

test("列头计数：没就绪且为 0 时不显 0（0 会被读成「这里没有」）", () => {
  assert.equal(columnCountOf({ ready: false, count: 0 }), undefined);
  assert.equal(columnCountOf({ ready: false, count: 14 }), 14, "有内容就显示真实数字");
  assert.equal(columnCountOf({ ready: true, count: 0 }), 0, "确实为空时 0 是事实");
});

// ---------- 聊天区：加载 / 三种空 / 内容 ----------

const idle = {
  resolving: false,
  sessionId: undefined,
  selectedProjectId: undefined,
  messagesLoading: false,
  messageCount: 0,
};

test("聊天区：会话解析中 = 加载中，不写任何结论", () => {
  assert.equal(chatSurfaceOf({ ...idle, resolving: true }), "loading");
  // 恢复中即使 URL 里已经有 project/session，也不能先画"发一条消息开始对话"
  assert.equal(chatSurfaceOf({ ...idle, resolving: true, sessionId: "s1", selectedProjectId: "workspace" }), "loading");
});

test("聊天区：有会话但消息没到 = 加载中（不是空会话）", () => {
  assert.equal(chatSurfaceOf({ ...idle, sessionId: "s1", selectedProjectId: "workspace", messagesLoading: true }), "loading");
});

test("聊天区：消息已到 = 内容（即使首屏恢复尚未收尾，内容优先——避免后退到骨架）", () => {
  assert.equal(
    chatSurfaceOf({ ...idle, resolving: true, sessionId: "s1", selectedProjectId: "workspace", messageCount: 2 }),
    "content",
  );
});

test("聊天区：确实没有项目 = 先选择项目", () => {
  assert.equal(chatSurfaceOf(idle), "empty-project");
});

test("聊天区：有项目、没会话 = 发一条消息开始对话（可直接发送建会话）", () => {
  assert.equal(chatSurfaceOf({ ...idle, selectedProjectId: "workspace" }), "empty-session");
});

test("聊天区：有会话、确实一条消息都没有 = 空会话提示", () => {
  assert.equal(chatSurfaceOf({ ...idle, sessionId: "s1", selectedProjectId: "workspace" }), "empty-message");
});

test("穷举：五种 surface 都取得到，且不存在「内容 → 加载」的回退组合", () => {
  const seen = new Set();
  let contentWhoAlsoLoading = 0;
  for (const resolving of [true, false]) {
    for (const sessionId of [undefined, "s1"]) {
      for (const projectId of [undefined, "workspace"]) {
        for (const messagesLoading of [true, false]) {
          for (const messageCount of [0, 2]) {
            const surface = chatSurfaceOf({ resolving, sessionId, selectedProjectId: projectId, messagesLoading, messageCount });
            seen.add(surface);
            if (messageCount > 0 && surface === "loading") contentWhoAlsoLoading += 1;
          }
        }
      }
    }
  }
  assert.deepEqual([...seen].sort(), ["content", "empty-message", "empty-project", "empty-session", "loading"]);
  assert.equal(contentWhoAlsoLoading, 0, "有消息时必须给 content——否则内容会被骨架盖住");
});

// ---------- 头部标题：恢复中不写「新会话」 ----------

test("头部标题：会话解析中且没有会话 = 留空，不写「新会话」", () => {
  assert.equal(headerTitleOf({ sessionId: undefined, displayTitle: "", resolving: true }), "",
    "解析中写「新会话」是断言了一个还没确定的事实，随后会跳成真标题");
});

test("头部标题：解析结束后仍无会话 = 「新会话」（草稿态）", () => {
  assert.equal(headerTitleOf({ sessionId: undefined, displayTitle: "", resolving: false }), "新会话");
  assert.equal(headerTitleOf({ sessionId: undefined, displayTitle: "" }), "新会话", "不传 resolving = 旧行为");
});

test("头部标题：解析中但已经有会话 id 时照常给名字（会话事实已知，不必留白）", () => {
  assert.equal(headerTitleOf({ sessionId: "01a1aa92-9b5d", displayTitle: "修复会话标题", resolving: true }), "修复会话标题");
});
