/**
 * 工作台数据层的契约测试（Task 0023 · S1）。
 *
 * 这些断言在**浏览器之外**跑（node --test），锁的是：
 * 1. 桩纪律（STUB 只在 fixtures；S4 归零的度量在这）；
 * 2. 契约形状（at 全 Z 结尾 / documents·todos 是空数组不是省略 / kind 缺失是合法输入）；
 * 3. R3：断言只写关系（排除 daily 用 type，卡数相加等于非 daily 条数）。
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  STUB_FEED, STUB_TASKS, STUB_PROJECTS, STUB_DAYS, allAtAreUtc,
} from "../frontend/src/api/workbench-fixtures.ts";

const ROOT = process.cwd();

test("S1-W1 桩数据只住在 workbench-fixtures.ts（grep 度量，S4 归零）", () => {
  // 这条断言**现在的值**写进输出，便于 architect 追踪下降曲线；但断言本身只锁"范围"。
  const files = [];
  const walk = (dir) => {
    for (const f of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, f.name);
      if (f.isDirectory()) { walk(p); continue; }
      if (!/\.(ts|tsx)$/.test(f.name)) continue;
      const text = readFileSync(p, "utf8");
      if (/STUB:/.test(text)) files.push(p.replace(ROOT + "/", ""));
    }
  };
  walk(join(ROOT, "frontend/src"));
  for (const f of files) {
    assert.ok(f.endsWith("workbench-fixtures.ts"), `STUB: 出现在 ${f}——假数据只允许住在 workbench-fixtures.ts`);
  }
  console.log(`  → STUB: 当前 ${files.length} 个文件（S4 目标 0）`);
});

test("S1-W2 R1：桩里所有 at 都以 Z 结尾（时区明确的时刻，不是本地字面字符串）", () => {
  assert.equal(allAtAreUtc(STUB_DAYS), true, "存在不以 Z 结尾的 at");
});

test("S1-W3 R1：log 条目的 at 形态是本地零点的 UTC（…T16:00:00.000Z），不是 T00:00:00", () => {
  const logs = STUB_DAYS.flatMap((d) => d.activity).filter((a) => a.kind === "log");
  assert.ok(logs.length > 0, "夹具里应有 log 条目");
  for (const a of logs) {
    assert.match(a.at, /T16:00:00\.000Z$/, `log 的 at 应为 …T16:00:00.000Z（实际 ${a.at}）`);
  }
});

test("S1-W4 R1：session 条目的 at 形态不是本地零点（与 log 可区分）", () => {
  const sessions = STUB_DAYS.flatMap((d) => d.activity).filter((a) => a.kind === "session");
  assert.ok(sessions.length > 0);
  for (const a of sessions) {
    assert.doesNotMatch(a.at, /T16:00:00\.000Z$/, "session 的 at 不应长得像 log 的本地零点");
  }
});

test("S1-W5 R1：documents / todos 是空数组字段（不是省略字段）——S1 契约要求前端能区分", () => {
  for (const d of STUB_DAYS) {
    assert.ok(Array.isArray(d.documents), `documents 应是数组（${d.date}）`);
    assert.ok(Array.isArray(d.todos), `todos 应是数组（${d.date}）`);
    assert.deepEqual(d.documents, [], "S1 里 documents 恒为空");
    assert.deepEqual(d.todos, [], "S1 里 todos 恒为空");
  }
});

test("S1-W6 R3：排除 daily 的唯一判据是 type==='daily'；看板卡数关系可从桩推出", () => {
  // 这两条"今天同值"，但判据只用 type（不用 isDefault）——写在这里作为契约提醒
  const nonDaily = STUB_TASKS.filter((t) => t.type !== "daily");
  const byState = { run: 0, done: 0, move: 0, other: 0 };
  for (const t of nonDaily) {
    if (t.state === "进行中") byState.run += 1;
    else if (t.state === "已完成") byState.done += 1;
    else if (t.state === "已移交") byState.move += 1;
    else byState.other += 1;
  }
  assert.equal(byState.run + byState.done + byState.move + byState.other, nonDaily.length,
    "四列卡数相加必须等于非 daily 条数（R3 关系式）");
  // 桩里必须有一张"其他"（R4 活性验证的数据源）
  assert.ok(byState.other > 0, "桩里应有 state='其他' 的卡（R4 尾部组的数据源）");
});

test("S1-W7 R4：桩里「其他」卡必须带原文 status（否则用户分不清已作废和写错）", () => {
  const others = STUB_TASKS.filter((t) => t.state === "其他");
  for (const t of others) {
    assert.ok(t.status.length > 0 && t.status !== "其他", `「其他」卡的原文 status 应有内容（${t.id}）`);
  }
});

test("S1-W8 R3：项目条数关系——每个项目的 agentIds 非空（N 位助手的来源）", () => {
  for (const p of STUB_PROJECTS) {
    assert.ok(Array.isArray(p.agentIds) && p.agentIds.length > 0, `agentIds 应非空（${p.id}）`);
  }
});

test("S1-W9 architect 回应③：kind 缺失是合法输入（桩里必须有一条无 kind 的卡）", () => {
  const noKind = STUB_FEED.filter((f) => f.kind === undefined);
  assert.ok(noKind.length > 0, "桩里应有一条 kind 缺失的卡（渲染层 fallback 的数据源）");
});

test("S1-W10 R3：桩条目必须带 _stub: true（界面显式标「示例」的依据）", () => {
  for (const f of STUB_FEED) {
    assert.equal(f._stub, true, `桩卡 ${f.id} 应带 _stub 标记`);
  }
});
