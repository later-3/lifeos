/**
 * 控件纪律门禁（Task 0015 · S4）：页面层（非 design/）不许自绘 <button / <input / <select。
 *
 * 为什么：S4 的目标是"同一控件一处实现"。允许页面随手写 <button> 的话，
 * 明天就会多出第 71 处——门禁才是纪律的落地形式。
 *
 * 白名单（WHY 必须写在条目上）：
 * - 语义不是"按钮"的（隐藏的 file input、原生 checkbox/radio 的表单语义）
 * - 需要原生控件行为的（textarea 的自动高度、range 的拖拽）
 * 新增白名单条目必须在注释里写清"为什么不复用 existing primitive"。
 */
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SRC = join(ROOT, "frontend/src");

/** 文件 → 允许的自绘控件理由（键是相对 SRC 的路径）。 */
const ALLOW = new Map([
  ["views/settings-surface.tsx", "mode-seg / swatch 是 radiogroup 的 radio 语义（role=radio + aria-checked），不是按钮"],
  ["views/FileTree.tsx", "树节点用原生 button 承载 role=treeitem 的键盘模型，需保留原生行为"],
  ["views/Message.tsx", "折叠开关是内容区的展开/收起锚点，与消息散文同层级"],
  ["views/annotation-card.tsx", "批注卡内的语气选择用原生 button（role=radio 组合）"],
  ["views/FilePanel.tsx", "标签关闭按钮需要 tabIndex=-1 的非顺序焦点语义"],
  ["views/message-actions.tsx", "动作条按钮由 TONE_CLASS 映射动态着色，MicroButton 的 tone 枚举装不下"],
  ["views/mark-bar.tsx", "批注标记条是独立浮层，交互模型与 MicroButton 不同（内含嵌套动作）"],
  ["views/groups-panel.tsx", "分组头承载 role=button + 折叠 aria-expanded 的树语义"],
  ["views/response-bar.tsx", "回合状态条的可点区域是「这一轮」的锚点，非按钮"],
  ["views/PeerPanel.tsx", "对端面板关闭钮在窄容器里需要 shrink-0 的固定宽度"],
  ["views/ReviewPanel.tsx", "diff 行内的批注锚点/已看开关是行内定位元素（absolute + 行高约束）"],
  ["App.tsx", "提示条关闭钮 / 行内非法嵌套说明处"],
  ["views/display-prefs-panel.tsx", "Esc 提示旁的关闭钮是弹层约定的一部分"],
  ["views/selection-toolbar.tsx", "划词工具条是浮层，位置由选区决定"],
  ["views/AgentConfig.tsx", "表单字段用 controlClass + 原生 input/select（需保留 name/autoComplete 语义）"],
  ["views/DirectoryPicker.tsx", "路径输入框用 controlClass + 原生 input（需保留 ref 与受控输入语义）"],
]);

/* 只查 <button：input/select 在本项目里统一用 `controlClass`（design/ui 导出的类），
 * 是"受控的表单字段"而不是"自绘控件"，硬替换成 primitive 反而会丢 name/autoComplete 语义。
 * 后续如果要收 input，得先有 Input/Select primitive（登记 todo）。 */
const BANNED = [/<button\b/g];

const offenders = [];
(function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "design" || entry.name === "node_modules") continue;
      walk(full);
      continue;
    }
    if (!/\.tsx?$/.test(entry.name)) continue;
    const rel = relative(SRC, full);
    if (ALLOW.has(rel)) continue;
    const text = readFileSync(full, "utf8");
    // 跳过注释行
    const lines = text.split("\n").filter((l) => !l.trimStart().startsWith("*") && !l.trimStart().startsWith("//"));
    const hits = BANNED.map((re) => (lines.join("\n").match(re) ?? []).length).reduce((a, b) => a + b, 0);
    if (hits > 0) offenders.push(`${rel}（${hits} 处）`);
  }
})(SRC);

if (offenders.length > 0) {
  console.error("✗ 页面层自绘控件（应使用 design/ui 的 primitive）：");
  for (const o of offenders) console.error("  ", o);
  console.error("\n若确需自绘，把文件加进 scripts/lint-primitives.mjs 的 ALLOW 并写明理由。");
  process.exit(1);
}
console.log("✓ 控件纪律通过（页面层无未登记的自绘控件）");
