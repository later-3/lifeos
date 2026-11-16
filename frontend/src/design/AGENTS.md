# design/ · 设计系统（组件注册表 + 主题引擎）

## 背景与目的

前端唯一可复用层：**页面只组装这里导出的 primitive，不自己画控件**（frontend 规范闸 2）。这里同时是主题引擎（theme.ts）与 token（tokens.css）的所在——管理形态参照 Cal.com（config 包集中 token）、Twenty（分层 + 禁直引）、Astryx（spec 表述）。

## 里面有什么

- `ui.tsx`：基础控件（Button/IconButton/ComposerButton/Modal/ConfirmDialog/Popover/Toast/Spinner/Skeleton/Tabs/Segmented/Field/Label/EmptyState/Row/SessionRow/NavRail…）
- `icons.tsx`：**图标注册表**（语义名 → tabler 映射的唯一处；页面用 `AppIcon`，禁直引——`pnpm lint:icons`）
- `theme.ts`：主题引擎（OKLCH 纯函数 → 全部 `--color-*`）+ L3 质感层（圆角/阴影/动效/字距）
- `tokens.css`：token 静态首帧（与引擎同源，测试锁一致性）
- `overlay.tsx`（Modal/ConfirmDialog）、`toast.tsx`、`rail.tsx`、`popover-view.tsx`、`fold.ts`、`image-viewer.tsx`、`resize-column.tsx`、`layout.ts`（布局宽度唯一来源）、`image-zoom.ts`

## 组件清单

<!-- design-manifest:auto BEGIN -->
## 组件清单（自动生成，pnpm design:list）

共 124 项：

