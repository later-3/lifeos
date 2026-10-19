import { useEffect, useMemo, useRef, useState } from "react";
import DOMPurify from "dompurify";
import { marked } from "marked";
import { IconTool } from "@tabler/icons-react";
import { Spinner } from "./design/ui";
import { argPreview, type Phase } from "./stream-blocks";

/**
 * 消息渲染（Markdown + 结构化块）。
 * 之前直接把文本塞进 div（whitespace-pre-wrap）：Agent 回复里的列表、加粗、代码块全是原始符号。
 * 现在两端都走 marked + DOMPurify（与文件面板同一条链路），HTML 一律不许透传。
 *
 * 流式期（busy）的规则（参照 Pi Web 的 MessageView/ThinkingBlock/ToolCallBlock，见 references 基线表）：
 * - 思考块：增量文本实时可见（自动展开），跑完自动收起、可再点开；
 * - 工具块：调用一出现就展示（名字 + 参数摘要 + "执行中" 转圈），结果回来原地变"完成/出错"并保留耗时；
 * - 消息尾：工作指示行（旋转弧 + 阶段文案 + 秒数），只在 busy 时存在。
 */

export type Block =
  | { type: "text"; text: string }
  | { type: "thinking"; text: string }
  | {
      type: "toolCall"; id?: string; name: string; arguments?: unknown;
      result?: string; isError?: boolean; truncated?: boolean; durationMs?: number;
    };
export type Message = {
  role: "user" | "assistant"; text: string; blocks: Block[];
  /** 仅客户端：这条正在被流事件更新（工作指示与块自动展开都只认它）。loadMessages 重建后自然清掉。 */
  streaming?: boolean;
};

function renderMarkdown(text: string): string {
  return DOMPurify.sanitize(marked.parse(text, { async: false }) as string, { USE_PROFILES: { html: true } });
}

function Markdown({ text, inverse = false }: { text: string; inverse?: boolean }) {
  const html = useMemo(() => renderMarkdown(text), [text]);
  return <div className={`md-body${inverse ? " md-inverse" : ""}`} dangerouslySetInnerHTML={{ __html: html }} />;
}

