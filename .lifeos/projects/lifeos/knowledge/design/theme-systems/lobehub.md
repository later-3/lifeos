# LobeHub 主题系统 · 源码级分析

> 覆盖两个仓库：**产品** `lobehub/lobehub`（`canary@39c18141`）+ **设计系统** `lobehub/lobe-ui`（`33729d4`）
> 位置：本 Task `evidence/refs/`（lobehub 在 0006 Task 的 evidence 下，lobe-ui 在 0009）
> 状态：2026-11-09 逐文件读完。**所有结论带 `文件:行号`。**

## 0 一句话方案

**一套 token 生成器 + 一条 13 阶色阶 + alpha 变体**：
产品的主题不是"几套手挑色值"，而是**从 `appearance`（light/dark）× 中性色 × 主色 三输入，用纯函数算出全部 token**。
换主题 = 换输入，不是换表。

## 1 怎么布局（产品层）

| 位置 | 值 | 出处 |
|---|---|---|
| 图标轨 | **48px**，图标 16 / 描边 1.5，项命中盒 30×30，项间距 10 | `lobehub src/features/NavRail/style.ts:5-6,24-26`；`const.ts:6` |
| 列表列 | **240–400**（可拖），归一化 `Math.min(MAX, Math.max(MIN, x))` | `src/store/global/selectors/systemStatus.ts:73-74,82` |
| 内容区 | `surface`，与列表列之间有 **1px `colorBorderSecondary`**（无缝隙） | `src/features/NavPanel/components/NavPanelDraggable.tsx:33` |
| 列表列底色 | `color-mix(in srgb, colorBgContainer 55%, colorBgLayout)` ≈ `#fcfcfc`（**三档中间色**） | `src/features/NavRail/const.ts:12` |
| 外壳 | wrap 整个"列表+内容"包在圆角 12、1px 边、`0 1px 2px 3%` 的白卡里 | `src/features/NavRail/wrapStyle.ts:6-19` |
| rail 底部 | Inbox / More / Discover / Settings；`flex:1` 占位把系统项推底 | `src/features/NavRail/index.tsx:88-107` |
| rail 高亮 | `itemActive` = `colorFillSecondary` 底 + `colorText` 前景；hover = `colorFillTertiary` | `style.ts:38-42` |
| rail 角标 | `-5px/-6px` 偏移、`minWidth 15`、`height 15`、`fontSize 9`、1.5px 描边（描边色 = `colorBgLayout`） | `style.ts:8-23` |
| 行结构 | `paddingInline 4` + 图标列 `Center 28` + `gap 8`；分组头与子行**同缩进、无括线** | `src/features/NavPanel/components/NavItem.tsx:196-215`；`ByProjectMode/GroupItem.tsx:347-360` |

## 2 怎么配色（设计系统层，这是核心）

### 2.1 一条 13 阶色阶，light / lightA / dark / darkA 四份

`lobe-ui src/color/colors/gray.ts:3-58`：

```
light : #ffffff #f8f8f8 #eeeeee #e3e3e3 #dddddd #cccccc #bbbbbb #aaaaaa
        #999999 #888888 #666666 #333333 #080808          ← 13 阶（0..12）
lightA: rgba(0,0,0,.015/.03/.06/.12/.18/.24/.32/.38/.44/.5/.68/.84/.98)
dark  : #000000 #0d0d0d #1a1a1a #202020 #2d2d2d #444444 #555555 #666666
        #6f6f6f #777777 #aaaaaa #dddddd #ffffff
darkA : rgba(255,255,255,.02/.06/.10/.16/.24/.28/.32/.38/.44/.5/.66/.84/1)
```

**关键设计**：每个色相都有**实色阶 + alpha 阶**两份。alpha 阶用于"要在任何底上都成立"的交互层
（hover / fill / split / mask），实色阶用于需要固定对比的文字与描边。

### 2.2 中性色 family：**6 套预设 + 任意 hex 换色相**

