# LibreChat 主题系统 · 源码级分析

> 仓库：`LibreChat-AI/LibreChat`，commit `f4154b6`（2026-11-08）。
> 位置：本 Task `evidence/worktree/evidence/refs/librechat`
> 状态：2026-11-09 逐文件读完。**所有结论带 `文件:行号`。** 许可 **MIT**。

## 0 一句话方案

**"主题 = 数据（ThemeDefinition）+ 运行时写 CSS 变量 + Tailwind `@theme inline` 直接内联"**。
主题可以只声明**差异项**（缺失项回落到内置默认），所以一个主题文件可以只有 5 行；
换主题时**不重新生成 CSS**，只改 root 上的变量值。

## 1 怎么布局（侧栏 / 设置）

| 位置 | 值 | 出处 |
|---|---|---|
| 设置左栏宽 | **`w-[14.375rem]`（230px）**，内部 `flex flex-col gap-3 overflow-hidden` | `client/src/components/Nav/Settings/Sidebar.tsx:31` |
| 左栏搜索框 | 图标 16 绝对定位 `inset-s-2` 垂直居中；输入框带 `text-text-tertiary` 占位 | `Sidebar.tsx:38-45` |
| 设置项容器 | `Section`：`mb-7` + 标题 `text-xs font-medium uppercase tracking-wide` + 内容 `rounded-xl text-sm`；**注释原文**「A section is a group, not a card: spacing and the label above carry the grouping」 | `Settings/Section.tsx:14-38` |
| 设置内容 | `Content`：搜索时切"结果列表"，否则按 tab 渲染 registry 里的组件 | `Settings/Content.tsx:19-50` |
| 设置外壳 | Headless UI `Dialog` + Radix `Tabs`；窄屏是"列表→详情"两态（`mobileDetail`）；**断点用 rem 换算**（`767 * remScale`），因为面板按 rem 排版 | `Settings/Dialog.tsx:26-37` |
| 移动端细节 | `showSidebar = !isSmallScreen \|\| !inDetail`、`showContent = !isSmallScreen \|\| inDetail \|\| searching`、`hideTabs = isSmallScreen && searching` | `Dialog.tsx:33-37` |
| 侧栏选中态（Click UI 主题实测值） | light `#e6e7e9`（ΔL\* **−8.4** vs `#ffffff`）；dark `lch(27.535 0 none / 0.6)` | `packages/client/src/theme/themes/clickui.json` 的 `click.sidebar.main.navigation.item.color.background.active` |
| 侧栏 hover | light `lch(91.609 1.1023 265.86 / 0.6)`；dark `lch(19.05 0 none)` | 同上 `...background.hover` |

## 2 怎么配色

### 2.1 三层：global 语义 → 组件 token → Tailwind 内联

**① global 语义（最抽象的一层）** `packages/client/src/theme/themes/clickui.json`：

| token | light | dark |
|---|---|---|
| `global.color.background.default` | `#ffffff` | `#1f1f1c` |
| `global.color.background.muted` / `split` | `#f6f7fa` | `#282828` |
| `global.color.text.default` | `#161517` | `#ffffff` |
| `global.color.text.muted` | `#696e79` | `#b3b6bd` |
| `global.color.text.disabled` | `#a0a0a0` | `#808080` |
| `global.color.stroke.default` | `#e6e7e9` | `#323232` |
| `global.color.stroke.intense` | `#b3b6bd` | `#414141` |
| `global.color.accent.default` | `#151515`（近黑） | `#faff69`（黄绿） |
| `global.color.outline.default` | `#437eef` | `#faff69` |

**② 组件级 token（同名角色，组件各一份）**：`click.button.*`（11）、`click.dialog.*`（8）、`click.field.*`（7）、
`click.table.*`（7）、`click.checkbox.*`（6）、`click.switch.*`（6）、`click.badge.*`（4）…
**每个 token 都有自己的 light/dark 值**：160 个 token 里有 **81 个**在 dark 下不同（`clickui.json` 统计）。
这正是它"暗色是真的做了"的证据 —— 对比 novu（`dark:` 只出现在 7 个文件）。

