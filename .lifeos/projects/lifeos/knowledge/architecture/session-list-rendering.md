# 会话列表的渲染规模控制（计划 · 未实施）

> 角色：架构　类型：计划　状态：**暂不实施**（2026-11-03 用户裁决：先做折叠 + 行级 patch，虚拟化等触发条件）
> 登记处：`../../../todo/todo.md` #32　来源任务：`agents/coder/projects/workspace/tasks/0005-列表行对象`
> 证据：`agents/coder/projects/workspace/tasks/0005-列表行对象/evidence/2026-11-02-16-virtualization-tradeoff.json`

## 1 背景（现状，全部实测）

会话列表面板（`frontend/src/App.tsx:1773,1796` 两层 `map`）**全量渲染**所有会话行，没有任何规模控制。实测（Playwright 注入假数据，走真实前端渲染路径）：

| 规模 | 行数 | DOM 节点 | 首屏就绪 | 3 次滚动+重排 |
|---|---|---|---|---|
| 10 项目 × 10 会话 | 110 | **2,810** | — | 8.1ms |
| 10 项目 × 100 会话 | 1,010 | **27,110** | **21.2 秒** | — |

按 25.5 节点/行（实测 2810/110）推算，每项目 100 会话时用户要等 **21 秒**才看到列表。

**根因**：成本 ≈ 渲染规模 × 更新频率 × 单次更新代价。当前三个因子全部无控制：
- 渲染规模：无上限（全量 `map`）
- 更新频率：每个 turn 终态触发 `reloadGroups()` 全量重取（实测 60ms / 5,999B）
- 单次更新代价：任何一次状态变化都重渲染整个列表（实测 110 行下 10 次重排 130ms）

## 2 目标

| 指标 | 现状 | 目标 | 达成手段 |
|---|---|---|---|
| 默认视图行数 | 1,010（10×100） | **≤ 项目数 × 6 + 组头**（10 项目 ≈ 70） | ① 每组折叠上限 |
| DOM 节点 | 27,110 | **≤ 1,785** | ① |
| 单次状态更新的渲染范围 | 全列表（≈13ms） | **单行（≤0.5ms）** | ② 行级 patch |
| 10 会话并发主线程占用 | 130ms/秒（13%，掉帧） | **≤20ms/秒（2%）** | ① + ② |
| 1,000 行下的首屏 | 21.2 秒 | **≤1 秒** | ①（折叠后只有 70 行） |

**① 与 ② 属任务 0005 范围，已在做**。本文只讲 ③ 虚拟滚动——**暂不做**。

## 3 为什么暂不做虚拟滚动

### 3.1 边际收益只剩 60%

折叠（①）已把 1,010 行压到 ≈70 行（砍 94%）。虚拟滚动在 70 行基础上只再压到 ≈25 行（视口 16 行 + overscan），即**再省 60%**。

### 3.2 代价（pi-web 的实现是直接证据）

pi-web 为虚拟化必须**手动维护 7 类"强制保留行"**（`components/SessionTree.tsx:292-300` 的 `keepMounted`）：

```
focusedRowKey / activeMenuRowKey / pendingRevealKey / draggedRowKey /
renamingRootId / confirmDeleteRootId / renamingProjectKey
```

漏一类的可见后果：

| 漏掉 | 用户看到什么 |
|---|---|
| `focusedRowKey` | 键盘 ↑↓ 跨出视口后焦点丢失 |
| `activeMenuRowKey` | 右键菜单自己关掉 |
| `draggedRowKey` | 拖拽排序到一半中断 |
| `renamingRootId` | 重命名输入框被卸载，输入丢失 |

另有 5 项机制必须同时做对：

| 项 | 参考实现 | 漏做后果 |
|---|---|---|
| 滚动锚点 | pi-web `lib/session-tree.ts:863` `getVisibleRowIndices(offsets, scrollTop, viewportHeight, OVERSCAN_PX, keepMounted)`；DSH `TrajectoryTable.tsx:1790-1802` `scrollMargin + anchorTo:'end'` | 列表变高变矮时视口跳动；反向滚动错位 |
| 行高表 | DSH `estimateSize(index)` + 高度数组 | 我们的行 56 / 组头 32 / 失败态更高 → 改行高要同步改表 |
| 键盘焦点链 | pi-web `pendingReveal + onRevealHandled` 回调链 | ↑↓ 跨视口要先 scroll 再 focus，时序错就丢焦点 |
| 拖拽自动滚动 | pi-web `draggedRowKey` | 拖到视口外拖不出去 |
| 无障碍 | `aria-setsize` / `aria-posinset` 必须报总数 | 屏幕阅读器读 "1 of 25" 而不是 "1 of 1000" |

**还有一项我们独有的成本**：现有 `frontend/test/ui-contract.mjs` 有 **131 项检查**，大量按 `[data-testid]` 取行；虚拟化后视口外的行不在 DOM → 断言要大改，截图基线也可能变。

### 3.3 一个被否掉的"便宜替代"

