/**
 * 多图标集注册表（Task 0015 · S3）。
 *
 * A1 建立了"语义名 → 组件"的单源映射；本文件把它扩成**多源**：
 * tabler（默认）/ lucide / phosphor。每个语义名在每个源里都有一条映射（缺项显式写 null）。
 *
 * 纪律（与 Twenty 的字典纪律同源）：
 * - 页面层仍只用 `AppIcon name="..."`，**不感知图标集**；
 * - 换集只改这里 + 主题包的 `icons.set`；
 * - 某源缺某个语义名 → 回退 tabler + 控制台 warn（不静默、不空白）。
 *
 * 为什么是这三个源：tabler 是我们既有资产；lucide 是 shadcn 生态默认（参考项目 Cal.com 用它）；
 * phosphor 有 6 种字重、视觉重量更丰富（Twenty 用过它的思路）。
 */
import * as Tabler from "@tabler/icons-react";
import * as Lucide from "lucide-react";
import * as Phosphor from "@phosphor-icons/react";
import type { IconName } from "./icons";

export type IconSetId = "tabler" | "lucide" | "phosphor";

export const ICON_SET_LABELS: Record<IconSetId, string> = {
  tabler: "Tabler（默认）",
  lucide: "Lucide（shadcn / Cal.com）",
  phosphor: "Phosphor（六字重）",
};

type AnyIcon = React.ComponentType<Record<string, unknown>>;

/** 语义名 → 各源组件。`null` = 该源无对应图标（回退 tabler）。 */
const LUCIDE_MAP: Record<IconName, string | null> = {
  adjustments: "SlidersHorizontal",
  "adjustments-horizontal": "SlidersHorizontal",
  alert: "AlertCircle",
  "arrow-down": "ArrowDown",
  "arrow-left": "ArrowLeft",
  "arrow-up": "ArrowUp",
  bell: "Bell",
  check: "Check",
  "chevron-down": "ChevronDown",
  "chevron-left": "ChevronLeft",
  "chevron-right": "ChevronRight",
  "chevrons-down": "ChevronsDown",
  "chevrons-up": "ChevronsUp",
  copy: "Copy",
  file: "File",
  "file-text": "FileText",
  folder: "Folder",
  "folder-open": "FolderOpen",
  "folder-plus": "FolderPlus",
  "git-compare": "GitCompare",
  history: "History",
  info: "Info",
  language: "Languages",
  "layout-sidebar-right": "PanelRight",
  menu: "Menu",
  "message-circle": "MessageCircle",
  minus: "Minus",
  palette: "Palette",
  pencil: "Pencil",
  photo: "Image",
  plug: "Plug",
  plus: "Plus",
  refresh: "RefreshCw",
  selector: "MousePointer2",
  settings: "Settings",
  "text-wrap": "WrapText",
  tool: "Wrench",
  trash: "Trash2",
  upload: "Upload",
  wand: "Wand2",
  x: "X",
};

const PHOSPHOR_MAP: Record<IconName, string | null> = {
  adjustments: "Sliders",
  "adjustments-horizontal": "Faders",
  alert: "WarningCircle",
  "arrow-down": "ArrowDown",
  "arrow-left": "ArrowLeft",
  "arrow-up": "ArrowUp",
  bell: "Bell",
  check: "Check",
  "chevron-down": "CaretDown",
  "chevron-left": "CaretLeft",
  "chevron-right": "CaretRight",
  "chevrons-down": "CaretDoubleDown",
  "chevrons-up": "CaretDoubleUp",
  copy: "Copy",
  file: "File",
  "file-text": "FileText",
  folder: "Folder",
  "folder-open": "FolderOpen",
  "folder-plus": "FolderPlus",
  "git-compare": "GitDiff",
  history: "ClockCounterClockwise",
  info: "Info",
  language: "Translate",
  "layout-sidebar-right": "SidebarSimple",
  menu: "List",
  "message-circle": "ChatCircle",
  minus: "Minus",
  palette: "Palette",
  pencil: "PencilSimple",
  photo: "Image",
  plug: "Plugs",
  plus: "Plus",
  refresh: "ArrowsClockwise",
  selector: "Cursor",
  settings: "Gear",
  "text-wrap": "TextAlignLeft",
  tool: "Wrench",
  trash: "Trash",
  upload: "UploadSimple",
  wand: "MagicWand",
  x: "X",
};

function lookup(bag: Record<string, unknown>, name: string | null): AnyIcon | null {
  if (name === null) return null;
  const comp = bag[name];
  // React 组件在打包后可能是 function 或 object（forwardRef/memo）——两者都算命中
  return (typeof comp === "function" || (typeof comp === "object" && comp !== null))
    ? (comp as AnyIcon)
    : null;
}

/** 取某图标集下的组件；缺项返回 null（调用方回退）。 */
export function iconOf(set: IconSetId, name: IconName): AnyIcon | null {
  if (set === "tabler") return lookup(Tabler as unknown as Record<string, unknown>, tablerNameOf(name));
  if (set === "lucide") return lookup(Lucide as unknown as Record<string, unknown>, LUCIDE_MAP[name]);
  return lookup(Phosphor as unknown as Record<string, unknown>, PHOSPHOR_MAP[name]);
}

/** tabler 侧的名字规则：icons.tsx 的 ICONS 键就是 tabler 组件名（去掉 Icon 前缀后的 kebab）。 */
function tablerNameOf(name: IconName): string {
  const pascal = name
    .split("-")
    .map((part) => (part.length === 0 ? "" : part[0].toUpperCase() + part.slice(1)))
    .join("");
  return `Icon${pascal}`;
}

/** 覆盖度报告：每个源缺哪些语义名（S3 契约测试用；也用于设置页提示）。 */
export function iconSetCoverage(): Record<IconSetId, { total: number; missing: IconName[] }> {
  const names = Object.keys(LUCIDE_MAP) as IconName[];
  const report = { tabler: { total: names.length, missing: [] as IconName[] }, lucide: { total: names.length, missing: [] as IconName[] }, phosphor: { total: names.length, missing: [] as IconName[] } };
  for (const name of names) {
    for (const set of ["tabler", "lucide", "phosphor"] as IconSetId[]) {
      const mapped = set === "lucide" ? LUCIDE_MAP[name] : set === "phosphor" ? PHOSPHOR_MAP[name] : tablerNameOf(name);
      if (mapped === null || iconOf(set, name) === null) report[set].missing.push(name);
    }
  }
  return report;
}
