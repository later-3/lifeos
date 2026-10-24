# 记忆需求

> 角色：需求　类型：需求　状态：**草案（待审阅）**
>
> 架构（用什么底座、怎么落盘、怎么和组件配合）见 [`../architecture/agent-memory.md`](../architecture/agent-memory.md)。
> 本文只写：Life OS 需要哪些记忆功能、怎么用架构实现、还缺什么、怎么测。

## 1 背景与目标

Agent 现在只有会话 JSONL 和日志文件：换个会话、换个项目、换个 Agent，之前确认过的事实就丢了。

目标：

1. 四类事实各归其位：**项目共享记忆 / 用户记忆 / Agent 记忆 / agent 的项目记忆**；
2. 写入可控（默认不把私有经验写进公用项目）、读取有优先级、删除明确；
3. 全部本地：无 Docker、无云 key；
4. 用户能看到"进了哪些记忆"。

## 2 场景

| # | 场景 | 写到哪里 | 读取效果 |
|---|---|---|---|
| S1 | 在项目里定下约定："提交前必须跑 `pnpm verify`" | 项目共享记忆 | 该项目下任何 Agent 之后问起都能命中 |
| S2 | 用户说"我喜欢喝拿铁，不加糖" | 用户记忆 | 换 Agent、换项目仍然记得 |
| S3 | coder 在 lifeos 里踩坑："这个项目的测试要先起 dev server" | **agent 的项目记忆**（私有） | 只有 coder 在 lifeos 里能命中；plant 看不到 |
| S4 | Agent 总结自己的工作方式："我习惯先读 AGENTS.md 再动手" | Agent 记忆（跨项目） | 这个 Agent 在任何项目里都能用到 |
| S5 | 隔离：plant 在 lifeos 里记了"我的猫叫豆豆"（私有） | agent 的项目记忆 | coder 在 lifeos 搜"宠物"**必须搜不到** |
| S6 | 用户说"把那条错误的记忆删掉" | 对应角色 | **硬删除、不可恢复**，删除后检索不到 |

## 3 功能需求

### FR-1 四类记忆的写入

- 写入必须指定角色（`scope` 必填，没有隐式默认）；
- **写到哪一层按用户当时的指示与信息决定**；不自动「共享/提升」，也不自动把每段对话记下来；
- 每条记忆必须能回传 `id` + 角色（删除/展示需要）。

**验收**：四类各写一条；`id` 唯一；不传 `scope` 的写入被拒绝。

### FR-2 检索

- 角色内检索：给定角色 + query，返回按相关性排序的命中；
- **默认合并顺序**（不指定角色时）：
  1. **agent 的项目记忆**（当前 Agent + 当前项目）
  2. **项目共享记忆**（当前项目）
  3. **Agent 记忆**（当前 Agent，跨项目）
  4. **用户记忆**
- 显式指定角色时只搜该角色；
- **跨项目默认不搜**；要跨项目必须显式传 `projectId`，结果标注来源项目；
- 跨项目规则（2026-10-20 定）：**只要 `projectId` 全局唯一，就允许显式读取该项目的「项目共享记忆」**；默认仍只搜当前项目；跨项目**不能**读别的 Agent 的「agent 的项目记忆」；
- 前提：`projectId` **全局唯一**（2026-10-20 已实现全局项目注册表：`~/.lifeos/projects/<name>/project.json`，同一目录只有一份）。

**验收**：S1–S5 的检索结果正确；S5 中 coder 搜不到 plant 的私有记忆；合并结果按上述顺序、无重复。

### FR-3 删除

- **硬删除、不可恢复**（MemOS `deleteTrace`）；幂等（重复删不报错）；
- 只在用户**明确要求**时执行；调用方（工具/UI）负责二次确认；
- 批量删除默认不提供；如提供，必须先列出将删条目与数量再确认；
- **不支持编辑/撤销**：只有「增 / 查 / 删」三个操作；写错 = 删除旧条目 + 新增（底层 MemOS 有 updateTrace，但不暴露）；
- 解绑项目 / 归档 Agent **不级联删除**记忆。

