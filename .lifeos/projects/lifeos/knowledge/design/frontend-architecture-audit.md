# 前端架构自检（2026-11-09）

> 用户：「我们在前端还是开发了不少的东西了，架构层面是否比对标项目更优秀？代码质量是否做到位了？前端规范和文档是否刷新了？」
> 这份文档是**自检结论**，不给"很好"这种评价，只给可核对的事实与差距。

## 1 分层：现状

```
frontend/src/
├── design/                      ← 设计系统层（唯一数值来源）
│   ├── tokens.css               @theme：字阶 5 档 / 圆角 6 档 / 语义色
│   ├── theme.ts                 主题引擎（OKLCH 纯函数 + AA 二分 + 预设）
│   ├── ui.tsx                   primitive：Button/IconButton/Row/Label/Field/Input…
│   ├── overlay.tsx              模态与焦点陷阱（useDialogFocus）
│   ├── rail.tsx                 左侧图标轨（toggle / tab 双语义）
│   ├── resize-column.tsx        可拖宽列（本轮新增，唯一实现）
│   ├── layout.ts                布局宽度唯一计算入口（纯函数 + 穷举单测）
│   ├── fold.ts / toast.tsx / image-viewer.tsx / image-zoom.ts
├── *.ts（33 个纯逻辑模块）       stream-blocks / run-facts / status-map / event-router /
│                                 input-history / display-prefs / session-totals / header-strip …
├── *.tsx（27 个组件）            App / Message / SessionHistory / FilePanel / FileTree / settings-surface …
```

**三层的边界是清楚的**：

| 层 | 规则 | 机器检查 |
|---|---|---|
| 呈现层（`*.tsx`） | 不许直接 `new EventSource`、不许读原始事件 | `specs/code/frontend/code.md` 2.10；代码里 0 处 |
| 派生层（`*.ts` 纯函数） | 事件 + 时钟 → 每会话 running/unread/queued/lastTurn | 单测覆盖（`test/*.test.mjs` 759 条） |
| 设计层（`design/`） | 数值只在 `tokens.css`；宽度只在 `layout.ts`；主题只在 `theme.ts` | `pnpm lint:tokens`（77 文件 0 违规）+ `ui-layout.test.mjs` |

## 2 与对标项目比，哪些地方确实更好

| 维度 | LobeHub | LibreChat | novu | 我们 |
|---|---|---|---|---|
| 主题生成 | 13 阶色阶 + 纯函数 | 主题=数据 + 运行时变量 | 手写 HSL 12 档 | **纯函数 + AA 二分反解**（对比度是解出来的，不是挑出来的） |
| 深浅色完整性 | 完整 | 81/160 token | **未做** | 完整 + 契约断言（5 预设 × 深浅 × 辅助文字 ≥4.5） |
| 拖宽能力 | 有 | 有 | 无 | **组件级契约**：写 `<ResizeColumn>` 就自动具备；门禁枚举所有 `[data-resize-key]` |
| 手势性能 | — | — | — | **手势期间 0 长任务**（写 DOM + rAF；旧实现 4 个 108–148ms 长任务） |
| 设计系统门禁 | 无公开门禁 | 无 | 无 | `lint:tokens`（禁任意值/裸调色板/裸 hex）+ ui-contract 169 条 + 截图基线 6 张 |

**这些"更好"是可核对的**：每一条都有实测数据或代码路径，写在本 Task 的
`knowledge/design/theme-systems/*.md`、`evidence/ui-round*/README.md`、`cases/2026-11-09.md` 里。

## 3 差距（诚实清单）

| 差距 | 事实 | 影响 | 该怎么做 |
|---|---|---|---|
| **`App.tsx` 3501 行 / 43 个 useState / 32 个 useEffect** | 单文件承担：布局编排、会话生命周期、事件流、批注、任务标题缓存、设置、移动端导航 | 改动风险高：任何一处 state 变化都可能重渲染整棵树（本轮拖动卡顿的根因就在这类结构里） | 拆成 4–5 个领域 hook（`useSessionRuntime` / `useWorkspace` / `useAnnotations` / `useSettingsSurface`）+ 一个纯编排组件。**这需要独立 Task**，不能在打磨任务里顺手做 |
| 根目录 64 个文件平铺 | 组件与纯逻辑混在同一个目录 | 新人无法从目录结构判断"哪个是纯函数、哪个是组件" | 按 `api/`（纯逻辑）与 `views/`（组件）分两个子目录；纯逻辑必须能被单测直接 import |
| 无虚拟化 | 会话列表 25 行、消息 108 条、历史分页 200 条 | 当前不卡（滚动 p95 9.3ms） | 数据量再涨（会话 >200 / 单轮块 >500）时再做；**现在做是过度设计** |
| `c1` 拖到底可到 668px | 助手名最长约 300px，超出部分只是留白 | 观感 | 产品决策：给助手列单独一个"够用"上限（需用户拍板，因为要偏离"两列同一套规则"） |
| ui-contract 有 24 项长期红 | P1·1.5 聚合徽标夹具、命中区量到长链接、主仓"默认"字样 | 掩盖真实回归 | 单独 Task 修夹具（**不属于本任务范围**，已在 task.md 记录） |

## 4 代码质量：可核对的项

