import type { ReactNode } from "react";

/**
 * 左侧图标轨（前端开发路径 · 参照 VS Code Activity Bar，2026-10-18 用户定）：
 * - **常驻**：不管对应列收起还是展开，图标都在最左边（收起/展开都只占这条 44px 轨）；
 * - **高亮 = 该列展开**；点当前图标 = 收起；点未展开的图标 = 展开（各自独立，可连续切换）；
 * - 轨同时承担"我在哪"：条目带图标 + tooltip，主项（当前助手）显示头像；
 * - 这条轨的宽度由 design/layout.ts 统一计算，组件不再各自声明宽度。
 * - **底部槽**（Task 0009）：设置入口住在这里——参照 VS Code（齿轮在 Activity Bar 底部）
 *   与 LobeHub（`src/features/NavRail`："The rail owns settings and help under im_layout"）。
 *   2026-11-09 用户裁决：设置不该放聊天头部。
 */
export function NavRail({ items, bottom }: {
  items: { key: string; label: string; icon: ReactNode; active: boolean; onToggle: () => void }[];
  /** 轨底部的常驻入口（设置等），与导航项视觉一致但不参与收展。 */
  bottom?: ReactNode;
}) {
  return (
    // 图标轨用 nav-edge（比列底 nav-bg 沉一档）+ 右侧 1px nav-line。
    // 三档分开：nav-edge(93.0) → nav-bg(96.9) → surface(100.0)，相邻差 3.9 / 3.1。
    <nav aria-label="左侧图标轨" className="flex w-11 shrink-0 flex-col items-center gap-1 border-r border-nav-line bg-nav-edge py-1.5">
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
      {bottom !== undefined && <div className="mt-auto flex flex-col items-center">{bottom}</div>}
    </nav>
  );
}
