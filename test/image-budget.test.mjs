// 图片字节预算（Task 0012 · P2）：boundImages 的规则测试 R1–R10。
// 合成数据只用来触发规则，不模拟真实模型。
import assert from "node:assert/strict";
import test from "node:test";
import { applyImageBudget, boundImages, imagePlaceholder } from "../src/image-budget.ts";
import { createLifeOsImageBudgetExtension } from "../src/assembly.ts";

const MB = 1_000_000;
/** 一张"图片"：data 长度就是请求体里的字节数（base64 字符串） */
const img = (chars, mimeType = "image/png") => ({ type: "image", data: "A".repeat(chars), mimeType });
const text = (t) => ({ type: "text", text: t });
const user = (...content) => ({ role: "user", content, timestamp: 0 });
const toolResult = (note, image) => ({ role: "toolResult", toolCallId: "c1", toolName: "read", content: [text(note), image], isError: false, timestamp: 0 });
const budget = { triggerBytes: 2 * MB, targetBytes: 1 * MB, keepRecent: 2 };

test("R1 只算图片字节：文本再大也不触发", () => {
  const messages = [user(text("x".repeat(5 * MB)), img(100_000)), user(text("y".repeat(5 * MB)))];
  const result = boundImages(messages, budget);
  assert.equal(result.messages, messages, "未越线必须原样返回同一数组");
  assert.equal(result.bytesBefore, 100_000);
  assert.equal(result.droppedCount, 0);
});

test("R3 未越线：返回同一个数组引用（前缀一个字节都不动）", () => {
  const messages = [user(img(800_000)), user(img(800_000))];
  const result = boundImages(messages, budget);
  assert.equal(result.messages, messages);
  assert.equal(result.bytesAfter, result.bytesBefore);
  assert.equal(result.keptImages, 2);
});

test("R2/R4 越线：从最旧开始丢，丢到 ≤ target 为止", () => {
  const messages = [user(img(1 * MB)), user(img(1 * MB)), user(img(1 * MB))];
  const result = boundImages(messages, budget);
  assert.equal(result.droppedCount, 1);
  // keepRecent=2 保护最后两张 ⇒ 3 张里只能丢 1 张，剩 2MB 高于 target 1MB：
  // **保护区优先于目标线**，这是有意的（宁可少丢，也不动当前工作集）
  assert.equal(result.bytesAfter, 2 * MB);
  assert.ok(result.bytesAfter > budget.targetBytes);
  // 丢的是最旧第一张
  assert.match(result.messages[0].content[0].text, /图片已移除/);
  assert.equal(result.messages[2].content[0].type, "image");
});

test("R5 保护是软偏好：只在越过**硬线**时让位（硬线 = limit − reserve）", () => {
  // 场景：用户连发三张 1.5MB 大图 → 最后 2 张共 3.0MB，正好不越硬线 3.0MB → 保住 2 张
  const messages = [user(img(1.5 * MB)), user(img(1.5 * MB)), user(img(1.5 * MB))];
  const budget3 = { triggerBytes: 2 * MB, targetBytes: 1 * MB, keepRecent: 2, hardBytes: 3 * MB };
  const result = boundImages(messages, budget3);
  assert.equal(result.keptImages, 2, "两张大图不越硬线 → 保住");
  assert.equal(result.droppedCount, 1, "只丢最旧那张");

  // 单张 3MB：一张就到硬线 → 保留（用户发的单张大图必须能用）
  const single = boundImages([user(img(3 * MB))], budget3);
  assert.equal(single.keptImages, 1);
  assert.equal(single.droppedCount, 0);

  // 单张 4.5MB：硬线 3.0MB 都装不下 → 丢掉（否则每轮必然 413）
  const tooBig = boundImages([user(img(4.5 * MB))], budget3);
  assert.equal(tooBig.keptImages, 0);
  assert.ok(tooBig.bytesAfter <= budget3.hardBytes);

  // 两张 4.5MB（C1 原洞）：保护完全不生效
  const twoBig = boundImages([user(img(4.5 * MB)), user(img(4.5 * MB))], budget3);
  assert.equal(twoBig.keptImages, 0, "两张巨图必须全部丢掉，否则必然 413");
});

test("R6 占位文案：带路径、带大小、带'不要凭记忆'", () => {
  const placeholder = imagePlaceholder({ mimeType: "image/png", bytes: 171_000, path: "/tmp/demo/shot-3.png" });
  assert.match(placeholder, /\/tmp\/demo\/shot-3\.png/);
  assert.match(placeholder, /171KB/);
  assert.match(placeholder, /不要凭记忆/);
  assert.match(placeholder, /read/);
});

