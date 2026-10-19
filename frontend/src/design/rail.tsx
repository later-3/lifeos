import type { ReactNode } from "react";

/**
 * 导航轨（前端开发路径 · 折叠成本常数化）：
 * 被收起的列合并成一条 44px 轨，而不是每列各留一条 36px 空条。
 * - 成本 O(1)：不管收起 1 列还是 3 列，都只占 44px；全展开时为 0。
 * - 轨同时承担"我在哪"：条目带图标 + tooltip，主项（当前助手）显示头像。
 * - 这条轨的宽度由 design/layout.ts 统一计算，组件不再各自声明宽度。
 */
export function NavRail({ items }: {
  items: { key: string; label: string; icon: ReactNode; onOpen: () => void }[];
}) {
  return (
    <nav aria-label="收起的列" className="flex w-11 shrink-0 flex-col items-center gap-1 bg-sunken py-1.5">
      {items.map((item) => (
        <button key={item.key} type="button" onClick={item.onOpen}
          aria-label={`展开${item.label}`} title={`展开${item.label}（若右侧面板开着，会先关闭面板）`}
          className="flex h-9 w-9 items-center justify-center rounded-control text-ink-500 transition-colors hover:bg-hover hover:text-ink-900">
          {item.icon}
        </button>
      ))}
    </nav>
  );
}
