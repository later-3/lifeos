import type { ReactNode } from "react";

/**
 * 左侧图标轨（前端开发路径 · 参照 VS Code Activity Bar，2026-10-18 用户定）：
 * - **常驻**：不管对应列收起还是展开，图标都在最左边（收起/展开都只占这条 44px 轨）；
 * - **高亮 = 该列展开**；点当前图标 = 收起；点未展开的图标 = 展开（各自独立，可连续切换）；
 * - 轨同时承担"我在哪"：条目带图标 + tooltip，主项（当前助手）显示头像；
 * - 这条轨的宽度由 design/layout.ts 统一计算，组件不再各自声明宽度。
 */
export function NavRail({ items }: {
  items: { key: string; label: string; icon: ReactNode; active: boolean; onToggle: () => void }[];
}) {
  return (
    // 图标轨用更深的色阶（hover 灰）+ 右侧 hairline：与 sunken 的列、surface 的聊天区分出三级层次。
    // 同色相邻会让轨与第一列视觉上合并成一个面板，"添加项目"等底部按钮也显得左右不齐。
    <nav aria-label="左侧图标轨" className="flex w-11 shrink-0 flex-col items-center gap-1 border-r border-line bg-hover py-1.5">
      {items.map((item) => (
        <button key={item.key} type="button" onClick={item.onToggle}
          aria-label={item.active ? `收起${item.label}` : `展开${item.label}`}
          aria-pressed={item.active}
          title={item.active ? `收起${item.label}` : `展开${item.label}（若右侧面板开着，会先关闭面板）`}
          className={`flex h-9 w-9 items-center justify-center rounded-control transition-colors ${
            item.active ? "bg-accent-soft text-accent" : "text-ink-500 hover:bg-surface hover:text-ink-900"
          }`}>
          {item.icon}
        </button>
      ))}
    </nav>
  );
}