test("R7 图与其说明文字整体替换（不留下指向已删图的说明）", () => {
  const messages = [
    toolResult("screenshot /tmp/demo/a.png 1280x800 42KB", img(1 * MB)),
    toolResult("screenshot /tmp/demo/b.png 1280x800 42KB", img(1 * MB)),
    toolResult("screenshot /tmp/demo/c.png 1280x800 42KB", img(1 * MB)),
  ];
  const result = boundImages(messages, budget);
  const firstContent = result.messages[0].content;
  assert.equal(firstContent.length, 1, "说明文字 + 图片 → 合成一条占位");
  assert.match(firstContent[0].text, /图片已移除 \/tmp\/demo\/a\.png/);
  assert.equal(firstContent.some((part) => part.type === "image"), false);
});

test("R10 幂等：对已淘汰的历史再跑一次，字节与结构都不变", () => {
  const messages = [user(img(1 * MB)), user(img(1 * MB)), user(img(1 * MB)), user(img(1 * MB))];
  const first = boundImages(messages, budget);
  const second = boundImages(first.messages, budget);
  assert.equal(second.messages, first.messages, "第二次必须原样返回");
  assert.equal(second.bytesBefore, first.bytesAfter);
  assert.equal(second.droppedCount, 0);
});

test("迟滞：切点每 (trigger − target) 才移动一次（照抄 opencode 的 9×3MB 形态）", () => {
  // opencode 参数：trigger 25MiB / target 15MiB；这里用同比例（25MB/15MB）便于读
  const big = { triggerBytes: 25 * MB, targetBytes: 15 * MB, keepRecent: 0 };
  const history = Array.from({ length: 9 }, (_, i) => user(img(3 * MB)));
  const drop = (list) => boundImages(list, big).droppedCount;

  assert.equal(drop(history), 4);                                             // 27MB → 丢 4 留 15MB
  assert.equal(drop([...history, user(img(3 * MB))]), 4);                     // 30MB：保留量 18MB 未越线，切点不动
  assert.equal(drop([...history, user(img(3 * MB)), user(img(3 * MB))]), 4);  // 33MB：保留量 21MB，仍不动
  assert.equal(drop([...history, user(img(3 * MB)), user(img(3 * MB)), user(img(3 * MB))]), 4);
  assert.equal(drop([...history, ...Array.from({ length: 4 }, () => user(img(3 * MB)))]), 8); // 保留量 27MB 越线 → 切点推进
});

test("R8 用户图与工具图同一套规则", () => {
  const messages = [user(img(1 * MB)), toolResult("screenshot /tmp/a.png", img(1 * MB)), toolResult("screenshot /tmp/b.png", img(1 * MB))];
  const result = boundImages(messages, budget);
  assert.equal(result.droppedCount, 1);
  assert.match(result.messages[0].content[0].text, /图片已移除/, "用户图也会被淘汰");
});

test("R9 不改动未涉及的消息对象（保持引用，避免无谓重建）", () => {
  const untouched = user(text("hello"));
  const messages = [untouched, user(img(1 * MB)), user(img(1 * MB)), user(img(1 * MB))];
  const result = boundImages(messages, budget);
  assert.equal(result.messages[0], untouched);
});

test("空历史 / 没有图片：原样返回", () => {
  const messages = [user(text("hi")), { role: "assistant", content: [text("ok")] }];
  const result = boundImages(messages, budget);
  assert.equal(result.messages, messages);
  assert.equal(result.bytesBefore, 0);
  assert.equal(result.keptImages, 0);
});

test("R7b 一条消息里只丢了一部分图：说明文字保留（否则剩下的图没有指向）", () => {
  const messages = [
    { role: "toolResult", toolCallId: "c1", toolName: "read", content: [text("screenshot /tmp/demo/a.png"), img(1 * MB), img(1 * MB)], isError: false, timestamp: 0 },
  ];
  // 2 张 → keepRecent=1 保护最后一张；trigger/target 设置使只丢最旧 1 张
  const tight = { triggerBytes: 1 * MB, targetBytes: 500_000, keepRecent: 1 };
  const result = boundImages(messages, tight);
  const first = result.messages[0].content;
  assert.equal(result.droppedCount, 1);
  assert.equal(first.some((part) => part.type === "text" && part.text.startsWith("screenshot")), true, "说明文字必须保留");
  assert.equal(first.filter((part) => part.type === "image").length, 1);
  assert.equal(first.some((part) => part.type === "text" && /图片已移除/.test(part.text)), true);
});

test("P3 applyImageBudget：没有上限来源 → undefined（不猜数字）", () => {
  const messages = [user(img(3 * MB)), user(img(3 * MB))];
  const limits = { config: { schemaVersion: 1, providers: {} }, state: { schemaVersion: 1, observed: {} } };
  assert.equal(applyImageBudget(messages, { provider: "unknown" }, limits), undefined);
  assert.equal(applyImageBudget(messages, undefined, limits), undefined);
});

