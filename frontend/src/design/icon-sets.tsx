/**
 * 多图标集注册表（Task 0015 · S3；Task 0016 · P2-S1 改为命名导入）。
 *
 * A1 建立了"语义名 → 组件"的单源映射；本文件把它扩成**多源**：
 * tabler（默认）/ lucide / phosphor。每个语义名在每个源里都有一条映射（缺项显式写 null）。
 *
 * 纪律（与 Twenty 的字典纪律同源）：
 * - 页面层仍只用 `AppIcon name="..."`，**不感知图标集**；
 * - 换集只改这里 + 主题包的 `icons.set`；
 * - 某源缺某个语义名 → 回退 tabler + 控制台 warn（不静默、不空白）。
 *
 * ## 为什么这里只剩"数据"（Task 0016 · P2-S1）
 *
 * 改之前：`import * as Tabler/Lucide/Phosphor` + `lookup(bag, name)` 动态索引。
 * tree-shaking 对动态索引失效 → **三个库整包进首屏 8572 KB**（主 chunk 9.27 MB 的 ≈87%–92%），
 * 而我们只用 41 个语义名。命名导入后实测 **136 KB / 33 KB gzip**。
 *
 * 现在：本文件**只保留两张事实表**（语义名 → 字符串名，人工维护），
 * 真正的具名 import 与三个静态对象由 `scripts/gen-icon-sets.mjs` 从这两张表 + `icons.tsx` 的 ICONS 生成，
 * 落在 `icon-sets.generated.ts`。改了表就 `pnpm gen:icons`；`pnpm lint:icons` 会检查两者一致。
 *
 * 为什么是"两张字符串表 + 生成"而不是"手写 123 个具名 import"：
 * 手写会让"加一个语义名"变成三处手工同步的活（且忘了不报错）；
 * 生成 + `--check` 把这件事变成机器检查。
 */
import type { IconName } from "./icons";
import { LUCIDE_ICONS, PHOSPHOR_ICONS, TABLER_ICONS, type IconComponent } from "./icon-sets.generated";
import { coverageOf, pickFrom } from "./icon-sets-resolve";

export type IconSetId = "tabler" | "lucide" | "phosphor";

export const ICON_SET_LABELS: Record<IconSetId, string> = {
  tabler: "Tabler（默认）",
  lucide: "Lucide（shadcn / Cal.com）",
  phosphor: "Phosphor（六字重）",
};

type AnyIcon = IconComponent;

/**
 * 语义名 → lucide 组件名（`null` = 该源缺此项，AppIcon 回退 tabler）。
 * 键类型是 `IconName`（= `keyof typeof ICONS`）：加语义名时漏了这张表，typecheck 直接红。
 */
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

/** 语义名 → phosphor 组件名（同上）。 */
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

/**
 * 三张表按 set id 索引（唯一映射处）。
 * 判定逻辑在 `icon-sets-resolve.ts`（零依赖、可离线单测）；这里只做"选表 + 查表"。
 */
const TABLES: Record<IconSetId, Readonly<Record<string, IconComponent | null>>> = {
  tabler: TABLER_ICONS,
  lucide: LUCIDE_ICONS,
  phosphor: PHOSPHOR_ICONS,
};

/** 取某图标集下的组件；缺项返回 null（调用方回退 tabler）。 */
export function iconOf(set: IconSetId, name: string): AnyIcon | null {
  return pickFrom(TABLES[set], name);
}

/** 覆盖度报告：每个源缺哪些语义名（契约测试用；也用于设置页提示）。 */
export function iconSetCoverage(): Record<IconSetId, { total: number; missing: string[] }> {
  return coverageOf(Object.keys(TABLER_ICONS), TABLES) as Record<IconSetId, { total: number; missing: string[] }>;
}
