# 检视模式（架构）

> 角色：架构　类型：说明　状态：**现状**（2026-11-07 起；P1/P2/S1–S4-h/P4 总览已实现）
>
> 只写**现在的事实**：检视模式是什么、东西存在哪、模块怎么分层、数据怎么流、和哪些既有机制相邻。
> 不含设计取舍的过程与参考对照（那些在 Task 0010 的 `01-background.md`/`phases/` 与 `knowledge/reference-baseline.md`）。
> 未实现的部分**不在这里描述**，一句话登记在 [`../../todo/todo.md`](../../todo/todo.md)。

## 1 它是什么

**检视模式 = 在一个 Task 里，用户与 Agent 对着同一份 diff 共同检视的机制。**

- **检视对象**是一组「源」：该 Task 的 **项目 worktree**（代码）+ **Task 自身的文档**（`~/.lifeos` 下的这个 Task 目录）。代码与 md **同等对待**，只按类型分类显示。
- **评论是独立数据**：绑定"检视对象"（Task），**不绑会话**。任何会话、任何 Agent 都能读写同一份评论（详见 §5）。
- **零 git 写操作**：检视只读（`git diff` / `git show` / 临时 index），不提交、不改分支、不动 worktree。

## 2 东西存在哪（唯一事实源）

| 内容 | 落点 | 说明 |
|---|---|---|
| **检视对象（输入）** | **一个 Task**（`taskDir`） | 检视模式的输入**不是路径**而是一个 Task。后端把它展开成下面两组源，用户/Agent 只需要选 Task（D31a） |
| **worktree** | `<taskDir>/evidence/worktree/` | 约定位置；找不到时回退为"扫 taskDir 下第一个含 `.git` 的子目录"（`src/review.ts#locateSources`） |
| **Task 文档源** | `taskDir` 本身 | 家目录仓（`~/.lifeos` 若是 git 仓库）里该 Task 目录的改动；不是 git 仓库时降级 `degraded: "no_vcs"` |
| **评论** | `~/.lifeos/state/review-comments/<slug>.json` | slug = 可读前缀 + taskDir 全路径 sha1 前 8 位；0600 / 目录 0700；同目录 `AGENTS.md` 用 `wx` 不覆盖 |
| **草稿（浏览器侧兜底）** | `localStorage`（键前缀 `lifeos.reviewDrafts`） | **只是离线缓存**：服务端可达时以服务端为唯一事实源（`frontend/src/review-comment-store.ts`） |
| **「已看」进度（G10）** | `~/.lifeos/state/review-viewed/<slug>.json` | 与评论同一取舍：**存服务端**（换设备仍保留、Agent 可读）。记录 `{ path, viewedAt, hash }`，`hash` 是 diff 内容哈希 |
| **检视面板展开态 / 已关闭开关 / 折叠态** | 组件内存（`ReviewPanel` 的 state） | 不落盘；刷新回默认 |

**评论不进 git、不写进 Task 目录**：写运行数据到用户文档目录会被自己的 diff 检出来，且污染版本控制。

## 3 模块分层（谁负责什么）

```
后端（src/）
  review.ts              检视对象定位 + diff 计算 + 按需取全文（只读 git）
  review-patch.ts        纯解析：unified diff 文本 → 结构化 hunks（无 IO，可穷举单测）
  review-comments.ts     评论的持久化 + 状态机 + 权限 + 线程（唯一业务实现）
  review-viewed.ts       「已看」进度的持久化（同模式：原子写 + 目录说明 + 串行）
  review-overview.ts     总览聚合（把上面几个合成一份给 Agent 的摘要，零新规则）
  review-candidates.ts   检视候选（哪些 Task 有东西可检视；脏∪ahead + daily 分层）
  server.ts              HTTP 外壳（8 个检视端点，见 §4）
  agent-tools.ts         Pi 工具外壳（6 个 lifeos_review_* 工具，与 HTTP 共用业务）

前端（frontend/src/）
  ReviewPanel.tsx             面板（文件卡 / 行 / 评论卡 / 线程 / md 渲染态）——呈现层
  review-segments.ts          折叠未改行的段切分 + 展开/折叠算术（纯函数）
  review-selection.ts         范围/位置头/块边界（纯函数）
  review-outdated.ts          codeSnapshot 逐行比对判"代码已变"（纯函数）
  review-drafts.ts            草稿的 localStorage 适配（纯函数 + 注入 storage）
  review-comment-store.ts     评论与已看的数据源：Http 为主 + Local 离线兜底
  review-comment-state.ts     状态与关闭权限的**前端纯函数**（与服务端 parity）
  review-comment-copy.ts      评论 → 可粘贴文本（复制/发送到输入框）
  review-viewed.ts            已看三态 + 文件树 + 内容哈希（纯函数）
  review-lazy.ts              大 diff 保护与懒挂载的判定（纯函数）
  review-highlight.ts         语言识别 / 行级取 token / 退化门槛（纯函数）
  review-highlight-prism.ts   Prism 执行层（动态 import + 内容哈希缓存）
  review-highlight-style.ts   token 类型 → 字面量 Tailwind 类
  review-word-diff.ts         词级 diff 的判定与拆分（纯函数）
  review-word-diff-lib.ts     词级 diff 执行层（动态 import `diff`）
  review-split.ts             并排行配对（纯函数）
  review-md-blocks.ts         md 渲染态的块聚合与围栏切分（纯函数）
  review-keynav.ts            键盘导航键位表与步进（纯函数）
  composer-comment-refs.ts    评论 → 输入框 chip（纯函数）
  design/popover.ts           浮层定位（贴边翻转）
  prism-components.d.ts       Prism grammar 的类型声明（副作用注册）
```

