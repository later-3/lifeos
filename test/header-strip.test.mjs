// Task 0002 P1：header strip 分段容器纯函数——段顺序/可见性/去重/空态回退/拼装语义。
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildHeaderSegments, joinHeaderSegments } from "../frontend/src/header-strip.ts";

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
