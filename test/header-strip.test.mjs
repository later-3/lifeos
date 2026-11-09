// Task 0002 P1：header strip 分段容器纯函数——段顺序/可见性/去重/空态回退/拼装语义。
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildHeaderSegments, headerTaskOf, joinHeaderSegments, taskTitleKey } from "../frontend/src/header-strip.ts";

const base = {
  agentName: "coder",
  projectName: "lifeos",
  sessionTitle: "",
  headerModel: { provider: "z-ai", id: "glm-5.3-flash" },
  thinkingLevel: undefined,
  activeTaskId: undefined,
  taskTitle: undefined,
};

test("基础段：agent · project · model 依序；join 用 ' · ' 与现状一致", () => {
  const segments = buildHeaderSegments(base);
  assert.deepEqual(joinHeaderSegments(segments), "coder · lifeos · z-ai/glm-5.3-flash");
});

test("会话标题等于项目名时，project 段去重；标题不相等时保留", () => {
  const seg1 = buildHeaderSegments({ ...base, sessionTitle: "lifeos" });
  assert.equal(seg1.some((s) => s.id === "project"), false);
  const seg2 = buildHeaderSegments({ ...base, sessionTitle: "别的标题" });
  assert.ok(seg2.some((s) => s.id === "project" && s.text === "lifeos"));
});

test("thinking 段：只显示档位本身（无'思考'二字；off 也原样显示）", () => {
  const seg = buildHeaderSegments({ ...base, thinkingLevel: "high" });
  const thinking = seg.find((s) => s.id === "thinking");
  assert.ok(thinking && thinking.text === "high");
  const off = buildHeaderSegments({ ...base, thinkingLevel: "off" });
  assert.equal(off.find((s) => s.id === "thinking")?.text, "off");
  assert.ok(!joinHeaderSegments(off).includes("思考"));
});

test("task 段：`0001 标题`（无 Task 前缀）；无标题只显示 ID；ID 为空则整段缺席", () => {
  const withTitle = joinHeaderSegments(buildHeaderSegments({ ...base, activeTaskId: "0001", taskTitle: "默认" }));
  assert.ok(withTitle.includes(" · 0001 默认"));
  assert.ok(!withTitle.includes("Task "));
  const noTitle = buildHeaderSegments({ ...base, activeTaskId: "0001" });
  assert.equal(noTitle.find((s) => s.id === "task")?.text, "0001");
  const none = buildHeaderSegments(base);
  assert.equal(none.some((s) => s.id === "task"), false);
});

test("空态回退：agent/project 都为空 → 段首是'选择或新建一个会话'；model 段仍追加", () => {
  const segments = buildHeaderSegments({ ...base, agentName: "", projectName: "" });
  assert.equal(segments[0]?.id, "empty");
  assert.equal(joinHeaderSegments(segments), "选择或新建一个会话 · z-ai/glm-5.3-flash");
});

test("可见性：无 model 时 model 段缺席，不产生悬空分隔符", () => {
  const segments = buildHeaderSegments({ ...base, headerModel: null });
  assert.equal(segments.some((s) => s.id === "model"), false);
  assert.equal(joinHeaderSegments(segments), "coder · lifeos");
});

test("task 标题缓存键必须带 agent+project：同号 Task 不得串标题（C120）", () => {
  const a = taskTitleKey("lifeosagent", "workspace", "0002");
  const b = taskTitleKey("coder", "lifeos", "0002");
  assert.notEqual(a, b);
  assert.equal(taskTitleKey("coder", "lifeos", "0002"), b, "同作用域同号必须命中同一条");
});

test("headerTaskOf：有会话用会话的 Task，绝不拿默认 Task 顶替", () => {
  const fallback = { id: "0001", title: "默认" };
  assert.deepEqual(headerTaskOf({ hasSession: true, sessionTaskId: "0002", sessionTaskTitle: "输入框优化", projectDefaultTask: fallback }),
    { id: "0002", title: "输入框优化" });
  // 会话存在但没有 Task：不能显示默认 Task（下一轮并不会进默认 Task，那是撒谎）
  assert.equal(headerTaskOf({ hasSession: true, sessionTaskId: null, projectDefaultTask: fallback }), undefined);
  assert.equal(headerTaskOf({ hasSession: true, sessionTaskId: "", projectDefaultTask: fallback }), undefined);
});