**分层纪律（可检查）**：

1. **业务只在共享模块**：HTTP 与 Pi 工具都调 `review-comments.ts` / `review-overview.ts`，外壳不写分支（`specs/code/backend/code.md` 2.6）。
2. **前端不 import 服务端模块**：`frontend/src/**` 的值导入不许指向 `src/**`（会拖入 `node:fs` → 整页白屏）。规则由 `test/frontend-import-guard.test.mjs` 机器检查；确实需要的判定写成前端纯函数 + 服务端 import 它，或用 parity 测试锁两份。
3. **呈现层不碰原始事件流**：面板只消费 `ReviewData`（已结构化的 diff）与评论数组，不自己 `fetch` 原始 git 输出。

## 4 数据流

```
浏览器                              后端
  │  POST /api/review/diff {taskDir}
  │ ─────────────────────────────────▶ locateSources(taskDir)        ── 约定路径 → 扫描兜底
  │                                    computeWorktreeDiff(source)   ── merge-base(main) → 工作区
  │                                    computeLifeosDiff(taskDir)    ── 临时 index 建两棵树对比
  │ ◀───────────────────────────────── { items: [源…, files: [{path, kind, hunks}]] }
  │
  │  GET /api/agents/:id/projects/:pid/tasks/:taskId/review-sources   （检视对象的两个源）
  │  GET /api/agents/:id/projects/:pid/review-candidates               （哪些 Task 有东西可检视）
  │  GET /api/review/blob?source&path&side   （折叠段展开 / 语法高亮取全文）
  │  GET /api/review/comments?taskDir        （评论：任何会话都能读）
  │  POST /api/review/comments {op,…}        （add/update/remove/clear/state/reply/reply-update/reply-remove/awaiting）
  │  GET/POST /api/review/viewed              （已看进度：list / set 批量 / clear）
```

**事件**：`review_open`（回合级，所有连接收；App 侧再判作用域）——Agent 用 `lifeos_review_open` 触发，前端在当前 agent×project 自动打开面板。

### 怎么选检视对象（D31）

- **入口形态**：工具栏主按钮检**当前 Task**（行为不变）+ 旁一个「选择要检视的 Task」；
  面板内「检视对象」旁的 `<select>` 是同一个选择器的第二个入口（对象与动作同一处）。
- **候选列表**：`GET /api/agents/:id/projects/:pid/review-candidates` → 本 agent×project 的全部 Task，
  **有改动的排前**并标 `●`；只有 `daily/` 文档改动的标「仅日常」（C2 分层，D31f）；
  **有评论等用户的标 `N 条等你`**（`pendingForUser`，与 Agent 侧 `pendingForMe` 同一个函数，D29 的用户侧可见化）。
  「有改动」与「有评论」是两件事，各自独立标注，不合并成一个徽标。
- **"有改动"的判据**：工作区脏 **∪** 相对 `main`/`master` 有提交。
  只查 `git status` 会漏"提交了但没合并"的常态——实测 16 个 worktree 里有 2 个是这种。
- **成本**（实测）：文档侧一次全仓 `git status -z -uall` 0.094s；worktree 侧并行 16，
  15 个 Task 0.93s、全库 83 个 1.24s。候选**懒加载**（只在打开面板时拉），失败静默降级。
