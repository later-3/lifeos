/**
 * 图标注册表（Task 0015 · A1，参照 Twenty `twenty-ui/icon` 的管理形态：typed manifest
 * + 禁直引门禁 + 语义分三类）。tabler 图标**零发明**——这里是"语义名 → 组件"的
 * 单一映射；页面层一律 `import { AppIcon } from "../design/icons"`，
 * 禁止直接 import `@tabler/icons-react`（scripts/lint-icons.mjs 门禁）。
 *
 * IconName = keyof typeof ICONS：写错语义名 typecheck 直接红——覆盖度门禁由类型免费提供。
 * 语义名三类（Twenty 选择规则同源）：概念（file/folder/photo）、动作（copy/trash/pencil/…）、
 * 状态（alert/info/check/history…）。全量 41 个 = main 基线实际使用集（2026-11-13 实测）。
 */
import {
  IconAdjustments,
  IconAdjustmentsHorizontal,
  IconAlertCircle,
  IconArrowDown,
  IconArrowLeft,
  IconArrowUp,
  IconBell,
  IconCheck,
  IconChevronDown,
  IconChevronLeft,
  IconChevronRight,
  IconChevronsDown,
  IconChevronsUp,
  IconCopy,
  IconFile,
  IconFileText,
  IconFolder,
  IconFolderOpen,
  IconFolderPlus,
  IconGitCompare,
  IconHistory,
  IconInfoCircle,
  IconLanguage,
  IconLayoutSidebarRight,
  IconMenu2,
  IconMessageCircle,
  IconMinus,
  IconPalette,
  IconPencil,
  IconPhoto,
  IconPlug,
  IconPlus,
  IconRefresh,
  IconSelector,
  IconSettings,
  IconTextWrap,
  IconTool,
  IconTrash,
  IconUpload,
  IconWand,
  IconX,
} from "@tabler/icons-react";

import type React from "react";
import { iconOf } from "./icon-sets";
import { useIconSet } from "./icon-context";

/** 语义名 → tabler 组件。唯一映射处。 */
export const ICONS = {
  "adjustments": IconAdjustments,
  "adjustments-horizontal": IconAdjustmentsHorizontal,
  "alert": IconAlertCircle,
  "arrow-down": IconArrowDown,
  "arrow-left": IconArrowLeft,
  "arrow-up": IconArrowUp,
  "bell": IconBell,
  "check": IconCheck,
  "chevron-down": IconChevronDown,
  "chevron-left": IconChevronLeft,
  "chevron-right": IconChevronRight,
  "chevrons-down": IconChevronsDown,
  "chevrons-up": IconChevronsUp,
  "copy": IconCopy,
  "file": IconFile,
  "file-text": IconFileText,
  "folder": IconFolder,
  "folder-open": IconFolderOpen,
  "folder-plus": IconFolderPlus,
  "git-compare": IconGitCompare,
  "history": IconHistory,
  "info": IconInfoCircle,
  "language": IconLanguage,
  "layout-sidebar-right": IconLayoutSidebarRight,
  "menu": IconMenu2,
  "message-circle": IconMessageCircle,
  "minus": IconMinus,
  "palette": IconPalette,
  "pencil": IconPencil,
  "photo": IconPhoto,
  "plug": IconPlug,
  "plus": IconPlus,
  "refresh": IconRefresh,
  "selector": IconSelector,
  "settings": IconSettings,
  "text-wrap": IconTextWrap,
  "tool": IconTool,
  "trash": IconTrash,
  "upload": IconUpload,
  "wand": IconWand,
  "x": IconX,
} as const;

export type IconName = keyof typeof ICONS;
type IconProps = React.ComponentProps<(typeof ICONS)[IconName]> & { name?: never };

/**
 * 页面层的唯一图标入口。props 全透传（size/stroke/className）。
 * S3：组件从**当前图标集**取（IconSetContext），缺项回退 tabler 并 warn。
 */
export function AppIcon({ name, ...rest }: { name: IconName } & Omit<IconProps, "name">) {
  const set = useIconSet();
  // 三套都从生成好的静态对象取（不是命名空间导入的 `bag[name]`——那会让 tree-shaking 失效，
  // 三个库整包进首屏 8572 KB。见 scripts/gen-icon-sets.mjs 的头注）。
  const fromSet = set === "tabler" ? null : iconOf(set, name);
  if (set !== "tabler" && fromSet === null) {
    console.warn(`[icons] 图标集 ${set} 缺语义名 "${name}"，已回退 tabler`);
  }
  // tabler 也走生成表：这样三套的取法一致，且 ICONS 只作为"语义名 → 展示/覆盖度"的事实表。
  const Component = (fromSet ?? iconOf("tabler", name) ?? ICONS[name]) as React.ComponentType<Record<string, unknown>>;
  return <Component {...(rest as Record<string, unknown>)} />;
}
