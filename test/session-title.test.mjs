// T70：标题在首条消息发出时就生效（会话维护，提交 a08a21e）——不等 Pi 把会话落盘（落盘要等助手回复）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installHome } from "../src/home.ts";
import { startOn } from "./server-harness.mjs";
import { shortTitleOf, titleFromFirstMessage } from "../src/session-title.ts";

test("T70a 标题规则：第一条用户消息压成一行、去首尾空白、过长截断（与会话列表展示口径一致）", async () => {
  assert.equal(titleFromFirstMessage("  你好\n世界  "), "你好 世界");
  assert.equal(titleFromFirstMessage(""), "");
  assert.equal(titleFromFirstMessage("字".repeat(200)).length, 60);
});

test("T70b 首条消息发出后、回合结束前，会话列表里已经有标题（模型不可用导致回合失败也一样）", async () => {
  const home = await mkdtemp(join(tmpdir(), "lifeos-title-"));
  await installHome(process.cwd(), home);
  const { server, base } = await startOn(home);
  try {
    const created = await (await fetch(`${base}/api/agents/lifeosagent/projects/workspace/sessions`, { method: "POST" })).json();
    const sid = created.sessionId;
    const before = await (await fetch(`${base}/api/agents/lifeosagent/projects/workspace/sessions`)).json();
    assert.equal(before.items.find((i) => i.sessionId === sid), undefined, "未发消息：草稿不进列表（列表只列承载过用户动作的会话）");
    await fetch(`${base}/api/agents/lifeosagent/sessions/${sid}/messages`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: "帮我规划下周的设备巡检" }),
    });
    const after = await (await fetch(`${base}/api/agents/lifeosagent/projects/workspace/sessions`)).json();
    assert.equal(after.items.find((i) => i.sessionId === sid)?.title, "帮我规划下周的设备巡检", "发出即生效");
  } finally {
    server.close();
  }
});

// Task 0015：「两行够不够」的核查结论 —— 问题不在行数，在第一行标题的区分度。
// 实测：26 条会话里 14 条标题 >50 字、9 条被截到 60 字、4 组"前 15 字完全相同"，
// 因为标题就是用户第一句话的原话，开头常是"请用/我们现在/我想要"这类没有区分度的引导语。
test("shortTitleOf：去掉开头引导语、保留动宾（显示用，不改落盘数据）", () => {
  // 手段短语删掉，动宾保留（"交给/问 X" 才是实质内容）
  assert.equal(shortTitleOf("用 lifeos_send 交给 coder：只回两个字：好的。"), "交给 coder：只回两个字：好的");
  assert.equal(shortTitleOf("请用 lifeos_ask 问 coder：只回两个字：可以"), "问 coder：只回两个字：可以");
  // 虚指短语也削掉（"把这件事交给" → "交给"）
  assert.equal(shortTitleOf("用 lifeos_send 把这件事交给 coder：只回三个字：已收到。"), "交给 coder：只回三个字：已收到");
  // 引导语 + 实质内容
  assert.equal(shortTitleOf("我们想要创建一个 task，主要目的是管理设备。"), "创建一个 task，主要目的是管理设备");
  // 已经够短、没有引导语 → 原样（只去尾标点）
  assert.equal(shortTitleOf("你好"), "你好");
  assert.equal(shortTitleOf("welcome to lifeos"), "welcome to lifeos");
});

test("shortTitleOf：不把标题删空（删到只剩引导语时保留原文）", () => {
  assert.equal(shortTitleOf("请用"), "请用");
  assert.equal(shortTitleOf("用"), "用");
  assert.equal(shortTitleOf(""), "");
});

test("shortTitleOf：落盘标题不受影响（titleFromFirstMessage 不变）", () => {
  const raw = "请用 lifeos_ask 问 coder：只回两个字：可以";
  assert.equal(titleFromFirstMessage(raw), raw, "存进会话文件的标题仍是原话");
  assert.notEqual(shortTitleOf(raw), raw, "但显示会去掉引导语");
});