test("headerTaskOf：无会话时显示项目默认 Task（新建会话必然绑到它）", () => {
  assert.deepEqual(headerTaskOf({ hasSession: false, projectDefaultTask: { id: "0001", title: "默认" } }),
    { id: "0001", title: "默认" });
  // 项目还没有默认 Task（或清单加载失败）：该段缺席，不编造
  assert.equal(headerTaskOf({ hasSession: false }), undefined);
});

test("无会话 + 默认 Task：头部确实产出 task 段（端到端组合）", () => {
  const task = headerTaskOf({ hasSession: false, projectDefaultTask: { id: "0001", title: "默认" } });
  const segments = buildHeaderSegments({
    agentName: "Frontend Developer", projectName: "lifeos", sessionTitle: "",
    headerModel: { provider: "command", id: "z-ai/glm-5.3-flash" }, thinkingLevel: undefined,
    activeTaskId: task?.id, taskTitle: task?.title,
  });
  assert.equal(joinHeaderSegments(segments), "Frontend Developer · lifeos · command/z-ai/glm-5.3-flash · 0001 默认");
});

test("对端段（Agent↔Agent）：显示 `agent ↔ peer`，用户↔Agent 不显示", () => {
  const base = {
    agentName: "Life Agent", projectName: "lifeos", sessionTitle: "M1 设计评审",
    headerModel: null, thinkingLevel: undefined, activeTaskId: undefined, taskTitle: undefined,
  };
  // Agent ↔ Agent：对端是新信息 → 要出现
  const withPeer = buildHeaderSegments({ ...base, peerName: "Coder" });
  assert.deepEqual(withPeer.map((s) => s.id), ["agent", "peer", "project"]);
  assert.equal(withPeer.find((s) => s.id === "peer")?.text, "↔ Coder");

  // 用户 ↔ Agent：不给 peerName（对端就是当前 Agent）→ 不出现
  const noPeer = buildHeaderSegments(base);
  assert.deepEqual(noPeer.map((s) => s.id), ["agent", "project"]);

  // 兜底：万一传了与 agentName 相同的对端，也不重复
  const same = buildHeaderSegments({ ...base, peerName: "Life Agent" });
  assert.equal(same.some((s) => s.id === "peer"), false);
});


// ---- 头部大字标题（2026-11-05 修的 bug：标题显示成 "Life OS"）----
//
// 现象：跨项目点开一条会话，聊天区顶部大字变成产品名 "Life OS"。
// 根因：标题是从「选中项目」的分组里找「当前会话」，两者不一致时找不到 → 空 → 回落产品名。
// 规则：标题只能来自**会话自己**（与列表同一份派生 displayTitleOf），缺名回落 `会话 <id8>`。
import { findSessionRow, headerTitleOf } from "../frontend/src/header-strip.ts";

test("头部标题：有会话时用会话显示名，不回落产品名", () => {
  const title = headerTitleOf({ sessionId: "01a1aa92-9b5d", displayTitle: "修复会话标题" });
  assert.equal(title, "修复会话标题");
  assert.ok(!title.includes("Life OS"));
});

test("头部标题：会话没名字时回落 `会话 <id8>`（与列表同一份兜底），不是产品名", () => {
  const title = headerTitleOf({ sessionId: "01a1aa92-9b5d-7086", displayTitle: "" });
  assert.equal(title, "会话 01a1aa92");
  assert.ok(!title.includes("Life OS"));
});

test("头部标题：没有会话（草稿）显示「新会话」，不受 displayTitle 影响", () => {
  assert.equal(headerTitleOf({ sessionId: undefined, displayTitle: "" }), "新会话");
  assert.equal(headerTitleOf({ sessionId: undefined, displayTitle: "别的名字" }), "新会话");
});

test("会话查找：跨项目找得到（不能只在「选中项目」的分组里找）", () => {
  const groups = [
    { project: { id: "workspace" }, sessions: [{ sessionId: "s-ws", title: "ws 会话" }] },
    { project: { id: "lifeos" }, sessions: [{ sessionId: "s-life", title: "lifeos 会话" }] },
  ];
  assert.equal(findSessionRow(groups, "s-life")?.title, "lifeos 会话", "选中 workspace 时也要找得到 lifeos 的会话");
  assert.equal(findSessionRow(groups, "s-ws")?.title, "ws 会话");
  assert.equal(findSessionRow(groups, "不存在"), undefined);
  assert.equal(findSessionRow(groups, undefined), undefined);
  assert.equal(findSessionRow(undefined, "s-ws"), undefined);
});
