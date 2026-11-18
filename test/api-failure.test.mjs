/**
 * 后端不可用时的界面行为（Task 0015 · S5 门禁）。
 *
 * 实测事故：打桩全 500 → `data.items.find` 抛 TypeError → **整个 App 白屏**（rootHTML=0）。
 * 断言：
 * ① 启动取数有 try/catch（不许直取 payload.items）；
 * ② 失败时用缓存 + 明确提示（不白屏、不静默）；
 * ③ fetchGroups 失败返回空数组而不是 undefined（不把炸点传给渲染层）；
 * ④ 空结果 + 有缓存时保留缓存（别把"后端挂了"显示成"项目全没了"）。
 *
 * 2026-11-18（Task 0028 · P2 / 缺陷 D2）更新：`fetchGroups` 从"失败返回 []"升级为
 * "返回 `{groups, failure}`" —— 空数组无法区分"后端挂了"与"确实没有项目"，
 * 而界面需要说清是哪一种（`specs/code/backend/code.md` 2.9 错误必须可见）。
 * 本文件的**要求没变**：失败不得把 undefined 传下去、空结果不得冲掉缓存；
 * 断言跟着新形状走（`specs/code/testing/testing.md` 2.15：夹具必须跟实现的数据源/形状走）。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const APP = readFileSync(new URL("../frontend/src/App.tsx", import.meta.url), "utf8");

test("启动取数有失败分支（不直取 payload.items）", () => {
  assert.ok(/try \{\s*\n\s*const response = await fetch\("\/api\/agents"\)/.test(APP), "启动 fetch 没有 try");
  assert.ok(/if \(!response\.ok\) throw new Error/.test(APP), "没有检查 response.ok");
  assert.ok(/Array\.isArray\(payload\.items\)/.test(APP), "没有校验 items 形状");
});

test("失败时用缓存且给可见提示（不白屏不静默）", () => {
  assert.ok(/offline = true/.test(APP), "没有离线标记");
  assert.ok(/JSON\.parse\(localStorage\.getItem\("lifeos\.agents"/.test(APP), "失败时没读缓存");
  assert.ok(/后端暂时不可用/.test(APP), "没有给用户可见的失败提示");
});

test("fetchGroups 失败返回空数组 + 原因（不把 undefined 传下去）", () => {
  const fn = APP.slice(APP.indexOf("async function fetchGroups"), APP.indexOf("async function loadMessages"));
  assert.ok(/return \{ groups: \[\], failure: result\.failure \}/.test(fn),
    "fetchGroups 失败没有兜底返回 { groups: [], failure }");
  /*
   * 形状校验的**对象**换了，但要求没变（Task 0016 · 剩余项 #6）：
   * fetchGroups 从"1 次 /projects + 每项目 1 次 /sessions"改成 1 次 `/groups`
   * （隧道下是 3 次串行 RTT → 1 次），所以这里校验的是 `body.items` 而不是 `projects.items`。
   * 断言照旧要求"先校验、再使用"，不许直接把响应当数组用。
   */
  assert.ok(/Array\.isArray\(items\)/.test(fn), "没有校验响应 items 形状");
  const checkAt = fn.indexOf("Array.isArray(items)");
  const useAt = fn.indexOf("? items : []");
  assert.ok(checkAt > 0 && useAt > checkAt, "items 形状检查不在使用之前");
});

test("空结果 + 有缓存 = 保留缓存（别把后端挂了显示成项目没了）", () => {
  assert.ok(/fetched\.groups\.length === 0 && cachedGroups !== undefined \? cachedGroups : fetched\.groups/.test(APP),
    "启动路径没有保留缓存的判定");
  assert.ok(/fetched\.groups\.length === 0 && cached !== undefined \? cached : fetched\.groups/.test(APP),
    "selectAgent 没有保留缓存的判定");
});

test("列表失败必须能说出来（Task 0028 · P2）：有失败对象且界面有提示位", () => {
  assert.ok(/const \[groupsFailure, setGroupsFailure\]/.test(APP), "没有 groupsFailure 状态");
  assert.ok(/data-testid="groups-load-error"/.test(APP), "列表失败没有可见提示");
  assert.ok(/failureTextOf\(groupsFailure\)/.test(APP), "提示没有用统一的失败文案");
});

test("会话加载失败必须能说出来（Task 0028 · P2）：错误态 + 重试", () => {
  assert.ok(/data-testid="chat-load-retry"/.test(APP), "会话加载失败没有重试按钮");
  assert.ok(/chatSurface === "error"/.test(APP), "聊天区没有 error 表面");
  assert.ok(/logFailure\(loaded\.failure\)/.test(APP), "会话加载失败没有记日志");
});

test("活性验证：把启动取数改回直取，检测必须红", () => {
  const bad = 'const data = (await (await fetch("/api/agents")).json()) as { items: Agent[] }; setAgents(data.items);';
  assert.ok(!/try \{\s*\n\s*const response = await fetch\("\/api\/agents"\)/.test(bad), "探测规则失效");
});
