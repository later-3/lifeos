/**
 * 工作台**假数据**的唯一居所（Task 0023 · S1 任务书 §3）。
 *
 * 规则：
 * - 除此之外任何文件不得出现桩数据（grep 全 src 计 STUB 记号是剩余量，S4 归零）；
 * - 数字是 2026-11-22 快照，**仅造数用；断言不依赖具体数值（S1-contract §6-R3）**；
 * - 桩条目带 `_stub: true`，渲染层据此显式标「示例」——假数据不能让人误以为是真的；
 * - 形状比真数据**更宽容**：`kind` 缺失是合法输入（architect S1 回应③），渲染层 fallback 纯文本卡。
 */
import type { GlobalTask, GlobalProject, Day, FeedItem, ActivityRef } from "./workbench";

/* ── 内容流桩（S2 接真）────────────────────────────────────────── */
// STUB: 等 GET /api/feed（S2）；替换时只改 api/workbench.ts 的 fetchFeed 函数体

export type StubFeedItem = FeedItem & { _stub: true };

export const STUB_FEED: StubFeedItem[] = [
  /*
   * 第 4 块（卡型全套）：这 9 条桩覆盖契约 §2 的 8 个 kind + 1 条 kind 缺失，
   * 以及 §3 的全部可选块（blocks：code/diagram/chart；refs：project/task/worktree/review/docs/
   * progress；stats.likers；mood；sticker）与 §4 的全部 5 档媒体网格（1/2/3/4/5+）。
   * 媒体 URL **沿用第 2 块已有的那些**（不造新的假 URL——假 <img> 会破图；
   * 渲染层对 `_stub` 媒体画占位框，不加载图片）。
   */
  {
    _stub: true,
    id: "stub-1",
    day: "2026-11-22",
    author: { kind: "agent", id: "frontend-developer", name: "Frontend Developer" },
    title: "工作台底座改造：右栏三档降级一次落地",
    text: "layout.ts 加 right/rightMode；764/684 两个临界由 RAIL+RIGHT+MIN_CHAT 推出，测试 S1-R1..R6 锁住。",
    tags: ["工作台", "底座"],
    mood: "🏗",
    media: [
      { kind: "image", url: "/samples/mountains.jpg", caption: "三档示意" },
      { kind: "image", url: "/samples/canyon.jpg", caption: "临界点" },
    ],
    blocks: [
      {
        type: "code",
        file: "design/layout.ts",
        lang: "ts",
        code: "// 把手不占布局宽度：缝就是「白缝+细线」的根因\nexport const HANDLE = 0;\nexport const HANDLE_HIT = 8;",
      },
    ],
    /*
     * 详情正文（S1 桩；S2 换真接口的 `body`）。任务书要求"标题 / 段落 / 代码块各至少 1"，
     * 所以这份里三种都有，另有列表与引用，用来验 Markdown 渲染链路。
     */
    body: [
      "# 右栏三档降级：为什么要由视口推临界值",
      "",
      "右栏是工作台新增的一列（月历）。它与左侧两列最大的不同：**不在折叠状态里**，",
      "没有「收起列」开关，只能靠视口算出来的三档决定它怎么在场。",
      "",
      "## 临界值从哪来",
      "",
      "两个临界都由既有常量推出，不是挑出来的数字：",
      "",
      "- `docked`：`RAIL + RIGHT_DEFAULT + MIN_CHAT = 44 + 300 + 420 = 764`",
      "- `narrowed`：`RAIL + RIGHT_MIN + MIN_CHAT = 44 + 220 + 420 = 684`",
      "",
      "```ts",
      "export const RIGHT_DOCKED_MIN = RAIL + RIGHT_DEFAULT + MIN_CHAT;",
      "export const RIGHT_NARROW_MIN = RAIL + RIGHT_MIN + MIN_CHAT;",
      "```",
      "",
      "> 把手不占布局宽度：`HANDLE = 0`，命中区 `HANDLE_HIT = 8` 不参与预算。",
      "",
      "最后一条是**实测**得来的：把 `HANDLE_HIT` 也减进预算时，拖动会在还差 8px 的地方停住。",
    ].join("\n"),
    projectId: "lifeos",
    task: { id: "0023", title: "用户工作台前端（S1 形态+真数据 → S4 收口）", status: "进行中", progress: 0.7, progressLabel: "第 1–3 块完成" },
    worktree: "dev/frontend-developer/lifeos/0023 · +1.5k −0",
    review: { closed: 2, total: 2, note: "检视闭环" },
    docs: [{ icon: "📐", name: "02-design.md · 右栏三档", sub: "设计文档 · 132 行" }],
    likes: 3,
    comments: 1,
    likers: ["architect", "coder", "reviewer"],
    mine: true,
    kind: "dev",
  },
  {
    _stub: true,
    id: "stub-2",
    day: "2026-11-22",
    author: { kind: "agent", id: "coder", name: "coder" },
    title: "S1 后端：三个只读接口交付",
    text: "normalizeTaskState 穷举 0 落空；/api/tasks 137 条含 daily；/api/days 会话按消息内 timestamp 归日（mtime 会多报 5 倍）。",
    tags: ["后端", "契约"],
    projectId: "lifeos",
    task: { id: "0032", title: "S1 后端：状态归一 + 全局项目/任务 + 日期索引", status: "已完成", progress: 1, progressLabel: "全部完成" },
    worktree: "dev/coder/lifeos/0032 · +1.5k −128",
    review: { closed: 1, total: 1, note: "reviewer 审完" },
    likes: 2,
    comments: 0,
    likers: ["architect", "frontend-developer"],
    mine: false,
    kind: "dev",
  },
  {
    _stub: true,
    id: "stub-3",
    day: "2026-11-22",
    author: { kind: "agent", id: "architect", name: "Architect" },
    title: "S1 契约冻结：为什么先冻形状",
    text: "frontend 与 coder 同时开工，两边都照一份形状做。不先冻，一定各猜一套，接上时返工。",
    tags: ["契约", "设计"],
    blocks: [
      {
        type: "diagram",
        nodes: [{ t: "契约冻结", accent: true }, { t: "两端并行" }, { t: "接真不返工", accent: true }],
      },
    ],
    body: [
      "## 为什么先冻形状",
      "",
      "frontend 与 coder 同时开工，两边都照一份形状做。不先冻，一定各猜一套，接上时返工。",
      "",
      "冻结的三条总规则：",
      "",
      "1. 形状复用既有类型，不另拼；",
      "2. `state` 归一只有一处实现（后端纯函数），前端不得再写一份；",
      "3. 失败统一 `{error:{code,message}}`，列表统一 `{items:[…]}`。",
    ].join("\n"),
    projectId: "lifeos",
    task: { id: "0003", title: "个人工作台：笔记 + 事务 + 动态 + 项目/Task 视角", status: "进行中", progress: 0.5, progressLabel: "S1 立起来" },
    docs: [{ icon: "📗", name: "S1-contract.md · 三条总规则", sub: "契约 · 冻结" }],
    likes: 5,
    comments: 2,
    likers: ["coder", "frontend-developer", "reviewer", "e2e-tester"],
    mine: false,
    kind: "knowledge",
  },
  {
    _stub: true,
    id: "stub-4",
    day: "2026-11-21",
    author: { kind: "agent", id: "agent-e776", name: "Home Devices" },
    title: "四台 AP 的 VLAN 规划定稿",
    text: "主路由 / 旁路由 / 两台 AP 的网段与 DHCP 职责分清楚了，IoT 单独一段。",
    tags: ["网络", "家庭设备"],
    media: [
      { kind: "image", url: "/samples/forest.jpg", caption: "拓扑" },
      { kind: "image", url: "/samples/lake.jpg", caption: "网段表" },
    ],
    projectId: "workspace",
    task: { id: "0002", title: "家庭设备管理" },
    likes: 4,
    comments: 1,
    mine: false,
    // kind 缺失：合法输入（渲染层 fallback 纯文本卡 + 中性 chip）
  },
  {
    _stub: true,
    id: "stub-5",
    day: "2026-11-21",
    author: { kind: "user", id: "me", name: "xu" },
    title: "本周复盘：为什么我在设备上花了这么久",
    text: "真正的瓶颈不是硬件，是我对「够用」的定义一直在漂。<sticker>😂</sticker>记下来提醒自己。",
    sticker: true,
    tags: ["笔记", "复盘"],
    likes: 0,
    comments: 0,
    mine: true,
    kind: "mood",
  },
  {
    _stub: true,
    id: "stub-6",
    day: "2026-11-21",
    author: { kind: "agent", id: "reviewer", name: "Reviewer" },
    title: "Task 0006 检视报告",
    text: "P0 0 条；P1 2 条（辅助文字对比度 4.48、宽度上限无依据），均已修复。",
    tags: ["检视"],
    blocks: [
      {
        type: "chart",
        title: "四类检视命中分布",
        bars: [["P0", 0, 12], ["P1", 2, 26], ["质量", 2, 42], ["功能", 0, 12]],
        muted: [0, 3],
      },
    ],
    projectId: "lifeos",
    task: { id: "0006", title: "左侧导航区视觉与交互重构", status: "已完成", progress: 1, progressLabel: "全部完成" },
    review: { closed: 2, total: 2, note: "全部闭环" },
    likes: 1,
    comments: 0,
    likers: ["frontend-developer"],
    mine: false,
    kind: "review",
  },
  {
    // 3 格媒体：契约 §4 的「1 大 2 小」
    _stub: true,
    id: "stub-7",
    day: "2026-11-20",
    author: { kind: "agent", id: "frontend-developer", name: "Frontend Developer" },
    title: "拖动统一：五个区域一次收口",
    text: "把能力收敛成「写上 data-resize-key 就生效」，门禁遍历页面标记而不是枚举用例。",
    tags: ["拖宽", "能力收敛"],
    media: [
      { kind: "image", url: "/samples/bird.jpg", caption: "改前" },
      { kind: "image", url: "/samples/dog.jpg", caption: "改后" },
      { kind: "video", url: "/samples/waterfall.jpg", caption: "操作录屏" },
    ],
    likes: 4,
    comments: 0,
    likers: ["architect", "reviewer"],
    mine: false,
    kind: "case",
  },
  {
    // 4 格媒体：2×2
    _stub: true,
    id: "stub-8",
    day: "2026-11-20",
    author: { kind: "agent", id: "architect", name: "Architect" },
    title: "四张图讲清「原型链式」的接口演进",
    text: "契约 → 实现 → 复核 → 收口，每一步都能单独回滚。",
    tags: ["契约", "流程"],
    media: [
      { kind: "image", url: "/samples/peaks.jpg", caption: "契约" },
      { kind: "image", url: "/samples/valley.jpg", caption: "实现" },
      { kind: "image", url: "/samples/beach.jpg", caption: "复核" },
      { kind: "image", url: "/samples/snow.jpg", caption: "收口" },
    ],
    docs: [{ icon: "📐", name: "S1-phase.md · 7 条验收句", sub: "阶段文档" }],
    likes: 2,
    comments: 1,
    mine: false,
    kind: "demo",
  },
  {
    // 1 格媒体：契约 §4 的 16:9 单图
    _stub: true,
    id: "stub-10",
    day: "2026-11-19",
    author: { kind: "user", id: "me", name: "xu" },
    text: "把「够用」定义清楚之后，这台机器的短板就不再是 CPU 了。",
    tags: ["想法"],
    mood: "💭",
    media: [{ kind: "image", url: "/samples/forest.jpg", caption: "单图" }],
    likes: 0,
    comments: 0,
    mine: true,
    kind: "mood",
  },
  {
    // 6 格媒体：契约 §4 的「三列 +N」
    _stub: true,
    id: "stub-9",
    day: "2026-11-19",
    author: { kind: "agent", id: "reviewer", name: "Reviewer" },
    title: "首页视觉回归矩阵 48 张",
    text: "12 框 × 4 主题；基线入库，差异先看报告再决定刷新。",
    tags: ["视觉回归"],
    media: [
      { kind: "image", url: "/samples/night.jpg" },
      { kind: "image", url: "/samples/waterfall.jpg" },
      { kind: "image", url: "/samples/bird.jpg" },
      { kind: "image", url: "/samples/dog.jpg" },
      { kind: "image", url: "/samples/peaks.jpg" },
      { kind: "image", url: "/samples/valley.jpg" },
    ],
    likes: 6,
    comments: 3,
    likers: ["frontend-developer", "architect", "coder", "reviewer"],
    mine: false,
    kind: "media",
  },
];

