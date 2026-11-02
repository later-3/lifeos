// 会话标题规则（会话维护，提交 a08a21e）：标题 = 第一条用户消息压成一行，过长截断。
// 纯函数：会话列表展示（落盘后的文件）与首发即生效（内存中的会话名）必须用同一套规则，避免两个时刻标题不一致。
//
// 2026-11-02 补（Task 0015）：新增 `shortTitleOf()`——**只用于显示**的短标题，不落盘。
//
// 为什么需要它（实测数据）：列表按标题的前十几个汉字展示（面板 300 宽 ≈ 15 字），
// 而真实家目录里 26 条会话中 **14 条标题超过 50 字**、**9 条被截到 60 字**、
// 有 4 组"前 15 字完全相同"（`用 lifeos_send 交` ×4、`请用 lifeos_ask 问` ×2 …）——
// 因为它们就是用户第一句话的原话，开头往往是"请用/现在我们/我想要"这类没有区分度的引导语。
// 所以加第三行没用（第三行也会被长文本吃掉）；要解决的是**第一行的区分度**。
export const TITLE_MAX_CHARS = 60;

export function titleFromFirstMessage(text: string): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length > TITLE_MAX_CHARS ? oneLine.slice(0, TITLE_MAX_CHARS) : oneLine;
}

/**
 * 没有区分度的开头（引导语 / 客套 / 指示词）。**只删一次**，且只在它后面还有内容时删。
 *
 * 判据来源：从真实会话标题里统计出的高频开头（26 条里至少 12 条以这些词开头）。
 * 不追求"覆盖所有中文虚词"——那会变成词法分析；只处理**实测高频**的那一小撮。
 */
const LEADING_FILLER = [
  // 顺序重要：长的在前（先匹配 `请用 lifeos_ask 问`，就不会被 `请用` 抢先）
  // 只删**手段/引导**部分，保留后面的动宾（`交给 coder：…` / `问 coder：…`）——
  // 动宾是会话的实质内容，删了会变成"coder：只回两个字"这种没有动作的开头。
  "请用 lifeos_ask", "请用 lifeos_send", "请用",
  "请你", "请帮我", "帮我", "麻烦",
  "用 lifeos_send", "用 lifeos_ask", "用",
  "我们需要", "我们想要", "我们现在", "现在我们需要",
  "我想要", "我想", "我觉得还是", "我觉得", "我这里有一些", "这里面", "这里是",
  "我们现在应该", "现在我们", "我们来", "我们要",
  "把这件事", "先", "那么", "所以", "然后", "另外", "还有",
];

/** 句末语气 / 标点：短标题不要拖一个句号。 */
const TRAILING_PUNCT = /[。！？.!?，,；;：:、\s]+$/;

/**
 * 显示用短标题（**不改落盘数据**）。
 *
 * 目标：让列表里相邻两行的**前 15 个字**尽量不同。做法只有三步，全是可解释的：
 * 1. 压成一行、去首尾；
 * 2. 去掉**一次**开头引导语（`请用`/`现在我们`/`我想要`…，见 `LEADING_FILLER`）；
 * 3. 去掉句末标点。
 *
 * 明确不做：摘要（要调模型）、词干化、拼装多个句子。宁可留长，也不伪造语义。
 */
export function shortTitleOf(title: string): string {
  let text = (title ?? "").replace(/\s+/g, " ").trim();
  if (text === "") return text;

  // 只在"删掉之后还剩得下内容"时才删，避免 `请用` 这种整句被删空
  for (const filler of LEADING_FILLER) {
    if (!text.startsWith(filler)) continue;
    const rest = text.slice(filler.length).replace(/^[，,：:、\s]+/, "");
    if (rest.length >= 4) { text = rest; break; }
  }

  // 第二轮：只削**纯虚指**的短语（没有信息量的指代），削完必须还有动宾
  for (const vague of ["把这件事", "这件事", "这个", "那个"]) {
    if (!text.startsWith(vague)) continue;
    const rest = text.slice(vague.length).replace(/^[，,：:、\s]+/, "");
    if (rest.length >= 6) { text = rest; break; }
  }

  text = text.replace(TRAILING_PUNCT, "");
  // 删引导语后可能出现"交给 coder：…"这种只剩动宾的开头——它自带动作，是可读的，保留。
  return text;
}
