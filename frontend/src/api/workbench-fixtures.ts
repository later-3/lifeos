/**
 * 工作台**假数据**的唯一居所（Task 0023 · S1 任务书 §3）。
 *
 * 规则：
 * - 除此之外任何文件不得出现桩数据（`grep -rn "STUB:" frontend/src/ | wc -l` 是剩余量，S4 归零）；
 * - 数字是 2026-11-22 快照，**仅造数用；断言不依赖具体数值（S1-contract §6-R3）**；
 * - 桩条目带 `_stub: true`，渲染层据此显式标「示例」——假数据不能让人误以为是真的；
 * - 形状比真数据**更宽容**：`kind` 缺失是合法输入（architect S1 回应③），渲染层 fallback 纯文本卡。
 */
import type { GlobalTask, GlobalProject, Day, FeedItem, ActivityRef } from "./workbench";

/* ── 内容流桩（S2 接真）────────────────────────────────────────── */
// STUB: 等 GET /api/feed（S2）；替换时只改 api/workbench.ts 的 fetchFeed 函数体

export type StubFeedItem = FeedItem & { _stub: true };

export const STUB_FEED: StubFeedItem[] = [
  {
    _stub: true,
    id: "stub-1",
    day: "2026-11-22",
    author: { kind: "agent", id: "frontend-developer", name: "Frontend Developer" },
    title: "工作台底座改造：右栏三档降级一次落地",
    text: "layout.ts 加 right/rightMode；764/684 两个临界由 RAIL+RIGHT+MIN_CHAT 推出，测试 S1-R1..R6 锁住。",
    tags: ["工作台", "底座"],
    media: [
      { kind: "image", url: "/api/attachment?src=stub-1a", caption: "三档示意" },
      { kind: "image", url: "/api/attachment?src=stub-1b", caption: "临界点" },
    ],
    projectId: "lifeos",
    task: { id: "0023", title: "用户工作台前端（S1 形态+真数据 → S4 收口）" },
    likes: 3,
    comments: 1,
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
    task: { id: "0032", title: "S1 后端：状态归一 + 全局项目/任务 + 日期索引" },
    likes: 2,
    comments: 0,
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
    projectId: "lifeos",
    task: { id: "0003", title: "个人工作台：笔记 + 事务 + 动态 + 项目/Task 视角" },
    likes: 5,
    comments: 2,
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
      { kind: "image", url: "/api/attachment?src=stub-4a", caption: "拓扑" },
      { kind: "image", url: "/api/attachment?src=stub-4b", caption: "网段表" },
    ],
    projectId: "workspace",
    task: { id: "0002", title: "家庭设备管理" },
    likes: 4,
    comments: 1,
    mine: false,
    // kind 缺失：合法输入（渲染层 fallback 纯文本卡）
  },
  {
    _stub: true,
    id: "stub-5",
    day: "2026-11-21",
    author: { kind: "user", id: "me", name: "xu" },
    title: "本周复盘：为什么我在设备上花了这么久",
    text: "真正的瓶颈不是硬件，是我对「够用」的定义一直在漂。记下来提醒自己。",
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
    projectId: "lifeos",
    likes: 1,
    comments: 0,
    mine: false,
    kind: "review",
  },
];

/* ── 全局任务夹具（coder 的 /api/tasks 已交付；接真后本表只作为 UI 测试的 route mock 夹具）──────── */
// STUB: 等 /api/tasks 接真（第 3 块）；接真后降级为纯测试夹具，标记删除

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

/* ── 全局项目夹具 ──────────────────────────────────────────── */
// STUB: 等 /api/projects 接真（第 3 块）；接真后降级为纯测试夹具，标记删除

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

/* ── 日期索引夹具（S1 只有 activity）──────────────────────────────── */
// STUB: 等 /api/days 接真（第 3 块）；接真后降级为纯测试夹具，标记删除

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
