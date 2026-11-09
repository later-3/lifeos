# novu 主题系统 · 源码级分析

> 仓库：`novuhq/novu`，commit `46ff54b`（2026-11-07），控制台在 `apps/dashboard`。
> 位置：本 Task `evidence/worktree/evidence/refs/novu`
> 状态：2026-11-09 逐文件读完。**所有结论带 `文件:行号`。**
> 许可：有 `LICENSE-MIT` + `LICENSE-ENTERPRISE` 双许可 —— **只读结构与数值，不复制企业版代码**。

## 0 一句话方案

**一套 HSL 三段式色阶（0–950）× 两族透明色（alpha）× Tailwind v4 `@config` 映射**。
它的强项不是"主题算法"，而是**命名体系与密度刻度**：`foreground-*` / `neutral-*` 两族同值、语义层（`text-strong/weak`、`stroke-soft`）压在上面。

## 1 怎么布局

| 位置 | 值 | 出处 |
|---|---|---|
| 侧栏分组可折叠 + **折叠状态持久** | `localStorage['nv_side_nav_group_collapsed:' + label]` | `apps/dashboard/src/components/side-navigation/navigation-group.tsx:6-17` |
| 分组标题 | `text-sm font-medium text-text-soft` + 右箭头 `size-3.5` 旋转 90° | `:52-55` |
| 折叠动画 | `animate-collapsible-up/down` + 内容 `transition-opacity` | `:58-64` |
| **最后一项推底** | `last:mt-auto`（分组是最后一个子元素时自动推底） | `:38` |
| 侧栏内部件 | `SidebarHeader`（`gap-2.5 px-2 py-3.5`）/ `SidebarContent`（cva 三档 `sm/md/lg`：`gap-2 px-3 py-2` … `gap-2.5 px-3 py-4`）/ `SidebarFooter`（`mt-auto border-t p-2`） | `apps/dashboard/src/components/side-navigation/sidebar.tsx:6-31` |
| 导航行 | cva 三态：`default 'text-foreground-600/95 hover:bg-accent'` / `selected 'text-foreground-950 bg-neutral-alpha-100'` / `disabled`；尺寸 `gap-2 py-1.5 px-2 rounded-lg` | `navigation-link.tsx:7-18` |
| **选中判定基于路由** | `pathname === to \|\| pathname.startsWith(to) \|\| matchPaths.some(...)` | `navigation-link.tsx:37-41` |
| 分组清单 | Agents / Notifications / Data / Monitor / Developer / Platform（6 组） | `side-navigation.tsx:175,183,209,230,269,306` |
| Tabs（regular 变体） | 底部 2px `bg-primary` 滑块，`transition-all duration-300`，缓动 `cubic-bezier(0.65,0,0.35,1)`，位置用 `translate3d` 实时测量（`useTabObserver`） | `components/primitives/tabs.tsx:30-69` |
| Segmented control | 容器 `rounded-[10px] bg-neutral-100 p-1`；**浮动白块** `shadow-toggle-switch rounded-[6px] bg-white`，同缓动 | `components/primitives/segmented-control.tsx:24-56` |

**布局的两个可借点**：① 分组折叠 + 状态持久（比 LobeHub 的 rail 分组多做了一步"记住"）；
② 选中态用 `bg-neutral-alpha-100`（**alpha 而不是实色**），所以它能同时适配浅/深底。

## 2 怎么配色

### 2.1 一套 HSL 三段式色阶（0–950，12 档）

`apps/dashboard/src/index.css:184-199`（gray 族）：

```
--gray-0:   210 10% 100%     --gray-500: 221 8%  48%     --gray-900: 226 21% 12%
--gray-50:  0   0%  98%      --gray-600: 222 11% 36%     --gray-950: 222 32% 8%
--gray-100: 210 30% 96%      --gray-700: 221 16% 20%
--gray-200: 220 18% 90%      --gray-800: 227 17% 16%
--gray-300: 219 15% 82%
--gray-400: 220 11% 64%
```