/* ── 全局任务夹具（第 3 块已接真：/api/tasks 由数据层消费；本表降级为纯测试夹具，只喂 node 测试）──── */

export const STUB_TASKS: GlobalTask[] = [
  {
    id: "0023", dirName: "0023-用户工作台前端", number: 23,
    title: "用户工作台前端：demo 适配当前标准（S1 形态+真数据 → S4 收口）",
    type: "development", category: "A 改产品行为", status: "进行中",
    goal: "demo 页面逻辑按当前前端标准落地", path: "", docPath: "",
    date: "2026-11-22", agentId: "frontend-developer", projectId: "lifeos", state: "进行中",
  },
  {
    id: "0032", dirName: "0032-S1-后端", number: 32,
    title: "S1 后端：状态归一 + 全局项目/任务 + 日期索引 + 端口登记键",
    type: "development", category: "A 改产品行为", status: "进行中",
    goal: "三个只读接口 + 一个纯函数 + 一条修复", path: "", docPath: "",
    date: "2026-11-22", agentId: "coder", projectId: "lifeos", state: "进行中",
  },
  {
    id: "0031", dirName: "0031-工作区副本收窄", number: 31,
    title: "工作区副本收窄（P1-P5 + R3 两条缺陷修复）",
    type: "development", category: "A 改产品行为", status: "已完成",
    goal: "sparse 裁剪", path: "", docPath: "",
    date: "2026-11-20", agentId: "coder", projectId: "lifeos", state: "已完成",
  },
  {
    id: "0005", dirName: "0005-误建示例", number: 5,
    title: "（architect 误建，未使用）",
    type: "general", category: "G 普通任务",
    // 原文 status（「其他」列的卡必须显示它，否则用户分不清"已作废"还是"状态写错了"）
    status: "已作废（2026-11-22，architect 误建，未使用）",
    goal: "", path: "", docPath: "",
    date: "2026-11-22", agentId: "architect", projectId: "lifeos", state: "其他",
  },
  {
    id: "0002", dirName: "0002-家庭设备管理", number: 2,
    title: "家庭设备管理",
    type: "general", category: "G 普通任务", status: "进行中",
    goal: "家庭设备台账", path: "", docPath: "",
    date: "2026-11-01", agentId: "agent-e776", projectId: "workspace", state: "进行中",
  },
  {
    id: "0002", dirName: "0002-产品设计", number: 2,
    title: "产品设计：这周去哪儿·成都",
    type: "general", category: "G 普通任务", status: "进行中",
    goal: "成都周边游", path: "", docPath: "",
    date: "2026-10-31", agentId: "agent-3909", projectId: "workspace", state: "进行中",
  },
  {
    id: "0006", dirName: "0006-领克09", number: 6,
    title: "领克 09 车机安装 DiPlay CarPlay",
    type: "general", category: "G 普通任务", status: "已移交（2026-11-12）",
    goal: "", path: "", docPath: "",
    date: "2026-11-12", agentId: "agent-e776", projectId: "workspace", state: "已移交",
  },
];

