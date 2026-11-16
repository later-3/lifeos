/**
 * 流式 Markdown 的「补齐未闭合结构」（Task 0018 · R5）。
 *
 * ## 为什么需要它
 *
 * 流式文本每来一个 delta 就整体重解析一次。分隔符**只到一半**时是字面文本（用户看到 `**渲染入口` 里的两个星号），
 * 闭合符到达那一刻，星号被吃掉、同一段文字翻成粗体 —— **屏幕上已经显示过的字符消失了，字形宽度也变了**。
 * 实测（`evidence/d22`）：一段典型思考文本（小标题 + 粗体 + 行内码 + 列表，75 字符 / 13 个 delta）
 * 出现 4 次「回吞」、共 39 个已显示字符被改掉；纯文字 0 次 —— 这就是用户说的「思考块追加时某些情况下不断闪」。
 *
 * 补法：**渲染前把"已开启但未闭合"的结构补上闭合符**。这样从有内容那一刻起它就是格式化文本，
 * 后续 delta 只是往里加字。
 *
 * ## 与参考实现的关系（A 级，源码可核）
 *
 * Vercel 的 `remend`（npm 1.3.0，Apache-2.0，`streamdown` 的依赖，Vercel `ai-chatbot` 在用它）做的正是这件事。
 * README 原话："When AI models stream Markdown token-by-token, you often get partial formatting markers
 * like unclosed `**bold**`… Remend automatically completes these unterminated blocks so they render
 * correctly in real-time."
 *
 * 关键规则照它的做法（`dist/index.js` 的 `M=/(\*\*)([^*]*\*?)$/` 与 `d=/^[\s_~*`]*$/`）：
 * - **开启符后面还没有可见内容时不补**（`先确认 **` 保持字面）——这是唯一的固有边界：
 *   内容到达的第一帧那两个星号会被结构吞掉（remend 同）。
 * - **尾部只有一个星号时不补两个**：`**粗体*` 补成 `**粗体**`（补一个），否则会变成 `***`。
 *
 * ## 边界（必须守住）
 *
 * - **必须** 只在流式期调用（`streaming === true`）；定稿文本一律走原文。
 * - **必须** 幂等：对已经完整的文本返回原样。
 * - **必须** 围栏内部一律不处理（字面代码）；围栏自身未闭合要补。
 * - **必须** 不碰转义（`\*`）、不处理单个 `*` / `_` 斜体（`2 * 3`、`snake_case` 太常见）。
 */

/** 围栏匹配（行级）：至少三个同类字符。 */
const FENCE_LINE = /^\s{0,3}(`{3,}|~{3,})/;
/** 定界符之后"没有可见内容"的判定（只有空白与标记本身）。参考 remend 的 `d`。 */
const NO_CONTENT = /^[\s_~*`]*$/;

type FenceSplit = { openMarker: string | null; openAt: number };

/** 扫一遍行，判断是否存在未闭合围栏。 */
function scanFence(text: string): FenceSplit {
  let open: string | null = null;
  let openAt = -1;
  let lineStart = 0;
  for (const line of text.split("\n")) {
    const match = FENCE_LINE.exec(line);
    if (match !== null) {
      const marker = match[1]!;
      if (open === null) { open = marker; openAt = lineStart; }
      else if (marker[0] === open[0] && marker.length >= open.length) { open = null; openAt = -1; }
    }
    lineStart += line.length + 1;
  }
  return { openMarker: open, openAt };
}

/**
 * 把**围栏区域**的字符抹成空格（保留换行与总长度）。
 * 后续扫描（行内码/粗体/链接）只看普通文本，位置索引对原文仍然成立。
 * 为什么必须有：代码块里的 `**` 与单个反引号是字面文本，不抹掉会被当成未闭合结构去补。
 */
function maskFences(text: string): string {
  const out: string[] = [];
  let inFence: string | null = null;
  for (const line of text.split("\n")) {
    const match = FENCE_LINE.exec(line);
    const marker = match === null ? null : match[1]!;
    if (inFence === null) {
      if (marker !== null) { inFence = marker; out.push(" ".repeat(line.length)); }
      else out.push(line);
      continue;
    }
    out.push(" ".repeat(line.length));
    if (marker !== null && marker[0] === inFence[0] && marker.length >= inFence.length) inFence = null;
  }
  return out.join("\n");
}

/** 该位置是否被反斜杠转义（前面有奇数个 `\`）。 */
function isEscaped(text: string, index: number): boolean {
  let count = 0;
  for (let i = index - 1; i >= 0 && text[i] === "\\"; i -= 1) count += 1;
  return count % 2 === 1;
}

/** 从 i 起读一段连续同字符，返回长度。 */
function runLength(text: string, i: number, char: string): number {
  let n = 0;
  while (text[i + n] === char) n += 1;
  return n;
}

/** 找**未闭合**的行内码起点（-1 = 没有）。三连及以上当围栏，跳过。 */
function unmatchedCodeStart(text: string): number {
  let i = 0;
  while (i < text.length) {
    if (text[i] !== "`" || isEscaped(text, i)) { i += 1; continue; }
    const run = runLength(text, i, "`");
    if (run >= 3) { i += run; continue; }
    let j = i + run;
    let closed = false;
    while (j < text.length) {
      if (text[j] === "`" && !isEscaped(text, j)) {
        const closeRun = runLength(text, j, "`");
        if (closeRun === run) { closed = true; j += closeRun; break; }
        j += closeRun;
        continue;
      }
      j += 1;
    }
    if (!closed) return i;
    i = j;
  }
  return -1;
}