**③ Tailwind 内联（关键实现）** `packages/client/src/theme/tokens.css:1-30` 注释原文：

> Every semantic token resolves to a CSS custom property that ThemeProvider/applyTheme rewrites at runtime,
> which is what `@theme inline` is for: the value is inlined into each utility instead of being frozen into a
> `--color-*` variable, so switching a theme re-colors the app without regenerating CSS.

```css
@theme inline {
  --color-surface-active: rgb(var(--surface-active));
  --color-surface-hover:  rgb(var(--surface-hover));
  --color-surface-primary: rgb(var(--surface-primary));
  …
}
```

- 变量体是 **`R G B` 三元组**（不是 hex），所以 Tailwind 的 `/50` 透明度修饰符能通过 `color-mix` 继续工作；
- 有内在 alpha 的 token 用**配套的 `--x-alpha` 属性**做乘法。

### 2.2 ThemeDefinition：主题是数据，可以只写差异

`packages/client/src/theme/README.md` 原文 + 示例：

```tsx
const compactTheme: ThemeDefinition = {
  version: 1, name: 'compact',
  modes: { light: { appearance: { controlRadius: '0.25rem', surfaceRadius: '0.5rem', controlHeight: '2rem' } } },
};
```

> "Definitions are data-only, may provide separate light and dark overrides, and **resolve missing values
> against LibreChat's bundled defaults before any CSS variables are applied**."

**appearance registry 覆盖**：control shape / surface shape / control height / compact·normal spacing /
UI 与 code 字体 / surface elevation / 快慢动效 / 圆角与阴影刻度（`README.md` 第 2 段）。

**且它能"重定义既有 Tailwind 工具类的含义"**：`rounded-sm…3xl` 读 `--theme-radius-*`、`font-sans` 读
`--theme-font-family`、`shadow-2xs…2xl` 读 `--theme-shadow-*`（`README.md`）——**换主题不迁移调用点**。

### 2.3 三种主题并存

`packages/client/src/theme/themes/`：`clickhouse.ts`（自研，160 token）+ `clickui.json`（**从 ClickHouse/click-ui
`v0.15.0` @`00d99f9` 导入的完整 token 集**）+ `highContrast`。
说明它把"主题"做成了**可移植的产物**（能从一个独立的组件库整体导入）。

### 2.4 应用机制（无重新生成）

`packages/client/src/theme/utils/applyTheme.ts`：
- `describeResolvedTheme(theme)` → `{ properties, attributes }`，逐条 `root.style.setProperty()`（`:50-60`）；
- 清除用 `clearAppliedTheme()`：把 `themeOwnedProperties` 逐个 removeProperty + 4 个 data 属性（`:34-41`）；
- **`THEME_SCOPE_ATTRIBUTE = 'data-theme-scope'`**：非根节点也能套主题（局部主题）；
- **`THEME_BOOT_ATTRIBUTE = 'data-theme-boot'`**：`index.html` 里预涂一次主题防闪（FOUC），provider 启动后丢弃该副本（`:20-27`）。
  这与我们"localStorage 读主题再 applyTheme"是同一目标，但它更彻底（**首屏就正确**）。

### 2.5 字号 / 圆角 / 阴影

- 字号：`typography.font.sizes.1…6` = `0.75 / 0.875 / 1 / 1.125 / 1.25 / 2rem`；weights `500`；`line-height 1.5`（`clickui.json`）；
- 圆角：`border.radii.1…3` = `0.25 / 0.5 / 0.75rem` + `full`；
- 阴影：`--theme-shadow-2xs…2xl` 全部可被主题覆盖（`README.md`），`elevationSurface` / `elevationDrag` 是独立角色。

## 3 方案（他们做了什么工作）

