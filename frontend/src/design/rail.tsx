import type { ReactNode } from "react";

/**
 * 左侧图标轨 = **功能页切换器**（Task 0009 · 布局模型 L1）。
 *
 * 语义（`knowledge/design/layout-model.md` §1）：
 * - **rail 是 tab 栏**，不是"列开关"：点一个 tab = 切到那个功能页（`aria-current="page"`）；
 * - **再次点当前 tab = 收起列表列**（VS Code Activity Bar 语义，单人系统里"收起列表看全宽"是真需求）；
 * - **tab 可分组**（novu `navigation-group.tsx:33-38`）：业务组 / 系统组，避免 6+ tab 变成长菜单；
 * - **底部常驻系统项**（`last:mt-auto`，novu `:38` / LobeHub `NavRail` 的 flex 占位）；
 * - **可带未读徽标**（LobeHub `RailItem.tsx:39`），但我们用**边框式**而非实心（Hoppscotch `TabsNav.vue:96-104`）。
 *
 * 数值（layout-model §3）：轨宽 44、图标 16、命中盒 36、图标↔文字 8（本组件无文字，靠 tooltip）。
 * 状态语言：竖向用"文字/图标变色 + 底色"，不画指示条（Hoppscotch `:120-127`）。
 */
export type RailTab = {
  key: string;
  label: string;
  icon: ReactNode;
  /** 当前所在功能页（tab 语义，非"列展开"） */
  active: boolean;
  /** 该列已展开——用于"再点收起"的可达性提示 */
  panelOpen?: boolean;
  onClick: () => void;
  /** 未读数（>0 显示角标） */
  badge?: number;
};

export type RailGroup = { id: string; items: RailTab[] };

export function NavRail({ groups, bottom }: {
  groups: RailGroup[];
  /** 底部系统区（设置等），与业务 tab 分开（novu 的 last:mt-auto 同法） */
  bottom?: RailTab[];
}) {
  const item = (tab: RailTab) => (
    <button key={tab.key} type="button" onClick={tab.onClick}
      aria-label={tab.label}
      aria-current={tab.active ? "page" : undefined}
      title={tab.panelOpen === true ? `收起${tab.label}列表` : tab.label}
      className={`relative flex h-9 w-9 items-center justify-center rounded-control transition-colors ${
        tab.active
          ? "bg-accent-soft text-accent"
          : "text-ink-500 hover:bg-surface hover:text-ink-900"
      }`}>
      {tab.icon}
      {tab.badge !== undefined && tab.badge > 0 && (
        <span className="pointer-events-none absolute -right-0.5 -top-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full border border-nav-edge bg-surface px-1 text-micro font-semibold tabular-nums text-ink-900">
          {tab.badge > 99 ? "99+" : tab.badge}
        </span>
      )}
    </button>
  );

  return (
    <nav aria-label="左侧图标轨"
      className="flex w-11 shrink-0 flex-col items-center border-r border-nav-line bg-nav-edge py-1.5">
      {groups.map((group) => (
        <div key={group.id} className="flex flex-col items-center gap-1">
          {group.items.map(item)}
        </div>
      ))}
      {bottom !== undefined && bottom.length > 0 && (
        // 系统区推到底（不写死高度：用 flex 占位，与 novu `last:mt-auto` 同效）
        <div className="mt-auto flex flex-col items-center gap-1 pt-1">
          {bottom.map(item)}
        </div>
      )}
    </nav>
  );
}
