# Agent 记忆（设计稿）

> 角色：架构　类型：设计　状态：**设计 + P1 已实现**（四 store / 读写 / 软删除）；P2 工具、P3 面板待做——进度见 `docs/todo.md`

本文是"记忆"的唯一权威：四种记忆、读写权限、隔离与读取顺序、工具与 prompt 的约定。
未定稿的部分集中写在 §6，不在这里写成结论。

## 1 底座决策

| 项 | 决策 | 理由 |
|---|---|---|
| 记忆底座 | **MemOS 本地核心**（`MemTensor/MemOS`，Apache-2.0，TypeScript；SQLite + FTS5 + 向量；L1/L2/L3/Skill 四层演化） | 本地优先、无 Docker、无云 key；记忆模型最完整（trace → policy → world model → skill） |
| 不用 **mem0** | — | Platform 要 key 且数据上云；OSS 在无 Docker 的 Node 环境没有顺手的持久向量库（`memory` 重启即失） |
| 不用 **Memmy** | — | 与 MemOS 同组织、同一套记忆模型，但形态是"完整产品 + 常驻服务"；我们只需要记忆能力 |
| 不用 MemOS Cloud / Neo4j / Docker 自托管 | — | 与"本地、无容器、无云 key"冲突 |
| 不采用 `pi-memory` | — | 只作为"日记 = 每日日志"的形态参考，不作为依赖 |

## 2 四种记忆

**归属先于权限**：一条事实跟着谁走，就落哪一类；同一事实只落一类。

| # | 记忆 | 归属 | 落点 | 典型内容 |
|---|---|---|---|---|
| 1 | **项目共享** | 项目（全局实体，不挂在某个 Agent 下） | `~/.lifeos/projects/<projectId>/memory/` | 项目约定、架构、环境事实、公共决策 |
| 2 | **用户级** | 用户 | `~/.lifeos/memory/user/<userId>/` | 用户偏好、长期稳定事实 |
| 3 | **Agent 个人** | Agent（跨项目） | `~/.lifeos/agents/<agentId>/memory/` | 这个 Agent 的经验、教训、工作方式 |
| 4 | **Agent × 项目私有** | Agent（在某项目内） | `~/.lifeos/agents/<agentId>/projects/<projectId>/memory/` | 它在这个项目里的踩坑、私有做法 |

第 4 种放在 **Agent 自己的层级**、而不是公用的 project 目录里：外面那个 project 是所有 Agent 共用的，私有经验不能写进去。

### 读写权限

| 记忆 | 读 | 写 | 删除 |
|---|---|---|---|
| 项目共享 | 该项目下**所有 Agent**（是否允许其它项目只读：见 §6-1） | 该项目下**所有 Agent** | 该项目下**所有 Agent** |
| 用户级 | 该用户的**所有 Agent、所有项目** | 同左 | 同左（该用户的所有 Agent） |
| Agent 个人 | **仅该 Agent** | 仅该 Agent | 仅该 Agent |
| Agent × 项目私有 | **仅该 Agent**（在该项目内） | 仅该 Agent（在该项目内） | 仅该 Agent（在该项目内） |

**删除不是"写"的附属动作**：它有独立的工具、独立的确认与审计（见 §4 的"删除语义"）。
**删除权限与可见范围一致**：能看到的人都能删；看不到的人不能删（否则隔离没有意义）。用户本人可以在面板上直接删（软删或彻底删除）。

> 说明：上面把你列的"项目共享：都可以读"和"项目级：都可以读写"按**同一条（项目共享）的读/写两列**处理。如果你指的是两个不同的层，指出来，我在 §6 补一条。

## 3 隔离与读取顺序

- **默认隔离**：一个 Agent 在项目 P 里工作时，默认**不加载、不搜索其它项目**的记忆；其它项目的共享记忆也不自动进入上下文。
- **读取顺序**（越具体越优先）：
  1. Agent × 项目私有（本项目）
  2. 项目共享（本项目）
  3. Agent 个人（跨项目）
  4. 用户级（跨项目）
