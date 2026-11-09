// G8 语法高亮：Prism 的**执行层**（唯一碰库的地方）。
//
// 分工：
//  - `review-highlight.ts`：纯判定（语言识别 / 行级查 token / 侧选择 / 退化门槛），不碰库；
//  - 本文件：把"全文 + 语言"变成"每行 token 数组"，并按需**动态加载 grammar**。
//
// 为什么动态加载 grammar（difit `languageLoader.ts:1-40` 同款）：
//  `prism-react-renderer` 自带的 `Prism.languages` 只有 53 个**打包进去的**语言，
//  其余 grammar 在 `prismjs/components/prism-<lang>.js` 里，必须按需 import——
//  全量 import 会把 2MB 的 prismjs components 全部塞进产物。
//
// 与 difit 的差异（都是"我们能做而他们没做"的部分）：
//  1. difit 用 `prism-react-renderer` 的 `Highlight` 组件在**渲染期**逐行分词；
//     我们预分词整篇（一次 `Prism.tokenize`），diff 里按行号查（他们 `useFileLevelTokens` 也是这个思路，
//     但他们只对"整文件 blob + ≤2000 行"生效，我们额外把结果缓存起来跨行复用）。
//  2. 我们的**缓存键含内容哈希**：内容变了自动失效，不会显示上一次的高亮。
//
// 纪律：不读 DOM、不碰 React；缓存有上限（防长会话里无限增长）。

import { shouldTokenize, type Token } from "./review-highlight.ts";

/**
 * **动态加载** `prism-react-renderer`（实测很重要）。
 *
 * 为什么不用静态 import（2026-11-08 实测对比）：这个包把 **53 个 grammar** 全打进主 chunk，
 * 静态引入让首屏产物 **587.63 kB → 674.24 kB**（gzip 185.95 → 213.73，**+27.8 kB gzip**）。
 * 而绝大多数时候用户根本不打开检视面板，这笔钱不该人人付。改成 `import()` 后它是独立 chunk，
 * 只在真的需要高亮时加载（`ensurePrism()`）。
 *
 * difit 用静态 import（`src/client/utils/prism.ts:1-10`），所以他们的产物一直带着这份成本；
 * 这是我们能比他们做得好的地方（有实测数字，不是感觉）。
 */
type PrismModule = {
  Prism: { languages: Record<string, unknown>; tokenize: (code: string, grammar: unknown) => unknown };
  normalizeTokens: (tokens: unknown) => Token[][];
};

let prism: PrismModule | undefined;
let loading: Promise<PrismModule | undefined> | undefined;

/** 确保 Prism 已加载（幂等、并发安全）。失败返回 undefined（高亮是增强，不该让面板挂）。 */
export async function ensurePrism(): Promise<PrismModule | undefined> {
  if (prism !== undefined) return prism;
  if (loading !== undefined) return loading;
  loading = import("prism-react-renderer")
    .then((module) => {
      prism = {
        Prism: module.Prism as unknown as PrismModule["Prism"],
        normalizeTokens: module.normalizeTokens as unknown as PrismModule["normalizeTokens"],
      };
      return prism;
    })
    .catch(() => undefined)
    .finally(() => { loading = undefined; });
  return loading;
}

/** Prism 是否已就绪（同步判定；渲染期用）。 */
export function prismReady(): boolean {
  return prism !== undefined;
}


/** tokenize 结果：每行一个 token 数组（行号 1 起 → 下标 0 起）。 */
export type FileTokens = readonly (readonly Token[])[];

/** 缓存上限（条目数）。一个 Task 同时展开的文件数远小于此值；超出丢最旧（FIFO）。 */
export const TOKEN_CACHE_LIMIT = 64;

const cache = new Map<string, FileTokens>();
/** 已经注册进 Prism 的 grammar（避免重复 import） */
const loadedGrammars = new Set<string>();
const grammarLoads = new Map<string, Promise<boolean>>();

/**
 * grammar 加载表：只列 `prism-react-renderer` **没打包**的那些。
 *
 * 判定依据（本机实测）：`Object.keys(Prism.languages)` 已含
 * `plain/markup/html/xml/css/javascript/js/typescript/ts/tsx/jsx/json/yaml/md/markdown/sql/
 *  python/py/go/rust/java/cpp/c/swift/kotlin/csharp…` 等 53 个；
 * 这里只补**我们的映射表里用到、但包内没有**的那些（bash/ruby/php/toml/ini/lua/r/powershell/hcl/protobuf）。
 * 不追求把所有语言都装上（difit 的 loadPrismLanguage 有 40+ 分支，绝大多数我们永远用不到）。
 */
