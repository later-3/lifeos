// 短码（`:blush:`）→ 表情图（Task 0016 · P1）。
//
// 为什么用短码而不是工具返回图片（实测结论，见 Task 0016 的调研）：
// - 工具结果里的 image 块会被 provider 转成 `image_url` 发给模型
//   （`pi/packages/ai/src/api/openai-completions.ts:1408-1445`），并按 4800 字符/张估算上下文
//   （`pi/packages/ai/src/utils/estimate.ts:16`）——Agent"发个表情"要烧一次图片预算；
// - 短码只有几个字符（`:blush:`），图片由界面按需拉取，模型全程不接触字节。
//
// 纯函数、无 IO、无 DOM：可被 `test/emoji-shortcode.test.mjs` 穷举。
// 渲染链：本模块把短码换成 **Markdown 图片** → marked 生成 `<img>` → DOMPurify（html profile 放行 img）
// → CSS `.md-emoji` 限定行内尺寸。选 markdown 而不是直接拼 HTML，是为了让净化链路照常工作。

/** 合法短码 = 合法素材 id（与 `src/media.ts` 的 `MEDIA_ID` 同一形态；不合法的一律当普通文字）。 */
const SHORTCODE = /:([a-z0-9][a-z0-9_-]{0,63}):/g;

/**
 * 把 `:id:` 换成 Markdown 图片，**跳过代码**（围栏 ``` 与行内 `code`）。
 *
 * 为什么必须跳过代码：正文里贴一段 `:shortcode:` 的示例代码时，替换掉就变成了图，
 * 用户看不见自己写的东西。代码里原样保留是契约。
 */
export function applyShortcodes(text: string, known: ReadonlySet<string>): string {
  if (text === "" || known.size === 0) return text;
  return splitCodeSegments(text)
    .map((segment) => segment.code
      ? segment.text
      : segment.text.replace(SHORTCODE, (whole, id: string) => known.has(id) ? `![${id}](/api/media/${id})` : whole))
    .join("");
}

type Segment = { text: string; code: boolean };

/** 按行切，**保留行尾换行符**（否则拼回去会少换行——测试 `切分结果拼回去必须等于原文` 就锁这个）。 */
function withNewlines(text: string): string[] {
  return text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
}

/**
 * 切成"代码段"与"非代码段"，拼回去必须等于原文。
 *
 * 认两种代码：
 * - 围栏代码块：行首（允许 ≤3 空格缩进）三个以上反引号或波浪线，直到同种围栏闭合（CommonMark 语义：
 *   闭合围栏的字符相同且长度不短于开围栏）；
 * - 行内代码：成对的反引号（`` `x` ``），**只在同一行内配对**。
 *
 * 宁可把一段普通文字误判成代码（表情不渲染），也不要把代码误判成正文（把示例改成图）。
 */
export function splitCodeSegments(text: string): Segment[] {
  const segments: Segment[] = [];
  let pending: string[] = [];
  let fence: string | undefined;

  const flush = (): void => {
    if (pending.length === 0) return;
    const joined = pending.join("");
    pending = [];
    if (fence !== undefined) { segments.push({ text: joined, code: true }); return; }
    segments.push(...splitInlineCode(joined));
  };

  for (const line of withNewlines(text)) {
    const marker = /^\s{0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (fence !== undefined) {
      pending.push(line);
      const closes = marker !== undefined && marker[0] === fence[0] && marker.length >= fence.length;
      if (!closes) continue;
      segments.push({ text: pending.join(""), code: true });
      pending = [];
      fence = undefined;
      continue;
    }
    if (marker !== undefined) {
      flush();
      fence = marker;
      pending.push(line);
      continue;
    }
    pending.push(line);
  }
  // 未闭合围栏：整段当代码（渲染器语义一致）
  flush();
  return segments;
}

/** 行内反引号切分：成对的才当代码，落单的反引号留在正文里。 */
function splitInlineCode(text: string): Segment[] {
  const segments: Segment[] = [];
  let start = 0;
  let index = 0;
  while (index < text.length) {
    if (text[index] !== "`") { index += 1; continue; }
    let runEnd = index;
    while (runEnd < text.length && text[runEnd] === "`") runEnd += 1;
    const run = text.slice(index, runEnd);
    const close = text.indexOf(run, runEnd);
    if (close === -1) { index = runEnd; continue; }         // 落单：不算代码
    if (index > start) segments.push({ text: text.slice(start, index), code: false });
    segments.push({ text: text.slice(index, close + run.length), code: true });
    index = close + run.length;
    start = index;
  }
  if (start < text.length) segments.push({ text: text.slice(start), code: false });
  return segments;
}
