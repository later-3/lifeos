# 三家横向对比与择优（LobeHub / LibreChat / novu）

> 状态：2026-11-09。**这是决策文档**：三家各自做到什么程度、我们要取哪一个、为什么。
> 详细源码级分析见同目录 `lobehub.md` / `librechat.md` / `novu.md`。

## 1 一句话对比

| | LobeHub（lobe-ui） | LibreChat | novu |
|---|---|---|---|
| 方案内核 | **13 阶色阶 + 纯函数生成** | **主题 = 数据 + `@theme inline` 运行时变量** | **HSL 12 档 + alpha 双份** |
| 自定义能力 | 任意 hex → 最近预设重染（13 阶关系不变） | 主题只写差异，缺省回落默认 | 固定色阶，改值要改变量块 |
| 暗色 | **同等完整**（同一生成器另一分支 + 自动提亮兜底） | **最完整**（160 token 中 81 个有独立暗色值） | **几乎没有**（`dark:` 仅 7 个文件） |
| 换主题的成本 | 重新计算 token（纯函数，快） | **不重生成 CSS**（inline 变量） | 改一把变量 |
| 组件级 token | 有（每个色相 14 角色） | **有且更细**（`click.button.*` / `click.dialog.*`） | 薄（语义层 3 档） |
| 主题可移植 | 弱（绑定自己的色系） | **强**（能整套导入外部库 click-ui 的 token） | 无 |

## 2 关键数值对比（都在各自文档里带行号）

| 量 | LobeHub | LibreChat | novu | 我们（现状） |
|---|---|---|---|---|
| 侧栏底色 vs 内容 | `#f8f8f8` vs `#ffffff`（ΔL\* 2.4） | `#f6f7fa` vs `#ffffff`（2.8） | `#fafafa` vs `#ffffff`（1.7） | `#f7f6f5` vs `#ffffff`（3.1） |
| **侧栏选中 ΔL\*** | **5.2**（fill .06） | **8.4**（`#e6e7e9`）；侧栏专用档 17.0 | **3.3**（alpha .1） | 12.6（刚改） |
| 侧栏 hover ΔL\* | 2.8（fill .03） | 8.4（与选中同色，靠字重区分） | 1.4（alpha .05） | 4.5 |
| 暗色 选中 ΔL\* | 同法派生 | **15.9**（`#414141`） | — | 15.7（≈LibreChat） |
| 色阶档数 | **13 + 13 alpha** | 组件级 token（非色阶） | **12 + 4 alpha** | 4（surface/sunken/nav-bg/rail） |
| 中性色相 | 6 套预设，chroma ≤0.05 | 无中性预设（固定在主题里） | 210–227 蓝灰统一 | 跟随主色 |
| 字号档 | 7（12/14/16/20/24/30/38） | 6（0.75–2rem） | **16（title/label/paragraph/subheading）** | 5 |
| 圆角 | 4 档（4/6/8/12） | 3 档 + full | 9 档（按像素命名） | 5 档（角色名） |
| 动效 | 3 spring（CSS `linear()`） | 快/慢 + 自定义曲线 | 2 处统一曲线 `cubic-bezier(.65,0,.35,1)` 300ms | 1 处 arc |

## 3 择优：我们该取什么（逐项决策）

### 3.1 主题生成机制 —— 取 LobeHub 的"色阶 + 纯函数"，取 LibreChat 的"运行时 inline"

| 取 | 出处 | 我们要做的 |
|---|---|---|
| **13 阶色阶 + alpha 变体** | `lobe-ui src/color/colors/gray.ts:3-58` | 我们只有 4 档，扩成 12–13 阶（含 alpha 份） |
| **任意 hex → 最近预设 + 重染 + 相对关系守恒** | `customPrimary.ts:34-72` | 用户选主色时，不要打破色阶间距 |
| **中性 chroma 上限** | `customNeutral.ts:31`（0.05） | 我们 ≤0.035 更保守，保持 |
| **深色可读性自动兜底** | `customPrimary.ts:45-56`（≥4.5 提亮） | 我们已有 AA 二分，保持 |
| **`@theme inline` + RGB 三元组** | `librechat tokens.css:1-30` 注释 | `tokens.css` 从"写死值"改成"内联变量" |
| **主题只写差异、缺省回落默认** | `librechat README.md` | preset 变成"差异表"，不再整份复制 |
| **`data-theme-boot` 防闪** | `librechat applyTheme.ts:20-27` | `index.html` 内联预涂 |

### 3.2 选中高亮强度 —— 取 LibreChat 正文档（8.4），不取它的侧栏专档（17.0）

三家实测：novu 3.3 / LobeHub 5.2 / LibreChat 8.4（正文）/ 17.0（侧栏专档）。
我们现在 12.6 —— **偏向 LibreChat 的侧栏专档**，但我们的界面气质更接近 LobeHub（清冷克制）。