| 项 | 结果 |
|---|---|
| `any` / `@ts-ignore` / `@ts-expect-error` | **0 处** |
| 静默 `catch {}`（无注释） | **0 处**；11 处 `catch { /* 说明 */ }` 都写了为什么可以忽略 |
| token 违规（任意值 / 裸调色板 / 裸 hex） | **0 处**（77 文件） |
| 单一事实源 | 宽度→`layout.ts`；颜色→`tokens.css`+`theme.ts`；会话行形状→`src/session-rows.ts`；可拖区域→`design/resize-column.tsx` |
| 重复魔数（本轮清掉） | 头像首字母字号（3 处 → `avatarStyle`）、树缩进（4 处 → `TREE_INDENT_*`）、胶囊圆角（内联 999 → `--radius-full`） |
| 单测 | 759 条（纯函数穷举为主） |
| UI 契约 | 169 条通过 / 24 条既有环境项失败 |
| 视觉体检 | 字号 5 / 圆角 6 / 文字色 5 / 图标 4 / 小命中区 0 —— 全部在上限内 |

## 5 规范与文档是否刷新

本轮之前：`specs/code/frontend/code.md` 最后更新 2026-11-06（2.1–2.18）。

本轮**新增 3 条前端规范**（都有本次实测依据 + 机器检查）：

| 条文 | 一句话 |
|---|---|
| 2.19 | **连续手势不驱动 React 状态**：手势期间写 DOM + rAF，结束时提交一次（实测 4×108–148ms → 0 长任务） |
| 2.20 | **交互能力必须"写上标记就生效"**，不许"记得去清单里加一行"（五个可拖区域只有两个跟手的教训） |
| 2.21 | **样式的修复条件若与容器宽度相关，不得用视口断点**（同一张表中招两次：手机 + 桌面开历史） |

文档层面已同步：
- `knowledge/design/layout-model.md` 新增 §6「可拖宽列」（契约 / 上限规则 / 机器检查）；
- `knowledge/design/theme-systems/real-run-facts.md`（四家真实运行实测，含一处旧结论更正）；
- `knowledge/design/frontend-architecture-audit.md`（本文）；
- `cases/2026-11-09.md` 14 条案例（本轮新增 6 条反面案例）；
- 顺带修正 `scripts/audit-ui.mjs` 的口径缺陷：状态徽标这种"随数据变色"的元素会让
  `textColorCount` 在 6/7 之间跳，现在按 `data-state-count` / `role=status` 排除计数（仍查对比度）。
  第一次修的时候用 `data-shot-mask` 排除，结果只剩 2 种颜色 —— **等于把真正的风格词汇也漏掉了**，
  已改成精确匹配动态元素。

## 6 工具链（2026-11-09 建立，五道闸）

用户原话：「我们的细节不能比参考项目差……可能搞一些工具，还有就是代码层面、架构层面下功夫，
保证当前的效果和后续的效果。」

### 6.1 已落地

| 工具 | 命令 | 防住什么 | 抓到过的真缺陷 |
|---|---|---|---|
| **T1 设计系统契约** | `pnpm test:design` | 浮层再分裂（5 套→1 套）、层级顺序错、token 写了没人用、深浅色只做一半、状态强度关系倒退 | 头像"白底白字"、`ink-500` 深色 2.45:1 |
| **T2 视觉矩阵** | `pnpm test:visual` | 用户数据进基线、深色缺陷看不见、基线不入库 | 头像空白圆（chat-dark-1280 一眼可见） |
| **T3 axe 审计** | `pnpm audit:a11y` | 补上规范写了从未实现的「axe 无 serious/critical」 | `ink-500` 对比度 30 次、`ink-300` 承载文本、aside 无可访问名 |
| **T4 样板间** | `frontend/dev/design-system.html` | 新页面"照抄对象"缺失 | —（10 section / 25 卡，深浅色可切） |
| T5 视觉体检（既有） | `pnpm audit:ui` | 字号/圆角/色/图标/命中区种类超上限 | 状态徽标让色数在 6/7 间跳（口径已修） |

### 6.2 为什么不是"引入 taste-skill 一类的东西"

外部 skill 的价值是把审美写成**可检查的约束**。我们有更好的原料：**参考项目的源码事实**
（LobeHub 13 阶色阶、LibreChat `semanticTokens.spec.ts`、novu 的 18 条 `.grit` 自定义规则）。
所以我们的做法是把这些"约束"直接写成我们自己的断言（T1），而不是再包一层别人的规则集。

参考项目里值得抄的机制（都已核过源码）：
- LibreChat `semanticTokens.spec.ts`：**把 token 的语义关系写成断言**
  （dark dialog 必须 gray-875、composer hover 必须 gray-200/600、破坏性文字必须 red-400
  且不能等于 status-error）→ 我们的 T1 就是同一思路；
- novu `biome-plugins/*.grit`：18 条自定义 lint，把团队约定变成编译期报错 → 我们的 2.22/2.23 条文；
- LobeHub `ui.lobehub.com`：活文档样板间 → 我们的 T4。

### 6.3 差距（诚实）
- 没有 CI（门禁都在本地跑）；接 CI 是独立 Task；
- `App.tsx` 3501 行未拆（已进 todo，需独立 Task）；
- 视觉矩阵只覆盖 5 个场景，检视面板/文件树详情页还没进矩阵。