/** 秒表：整轮生成期间每秒 +1（只在工作指示行里用，卸载即停）。 */
function useWorkingSeconds(active: boolean): number {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (!active) return;
    const startedAt = Date.now();
    const timer = setInterval(() => setSeconds(Math.round((Date.now() - startedAt) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [active]);
  return seconds;
}

const PHASE_LABEL: Record<Phase, string> = {
  waiting: "等待模型…",
  thinking: "思考中…",
  tool: "正在执行工具…",
  text: "输出中…",
};

/** 工作指示行：转圈 + 现在在干什么 + 已用秒数。 */
export function WorkingRow({ phase, activeTool }: { phase: Phase; activeTool?: string }) {
  const seconds = useWorkingSeconds(true);
  const label = phase === "tool" && activeTool !== undefined && activeTool !== "" ? `正在执行 ${activeTool}…` : PHASE_LABEL[phase];
  return (
    <div className="flex items-center gap-2 py-0.5 text-meta text-ink-500">
      <Spinner size={14} className="text-accent" />
      <span className="animate-pulse">{label}</span>
      <span className="tabular-nums text-micro text-ink-500">{seconds}s</span>
    </div>
  );
}

export function MessageView({ role, blocks, busy, align = "end" }: {
  role: "user" | "assistant"; blocks: Block[]; busy: boolean;
  /** 聊天区用户消息靠右（end）；历史时间线里靠左（start），避免与头像/时间脱开 */
  align?: "end" | "start";
}) {
  if (role === "user") {
    const text = blocks.map((block) => (block.type === "text" ? block.text : "")).join("");
    return (
      <div className={`flex ${align === "end" ? "justify-end" : "justify-start"}`}>
        <div className="max-w-bubble rounded-bubble rounded-br-md bg-ink-900 px-4 py-2.5 text-white">
          <Markdown text={text} inverse />
        </div>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      {blocks.map((block, index) => (
        <BlockView key={index} block={block} live={busy} />
      ))}
    </div>
  );
}

/**
 * 流式期自动展开；用户手动点过之后不再强扭。
 * `closeOnEnd`：思考块跑完要收起（否则一屏思考噪音），工具块跑完**不收起**（结果要让人看见）。
 */
function useAutoOpen(live: boolean, closeOnEnd: boolean): [boolean, () => void] {
  const [open, setOpen] = useState(live);
  const touched = useRef(false);
  useEffect(() => {
    if (touched.current) return;
    if (live) setOpen(true);
    else if (closeOnEnd) setOpen(false);
  }, [live, closeOnEnd]);
  const toggle = () => { touched.current = true; setOpen((value) => !value); };
  return [open, toggle];
}

function ThinkingBlock({ text, live }: { text: string; live: boolean }) {
  const [open, toggle] = useAutoOpen(live, true);
  return (
    <div className="max-w-bubble overflow-hidden rounded-panel bg-sunken">
      <button type="button" onClick={toggle}
        className="flex w-full items-center gap-1.5 px-3 py-2 text-left text-meta text-ink-500 transition-colors hover:text-ink-900">
        {live ? <Spinner size={12} className="text-accent" /> : null}
        <span>{live ? "思考中…" : "思考过程"}</span>
        <span className="ml-auto shrink-0 text-micro text-ink-500">{open ? "收起" : "展开"}</span>
      </button>
      {open && (
        <div className="whitespace-pre-wrap border-t border-line px-3 py-2 text-meta leading-relaxed text-ink-700">{text}</div>
      )}
    </div>
  );
}

function ToolCallBlock({ block, live }: { block: Extract<Block, { type: "toolCall" }>; live: boolean }) {
  const running = block.result === undefined;
  const [open, toggle] = useAutoOpen(running, false);
  const preview = argPreview(block.name, block.arguments);
  const tone = block.isError === true ? "text-danger" : running ? "text-ink-500" : "text-success";
  const status = block.isError === true ? "出错" : running ? "执行中" : "完成";
  const seconds = running && live ? undefined : block.durationMs !== undefined ? `${(block.durationMs / 1000).toFixed(1)}s` : undefined;
  return (
    <div className="max-w-bubble overflow-hidden rounded-panel ring-1 ring-line">
      <button type="button" onClick={toggle}
        className="flex w-full items-center gap-1.5 bg-sunken px-3 py-2 text-left text-meta text-ink-700 transition-colors hover:bg-hover">
        {running ? <Spinner size={12} className="text-accent" /> : <IconTool size={14} className="shrink-0 text-ink-300" />}
        <span className="shrink-0 font-medium">{block.name}</span>
        {preview !== "" && <span className="min-w-0 flex-1 truncate font-mono text-micro text-ink-500">{preview}</span>}
        <span className={`ml-auto shrink-0 text-micro ${tone}`}>{status}</span>
        {seconds !== undefined && <span className="shrink-0 tabular-nums text-micro text-ink-500">{seconds}</span>}
      </button>
      {open && (
        <>
          <pre className="overflow-x-auto whitespace-pre-wrap border-t border-line px-3 py-2 font-mono text-micro leading-relaxed text-ink-700">{JSON.stringify(block.arguments ?? {}, null, 2)}</pre>
          {block.result !== undefined && (
            <pre className="max-h-40 overflow-y-auto whitespace-pre-wrap border-t border-line bg-sunken px-3 py-2 font-mono text-micro leading-relaxed text-ink-500">{block.result}{block.truncated === true ? "\n…（界面只显示前 8KB，完整结果见会话文件）" : ""}</pre>
          )}
        </>
      )}
    </div>
  );
}

function BlockView({ block, live }: { block: Block; live: boolean }) {
  if (block.type === "text") {
    if (block.text === "" && live) return null;
    return <Markdown text={block.text} />;
  }
  if (block.type === "thinking") return <ThinkingBlock text={block.text} live={live} />;
  return <ToolCallBlock block={block} live={live} />;
}
