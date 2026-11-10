/**
 * 对话区 Markdown 代码块的语法高亮（2026-11-10，用户点名"渲染做得较好的项目要下功夫"）。
 *
 * 为什么复用 `review-highlight-prism` 的执行层而不是再写一份：
 * 那层已经解决了三件难事（懒加载 prism、按需加载 grammar、内容哈希缓存），
 * 且有实测依据（静态全量 import 会让首屏 chunk +27.8 kB gzip——注释里有数字）。
 * chat 场景与 review 场景**共用同一套 `--color-syn-*` token 与同类分组**，
 * `review-highlight-style.ts` 的 `tokenClassName` 直接消费（Tailwind 4 从 tokens.css
 * 的 `--color-syn-*` 自动生成 `text-syn-*`——这正是后期做 md 深浅色适配的入口）。
 *
 * 渲染链：marked（fence → `<pre><code class="language-x md-hl-pending">`）→
 * DOMPurify → `Markdown` 组件 useEffect 调 `decorateCodeBlocks(node)`：
 * 棱语法 tokenize 是**异步可达**（grammar 需按需 import），所以不能在同步 renderer 里做，
 * 这里作为第二拍补齐；已装饰的块打 `data-md-hl="done"` 跳过，流式重渲染不重复算。
 */
import { ensureGrammar, grammarReady, tokenizeFileCached } from "./review-highlight-prism";
import { ensurePrism } from "./review-highlight-prism";
import { shouldTokenize } from "./review-highlight";
import { tokenClassName } from "./review-highlight-style";

/** Prism token 渲染：`Token` 的 types 多层时取 `tokenClassName` 的第一个命中。 */
function spanOf(token: { types: readonly string[]; content: string }): string {
  const cls = tokenClassName(token.types);
  const text = escapeHtml(token.content);
  return cls === undefined ? text : `<span class="${cls}">${text}</span>`;
}

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

/** `language-js tsx markdown` → "ts" / "tsx"（marked 的 info string 第一段是语言名）。 */
export function languageOfFence(infoString: string): string | undefined {
  const first = infoString.trim().split(/\s+/)[0]?.toLowerCase();
  if (first === undefined || first === "" || first === "plain") return undefined;
  // 常用别名：与 review-highlight 的 EXTENSION_LANGUAGE 同源（ts/tsx/jsx 已在 prism 打包内）
  const alias: Record<string, string> = {
    sh: "bash", shell: "bash", zsh: "bash", console: "bash",
    yml: "yaml", py: "python", rb: "ruby", js: "javascript",
    ts: "typescript", tsx: "typescript", md: "markdown", pl: "perl",
  };
  return alias[first] ?? first;
}

/**
 * 装饰一个 Markdown 容器里的全部待高亮代码块（幂等；返回已装饰的数量）。
 * 调用方：`Markdown` 的 useEffect（DOMPurify 已产出 DOM、流式增量会再进来）。
 * 失败路径：prism/grammar 没就绪 → 本轮跳过，**不打 done 标记**，下一轮再试（不丢高亮）。
 */
export async function decorateCodeBlocks(root: HTMLElement | null): Promise<number> {
  if (root === null) return 0;
  const pending = Array.from(root.querySelectorAll<HTMLElement>("code.md-hl-pending"));
  if (pending.length === 0) return 0;
  const prism = await ensurePrism();
  if (prism === undefined) return 0;
  let decorated = 0;
  for (const code of pending) {
    const language = languageOfFence((code.parentElement as HTMLElement | null)?.dataset.mdCode ?? code.className);
    const needLanguage = language !== undefined;
    if (needLanguage && !grammarReady(language)) {
      await ensureGrammar(language);
      if (!grammarReady(language)) continue; // 这个语言的 grammar 拉不到 → 保持纯文本（可读，不打 done）
    }
    const tokens = tokenizeFileCached(code.textContent ?? "", needLanguage ? language : undefined);
    if (tokens === null) { code.dataset.mdHl = "done"; code.classList.remove("md-hl-pending"); continue; }
    const html = tokens.flat(1).map(spanOf).join("");
    code.innerHTML = html;
    code.dataset.mdHl = "done";
    // 类标记必须一并移除：React 流式重渲染时 `Markdown` 的 effect 会重跑，
    // `md-hl-pending` 还挂着会被当成新块重复 tokenize（浪费且可能读到旧缓存）。
    code.classList.remove("md-hl-pending");
    decorated += 1;
  }
  return decorated;
}

/** shouldTokenize 的薄封装（md 的行数上限与 review 相同，2000 行保护共用一个数）。 */
export function mdShouldHighlight(language: string | undefined, lineCount: number): boolean {
  return shouldTokenize(language, lineCount);
}
