# 方案与成效：我们 vs LobeHub / LibreChat / novu

> 状态：2026-11-09。**这份文档按用户要求的顺序写**：
> ① 对标项目**怎么做的、怎么实现的** → ② **我们现在怎么做** → ③ **截图对比**。
> 源码级细节在同目录 `lobehub.md` / `librechat.md` / `novu.md`，本文只做收敛与对照。

## ① 对标项目怎么做的（三家的实现路径）

| | **LobeHub** | **LibreChat** | **novu** |
|---|---|---|---|
| **主题文件在哪** | `lobe-ui` 包：`src/color/colors/*.ts`（12 色相 × 4 份 13 阶）+ `src/styles/theme/**` 生成器 | `packages/client/src/theme/`：`tokens.css`（`@theme inline`）+ `themes/*.json`（数据） | `apps/dashboard/src/index.css`（HSL 变量块）+ `tailwind.config.ts`（映射） |
| **怎么生成颜色** | 纯函数：`appearance` × 中性色 × 主色 → 200+ token（`createLobeToken.ts:16-38`） | 数据驱动：主题只写差异项，缺省回落默认（`README.md`） | 手写变量：12 档 HSL + alpha 双份（`index.css:184-251`） |
| **换主题发生什么** | 重新跑生成器 → 写 `--lobe-*` | **不重生成 CSS**，只改 root 上的变量（`@theme inline`，`tokens.css:1-30` 注释原文） | 改 root 变量 |
| **暗色** | 同一生成器另一分支 + `readableOnDark()` 自动提亮到 ≥4.5（`customPrimary.ts:45-56`） | 160 token 中 **81 个**有独立暗色值（真做完） | **未完成**（`dark:` 仅 7 文件、无 `.dark` 块） |
| **侧栏选中（light）** | `rgba(0,0,0,.06)` 叠 `#fcfcfc` → `#ededed` **ΔL\* 5.2** | `#e6e7e9` on `#ffffff` **ΔL\* 8.4**（另给侧栏专档 `#cccfd3` = 17.0） | `hsl(210 30% 61% / .10)` 叠 `#fafafa` → **ΔL\* 3.3** |
| **侧栏选中（dark）** | `rgba(255,255,255,.10)` 叠 `#0d0d0d` → **11.1** | `#333332` on `#1f1f1c` → **9.5**（`#414141` 是 surface-active，不是侧栏选中） | — |
| **密度/字号** | 7 档（12/14/16/20/24/30/38），圆角 4/6/8/12 | 6 档（0.75–2rem），圆角 4/8/12+full | **16 档**（title/label/paragraph/subheading），同尺寸用字重分层，标题负字距 −0.035em |
| **外壳** | 整个"列+内容"包在一张圆角 12 白卡里（`wrapStyle.ts:6-19`） | 平面（无外卡），组件级 token | 平面，`box-xs` 描边影 + 柔影做悬浮 |

**三家各自的短板**（这是我们可以超过的入口）：
- LobeHub：rail 只有 5 个固定 tab、无分组、角标 9px、命中盒 30px；
- LibreChat：设置是**弹窗**（用户明确不接受的形态）、选中与 hover 同色靠字重区分；
- novu：**暗色没做完**、角标 8px、字号 16 档导致"该用哪档"变成选择题。

## ② 我们现在怎么做（逐项对应）

| 维度 | 我们的做法 | 与三家比 |
|---|---|---|
| **颜色生成** | `frontend/src/design/theme.ts`：OKLCH 纯函数，输入 4 档底色 L\* + 主色 H/C + 悬停/选中比 → 输出 21 个 token。**AA 用二分求解**（accent / accent-solid / ink-500 都按对比度反解 L\*） | 取 LobeHub 的"纯函数生成" + LibreChat 的"运行时写变量"；**多了 AA 反解**（三家都是手挑值 + 事后检查） |
| **状态强度** | 选中 **8.5**（light）/ **16.1**（dark），悬停 4.2 / 8.1 → 选中≈hover×2 | 取 **LibreChat 正文档 8.4**；深色取 16.1 以对应用户「深色必须明显」的反馈（两家实测 9.5–11.1） |
| **分层方向** | 轨 < 列 < 页面 < 内容（light/dark **同向**）；边界线 light 比底暗、dark 比底亮 | 取 LobeHub `generateColorPalette.ts:42-62` 的方向（我们此前是反的，已修） |
| **L3 质感** | `RADIUS` 5 档（4/6/10/12/14+full）、`elevationOf(mode)` 4 档（卡/卡 hover/浮层/模态）、`MOTION` 3 条曲线 + 3 个时长、`TRACKING` 标题负字距 | 阴影 = LobeHub 多层低 alpha 收敛到 3 层 + novu `box-xs`（描边影+柔影）；动效曲线 = novu 的 `cubic-bezier(.65,0,.35,1)` 指示类统一；字距 = novu 的负字距（收敛到 −0.02em 适配中文） |
| **防闪** | `index.html` 内联脚本读 `lifeos.theme` → 预涂 `data-theme-boot` | 取 LibreChat `applyTheme.ts:20-27` 的 `data-theme-boot` 手法 |
| **布局** | rail = **列开关（助手/对话）+ 功能页（设置）两类**，设置是独立 tab（全页），列表列 240–560 可拖 | 比三家都强：LobeHub 只有单一 tab 语义；LibreChat/novu 设置是弹窗 |
| **设置页** | 独立 tab：② 230px 分区导航（内缩 2px 指示条）+ ③ 760 内容列 + 一组一卡 | 取 LibreChat 230 + Twenty 760/分组卡；**形态是独立页**（三家都没有） |

