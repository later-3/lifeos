import type { ReactNode } from "react";

/**
 * 左侧图标轨（Task 0009 · 布局模型 L1，2026-11-09 用户二次裁决后定稿）。
 *
 * **两类开子**（这是本产品与 LobeHub 那类产品的差异点）：
 * - `mode: "toggle"` = **列开关**：助手 / 会话。高亮 = 该列**已展开**（`aria-pressed`），
 *   点击逻辑 = **切换该列**（开着就收起、收起就展开），不涉及页面切换。
 *   为什么保留两个而不是合成一个“对话”tab：Agent × Project × Session 三级结构里，
 *   助手列与会话列是两个**可各自收起**的列（用户 2026-11-09：「这里的会话按钮还是不能少的，
 *   这是我们跟其他的项目不一样的」），合成一个 tab 会把两个独立能力压成一个开关。
 * - `mode: "tab"`（默认）= **功能页**：设置。高亮 = 当前所在页（`aria-current="page"`）。
 *
 * 分组（novu `navigation-group.tsx:33-38`）：业务列在一组、系统页推底（`mt-auto`，同 novu `last:mt-auto`）。
 * 数值（layout-model §3）：轨宽 44、图谱 16、命中盒 36、角标用**边框式**（Hoppscotch `TabsNav.vue:96-104`）。
 *
 * 激活态**不用** `accent` / `accent-soft`（2026-11-09 实测修正）：中性预设 `accentC = 0` 时
 * accent 退化成中灰 L\*48.8，比未选中图标的 `ink-500`（L\*42）**还浅** —— 唯一的信号只剩
 * 底色 3.8 的 ΔL\*（列表行是 8.5），方向还是"变亮"（三家都是变暗/变亮但更强）。
 * 现在改用与列表行**同一套选中语言**：底色 `nav-selected` + 文字升到 `ink-900`（L\*42 → 18，互比 2.34）。
 * 两个通道都活，且与 ② 区的选中语义一致（layout-model §3「竖向 rail 用底色 + 图标变色」）。
 */
export type RailTab = {
  key: string;
  label: string;
  icon: ReactNode;
  /** 列开关：该列是否已展开；功能页：是否当前页 */
  active: boolean;
  /** `toggle` = 列开关（aria-pressed）；`tab` = 功能页（aria-current） */
  mode?: "toggle" | "tab";
  onClick: () => void;
  /** 未读数（>0 显示角标） */
  badge?: number;
};

export type RailGroup = { id: string; items: RailTab[] };

export function NavRail({ groups, bottom }: {
  groups: RailGroup[];
  /** 底部系统区（设置等），与业务区开（novu 的 last:mt-auto 同法） */
  bottom?: RailTab[];
}) {
  const item = (tab: RailTab) => {
    const isToggle = tab.mode === "toggle";
    return (
      <button key={tab.key} type="button" onClick={tab.onClick}
        aria-label={isToggle ? (tab.active ? `收起${tab.label}` : `展开${tab.label}`) : tab.label}
        {...(isToggle
          ? { "aria-pressed": tab.active }
          : { "aria-current": tab.active ? ("page" as const) : undefined })}
        title={isToggle ? (tab.active ? `收起${tab.label}列` : `展开${tab.label}列`) : tab.label}
        className={`relative flex h-9 w-9 items-center justify-center rounded-control transition-colors ${
          tab.active
            ? "bg-nav-selected text-ink-900"
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
  };

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