**验收**：删除后检索不到；重复删除返回"未删除"；解绑项目后记忆仍在（重新绑定可见）。

### FR-4 隔离

| 记忆 | 谁能读 | 谁能写 | 谁能删 |
|---|---|---|---|
| 项目共享记忆 | **所有 Agent**（含跨项目，凭全局 `projectId`） | 该项目下所有 Agent | **所有 Agent**（2026-10-20 定：读/写/删都放开给所有 Agent） |
| 用户记忆 | 该用户的所有 Agent、所有项目 | 同左 | 同左 |
| Agent 记忆 | 仅该 Agent | 仅该 Agent | 仅该 Agent |
| **agent 的项目记忆** | 仅该 Agent（在该项目内） | 仅该 Agent（在该项目内） | 仅该 Agent（在该项目内） |

**验收**：越角色读/写/删一律被拒绝（或不可见），并有明确原因；跨项目只能读到「项目共享记忆」。

### FR-5 工具契约

对模型暴露 **3 个工具**（参数与描述即权限契约）：

```
lifeos_memory_search  { query, scope?, projectId?, limit? }
lifeos_memory_record  { content, scope, projectId? }
lifeos_memory_delete  { id, scope, projectId? }
scope: "agent_project" | "project" | "agent" | "user"
```

- 工具描述必须逐条写清：每个 scope 的读写边界、默认隔离、跨项目条件、删除不可恢复、越权拒绝；
- `agent_project` / `project` 必须带 `projectId`；
- 跨项目检索必须显式传**全局唯一**的 `projectId`，且只能读该项目的「项目共享记忆」；
- 删除标注 `destructiveHint`，只在用户明确要求时调用。

**验收**：工具描述能独立回答「我能读写什么」；模型在无提示情况下不跨项目检索、不擅自删除；不存在编辑/撤销类工具。

### FR-6 Prompt 规则

- 规则：记忆的层次、读写与删除规则写在协议 §3.11（`~/.lifeos/interaction-harness/protocol.md`），随协议正文装配进 harness 区（内容来自文件，不写死在代码里）；
- 默认只在当前上下文回忆（按 FR-2 的顺序）；
- 写入落层规则：项目约定/架构 → 项目共享记忆；用户偏好/长期事实 → 用户记忆；跨项目经验 → Agent 记忆；本项目踩坑/做法 → agent 的项目记忆；
- 跨项目检索要说明原因并标注来源；
- 写项目共享记忆必须是用户明确指示（`scope=project`），不能自动外溢；
- 删除只在用户明确要求时做。

**验收**：模拟一轮对话，模型在"记到哪层"和"要不要跨项目"上做出符合规则的判断。

### FR-8 配置与密钥

- LLM（抽取/摘要/关键词）与 Embedding（向量）分开配置；
- Embedding 默认 Ollama `nomic-embed-text`（本地、无 key）；LLM 可用 `models.json` 里的 chat 模型或本地 Ollama；
- **密钥不落盘**：配置文件的密钥位置用环境变量占位，真实值只在进程环境；
- 模型不可用时给出明确原因（不静默降级到不可用状态）。

**验收**：删除环境变量后启动失败并提示；正常启动时 `health` 显示 LLM/embedding 可用、维度正确。

### FR-9 数据与生命周期

- 落点：`~/.lifeos` 下的四类目录（见架构 §2）；
- 不写进用户的代码仓库目录；
- 解绑项目、归档 Agent 不删除记忆；
- 备份/导出：至少能整目录备份；导出接口（后续）。

**验收**：四个目录各自出现 `config.yaml` / `data/memos.db`；解绑/归档后文件仍在。

## 4 怎么用架构实现（需求 → 组件）