1. **"主题 = 数据 + 缺省回落"**：主题文件只写要改的项，其余回落默认 —— 所以新增主题成本极低。
2. **`@theme inline`**：把 CSS 变量**内联进 utility**，主题切换**不重新生成样式表**（这是比"每个 token 都是一个 `--color-x`"更省的一步）。
3. **RGB 三元组 + alpha 配套属性**：既支持 Tailwind 的 `/50`，又支持"token 自带 alpha"。
4. **组件级 token**（`click.button.*` / `click.dialog.*`）：同一个角色在不同组件可以有不同的值 —— 比"全局一套语义"更精细。
5. **主题可移植**：整套 token 能从外部组件库（click-ui）导入。
6. **防闪**：`data-theme-boot` 预涂 + provider 启动后接管。

## 4 怎么实现（代码路径总表）

| 关注点 | 路径 |
|---|---|
| Tailwind 语义 token（`@theme inline`） | `packages/client/src/theme/tokens.css:1-70+` |
| 默认值（stub，每个属性的内置默认） | `packages/client/src/theme/defaults.css` |
| 主题定义类型 / 校验 | `packages/client/src/theme/index.ts`、`defaults.spec.ts`、`semanticTokens.spec.ts` |
| 应用/清除/局部作用域/防闪 | `packages/client/src/theme/utils/applyTheme.ts:20-80` |
| 主题数据（Click UI 完整 160 token） | `packages/client/src/theme/themes/clickui.json` |
| 主题数据（自研 palette） | `packages/client/src/theme/themes/clickhouse.ts`（`surface-active` 等，`:60-90` light / `:260-290` dark） |
| 主题机制说明 | `packages/client/src/theme/README.md` |
| 设置页骨架 | `client/src/components/Nav/Settings/{Dialog,Sidebar,Section,Content,registry}.tsx` |
| 设置项 registry + 搜索 | `client/src/components/Nav/Settings/registry.tsx`、`types.ts:17-57`、`search.ts:1-20` |

## 5 我们可以直接借的（择优清单）

| 借 | 理由 | 落点 |
|---|---|---|
| **`@theme inline` + CSS 变量** | 换主题不重生成样式表，且 utility 不变 | 我们 `tokens.css` 现在把值写死在 `@theme` 里 → 改成内联 |
| **RGB 三元组 + `--x-alpha` 配套** | 支持 `/50` 透明修饰 + token 自带 alpha | 我们的 token 是 hex → 改三元组 |
| **主题 = 只写差异项，其余回落默认** | 新增主题成本极低（5 行就能出一套） | `design/theme.ts` 的 preset 改成"差异 + 默认" |
| **组件级 token**（button/dialog/field 各自一套） | 同一角色在不同组件可不同值 | 我们先只在"导航/内容/卡片"三处分开，不铺到每个组件 |
| **`data-theme-scope` 局部主题** | 预览区/嵌页面能独立主题 | 设置页的预览区 |
| **`data-theme-boot` 防闪** | 首屏就正确，不闪 | 我们 `index.html` 内联脚本 |
| **设置项 registry + keywords 搜索** | 40+ 项后必需要 | 设置页（已在 `layout-model.md` §2.2 定） |
| **窄屏"列表→详情"两态 + rem 断点** | 面板按 rem 排版时，断点也要 rem | 设置页手机端 |

## 6 不借

| 不借 | 理由 |
|---|---|
| 弹窗式设置（`Dialog`） | 用户 2026-11-09 明确要求设置是**独立 tab**，不是浮层 |
| 160 个组件级 token 全铺 | 我们组件少，先按"层"分（nav/content/card），避免 token 爆炸 |
| `lch()` / `rgb()` 混用 | 我们统一 OKLCH→sRGB 生成，不混三套色彩写法 |
| 它的 Radix/Jotai/Headless UI 栈 | 技术栈不同，只借机制 |

## 7 复核触发

- `tokens.css` 的 `@theme inline` 结构变化 → 重核 §2.1；
- `ThemeDefinition` 增加新的 appearance 字段 → 重核 §2.2；
- `clickui.json` 更新（它跟随 click-ui 版本）→ 重核 §2.1 的 sidebar 数值。