- **不跨 agent**：Task 本就是 per agent×project（协议 §3.7），跨层会越权。

**diff 的两条基线不一样，这是有意的**：

| 源 | 基线 | 理由 |
|---|---|---|
| 项目 worktree | `merge-base(main, HEAD)` → 工作区 | 分支从哪里分叉就检到哪里；未提交的改动也看得到 |
| Task 文档 | 家目录仓上一次含该 Task 路径的提交 → 当前工作区 | 用户看不到家目录仓，基线必须自己算；旧基线在界面上显式标出（不假装是"本轮改动"） |

## 5 评论的数据模型

```ts
ReviewComment {            // 线程（= 一条根意见 + 若干回复）
  id, taskId,
  author: { kind: "user" | "agent"; id },   // 存 id 不存名字（名字会改）
  anchor: { source: "worktree" | "lifeos"; path; side: "old" | "new"; start; end; snapshot?; baseCommit? },
  body,                                       // 根的发言
  marks: string[],                            // 语气（复用 marks.ts；不新增 severity）
  state: "draft" | "open" | "resolved",
  awaiting: "user" | "agent" | null,          // 现在等谁（不是状态）
  canClose: "author" | "author-or-user",      // 谁能关（服务端按它校验）
  replies: CommentReply[],                    // 回复（只有 author/body/时间，没有语气与锚点）
  createdAt, updatedAt, resolvedAt?, resolvedBy?
}
```

**四条规则**（每条都有测试锁住）：

| 规则 | 为什么 |
|---|---|
| **业务键 = task + 源 + 文件 + 侧 + 行范围 + 作者** | 同一段代码上用户和 N 个 Agent 各写一条，不能后写覆盖先写；同一个人同段再写 = 编辑 |
| **绑 taskId，不绑 commit/分支** | worktree 继续开发、rebase、cherry-pick 后评论不丢（Gerrit Change-Id 范式） |
| **回复交棒**：Agent 回 → `awaiting: "user"`；用户回 → `awaiting: "agent"` | 回复动作本身就是"轮到你了"，不用人工维护 |
| **已关闭不能再回复**，关闭后 `awaitingOf` 派生成 `null`（存储值保留） | 关闭 = 这一轮讨论结束；存储保留事实，派生统一在一处 |

**权限**：关闭/重开 = 提出者或用户本人（别的 Agent 403）；回复的改删 = 回复作者或用户本人。

**未闭环 = 待办**：`pendingFor(comments, who)` = 未关闭 且（等我 **或** 没人认领）。已关闭的一律不算——它同时是 Agent 的"检视 TODO"判据（`lifeos_review_comments({pendingForMe:true})`）。

## 6 界面结构（现状）

- **面板**：与文件面板**并存**（不互斥）；宽度走比例（`design/layout.ts`），换屏等比缩放，对话保底 420。
- **文件卡**：文件头显示类型徽标（代码/文档/文件）、+/- 行数、评论数；可展开/折叠；面板级"全部展开/折叠"。
- **行**：行号列可点可拖（起锚）；`＋` 悬停出现；范围高亮是**整块覆盖层**（左边竖条 + 首行上边 + 末行下边），不是每行一圈边框。
- **折叠未改行**：两档（「上下文 3 行」/「仅改动行」）；隐藏段给「↑ N 行 / ↓ N 行 / 全部 N 行」，
  **外加「折叠」**（折回 0）。三条规则：
  ① 部分展开（↑/↓ 任一 > 0）就给「折叠」——点错了能反悔，不必一路点到「全部」再整段毁掉；
  ② **全展开后折叠条仍然保留**，文案变「已全部展开」、只留「折叠」（VS Code `hideUnchangedRegionsFeature.ts:438-441`
     在全展开时把控制条变成 fold 按钮；difit `ExpandButton.tsx` 没有折回，这是我们的差异项）；
  ③ 算术只有一份（`review-segments.ts#expandStep`，纯函数、有穷举测试），
     `up + down` 永不超过隐藏行数——否则头尾切片会重叠渲染同一行。
- **懒挂载（G6）**：首屏只挂前 8 个文件（difit `INITIAL_RENDERED_FILE_COUNT`），其余渲染 160px 占位
  （opencode `session-review.tsx:660` 同值），滚动进入 1200px 预取区（difit `LAZY_ROOT_MARGIN`）时由
  IntersectionObserver 挂载。占位的 ref 回调**必须稳定**（`usePlaceholderObserver`）——内联箭头函数会让 observer
  每次渲染重建，实测"滚到占位仍不挂载"。
