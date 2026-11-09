import type { ReactNode } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";

/**
 * 可拖宽的列（**唯一实现**）。
 *
 * 为什么要有这个组件（2026-11-09 用户）：
 * > 「你右边的那个文件树展开之后的拖动呢？难道不应该是统一的吗？
 * >  每个区域都是需要我来单独给你点出来吗？以后新增是不是也不会按照丝滑的方案呢？
 * >  这里是不是在前端架构上就应该统一一个方案，且落地背后也是一套呢？」
 *
 * 当时的事实：拖拽的"跟手"逻辑（写 DOM + rAF 合并）只认一张手写映射表，
 * 表里只登记了 c1/c2 两列；完整历史（c5）、文件面板（c4）、文件树（c4t）**三处都被漏掉**，
 * 拖动时宽度全程不动、松手才跳。另外文件树的把手被父级 `overflow-hidden` 裁掉一半，
 * 连按都按不到（实测：把手中心命中的是文件面板的页签行）。
 *
 * 所以把"一个可拖宽区域"收敛成一个组件 + 一条约定：
 * - **写 `ResizeColumn key="cX"`，就自动具备**：逐帧跟手的拖动、把手命中区、hover 高亮；
 * - 新增可拖区域**不需要改任何拖拽代码**，也不存在"要记得登记到映射表"这一步；
 * - 门禁会自动枚举页面上所有 `[data-resize-key]`，逐个验证「把手可命中 + 拖动逐帧变化」，
 *   漏了任何一个都会红（`frontend/test/ui-contract.mjs`）。
 *
 * 关于 `overflow`：把手是 `absolute` 且**溢出到列外 4px**（左右各半，落在分界线上）。
 * 容器若 `overflow-hidden` 会把溢出的一半裁掉，`elementFromPoint` 就落到相邻区域上，
 * 鼠标按下去根本没有 mousedown —— 表现是"拖不动"而不是"拖了不跟手"。
 * 因此本组件**自带 `overflow-visible`**，需要裁切的内容请放在 `children` 自己的内层容器里。
 */
export type ResizeKey = "c1" | "c2" | "c3" | "c4" | "c4t" | "c5";

export function DragHandle({ onStart, side = "right" }: {
  onStart: (event: ReactMouseEvent) => void;
  side?: "right" | "left";
}) {
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={side === "right" ? "拖动调整宽度" : "拖动调整宽度（左侧面板）"}
      onMouseDown={onStart}
      // z-30 高于列内任何内容（含页签行、文件树行），保证把手永远是最上层的命中目标。
      className={`group/handle absolute inset-y-0 z-30 flex w-2 cursor-col-resize items-center justify-center ${
        side === "right" ? "-right-1" : "-left-1"
      }`}>
      {/* 静止透明；hover / 拖动期间（body 光标为 col-resize）才浮出 2px 高亮 */}
      <span aria-hidden
        className="h-full w-0.5 rounded-full bg-transparent transition-colors group-hover/handle:bg-accent" />
    </div>
  );
}

export function ResizeColumn({ resizeKey, side = "right", width, onStart, className = "", children, testId, as = "aside" }: {
  /** 布局里的宽度键（`design/layout.ts` 的 Widths）。拖动时按它找元素、松手按它提交。 */
  resizeKey: ResizeKey;
  /** 把手在哪条边：右缘（左侧列）= right，左缘（右侧停靠面板）= left。 */
  side?: "right" | "left";
  /** 当前宽度（px 或 "100%"）。拖动期间由 JS 直接覆盖，松手后交还给 React。 */
  width: number | string;
  /** 拖动开始（`useColumnWidth().beginDrag(resizeKey, event)`）。 */
  onStart: (event: ReactMouseEvent) => void;
  className?: string;
  children: ReactNode;
  testId?: string;
  /**
   * 语义标签。默认 `aside`（它确实是一条侧栏：`aside` 在 HTML 语义里就是"与主内容并列的
   * 补充区域"）；面板**内部**的子列（文件树）用 `div`，因为它不是与主内容并列的独立区域。
   * 这不只是可访问性：既有门禁与截图脚本按 `aside` 取列，换标签会让那些断言全部失效。
   */
  as?: "aside" | "div";
}) {
  const Tag = as;
  return (
    <Tag
      data-resize-key={resizeKey}
      {...(testId !== undefined ? { "data-testid": testId } : {})}
      style={{ width }}
      // overflow-visible 是**必须**的：见文件头注释（overflow-hidden 会把把手裁掉一半，
      // 鼠标按不到就完全拖不动）。要裁切请在 children 内层做。
      className={`relative flex shrink-0 overflow-visible ${className}`}>
      {children}
      <DragHandle side={side} onStart={onStart} />
    </Tag>
  );
}
