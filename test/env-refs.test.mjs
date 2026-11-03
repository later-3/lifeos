// Task 0017：凭据引用的静态解析（纯函数穷举）。
//
// 这些用例保护的是"错误必须说到变量级"这条契约：报不出变量名，用户就没法自救。
import test from "node:test";
import assert from "node:assert/strict";
import { envRefsOf, envRefState, isCommandConfigValue, inspectConfigValue } from "../src/env-refs.ts";

test("envRefsOf：只认 ${VAR}，与 Pi 的解析器同语义", () => {
  assert.deepEqual(envRefsOf("${A}"), ["A"]);
  assert.deepEqual(envRefsOf("${A}${B}"), ["A", "B"]);
  assert.deepEqual(envRefsOf("prefix-${AMR_LINK_API_KEY}-suffix"), ["AMR_LINK_API_KEY"]);
  assert.deepEqual(envRefsOf("${A}${A}"), ["A"], "重复只报一次");
});

test("envRefsOf：转义与非法写法不产生引用（照 Pi 的逐字符语义）", () => {
  // `$$` 与 `$!` 是转义（pi/.../resolve-config-value.ts:49-52）
  assert.deepEqual(envRefsOf("$${A}"), [], "$${A} 是字面量 ${A}，不是引用");
  assert.deepEqual(envRefsOf("$!{A}"), []);
  // 裸 $VAR 形式 Pi 不当引用（它只认 ${NAME}），否则会误报"缺变量"
  assert.deepEqual(envRefsOf("$AMR_LINK_API_KEY"), []);
  assert.deepEqual(envRefsOf("${}"), []);
  assert.deepEqual(envRefsOf("${1BAD}"), []);
});

test("envRefsOf：明文 key 与空配置都没有引用", () => {
  assert.deepEqual(envRefsOf("sk-abcdef"), []);
  assert.deepEqual(envRefsOf(""), []);
  assert.deepEqual(envRefsOf(undefined), []);
});

test("envRefsOf：! 开头是命令式配置，不执行也不猜它需要什么变量", () => {
  assert.deepEqual(envRefsOf("!op read op://vault/amr"), []);
  assert.equal(isCommandConfigValue("!op read op://x"), true);
  assert.equal(isCommandConfigValue(" sk-x"), false);
});

test("envRefState：missing / empty / malformed 三种病必须分开（Pi 对空白的判定见 auth/context.ts:24-30）", () => {
  const env = { OK: "sk-abc", EMPTY: "", SPACES: "   ", QUOTED: '"sk-abc"', SINGLE: "'sk-abc'", PADDED: "  sk-abc  ", NL: "sk-abc\n" };
  assert.deepEqual(envRefState(env, "OK"), { kind: "ok" });
  assert.deepEqual(envRefState(env, "NOT_SET"), { kind: "missing" });
  // 实测：空串与纯空格 Pi 都判为"没有凭据"
  assert.deepEqual(envRefState(env, "EMPTY"), { kind: "empty" });
  assert.deepEqual(envRefState(env, "SPACES"), { kind: "empty" });
  // 实测：带引号/首尾空格 Pi 判为"有"，但发出去 401 —— 必须单独报
  assert.deepEqual(envRefState(env, "QUOTED"), { kind: "malformed", reason: "quoted" });
  assert.deepEqual(envRefState(env, "SINGLE"), { kind: "malformed", reason: "quoted" });
  assert.deepEqual(envRefState(env, "PADDED"), { kind: "malformed", reason: "whitespace" });
  assert.deepEqual(envRefState(env, "NL"), { kind: "malformed", reason: "newline" });
});

test("inspectConfigValue：汇总一个 provider 的引用状态", () => {
  const env = { A: "x", B: "" };
  const result = inspectConfigValue("${A}-${B}-${C}", env);
  assert.equal(result.command, false);
  assert.deepEqual(result.refs.map((r) => [r.name, r.state.kind]), [["A", "ok"], ["B", "empty"], ["C", "missing"]]);
});

test("inspectConfigValue：命令式配置标记 command=true 且无 refs", () => {
  const result = inspectConfigValue("!security find-generic-password -w", {});
  assert.equal(result.command, true);
  assert.deepEqual(result.refs, []);
});
