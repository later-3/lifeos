// 流式 Markdown 补齐（`frontend/src/md-stream.ts`）的纯函数契约。
//
// 它挡的是用户 2026-11-16 报的"思考块不断追加时不断闪"：
// 分隔符只到一半时是字面，闭合那一刻吞掉已显示字符（`evidence/d22` 实测 13 delta 内 4 次 / 39 字符）。
// 这个函数在**渲染前**补上未闭合结构的闭合符，让"从第一个字符起就是格式化文本"。
//
// 这里锁四件事：
//  ① 每种未闭合结构都被补齐（围栏 / 行内码 / `**` / `~~` / 链接 / 图片）；
//  ② **已完整的文本一字不改**（幂等）—— 定稿渲染绝不能被动过；
//  ③ 不该动的形态一个都不许动（`2 * 3`、`a_b`、`snake_case`、数字跨度 `20~25`、转义 `\*`）；
//  ④ 围栏内部一律不处理（那是字面代码）。

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { closeIncompleteMarkdown } from "../frontend/src/md-stream.ts";

test("围栏：未闭合的 ``` 会在末尾补一行关闭围栏", () => {
  assert.equal(closeIncompleteMarkdown("示例：\n```ts\nconst a = 1;\n"),
    "示例：\n```ts\nconst a = 1;\n\n```");
});

test("围栏：已闭合的围栏原样返回（幂等）", () => {
  const text = "示例：\n```ts\nconst a = 1;\n```\n结束。";
  assert.equal(closeIncompleteMarkdown(text), text);
});

test("围栏内的 `**` 与反引号不被处理", () => {
  const text = "```\n**不是粗体** 与 `code\n```";
  assert.equal(closeIncompleteMarkdown(text), text);
});

test("行内码：未闭合的反引号补一个反引号", () => {
  assert.equal(closeIncompleteMarkdown("用 `npm test"), "用 `npm test`");
  assert.equal(closeIncompleteMarkdown("看 `Message.tsx 的渲染"), "看 `Message.tsx 的渲染`");
});

test("行内码：已闭合的不动（含两段行内码）", () => {
  const text = "用 `npm test` 跑，输出在 `logs/` 里。";
  assert.equal(closeIncompleteMarkdown(text), text);
});

test("行内码：反引号后只有空白时不补（避免把 ` 变成空代码块）", () => {
  assert.equal(closeIncompleteMarkdown("结尾一个反引号 `"), "结尾一个反引号 `");
});

test("粗体：未闭合的 `**` 补上", () => {
  assert.equal(closeIncompleteMarkdown("先确认 **渲染入口"), "先确认 **渲染入口**");
});

test("粗体：已闭合的不动（含多段粗体）", () => {
  const text = "先确认 **渲染入口** 在 **Message.tsx**，再看别的。";
  assert.equal(closeIncompleteMarkdown(text), text);
});

test("粗体：定界符**落到一个有内容的尾巴上**时就被补齐（不是等闭合符到）", () => {
  // 逐字符推进：从"开启符后面有第一个正文字符"那一刻起，补完就是成对的
  const text = "先确认 **渲染入口** 在 `Message.tsx`，再看 `stream-blocks.ts`。";
  for (let n = 1; n <= text.length; n += 1) {
    const chunk = text.slice(0, n);
    const closed = closeIncompleteMarkdown(chunk);
    // 边界（与 remend 同）：开启符后还没有正文内容时不补（`先确认 **`、`在 \``）
    const tail = /(\*\*|`)$/.exec(chunk);
    if (tail !== null) continue;
    assert.equal((closed.match(/\*\*/g) ?? []).length % 2, 0, `前缀「${chunk}」补完后 ** 仍是奇数个：${closed}`);
    assert.equal((closed.match(/`/g) ?? []).length % 2, 0, `前缀「${chunk}」补完后反引号仍是奇数个：${closed}`);
  }
});

test("斜体单星号不处理（`2 * 3` / `* 列表` 太容易误判）", () => {
  assert.equal(closeIncompleteMarkdown("计算 2 * 3 等于 6"), "计算 2 * 3 等于 6");
  assert.equal(closeIncompleteMarkdown("- 第一项\n* 第二项"), "- 第一项\n* 第二项");
});