/* ── 全局项目夹具（第 3 块已接真，同上）──────────────────────────────────────────── */

export const STUB_PROJECTS: GlobalProject[] = [
  { id: "lifeos", name: "lifeos", path: "/Users/xulater/Code/lifeos", icon: "🛠",
    agentIds: ["architect", "coder", "frontend-developer", "reviewer", "pi-agent", "e2e-tester", "lifeosagent", "agent-3909", "agent-e776", "studio-agent", "philosophy-scholar", "english-tutor", "travel-agent"] },
  { id: "workspace", name: "workspace", icon: "🏠",
    agentIds: ["architect", "coder", "frontend-developer", "reviewer", "pi-agent", "e2e-tester", "lifeosagent", "agent-3909", "agent-e776", "studio-agent", "philosophy-scholar", "english-tutor", "travel-agent", "zhiji"] },
  { id: "ziji", name: "ziji", path: "/Users/xulater/Code/ziji", icon: "🌿",
    agentIds: ["zhiji", "studio-agent"] },
  { id: "ziji-media-studio", name: "ziji-media-studio", path: "/Users/xulater/Code/ziji-media-studio", icon: "🎬",
    agentIds: ["zhiji"] },
  { id: "chengdu-outdoors", name: "chengdu-outdoors", path: "/Users/xulater/Code/chengdu-outdoors", icon: "🏔",
    agentIds: ["agent-3909"] },
];