- **大 diff（G5）**：单文件改动 > 500 行（opencode `MAX_DIFF_CHANGED_LINES`）时**仍然渲染**，但默认只展开前 200 行
  + 一条提示与「全部展开」按钮。与 opencode 的差异是**有意**的：他们在超限时直接不渲染（`too-large` + "render anyway"），
  我们的场景是"一个 Task 的累积改动"，挡住等于让用户看不见自己的工作。
- **评论**：默认**折叠**成行末头像组（按作者去重）；悬停出预览气泡（锚定在头像上）；点头像展开完整卡。
- **评论卡**：作者头像 + 左侧色条（同源 `avatarTone`）、位置头 `path:Lx-Ly`、语气标记、正文编辑（自动保存）、状态徽标/「等谁」三档按钮、复制/发送/关闭/折叠/丢弃、回复列表 + 回复框。
- **面板头**：文件数、总 +/-、「复制检视对象」、「显示已关闭 N」、「全部发送 N」、复制全部未关闭的（`复制全部 N`）、全部展开/折叠、重新加载、关闭。
- **已关闭的评论默认不渲染**（顶部开关可显示）；已关闭的线程卡片上有「重开」（误关的退路）。
- **已看进度（G10）**：面板头 `N/M 已看` + 进度条；文件卡右侧三态按钮 `○ 未看 / ✓ 已看 / ↻ 已变`。
  **只有 `viewed` 计入进度**——`changed`（看过之后改动又变了）不算，进度条不能骗人。
  内容哈希取自 `path + status + 每行 type:text`（**不含行号**：上下文折展导致的行号漂移不该让已看失效，difit 同判）。
- **文件树（G9）**：面板里的可折叠区（`<details>`，默认收起，不挤 diff 阅读宽度）；目录三态 `all/some/none`，
  勾选目录 = 批量标记该目录下全部文件（一次请求，不是 N 次）。
- **并排视图（G11）**：段控「单列 / 并排」，默认单列（不突变）。并排把每段 unified 行配对成横排：
  context 同行、removed 连跑 + 紧随 added 连跑按 max 逐对（多出一侧留空）、只有 added 占右列
  （`frontend/src/review-split.ts#pairForSplit`，纯函数 + 穷举测试；规则取自 difit `SideBySideDiffChunk.tsx:414-490`）。
  两格各自行号、各自可锚（context 行左右都能批注，左边点 = "原来这行"）。
  不做词级 diff、不按宽度自动切（自造阈值）。
- **词级 diff（G12）**：成对的增删行（配对规则与并排同源 `pairForSplit`）逐词标出改动，
  单列与并排**共用同一份结果**（difit `DiffChunk.tsx:330-380` / `SideBySideDiffChunk.tsx:466-479` 同判）。
  三条闸：两行相同或任一侧为空不做；单行 >1000 字符不做（实测病态行 1689 字符单对 8.14ms）；
  任一侧改动占比 >0.8 不做（整行标色比满屏小色块清楚）。
  `diff` 库（BSD-3，零传递依赖）**动态 import**——只在存在成对增删行时加载。
  配色：改动段用**不透明**底 `--color-diff-word-add/--color-diff-word-del` + `ink-900` 文字
  （alpha 方案实测过不了 AA，见 `tokens.css` 注释）。
- **md 渲染态 diff（G15）**：段控「源码 / 渲染」，**默认源码**（VS Code 官方文档明确这是 opt-in；
  difit 默认也是 `diff` 档）。渲染档把 md 渲染成文档、按块标色：`delete` 红边 / `add` 与 `change` 绿边 /
  `context` 无色边（`frontend/src/review-md-blocks.ts#buildPreviewBlocks`，difit `MarkdownDiffViewer.tsx:90-121` 同构）；
  代码围栏**逐行**标色（否则围栏里的 `# 注释` 会被当标题）。
  渲染走 `renderMarkdown`（marked → DOMPurify），与消息正文同链路，HTML 不透传。
  **不做** frontmatter 表格 diff（实测我们的 md 无 frontmatter）与 Mermaid（没有此类图）。