- **跨项目读取不是禁止，但不是默认**：必须由工具显式传 `projectId`（见 §4），结果里标注来源；prompt 里要求说明"为什么要跨项目查"。
- **写入默认落最窄的一层**（Agent × 项目私有）；要写项目共享 / 用户级 / Agent 个人，必须显式指定，理由清楚才提升。

## 4 工具与 prompt

### 工具

两种形态都可以，**选一种并保持一致**：

- **A（推荐）**：三个工具 + `scope` 参数——`lifeos_memory_search`、`lifeos_memory_record`、`lifeos_memory_delete`；
- B：四种记忆各一套工具（`*_project_shared_*` 等），数量多但描述可以更短。

推荐 A 的参数：

```
scope: "agent_project" | "project" | "agent" | "user"   // 必填（record / delete）/ 可选（search，缺省=按 §3 顺序合并）
projectId: string    // scope 为 project / agent_project 时必填；跨项目检索也用它
query / content      // search / record
id / ids?: string[]  // delete：条目 id（来自 search 结果）
limit?: number
```

- 搜索/写入结果必须回传 **`id` + `scope`**（四个 store 的 id 不保证全局唯一，删除按这对参数定位）；
- `lifeos_memory_delete` 标注 `destructiveHint: true`，描述里写死：**只在用户明确要求删除时调用**；只做软删除（可恢复，保留 1 个月）；不做「清理/优化」式删除；批量删除必须先列出将删条目和数量，得到确认后再执行。（彻底删除只在面板上由用户操作）

**工具描述就是权限契约**，必须逐条写清：

- 每个 scope 的**读/写边界**（谁能读、谁能写）；
- 默认隔离：不传 `projectId` 不跨项目；
- 跨项目检索必须显式传 `projectId`，并在结果里标注来源项目；
- 不能写"别人的"用户/A​​gent 域（越权直接拒绝并返回原因）。

### 删除语义

| 项 | 约定 |
|---|---|
| **默认软删除** | 删除只把条目置为 `deleted`（检索立即排除，可恢复）；MemOS 本地插件的检索本来也只读 `activated / resolving`，`deleted / archived` 不参与召回 |
| **保留期** | 软删除后**最多保留 1 个月**；过期即可 purge（自动清理由定时任务/启动检查执行，未实现前面板显示"已过期，可手动彻底删除"） |
| **硬删除（purge）** | 面板上由**用户直接操作**（二次确认）；模型工具只做软删除，不给模型"彻底删"的权限 |
| **审计** | 每次删除记一条操作（谁 / 何时 / 哪个 scope / 哪条 id / 原因），可追溯；对应 MemOS 的 operation/audit 记录 |
| **不级联** | 解绑项目、归档 Agent **都不删除记忆**（数据保留、可恢复），与项目"移除"的既有语义一致 |
| **批量删除** | 默认不提供 `delete_all`；确实需要时先返回"将删除 N 条（附样例）"，用户确认后再执行 |
| **面板** | 删除前确认框（显示角色 · 来源 · 摘要）；提供两个动作：**删除（可恢复）** 与 **彻底删除**；"已删除"视图里可恢复（状态改回 `active`）或立即 purge |

### prompt

- 默认只在当前上下文里回忆（顺序见 §3），**不要主动去别的项目找**；
- 判断"这条事实该记到哪一层"：项目约定/架构 → 项目共享；用户偏好/长期事实 → 用户级；跨项目经验教训 → Agent 个人；本项目踩坑/做法 → Agent × 项目私有；
- 跨项目检索时说明原因，并在回答里注明来源项目；
- 共享/提升（私有 → 项目共享）必须显式动作，不能自动外溢；
- 删除只在用户明确要求时做，并先确认是哪一条（`id` + `scope`）；不做"顺手清理"。

