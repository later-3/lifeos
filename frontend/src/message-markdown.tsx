/**
 * 消息正文的 Markdown 渲染（从 Message.tsx 拆出，2026-11-03 自检）。
 *
 * 拆出来的理由：批注的 `annotated-text-block.tsx` 也要用它。
 * 留在 Message.tsx 里会造成"组件文件互相 import 组件"，循环依赖风险高。
 *
 * 渲染链路：marked（自定义 renderer：fence 打 `data-md-code="语言"` + `md-hl-pending`）→
 * DOMPurify（sanitize）→ `dangerouslySetInnerHTML` → `useEffect` 调 `decorateCodeBlocks`
 *（`md-highlight.ts`：异步补齐 prism token 化，懒加载、失败保留纯文本重试）。
 * **HTML 一律不透传**（DOMPurify 只放行 html profile 内的标签与属性）。
 */

import { useEffect, useMemo, useRef } from "react";
import DOMPurify from "dompurify";
import { Marked } from "marked";
import { decorateCodeBlocks } from "./md-highlight";
import { fixCjkEmphasis } from "./md-cjk";
import { expandShortcodes } from "./emoji-catalog";

/** marked v18 的 code renderer 收**对象**参数；HTML 全部 `escaped`，不做原始透传。 */
function codeRenderer({ text, lang }: { text: string; lang?: string }): string {
  const language = lang ?? "";
  const escaped = text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
  return `<pre data-md-code="${language}"><code class="language-${language} md-hl-pending">${escaped}\n</code></pre>`;
}

/**
 * 图片 renderer：表情（`/api/media/<id>`）加 `md-emoji` 类做行内尺寸，
 * 其余图保持默认行为（`![](…)` 仍然按普通图片渲染，`src` 原样交给 DOMPurify 校验协议）。
 *
 * 为什么要接管 img：短码替换出来的是 markdown 图片（`emoji-shortcode.ts`），
 * 只有能区分"表情"与"普通图"才做得出 1em 的行内尺寸（`index.css` 的 `.md-body img.md-emoji`）。
 */
function imageRenderer(token: { href?: string | null; text?: string | null }): string {
  const rawHref = token.href ?? "";
  const alt = (token.text ?? "").replaceAll('"', "&quot;").replaceAll("<", "&lt;");
  const isEmoji = rawHref.startsWith("/api/media/");
  const className = isEmoji ? ' class="md-emoji"' : "";
  const href = rawHref.replaceAll('"', "&quot;");
  return `<img src="${href}" alt="${alt}"${className} loading="lazy">`;
}

const marked = new Marked({ renderer: { code: codeRenderer, image: imageRenderer } });

export function renderMarkdown(text: string): string {
  // 短码（`:blush:`）先换成 markdown 图片：模型只发几个字符，图由界面按 id 拉（`emoji-shortcode.ts`）。
  // 替换发生在 `fixCjkEmphasis` 之前，后者的零宽连接符规则只作用于文本。
  const expanded = expandShortcodes(text);
  // CJK 边界修正先于 marked（这层处理只插零宽连接符，先于 sanitize；见 md-cjk.ts 的规范摘录）
  return DOMPurify.sanitize(marked.parse(fixCjkEmphasis(expanded), { async: false }) as string, { USE_PROFILES: { html: true } });
}

export function Markdown({ text, inverse = false, className = "", streaming = false }: { text: string; inverse?: boolean; className?: string; streaming?: boolean }) {
  const html = useMemo(() => renderMarkdown(text), [text]);
  // 装饰引用当前 DOM（dangerouslySetInnerHTML 会整体重建子树），text 变化/路由变化都重跑
  const hostRef = useRef<HTMLDivElement | null>(null);
  /*
   * **流式期间不着色**（Task 0018 · T3）：
   * `dangerouslySetInnerHTML` 每个 delta 都把整棵子树换掉，而 fade 代码块的着色是
   * “纯文本 → 异步 tokenize → 写回 innerHTML”两拍。流式中逐 delta 重复这两拍，
   * 屏幕上就是代码块不停“有颜色↔没颜色”地闪（实测一段 4 行代码在 14 个 delta 里闪了 11 次）。
   * 所以流式期只出纯文本，**这一轮结束**（streaming 变 false）时一次着色。
   * 旁证（A 级，源码可核）：pi-web `components/MermaidBlock.tsx:236-266`（main@f3a5c91）注释原话
   * “highlighting a growing block re-tokenizes all of it on every chunk, which is the single most
   * expensive part of streamed rendering”，做法同样是流式期只渲染纯文本。
   */
  useEffect(() => {
    if (streaming) return;
    const node = hostRef.current;
    if (node !== null && !node.querySelector(".md-hl-pending")) return;
    void decorateCodeBlocks(node);
  }, [html, streaming]);
  const classes = ["md-body", inverse ? "md-inverse" : "", className].filter(Boolean).join(" ");
  return <div ref={hostRef} className={classes} dangerouslySetInnerHTML={{ __html: html }} />;
}