- **语法高亮（G8）**：只对 `code` 类文件生效（`.md` 不做行内标记高亮，D4 用源码行级 diff）。
  语言按扩展名映射（`frontend/src/review-highlight.ts`，只收我们真会遇到的类型）；认不出就不高亮（不猜）。
  **整篇预分词 + 按行号查**（difit `useFileLevelTokens` 同思路）：只对展开的文件、≤2000 行
  （实测 2000 行 9.9ms / 4000 行 32.5ms）做；超过就退回纯文本。
  `prism-react-renderer` 与 grammar 都是**动态 import**——静态引会让主 chunk +27.8kB gzip，
  而大多数时候用户不打开检视面板（difit 是静态 import，一直背这份成本）。
  8 个语法色在三种底（白 / add-soft / del-soft）上对比度全部 ≥4.5，值与其对比度写在 `tokens.css`。
- **键盘导航**（`frontend/src/review-keynav.ts`，键位表是单一事实源，帮助浮层直接读它）：
  `j`/`↓` `k`/`↑` 行 · `n`/`p` 改动块 · `]`/`[` 文件（环绕）· `}`/`{` 首/尾文件 · `c` 在当前行写评论 · `?` 帮助 · `Esc` 关帮助/关面板。
  **在 input/textarea/contenteditable 里不抢键**（写评论时按 `j` 打出一个 `j`）。
  光标是面板级一个下标（`cursor`），可见标记由它派生（`data-review-cursor`），不逐层传 prop。
- **输入框里的评论引用（chip）**：点卡片「发送」/「全部发送」把评论挂成 chip（位置头 + 首行预览 + ✕），
  **不塞进正文**；发送时才由 `commentsToText()` 合成（与复制同一实现），发送成功清空、失败回填。
- **回复可编辑**：自己的回复或用户可点「编辑」内联改正文（`op:"reply-update"`），「删除」同权限。

## 7 Pi 工具（Agent 侧）

| 工具 | 用途 |
|---|---|
| `lifeos_review_state(taskId)` | **入口**：检视对象在哪、有多少改动、几条等我、下一步用哪个工具 |
| `lifeos_review_open(taskId)` | **Agent 主动打开面板**（D32）：广播 `review_open`，前端在当前 agent×project 上自动打开。三家参考都没有这能力，是我们新增的 |
| `lifeos_review_comments(taskId, pendingForMe?, state?)` | 读线程全文（含回复）；`pendingForMe` = 我的检视 TODO |
| `lifeos_review_comment_add(taskId, source, path, side, start, end, body, marks?)` | 在 diff 上开一条新线程 |
| `lifeos_review_comment_reply(taskId, id, body)` | 在线程里回复（闭环说明写这里）→ 自动交棒给用户 |
| `lifeos_review_comment_resolve(taskId, id, resolved?)` | 关闭/重开（只能动自己提的；用户提的会 403） |

**为什么 Agent 侧要"总览"而不是只给"读评论"**：Agent 得先知道"检视对象是什么、改了多少、欠谁几条"，才知道要不要读、读哪条。总览的输出里点名了后续工具与参数形状，Agent 不需要猜。

## 8 与相邻机制的关系

| 相邻 | 关系 |
|---|---|
| **Task** | 检视对象的边界就是 Task 目录（worktree + 文档）；评论绑 Task id，切 Task 即换检视对象 |
| **会话 / 对话** | **无绑定**。评论不存会话 id，也不通过对话传播；"发送到输入框"是用户显式动作（只放进输入框，不自动发） |
| **文件面板** | 并存，互不排他（同时看 diff 与源文件） |
| **批注（消息批注，Task 0003）** | 两套独立数据：消息批注锚在消息文本上（`annotations.ts`），检视评论锚在 diff 行上。**复制格式复用**同一套定稿（`1、【path:Lx-Ly】你说的：「…」` + `-> note （语气）`），不新造第二套 |
| **记忆** | 无关系（评论不进记忆库） |

## 9 已实现 vs 未实现（不在本文描述未实现的东西）

- **已实现**：diff 两源 + 折叠未改行 + 按需取全文 + 锚点/范围/位置头 + 过期判定 + 评论持久化（独立于对话）+ 状态机与权限 + 线程回复 + 总览工具 + 复制/发送 + 大 diff 保护/懒挂载 + 已看进度 + 文件树 + 语法高亮 + 视觉（整块高亮、头像针、显示已关闭）。
- **未实现**（登记在 `todo/`）：并排视图（G11）、手机适配、md 渲染态 rich diff、`lifeos_review_open`（Agent 主动开面板）。
