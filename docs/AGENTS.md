# docs/ 文档说明

> 角色：文档地图　类型：索引/规则　状态：现状（2026-10-21）
>
> 本文件说明 `docs/` 下每类文档**管什么、不管什么、什么时候改**。它不是产品规范，也不替代 [`README.md`](./README.md) 的入口索引。
>
> **边界**：交互 harness 协议正文只在 `.lifeos/interaction-harness/protocol.md`；`docs/` 是 Life OS 的项目文档，只写本项目的实现、需求与开发规范，不复制协议。
> 写文档前先看这里；文档必须对开发/设计有价值，没有价值的直接删，不留“历史副本”。

## 1 文档分层

| 目录/文件 | 管什么 | 不管什么 | 什么时候改 |
|---|---|---|---|
| `architecture/` | 系统事实：组件、数据流、边界、实现位置 | 页面设计、视觉规则、任务过程 | 架构/数据流/接口变化时 |
| `architecture/conversation.md` | 会话架构：TUI 对照、数据模型、事件、前后端分工、落地顺序 | 具体页面视觉/文案 | 会话数据流/事件变化时 |
| `requirements/` | 需求：场景、功能、权限、验收 | 具体实现、页面布局 | 需求变化时 |
| `requirements/conversation.md` | 会话功能需求：固定状态条、4 步、tokens/速度、消息类型、自动跟随 | 实现细节、组件 API | 会话需求变化时 |
| `standards/frontend-development.md` | **前端开发流程**：四步门禁、规范覆盖表、参考证据分级、对象完整性、Agent 模拟验收 | 具体页面视觉/交互规则 | 流程变化时 |
| `design/frontend-spec.md` | **统一前端设计与交互规范**：视觉基础、布局、数据呈现、关系表达、通用交互、组件、内容、a11y、模式、验证 | 单个页面的具体数据/交互/状态 | 跨页面规则变化时 |
| `design/mobile.md` | **手机适配规范**：表面模型、导航/返回、全屏表面、触控、安全区、PWA、验收 | 桌面视觉/其他页面细节 | 手机布局/交互变化时 |
| `design/<page>.md` | **单个页面的设计文档**：背景、数据、关系、任务、交互、布局、状态、范围外、设计验收 | 全局颜色/间距/控件规则；其他页面的数据 | 该页数据/关系/交互/状态变化时 |
| `standards/reference-baseline.md` | 参考来源：场景 → 参考项目 → 文件/机制 → 借什么/不借什么 | 页面清单、pattern 库 | 页面/模式用到新参考时补一行 |
| `standards/review.md` | 检视/评审流程：四类检视、结论分级、证据规则 | 前端设计规范 | 评审流程变化时 |
| `standards/development-harness.md` | 开发 Life OS 时怎么按交互 harness 落记录 | 前端设计 | 落点/装配变化时 |
| `todo.md` | 未实现功能的一句话登记 | 设计说明、实现方案 | 发现未实现/完成实现时 |

## 2 前端文档一览

| 文档 | 目标 | 读者 | 核心内容 |
|---|---|---|---|
| [`standards/frontend-development.md`](./standards/frontend-development.md) | 前端改动的固定执行顺序 | Agent、设计/开发、评审 | 四步门禁、覆盖表、参考证据、对象完整性、复盘、Agent 模拟验收 |
| [`design/frontend-spec.md`](./design/frontend-spec.md) | 所有页面共同遵守 | Agent、设计/开发、评审 | 视觉基础、布局、数据呈现/关系、通用交互、组件、内容、a11y、交互模式、验证、页面模板 |
| [`design/mobile.md`](./design/mobile.md) | 手机端布局与交互 | Agent、开发、评审 | 表面模型、导航/返回、全屏表面、触控、安全区、PWA、验收 |
| [`design/chat.md`](./design/chat.md) | 主工作区页面 | Agent、开发、评审 | Agent/Project/Session/Message 的数据、关系、三列级联、聊天/历史交互、状态 |
| [`design/file-browser.md`](./design/file-browser.md) | 文件浏览器页面 | Agent、开发、评审 | 文件树/查看器/页签/根切换的数据与交互 |
| [`design/agent-config.md`](./design/agent-config.md) | Agent 配置模态 | Agent、开发、评审 | 背景、Agent/模型数据、关系、表单交互、状态、验收 |
| [`standards/reference-baseline.md`](./standards/reference-baseline.md) | 设计决策的来源 | 设计/开发 | 场景行：参考项目、文件/机制、借什么/不借什么 |
| [`standards/review.md`](./standards/review.md) | 评审怎么做 | 评审者、Agent | 四类检视、三类结论、交互交付四问、证据规则 |

