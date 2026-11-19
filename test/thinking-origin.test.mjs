/**
 * thinking 原点（Task 0028 · P1 / 缺陷 D3）。
 *
 * ## 缺陷（Task 0027 · R4）
 *
 * `GET …/entries/:entryId/thinking?blockIndex=N` 的两个参数来自**两个坐标系**：
 *  - `entryId` 是"被渲染那条消息"的 id（折叠时 = 该轮**第一条**回复）；
 *  - `blockIndex` 是 **mergedBlocks（整轮合并）** 里的下标（`App.tsx` 的 `renderBlocks = mergedBlocks`）。
 *
 * 后果（真实会话实测，`0027/evidence/thinking-pairing-mismatch.json`）：
 *  - 错配率 **96.3% / 96.2% / 99.4%**；
 *  - 直连复现 `400 blockIndex 越界`，而正确配对返回 200 正文；
 *  - 界面表现为「思考正文没取回来 · 重试」，点重试仍是同一个错请求（47 次/10 秒）。
 *
 * ## 本文件锁什么
 *
 * 1. `originsOf()` 一次循环同时产出合并块与**原点**（entryId + 该 entry 内的真实下标）；
 * 2. 无 `id` 的消息不伪造原点（返回 undefined），调用方据此**不发请求**（否则又是一串 404）；
 * 3. 用**真实会话数据**跑 0027 的配对算法，错配必须为 0（活性：换回旧规则必红）。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { originsOf, thinkingRequestOf } from "../frontend/src/api/thinking-origin.ts";

// ---------- 夹具：一轮里 3 段回复，每段都有 thinking ----------

const think = (text) => ({ type: "thinking", text });
const textB = (text) => ({ type: "text", text });
const tool = (id) => ({ type: "toolCall", id, name: "bash", arguments: {} });

const replies3 = [
  { id: "e-1", blocks: [think("第一段思考"), textB("先说一句"), tool("c1")] },
  { id: "e-2", blocks: [think("第二段思考"), tool("c2")] },
  { id: "e-3", blocks: [think("第三段思考"), textB("最终回答")] },
];

test("T28-1 一轮多段回复：每段思考的原点都指向它自己那条 entry", () => {
  const { blocks, origins } = originsOf(replies3);
  assert.equal(blocks.length, 7, "合并块总数 = 3+2+2");

  // 期望：块 0 属 e-1/0；块 3 属 e-2/0；块 5 属 e-3/0（不是"e-1 + 合并下标"）
  assert.deepEqual(origins[0], { entryId: "e-1", blockIndex: 0 });
  assert.deepEqual(origins[3], { entryId: "e-2", blockIndex: 0 });
  assert.deepEqual(origins[5], { entryId: "e-3", blockIndex: 0 });

  // 反例（旧规则会产出的那种错配）必须不成立
  assert.notDeepEqual(origins[3], { entryId: "e-1", blockIndex: 3 });
});

test("T28-1b origins 与 blocks 一一对应（长度相同、顺序相同）", () => {
  const { blocks, origins } = originsOf(replies3);
  assert.equal(origins.length, blocks.length);
  // 每个 origin 指回的那条 entry 的块，必须就是这一位上的块
  blocks.forEach((block, i) => {
    const origin = origins[i];
    assert.ok(origin !== undefined, `第 ${i} 块必须有原点`);
    const owner = replies3.find((r) => r.id === origin.entryId);
    assert.ok(owner, `原点 entryId 必须能对上一条真实回复`);
    assert.equal(owner.blocks[origin.blockIndex], block, `第 ${i} 块与原点指向的块必须是同一个`);
  });
});

test("T28-2 无 id 的回复不伪造原点（老数据/乐观插入）", () => {
  const withMissing = [
    { id: undefined, blocks: [think("无 id 的思考"), tool("c0")] },
    { id: "e-2", blocks: [think("第二段思考")] },
  ];
  const { origins } = originsOf(withMissing);
  assert.equal(origins[0], undefined, "无 id → 原点 undefined（不造假）");
  assert.equal(origins[1], undefined, "同一条消息的所有块都不给原点");
  assert.deepEqual(origins[2], { entryId: "e-2", blockIndex: 0 }, "后面的正常消息不受影响");
});

test("T28-2b thinkingRequestOf：无原点/空 id/负下标都不发请求", () => {
  assert.equal(thinkingRequestOf(undefined), undefined);
  assert.equal(thinkingRequestOf({ entryId: "", blockIndex: 0 }), undefined);
  assert.equal(thinkingRequestOf({ entryId: "e-1", blockIndex: -1 }), undefined);
  assert.equal(thinkingRequestOf({ entryId: "e-1", blockIndex: 1.5 }), undefined);
  assert.deepEqual(thinkingRequestOf({ entryId: "e-1", blockIndex: 2 }), { entryId: "e-1", blockIndex: 2 });
});

test("T28-3 真实会话：按原点取正文时错配为 0（0027 的算法）", async () => {
  /*
   * 夹具来源：`test/fixtures/thinking-origin-session.json`（由真实会话投影而成，
   * 保留 role/blocks/thinking/deferred 结构，剪掉正文与图片以控制体积）。
   */
  const raw = await readFile(join(import.meta.dirname, "fixtures/thinking-origin-session.json"), "utf8");
  const messages = JSON.parse(raw).messages;

  // 复刻 App 的折叠：一条 user + 其后所有 assistant = 一轮；渲染宿主是该轮第一条回复
  const spans = [];
  let current;
  messages.forEach((m, i) => {
    if (m.role === "user") { current = { userIndex: i, replyIndexes: [] }; spans.push(current); return; }
    if (current === undefined) { current = { userIndex: -1, replyIndexes: [i] }; spans.push(current); return; }
    current.replyIndexes.push(i);
  });

  let requests = 0;
  let mismatched = 0;
  for (const span of spans) {
    const replies = span.replyIndexes.map((i) => messages[i]).filter((m) => m !== undefined);
    if (replies.length === 0) continue;
    const { blocks, origins } = originsOf(replies);
    blocks.forEach((block, index) => {
      if (block.type !== "thinking" || block.deferred !== true) return;
      requests += 1;
      const origin = thinkingRequestOf(origins[index]);
      if (origin === undefined) { mismatched += 1; return; }   // 取不到 = 错配（这是要求 0 的分母）
      const owner = replies.find((m) => m.id === origin.entryId);
      if (owner === undefined || owner.blocks[origin.blockIndex] !== block) mismatched += 1;
    });
  }

  assert.ok(requests > 0, `夹具必须有 deferred 思考块，否则这条用例是空转（实测 requests=${requests}）`);
  assert.equal(mismatched, 0, `错配必须为 0（实得 ${mismatched}/${requests}）`);
});