`lobe-ui src/styles/theme/customNeutral.ts`：
- 预设：`gray / mauve / olive / sage / sand / slate`（`src/color/neutrals/`）；
- **任意 hex**：把默认 `gray` 的 13 阶**亮度全部保留**，只把 hue/chroma 重染成目标色的（`generateNeutralScale` `:71-100`）；
- **chroma 上限 0.05**（`MAX_CHROMA = 0.05` `:31`）——"中性必须还是中性"，不许因为染色变成彩色；
- 注释里的判断："presets peak around 0.02 oklch chroma"。
- 文字阶梯单独一张表 `neutralText`：`[text, secondary, tertiary, quaternary]`，6 套中性各有 4 阶（`token/neutralText.ts:3-26`，gray light = `#1f1f1f / #666666 / #8a8a8a / #b0b0b0`）。

### 2.3 主色 family：**预置 12 色相 + 任意 hex，按 nearest preset 重染**

`lobe-ui src/styles/theme/customPrimary.ts`：
- 12 预置（`src/color/colors/`：red/volcano/orange/gold/yellow/lime/green/cyan/blue/geekblue/purple/magenta）；
- 任意 hex：**先找最近预设**（hue 距离 + 100×亮度差，`nearestPreset` `:34-41`），再把预设的 13 阶按目标 hex 重染；
- **anchor = 第 9 阶**（`ANCHOR = 9`），锚点保持原 hex；其余阶按 `SHIFT_WEIGHT` 加权位移；
- `MIN_STEP_GAP = 0.015` 保证相邻阶不塌陷（`orderLightness` `:58-72`）；
- `MAX_CHROMA_RATIO = 2` 限制染色不要炸；
- **深色可读性自动兜底**：`readableOnDark()`（`:45-56`）——目标是"主色压深色底对比 ≥ 4.5"（`MIN_DARK_CONTRAST = 4.5`），不够就逐 0.005 提亮。

### 2.4 token 命名 = 角色 + 后缀（角色层是生成的）

`generateColorPalette.ts:22-40`：每个色相生成 14 个角色 token：

```
color{Name}Fill            (dark?A3: A4)      ← 最重的填充
color{Name}FillSecondary   (dark?A2: A3)      ← **选中/悬停用的就是它**
color{Name}FillTertiary    (dark?A1: A2)
color{Name}FillQuaternary  (dark?A0: A1)
color{Name}Bg / BgHover
color{Name}Border / BorderHover
color{Name} (base) / Hover / Active
color{Name}Text / TextHover / TextActive
```

**注意 dark 的索引整体前移一档**（dark 用 A3 当 Fill，light 用 A4）——因为深色下 alpha 的观感更弱。

### 2.5 中性 token（surface 三层 + 文字四阶）

`generateColorPalette.ts:42-62`：

| token | light | dark |
|---|---|---|
| `colorBgContainer` | `scale.light[0]` = `#ffffff` | `scale.dark[1]` = `#0d0d0d` |
| `colorBgElevated` | `light[0]` | `dark[2]` |
| `colorBgLayout` | **`light[1]` = `#f8f8f8`** | `dark[0]` = `#000000` |
| `colorBorder` | `light[3]` = `#e3e3e3` | `dark[3]` |
| `colorBorderSecondary` | `light[2]` = `#eeeeee` | `dark[2]` |
| `colorText` | `light[12]` = `#080808` | `dark[12]` = `#ffffff` |
| `colorTextSecondary` | `light[10]` = `#666666` | `dark[10]` = `#aaaaaa` |
| `colorTextTertiary` | `light[8]` = `#999999` | `dark[8]` = `#6f6f6f` |
| `colorTextQuaternary` | `light[6]` = `#bbbbbb` | `dark[6]` = `#555555` |

**light 里 layout 比 container 暗一档、dark 里 layout 比 container 暗（更黑）** —— 两个主题都是"内容浮在 layout 上"。

### 2.6 5 类语义 token + 状态 4 组 × 9 角色

- 中性：`src/styles/theme/token/neutral.ts`（另有 `getAlphaColor` 把实色反算成"在容器上等效的 alpha 色"，`:9-28`）；
- 状态：`token/palette.ts`（error/warning/info/success 各 9 角色，`docs/design-tokens.mdx` 原文："the same nine roles, generated from one tone ladder per theme"）；
- 主色：`token/primary.ts`；静态：`token/static.ts`（字号 / 圆角 / 间距 / 动效曲线全部在其中，`static.ts:3-60` 可见 4px 网格 `marginXXS 4 … marginXXL 48`）。