test("下划线斜体不处理（snake_case / a_b 在正文里太常见）", () => {
  assert.equal(closeIncompleteMarkdown("文件名是 snake_case_name"), "文件名是 snake_case_name");
});

test("删除线：未闭合的 ~~ 补上；范围 `20~25` 不动", () => {
  assert.equal(closeIncompleteMarkdown("这是 ~~删掉"), "这是 ~~删掉~~");
  assert.equal(closeIncompleteMarkdown("范围 20~25 之间"), "范围 20~25 之间");
});

test("链接：未闭合的 [文字](url 补右括号", () => {
  assert.equal(closeIncompleteMarkdown("见 [文档](https://exa"), "见 [文档](https://exa)");
});

test("链接：已闭合的不动", () => {
  const text = "见 [文档](https://example.com) 与 [另一个](https://b.c)。";
  assert.equal(closeIncompleteMarkdown(text), text);
});

test("图片：未闭合的 ![alt](url 直接去掉（半截 URL 会渲染成破图）", () => {
  assert.equal(closeIncompleteMarkdown("看图 ![截屏](https://exa"), "看图 ");
});

test("转义：`\\*` 不算定界符", () => {
  assert.equal(closeIncompleteMarkdown("字面星号 \\* 不算粗体"), "字面星号 \\* 不算粗体");
});

test("空串与纯空白原样返回", () => {
  assert.equal(closeIncompleteMarkdown(""), "");
  assert.equal(closeIncompleteMarkdown("   \n  "), "   \n  ");
});

test("幂等：对已补齐的文本再调用一次不变", () => {
  const cases = [
    "先确认 **渲染入口",
    "用 `npm test",
    "这是 ~~删掉",
    "示例：\n```ts\nconst a = 1;\n",
    "见 [文档](https://exa",
    "看图 ![截屏](https://exa",
  ];
  for (const text of cases) {
    const once = closeIncompleteMarkdown(text);
    assert.equal(closeIncompleteMarkdown(once), once, `不幂等：${text} → ${once}`);
  }
});

test("真实思考文本：补齐后丢掉的只能是标记字符，绝不能是文字", () => {
  // 这是 R5 的真正判据（用户看到的是"字"不见了，不是"标记"不见了）。
  // 逐字符推进 + 渲染，比"可见文字"：任何一帧消失的字符都必须落在 * ` ~ 这些标记里。
  const text = "### 定位思路\n先确认 **渲染入口** 在 `Message.tsx`，再看 `stream-blocks.ts`。\n- 检查 A\n- 检查 B\n";
  const flatten = (value) => value.replace(/\s+/g, "");
  let prev = "";
  const lostWords = [];
  for (let n = 1; n <= text.length; n += 1) {
    // 只比"补完之后"的字符串本身（真正的可见文本由 playwright 契约比）
    const cur = flatten(closeIncompleteMarkdown(text.slice(0, n)));
    if (prev !== "" && !cur.startsWith(prev)) {
      let k = 0;
      while (k < Math.min(prev.length, cur.length) && prev[k] === cur[k]) k += 1;
      const lost = prev.slice(k);
      if (/[^\s*`~]/.test(lost)) lostWords.push({ n, lost });
    }
    prev = cur;
  }
  assert.deepEqual(lostWords, [], `补齐过程吃掉了文字：${JSON.stringify(lostWords)}`);
});

test("性能：32k 字符（约一屏长回复）单次补齐 < 10ms", () => {
  // 思维块/正文的单段文本通常 < 8k 字符；这里按 32k（异常长）留余量。
  // 阈值依据：实测 6.4k 1.8ms / 32k 6.0ms（同一台机器），取 10ms 作为"不会拖慢一帧"的上界。
  const base = "### 标题\n先确认 **渲染入口** 在 `Message.tsx`，再看 [文档](https://a.b)。\n- 列表项\n";
  const text = base.repeat(Math.ceil(32000 / base.length));
  const started = performance.now();
  closeIncompleteMarkdown(text);
  const ms = performance.now() - started;
  assert.ok(ms < 10, `32k 字符补齐耗时 ${ms.toFixed(2)}ms（应 < 10ms）`);
});
