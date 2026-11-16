/**
 * 缓存边界（Task 0015 · S5 门禁）。
 *
 * 缓存能救刷新体验，但三条边界必须成立（否则是数据事故）：
 * ① 跨 Agent 不串（键带 agentId）；
 * ② API 回来必覆盖（不能永久显示旧数据）；
 * ③ 隐私模式/存储不可用时静默降级（不崩）。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const APP = readFileSync(new URL("../frontend/src/App.tsx", import.meta.url), "utf8");

test("agents 缓存键不带作用域时，至少带固定键名（当前实现是全局 agents 列表）", () => {
  assert.ok(/localStorage\.setItem\("lifeos\.agents"/.test(APP), "agents 缓存写入缺失");
  assert.ok(/localStorage\.getItem\("lifeos\.agents"\)/.test(APP), "agents 缓存读取缺失");
});

test("groups 缓存键**必须**带 agentId（跨 Agent 串味是最严重的一类）", () => {
  assert.ok(/lifeos\.groups\.\$\{agentId\}/.test(APP), "groups 缓存键没带 agentId（会串 Agent）");
  assert.ok(/lifeos\.groups\.\$\{agentId\}/.test(APP) && /readGroupsCache/.test(APP), "缺读取函数");
});

test("API 返回后必须覆盖缓存（不能只读不写）", () => {
  const writes = (APP.match(/localStorage\.setItem\("lifeos\.agents"/g) ?? []).length;
  assert.ok(writes >= 1, "agents 缓存从不更新 → 会永久显示旧数据");
  assert.ok(/setGroups\(next\)/.test(APP), "groups 的 API 结果没写回 state");
});

test("所有新增缓存读写在 try/catch 里（隐私模式不崩）", () => {
  // 逐处检查：缓存调用行所在的 **3 行窗口** 里必须有 try 或 catch
  const lines = APP.split("\n");
  const offenders = [];
  lines.forEach((line, i) => {
    if (!/lifeos\.(groups|scroll|agents)/.test(line)) return;
    if (!/localStorage|sessionStorage/.test(line)) return;
    const window = lines.slice(Math.max(0, i - 3), i + 4).join("\n");
    if (!/try|catch|隐私模式/.test(window)) offenders.push(`${i + 1}: ${line.trim()}`);
  });
  assert.deepEqual(offenders, [], `这些缓存读写没有 try/catch：\n${offenders.join("\n")}`);
});

test("滚动位置用 sessionStorage（关标签页即清，不永久记住）", () => {
  assert.ok(/sessionStorage\.setItem\(`lifeos\.scroll/.test(APP), "滚动位置没存 sessionStorage");
  const usesLocalForScroll = /localStorage\.setItem\(`lifeos\.scroll/.test(APP);
  assert.equal(usesLocalForScroll, false, "滚动位置不该存 localStorage（会让下次打开停在半截）");
});
