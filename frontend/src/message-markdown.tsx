/**
 * 消息正文的 Markdown 渲染（从 Message.tsx 拆出，2026-11-03 自检）。
 *
 * 拆出来的理由：批注的 `annotated-text-block.tsx` 也要用它。
 * 留在 Message.tsx 里会造成"组件文件互相 import 组件"，循环依赖风险高。
 *
 * 渲染链路不变：marked → DOMPurify → dangerouslySetInnerHTML。
 * **HTML 一律不透传**（DOMPurify 只放行 html profile 内的标签与属性）。
 */

import { useMemo } from "react";
import DOMPurify from "dompurify";
import { marked } from "marked";

export function renderMarkdown(text: string): string {
  return DOMPurify.sanitize(marked.parse(text, { async: false }) as string, { USE_PROFILES: { html: true } });
}

export function Markdown({ text, inverse = false }: { text: string; inverse?: boolean }) {
  const html = useMemo(() => renderMarkdown(text), [text]);
  return <div className={`md-body${inverse ? " md-inverse" : ""}`} dangerouslySetInnerHTML={{ __html: html }} />;
}