**决策**：浅色取 **8.4**（LibreChat 正文档），深色取 **≈15.9**（LibreChat 暗色实测）。
理由：① 有产品类参考的直接依据（不再借 VS Code）；② 选中≈hover×2（8.4 / 4.2）符合三家比例区间（LobeHub 1.86、novu 2.4、LibreChat 1.0 靠字重补偿）；
③ 深色必须比浅色高一档（LibreChat 15.9 vs 8.4、LobeHub 同向），因为深底感知更弱。

### 3.3 灰的气质 —— 取 novu 的"统一色相"，取 LobeHub 的"中性仍中性"

- novu：灰的 hue 统一在 **210–227**，饱和度 ≤32%（`index.css:184-199`）→ 全站气质统一；
- LobeHub：中性 chroma ≤0.05，注释"presets peak around 0.02 oklch chroma" → 不因染色变彩。
- **决策**：我们的中性沿用"跟随主色色相"（已有），但**上限 0.035**（比 LobeHub 更保守）+ **`line`/`ink` 也要跟随**（现在 `line` 不跟）。

### 3.4 布局 —— 取 LobeHub 的结构 + novu 的分组持久 + LibreChat 的设置骨架

| 取 | 出处 | 落点 |
|---|---|---|
| 三档底色 + 一条列边（无缝隙） | LobeHub `NavPanelDraggable.tsx:33` | 已落 |
| 列表列 240–400 可拖 | LobeHub `systemStatus.ts:73-74` | 已落（视口算法） |
| **分组可折叠 + 状态持久（key 用 id）** | novu `navigation-group.tsx:6-17` | rail 分组 |
| **`last:mt-auto` 推底** | novu `:38` | 已落 |
| 设置项 = 数据 + 搜索 | LibreChat `registry.tsx` / `search.ts` | 设置页 |
| 设置左栏 230px | LibreChat `Sidebar.tsx:31` | 已落 |
| 设置内容 760 + 一组一卡 | Twenty `SettingsContentMaxWidth.ts` / `PageCardLayout` | 已落 |

### 3.5 字号与字重 —— 取 novu 的"同尺寸用字重分层"

novu 的 `label`(500) 与 `paragraph`(400) 同尺寸、`title` 用**负字距 −0.035em**（`tailwind.config.ts:20-180`）。
**决策**：我们 5 档不变，但 ① `title` 加负字距（−0.02em）；② 明确"同尺寸用 400/600 分层，不新增字号"。

### 3.6 动效 —— 取 novu 的"两处统一曲线"

novu 的 Tab 指示条与 segmented 浮块共用 `cubic-bezier(0.65,0,0.35,1)` + 300ms + `translate3d`。
**决策**：我们的动效白名单加一条"指示类位移统一用这条曲线"，避免每处自定。

## 4 三家都没做好、我们可以超过的地方

| # | 三家的问题 | 我们的做法 |
|---|---|---|
| 1 | **novu 暗色未完成** | 我们的暗色由公式派生 + AA 断言（已有），继续加强 |
| 2 | **LobeHub 的 rail 只有 5 个固定 tab，无分组** | 我们 rail 支持"列开关 + 功能页"两类 + 分组（已落） |
| 3 | **LibreChat 的选中靠"选中与 hover 同色 + 字重"**，需要用户分辨字重 | 我们保持"选中明显深于 hover"（比例 ≈2），一眼可分 |
| 4 | **三家的设置都是弹窗**（LibreChat/novu）或半页（LobeHub） | 我们是独立 tab + 全页（用户 2026-11-09 裁决） |
| 5 | **没有一家把"主题导出/导入"做成用户能力** | 我们 demo 已能导出 `tokens.css`；产品化后让用户存/分享主题 |
| 6 | **novu / LobeHub 的角标字号过小**（9px / 8px） | 我们 `micro 11` 起 |
| 7 | **三家的 token 都是"手写死值"**（除 LobeHub 生成器） | 我们全部由纯函数算 + 机器断言（AA / ΔL\* / 比例） |

## 5 落地顺序（按收益/风险排）

| 步 | 内容 | 依据 |
|---|---|---|
| 1 | 选中强度调到 8.4 / hover 4.2（浅色）、15.9 / 9（深色） | §3.2 |
| 2 | `tokens.css` 改 `@theme inline` + RGB 三元组 + `data-theme-boot` | §3.1 |
| 3 | 色阶扩到 12 阶 + alpha 份（先只做 nav/line/ink 三族） | §3.1 |
| 4 | 设置项 registry + 搜索 | §3.4 |
| 5 | rail 分组折叠 + 状态持久（key 用 id） | §3.4 |
| 6 | title 负字距 + 字重分层写死成规则 | §3.5 |
| 7 | 指示类动效统一曲线 | §3.6 |

## 6 复核触发

- 任一家升级（LobeHub / LibreChat / novu）→ 按各自文档的「复核触发」节重核，再回看本表；
- 我们落了 §5 任一步 → 回来更新 §2 的"我们（现状）"列。