const GRAMMAR_IMPORTS: Readonly<Record<string, () => Promise<unknown>>> = {
  bash: () => import("prismjs/components/prism-bash.js"),
  ruby: () => import("prismjs/components/prism-ruby.js"),
  php: async () => {
    // php 依赖 markup-templating（difit languageLoader.ts 同款依赖处理）
    await import("prismjs/components/prism-markup-templating.js");
    return import("prismjs/components/prism-php.js");
  },
  toml: () => import("prismjs/components/prism-toml.js"),
  ini: () => import("prismjs/components/prism-ini.js"),
  lua: () => import("prismjs/components/prism-lua.js"),
  r: () => import("prismjs/components/prism-r.js"),
  powershell: () => import("prismjs/components/prism-powershell.js"),
  hcl: () => import("prismjs/components/prism-hcl.js"),
  protobuf: () => import("prismjs/components/prism-protobuf.js"),
};

/**
 * 确保某语言的 grammar 可用。
 *
 * @returns 是否可用（false = 认不出或加载失败，调用方退回纯文本）
 */
export async function ensureGrammar(language: string): Promise<boolean> {
  const loaded = await ensurePrism();
  if (loaded === undefined) return false;
  if (loaded.Prism.languages[language] !== undefined) return true;
  const loader = GRAMMAR_IMPORTS[language];
  if (loader === undefined) return false;
  if (loadedGrammars.has(language)) return true;
  const pending = grammarLoads.get(language);
  if (pending !== undefined) return pending;
  const job = loader()
    .then(async () => {
      loadedGrammars.add(language);
      return (await ensurePrism())?.Prism.languages[language] !== undefined;
    })
    .catch(() => false)
    .finally(() => { grammarLoads.delete(language); });
  grammarLoads.set(language, job);
  return job;
}

/** 同步判定 grammar 是否已就绪（渲染期用；未就绪先不高亮，加载完再渲染一次）。 */
export function grammarReady(language: string | undefined): boolean {
  return language !== undefined && prism !== undefined && prism.Prism.languages[language] !== undefined;
}

/**
 * 把全文分词成"每行一个 token 数组"。
 *
 * @returns `null` = 不高亮（认不出语言 / 超 2000 行 / 分词异常）——**不抛错**：
 *          高亮是增强，失败不该让 diff 渲染不出来。
 */
export function tokenizeFile(content: string, language: string | undefined): FileTokens | null {
  /**
   * **必须先剥掉末尾换行再分词**（实测，2026-11-08）：
   * `normalizeTokens` 会把末尾的 `
` 变成一个额外的空行（`{types:["plain"],content:"\n",empty:true}`），
   * 于是"分词行数 = 源码行数 + 1"。diff 的行号只到真实末行，多出来那一行虽然用不到，
   * 但会让"行数一致"这个不变量**测不出来**（正是行号错位最常见的原因）。
   * difit 这里没剥（`useFileLevelTokens.ts:40-42`），他们的多余行落在末尾所以碰巧无害。
   */
  const normalized = content.endsWith("\n") ? content.slice(0, -1) : content;
  const lineCount = normalized === "" ? 0 : normalized.split("\n").length;
  if (!shouldTokenize(language, lineCount)) return null;
  if (language === undefined) return null;
  // 未加载 Prism 时不高亮（调用方应先 await `ensurePrism()`；这里只是兜底，不抛错）
  if (prism === undefined) return null;
  const grammar = prism.Prism.languages[language];
  if (grammar === undefined) return null;
  try {
    return prism.normalizeTokens(prism.Prism.tokenize(normalized, grammar)) as FileTokens;
  } catch {
    return null;
  }
}

/**
 * 带缓存的分词。缓存键 = `语言 + 内容哈希`（内容变了自动失效，不会拿旧高亮）。
 *
 * 为什么不用内容本身当键：长文件的内容字符串做 Map key 会一直占着内存；
 * 用 FNV-1a 哈希（同 `review-viewed.ts`）足够区分。
 */
export function tokenizeFileCached(content: string, language: string | undefined): FileTokens | null {
  if (language === undefined || content === "") return null;
  const key = `${language}\u0000${hashOf(content)}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const tokens = tokenizeFile(content, language);
  if (tokens === null) return null;
  if (cache.size >= TOKEN_CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, tokens);
  return tokens;
}

/** 清空缓存（测试/切换检视对象时用）。 */
export function clearTokenCache(): void {
  cache.clear();
}

/** FNV-1a 32 位（与 `review-viewed.ts#diffContentHash` 同一算法家族，独立实现避免跨模块耦合）。 */
function hashOf(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}