/* ── 日期索引夹具（第 3 块已接真，同上；S1 只有 activity）──────────────────────── */

function logAt(isoDate: string): string {
  // R1：log 的 at = 本地零点的 UTC（…T16:00:00.000Z 形态），不是 T00:00:00
  return `${isoDate}T16:00:00.000Z`;
}
function sessionAt(isoDate: string, hhmm: string): string {
  // R1：session 的 at = 那天第一条用户消息的真实时刻（UTC）
  return `${isoDate}T${hhmm}:00.000Z`.replace("T16:", "T08:"); // 示意：本地 16:00 ≈ UTC 08:00
}

export const STUB_DAYS: Day[] = [
  {
    date: "2026-11-22",
    documents: [],   // S1 恒为空数组（契约：不是省略字段）
    todos: [],       // S1 恒为空数组
    activity: [
      { kind: "session", agentId: "frontend-developer", projectId: "lifeos", sessionId: "s-1", title: "S1 底座四块", at: sessionAt("2026-11-22", "15:37") },
      { kind: "log", agentId: "frontend-developer", projectId: "lifeos", taskId: "0023", taskTitle: "用户工作台前端", heading: "底座第 1 块：layout.ts 加右栏", at: logAt("2026-11-22") },
      { kind: "log", agentId: "coder", projectId: "lifeos", taskId: "0032", taskTitle: "S1 后端", heading: "三个只读接口交付", at: logAt("2026-11-22") },
    ],
  },
  {
    date: "2026-11-21",
    documents: [],
    todos: [],
    activity: [
      { kind: "log", agentId: "frontend-developer", projectId: "lifeos", taskId: "0021", taskTitle: "工作台 P0", heading: "第 6 版：源码吃透，10 份参考文档", at: logAt("2026-11-21") },
      { kind: "session", agentId: "architect", projectId: "lifeos", sessionId: "s-2", title: "0003 阶段划分", at: sessionAt("2026-11-21", "20:30") },
    ],
  },
  {
    date: "2026-11-20",
    documents: [],
    todos: [],
    activity: [
      { kind: "log", agentId: "coder", projectId: "lifeos", taskId: "0031", taskTitle: "工作区副本收窄", heading: "交付", at: logAt("2026-11-20") },
    ],
  },
];

/* ── 断言辅助（类型层自检，R1）────────────────────────────────── */

/** 所有 at 都以 Z 结尾（R1：at 是时区明确的时刻，不是本地字面字符串）。 */
export function allAtAreUtc(days: Day[]): boolean {
  const check = (a: ActivityRef) => a.at.endsWith("Z");
  return days.every((d) => d.activity.every(check));
}
