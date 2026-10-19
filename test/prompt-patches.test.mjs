import assert from "node:assert/strict";
import { test } from "node:test";
import { applySectionPatch, sectionsAfter } from "../frontend/src/prompt-patches.ts";

/**
 * 判据：Pi 落盘的 system `sections` 是**增量补丁**（只记变化的区，删除记 null）。
 * 面板要的是"这一轮真正生效的完整分区集"，所以必须按序列累加——第一版把它当全量，
 * 结果第 2 轮只显示 2 个区（实测：{project_context, cwd}），看着像"少了 5 个区"。
 */

test("新增区：计入并把区名标成“本次变更”", () => {
  const result = applySectionPatch({ cwd: "a" }, { project_context: "b", cwd: "c" });
  assert.deepEqual(Object.keys(result.sections).sort(), ["cwd", "project_context"]);
  assert.deepEqual(result.changed.sort(), ["cwd", "project_context"]);   // cwd 值变了 → 也算变更
});

test("值没变 → 不算变更（Pi 也不会落这种补丁）", () => {
  const result = applySectionPatch({ cwd: "same" }, { cwd: "same" });
  assert.deepEqual(result.changed, []);
  assert.equal(result.sections.cwd, "same");
});

test("null = 删除该区（换模型/换 cwd 时 Pi 用 null 表示不再有）", () => {
  const result = applySectionPatch({ a: "1", b: "2" }, { b: null });
  assert.deepEqual(Object.keys(result.sections), ["a"]);
  assert.deepEqual(result.changed, ["b"]);
  // 删一个本来就没有的区：不算变更（幂等）
  assert.deepEqual(applySectionPatch({ a: "1" }, { z: null }).changed, []);
});

test("首条补丁建立基线：全量落盘，但不标“本次变更”", () => {
  const result = applySectionPatch({}, { preamble: "…", tools: "…" });
  assert.deepEqual(Object.keys(result.sections), ["preamble", "tools"]);
  assert.deepEqual(result.changed, []);
});

test("真实会话的场景：第 1 条全量 + 第 2 条只有 {project_context, cwd} → 累计 7 个区", () => {
  const full = {
    preamble: "<lifeos_identity>…", skills: "…", cwd: "<cwd>\n/home/user/.lifeos\n</cwd>",
    tools: "…", rules: "…", lifeos_interaction_harness: "…",
  };
  const sections = sectionsAfter([full, { cwd: "<cwd>\n/home/user/code/my-project\n</cwd>", project_context: "<project_context>…" }]);
  assert.deepEqual(Object.keys(sections).sort(), ["cwd", "lifeos_interaction_harness", "preamble", "project_context", "rules", "skills", "tools"]);
  assert.match(sections.cwd, /code\/my-project/);
  assert.match(sections.preamble, /lifeos_identity/);
});

test("第 3 轮没有新 system 消息 = 沿用上一轮（调用方据此标注，不再落补丁）", () => {
  const once = sectionsAfter([{ a: "1", b: "2" }, { b: "3" }]);
  assert.deepEqual(once, { a: "1", b: "3" });
  assert.deepEqual(sectionsAfter([{ a: "1" }]), { a: "1" });      // 没有后续补丁 → 原样
});
