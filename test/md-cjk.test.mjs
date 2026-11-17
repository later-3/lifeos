// CJK 粗体边界修正的纯函数契约（`frontend/src/md-cjk.ts`）。
//
// 为什么要有这一层：`md-cjk.ts` 的三条规则都是**正则改写**，改错不会报错，只会让
// "本该粗体的段落变成字面星号"或"把正常粗体拆坏"。它在真实界面里一天可能触发几千次，
// 而且失败形态只在特定标点组合下出现（下面 ③ 的反例就是这么漏出去的）。
//
// 这里锁三件事：
//  ① 三条规则各自要修的形态确实修好；
//  ② **不应触发的形态一个都不许动**（2026-11-16 实测的反例：一行两个粗体、中间以标点收尾
//     并以空格结尾时，规则 ③ 把前一个粗体的闭合 `**` 当成开启，两个粗体一起坏）；
//  ③ 围栏代码块与行内码逐字保留。

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { fixCjkEmphasis } from "../frontend/src/api/md-cjk.ts";

test("规则①：CJK 标点收尾 + 闭合后紧跟非空白（`**准。**再`）", () => {
  assert.equal(fixCjkEmphasis("**这个判断非常准。**再补一句"),
    "<strong>这个判断非常准。</strong>再补一句");
});

test("规则②：镜像形态（开启紧邻标点）", () => {
  assert.equal(fixCjkEmphasis("**不要主动猜态度。**不知道时"),
    "<strong>不要主动猜态度。</strong>不知道时");
});

test("规则③：粗体内容以空格收尾 → 空格外移（字符序列不变，只换位置）", () => {
  assert.equal(fixCjkEmphasis("**方案 P3 (pre-image 快照) **：在 write"),
    "**方案 P3 (pre-image 快照)** ：在 write");
  // 内容末尾没有标点时不动（避免把「** 开头」这种正常写法拆坏）
  assert.equal(fixCjkEmphasis("**内容 **"), "**内容** ");
});

test("规则③反例（2026-11-16 实测）：一行两个粗体、中间以标点收尾并以空格结尾 —— 一个都不许动", () => {
  // 这是短码进正文后才暴露的形态：`**:airplane:**` 与前面的 `**xxx-travel**` 同行
  assert.equal(fixCjkEmphasis('头像换好了 **pixel-art-travel**（主题，和"旅游助理"相关）；表情 **:airplane:** —— 飞机'),
    '头像换好了 **pixel-art-travel**（主题，和"旅游助理"相关）；表情 **:airplane:** —— 飞机');
  assert.equal(fixCjkEmphasis("**A**（说明）；B **C**"), "**A**（说明）；B **C**");
});

test("`**` 个数为奇数（有未闭合）时整段不动：语法本来就不确定，不猜", () => {
  assert.equal(fixCjkEmphasis("开 **内容 ** 与 **孤立"), "开 **内容 ** 与 **孤立");
});

test("正常粗体（无 CJK 标点相邻）原样保留", () => {
  assert.equal(fixCjkEmphasis("a **b** c **d** e"), "a **b** c **d** e");
  assert.equal(fixCjkEmphasis("让**技术判断**时谈技术"), "让**技术判断**时谈技术");
});

test("围栏代码块与行内码逐字保留", () => {
  const fenced = "```txt\n**不渲染的星号**\n```";
  assert.equal(fixCjkEmphasis(fenced), fenced);
  assert.equal(fixCjkEmphasis("字 `**原样**` 尾"), "字 `**原样**` 尾");
});

test("不含星号时短路返回原值（性能与语义都不该变）", () => {
  const text = "没有任何星号的中文正文，带表情 :airplane: 与链接。";
  assert.equal(fixCjkEmphasis(text), text);
});
