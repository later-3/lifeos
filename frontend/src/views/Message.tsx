import { useEffect, useRef, useState, type ReactNode } from "react";

import { Spinner, ClickableRow } from "../design/ui";
import { ResponseBar } from "./response-bar";
import { MarkBar } from "./mark-bar";
import { formatTokens, type ProcessStats } from "../api/process-stats";
import { argPreview } from "../api/stream-blocks";
import { copyText } from "../api/clipboard";
import { copyTextOf } from "../api/message-text";
import type { Annotation } from "../api/annotations";
import { AnnotatedTextBlock, type AnnotationActions } from "./annotated-text-block";
import { Markdown } from "./message-markdown";
import { MessageActionBar } from "./message-actions";
import type { MessageAction } from "../api/action-bar";
import { failureLabel, type FailureKind } from "../api/failure-text";
import { toolState } from "../api/tool-state";
import { thinkingRequestOf, type ThinkingOrigin } from "../api/thinking-origin";
import { ImageTrigger } from "../design/image-viewer";
import { AppIcon } from "../design/icons";

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

/*
 * 为什么 `MessageView` **没有**加 `memo`（Task 0016 · P4-S3 实测结论，别再加了）：
 *
 * 加了 memo 之后用 `areEqual` 探针数"每敲一个字符，哪些 props 变了"，结果：
 *
 *   annotationsOfBlock : 50/50 条   ← 每帧都是新的闭包（`(blockIndex) => anno.ofBlock(id, blockIndex)`）
 *   avatar             : 50/50 条   ← `avatarNode` 是渲染期算出的 JSX，每次渲染都是新元素
 *   responseBar        : 45/50 条   ← 每个 assistant 消息一个 object literal
 *
 * 三条里有两条**不该**为了 memo 去强行稳定：`avatar` 是 JSX 元素（把它 useMemo 起来只是把
 * 成本从子组件搬到父组件），`responseBar` 依赖循环内的 index（硬记比按引用重算更易错）。
 * 而 memo 若某条消息的 props 恰好全等，它就会**停止更新**——这在流式/批注场景是错的。
 *
 * 真正解决"一次按键重渲染整棵树"的是 **P4-S2 的窗口**（322 → 50 条）：
 * 实测 322 条 73 ms → 50 条 25–33 ms，与短会话同一档。
 * 后续若要再往下压，方向是"把输入框 state 从 App 拆出去"（todo #1），不是给消息加 memo。
 */

/**
 * 取一段思考正文（P8 / B2）。由 App 注入：它知道 agentId/sessionId，而消息层只认"原点"。
 * 返回值是正文；抛错由组件转成可见的失败提示（不静默）。
 *
 * **入参是一个原点**（Task 0028 · P1）：`entryId` 与 `blockIndex` 必须属于同一条 entry。
 * 拆成两个独立入参曾导致 96–99% 的错配（0027 · R4）—— 类型上让"不同源"无法表达。
 */
export type ThinkingLoader = (origin: ThinkingOrigin) => Promise<string>;

export type Block =
  /**
   * 压缩卡（Task 0016 · P7-S9）：Pi 把早期历史压成一段摘要，这块就是那张卡。
   * 后端 `messagesOf()` 把投影里的 `compactionSummary` 消息投影成它。
   */
  | { type: "compaction"; summary: string; tokensBefore: number }
  | { type: "text"; text: string }
  /**
   * 图片块（Task 0016 · P3-S1）：`url` = 按需取回，`data` = 老会话内联。
   * 两者必有其一；渲染统一走 `imageSrcOf()`。
   */
  | { type: "image"; url?: string; data?: string; mimeType: string }
  /**
   * 思考块。`deferred` = 后端没有下发正文（P8 / B2：200 条窗口里 thinking 占 68% 字节），
   * 第一次展开才按**原点**（`entryId` + 该 entry 内的真实下标）取回（loader 由 App 注入，见 `blockOrigins`）。
   *
   * Task 0028 · P1：原点必须与块一起传进来。以前是"本条的 messageId + 本块 index"，
   * 而过程折叠时渲染的是**整轮合并块** —— 两个坐标系不同源，错配率实测 96–99%（0027 · R4）。
   */
  | { type: "thinking"; text: string; deferred?: true; /** 仅客户端流式段：思考是否仍在该段内进行 */ live?: boolean }
  | {
      type: "toolCall"; id?: string; name: string; arguments?: unknown;
      result?: string; isError?: boolean; truncated?: boolean; durationMs?: number;
      /** 工具结果的产生时刻（ms，= Pi `toolResult.timestamp`）：墙钟耗时的终点（Task 0015 · P4） */
      resultAt?: number;
      /** 工具读到的图片（Pi 的 read）：与 result 文字并列展示。`url` 按需取 / `data` 老会话内联。 */
      images?: Array<{ url?: string; data?: string; mimeType: string }>;
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
  /**
   * Pi 的回合终态（Task 0007）：`done` / `lost` 的唯一判据输入，后端 `messagesOf()` 原样透出。
   * 前端只把它交给 `turnOutcomeOf()`（`src/turn-state.ts`），不再用"文本是否为空"猜。
   */
  stopReason?: string;
};