| 需求 | 用架构里的什么 | 现状 |
|---|---|---|
| FR-1 写入 | `src/memory/roles.ts`（角色→路径）+ `store.ts`（每角色一个 MemOS core）+ `index.ts::recordMemory` | ✅ P1 |
| FR-2 检索 | `index.ts::searchMemory` / `searchMemoryScopes` + `merge.ts`（顺序/去重） | ✅ P1（合并顺序已实现） |
| FR-3 删除 | `index.ts::deleteMemory` → MemOS `deleteTrace` | ✅ P1 |
| FR-4 隔离 | 一个角色一个 SQLite（物理隔离）+ 角色路径 | ✅ P1（隔离已验证） |
| FR-5 工具 | `src/agent-tools.ts` 的 3 个工具（scope/projectId 解析见 `src/memory/resolve.ts`） | ✅ P2（已接） |
| FR-6 Prompt | 记忆规则在协议 §3.11，随协议正文装配；3 个工具的 description 写权限 | ✅ 已接 |
| FR-8 配置 | `src/memory/config.ts`（LLM/embedding/env 密钥） | ✅ P1 |
| FR-9 生命周期 | 四类目录 + 不级联（`projects.ts`/`agents.ts` 不删记忆） | ✅ 目录；导出未做 |

## 5 还需要补的功能（缺口）

1. **P2 工具**：`lifeos_memory_search/record/delete`（描述即权限契约）+ prompt 规则；
3. **导出/备份**：整目录备份之外，是否需要 JSON 导出；
4. **审计**：删除记录（谁/何时/哪条）落到哪里。

## 6 非目标（当前不做）

- 软删除 / 回收站（用户已定：硬删除）；
- 云同步 / 云 API（Platform）、Docker 自托管；
- 跨项目自动检索（默认隔离，显式才查）；
- **自动捕获（2026-10-20 定：暂时不做）**——只通过工具显式写入；
- Graph Memory / Neo4j；
- 多用户账号体系（当前单用户 `default`）；
- **记忆面板 / 记忆浏览 UI（2026-10-20 定：不做；调试用 MemOS Viewer）**。

## 7 测试与验收

**单测（已有 107/107）**

- 角色路径与 key（`test/memory-roles.test.mjs`）；
- 多角色合并顺序/去重（`test/memory-merge.test.mjs`）。

**集成测试（需本地 Ollama；建议用临时 home，不碰真实数据）**

- 四角色写入 → 角色内检索；
- 隔离：A 的私有记忆 B 搜不到；
- 合并顺序：agent 的项目记忆 → 项目共享记忆 → Agent 记忆 → 用户记忆；
- 硬删除：删后检索不到、重复删幂等。

```bash
LIFEOS_HOME=$(mktemp -d) node --experimental-strip-types test/memory.integration.mjs
```

**验收清单**

| 场景 | 预期 |
|---|---|
| S1 项目约定 | 项目内任一 Agent 后续检索命中 |
| S2 用户偏好 | 换 Agent/项目仍命中 |
| S3 私有踩坑 | 只有该 Agent 在该项目命中 |
| S4 Agent 经验 | 该 Agent 跨项目命中 |
| S5 隔离 | 其他 Agent 搜同一 query 无结果 |
| S6 删除 | 删除后不可见、不可恢复 |

## 8 未决问题

暂无未决。已定：
- 读取顺序：agent 的项目记忆 → 项目共享记忆 → Agent 记忆 → 用户记忆；
- 只有增/查/删三个操作，不支持编辑/撤销（写错 = 删旧 + 新增）；
- 不做「提升/共享」动作：写哪一层由用户当时的指示决定；
- 记忆策略写在协议 §3.11（`~/.lifeos/interaction-harness/protocol.md`），由装配加载（不写死在代码里）。

## 9 交付顺序

1. ✅ P1：四角色 store + 读写 API + 硬删除（已实现，待审阅）；
2. ✅ P2：3 个工具 + prompt 规则（工具描述即权限契约）——已实现；
3. P4：导出/备份、审计（可选；自动捕获、记忆面板都不做）。
