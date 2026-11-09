// G8 语法高亮：**纯判定**（语言识别、行级 token 查找、退化门槛）。不含 DOM、不含 Prism 调用。
//
// 参考（2026-11-08 逐个读源码）：
//  - **difit** `src/client/utils/languageDetection.ts:63-145`：`PRISM_EXTENSION_LANGUAGE_MAP` 共 ~75 条，
//    扩展名 → Prism 语言 id（`tsx → tsx`、`scss → css`、`vue → html`、`mts → typescript`…）。
//  - **difit** `src/client/hooks/useFileLevelTokens.ts:21,40-42`：
//    `MAX_WHOLE_FILE_LINES = 2000`——**整文件分词超过 2000 行就放弃**，退化为"按行高亮/不highlight"。
//    关键点：他们先取**全文 blob** 再整篇分词，而不是只处理 diff 可见行。
//  - **difit** `DiffCodeLine.tsx:46-58`：
//    `getOldTokens` / `getNewTokens` 按**行号**查预分词结果；
//    删除行只能用 old 侧，其它行用 new 侧、没有 new 行号时回落 old 侧。
//  - **opencode** 走 `@pierre/highlights`（`codeToTokens` / `LiveTokenizer`，在 **Worker** 里跑）——
//    它把高亮放到 worker，主线程不受影响；我们这版先同步做（实测 2000 行 9.9ms，见下），
//    退化门槛与他们/difit 同值。
//
// **实测（本机，2026-11-08，`prism-react-renderer` 2.4.1 + Node 24）**：
//   200 行 5.7ms · 500 行 3.8ms · 1000 行 7.5ms · 2000 行 9.9ms · 4000 行 32.5ms。
//   结论：**2000 行以内同步分词可接受**（<10ms，一帧预算内）；4000 行开始明显（32.5ms）——
//   所以门槛取 2000（与 difit 同值，且被这次实测支持，不是照抄）。
//
// 纪律：纯函数。

/**
 * 整文件分词的行数上限（difit `useFileLevelTokens.ts:21` 同值）。
 * 超过它就**不高亮**（退回纯文本），避免一次 30ms+ 的同步计算卡住滚动。
 */
export const MAX_HIGHLIGHT_LINES = 2000;

/**
 * 扩展名 → Prism 语言 id。
 *
 * 只收录**我们确实会遇到的**（代码/文档/配置），不抄 difit 的 75 条全表：
 * 抄全表的代价是每条都要能被验证，而我们没有那些语言的样本（= 假支持）。
 * 未收录的扩展名 → `undefined` → 不高亮（纯文本），这比"猜一个语言"诚实。
 *
 * 依据来源：difit `PRISM_EXTENSION_LANGUAGE_MAP`（`:63-145`）的同名映射；
 * 差异处已标注原因。
 */
export const EXTENSION_LANGUAGE: Readonly<Record<string, string>> = {
  // 前端/TS
  ts: "typescript", mts: "typescript", cts: "typescript",
  tsx: "tsx",
  js: "javascript", mjs: "javascript", cjs: "javascript",
  jsx: "jsx",
  // 样式/标记
  css: "css", scss: "css", less: "css", // difit：scss → css（同一 grammar，不再单独装 scss）
  html: "markup", htm: "markup", xml: "markup", svg: "markup",
  vue: "markup", // difit 同判：vue → html
  // 数据/配置
  json: "json", jsonc: "json", webmanifest: "json",
  yml: "yaml", yaml: "yaml",
  toml: "toml",
  ini: "ini",
  // 文档（md 的 diff 按源码行显示，D4；这里给的是行内标记高亮）
  md: "markdown", markdown: "markdown",
  // 脚本
  sh: "bash", bash: "bash", zsh: "bash", fish: "bash",
  ps1: "powershell",
  // 后端/系统语言
  py: "python",
  rb: "ruby",
  go: "go",
  rs: "rust",
  java: "java",
  kt: "kotlin", kts: "kotlin",
  swift: "swift",
  c: "c",
  h: "c",
  cpp: "cpp", cc: "cpp", cxx: "cpp", hpp: "cpp",
  cs: "csharp",
  php: "php",
  sql: "sql",
  // 我们的实际文件类型
  proto: "protobuf",
  tf: "hcl", tfvars: "hcl", hcl: "hcl",
  lua: "lua",
  r: "r",
};

/** 取文件路径的扩展名（小写，不含点）。`.gitignore` 这类无扩展名文件返回自身名字。 */
export function extensionOf(path: string): string {
  const name = path.replace(/^.*\//, "");
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return name.toLowerCase();   // dot === 0：`.gitignore` 视为整名
  return name.slice(dot + 1).toLowerCase();
}

/** 文件路径 → Prism 语言 id；认不出返回 undefined（= 不高亮）。 */
export function languageOf(path: string): string | undefined {
  return EXTENSION_LANGUAGE[extensionOf(path)];
}

/** 一个 token（与 prism-react-renderer 的 `Token` 同形状的最小子集）。 */
export type Token = { types: string[]; content: string };

/**
 * 按行查 token（difit `DiffCodeLine.tsx:46-58` 的同构）。
 *
 * - `lineNo` 1 起；
 * - 越界/没有预分词结果 → `null`（调用方退回纯文本，**不抛错**：高亮是增强，不是必需功能）。
 */
export function tokensAtLine(perLine: readonly (readonly Token[])[] | null, lineNo: number | null | undefined): readonly Token[] | null {
  if (perLine === null || lineNo === null || lineNo === undefined) return null;
  if (!Number.isFinite(lineNo) || lineNo < 1) return null;
  return perLine[lineNo - 1] ?? null;
}

/**
 * 这一行该用哪一侧的 token。
 *
 * difit 的规则（`DiffCodeLine.tsx:48-58`）：
 *  - 删除行只在 old 侧存在 → 用 old；
 *  - 其它行用 new；**没有 new 行号时回落 old**（例如只有删除行的 hunk 里的 context 行）。
 *
 * 返回 `"old"` / `"new"` / `null`（= 这一行没有可用侧）。
 */
export function tokenSideOf(line: {
  type: "context" | "added" | "removed";
  oldNo: number | null;
  newNo: number | null;
}): "old" | "new" | null {
  if (line.type === "removed") return line.oldNo === null ? null : "old";
  if (line.newNo !== null) return "new";
  return line.oldNo === null ? null : "old";
}

/**
 * 是否值得整文件分词。
 *
 * 两个条件（都要满足）：
 *  1. 认得出语言（认不出就没 grammar，分了也是 plain）；
 *  2. 行数 ≤ `MAX_HIGHLIGHT_LINES`（实测 2000 行 9.9ms / 4000 行 32.5ms）。
 */
export function shouldTokenize(language: string | undefined, lineCount: number): boolean {
  if (language === undefined || language === "") return false;
  if (!Number.isFinite(lineCount) || lineCount < 0) return false;
  return lineCount <= MAX_HIGHLIGHT_LINES;
}

/**
 * 把整段文本切成"每行一个 token 数组"所需的行数。
 * 与 Prism 的 `normalizeTokens` 对齐：**末尾换行不额外产生一行**（否则每行都错位一行）。
 */
export function lineCountOf(content: string): number {
  if (content === "") return 0;
  const trimmed = content.endsWith("\n") ? content.slice(0, -1) : content;
  return trimmed.split("\n").length;
}
