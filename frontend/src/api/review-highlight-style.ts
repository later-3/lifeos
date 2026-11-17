// G8 语法高亮：Prism token 类型 → Tailwind 类（**纯映射**，不碰 DOM）。
//
// 为什么不在 tokens.css 里定义 `--color-syn-*` 之后直接内联 style：
//  前端规范 2.8 要求"组件不写字面量数值/颜色"，而 `style={{color:"var(--color-syn-keyword)"}}`
//  是**拼字符串**——lint:tokens 拦不住拼错的变量名（`--color-syn-keywrod` 会静默变黑）。
//  映射成 Tailwind 类（`text-syn-keyword` 由 tokens.css 的 `--color-syn-*` 生成）就能被
//  类型/类名检查覆盖，也和其它 UI 写法一致。
//
// 分组依据 Prism 的 token 类型族（`Prism.tokenize` 产出的 `types` 数组可能多层：
// `["function","variable"]` 这种）——**取第一个能识别的**，与 difit 的 `getTokenProps`
// 只认主题映射同判（他们没有分组，直接查 theme；我们查分组表，效果等价但可测）。

/** Prism token 类型 → 语义分组（顺序无关；同一 token 命中多个时取表中先出现的）。 */
const GROUP_BY_TYPE: Readonly<Record<string, string>> = {
  keyword: "keyword",
  builtin: "keyword",
  important: "keyword",
  atrule: "keyword",
  boolean: "constant",
  constant: "constant",
  symbol: "constant",
  string: "string",
  char: "string",
  template: "string",
  "template-string": "string",
  regex: "string",
  url: "string",
  comment: "comment",
  prolog: "comment",
  doctype: "comment",
  cdata: "comment",
  number: "number",
  float: "number",
  function: "function",
  "function-name": "function",
  "class-name": "type",
  "maybe-class-name": "type",
  type: "type",
  "type-parameter": "type",
  namespace: "type",
  annotation: "type",
  operator: "punctuation",
  punctuation: "punctuation",
  tag: "keyword",
  "attr-name": "constant",
  "attr-value": "string",
  property: "constant",
  selector: "keyword",
};

/**
 * 一个 token 的 CSS 类。
 *
 * @returns `undefined` = 用默认文字色（plain / 未识别）。**不要返回空字符串**：
 *          空类名会让 `className` 拼出多余空格，且"没颜色"与"忘了映射"无法区分。
 */
export function tokenClassName(types: readonly string[]): string | undefined {
  for (const type of types) {
    const className = CLASS_BY_GROUP[GROUP_BY_TYPE[type] ?? ""];
    if (className !== undefined) return className;
  }
  return undefined;
}

/**
 * 分组 → **字面量**类名。
 *
 * 必须是字面量：Tailwind 4 的扫描器只认源码里出现的静态字符串，
 * 模板拼接（前缀 + 变量）扫不到 → 类不生成 → 高亮**静默全黑**
 * （实测过这类"编译通过、运行时没颜色"的坑，所以这里不做拼接）。
 */
const CLASS_BY_GROUP: Readonly<Record<string, string>> = {
  keyword: "text-syn-keyword",
  string: "text-syn-string",
  comment: "text-syn-comment",
  number: "text-syn-number",
  function: "text-syn-function",
  type: "text-syn-type",
  constant: "text-syn-constant",
  punctuation: "text-syn-punctuation",
};

/** 表中出现过的全部分组（供测试断言"每个分组都有对应的字面量类名"）。 */
export const TOKEN_GROUPS: readonly string[] = [...new Set(Object.values(GROUP_BY_TYPE))];
