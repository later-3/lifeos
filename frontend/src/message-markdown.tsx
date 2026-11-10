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

/** marked v18 的 code renderer 收**对象**参数；HTML 全部 `escaped`，不做原始透传。 */
function codeRenderer({ text, lang }: { text: string; lang?: string }): string {
  const language = lang ?? "";
  const escaped = text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
  return `<pre data-md-code="${language}"><code class="language-${language} md-hl-pending">${escaped}\n</code></pre>`;
}

const marked = new Marked({ renderer: { code: codeRenderer } });

export function renderMarkdown(text: string): string {
  return DOMPurify.sanitize(marked.parse(text, { async: false }) as string, { USE_PROFILES: { html: true } });
}

export function Markdown({ text, inverse = false }: { text: string; inverse?: boolean }) {
  const html = useMemo(() => renderMarkdown(text), [text]);
  // 装饰引用当前 DOM（dangerouslySetInnerHTML 会整体重建子树），text 变化/路由变化都重跑
  const hostRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const node = hostRef.current;
    if (node !== null && !node.querySelector(".md-hl-pending")) return;
    void decorateCodeBlocks(node);
  }, [html]);
  return <div ref={hostRef} className={`md-body${inverse ? " md-inverse" : ""}`} dangerouslySetInnerHTML={{ __html: html }} />;
}