`content-visibility: auto`（Chrome 原生，1 行 CSS）实测：

| 指标 | 无 | 有 | 结论 |
|---|---|---|---|
| 3 次滚动 + 重排 | 8.1ms | **1.6ms（5.1×）** | 滚动确实变流畅 |
| **1,000 行首屏** | 35,036ms | **43,538ms（更慢）** | **不能解决主要问题** |

→ 它只优化滚动，不减少首屏渲染量。主要矛盾必须靠"减少行数"。

## 4 触发条件（什么时候重启这个计划）

满足**任一**即建 Task 实施：

1. **单次渲染 > 100 行**：某个组被展开到 6 条以上，且用户实际这么用（埋点或用户反馈）。依据：DeepSeek Harness 的 `VIRTUALIZATION_THRESHOLD = 100`（`packages/client/ui-trajectory/src/client/TrajectoryClient...TrajectoryTable.tsx:33-36,1778-1779`）。
2. **折叠后首屏仍 > 1 秒**：在真实家目录（非注入数据）上量到。
3. **滚动出现可见掉帧**：DevTools Performance 面板里滚动期间 Long Task > 50ms 连续出现。

**反触发条件**（出现则不实施）：每组默认折叠 6 条被用户长期展开 → 说明折叠策略本身不合适，该先改折叠策略，而不是加虚拟化。

## 5 实施计划（触发后照此做）

### 5.1 选型

| 候选 | 依据 | 倾向 |
|---|---|---|
| **不做**（继续折叠 + 行级 patch） | 见 §3 | 默认 |
| `virtua`（Rocket.Chat 用） | `apps/meteor/client/sidebar/RoomList/RoomList.tsx:37,52`，`SIDEBAR_VIRTUAL_BUFFER_ROWS=5` | 优先 |
| `@tanstack/react-virtual`（DeepSeek 用） | `VIRTUAL_OVERSCAN_ROWS=12`、`VIRTUALIZATION_THRESHOLD=100` | 次选 |
| 自研（pi-web 路线，`getVisibleRowIndices`） | `lib/session-tree.ts:863-905` | 不推荐（重复造轮子） |

Rocket.Chat 用 `virtua` 且它也是 React + TS + 虚拟列表 + 分组结构 → **同一形态的最接近参考**。

### 5.2 步骤（每步可独立验证）

| 步 | 动作 | 验证 |
|---|---|---|
| V1 | 抽出"行模型"纯函数：`Group[] → Row[]`（组头/会话行/折叠按钮统一编号），带 `kind` 与稳定 `key` | 单测：同一输入 → 同一行序；折叠/展开后 key 不变 |
| V2 | 行高表：组头 32 / 会话行 56 / 折叠按钮 40（与 `design/language` 数值一致） | 单测断言高度表；UI 改行高时这条会红 |
| V3 | 接入 `virtua` 的 `Virtualizer`，`bufferSize` 取行高 × 5（照 RC） | 110 行下 DOM ≤ 视口 + buffer |
| V4 | **强制保留行**：焦点 / 菜单 / 拖拽 / 重命名 / 待确认删除 | 逐条手测：跨视口键盘导航、右键菜单不消失、拖拽出视口、重命名不被打断 |
| V5 | 无障碍：`aria-setsize` / `aria-posinset` 报总数 | 屏幕阅读器或 `aria-*` 断言 |
| V6 | 改写 `ui-contract.mjs` 的取行方式（改成"滚动到目标行再取"） | 131 项全绿；截图基线人眼确认 |

### 5.3 预期收益（触发时的量化目标）

| 指标 | 折叠后（V0） | 加虚拟化后 | 收益 |
|---|---|---|---|
| DOM 节点（70 行视图） | ≈1,785 | **≈640**（25 行 × 25.5） | 64% |
| 单次 patch 重渲染 | 单行 0.5ms（已由行级 patch 解决） | 不变 | — |
| 首屏（1,000 行） | ≈1 秒（折叠后 70 行） | ≈1 秒 | 几乎无收益 |
| 滚动帧率 | 靠 `content-visibility` 可到流畅 | 略优 | 小 |

**这就是"暂不做"的核心依据：在折叠 + 行级 patch 之后，虚拟化剩下的收益主要在"极端展开"场景，而代价是 7 类状态 + 5 项机制 + 131 项契约重写。**

## 6 风险（若实施）

| 风险 | 缓解 |
|---|---|
| 焦点/菜单/拖拽/重命名被打断 | V4 逐条手测 + 为每条写一条 UI 契约断言 |
| 滚动位置在列表变化时跳动 | 用 `anchorTo` / 手动维护锚点行；写"展开一组后视口停在原组头"的断言 |
| 截图基线大面积变化 | 基线只比骨架（已有 `data-shot-mask`），虚拟化不影响骨架 |
| `memo` 失效导致性能没改善 | 稳定 key + 单行不可变更新，并用 CDP `ScriptDuration` 前后对比（照 DeepSeek 的方法） |
