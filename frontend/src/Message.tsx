import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import DOMPurify from "dompurify";
import { marked } from "marked";
import { IconCopy, IconRefresh, IconTool } from "@tabler/icons-react";
import { Spinner } from "./design/ui";
import { ProcessBar } from "./process-bar";
import type { ProcessStats } from "./process-stats";
import { argPreview, type Phase } from "./stream-blocks";
import { copyText } from "./clipboard";
import { copyTextOf } from "./message-text";
import { retryRemainingSeconds, turnStepText, type TurnStep } from "./working";
import {
  annotationsAt, buildIndex, paintAnnotations, quoteOf, toOffset, toRange,
  type Annotation, type BlockIndex,
} from "./annotations";
import { AnnotationCard, AnnotationDraft } from "./annotation-card";
import { markById } from "./marks";
import { popupPosition } from "./annotation-position";
import { MessageActionBar } from "./message-actions";
import type { MessageAction } from "./action-bar";
import { failureLabel, type FailureKind } from "./failure-text";
import { toolState } from "./tool-state";
import { ImageTrigger } from "./design/image-viewer";

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
  | { type: "image"; data: string; mimeType: string }
  | { type: "thinking"; text: string; /** 仅客户端流式段：思考是否仍在该段内进行 */ live?: boolean }
  | {
      type: "toolCall"; id?: string; name: string; arguments?: unknown;
      result?: string; isError?: boolean; truncated?: boolean; durationMs?: number;
      /** 工具读到的图片（Pi 的 read）：与 result 文字并列展示 */
      images?: Array<{ data: string; mimeType: string }>;
      /** 仅客户端：由 tool_execution_start/update/end 驱动，不靠整轮 busy */
      running?: boolean;
    };
export type Message = {
  role: "user" | "assistant"; text: string; blocks: Block[];
  /** 消息时间（毫秒）：失败块据此显示"什么时候失败的"，避免历史失败被误读成当前状态 */
  at?: number;
  /** Pi 的原始失败信息（errorMessage）：作为证据小字显示 */
  error?: string;
  /** 失败归类（超时/连不上/鉴权/限流/服务端/空回复/中断/截断）：决定显示哪句话 */
  failure?: FailureKind;
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
  waiting: "等待模型响应…",
  thinking: "思考中…",
  tool: "正在执行工具…",
  text: "输出中…",
};

/** 工作指示行：转圈 + 现在在干什么 + 已用秒数。 */
export function WorkingRow({ step, phase, activeTool, retry }: {
  step: TurnStep;
  phase: Phase; activeTool?: string;
  retry?: { attempt: number; maxAttempts: number; delayMs: number; message: string; startedAt: number };
}) {
  const total = useWorkingSeconds(true);
  // 状态区分（2026-10-19）：请求刚发出 = 连接中；超过 3s 还没首个事件 = 等待模型响应
  // 重试（2026-10-20）：倒计时逐秒减少（Pi CLI 的 RetryStatusIndicator 同款），不再是静态 "Ns"
  const label = retry !== undefined
    ? `模型调用失败，${retryRemainingSeconds(retry.delayMs, Date.now() - retry.startedAt)}s 后重试（${retry.attempt}/${retry.maxAttempts}）：${retry.message}`
    : phase === "tool" && activeTool !== undefined && activeTool !== "" ? `正在执行 ${activeTool}…`
    : phase === "waiting" && total < 3 ? "正在连接模型…" : PHASE_LABEL[phase];
  return (
    <div className={`flex flex-wrap items-center gap-2 py-0.5 text-meta ${retry !== undefined ? "text-danger" : "text-ink-500"}`}>
      <Spinner size={14} className={retry !== undefined ? "text-danger" : "text-accent"} />
      <span className="font-medium text-ink-700">{turnStepText(step)}</span>
      {step === 3 && <span className="animate-pulse">{label}</span>}
      <span className="tabular-nums text-micro text-ink-500" title="本轮耗时">{total}s</span>
    </div>
  );
}

/** 本条消息要注册进动作条的动作：功能只描述"做什么"，对齐/间距/可见性/反馈由容器决定。 */
function actionsOf(text: string, onRetry: (() => void) | undefined): MessageAction[] {
  const actions: MessageAction[] = [];
  if (text !== "") {
    actions.push({
      key: "copy", label: "复制", icon: <IconCopy size={12} />, title: "复制这条消息",
      testId: "copy-message", doneLabel: "已复制", failedLabel: "复制失败",
      run: () => copyText(text),
    });
  }
  if (onRetry !== undefined) {
    actions.push({
      key: "resend", label: "重新发送", icon: <IconRefresh size={12} />, title: "重新发送这一轮",
      testId: "resend-message",   // 与复制同一条规则：悬停出现（成败都不例外）
      run: onRetry,
    });
  }
  return actions;
}