test("P3 applyImageBudget：provider 上限 3.5MB → 越线按 2.5/1.2 淘汰", () => {
  const messages = Array.from({ length: 18 }, () => user(img(190_000)));   // ≈3.42MB，现场那个会话的形状
  const limits = { config: { schemaVersion: 1, providers: { p1: { maxRequestBytes: 3_500_000 } } }, state: { schemaVersion: 1, observed: {} } };
  const applied = applyImageBudget(messages, { provider: "p1" }, limits);
  assert.ok(applied !== undefined);
  assert.equal(applied.budget.triggerBytes, 2_500_000);
  assert.ok(applied.result.droppedCount > 0, "3.42MB 越过 2.5MB 触发线");
  // 迟滞语义：一次削到 target，之后保留量可以再涨回去——只要不越过 trigger 就不再动
  assert.ok(applied.result.bytesAfter <= applied.budget.triggerBytes, `淘汰后应低于触发线：${applied.result.bytesAfter}`);
  const remaining = applied.result.messages.flatMap((m) => m.content).filter((p) => p.type === "image");
  assert.equal(remaining.length, applied.result.keptImages);
});

test("P3 扩展接线：pi.on('context') 返回改写后的 messages（配置文件驱动）", async () => {
  const { mkdtempSync, mkdirSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const home = mkdtempSync(join(tmpdir(), "lifeos-budget-ext-"));
  process.env.LIFEOS_HOME = home;
  mkdirSync(join(home, "config"), { recursive: true });
  writeFileSync(join(home, "config", "payload-limits.json"),
    JSON.stringify({ providers: { p1: { maxRequestBytes: 3_500_000 } } }));

  const extension = createLifeOsImageBudgetExtension();
  let handler;
  extension.factory({ on: (name, fn) => { if (name === "context") handler = fn; } });
  assert.equal(typeof handler, "function", "注册了 context 事件");

  const messages = Array.from({ length: 18 }, () => user(img(190_000)));
  const ctxStub = { model: { provider: "p1", inputLimits: {} }, sessionManager: { getEntries: () => [] } };
  const out = await handler({ type: "context", messages }, ctxStub);
  assert.ok(out !== undefined && Array.isArray(out.messages), "越线时必须返回新的 messages");
  assert.ok(out.messages.length >= 1);
  const images = out.messages.flatMap((m) => m.content).filter((p) => p.type === "image");
  assert.ok(images.length < 18, "旧图被替换成占位");

  // 未声明的 provider → 原样返回（不启用）
  const untouched = await handler({ type: "context", messages }, { model: { provider: "p2", inputLimits: {} }, sessionManager: { getEntries: () => [] } });
  assert.equal(untouched, undefined);
});

test("日常场景：连续发图（每轮 5 张 171KB）→ 任何一轮实发都不越硬线，切点只在越线时移动", () => {
  const budget = { triggerBytes: 2 * MB, targetBytes: 1 * MB, keepRecent: 2, hardBytes: 3 * MB };
  let history = [];
  let lastDropped = 0;
  for (let round = 1; round <= 20; round += 1) {
    history = [...history, ...Array.from({ length: 5 }, () => user(img(171_000)))];
    const result = boundImages(history, budget);
    assert.ok(result.bytesAfter <= budget.hardBytes, `第 ${round} 轮实发 ${(result.bytesAfter / 1e6).toFixed(2)}MB 越过硬线`);
    // 迟滞下界：只要真的淘汰过，就落到 target 一带，不多丢（丢过头也是白扔缓存）
    if (result.droppedCount > 0) {
      // 离散步长：允许比 target 低"一张图"，但不能低更多（丢过头就是白扔缓存）
      assert.ok(result.bytesAfter >= budget.targetBytes - 171_000, `第 ${round} 轮丢过头：${result.bytesAfter}`);
    }
    assert.ok(result.droppedCount >= lastDropped, "淘汰只增不减");
    lastDropped = result.droppedCount;
  }
});

test("日常场景：Agent 连续读图（工具结果累积）→ 同样封顶，说明文字被一并替换", () => {
  const budget = { triggerBytes: 2 * MB, targetBytes: 1 * MB, keepRecent: 2, hardBytes: 3 * MB };
  let history = [];
  for (let round = 1; round <= 12; round += 1) {
    history = [...history, toolResult(`screenshot /tmp/demo/r${round}.png 1280x800 171KB`, img(171_000))];
    const result = boundImages(history, budget);
    assert.ok(result.bytesAfter <= budget.hardBytes, `第 ${round} 轮越过硬线`);
  }
  const result = boundImages(history, budget);
  const first = result.messages[0].content.map((block) => block.text ?? "").join(" ");
  assert.equal(first.includes("screenshot"), false, "被淘汰的那条说明文字不能残留");
  assert.match(first, /图片已移除 \/tmp\/demo\/r1\.png/, "占位里带路径");
});

test("占位分支：有路径 → read 回来；无路径（用户粘图）→ 请用户重新发送", () => {
  const withPath = imagePlaceholder({ mimeType: "image/png", bytes: 200_000, path: "/tmp/a.png" });
  assert.match(withPath, /\/tmp\/a\.png/);
  assert.match(withPath, /read/);
  const noPath = imagePlaceholder({ mimeType: "image/png", bytes: 200_000 });
  assert.doesNotMatch(noPath, /read/, "没有文件就不能叫模型去 read");
  assert.match(noPath, /重新发送/);
});