**没有单独的 `patterns/`、`pages/`、`intent/` 目录。**
- **意图 / 数据·关系 / 模式在同一份页面文档里**：意图 = 背景/用户任务/主操作/立即生效/不做；数据 = 实体/字段/来源；关系 = 基数 + 表达；模式 = 本页选择 + 差异。模式定义只在复用后进 `frontend-spec.md` §8；第一次使用写在该页的“模式草案”，不拆文件；
- 意图在页面文档的“背景与意图 + 用户任务 + 交互”里，和模式同在一份文件；不是独立文件；
- pattern 只有被第二个页面复用时，才考虑抽成 `design/patterns/<id>.md`，并更新两个页面。

## 3 前端文档的写作规则

1. **先背景与意图**：页面文档必须写清页面名、入口选择器、结构单元、代码文件、使用方、为什么需要，以及用户任务、主操作/立即生效动作、明确不做。只靠文件名不算说明。
2. **先数据/关系，再交互**：写清实体/字段/来源，1:1 / 1:N / N:M / 层级，以及界面怎么表达；再写用户怎么操作。
3. **全局规则不复制**：页面文档不写颜色/字号/间距/控件细节，引用 `frontend-spec.md` 与 `design/tokens.css`；不在页面里重新定义一套。
4. **状态三选一**：加载/空/错/脏/保存中/成功，每个状态写“已实现+断言 / 未实现+`todo.md` 行 / N/A+原因”，不能留空。
5. **设计验收可观察**：写“加载完成前保存不可用”这类行为，不写测试实现；测试/审计属于开发门禁，不塞进设计文档。
6. **参考只在 baseline**：页面/模式用到参考时，在 `reference-baseline.md` 补场景行；不把页面登记成参考，不建第三份参考清单。
7. **删除无价值文档**：文档不服务开发/设计就删；不保留重定向、历史副本、平行第二份。删除后更新所有链接。
8. **未实现不进正式文档**：先登记 `todo.md`，实现后再写事实；页面文档的状态表可标“未实现+todo 行”。

## 4 开发前端时怎么读

1. `docs/standards/frontend-development.md`：先做规范覆盖表，判断缺什么；
2. `docs/design/frontend-spec.md`：所有页面共同规则；手机任务再读 `docs/design/mobile.md`；
3. 当前页面的 `docs/design/<page>.md`：本页数据/关系/交互/状态；
4. 代码事实源：`design/tokens.css`、`design/ui.tsx`、`design/layout.ts`；
5. 门禁：`AGENTS.md` 的 `pnpm verify` / `pnpm build`，以及 `frontend/test/ui-contract.mjs`。

没有规范覆盖表、参考证据或用户拍板，不进入代码。

没有页面文档时：按 `frontend-spec.md` §10 的模板新建，先写背景；不要先写代码。

## 5 规范怎么落地

- **正文只有一份**：前端流程在 `docs/standards/frontend-development.md`，规范在 `docs/design/frontend-spec.md`，页面差异在 `docs/design/<page>.md`；随代码进 Git，评审和代码一起做；
- **注入点**：项目根 `AGENTS.md`（`src/assembly.ts` 作为“项目规范”加载）先指向 `standards/frontend-development.md`，再指向规范/页面文档；Agent 开工前按需读取，不把全文塞进 system prompt；
- **项目共享层只放指针**：`~/.lifeos/projects/<projectId>/specs/frontend-development/AGENTS.md` 指向示例实例里的 `docs/standards/frontend-development.md` 与 `docs/design/`；Life OS 本机用 `docs -> 仓库 docs` 的符号链接，只说明正文在哪，不复制正文；
- **通用 harness 不放本项目规范**：`~/.lifeos/interaction-harness/` 独立于任何具体项目（协议 §1），Life OS 前端规范不进通用层；发布时也不带 lifeos 示例；
- **装配层加载规范**：`src/assembly.ts` 按协议 §16.2 读共享 workspace → 当前项目共享 → Agent 私有 workspace → Agent × 项目 → Task 的 `specs/index.json`，逐层追加、不覆盖；只加载当前项目可见的层，不跨项目扫描；
- **闭环**：读流程/规范/页面文档 → 规范覆盖表 → 缺则补 → 实现 → `pnpm verify`/`build` → 复盘并同轮更新文档。

## 6 新增/删除页面文档

- **新增**：出现新的用户打开的页面/模态/独立面板；一个用户单元一份，tab/分区写在内部；
- **更新**：该页数据/关系/交互/状态变化时；跨页面规则变化改 `frontend-spec.md`，不复制到页面；
- **删除**：页面不存在、文档只剩历史、或与其他文档重复且无独立价值；删除后改链接；
- **不新增**：不按 tab/按钮拆文档；不为一个页面单独建 pattern 库；不建页面登记表（页面少时 `README.md` + 文件本身足够）。

## 7 维护责任

- `frontend-spec.md`：跨页面规则变化时更新；变更要检查所有页面文档是否仍成立；
- 页面文档：页面行为变化时同轮更新；实现差距记 `todo.md`，不把“计划”写成“现状”；
- `reference-baseline.md`：只在出现新参考场景时补行；同一场景可服务多个页面；
- `docs/README.md`：增删文档时同步入口表。
