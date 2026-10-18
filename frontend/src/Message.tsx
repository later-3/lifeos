import { useMemo } from "react";
import DOMPurify from "dompurify";
import { marked } from "marked";
import { IconTool } from "@tabler/icons-react";

/**
 * 消息渲染（Markdown + 结构化块）。
 * 之前直接把文本塞进 div（whitespace-pre-wrap）：Agent 回复里的列表、加粗、代码块全是原始符号。
 * 现在两端都走 marked + DOMPurify（与文件面板同一条链路），HTML 一律不许透传。
 */

export type Block =
  | { type: "text"; text: string }
  | { type: "thinking"; text: string }
  | { type: "toolCall"; id?: string; name: string; arguments?: unknown; result?: string; isError?: boolean };
export type Message = { role: "user" | "assistant"; text: string; blocks: Block[] };

function renderMarkdown(text: string): string {
  return DOMPurify.sanitize(marked.parse(text, { async: false }) as string, { USE_PROFILES: { html: true } });
}

function Markdown({ text, inverse = false }: { text: string; inverse?: boolean }) {
  const html = useMemo(() => renderMarkdown(text), [text]);
  return <div className={`md-body${inverse ? " md-inverse" : ""}`} dangerouslySetInnerHTML={{ __html: html }} />;
}

export function MessageView({ role, blocks, busy }: { role: "user" | "assistant"; blocks: Block[]; busy: boolean }) {
  if (role === "user") {
    const text = blocks.map((block) => (block.type === "text" ? block.text : "")).join("");
    return (
      <div className="flex justify-end">
        <div className="max-w-bubble rounded-bubble rounded-br-md bg-ink-900 px-4 py-2.5 text-white">
          <Markdown text={text} inverse />
        </div>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      {blocks.length === 0 && <p className="text-body text-ink-500">{busy ? "…" : ""}</p>}
      {blocks.map((block, index) => (
        <BlockView key={index} block={block} busy={busy} />
      ))}
    </div>
  );
}

function BlockView({ block, busy }: { block: Block; busy: boolean }) {
  if (block.type === "text") {
    if (block.text === "" && busy) return <p className="text-body text-ink-500">…</p>;
    return <Markdown text={block.text} />;
  }
  if (block.type === "thinking") {
    return (
      <details className="group max-w-bubble rounded-panel bg-sunken">
        <summary className="flex cursor-pointer select-none items-center gap-1.5 px-3 py-2 text-meta text-ink-500 transition-colors hover:text-ink-900">
          <span className="text-ink-300">思考过程</span>
        </summary>
        <div className="whitespace-pre-wrap border-t border-line px-3 py-2 text-meta leading-relaxed text-ink-700">{block.text}</div>
      </details>
    );
  }
  const tone = block.isError ? "text-danger" : block.result !== undefined ? "text-success" : "text-ink-500";
  const status = block.isError ? "出错" : block.result !== undefined ? "完成" : "执行中";
  return (
    <details className="group max-w-bubble overflow-hidden rounded-panel ring-1 ring-line">
      <summary className="flex cursor-pointer select-none items-center gap-1.5 bg-sunken px-3 py-2 text-meta text-ink-700 transition-colors hover:bg-hover">
        <IconTool size={14} className="shrink-0 text-ink-300" />
        <span className="truncate font-medium">{block.name}</span>
        <span className={`ml-auto shrink-0 text-micro ${tone}`}>{status}</span>
      </summary>
      <pre className="overflow-x-auto whitespace-pre-wrap border-t border-line px-3 py-2 font-mono text-micro leading-relaxed text-ink-700">{JSON.stringify(block.arguments ?? {}, null, 2)}</pre>
      {block.result !== undefined && (
        <pre className="max-h-40 overflow-y-auto whitespace-pre-wrap border-t border-line bg-sunken px-3 py-2 font-mono text-micro leading-relaxed text-ink-500">{block.result}</pre>
      )}
    </details>
  );
}
