# Agent 记忆（架构）

> 角色：架构　类型：设计　状态：**设计 + P1 实现（待审阅）**
>
> 本文只写：**用什么底座、怎么落盘、怎么和组件配合、怎么落地**。
> Life OS 需要哪些记忆功能、怎么使用、缺什么、怎么测 → 见 [`../requirements/agent-memory.md`](../requirements/agent-memory.md)。

## 1 底座决策

| 项 | 决策 | 理由 |
|---|---|---|
| 记忆底座 | **MemOS 本地核心**（`MemTensor/MemOS`，Apache-2.0，TypeScript；SQLite + FTS5 + 向量；L1/L2/L3/Skill 四层演化） | 本地优先、无 Docker、无云 key；记忆模型最完整（trace → policy → world model → skill） |
| 不用 **mem0** | — | Platform 要 key 且数据上云；OSS 在无 Docker 的 Node 环境没有顺手的持久向量库 |
| 不用 **Memmy** | — | 与 MemOS 同组织、同一套记忆模型，但形态是"完整产品 + 常驻服务"；我们只需要记忆能力 |
| 不用 MemOS Cloud / Neo4j / Docker 自托管 | — | 与"本地、无容器、无云 key"冲突 |
| 不采用 `pi-memory` | — | 只作为"日记 = 每日日志"的形态参考 |

## 2 四类记忆与落盘

**归属先于权限**：一条事实跟着谁走，就落哪一类；同一事实只落一类。

本文的 `<projectId>` 一律指**全局项目注册表**的 id（`~/.lifeos/projects/<id>/project.json`，2026-10-20 已实现）；Agent 的绑定目录名也是这个 id。

| # | 记忆 | 归属 | 落点 |
|---|---|---|---|
| 1 | **项目共享记忆** | 项目（全局实体，不挂在某个 Agent 下） | `~/.lifeos/projects/<projectId>/memory/` |
| 2 | **用户记忆** | 用户 | `~/.lifeos/memory/user/<userId>/` |
| 3 | **Agent 记忆** | Agent（跨项目） | `~/.lifeos/agents/<agentId>/memory/` |
| 4 | **agent 的项目记忆**（私有） | Agent（在某项目内） | `~/.lifeos/agents/<agentId>/projects/<projectId>/memory/` |

第 4 种放在 **Agent 自己的层级**、而不是公用的 project 目录里：外面那个 project 是所有 Agent 共用的，私有经验不能写进去。

**隔离方式**：一个角色 = 一个 MemOS 本地核心 = 一个 SQLite（物理隔离），不是靠查询过滤。

## 3 隔离与读取顺序

- **默认隔离**：Agent 在项目 P 里工作时，默认不加载、不搜索其它项目的记忆。
- **读取顺序**（越具体越优先）：
  1. **agent 的项目记忆**（当前 Agent + 当前项目）
  2. **项目共享记忆**（当前项目）
  3. **Agent 记忆**（当前 Agent，跨项目）
  4. **用户记忆**
- 跨项目读取不是禁止，但不是默认：必须显式传**全局唯一**的 `projectId`，且只能读该项目的「项目共享记忆」，结果标注来源（规则见需求 FR-2/FR-5）。
- **项目共享记忆对所有 Agent 可读/可写/可删**（含跨项目）；默认检索仍只覆盖当前项目。
- 前提：`projectId` 必须全局唯一。当前项目 id 是按 Agent 目录名生成的（同一目录两个 Agent = 两个 id），需要先完成 `docs/todo.md` #1。

## 4 组件与接口

```
src/memory/roles.ts   四角色 → 路径（纯函数）；defaultReadOrder 给出上面的顺序
src/memory/config.ts  LLM / embedding 配置；密钥只进进程环境变量
src/memory/store.ts   每角色一个 MemOS core（懒启动 / 统一关闭）
src/memory/index.ts   recordMemory / searchMemory / searchMemoryScopes / deleteMemory
src/memory/merge.ts   多角色合并（顺序、去重、截断）
```

对上层（P2 工具、P3 面板、HTTP）只暴露 `src/memory/index.ts`：

| 函数 | 作用 |
|---|---|
| `recordMemory(role, { userText, agentText, toolCalls?, sessionId?, ts? })` | 写入一轮 |
| `searchMemory(role, query, { limit? })` | 角色内检索 |
| `searchMemoryScopes(roles, query, { limit? })` | 多角色合并检索（顺序由调用方给） |
| `deleteMemory(role, id)` | 硬删除（不可恢复、幂等） |

**接入点**（P2/P3，具体功能与权限契约见需求文档）：

