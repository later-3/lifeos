/**
 * 后端不可用时的界面行为（Task 0015 · S5 门禁）。
 *
 * 实测事故：打桩全 500 → `data.items.find` 抛 TypeError → **整个 App 白屏**（rootHTML=0）。
 * 断言：
 * ① 启动取数有 try/catch（不许直取 payload.items）；
 * ② 失败时用缓存 + 明确提示（不白屏、不静默）；
 * ③ fetchGroups 失败返回空数组而不是 undefined（不把炸点传给渲染层）；
 * ④ 空结果 + 有缓存时保留缓存（别把"后端挂了"显示成"项目全没了"）。
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

test("fetchGroups 失败返回空数组（不把 undefined 传下去）", () => {
  const fn = APP.slice(APP.indexOf("async function fetchGroups"), APP.indexOf("async function loadMessages"));
  assert.ok(/catch \{ return \[\]; \}/.test(fn), "fetchGroups 失败没有兜底返回 []");
  assert.ok(/Array\.isArray\(projects\.items\)/.test(fn), "没有校验 projects.items 形状");
  // isArray 检查之后的 .map 是合法用法；这里只断言"检查存在且在 map 之前"
  const checkAt = fn.indexOf("Array.isArray(projects.items)");
  const mapAt = fn.indexOf("projects.items.map");
  assert.ok(checkAt > 0 && mapAt > checkAt, "items 形状检查不在使用之前");
});

test("空结果 + 有缓存 = 保留缓存（别把后端挂了显示成项目没了）", () => {
  assert.ok(/fetched\.length === 0 && cachedGroups !== undefined \? cachedGroups : fetched/.test(APP),
    "启动路径没有保留缓存的判定");
  assert.ok(/fetched\.length === 0 && cached !== undefined \? cached : fetched/.test(APP),
    "selectAgent 没有保留缓存的判定");
});

test("活性验证：把启动取数改回直取，检测必须红", () => {
  const bad = 'const data = (await (await fetch("/api/agents")).json()) as { items: Agent[] }; setAgents(data.items);';
  assert.ok(!/try \{\s*\n\s*const response = await fetch\("\/api\/agents"\)/.test(bad), "探测规则失效");
});