test("T28-4 活性：换回旧规则（宿主 id + 合并下标）这条用例必须变红", async () => {
  // 这条用例锁"旧规则一定错"——它是 T28-3 的活性证明，不是重复。
  const raw = await readFile(join(import.meta.dirname, "fixtures/thinking-origin-session.json"), "utf8");
  const messages = JSON.parse(raw).messages;
  const spans = [];
  let current;
  messages.forEach((m, i) => {
    if (m.role === "user") { current = { userIndex: i, replyIndexes: [] }; spans.push(current); return; }
    if (current === undefined) { current = { userIndex: -1, replyIndexes: [i] }; spans.push(current); return; }
    current.replyIndexes.push(i);
  });

  let requests = 0;
  let wrongUnderOldRule = 0;
  for (const span of spans) {
    const replies = span.replyIndexes.map((i) => messages[i]).filter((m) => m !== undefined);
    if (replies.length === 0) continue;
    const host = replies[0];
    const merged = replies.flatMap((m) => m.blocks ?? []);
    merged.forEach((block, index) => {
      if (block.type !== "thinking" || block.deferred !== true) return;
      requests += 1;
      // 旧规则：entryId = 宿主消息 id，blockIndex = 合并下标
      const owner = replies.find((m) => m.id === host.id);
      if (owner === undefined || owner.blocks[index] !== block) wrongUnderOldRule += 1;
    });
  }
  assert.ok(requests > 0, "夹具必须有 deferred 思考块");
  assert.ok(wrongUnderOldRule > 0,
    `旧规则必须至少错一条（实得 ${wrongUnderOldRule}/${requests}）——若为 0，说明夹具已经不能证明修复有效性，需换夹具`);
});

test("T28-20 新消息的思考块不得被说成「旧记录，取不回」", async () => {
  /*
   * 用户 2026-11-19 报告（本任务 P1 引入的回归）：
   * 「我新发的消息，思考那里还在报是旧记录」。
   *
   * 成因：流式期那条 assistant 消息是**乐观插入的占位**，没有 entry id
   * （Pi 的 entry id 在落盘时才生成 —— `session-manager.ts:277-297` 的 `generateId` 在 `_appendEntry` 时调用），
   * 所以它的思考块 `origin` 必然是 `undefined` → `request` 也是 `undefined`。
   * 而 P1 把 `request === undefined` 判在了**第一个分支**，于是每一条正在生成的回复，
   * 它的思考都被显示成「这段思考属于旧记录，取不回正文」。
   *
   * 正确语义（pi-web `components/MessageView.tsx:946` 同款）：
   * `block.deferred ? content : block.thinking` —— **手里有正文就直接显示**，
   * "能不能按需取"只对 deferred 块有意义。
   */
  const source = await readFile(new URL("../frontend/src/views/Message.tsx", import.meta.url), "utf8");

  assert.match(
    source,
    /const shown = deferred \? content[^;]*: text;/,
    "非 deferred 块的正文必须直接读 text（复制进 state 会冻结在首个 delta）",
  );

  const shownAt = source.indexOf("{shown !== undefined ? (");
  const failedAt = source.indexOf(") : failed ? (");
  const requestAt = source.indexOf(") : request === undefined ? (");
  assert.ok(shownAt > 0 && failedAt > 0 && requestAt > 0, "三个分支都要在（缺一个说明结构被改了，请同步改这条断言）");
  assert.ok(shownAt < failedAt && shownAt < requestAt,
    "「有正文」必须是第一个分支：否则新消息的流式思考会被「取不回正文」顶掉（用户 2026-11-19 报的就是这个）");
  assert.ok(failedAt < requestAt, "「取失败」要在「取不到」之前：失败得有重试按钮");
});
