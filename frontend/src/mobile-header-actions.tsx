/**
 * 手机头部"更多"动作层（Task 0016 · P7-S5）。
 *
 * ## 为什么需要
 *
 * 手机头部原来平铺 **6 个图标钮**（返回 / 完整历史 / 检视 / 选 Task / 文件面板 / 设置），
 * 实测标题可用宽度：430px → 78px、390px → **38px**、360px → **8px**、≤336px → **0px**
 * （`evidence/shots/chat-360.png` 里标题只剩半个字）。
 *
 * 问题不是命中区（每个都是 44），是**数量**——标题被挤到不可读。
 *
 * ## 形态（借 pi-web `components/AppShell.tsx:1803-1900`）
 *
 * 头部只留「返回 · 标题 · ⋯」；点 ⋯ **在原地展开一条动作层**（不占额外高度、不遮挡消息区），
 * 里面是全部 5 个动作；再点变 ✕ 收起。
 *
 * 为什么不是下拉菜单：下拉会盖住消息区第一行；原地覆盖只占用头部那一行。
 * 为什么不是底部 Tab：那是信息架构改动（需先定"消息/项目/设置"三页内容），
 * 而且核过三个参考项目都没在聊天页用底部 Tab（`knowledge/reference-mobile.md` §7）。
 *
 * ## 焦点纪律（三条件关闭）
 *
 * 覆盖期间被盖住的控件必须 `aria-hidden` + `tabIndex={-1}`，否则键盘 Tab 会跳进看不见的元素。
 * 关闭三条件：外部 `pointerdown`（`composedPath` 判定）、`Esc`、切换会话/Agent。
 * 三条各自有断言（`frontend/test/mobile-contract.mjs`）。
 *
 * ## 动作是**声明式注册**（不是逐个写死）
 *
 * 规范 2.3：同类第二次出现 → 容器 + 注册项。这里的"容器"是本组件，
 * "注册项"是 `MobileHeaderAction[]`（id / label / icon / onSelect / active / disabled）。
 * 加动作只改注册表，不改布局。
 */
import { useEffect, useRef } from "react";
import { AppIcon, type IconName } from "./design/icons";
import { IconButton } from "./design/ui";
import { LAYER_CLASS } from "./design/surface";

/** 一个头部动作（声明式注册项）。 */
export type MobileHeaderAction = {
  /** 稳定 id（测试与 `data-mobile-toolbar-action` 用）。 */
  id: string;
  /** 可访问名（也用作 title）。 */
  label: string;
  icon: IconName;
  onSelect: () => void;
  /** 当前生效（如图标钮的 active 态）。 */
  active?: boolean;
  /** 不可用（如"完整历史"在草稿态）。 */
  disabled?: boolean;
};

/** 头部高度：与现状一致（44），动作层原地覆盖同一行。 */
const HEADER_ROW = "h-11";