**字号档**（`static.ts`）：`12 / 14 / 16 / 20 / 24 / 30 / 38`，`fontWeightStrong 600`，`lineHeight 1.5714`。
圆角：`borderRadiusXS/SM/·/LG` = 4/6/8/12（`docs/design-tokens/tokens.ts:62-67`）。
动效：`motionDurationFast/Mid/Slow` = 0.1/0.2/0.3s，4 条 ease 曲线 + **3 条 spring（CSS `linear()` 归一化到 settle time）**（`docs/design-tokens.mdx` Motion 节）。

## 3 方案（他们做了什么工作）

1. **输入极小、输出极大**：用户只选 2 个东西（primaryColor / neutralColor）+ 深浅；其余 200+ token 全部由纯函数算出。
2. **色阶而不是色值**：一切从 13 阶派生，角色 token 只是"取某一阶"。所以"调到第 9 阶"这个动作能同时影响所有色相。
3. **alpha 与实色双轨**：交互层用 alpha（任何底上都成立），文字/描边用实色（对比度可断言）。
4. **自定义色不破坏体系**：任意 hex 走"最近预设 + 重染"，保证 13 阶的相对关系（`MIN_STEP_GAP`）不变。
5. **深色不是另一套值**，是同一套生成器的另一个 `appearance` 分支（含 `readableOnDark` 兜底）。
6. **主题切换 = `<html>` 上的三个 data 属性**：`data-theme` / `data-primary-color` / `data-neutral-color`（`docs/design-tokens.mdx` 开头原文），配合 `ThemeScope` 做局部主题。

## 4 怎么实现（代码路径总表）

| 关注点 | 路径 |
|---|---|
| 色阶数据（6 中性 + 12 色相，各 4 份 13 阶） | `src/color/colors/*.ts`、`src/color/neutrals/*` |
| 中性自定义 / 重染 | `src/styles/theme/customNeutral.ts:31,71-100` |
| 主色自定义 / 最近预设 / 深色兜底 | `src/styles/theme/customPrimary.ts:34-56,58-72,88-120` |
| 角色 token 生成 | `src/styles/theme/generateColorPalette.ts:22-62` |
| 中性 token（含 alpha 反算） | `src/styles/theme/token/neutral.ts:9-70` |
| 状态 4 组 | `src/styles/theme/token/palette.ts:11-40` |
| 静态 token（字号/圆角/间距/动效） | `src/styles/theme/token/static.ts` |
| 总入口 | `src/styles/theme/createLobeToken.ts:16-38` |
| CSS 变量导出 | `src/styles/theme/themeCss.ts`（+ `--lobe-*` 命名，见 `docs/design-tokens.mdx`） |
| 主题文档（活值） | `docs/design-tokens.mdx` + `docs/design-tokens/tokens.ts`（token→role 清单） |
| 产品侧布局 | `lobehub src/features/NavRail/*`、`src/features/NavPanel/*` |

## 5 我们可以直接借的（择优清单）

| 借 | 理由 | 我们的落点 |
|---|---|---|
| **13 阶色阶 + alpha 变体** | 一处定义，角色层只是取阶；改一个输入全站跟随 | `tokens.css` 引入 12 阶（我们目前只有 4 档） |
| **任意 hex → 最近预设 + 重染** | 用户自定义主色时不会破坏色阶关系 | `design/theme.ts` 的 preset 机制升级 |
| **中性 chroma 上限（0.05）** | 防止"染色后不再中性" | 我们就锁在 ≤0.035（现有值更保守） |
| **深色可读性兜底（≥4.5 自动提亮）** | 我们已经做了（AA 二分），方向一致 | 保持 |
| **`colorBgLayout` 比 `colorBgContainer` 暗一档**（light/dark 同向） | 内容浮在 layout 上，方向感稳定 | 我们 light 是反的（nav 比 surface 暗，但 rail 更暗）→ 需对齐 |
| **分组头与子行同缩进、无括线** | 已在 Task 0006 落地 | ✅ |
| **rail 底部 `flex:1` 推底** | 系统项永远在底 | ✅ 已落 |

## 6 复核触发

- `lobe-ui` 的 `gray.ts` 或 `generateColorPalette.ts` 变化 → 重核 §2.1/§2.4；
- `customPrimary` 的 `ANCHOR`/`MIN_STEP_GAP` 变化 → 重核 §2.3；
- 产品侧 `NavRail` 尺寸变化 → 重核 §1。