- **alphaVar**（const）— `src/design/wash.ts`
- **AppIcon**（function）— `src/design/icons.tsx`
- **applySurfaceTokens**（function）— `src/design/theme.ts`
- **applyTheme**（function）— `src/design/theme.ts`
- **applyThemePack**（function）— `src/design/theme-package.ts`
- **applyWashAlphas**（function）— `src/design/theme.ts`
- **Button**（function）— `src/design/ui.tsx`
- **calculatePalette**（function）— `src/design/theme.ts`
- **clampPan**（function）— `src/design/image-zoom.ts`
- **clampState**（function）— `src/design/theme.ts`
- **clampWidth**（function）— `src/design/layout.ts`
- **clampZoom**（function）— `src/design/image-zoom.ts`
- **ClickableRow**（function）— `src/design/ui.tsx`
- **ComposerButton**（function）— `src/design/ui.tsx`
- **compositeOver**（function）— `src/design/wash.ts`
- **ConfirmDialog**（function）— `src/design/overlay.tsx`
- **CONTRACT**（const）— `src/design/theme-package.ts`
- **contrastOf**（function）— `src/design/theme.ts`
- **contrastRatio**（function）— `src/design/theme-package.ts`
- **contrastRgb**（function）— `src/design/theme.ts`
- **controlClass**（const）— `src/design/ui.tsx`
- **DEFAULT**（const）— `src/design/layout.ts`
- **DEFAULT**（const）— `src/design/layout.ts`
- **DEFAULT**（const）— `src/design/layout.ts`
- **deriveMissingVars**（function）— `src/design/theme-derive.ts`
- **derivePack**（function）— `src/design/theme-derive.ts`
- **displaySize**（function）— `src/design/image-zoom.ts`
- **dragCascade**（function）— `src/design/layout.ts`
- **DragHandle**（function）— `src/design/resize-column.tsx`
- **dragWidth**（function）— `src/design/layout.ts`
- **elevationOf**（function）— `src/design/theme.ts`
- **EmptyState**（function）— `src/design/ui.tsx`
- **extractVscodeSeed**（function）— `src/design/theme-translators.ts`
- **Field**（function）— `src/design/ui.tsx`
- **fitSize**（function）— `src/design/image-zoom.ts`
- **HANDLE**（const）— `src/design/layout.ts`
- **HANDLE**（const）— `src/design/layout.ts`
- **HANDLE**（const）— `src/design/layout.ts`
- **hex**（function）— `src/design/theme.ts`
- **ICON**（const）— `src/design/icon-sets.tsx`
- **IconButton**（function）— `src/design/ui.tsx`
- **iconOf**（function）— `src/design/icon-sets.tsx`
- **ICONS**（const）— `src/design/icons.tsx`
- **IconSetContext**（const）— `src/design/icon-context.tsx`
- **iconSetCoverage**（function）— `src/design/icon-sets.tsx`
- **ImageTrigger**（function）— `src/design/image-viewer.tsx`
- **ImageViewer**（function）— `src/design/image-viewer.tsx`
- **isHexColor**（function）— `src/design/theme-package.ts`
- **Label**（function）— `src/design/ui.tsx`
- **LAYER**（const）— `src/design/surface.ts`
- **LAYER**（const）— `src/design/surface.ts`
- **layerStyle**（function）— `src/design/surface.ts`
- **layout**（function）— `src/design/layout.ts`
- **ListSkeleton**（function）— `src/design/skeleton.tsx`
- **loadActivePackId**（function）— `src/design/theme-package.ts`
- **loadTheme**（function）— `src/design/theme.ts`
- **loadThemePacks**（function）— `src/design/theme-package.ts`
- **MAX**（const）— `src/design/layout.ts`
- **maxWidthOf**（function）— `src/design/layout.ts`
- **MessageSkeleton**（function）— `src/design/skeleton.tsx`
- **MicroButton**（function）— `src/design/ui.tsx`
- **MIN**（const）— `src/design/layout.ts`
- **MIN**（const）— `src/design/layout.ts`
- **MIN**（const）— `src/design/layout.ts`
- **MIN**（const）— `src/design/layout.ts`
- **MIN**（const）— `src/design/layout.ts`
- **MIN**（const）— `src/design/layout.ts`
- **Modal**（function）— `src/design/overlay.tsx`
- **MOTION**（const）— `src/design/theme.ts`
- **NavRail**（function）— `src/design/rail.tsx`
- **nextZoom**（function）— `src/design/image-zoom.ts`
- **normColor**（function）— `src/design/theme-package.ts`
- **oklchOf**（function）— `src/design/wash.ts`
- **parseColor**（function）— `src/design/wash.ts`
- **placePopover**（function）— `src/design/popover.ts`
- **Popover**（function）— `src/design/popover-view.tsx`
- **POPOVER**（const）— `src/design/popover-view.tsx`
- **POPOVER**（const）— `src/design/popover.ts`
- **POPOVER**（const）— `src/design/popover.ts`
- **PRESET**（const）— `src/design/theme.ts`
- **RADIUS**（const）— `src/design/theme.ts`
- **RAIL**（const）— `src/design/layout.ts`
- **relLuminance**（function）— `src/design/theme-package.ts`
- **RESIZE**（const）— `src/design/layout.ts`
- **ResizeColumn**（function）— `src/design/resize-column.tsx`
- **reviewPxOfRatio**（function）— `src/design/layout.ts`
- **reviewRatioOfPx**（function）— `src/design/layout.ts`
- **Row**（function）— `src/design/ui.tsx`
- **RowSkeleton**（function）— `src/design/skeleton.tsx`
- **saveActivePackId**（function）— `src/design/theme-package.ts`
- **saveTheme**（function）— `src/design/theme.ts`
- **saveThemePacks**（function）— `src/design/theme-package.ts`
- **SCRIM**（const）— `src/design/surface.ts`
- **Segmented**（function）— `src/design/ui.tsx`
- **SessionRow**（function）— `src/design/ui.tsx`
- **Skeleton**（function）— `src/design/ui.tsx`
- **Spinner**（function）— `src/design/ui.tsx`
- **SURFACE**（const）— `src/design/surface.ts`
- **surfaceClass**（function）— `src/design/surface.ts`
- **surfaceStyle**（function）— `src/design/surface.ts`
- **Tabs**（function）— `src/design/ui.tsx`
- **THEME**（const）— `src/design/theme.ts`
- **THEME**（const）— `src/design/theme.ts`
- **ThemePreview**（function）— `src/design/theme-preview.tsx`
- **themeToCss**（function）— `src/design/theme.ts`
- **themeWashEnvelope**（function）— `src/design/theme.ts`
- **ToastProvider**（function）— `src/design/toast.tsx`
- **ToggleChip**（function）— `src/design/ui.tsx`
- **TRACKING**（const）— `src/design/theme.ts`
- **translateObsidianTheme**（function）— `src/design/theme-translators.ts`
- **translateVscodeTheme**（function）— `src/design/theme-translators.ts`
- **useDialogFocus**（function）— `src/design/overlay.tsx`
- **useFold**（function）— `src/design/fold.ts`
- **useIconSet**（function）— `src/design/icon-context.tsx`
- **useToast**（function）— `src/design/toast.tsx`
- **validateThemePack**（function）— `src/design/theme-package.ts`
- **VAR**（const）— `src/design/theme.ts`
- **washAlphaFor**（function）— `src/design/wash.ts`
- **washAlphasOf**（function）— `src/design/wash.ts`
- **WIDTH**（const）— `src/design/layout.ts`
- **ZOOM**（const）— `src/design/image-zoom.ts`
- **ZOOM**（const）— `src/design/image-zoom.ts`
- **ZOOM**（const）— `src/design/image-zoom.ts`
- **zoomPercent**（function）— `src/design/image-zoom.ts`
<!-- design-manifest:auto END -->