## 5 可见性：我们进了哪些 memory 要能看到

- **Life OS 内的"记忆"面板**（目标）：按四种角色分组；每行显示 **角色 · 来源（项目/Agent/用户）· 层（L1/L2/L3/Skill）· 时间 · 摘要**；支持搜索、按角色过滤、**删除（确认 + 可恢复视图）**（后续加"提升为共享"）。
- **MemOS 自带 Viewer**（可选、调试用）：单个 store 的 Memories（按 turn 分组）/ Tasks / Policies / World Models / Skills / Logs / 导出。
- 两条路径读的是同一批 SQLite；面板是"我们的界面"，Viewer 是"它的调试界面"，不重复实现检索。

## 6 待确认（不写成结论）

1. **项目共享的读边界**：仅"该项目下的 Agent"，还是"所有 Agent 只读"？
2. **"项目级：都可以读写"** 具体指哪一层（当前按项目共享的写列处理）。
3. **跨项目读取的授权方式**：显式 `projectId` 就够，还是要白名单/用户确认？
4. **读取优先级权重**：项目共享是否应高于 Agent 个人（当前按"项目 > Agent"）。
5. **记忆提升**：私有 → 项目共享的触发方式（工具动作 / 面板按钮 / 定时归纳）。
（删除相关已定：**能看到的人都能删**；软删保留 **1 个月**；用户可在面板上直接软删或彻底删除。）

## 7 底座验证（2026-10-20，在 `/tmp` 内完成，未动仓库）

做法：克隆 MemOS（sparse：`apps/memos-local-plugin` + `packages`）→ `npm install`（326 包）→ 用
`bootstrapMemoryCoreFull({ agent, home })` 直接起核心（不装 OpenClaw/Hermes/DSH，也不起 Viewer）。

| 验证项 | 结果 |
|---|---|
| 无 key 启动 | ✅ 自定义 home → `<home>/data/memos.db`，`health.ok=true` |
| 多实例隔离（四角色=四个 store 的前提） | ✅ home-A 搜不到 home-B 的记忆 |
| 写入 + 检索（英文） | ✅ 咖啡→拿铁、宠物→猫、语言→TypeScript |
| 写入 + 检索（中文） | ✅ 咖啡→拿铁、宠物→猫、语言→TypeScript |
| 不配 LLM 时 | ⚠️ 检索质量明显下降：关键词通道把整句当 FTS 查询，停用词（is/I）会让不相关条目排第一 |
| 默认本地 embedding（Xenova/all-MiniLM-L6-v2） | ⚠️ 需要从 HuggingFace 下载 ONNX 模型（本环境被墙，`fetch failed`）；目标机器能访问 HF 时可用 |
| OpenAI 兼容 embedding（Ollama `nomic-embed-text`） | ✅ 768 维；检索 12–43ms |
| 删除语义 | ⚠️ `deleteTrace` 是**硬删除**（幂等）；软删/1 个月保留必须由我们上层实现 |
| 冷启动 | ⚠️ 首次 LLM 调用 ~19.6s（7B 模型加载），之后每轮 0.3–0.5s |

### 模型分工：LLM 与 Embedding 是两回事

MemOS 需要**两个模型槽位**，不能互相替代：

| 槽位 | 干什么 | 能用什么 |
|---|---|---|
| **LLM（chat/completions）** | 事实抽取、摘要、反思、关键词、Skill 演化 | 任何 OpenAI 兼容的 **chat** 模型：我们 `models.json` 里的 `home-flashnext/qwen3.8-flash-next-iq3_s`、`command/*`，或本地 Ollama `qwen2.5` |
| **Embedding（/v1/embeddings）** | 把文本变成向量（语义检索） | **必须是一个 embedding 模型**：Ollama `nomic-embed-text`（已验证）、`bge-m3`（中文更好，待评估）、HuggingFace 本地 ONNX、或任意 OpenAI 兼容 embeddings 端点 |

