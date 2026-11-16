/**
 * 粗体/emphasis 的 CJK 友好边界修正（2026-11-10，用户截图：`**这个判断非常准。**再补一句**` 星号原样）。
 *
 * 事实（B 级，官方规范原文摘录，`https://spec.commonmark.org/0.31.2/` §6.2）：
 *
 *   "A right-flanking delimiter run is a delimiter run that is (1) not preceded by
 *    Unicode whitespace, and either (2a) not preceded by a Unicode punctuation character,
 *    or (2b) preceded by a Unicode punctuation character and followed by Unicode
 *    whitespace or a Unicode punctuation character."
 *
 * 中文句号是 Unicode punctuation → `**…准。**再` 的**闭合 run** 在 (2b) 失败 →
 * **对所有严格 CommonMark 渲染器（GitHub/GFM 同）都渲染为字面星号**——这不是 marked 的 bug，
 * 而是这段输入碰到的**已知规范缺口**（cjk-friendly 家的扩展正是为此而生；
 * 我们用 marked 且未引它的对应生态，因此在本项目内以最小规则补齐）。
 *
 * 两版取舍（过程记录）：
 *  - 先实现过「边界处插 U+2060 WORD JOINER」的正则修正——WJ 虽能通过 flanking 判定，
 *    但 marked 的 delimiter-run 扫描器把 `punct<delim>letter` 归入 group3（跳过计次）、
 *    `notPunctSpace<delim>…` 归入 group6 后再吃 **o%3 三连星豁免**（`c+=l; continue`），
 *    **依旧不闭合**——此路不通（过程保留在案例）。
 *  - 现在：对**唯一失效形态**「strong 以 CJK 标点/符号收尾，闭合后紧跟非空白」
 *    直接替换为**行内 HTML** `<strong>…</strong>`（marked 原样放行 inline html，
 *    DOMPurify 白名单放行 strong）——绕开的只有这一处规范的失效判定，
 *    其它星号语法（跨行、嵌套、逃逸）仍由 marked 处理。
 *
 * 边界（**必须**绕过）：围栏代码块与行内码内**逐字保留**——它们是字面文本，
 * 插入 HTML 会污染显示；行内码内的 `**` 是纯文本语义。
 */

export function fixCjkEmphasis(input: string): string {
  if (!input.includes("*")) return input;

  /* 围栏（``` / ~~~）行级状态机：围栏内逐字保留；普通行再做行内码切割。 */
  const fenceRe = /^(\s{0,3})(`{3,}|~{3,})/;
  const lines = input.split("\n");
  const out: string[] = [];
  let fenceMarker: string | null = null;
  for (const line of lines) {
    if (fenceMarker !== null) {
      out.push(line);
      if (fenceRe.exec(line)?.[2]?.[0] === fenceMarker[0]) fenceMarker = null;
      continue;
    }
    const open = fenceRe.exec(line);
    if (open !== null) {
      fenceMarker = open[2];
      out.push(line);
      continue;
    }
    out.push(fixInlineSegments(line));
  }
  return out.join("\n");
}

/** 行级：行内码 `...` 段切开后，普通段按两种失效形态替换。 */
function fixInlineSegments(line: string): string {
  const parts = line.split(/(`[^`\n]*`)/g);
  return parts.map((part) => (part.startsWith("`") && part.endsWith("`") ? part : fixPairs(part))).join("");
}

/**
 * 两种失效形态（都以「标点紧贴 `**`」为必要条件）：
 *  ① `**<内容以标点收尾>**<非空白>`（闭合 run (2b) 失败——用户截图主形态）；
 *  ② 数据对称：`<非空白><**<内容以标点起笔>**`（开启 run 在紧邻标点处失败的镜像形态）。
 * 内容跨行不候选（strong 跨段本就是 GFM 的边缘行为，不做）。
 */
function fixPairs(text: string): string {
  if (!text.includes("**")) return text;
  let out = text;
  // ① 内容以标点收尾 + 闭合后紧跟非空白（spec 2.30 的方向上是 CommonMark 失效位：闭合 (2b) 失败）
  out = out.replace(/\*\*(?=\S)([^*\n]*?[\p{P}\p{S}"'「」『』（）【】：、。？！，；])\*\*(?=[^\s])/gu, "<strong>$1</strong>");
  // ② 镜像形态：开启 run 紧邻标点（开启 (2b) 失败的同族）
  out = out.replace(/(?<=[^\s])\*\*(?=\S)([^*\n]*?[\p{P}\p{S}"'「」『』（）【】：、。？！，；])\*\*/gu, "<strong>$1</strong>");
  // ③ strong **以空格收尾**：把内部尾空格搬到 `**` 之后（字符序列不变、只换位置——
  //    LLM 输出的高频排版误差），使 (1)「闭合 run 前侧非空白」成立。
  //    仅动「strong 主要内容非空、**以空白收尾**」这一形态；纯空白内容不候选。
  out = out.replace(/(\*\*)([^*\n]*[\p{L}\p{N}\p{P}])([\t ]+)(\*\*)/gu, "$1$2$4$3");
  return out;
}