export function MobileHeaderActions({ open, onToggle, onClose, actions }: {
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  actions: readonly MobileHeaderAction[];
}) {
  const root = useRef<HTMLDivElement>(null);

  /* 外部 pointerdown 关闭：用 composedPath 判定，避免"点在层内但 target 被 React 重渲染换掉"时误关 */
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const node = root.current;
      if (node === null) return;
      if (event.composedPath().includes(node)) return;
      onClose();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [open, onClose]);

  /* Esc 关闭：捕获阶段，避免被内层输入框先吃掉（本层里没有输入框，但保持一致） */
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [open, onClose]);

  /*
   * ## 这个容器的宽度是 44，不是"剩余空间"（2026-11-17 用户实测抓到的真 bug）
   *
   * 之前它写 `flex-1`，我以为会撑满头部剩余宽度。**不会**：头部里标题是 `min-w-0` 但没有
   * `flex-1`，它的 flex-basis 是内容宽度 → 把剩余空间吃光了；本容器 `flex: 1 1 0%` 拿到的是 44。
   * 于是 `absolute left-11 right-0` 的动作层宽度 = 44 − 44 = **1px**，4 个按钮渲染在
   * x=375/419/463/507（全在屏幕外）。
   *
   * 现在的做法：容器**不占布局**（`absolute` 定位到头部右侧的 ⋯ 位置），
   * 动作层相对**头部**（`header` 是 `relative`）展开，从「返回按钮之后」到「右侧 ⋯ 之前」。
   * 标题在展开期间被遮住是刻意的：选动作时不需要读标题，而铺满才是唯一能让 4 个动作
   * 都落在可点区域内的排法（pi-web `AppShell.tsx:1803-1900` 同形）。
   */
  return (
    <div ref={root} className={`flex items-stretch ${HEADER_ROW}`} data-mobile-toolbar={open ? "open" : "closed"}>
      {/*
        ⋯ 按钮**常驻**（是这一层的开关）：它必须一直在，否则"打开之后怎么关"取决于
        层里有没有关闭钮——那会让收起路径随动作清单一变就坏。
      */}
      <IconButton label={open ? "收起操作" : "更多操作"} size="lg" active={open}
        data-mobile-toolbar-more="true" aria-expanded={open}
        onClick={onToggle} className="relative z-[1]">
        <AppIcon name={open ? "x" : "adjustments-horizontal"} size={16} />
      </IconButton>

      {/*
        动作层：原地覆盖在 ⋯ 右侧（`left` 让开 ⋯ 的 44px），不占额外高度。
        `absolute` + `inset-y-0` 保证高度等于头部那一行；列表用 `overflow-x-auto` 兜住
        动作变多的情况（宁可横滑，也不把标题挤回去）。
      */}
      {open && (
        /*
         * 动作层的**定位父级必须是 `header`**，不是这个容器：本容器宽度只有 44（见上方注释），
         * 以它为父级时 `left-11 right-11` 算出 44 − 44 − 44 < 0 → 压成 1px。
         * 所以本容器**不用 `relative`**，由 `App.tsx` 的 `<header className="relative …">` 承担定位父级。
         *
         * `left-11 right-11` = 让开左边的返回按钮与右边的 ⋯ 本身；
         * 为什么留出 ⋯：它是"收起"的唯一入口，被动作盖住就关不掉了。
         */
        <div id="mobile-toolbar-actions" role="toolbar" aria-label="更多操作"
          data-mobile-toolbar-actions="true"
          className={`absolute inset-y-0 left-11 right-11 z-[1] flex items-stretch overflow-x-auto border-l border-line bg-surface/95 backdrop-blur-sm ${LAYER_CLASS.popover}`}>
          {actions.map((action) => (
            <IconButton key={action.id} label={action.label} size="lg"
              active={action.active === true}
              {...(action.disabled === true ? { disabled: true } : {})}
              data-mobile-toolbar-action={action.id}
              className="shrink-0 rounded-none border-r border-line last:border-r-0"
              onClick={() => { onClose(); action.onSelect(); }}>
              <AppIcon name={action.icon} size={16} />
            </IconButton>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * 手机头部动作清单（**唯一注册处**，规范 2.3：同类第二次出现 → 容器 + 注册项）。
 *
 * 四个动作与桌面一一对应：完整历史 / 检视（打开当前 Task）/ 文件面板 / 设置。
 * 桌面的"选择要检视的 Task"**不在这里**：手机动作层只有 4 个位置，
 * 而 Task 切换本来就在检视面板内部（`review-switcher-select`），单列只是重复入口。
 *
 * 为什么是工厂函数而不是常量数组：`disabled`/`active` 依赖当前状态
 * （草稿态没有历史、面板开着要显示 active）。数组本身仍是声明式的，只是把状态算进来。
 */
export function MOBILE_HEADER_ACTIONS(input: {
  historyOpen: boolean;
  reviewOpen: boolean;
  panelOpen: boolean;
  settingsOpen: boolean;
  sessionId: string | undefined;
  onHistory: () => void;
  onReview: () => void;
  onFiles: () => void;
  onSettings: () => void;
}): MobileHeaderAction[] {
  return [
    {
      id: "history",
      label: "完整历史",
      icon: "history",
      active: input.historyOpen,
      // 草稿态没有历史可看（桌面的按钮同样 disabled）
      disabled: input.sessionId === undefined,
      onSelect: input.onHistory,
    },
    { id: "review", label: "检视当前 Task 的改动", icon: "git-compare", active: input.reviewOpen, onSelect: input.onReview },
    { id: "files", label: input.panelOpen ? "收起文件面板" : "展开文件面板", icon: "layout-sidebar-right", active: input.panelOpen, onSelect: input.onFiles },
    { id: "settings", label: "打开设置", icon: "settings", active: input.settingsOpen, onSelect: input.onSettings },
  ];
}
