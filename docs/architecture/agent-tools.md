# Agent 工具架构（Life OS Agent 的能力类型）
> 角色：架构　类型：说明　状态：**第一部分（类型清单）已写出；后续部分（每类具体怎么支持）待补**
>
> **本文是"工具/能力类型"的唯一权威**：Life OS 其他地方涉及工具时**只引用本文**，不重复定义（模块文档只写"某项怎么配置/怎么用"）。
>
> **本文只管一件事**：Life OS Agent 的工具/能力**可以有哪些类型**、为什么支持它们。
> 具体机制各有主人，本文不复制：Prompt 区域与承载 → [`prompt/README.md`](./prompt/README.md)、[`prompt/mechanism.md`](./prompt/mechanism.md)；
> 模型与配置 → [`agent.md`](./agent.md) §9；记忆 → [`agent.md`](./agent.md) §11 与 `../modules/memory/README.md`（已删除）。

## 1 口径（先讲清，避免误解）

1. **类型是架构层的声明**：它回答"Agent 的工具可以有哪几类"，不回答"现在做了没有"。
2. **支持类型 ≠ 立刻开发**：每一类"具体怎么支持"后面单独补（本文的后续部分）。
3. **不是全部都要**：按需筛；筛完的每一类再按**四格**补齐——① 定义/清单在哪 ② 谁提供（Life OS 自带／用户装／底座）③ Agent 上怎么表达 ④ 装配怎么生效、怎么验证。
4. **能用 Pi 的就用 Pi 的**：Pi 生态已经定义了这些类型与加载方式，Life OS 不另造一套；只有 **Life OS 特有**的类型才由我们自己定义。

## 2 工具类型清单（第一部分）

| # | 类型 | 是什么 | 为什么支持（来源） | 现状 | 可配置 |
|---|---|---|---|---|---|
| 1 | **Pi 默认能力**（native 工具） | Pi 自带的文件/命令行工具（read / write / edit / ls / find / grep / bash…） | Pi 生态默认提供 | ✅ 已接入 | **要**（Agent 可选 `pi-default` / `explicit` / `none`） |
| 2 | **Life OS 自带工具** | 我们自己的业务工具（`src/tools/builtins/`，当前 **27 个**） | Life OS 提供，经 Pi 的 `customTools` 通道注入 | ✅ 已接入（该 Agent 27 选 **22**） | **要**（按地址声明） |
| 4 | **扩展** Extension | TypeScript 模块：加工具、命令、事件处理器、provider、会话状态、UI | Pi 生态（`pi docs/extensions.md`） | ❌ 未接入 | 待筛 |
| 5 | **MCP 服务器** | 连外部 MCP（stdio/HTTP），把它的工具与资源给模型 | Pi 生态（`pi docs/mcp.md`） | ❌ 未接入 | 待筛 |
| 6 | **提示模板** Prompt Template | Markdown → 可复用 `/` 命令 | Pi 生态（`pi docs/prompt-templates.md`） | ❌ 未接入 | 待筛 |
| 7 | **codemode** | Pi 的一个工具：模型写 JS 脚本调用其它工具与非 LLM 模型 | Pi 生态（`pi docs/codemode.md`） | ❌ 未接入 | 待筛 |
| 8 | **包** Package | 把 extensions + skills + 提示模板 + 主题打成一个分发单位 | Pi 生态（`pi docs/packages.md`） | ❌ 未接入 | 待筛（偏"分发"，可能不算能力类型） |
| 10 | **子 Agent 委派** | 把其它 Long Agent / 群组当"工具"调用 | **Life OS 特有** | ❌ 未实现（旧工具已删） | 待筛 |
| 11 | 模型类（自定义 provider / 虚拟模型） | 接模型来源与路由 | Pi 生态 | ❌ 未接入 | 不属工具类型（归 §9 配置） |

**待筛状态（2026-10-15）**：1、2、3 暂记"要（可配置）"；4–10 待用户逐条给"要 / 不要 / 以后"。

**注意**：第 12 条**不是"一个工具"**——工具由模型主动调用，而任务必须由系统在到点时**唤醒** Agent；它的形态是"系统行为 + Agent 工具面 + 前端配置面"三面，详见 [`agent-tasks.md`](./agent-tasks.md) §1。

## 3 现状：工具从哪来、怎么生效（代码事实）

**三条通道，互不替代**（这是"现在是什么样"，不是"应该是什么样"）：

| 通道 | 定义/清单在哪 | 怎么生效（接口与代码） | 当前实际取值 | 怎么验证 |
|---|---|---|---|---|
| ① **Pi native 工具** | Pi 自己；默认集由 Pi 的 `SettingsManager.getDefaultTools()` 决定 | `createAgentSession(...)` 的 `tools` / `excludeTools` / `noTools`；不传即用 Pi 默认。代码兜底 `["read","bash","edit","write"]`（`src/agents/pi-agent-session.ts:232-237, 260, 386-411`） | 本机 `~/.lifeos/agent/settings.json` 只有默认 provider/model/thinking，**未设默认工具集** → 走 Pi 默认 | 请求体 `tools` 字段；Pi 会话的 active tools |
| ② **Life OS 自带工具** | `src/tools/builtins/<名>/{manifest.json,index.ts}`（**27 个**） | Agent 在 `capability-config.json` 用 `tools.addresses = ["system:tool/…"]` 声明；装配时 `resolveLife OSSystemTools(...)` 解析 → 作为 `customTools` 注入（`pi-agent-session.ts:239-259, 279-283, 386-392`） | 声明 **22 条**；`tools.mode = "pi-default"` | `capability-config.json` 的 addresses；装配出的工具数与请求 `tools` |
| ③ **文件工具守卫版** | Life OS 代码 `scopedFileTools({cwd, ownWorkspace, frozenFiles, resourceRoots})` | 同 ②，作为 `customTools` 的一部分注入（`pi-agent-session.ts:272-283`） | 已生效（绑定工作区/冻结文件/技能目录的 read/write/edit/ls/find/grep） | 试越界读写 → 应被拦 |

调用方还可注入 `options.customTools`（按 scope 过滤，`pi-agent-session.ts:278`）。

**技能（Skill）的发现路径**：由 Pi 的 `DefaultResourceLoader` 发现（`pi-agent-session.ts:175`）；
路径 = Pi 的 agentDir（`<home>/agent`）下的 `skills/` ＋ Life OS 传入的 `additionalSkillPaths`（例如项目的 `.lifeos/skills`，`src/resources/skills-tree.ts:141`）；
生效方式 = 只把 **name/description** 放进 system prompt，正文按需读（Pi 行为）。

**扩展 / MCP / codemode**：当前**未接入**（源码只有登记性字符串；家里没有 `mcp.json`）。

## 4 下一步（本文的后续部分）

1. 用户逐条筛 §2 的 4–10；
2. 对"要"的每一类，按四格补写"具体怎么支持"；
3. 涉及 Agent 侧的表达（`agents/<id>/capability.json` 怎么写、默认集从哪来）在那一部分一并定。