/** 本条消息要注册进动作条的动作：功能只描述"做什么"，对齐/间距/可见性/反馈由容器决定。 */
function actionsOf(text: string, onRetry: (() => void) | undefined): MessageAction[] {
  const actions: MessageAction[] = [];
  if (text !== "") {
    actions.push({
      key: "copy", label: "复制", icon: <AppIcon name="copy" size={12} />, title: "复制这条消息",
      testId: "copy-message", doneLabel: "已复制", failedLabel: "复制失败",
      run: () => copyText(text),
    });
  }
  if (onRetry !== undefined) {
    actions.push({
      key: "resend", label: "重新发送", icon: <AppIcon name="refresh" size={12} />, title: "重新发送这一轮",
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

export function MessageView({ role, blocks, busy, error, failure, align = "end", onRetry, at, historical, retriedTimes, fixHintText, onOpenPeer, avatar, authorName, process, messageId, loadThinking, blockOrigins, annotationsOfBlock, annotationActions, responseBar, markBar, draftRequest = null, onDraftHandled }: {  role: "user" | "assistant"; blocks: Block[]; busy: boolean; error?: string; failure?: FailureKind;
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
  /**
   * 失败前 Pi 自动重试了几次（Task 0007 · A1）。
   * Pi CLI 的同一句话是 `Retry failed after N attempts: <原因>`（interactive-mode.ts:3768）——
   * 不说这句，用户只看到"超时了"，不知道系统已经自动试过 N 次，于是误以为该自己点重试。
   */
  retriedTimes?: number;
  /**
   * 不可重试错误的出口（Task 0007）：auth/quota/payload_too_large 三类的"下一步做什么"。
   * 这三类不给「重新发送」（Pi 自己都不重试它们），所以必须给一条可执行的出路，
   * 否则用户面对的就是"失败了、没按钮、不知道怎么办"。
   */
  fixHintText?: string;
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
  /** ★ 取思考正文（P8 / B2）：只有 `deferred` 的思考块会用到；不传就永远不取（历史时间线等）。 */
  loadThinking?: ThinkingLoader;
  /**
   * ★ 每个块的原点（Task 0028 · P1）：与 `blocks` **一一对应**。
   *
   * 传了就用它取思考正文；不传则退回"本条 messageId + 本块下标"（未折叠时坐标系统一，是等价的）。
   * 折叠时**必须**传：那时 `blocks` 是整轮合并块，下标已不属于本条消息。
   */
  blockOrigins?: readonly (ThinkingOrigin | undefined)[];
  /** ★ 取某块的批注（Task 0003 · P2）。不传 = 这条消息没有批注，行为与改造前完全一致。 */
  annotationsOfBlock?: (blockIndex: number) => readonly Annotation[];
  /** ★ 批注操作（Task 0003 · P3）。不传 = 只读（历史时间线等）。 */
  annotationActions?: AnnotationActions;
  /** 外部触发的批注草稿（Task 0018）：功能条「批注」按 messageId 路由进来（0018 的 id 才非 null）。 */
  draftRequest?: { messageId: string; nonce: number } | null;
  onDraftHandled?: () => void;
  /**
   * ResponseBar 的数据（Task 0008 · P3；Task 0015 · P5 收窄）：undefined = 不渲染。
   *
   * **动态状态（第几步/阶段/秒数/重试）不在这里**——用户 2026-11-07 拍板统一到 `SessionBar`，
   * 这里只留：等待过渡、过程统计、回合结论文案。
   */
  responseBar?: {
    stats?: import("../api/process-stats").ProcessStats;
    live?: boolean;
    waiting?: boolean;
    status?: { text: string };
  } | undefined;
  /** MarkBar 的数据与动作（Task 0008 · P2）：undefined = 不渲染（无批注/peer 会话）。 */
  markBar?: {
    annotations: readonly Annotation[];
    messageOrder: readonly string[];
    onRowClick: (id: string) => void;
    pinnedOf: (id: string) => boolean;
    onRemove: (id: string) => void;
    onRemoveAll: () => void;
  } | undefined;
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
      /**
       * `select-none`（Task 0013）：消息头是界面件，不是对话内容。
       * 不加的话，从消息头往下拖选会把「c / coder / 09:51」一起复制进去（实测：
       * 得到 "c\ncoder\n09:51\n\n36 次工具 · 8 分 44 秒 · …\n查看过程\n<正文>"）。
       * 用户 2026-11-07 拍板：对话区域里的文字都要能复制，但界面文案不该混进剪贴板。
       */
      className={`flex min-w-0 select-none items-center gap-1.5 text-micro text-ink-500 ${headerRight ? "justify-end" : ""}`}>
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
      {...(loadThinking !== undefined ? { loadThinking } : {})}
      /* 原点优先（Task 0028 · P1）：折叠时 blocks 是整轮合并块，下标已不属于本条 messageId；
         没给原点（未折叠）时 BlockView 才退回"本条 id + 本块下标"，那时两者本来就同源。 */
      {...(blockOrigins?.[index] !== undefined ? { blockOrigin: blockOrigins[index] } : {})}
      blockAnnotations={blockAnnotationsOf(index)} blockActions={annotationActions}
      draftRequest={draftRequest !== null && draftRequest.messageId === messageId ? draftRequest : null}
      {...(onDraftHandled !== undefined ? { onDraftHandled } : {})}
      {...(onOpenPeer !== undefined ? { onOpenPeer } : {})}
      /* 轮级 live（Task 0018 · T2）：思考卡只在**整轮结束**时收起。
         `process.live` 是轮级（App 传的 replyLive），`busy` 是这条消息段级——
         折叠视图下容器可能挂着第一段（已结束）而后续段仍在跑，所以取轮级优先。 */
      turnLive={process?.live ?? busy}
      live={block.type === "thinking" ? block.live === true : block.type === "toolCall" ? block.running === true : busy}
      forceOpen={failure !== undefined} />
  );

  return (
    <div className="flex flex-col gap-2" data-testid="message" data-role="assistant" data-message-kind="assistant" data-message-id={messageId} data-process={process === undefined ? undefined : "folded"} {...hover}>
      {header}
      {/* ResponseBar（Task 0008 · P3 修订）：在正文**上方**，与主线的过程条同位置
          （用户 2026-11-05："response bar 是在正式回复上面的，就跟我们当前的主线的页面一样"）。
          过程展开区在 bar **内部**——所以工具/思考跑起来时 bar 自己的位置不动（不被冲掉）。
          占位消息（刚发送、还没有任何块）也渲染：与头像同时出现，等待态呼吸。 */}
      {responseBar !== undefined && (
        <ResponseBar
          {...(process?.stats !== undefined ? { stats: process.stats } : {})}
          live={process?.live ?? false}
          {...(busy && blocks.length === 0 ? { waiting: true } : {})}
          {...responseBar}
        >
          {process !== undefined
            ? blocks.map((block, index) => inside(index) ? renderBlock(block, index, "p") : null)
            : null}
        </ResponseBar>
      )}
      {process !== undefined ? (
        /* 最终正文与"中间过渡语"：留在过程条外面，一眼可读（多段时按原顺序拼接展示） */
        blocks.map((block, index) => inside(index) ? null : renderBlock(block, index, "t"))
      ) : (
        blocks.map((block, index) => renderBlock(block, index, "t"))
      )}
      {/* MarkBar（Task 0008 · P2）：挂在**被批注的那条消息**底部（用户定案：
          "标注信息 bar 是放到被批注的那个信息上的"）。无批注时 MarkBar 自身返回 null。 */}
      {role === "assistant" && messageId !== undefined && markBar !== undefined && (
        <MarkBar annotations={markBar.annotations} messageOrder={markBar.messageOrder}
          messageId={messageId} onRowClick={markBar.onRowClick} pinnedOf={markBar.pinnedOf}
          onRemove={markBar.onRemove} onRemoveAll={markBar.onRemoveAll} />
      )}
      {(failure !== undefined || error !== undefined) && (
        <div data-testid="failure-reason" data-message-kind="failure" className="rounded-panel bg-danger-soft px-3 py-2">
          <p className="text-meta text-danger">
            {failureLabel(failure)}
            {/* Pi CLI 同款信息（interactive-mode.ts:3768 `Retry failed after N attempts`）：
                告诉用户"已经自动试过 N 次"，否则他只会看到"超时"，以为没人在管。 */}
            {retriedTimes !== undefined && retriedTimes > 0 && (
              <span className="ml-2 font-normal text-ink-700" data-testid="retried-times">已自动重试 {retriedTimes} 次</span>
            )}
            {at !== undefined && <span className="ml-2 font-normal tabular-nums text-ink-500">{formatClock(at)}</span>}
            {historical === true && <span className="ml-2 font-normal text-ink-500">历史记录</span>}
          </p>
          {fixHintText !== undefined && (
            <p className="mt-1 text-meta text-ink-700" data-testid="failure-fix-hint">{fixHintText}</p>
          )}
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

/**
 * 思考块（P8 / B2 支持"按需取正文"；Task 0018 · T2 定自动开合时机）。
 *
 * ## 两个时机（Task 0018 · T2 修正）
 *
 * - **展开条件**：这一段思考在流（`live`）**或**这一轮还在跑（`turnLive`）；
 * - **收起时机**：**这一轮结束**，不是这一段思考结束。
 *
 * 以前在 `thinking_end` 就收（判据只有"这一段是否在流"），代价是**一次工具型回合里
 * 每个思考段一结束就塌陷一次**：实测 12 行思考（207px）→ 34px，下方正文整体上跳 173px；
 * 一次回复 4 段就是 4 次（Task 0018 evidence/diag7、diag13）。用户看到的就是"闪屏"。
 * 同款做法（A 级）：LobeChat `Conversation/components/Thinking/index.tsx:47-49` 的判据是
 * "这条消息是否仍在生成"，不是"这个思考块是否结束"（commit 867a15a）。
 *
 * ## 按需取正文（P8 / B2）
 *
 * 正文没随会话下发时（`deferred`）**第一次展开才去取**：首屏省下 68% 的字节，
 * 而"要不要看思考"本来就是展开那一刻才决定的。取回后就地保存（父组件重渲染不重取）；
 * 失败给一行可点的重试，**不**假装"思考是空的"（错误必须可见）。
 * 参考 pi-web：`components/MessageView.tsx:889-905` 同样在展开时按 entryId 拉取并就地保存。
 */
function ThinkingBlock({ text, deferred = false, live, turnLive = live, forceOpen = false, origin, loadThinking }: {
  text: string; deferred?: boolean; live: boolean; turnLive?: boolean; forceOpen?: boolean;
  /** 这个块的原点（Task 0028 · P1）：`entryId` 与 `blockIndex` 同源；`undefined` = 无法定位（老数据/无 id）。 */
  origin?: ThinkingOrigin;
  loadThinking?: ThinkingLoader;
}) {
  // 失败轮次：默认展开并保持展开（不回收到"思考过程"一行），否则用户看不到它做过什么
  const [open, toggle] = useAutoOpen(live || turnLive, !forceOpen, forceOpen);
  /**
   * **只在按需取（deferred）时才需要自己存一份正文。**
   *
   * 非 deferred 的块（流式块、`deferThinking` 关掉的调用）正文就在 `text` 里 ——
   * 复制进 state 是错的：`useState` 只在挂载时取值，而流式块的 `text` 每来一个 delta 就变长，
   * 界面会永远停在第一个 delta 那几个字（2026-11-18 自查发现，用户报"内容一下就没了"）。
   *
   * 同款做法（A 级）：pi-web `components/MessageView.tsx:946`
   * `{loading ? … : error ?? (block.deferred ? content : block.thinking)}` ——
   * 正文直接读 block，只有 deferred 才用取回来的 `content`。
   */
  /** 只存**取回来的** deferred 正文；非 deferred 的正文直读 `text`（五个参考项目都这么做）。 */
  const [content, setContent] = useState<string | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  /** 能不能取：无原点或参数不合法就**不发请求**（否则换来一串 400/404，见 0027 · R4）。 */
  const request = thinkingRequestOf(origin);
  useEffect(() => {
    if (!deferred || !open || content !== undefined) return;
    if (failed && reloadKey === 0) return;
    if (request === undefined || loadThinking === undefined) return;
    let cancelled = false;
    void (async () => {
      try {
        const fetched = await loadThinking(request);
        if (!cancelled) { setContent(fetched); setFailed(false); }
      } catch { if (!cancelled) setFailed(true); }
    })();
    return () => { cancelled = true; };
  }, [deferred, open, content, failed, reloadKey, request?.entryId, request?.blockIndex, loadThinking]);

  /**
   * 展开后显示什么（判定顺序即契约）：
   *
   * ```
   * ① 非 deferred        → text（手里就有正文，永远不显示"取不回"）
   * ② 已有取回的正文      → content
   * ③ 取失败了            → 原因 + 重试
   * ④ 定位不到（老记录）  → 说明为什么取不回，不给注定失败的重试
   * ⑤ 其余                → 正在取
   * ```
   *
   * **① 必须在最前**：流式块没有 entryId（消息还没落盘，Pi 的 entry id 是落盘时生成的），
   * 所以它的 `request` 一定是 `undefined`。若先判 request，就会把一条**正在生成的新回复**
   * 说成「这段思考属于旧记录，取不回正文」—— 用户 2026-11-19 报的正是这件事。
   */
  const shown = deferred ? content : text;
  return (
    <div className="overflow-hidden rounded-panel bg-message-thinking" data-message-kind="thinking">
      <ClickableRow onClick={toggle}
        className="gap-1.5 px-3 py-2 text-meta text-ink-500 hover:text-ink-900">
        {live ? <Spinner size={12} className="text-accent" /> : null}
        <span>{live ? "思考中…" : "思考过程"}</span>
        <span className="ml-auto shrink-0 text-micro text-ink-500">{open ? "收起" : "展开"}</span>
      </ClickableRow>
      {/*
        * 思考过程与正文**同一 Markdown 渲染**（2026-11-10，用户截图发现 `**粗体**` 原样显示）。
        * 四家参考一致（全部源码可核，见 cases/2026-11-10.md）：
        * - Pi TUI 本体：`new Markdown(thinkingBlocks.join("\n\n"), …)`（斜体 + 专用色），
        *   `packages/coding-agent/src/modes/interactive/components/assistant-message.ts:145-160`（commit 90d863f）；
        * - LobeChat：`Thinking/index.tsx:70-82` 直接 `<MarkdownMessage>`（与正文同渲染器，commit 867a15a）；
        * - opencode：`share/part.tsx:151-163` `ContentMarkdown`（正文同函数，commit 6a89e9f）；
        * - open-webui：`ContentRenderer.svelte:352-368` 注释明言 structural blocks through Markdown（commit c38885a）。
        * 相比旧版的 `text-meta`（12px），这里用 `md-body--compact`（13.5/1.65）：思考与正文的
        * **渲染器一致、字级小一档**，靠 `text-ink-700` 弱化层次（Pi 用斜体处理同一件事）。
        */}
      {open && (
        <div className="border-t border-line px-3 py-2 text-ink-700">
          {shown !== undefined ? (
            /* `streaming` 传给 Markdown（Task 0018）：流式期只给纯文本，整轮结束后才着色 */
            <Markdown text={shown} className="md-body--compact" streaming={live || turnLive} />
          ) : failed ? (
            /* 取不回来必须说出来并给出口（规范：错误可见、可行动），不能显示"思考是空的" */
            <div className="flex flex-wrap items-center gap-2 text-micro text-ink-500" data-testid="thinking-load-failed">
              <span>思考正文没取回来</span>
              <ClickableRow className="w-auto min-h-0 px-2 py-1 text-micro text-ink-700 underline"
                onClick={() => { setFailed(false); setReloadKey((key) => key + 1); }}>
                重试
              </ClickableRow>
            </div>
          ) : request === undefined || loadThinking === undefined ? (
            /*
             * 到这里说明：既没有正文、也没在取。
             * 两种成因**必须分开说**，否则用户会被误导：
             *  - `request === undefined`：定位不到（老记录没有 entry id）；
             *  - `loadThinking === undefined`：这个渲染位置没有接取数能力
             *    （`PeerPanel` / `SessionHistory` 复用 MessageView 但没传这个属性）——
             *    文案若照抄"旧记录"，用户就会去问"我这条是新消息啊"。
             */
            <div className="text-micro text-ink-500" data-testid="thinking-unavailable">
              {request === undefined ? "这段思考属于旧记录，取不回正文" : "这个位置不支持展开思考正文"}
            </div>
          ) : (
            /* 展开那一刻才去取：给一行"正在取"，而不是空白（空白看起来像"没有思考"） */
            <div className="flex items-center gap-1.5 text-micro text-ink-500" data-testid="thinking-loading">
              <Spinner size={12} className="text-accent" />
              <span>正在取思考正文…</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * 压缩卡（Task 0016 · P7-S9）。
 *
 * 用户 2026-11-17 的原话：「怎么感觉 session 被截断了呢？Session 历史消息看不到了」。
 * 事实是 Pi 在 17:49 自动压缩了上下文（2,970 条目 / 984,407 token → 186 条 + 一段 16.8k 字摘要），
 * 而 `messagesOf()` 读的就是**模型上下文投影** —— 压缩掉的那段在界面上不存在，也**没有任何说明**。
 *
 * 所以这里要做的不是"把历史还回来"（模型确实已经不看它了，还回去会骗人），
 * 而是**把压缩这件事说出来**：压缩前多大、摘要写了什么、原文去哪看。
 * 参考 pi-web 同位置（`components/MessageView.tsx:1352-1368`）：标题 + 说明 + 摘要正文；
 * 默认**收起**（摘要常常上万字，展开会把后面的对话顶到屏幕外）。
 *
 * 历史仍然完整可取：「完整历史」读的是原始条目（`/entries`，从 offset=0 开始），
 * 那里第一条永远是最早那条提问。所以卡片给出一条可行动的指引，而不是只说"已压缩"。
 */
export function CompactionCard({ block }: { block: Extract<Block, { type: "compaction" }> }) {
  const [open, toggle] = useAutoOpen(false, false, false);
  const size = formatTokens(block.tokensBefore);
  return (
    <div className="overflow-hidden rounded-panel bg-message-thinking" data-message-kind="compaction" data-testid="compaction-card">
      <ClickableRow onClick={toggle} className="gap-1.5 px-3 py-2 text-meta text-ink-500 hover:text-ink-900">
        <AppIcon name="history" size={12} />
        <span className="min-w-0 truncate">
          此处之前的会话历史已压缩为摘要{size === undefined ? "" : `（压缩前 ≈ ${size} tokens）`}
        </span>
        <span className="ml-auto shrink-0 text-micro text-ink-500">{open ? "收起" : "展开"}</span>
      </ClickableRow>
      {open && (
        <div className="border-t border-line px-3 py-2 text-ink-700">
          <Markdown text={block.summary} className="md-body--compact" />
          <p className="mt-2 text-micro text-ink-500">
            更早的原文没有丢：「完整历史」里可以看到压缩之前的每一条消息（含你的提问）。
          </p>
        </div>
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
      <ClickableRow onClick={toggle}
        className="gap-1.5 px-3 py-2 text-meta text-ink-700">
        {running ? <Spinner size={12} className="text-accent" /> : <AppIcon name="tool" size={14} className="shrink-0 text-ink-300" />}
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
      </ClickableRow>
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
          {block.images.map((image, index) => {
            const src = imageSrcOf(image);
            if (src === undefined) return null;
            return (
              <ImageTrigger key={index} src={src}
                alt={`工具读到的图片 ${index + 1}`} testId="tool-image-trigger"
                failureText="这张图已经不在了（原始文件被清理或移动）">
                {/* loading="lazy"：引用化之后图片是独立请求，进视口才拉——这正是 P3 的收益来源之一 */}
                <img src={src} alt={`工具读到的图片 ${index + 1}`} loading="lazy" decoding="async"
                  data-shot-mask="tool-image"
                  className="max-h-48 max-w-full rounded border border-line object-contain" />
              </ImageTrigger>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * 图片的实际 `src`（Task 0016 · P3-S1）：引用走 URL，老会话走 data URI。
 *
 * 为什么必须有这一个函数：两种形态在代码里出现 4 处（用户图、工具图、查看器、放大层），
 * 每处各写一遍 `data:${mime};base64,${data}` 就会在"引用化"之后静默渲染成
 * `data:image/png;base64,undefined`（浏览器不报错，只是空白）。
 */
function imageSrcOf(image: { url?: string; data?: string; mimeType: string }): string | undefined {
  if (image.url !== undefined && image.url !== "") return image.url;
  if (image.data !== undefined && image.data !== "") return `data:${image.mimeType};base64,${image.data}`;
  return undefined;
}

function ImageBlockView({ block }: { block: Extract<Block, { type: "image" }> }) {
  // 用户发的图：缩略图一屏可见；点击 = 页面内浮层放大（不新开页面，用户 2026-10-27 指定）
  const src = imageSrcOf(block);
  // 两种形态都认（D8 不迁移老会话）；都没有就是一个占位，不渲染空 img
  if (src === undefined) return null;
  return (
    <ImageTrigger src={src} alt="用户发送的图片"
      testId="message-image" className="mt-1 inline-block"
      failureText="这张图已经不在了（原始文件被清理或移动）">
      <img src={src} alt="用户发送的图片" loading="lazy" decoding="async"
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
function BlockView({ block, live, turnLive = false, forceOpen = false, onOpenPeer, blockIndex, messageId, loadThinking, blockOrigin, blockAnnotations = [], blockActions, draftRequest = null, onDraftHandled }: {
  block: Block; live: boolean;
  /** 这一轮是否还在跑（Task 0018 · T2）：思考卡只在**整轮结束**时收起，不在每段思考结束时收起。 */
  turnLive?: boolean;
  forceOpen?: boolean;
  onOpenPeer?: (target: { agentId: string; sessionId: string; agentName: string }) => void;
  /** ★ 该块在 message.blocks 里的下标（Task 0003 · P1）。
   *  批注要定位到"哪条消息的第几个 text 块"，只给 text 块（thinking/工具/图片不批）。 */
  blockIndex?: number;
  /** ★ 消息身份（Task 0003 · P1）：调试打印与后续批注挂载都用它。 */
  messageId?: string;
  /** ★ 取思考正文（P8 / B2）：仅 `deferred` 的思考块需要。 */
  loadThinking?: ThinkingLoader;
  /**
   * ★ 本块的原点（Task 0028 · P1）：折叠时由 `MessageView` 按 `blockOrigins[index]` 传入。
   * 不给 = 未折叠（坐标系统一，用本条 messageId + 本块下标即可）。
   */
  blockOrigin?: ThinkingOrigin;
  /** ★ 本块的批注（Task 0003 · P2）：为空数组时行为与没有批注完全一致。 */
  blockAnnotations?: readonly Annotation[];
  /** ★ 批注操作（Task 0003 · P3）。 */
  blockActions?: AnnotationActions;
  draftRequest?: { messageId: string; nonce: number } | null;
  onDraftHandled?: () => void;
}) {
  if (block.type === "compaction") return <CompactionCard block={block} />;
  if (block.type === "image") return <ImageBlockView block={block} />;
  if (block.type === "text") {
    if (block.text === "" && live) return null;
    return (
      <AnnotatedTextBlock text={block.text} blockIndex={blockIndex} messageId={messageId}
        annotations={blockAnnotations} actions={blockActions} busy={live}
        {...(turnLive ? { streaming: true } : {})}
        draftRequest={draftRequest} {...(onDraftHandled !== undefined ? { onDraftHandled } : {})} />
    );
  }
  if (block.type === "thinking") {
    /*
     * 原点优先（Task 0028 · P1）：给了 `blockOrigin` 就用它；否则退回"本条 messageId + 本块下标"。
     *
     * 退回这一支**只在未折叠时成立**（那时 blocks 就是本条消息自己的块，下标天然属于它）；
     * 折叠时 `MessageView` 一定会传 `blockOrigin`，因为那时块是整轮合并的。
     */
    const origin = blockOrigin ?? (messageId !== undefined && blockIndex !== undefined ? { entryId: messageId, blockIndex } : undefined);
    return <ThinkingBlock text={block.text} deferred={block.deferred === true} live={live} turnLive={turnLive} forceOpen={forceOpen}
      {...(origin !== undefined ? { origin } : {})}
      {...(block.deferred === true && loadThinking !== undefined ? { loadThinking } : {})} />;
  }
  return <ToolCallBlock block={block} live={live} {...(onOpenPeer !== undefined ? { onOpenPeer } : {})} />;
}