## primitive spec（何时用 / 何时不用；完整契约看源码 JSDoc）

| primitive | 何时用 | 何时不用 |
|---|---|---|
| Button | 主/次操作（variant 语义：primary 全页一个、secondary 常规、ghost 次级、destructive 破坏） | 不承载导航（用链接/行点击）；不做行内小图标钮（IconButton） |
| IconButton | 图标动作钮（**label 必填**=可访问名） | 有文字的操作（Button）；布局装饰 |
| ComposerButton | 输入框的发送/停止（44 触达 + 32 视觉圆） | 其他圆形动作（用 IconButton） |
| Modal / ConfirmDialog | 模态表单 / 破坏性确认（焦点陷阱 + Esc） | 非阻断提示（Toast）；内嵌面板（Popover） |
| Popover | 锚定浮层（菜单/筛选/快捷键面板） | 模态决策（Dialog） |
| ToastProvider/useToast | 全局反馈（保存成功/失败） | 会话内留痕（行内反馈） |
| Spinner / Skeleton | 进行中 / 占位骨架 | 错误态（EmptyState 或文案） |
| Tabs / Segmented | 分区导航 / 单选切换（≤5 项） | 长表单分区（设置页分区导航） |
| Field / Label | 表单字段容器 | 纯展示文本（Text 语义类） |
| EmptyState | 空数据 + 下一步动作 | 错误详情（失败要给原因） |
| Row | 助手行等**单行**行容器（状态↔动作同格互换） | 双行会话行（SessionRow）；表格行 |
| SessionRow | 会话行（双行 56：标题 / 参与者·任务·状态；内联重命名） | 非会话列表行 |
| NavRail | 全局图标轨 | 页内分区导航（Tabs） |
| AppIcon | 一切图标（语义名类型约束） | 直接 import 图标库（禁） |

## 什么时候读 / 怎么用

- 新页面/新组件前：先查**组件清单**（自动生成段）——找不到才新增；新增必须过 design-system 样板间（`pnpm design:preview` → /dev/design-system.html）与 spec 补录；
- 主题/颜色：改 **theme.ts 引擎**（不手写 CSS 值）；tokens.css 只承首帧静态值（与引擎同源，一致性测试锁）；
- 图标：加图标 = 加注册表条目（语义名），页面用 AppIcon；
- 门禁：`pnpm lint:tokens`（无任意值）、`pnpm lint:icons`（禁直引）、`pnpm design:list`（清单一致性测试）。