/** 把**已配对**的行内码内容抹成空格（保留定界符与长度、保留换行）。 */
function blankPairedCode(text: string): string {
  const chars = [...text];
  let i = 0;
  while (i < chars.length) {
    if (chars[i] !== "`" || isEscaped(text, i)) { i += 1; continue; }
    const run = runLength(text, i, "`");
    if (run >= 3) { i += run; continue; }
    let j = i + run;
    let closed = -1;
    while (j < chars.length) {
      if (chars[j] === "`" && !isEscaped(text, j)) {
        const closeRun = runLength(text, j, "`");
        if (closeRun === run) { closed = j; break; }
        j += closeRun;
        continue;
      }
      j += 1;
    }
    if (closed < 0) { i += run; continue; }
    for (let k = i + run; k < closed; k += 1) if (chars[k] !== "\n") chars[k] = " ";
    i = closed + run;
  }
  return chars.join("");
}

/** 数一段文本里未被转义的定界符出现次数。 */
function delimiterCount(text: string, delimiter: string): number {
  let count = 0;
  let i = 0;
  while (i <= text.length - delimiter.length) {
    if (text.startsWith(delimiter, i) && !isEscaped(text, i)) { count += 1; i += delimiter.length; continue; }
    i += 1;
  }
  return count;
}

/**
 * 是否应该补闭合：最后一个定界符之后必须真有可见内容。
 * 参考 remend 的 `d=/^[\s_~*`]*$/` —— 只有空白/标记时不补（否则 `先确认 **` 会变成空粗体）。
 */
function shouldClose(text: string, delimiter: string): boolean {
  const at = text.lastIndexOf(delimiter);
  if (at < 0) return false;
  return !NO_CONTENT.test(text.slice(at + delimiter.length));
}

/**
 * 补 `**` / `~~` 这类成对分隔符：
 * 未闭合且已有内容时，**尾部已有一个同类字符就只补一个**（否则会变成 `***`）。
 */
function closePair(text: string, delimiter: string): string {
  if (delimiterCount(text, delimiter) % 2 === 0) return text;
  if (!shouldClose(text, delimiter)) return text;
  const last = delimiter[delimiter.length - 1]!;
  return text.endsWith(last) ? `${text}${last}` : `${text}${delimiter}`;
}

/** 补齐**围栏之外**的普通文本里未闭合的结构。 */
function closePlain(rawText: string): string {
  // 先把围栏区域抹成空格：那里的 `**` / 反引号是字面代码，不能当结构处理
  const text = maskFences(rawText);
  // ① 行内码：未闭合就补一个反引号，它之后全是代码，别的结构不用再看
  const codeStart = unmatchedCodeStart(text);
  if (codeStart >= 0) {
    const tail = text.slice(codeStart + 1);
    return NO_CONTENT.test(tail) ? rawText : `${rawText}\``;
  }

  const flat = blankPairedCode(text);

  // ② 粗斜体（***）/ 粗体（**）/ 删除线（~~）
  if (delimiterCount(flat, "***") % 2 === 1 && shouldClose(flat, "***")) {
    // `***内容**` → 补一个（尾部已有 `**`）；`***内容*` → 补两个；其余补三个
    const rest = flat.slice(flat.lastIndexOf("***") + 3);
    const tailRun = runLength([...rest].reverse().join(""), 0, "*");
    const need = (3 - (tailRun % 3)) % 3;
    return `${rawText}${"*".repeat(need === 0 ? 0 : need)}`;
  }
  const bold = closePair(flat, "**");
  if (bold !== flat) return `${rawText}${bold.slice(flat.length)}`;
  const strike = closePair(flat, "~~");
  if (strike !== flat) return `${rawText}${strike.slice(flat.length)}`;

  // ③ 链接 / 图片：`[文字](url` 补 `)`；图片（`![`）截掉 —— 半截 URL 会渲染成破图
  const open = flat.lastIndexOf("](");
  if (open >= 0 && !isEscaped(flat, open) && !flat.slice(open + 2).includes(")")) {
    const bracket = flat.lastIndexOf("[", open);
    if (bracket >= 0) {
      const isImage = bracket > 0 && flat[bracket - 1] === "!" && !isEscaped(flat, bracket - 1);
      return isImage ? rawText.slice(0, bracket - 1) : `${rawText})`;
    }
  }
  return rawText;
}

/**
 * 补齐未闭合的 Markdown 结构。**只用于流式预览**（见文件头）。
 * 幂等：对已经完整的文本返回原样。
 */
export function closeIncompleteMarkdown(text: string): string {
  if (text.trim() === "") return text;
  const fence = scanFence(text);
  if (fence.openMarker === null) return closePlain(text);
  // 围栏行之前照常处理（它自己可能还有未闭合的粗体/行内码），围栏之后都算代码
  const head = text.slice(0, fence.openAt);
  const rest = text.slice(fence.openAt);
  return `${closePlain(head)}${rest}\n${fence.openMarker}`;
}