- 工具：`src/agent-tools.ts` 新增 3 个工具（search / record / delete；**没有编辑/撤销**），调用上面的函数；
- Prompt：`~/.lifeos/interaction-harness/memory.md`（四类记忆与策略）由 `src/assembly.ts` 装配进 harness 区——**不写死在代码里**；
- 面板：新 HTTP 路由读同一批 SQLite，前端按角色分组展示。

## 5 底座验证（2026-10-20，`/tmp` 内完成，未动仓库）

做法：克隆 MemOS（sparse：`apps/memos-local-plugin` + `packages`）→ `npm install` → 用 `bootstrapMemoryCoreFull({ agent, home })` 直接起核心（不装 OpenClaw/Hermes/DSH，也不起 Viewer）。

| 验证项 | 结果 |
|---|---|
| 无 key 启动 | ✅ 自定义 home → `<home>/data/memos.db`，`health.ok=true` |
| 多实例隔离 | ✅ home-A 搜不到 home-B 的记忆 |
| 写入 + 检索（中/英） | ✅ 咖啡→拿铁、宠物→猫、语言→TypeScript |
| 不配 LLM | ⚠️ 检索质量明显下降（关键词通道把整句当 FTS 查询，停用词让不相关条目排第一） |
| 默认本地 embedding（Xenova） | ⚠️ 需从 HuggingFace 下载 ONNX（本环境被墙） |
| Ollama embedding（`nomic-embed-text`） | ✅ 768 维；检索 12–43ms |
| 删除 | ✅ `deleteTrace` 是硬删除（幂等） |
| 冷启动 | ⚠️ 首次 LLM 调用 ~19.6s（7B 加载），之后 0.3–0.5s/轮 |

### 模型分工：LLM 与 Embedding 是两回事

| 槽位 | 干什么 | 能用什么 |
|---|---|---|
| **LLM（chat/completions）** | 抽取、摘要、反思、关键词、Skill 演化 | 任何 OpenAI 兼容 **chat** 模型：`models.json` 里的 `home-flashnext/qwen3.8-flash-next-iq3_s`、`command/*`，或本地 Ollama |
| **Embedding（/v1/embeddings）** | 文本 → 向量 | **必须是 embedding 模型**：Ollama `nomic-embed-text`（已验证）、`bge-m3`（待评估）、本地 ONNX、任意 OpenAI 兼容 embeddings |

`qwen3.8-flash-next-iq3_s` 是 chat 模型，**不能当 embedding**。

### 配置（`config.yaml`，密钥用环境变量占位）

```yaml
llm:
  provider: openai_compatible
  endpoint: https://llm.ai4child.asia/v1     # 或 http://127.0.0.1:11434/v1
  model: qwen3.8-flash-next-iq3_s
  apiKey: ${LIFEOS_MEMORY_API_KEY}
  timeoutMs: 120000
embedding:
  provider: openai_compatible
  endpoint: http://127.0.0.1:11434/v1
  model: nomic-embed-text
  apiKey: ollama
```

MemOS 会在运行中从 `<store>/config.yaml` **重新加载配置**，所以每个 store 必须落盘一份；真实密钥只进进程环境。

## 6 P1 实现（2026-10-20，已实现，待审阅）

| 文件 | 作用 |
|---|---|
| `src/memory/roles.ts` | 四角色与落点；`defaultReadOrder` = agent 的项目记忆 → 项目共享记忆 → Agent 记忆 → 用户记忆 |
| `src/memory/config.ts` | LLM/embedding 配置；默认 embedding = Ollama nomic；密钥只进 env，写盘用 `${LIFEOS_MEMORY_API_KEY}` |
| `src/memory/store.ts` | 每角色一个 MemOS core（一 SQLite），懒启动/统一关闭 |
| `src/memory/index.ts` | `recordMemory` / `searchMemory` / `searchMemoryScopes` / `deleteMemory`（硬删除） |
| `src/memory/merge.ts` | 多角色合并（先到先得、按 id 去重、截断） |

**实现要点**：

1. **配置写盘**：内存里传的 config 会被 MemOS 从磁盘重载覆盖 → 配置必须落盘；密钥用 `${ENV}` 占位，真实值只在进程环境。
2. **删除**：直接用 MemOS 的硬删除（`deleteTrace`），不做软删/回收站。

**P1 验证（临时 home + 本地 Ollama）**：四角色写入；角色内检索；跨 Agent 隔离（coder 搜不到 plant 的私有记忆）；合并顺序正确；硬删除后检索不到。

## 7 待办

- P2 工具 + prompt（需求文档 FR-5/FR-6）；
- P3 面板（FR-7）；
- P4 导出/备份、审计（可选；自动捕获暂不做）。