**结论**：`qwen3.8-flash-next-iq3_s` 是 chat 模型（`/chat/completions`），**不能当 embedding 用**；它只填 LLM 槽位。我们还需要一个独立的 embedding 模型（推荐 Ollama `nomic-embed-text`，274MB，本地、无 key）。

### 建议配置（概念样例；实际从 `~/.lifeos/config/models.json` 读 provider）

```yaml
llm:
  provider: openai_compatible
  endpoint: https://llm.ai4child.asia/v1     # 或 http://127.0.0.1:11434/v1
  model: qwen3.8-flash-next-iq3_s            # 或 qwen2.5:7b-instruct
  apiKey: <从 models.json 取>
  timeoutMs: 120000
embedding:
  provider: openai_compatible
  endpoint: http://127.0.0.1:11434/v1
  model: nomic-embed-text
  apiKey: ollama
```

注意：`home-flashnext` 与 `command` 的 `/chat/completions` 实测可用（403 只是缺 User-Agent）；两者都能当 LLM。

## 8 实现顺序

1. ✅ **四个 store + 内部读写 API**（P1，2026-10-20 完成）
2. 三个记忆工具（search / record / delete，描述即权限契约）+ prompt 规则（P2）
3. "记忆"面板（列表/搜索/删除/来源标注）（P3）
4. 提升与跨项目检索（按 §6 的结论）

## 9 P1 实现（2026-10-20，已完成并验证）

| 文件 | 作用 |
|---|---|
| `src/memory/roles.ts` | 四角色与落点（纯函数）：用户 / Agent / Agent×项目私有 / 项目共享；`defaultReadOrder` = 私有→项目共享→Agent→用户 |
| `src/memory/config.ts` | LLM 与 embedding 配置：默认 embedding = Ollama `nomic-embed-text`；LLM = `memory.json` 直配（Ollama）或 `models.json` 里第一个可用 provider；**密钥只进进程环境变量**，写盘的 `config.yaml` 只放 `${LIFEOS_MEMORY_API_KEY}` |
| `src/memory/store.ts` | 每角色一个 MemOS 本地核心（一 SQLite）；`storeFor(role)` 懒启动、`closeMemoryStores()` 收尾 |
| `src/memory/index.ts` | `recordMemory` / `searchMemory` / `searchMemoryScopes`（按顺序合并）/ 软删除三件套（`softDeleteMemory`、`restoreMemory`、`purgeDeleted`）/ `listDeleted` |
| `src/memory/soft-delete.ts` | 软删清单（`soft-deleted.json`）；满 30 天后才允许 purge |
| `src/memory/merge.ts` | 多角色结果合并（先到先得、按 id 去重、截断） |

**两个实现要点**：

1. **配置写盘**：MemOS 会在运行中从 `<store>/config.yaml` **重新加载配置**（内存里传的 config 会被覆盖），所以每个 store 都要落一份 config.yaml；密钥用 `${LIFEOS_MEMORY_API_KEY}` 占位，真实值只在本进程 env 里（不复制到磁盘）。
2. **删除**：MemOS 的 `deleteTrace` 是硬删除；软删除/30 天保留在我们这一层（`soft-deleted.json` 过滤 + 过期后才调硬删）。

**P1 验证（临时 home + 本地 Ollama，未动用户数据）**：

| 验证 | 结果 |
|---|---|
| 四角色写入 | ✅ agent_project×2、project、user 各写入一条 |
| 角色内检索 | ✅ 咖啡→拿铁、宠物→猫、项目约定、用户住址 |
| 跨 Agent 隔离 | ✅ coder 搜"宠物"返回空（看不到 plant 的私有记忆） |
| 合并读取（默认顺序） | ✅ 咖啡→agent_project、约定→project、住址→user |
| 软删除 → 恢复 → 过期 purge | ✅ 删后不可见、恢复可见、31 天后 purge 后彻底不可见 |