/** 本地 HH:MM（失败时刻；不显示日期，因为同一会话通常在同一天）。 */
function formatClock(at: number): string {
  const date = new Date(at);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

export function MessageView({ role, blocks, busy, error, failure, align = "end", onRetry, at, historical, onOpenPeer, avatar, authorName, process, messageId, annotationsOfBlock, annotationActions }: {
  role: "user" | "assistant"; blocks: Block[]; busy: boolean; error?: string; failure?: FailureKind;
  /** 消息时间（毫秒）：失败块据此显示时刻（历史失败不该被当成当前状态） */
  at?: number;
  /** 聊天区用户消息靠右（end）；历史时间线里靠左（start），避免与头像/时间脱开 */
  align?: "end" | "start";
  /** 这一轮失败时的"重新发送"（动作挂在被重发的那条用户消息上） */
  onRetry?: () => void;
  /** 点开"与其他 Agent 对话"的详情（Task 0013 · M1）：工具调用产生了一条对端会话，用户要能看过程 */
  onOpenPeer?: (target: { agentId: string; sessionId: string; agentName: string }) => void;
  /** 这条失败不是最后一条消息：标明它是历史记录，不是当前状态 */
  historical?: boolean;
  /** 说话人的头像（用户 = 你本人，助手 = 当前 Agent）；不传就不显示头像（老调用点逐步迁移） */
  avatar?: ReactNode;
  /** 说话人名字（社交媒体式：头像旁要能看出是谁） */
  authorName?: string;
  /**
   * 过程折叠（2026-11-02）：把中间的工具/思考收成一行统计，最终正文留在外面。
   * 只在**该轮有过程**（≥1 工具或 ≥1 思考）且**已完成**时由调用方传入。
   * `textIndexes` = 哪几个块属于"最终正文"（其余块进过程区）。
   */
  process?: { stats: ProcessStats; live: boolean; textIndexes: readonly number[] };
  /** ★ 消息身份（Task 0003 · P1）：批注挂到"哪条消息"上靠它。
   *  不传就不渲染属性（老数据/老会话兼容）。 */
  messageId?: string;
  /** ★ 取某块的批注（Task 0003 · P2）。不传 = 这条消息没有批注，行为与改造前完全一致。 */
  annotationsOfBlock?: (blockIndex: number) => readonly Annotation[];
  /** ★ 批注操作（Task 0003 · P3）。不传 = 只读（历史时间线等）。 */
  annotationActions?: AnnotationActions;
}) {
  const text = copyTextOf(blocks);
  const [hovered, setHovered] = useState(false);
  const actions = actionsOf(text, onRetry);
  // 流式中的回复不给动作（Pi Web 同款：isStreaming → null）；容器据此整体抑制
  const suppressed = role === "assistant" && busy;
  const hover = { onMouseEnter: () => setHovered(true), onMouseLeave: () => setHovered(false) };
  const bar = <MessageActionBar side={role} actions={actions} hovered={hovered} suppressed={suppressed} />;

  /**
   * 头部：**头像 · 名字 · 时间**（Task 0015 修订，用户 2026-11-02）。
   *
   * 修的是什么：原来用户侧用 `flex-row-reverse` 让"头像在右"，但 DOM 顺序是
   * `头像 → 名字 → 时间`，反转后**视觉上变成 `时间 名字 头像`** —— 用户看到的是
   * "14:51 Xu Later 头像"，读起来是"时间在前、头像在后"，反了。
   *
   * 现在的做法：**容器靠右对齐，但内部顺序不反转**（`justify-end` 而不是 `flex-row-reverse`），
   * 所以两边看到的都是 `头像 · 名字 · 时间`。分侧由**整块靠左/靠右**表达，不由内部顺序表达。
   */
  const headerRight = role === "user" && align === "end";
  const header = avatar !== undefined || authorName !== undefined ? (
    <div data-testid="message-header"
      className={`flex min-w-0 items-center gap-1.5 text-micro text-ink-500 ${headerRight ? "justify-end" : ""}`}>
      {avatar}
      {authorName !== undefined && <span className="min-w-0 truncate font-medium text-ink-700">{authorName}</span>}
      {at !== undefined && <span className="shrink-0 tabular-nums text-ink-500">{formatClock(at)}</span>}
    </div>
  ) : null;

  if (role === "user") {
    // 用户消息原来只渲染文字气泡，图片块被整段忽略：发出去的图在界面上不存在（本轮修复）
    const images = blocks.filter((block): block is Extract<Block, { type: "image" }> => block.type === "image");
    return (
      <div className={`flex flex-col gap-1 ${align === "end" ? "items-end" : "items-start"}`}
        data-testid="message" data-role="user" data-message-id={messageId} {...hover}>
        {header}
        {text !== "" && (
          /* text-content：让气泡自己的字号与正文同行（`.md-body` 也是 --text-content）。
             `--container-bubble` 的 56ch 按**本元素字号**算；不加这条就按继承的 16px 算，
             字号滑块放大时气泡上限不跟着涨（2026-11-02 实测：200% 时正文 30px、上限仍 564px）。 */
          <div className="max-w-bubble text-content rounded-bubble rounded-br-md bg-message-user px-4 py-2.5 text-white" data-testid="message-text" data-message-kind="user">
            <Markdown text={text} inverse />
          </div>
        )}
        {images.length > 0 && (
          <div className="flex max-w-bubble flex-wrap justify-end gap-2">
            {images.map((image, index) => <ImageBlockView key={index} block={image} />)}
          </div>
        )}
        {bar}
      </div>
    );
  }

  // 过程折叠：分两组块——进过程区的、留在外面的最终正文
  const inside = (index: number): boolean =>
    process !== undefined && !process.textIndexes.includes(index);
  const blockAnnotationsOf = (index: number): readonly Annotation[] =>
    annotationsOfBlock === undefined ? [] : annotationsOfBlock(index);
  const renderBlock = (block: Block, index: number, keyScope: string) => (
    <BlockView key={`${keyScope}-${index}`} block={block} blockIndex={index} messageId={messageId}
      blockAnnotations={blockAnnotationsOf(index)} blockActions={annotationActions} {...(onOpenPeer !== undefined ? { onOpenPeer } : {})}
      live={block.type === "thinking" ? block.live === true : block.type === "toolCall" ? block.running === true : busy}
      forceOpen={failure !== undefined} />
  );

  return (
    <div className="flex flex-col gap-2" data-testid="message" data-role="assistant" data-message-kind="assistant" data-message-id={messageId} data-process={process === undefined ? undefined : "folded"} {...hover}>
      {header}
      {process !== undefined ? (
        <>
          {process.stats.tools > 0 || process.stats.thinking > 0 ? (
            <ProcessBar stats={process.stats} live={process.live}>
              {blocks.map((block, index) => inside(index) ? renderBlock(block, index, "p") : null)}
            </ProcessBar>
          ) : null}
          {/* 最终正文：留在外面，一眼可读（多段时按原顺序拼接展示） */}
          {blocks.map((block, index) => inside(index) ? null : renderBlock(block, index, "t"))}
        </>
      ) : (
        blocks.map((block, index) => renderBlock(block, index, "t"))
      )}
      {(failure !== undefined || error !== undefined) && (
        <div data-testid="failure-reason" data-message-kind="failure" className="rounded-panel bg-message-failure px-3 py-2">
          <p className="text-meta text-danger">
            {failureLabel(failure)}
            {at !== undefined && <span className="ml-2 font-normal tabular-nums text-ink-500">{formatClock(at)}</span>}
            {historical === true && <span className="ml-2 font-normal text-ink-500">历史记录</span>}
          </p>
          {error !== undefined && <p className="text-micro text-ink-500">{error}</p>}
        </div>
      )}
      {bar}
    </div>
  );
}

/**
 * 流式期自动展开；用户手动点过之后不再强扭。
 * `closeOnEnd`：思考块跑完要收起（否则一屏思考噪音），工具块跑完**不收起**（结果要让人看见）。
 */
function useAutoOpen(live: boolean, closeOnEnd: boolean, initialOpen = live): [boolean, () => void] {
  const [open, setOpen] = useState(initialOpen || live);
  const touched = useRef(false);
  useEffect(() => {
    if (touched.current) return;
    if (live) setOpen(true);
    else if (closeOnEnd) setOpen(false);
  }, [live, closeOnEnd]);
  const toggle = () => { touched.current = true; setOpen((value) => !value); };
  return [open, toggle];
}

function ThinkingBlock({ text, live, forceOpen = false }: { text: string; live: boolean; forceOpen?: boolean }) {
  // 失败轮次：默认展开并保持展开（不回收到"思考过程"一行），否则用户看不到它做过什么
  const [open, toggle] = useAutoOpen(live, !forceOpen, forceOpen);
  return (
    <div className="overflow-hidden rounded-panel bg-message-thinking" data-message-kind="thinking">
      <button type="button" onClick={toggle}
        className="flex w-full items-center gap-1.5 px-3 py-2 text-left text-meta text-ink-500 transition-colors hover:text-ink-900 max-sm:min-h-11">
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

function ToolCallBlock({ block, live, onOpenPeer }: { block: Extract<Block, { type: "toolCall" }>; live: boolean; onOpenPeer?: (target: { agentId: string; sessionId: string; agentName: string }) => void }) {
  // 工具状态优先看 tool_execution_start/end 维护的 running；旧历史块没有该字段时才回落到段/轮 live。
  const state = toolState({ hasResult: block.result !== undefined, ...(block.isError !== undefined ? { isError: block.isError } : {}), live: block.running === true || (block.running === undefined && live) });
  const running = state === "running";
  const [open, toggle] = useAutoOpen(running, false);
  const preview = argPreview(block.name, block.arguments);
  const tone = state === "error" ? "text-danger" : state === "done" ? "text-success" : "text-ink-700";
  const status = state === "error" ? "出错" : state === "done" ? "完成" : state === "running" ? "执行中" : "未完成";
  // 与其他 Agent 对话（Task 0013）：这类工具会产生一条**对方的会话**，用户要能一眼分辨并点进去。
  const peerTarget = block.name === "lifeos_ask" || block.name === "lifeos_send"
    ? (typeof (block.arguments as Record<string, unknown> | undefined)?.agent === "string"
      ? String((block.arguments as Record<string, unknown>).agent) : undefined)
    : undefined;
  // 对端会话 id：工具结果文本里带 "session <uuid>"（lifeos_ask / lifeos_send 都返回它）。
  const peerSessionId = peerTarget === undefined
    ? undefined
    : /session ([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/.exec(String(block.result ?? ""))?.[1];
  const canOpenPeer = peerTarget !== undefined && peerSessionId !== undefined && onOpenPeer !== undefined;
  const seconds = running ? undefined : block.durationMs !== undefined ? `${(block.durationMs / 1000).toFixed(1)}s` : undefined;
  const surface = state === "error" ? "bg-message-tool-error" : state === "done" ? "bg-message-tool-done" : "bg-message-tool";
  return (
    <div className={`overflow-hidden rounded-panel ring-1 ring-line ${surface}`} data-message-kind={`tool-${state}`}>
      <button type="button" onClick={toggle}
        className="flex w-full items-center gap-1.5 px-3 py-2 text-left text-meta text-ink-700 transition-colors hover:bg-hover max-sm:min-h-11">
        {running ? <Spinner size={12} className="text-accent" /> : <IconTool size={14} className="shrink-0 text-ink-300" />}
        <span className="shrink-0 font-medium">{peerTarget === undefined ? block.name : "与 Agent 对话"}</span>
        {peerTarget !== undefined && (
          <span className="shrink-0 rounded-full bg-sunken px-1.5 py-0.5 font-mono text-micro text-ink-700"
            data-testid="peer-agent">{peerTarget}</span>
        )}
        {preview !== "" && <span className="min-w-0 flex-1 truncate font-mono text-micro text-ink-700">{preview}</span>}
        <span className={`ml-auto shrink-0 text-micro ${tone}`}
          {...(state === "missing" ? { title: "这一轮已结束，但没有拿到工具结果（可能被中断）" } : {})}>{status}</span>
        {seconds !== undefined && <span className="shrink-0 tabular-nums text-micro text-ink-700">{seconds}</span>}
        {canOpenPeer && (
          // 与其他 Agent 的对话：详情入口常显——它不在"展开"里，否则用户根本不知道有这个入口
          <span role="button" tabIndex={0} data-testid="open-peer"
            onClick={(event) => {
              event.stopPropagation();
              onOpenPeer({ agentId: peerTarget!, sessionId: peerSessionId!, agentName: peerTarget! });
            }}
            onKeyDown={(event) => {
              if (event.key !== "Enter" && event.key !== " ") return;
              event.stopPropagation();
              onOpenPeer({ agentId: peerTarget!, sessionId: peerSessionId!, agentName: peerTarget! });
            }}
            className="ml-1 shrink-0 rounded border border-line px-1.5 py-0.5 text-micro text-accent hover:bg-hover">
            查看对话过程
          </span>
        )}
      </button>
      {open && (
        <>
          <pre className="overflow-x-auto whitespace-pre-wrap border-t border-line px-3 py-2 font-mono text-micro leading-relaxed text-ink-700">{JSON.stringify(block.arguments ?? {}, null, 2)}</pre>
          {block.result !== undefined && (
            <pre className="max-h-40 overflow-y-auto whitespace-pre-wrap border-t border-line bg-sunken px-3 py-2 font-mono text-micro leading-relaxed text-ink-700">{block.result}{block.truncated === true ? "\n…（界面只显示前 8KB，完整结果见会话文件）" : ""}</pre>
          )}
        </>
      )}
      {block.images !== undefined && block.images.length > 0 && (
        // 工具读到的图片（Pi 的 read）：不受收起状态控制（Task 0002 2026-10-26 用户拍板 a）。
        // 图片是一等输出，存在就要看得见；不能躲在需要点击才展开的容器里。
        <div className="flex flex-wrap gap-2 border-t border-line bg-sunken px-3 py-2" data-testid="tool-image">
          {block.images.map((image, index) => (
            <ImageTrigger key={index} src={`data:${image.mimeType};base64,${image.data}`}
              alt={`工具读到的图片 ${index + 1}`} testId="tool-image-trigger">
              <img src={`data:${image.mimeType};base64,${image.data}`} alt={`工具读到的图片 ${index + 1}`}
                data-shot-mask="tool-image"
                className="max-h-48 max-w-full rounded border border-line object-contain" />
            </ImageTrigger>
          ))}
        </div>
      )}
    </div>
  );
}

function ImageBlockView({ block }: { block: Extract<Block, { type: "image" }> }) {
  // 用户发的图：缩略图一屏可见；点击 = 页面内浮层放大（不新开页面，用户 2026-10-27 指定）
  return (
    <ImageTrigger src={`data:${block.mimeType};base64,${block.data}`} alt="用户发送的图片"
      testId="message-image" className="mt-1 inline-block">
      <img src={`data:${block.mimeType};base64,${block.data}`} alt="用户发送的图片"
        data-shot-mask="message-image"
        className="max-h-64 max-w-full rounded border border-line object-contain" />
    </ImageTrigger>
  );
}

/**
 * 带批注的文本块（Task 0003 · P2）。
 *
 * 职责边界很窄：把 Markdown 渲染出来，然后
 *  1. 按批注偏移**上色**（CSS Highlight API，不改 DOM）；
 *  2. 鼠标移到高亮上 → 浮出批注框；移开 → 收起。
 *
 * **无批注时行为与原来完全一致**：不加 DOM 节点、不挂监听、不产生副作用。
 * 上色必须每次渲染后重跑：整块重渲染会让旧 Range 失效（P1 实测）。
 */
type AnnotatedTextBlockProps = {
  text: string;
  blockIndex?: number;
  messageId?: string;
  annotations: readonly Annotation[];
  /** 批注操作（P3）。不传 = 只读展示（历史时间线等场景）。 */
  actions?: AnnotationActions;
};

/** 批注的可写操作集合；由 App 用 store 组装。 */
export type AnnotationActions = {
  add: (anchor: { messageId: string; blockIndex: number; start: number; end: number; quote: string }, marks: readonly string[], note: string) => string;
  setMarks: (id: string, marks: readonly string[]) => void;
  setNote: (id: string, note: string) => void;
  setMode: (id: string, mode: Annotation["ui"]["mode"]) => void;
  togglePinned: (id: string) => void;
  setOffset: (id: string, dx: number, dy: number) => void;
  remove: (id: string) => void;
  /** 点开一个批注（悬停已打开的那个，也用于从表格定位）。 */
  open: (id: string) => void;
};

/**
 * 带批注的文本块（Task 0003 · P2 显示 + P3 编辑）。
 *
 * 三件事：
 *  1. 按偏移**上色**（CSS Highlight API，不改 DOM）；
 *  2. 鼠标移到高亮上 → 浮出批注框（可编辑）；移开 → 收起；
 *  3. 拖选文字 → 浮出 draft 编辑框。
 *
 * **无批注且无 actions 时行为与改造前完全一致**（不加节点、不挂监听）。
 * 上色必须每次渲染后重跑：整块重渲染会让旧 Range 失效（P1 实测）。
 */
function AnnotatedTextBlock({ text, blockIndex, messageId, annotations, actions }: AnnotatedTextBlockProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const indexRef = useRef<BlockIndex | null>(null);
  const [hostRect, setHostRect] = useState<DOMRect | null>(null);
  /**
   * 当前展开的批注框（**可以有多个**）。
   * 2026-11-03 用户反馈"钉两个就不行"：根因这里是单个 string，
   * 开第二个就把第一个顶掉了。钉住的尤其要能并存。
   */
  const [openIds, setOpenIds] = useState<readonly string[]>([]);
  const openIdsRef = useRef(openIds);
  openIdsRef.current = openIds;
  const isOpen = (id: string) => openIds.includes(id);
  const openOne = (id: string) => setOpenIds((list) => (list.includes(id) ? list : [...list, id]));
  const closeOne = (id: string) => setOpenIds((list) => list.filter((x) => x !== id));
  const [draft, setDraft] = useState<{ start: number; end: number; quote: string; rects: readonly DOMRect[] } | null>(null);
  const hideTimer = useRef<number | undefined>(undefined);
  // 拖动中 / 框内 / 编辑中：都不许触发"移开就收起"
  const holdRef = useRef({ dragging: false, inBox: false });
  // scheduleHide 在定时器/事件里执行，闭包可能拿到旧的 annotations，用 ref 取最新
  const annotationsRef = useRef(annotations);
  annotationsRef.current = annotations;

  const clearHideTimer = () => {
    if (hideTimer.current !== undefined) { window.clearTimeout(hideTimer.current); hideTimer.current = undefined; }
  };

  // 上色：每次渲染后重算 Range
  useLayoutEffect(() => {
    const host = hostRef.current;
    if (host === null) return;
    const index = buildIndex(host);
    indexRef.current = index;
    paintAnnotations(index, annotations);
  }, [text, annotations]);

  useEffect(() => () => { clearHideTimer(); }, []);

  // 窗口尺寸/滚动变化：重算宿主矩形（浮框位置依赖它）
  useEffect(() => {
    if (openIds.length === 0 && draft === null) return;
    const refresh = () => {
      const host = hostRef.current;
      if (host !== null) setHostRect(host.getBoundingClientRect());
    };
    refresh();
    window.addEventListener("resize", refresh);
    window.addEventListener("scroll", refresh, true);
    return () => {
      window.removeEventListener("resize", refresh);
      window.removeEventListener("scroll", refresh, true);
    };
  }, [openIds, draft]);

  const rectsFor = useCallback((start: number, end: number): readonly DOMRect[] => {
    const index = indexRef.current;
    if (index === null) return [];
    const range = toRange(index, start, end);
    return range === null ? [] : [...range.getClientRects()];
  }, []);

  const openCard = useCallback((id: string) => {
    clearHideTimer();
    setDraft(null);
    openOne(id);
  }, []);

  const scheduleHide = useCallback(() => {
    if (holdRef.current.dragging || holdRef.current.inBox) return;
    clearHideTimer();
    hideTimer.current = window.setTimeout(() => {
      // 只收起**未钉住**的框；钉住的一个都不动（"钉"的唯一职责）
      setOpenIds((list) => list.filter((id) => {
        const anno = annotationsRef.current.find((a) => a.id === id);
        return anno?.ui.pinned === true;
      }));
    }, 220);
  }, []);

  /**
   * 统一用 document 级 mousemove 判定"鼠标在不在框里"。
   *
   * 为什么不用 mouseleave：拖动时鼠标会划出框，leave 会在拖动中途送到，
   * 结果是"拖一下就消失"（实测踩了三次）。move 事件带坐标，判断的是**当下**的事实。
   */
  useEffect(() => {
    if (openIds.length === 0 && draft === null) return;
    const onDocMove = (event: MouseEvent) => {
      const wrap = wrapRef.current;
      if (wrap === null) return;
      const target = event.target as HTMLElement | null;
      const inCard = target?.closest("[data-testid='annotation-card']") !== null
        || target?.closest("[data-testid='annotation-draft']") !== null;
      if (inCard) { holdRef.current.inBox = true; clearHideTimer(); return; }
      // 不在框里：如果正在拖或按住，保持；否则按常规收起
      if (holdRef.current.dragging) return;
      holdRef.current.inBox = false;
      scheduleHide();
    };
    document.addEventListener("mousemove", onDocMove, true);
    return () => document.removeEventListener("mousemove", onDocMove, true);
  }, [openIds, draft, scheduleHide]);

  /** 鼠标在高亮上：找出命中的批注并打开它。 */
  const onMove = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    const index = indexRef.current;
    const host = hostRef.current;
    if (index === null || host === null || annotations.length === 0) return;
    // 拖选中 / 框内：不响应
    const selection = window.getSelection();
    if (selection !== null && !selection.isCollapsed) return;
    if ((event.target as HTMLElement).closest("[data-testid='annotation-card']") !== null) { clearHideTimer(); return; }

    const hit = annotationsAt(index, annotations, { x: event.clientX, y: event.clientY });
    if (hit.length === 0) { scheduleHide(); return; }
    const top = [...hit].reverse().find((anno) => anno.ui.pinned) ?? hit[hit.length - 1];
    if (top === undefined) return;
    clearHideTimer();
    setHostRect(host.getBoundingClientRect());
    openOne(top.id);
  }, [annotations, scheduleHide]);

  /** 拖选 → 浮出 draft。 */
  const onUp = useCallback(() => {
    if (actions === undefined || messageId === undefined || blockIndex === undefined) return;
    const host = hostRef.current;
    const index = indexRef.current;
    if (host === null || index === null) return;
    const selection = window.getSelection();
    if (selection === null || selection.isCollapsed || selection.rangeCount === 0) return;
    const range = selection.getRangeAt(0);
    if (!host.contains(range.commonAncestorContainer)) return;

    const { start, end } = toOffset(index, range);
    if (start < 0 || end <= start) return;
    // quote 取自扁平串（不是 selection.toString()：跨表格单元格时浏览器用 \t）
    const quote = quoteOf(index, start, end);
    if (quote === "") return;

    const rects = rectsFor(start, end);
    clearHideTimer();
    // 进入编辑态：只收未钉住的框（钉住的保持）
    setOpenIds((list) => list.filter((id) => annotationsRef.current.find((a) => a.id === id)?.ui.pinned === true));
    setHostRect(host.getBoundingClientRect());
    setDraft({ start, end, quote, rects });
    selection.removeAllRanges();
  }, [actions, messageId, blockIndex, rectsFor]);

  const commitDraft = useCallback((marks: readonly string[], note: string) => {
    if (actions === undefined || messageId === undefined || blockIndex === undefined || draft === null) return;
    const id = actions.add({ messageId, blockIndex, start: draft.start, end: draft.end, quote: draft.quote }, marks, note);
    setDraft(null);
    // 确认后立刻展开刚建的这条（用户要能马上看到并可继续改）
    if (id !== undefined) openOne(id);
  }, [actions, messageId, blockIndex, draft]);

  // 卡片被"关闭"或已删除时，本地 openIds 要跟着清掉（store 是唯一事实源）
  useEffect(() => {
    if (openIds.length === 0) return;
    const keep = openIds.filter((id) => {
      const still = annotations.find((anno) => anno.id === id);
      return still !== undefined && still.ui.mode !== "hidden";
    });
    if (keep.length !== openIds.length) setOpenIds(keep);
  }, [annotations, openIds]);

  // 要渲染的卡片：openIds ∩ 现有批注（顺序按批注自身顺序，避免每帧抖动）
  const openedList = annotations.filter((anno) => openIds.includes(anno.id));

  return (
    <div className="relative" ref={wrapRef}>
      <div ref={hostRef} data-testid="message-text" data-block-index={blockIndex}
        onMouseMove={annotations.length > 0 ? onMove : undefined}
        onMouseLeave={annotations.length > 0 ? scheduleHide : undefined}
        onMouseUp={actions !== undefined ? onUp : undefined}>
        <Markdown text={text} />
      </div>

      {/* 虚线指引：每个展开的框各一条 */}
      {openedList.map((anno) => {
        const rects = rectsFor(anno.start, anno.end);
        if (rects.length === 0 || hostRect === null) return null;
        return (
          <Connector
            key={`conn-${anno.id}`}
            rects={rects}
            hostRect={hostRect}
            cardId={anno.id}
            tone={markById(anno.marks[0] ?? "")?.tone}
            wrapRef={wrapRef}
          />
        );
      })}

      {/* 批注卡片（可以有多个同时展开） */}
      {hostRect !== null && openedList.map((anno, index) => {
        const rects = rectsFor(anno.start, anno.end);
        if (rects.length === 0) return null;
        // 按渲染顺序：前面的框已经占位，本条要往下错开（否则同一段上的两条会完全叠住）
        const occupied = openedList.slice(0, index).map((prev) => {
          const el = wrapRef.current?.querySelector(`[data-testid="annotation-card"][data-anno="${prev.id}"]`);
          if (el === null || el === undefined) return null;
          const r = el.getBoundingClientRect();
          const w = wrapRef.current?.getBoundingClientRect();
          if (w === undefined) return null;
          return { left: r.left - w.left, top: r.top - w.top, width: r.width, height: r.height };
        }).filter((x): x is { left: number; top: number; width: number; height: number } => x !== null);

        return (
          <AnnotationCard
            key={anno.id}
            annotation={anno}
            rects={rects}
            hostRect={hostRect}
            hostHeight={hostRect.height}
            occupied={occupied}
            onChangeMarks={(marks) => actions?.setMarks(anno.id, marks)}
            onChangeNote={(note) => actions?.setNote(anno.id, note)}
            onTogglePinned={() => {
              const willPin = !anno.ui.pinned;
              actions?.togglePinned(anno.id);
              if (willPin) clearHideTimer();
            }}
            onDragStart={() => { holdRef.current.dragging = true; clearHideTimer(); }}
            onDragMove={() => clearHideTimer()}
            onPressEnd={() => {
              clearHideTimer();
              window.setTimeout(() => { holdRef.current.dragging = false; }, 300);
            }}
            onOffsetChange={(dx, dy) => {
              actions?.setOffset(anno.id, dx, dy);
              clearHideTimer();
              window.setTimeout(() => { holdRef.current.dragging = false; }, 300);
            }}
            onClose={() => { actions?.setMode(anno.id, "hidden"); closeOne(anno.id); }}
            onRemove={() => { actions?.remove(anno.id); closeOne(anno.id); }}
            onEnter={() => { holdRef.current.inBox = true; clearHideTimer(); }}
            onLeave={() => {
              holdRef.current.inBox = false;
              scheduleHide();
            }}
          />
        );
      })}

      {/* draft 编辑框 */}
      {draft !== null && hostRect !== null && (
        <AnnotationDraft
          quote={draft.quote}
          rects={draft.rects}
          hostRect={hostRect}
          hostHeight={hostRect.height}
          onCommit={commitDraft}
          onCancel={() => setDraft(null)}
          onEnter={() => { holdRef.current.inBox = true; clearHideTimer(); }}
          onLeave={() => { holdRef.current.inBox = false; }}
        />
      )}
    </div>
  );
}

/** 从选区最靠近框的那条边的中点，画虚线到框最靠近选区的那条边。 */
function Connector({ rects, hostRect, cardId, tone, wrapRef }: {
  rects: readonly DOMRect[];
  hostRect: DOMRect;
  cardId: string;
  tone: string | undefined;
  wrapRef: React.RefObject<HTMLDivElement | null>;
}) {
  const [path, setPath] = useState<string | null>(null);

  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    if (wrap === null) return;
    const card = wrap.querySelector(`[data-testid="annotation-card"][data-anno="${cardId}"]`);
    if (!(card instanceof HTMLElement)) { setPath(null); return; }
    const wrapRect = wrap.getBoundingClientRect();
    const cardRect = card.getBoundingClientRect();

    const top = Math.min(...rects.map((r) => r.top));
    const bottom = Math.max(...rects.map((r) => r.bottom));
    const left = Math.min(...rects.map((r) => r.left));
    const right = Math.max(...rects.map((r) => r.right));

    const below = cardRect.top >= bottom - 4;
    const from = {
      x: (left + right) / 2 - wrapRect.left,
      y: (below ? bottom : top) - wrapRect.top,
    };
    const to = {
      x: Math.max(cardRect.left - wrapRect.left + 12, Math.min(cardRect.right - wrapRect.left - 12, from.x)),
      y: (below ? cardRect.top : cardRect.bottom) - wrapRect.top,
    };
    const midY = from.y + (to.y - from.y) / 2;
    setPath(`M ${from.x} ${from.y} C ${from.x} ${midY}, ${to.x} ${midY}, ${to.x} ${to.y}`);
  });

  if (path === null) return null;
  return (
    <svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible" data-testid="annotation-connector" aria-hidden="true">
      <path d={path} fill="none" strokeWidth={1.3} strokeDasharray="4 3" opacity={0.75}
        style={{ stroke: tone === undefined ? "var(--color-ink-300)" : `var(--color-anno-${tone})` }} />
    </svg>
  );
}

function BlockView({ block, live, forceOpen = false, onOpenPeer, blockIndex, messageId, blockAnnotations = [], blockActions }: {
  block: Block; live: boolean; forceOpen?: boolean;
  onOpenPeer?: (target: { agentId: string; sessionId: string; agentName: string }) => void;
  /** ★ 该块在 message.blocks 里的下标（Task 0003 · P1）。
   *  批注要定位到"哪条消息的第几个 text 块"，只给 text 块（thinking/工具/图片不批）。 */
  blockIndex?: number;
  /** ★ 消息身份（Task 0003 · P1）：调试打印与后续批注挂载都用它。 */
  messageId?: string;
  /** ★ 本块的批注（Task 0003 · P2）：为空数组时行为与没有批注完全一致。 */
  blockAnnotations?: readonly Annotation[];
  /** ★ 批注操作（Task 0003 · P3）。 */
  blockActions?: AnnotationActions;
}) {
  if (block.type === "image") return <ImageBlockView block={block} />;
  if (block.type === "text") {
    if (block.text === "" && live) return null;
    return (
      <AnnotatedTextBlock text={block.text} blockIndex={blockIndex} messageId={messageId}
        annotations={blockAnnotations} actions={blockActions} />
    );
  }
  if (block.type === "thinking") return <ThinkingBlock text={block.text} live={live} forceOpen={forceOpen} />;
  return <ToolCallBlock block={block} live={live} {...(onOpenPeer !== undefined ? { onOpenPeer } : {})} />;
}