## ③ 截图对比（都在 `evidence/screens/`）

| 图 | 内容 |
|---|---|
| `01-tokens-compare.png` | **四联对照**：LobeHub / LibreChat / novu / 我们，浅色与深色各一排，每格底部标注真实色值与 ΔL\* |
| `02-lobehub-real-components.png` | **真实运行的 @lobehub/ui 6.15.2**（Button/ActionIcon/Avatar/Tag/Switch/Input/Segmented） |
| `03-lobehub-official-tokens.png` | LobeHub 官方 Design Tokens 文档页（活值） |
| `04-novu-official-inbox.png` | novu 官方 Inbox 文档页（含它的真实 Inbox UI 截图） |
| `05-ours-chat-light.png` | 我们的对话工作台（浅色） |
| `06-ours-chat-dark.png` | 我们的对话工作台（深色） |
| `07-ours-settings-dark.png` | 我们的设置页（深色） |

### 对照结论（数据说话）

| 指标 | LobeHub | LibreChat | novu | **我们** |
|---|---|---|---|---|
| 侧栏选中 ΔL\*（light） | 5.2 | 8.4 | 3.3 | **8.5** |
| 侧栏选中 ΔL\*（dark） | 11.1 | 9.5 | 无 | **16.1** |
| 悬停 / 选中比 | 1.86 | 1.0（靠字重） | 2.4 | **2.0** |
| 深色完整性 | 完整 | 完整 | **未做** | **完整 + AA 断言** |
| 主题自定义 | 任意 hex 重染 | 只写差异 | 手改变量 | **预设 + 任意 H/C + 4 档 L\* 可调 + 导出 CSS** |
| 设置形态 | rail tab（半页） | 弹窗 | 弹窗 | **独立 tab 全页** |
| 状态点/角标字号 | 9px | — | 8px | **11px（micro 档）** |
| 命中盒 | 30×30 | — | — | **36×36** |

## 我们超过他们什么（可核对的三条）

1. **状态强度有依据、有断言**：三家都没有把"选中 vs 悬停"写成契约；我们有 `test/theme.test.mjs`：
   light 8.4±1 / dark 16.1±2 / 选中≈hover×2 / 辅助文字 ≥4.5（5 预设 × 深浅全跑）。
2. **对比度是求解出来的，不是挑出来的**：`accent` / `accent-solid` / `ink-500` 全部按 AA 反解 L\*；
   三家（尤其 novu）存在"底加深后辅助文字不达标"的问题，我们把它写成断言。
3. **设置是独立页面不是弹窗**：这是用户 2026-11-09 的裁决，三家都没有；LobeHub 是半页、LibreChat/novu 是弹窗。

## 还没做的（诚实清单）

- `@theme inline` + RGB 三元组（LibreChat 手法）——当前是运行时 `setProperty`，效果等价但少一步优化；
- 色阶只到 4 档（LobeHub 13 阶）——先覆盖用到的语义，扩阶在下一轮；
- 主题导出/导入做成用户能力——demo 已有导出按钮，产品化未做；
- 三家的**真实控制台**没能跑起来（见 `evidence/refs/README-run-attempts.md`）：LobeHub 主仓需 MongoDB+Redis+完整构建，
  LibreChat 需 Mongo，novu 需整套微服务 + Docker（本机 Docker daemon 未运行）；
  替代方案：LobeHub 用**已发布的 @lobehub/ui 真实组件**跑起来（有截图），LibreChat/novu 用**官方文档页真实 UI**（有截图）+ 源码 token 实测。