**关键细节**：色相不是纯 0，而是 **210–227 的蓝灰**（统一色相族），饱和度 0–32%。这就是"有设计感的灰"。
`--foreground-*` 与 `--gray-*` **同值双名**（`:186-197` vs `:235-241`）：前者用于文字，后者用于底色/描边，**语义分层但取值一份**。

### 2.2 两族透明色（alpha）

`:239-251`：

```
--neutral-alpha-24: 220 11% 64% / 24%    --novu-alpha-24: 346 73% 50% / 24%
--neutral-alpha-16: …           / 16%    --novu-alpha-16: …          / 16%
--neutral-alpha-10: …           / 10%    --novu-alpha-10: …          / 10%
--neutral-alpha-50: 0 0% 69% / 0.05     ← hover（5%）
--neutral-alpha-100: 210 30% 61% / 0.1  ← **选中（10%）**
--neutral-alpha-200: 220 18% 50% / 0.2
--neutral-alpha-300: 218 23% 40% / 0.3
--neutral-alpha-400: 220 100% 10% / 0.4 (dark 混合)
--neutral-alpha-500: 240 100% 2% / 0.5
--neutral-alpha-600…800: 0 0% 0% / .6/.7/.8   ← 遮罩
```

**为什么是 alpha**：注释原文「Neutral scale in alpha that looks the same on white background」（`:194`）——
同一组 alpha 值在浅色与深色底上都成立，所以**不用维护两套**。这是它最省事的一点。
代价：alpha 叠在彩色底上会偏色，所以彩色区域不能只用 alpha。

### 2.3 主色族

`:201-217`：`--novu-800/700/500/400(80%)/300(60%)/200(40%)/100(20%)/50(10%)` + `--primary: var(--novu-500)`，
再叠一层语义别名 `--primary-dark/-darker/-base/-alpha-24/-16/-10`。主色 hue 固定 **346**（品红）。

### 2.4 语义层（真正的产品词汇）

`:420-470` 一带：`--faded/dark`、`--information/--warning/--error/--success/--away` 各有 `-light/-dark/-lighter` 变体，
即"**一个语义 = 三档明度**"。这比 LobeHub 的 9 角色轻，但对控制台够用。

### 2.5 字号刻度（非常细，16 档）

`apps/dashboard/tailwind.config.ts:20-180`，命名是"用途 + 尺寸"：

| 组 | 档 | 值（size / lineHeight / letterSpacing / weight） |
|---|---|---|
| title | h1…h6 | 56/48/40/32/24/20，lineHeight 64/56/48/40/32/28，**letterSpacing −0.035em…0**，weight 500 |
| label | xl/lg/…/xs | 24/18/…/12，letterSpacing −0.0225em…0，weight **500** |
| paragraph | lg/md/sm/xs | 16/14/14/12，weight **400** |
| subheading | md/sm/2xs | 16/…，letterSpacing **+0.06em**（唯一正字距） |

**注意**：`label` 与 `paragraph` 同尺寸但**字重不同**（500 vs 400）——用字重分层，不用字号堆层级。
这与我们"5 档字号 + 字重"思路一致，但它的标题字距是**负的**（大字收紧），我们目前是 0。

### 2.6 圆角 / 阴影

- 圆角：`4/6/8/10/12/16/20/24/full`（`:3-13`），比我们 5 档多，但**命名按像素值**（`rounded-10`），不是角色名；
- 阴影 7 档（`:215-235`）：`xs 0 1px 2px 3%`、`sm` 双层、`md 0 16px 32px −12px 10%`、`popover`、`box-xs`（1px 描边影 + 2px 柔影）、
  外加 **5 个专用阴影**（switch 轨道/手柄/focus 各一套，`switch-track` 是 5 层 inset 叠加）。
  → 我们只有 3 档；它的 `box-xs`（描边影 + 柔影）正是"悬浮卡"的手法。

### 2.7 暗色：**薄**

全仓 `dark:` 前缀只出现在 **7 个文件**（`grep -rl "dark:" apps/dashboard/src --include=*.tsx | wc -l` = 7），
且集中在 changelog 卡片等局部。`tailwind.config.ts:238` 声明了 `darkMode: ['class']`，
但 `index.css` 里**没有 `.dark { --background: … }` 整块变量覆盖**。

