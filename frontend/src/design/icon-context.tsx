/**
 * 图标集上下文（Task 0015 · S3）。
 *
 * 为什么用 Context 而不是全局变量：`AppIcon` 在深层组件树里被大量调用，
 * 走 Context 才能让"切换图标集"这一件事只触发一次重渲染，且天然跟随 React 生命周期。
 * 默认值 tabler —— 与 A1 的行为一致（没配置时不改变任何东西）。
 */
import { createContext, useContext } from "react";
import type { IconSetId } from "./icon-sets";

export const IconSetContext = createContext<IconSetId>("tabler");

export function useIconSet(): IconSetId {
  return useContext(IconSetContext);
}