**结论**：novu 是一个**以浅色为主、暗色未完成**的控制台。
→ 对我们的意义：**不能拿它当暗色参考**；暗色只能参考 LobeHub / LibreChat。

## 3 方案（他们做了什么工作）

1. **色阶 12 档 + 统一蓝灰色相（210–227）**：灰也有色相，全站气质统一。
2. **alpha 双份**：交互层（hover 5% / 选中 10%）用 alpha，一值两主题通用。
3. **语义层薄**：`text-strong/weak`、`stroke-soft`、`faded`、5 个状态 ×3 档 —— 够用即可，不做 9 角色矩阵。
4. **密度靠字号刻度**：16 档 `title/label/paragraph/subheading`，用**字重**区分同尺寸的层级，标题负字距。
5. **动效统一两处**：Tab 指示条与 segmented 浮块共用 `cubic-bezier(0.65,0,0.35,1)` + `300ms` + `translate3d`（GPU 友好）。
6. **设置/侧栏的"分组"是产品词汇**：6 个分组名（Agents/Notifications/Data/Monitor/Developer/Platform），不是简单罗列。

## 4 怎么实现（代码路径总表）

| 关注点 | 路径 |
|---|---|
| 色阶 + alpha + 语义变量 | `apps/dashboard/src/index.css:159-500`（`@layer base` 的 `:root`） |
| Tailwind 映射（颜色/字号/圆角/阴影） | `apps/dashboard/tailwind.config.ts:3-235` |
| 侧栏骨架 | `apps/dashboard/src/components/side-navigation/sidebar.tsx` |
| 分组折叠 + 持久化 | `.../navigation-group.tsx:6-64` |
| 导航行三态 | `.../navigation-link.tsx:7-18,37-41` |
| Tab / Segmented 动效 | `.../primitives/tabs.tsx:30-69`、`.../primitives/segmented-control.tsx:24-56` |
| Badge（4 变体 × 2 尺寸） | `.../primitives/badge.tsx:15-50` |

## 5 我们可以直接借的（择优清单）

| 借 | 理由 | 落点 |
|---|---|---|
| **灰带统一色相（210–227，S≤32%）** | 一致气质 + 不脏 | 我们 `nav-*` 已锁同族，但 `line`/`ink` 仍是不同族 → 统一 |
| **alpha 双份做交互层（hover 5% / 选中 10%）** | 一值两主题通用 | 我们的 `nav-accent/nav-selected` 目前是实色，可考虑改 alpha |
| **分组折叠状态按 id 持久** | 比 LobeHub 多一步 | rail 分组（key 用稳定 id，不用 label） |
| **同尺寸用字重分层（label 500 vs paragraph 400）** | 不堆字号 | 我们 `meta`/`body` 已有此意，可写死成规则 |
| **标题负字距（−0.035em）** | 大字更紧、更像排版而非 UI | `title` 档加负字距 |
| **`box-xs` 阴影（描边影 + 柔影）** | "悬浮卡"最小代价 | 动态流卡片 |
| **Tab 指示条 `translate3d` + 统一缓动** | 60fps 且一致 | 设置页横向 tab |

## 6 不借

| 不借 | 理由 |
|---|---|
| 它的暗色方案 | 未完成（`dark:` 仅 7 个文件、无 `.dark` 变量块） |
| 按像素命名圆角（`rounded-10`） | 我们的角色命名（`control/panel/bubble`）更能表达意图 |
| 16 档字号全搬 | 我们 5 档 + scale 已够；多档会让"该用哪档"变成选择题 |
| 企业版代码 | 许可边界 |

## 7 复核触发

- `index.css` 的 `:root` 变量块变化 → 重核 §2.1/§2.2；
- 出现 `.dark { … }` 整块 → 暗色方案要重评（可能可用）；
- `tailwind.config.ts` 的字号刻度变化 → 重核 §2.5。
