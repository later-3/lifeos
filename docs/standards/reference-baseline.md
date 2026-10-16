# 参考基线（开发 Life OS 时"照谁做"的收敛定义）

> 角色：开发规范　类型：决策　状态：现状
>
> **为什么要有这份文档**：只说"行业惯例"会四不像——每个项目的机制与命名都不一样。
> 所以本仓库**只认下面列出的参照点**：每个参照点必须写明「**场景 → 具体项目 → 具体文件/机制 → 借什么、不借什么**」。
> 没写进来的，不许用"行业惯例/业界标准"当依据（要么补一行，要么先讨论）。

## 1. 主参照：Pi 生态（Life OS 建在 Pi 之上，能抄就抄）

| 场景 | 参照点（具体文件/机制） | 借什么 | 不借什么 |
|---|---|---|---|
| 资产打包与安装 | Pi `docs/packages.md`：`package.json` 的 `pi` 字段显式声明 + 约定目录；`pi install` 写声明到 `settings.json`；`pi update --extensions` 幂等 reconcile；本地路径装载不复制 | "声明 + 幂等 reconcile + 冲突保留先发现者并告警"的形态 | 不为 Life OS 另造一套包管理器 |
| 技能（skill） | Pi `docs/skills.md`：约定目录 + 递归发现；启动只把 **name/description/path** 放进 system prompt；正文按需读取 | 目录约定、发现顺序、"索引进 prompt、正文按需" | 不改 Pi 的发现规则 |
| 用户目录布局 | 实机 `~/.pi/agent/`：`auth.json`、`models.json`、`settings.json`、`extensions/`、`skills/`、`npm/` | 家的根放**名词式 json**（`config.json` 风格）、子目录按功能 | 不照搬 Pi 目录名（我们的家叫 `~/.lifeos`） |
| Agent 会话装配 | Pi `createAgentSession({ appendSystemPromptOverride, settingsManager, sessionManager, resourceLoader, customTools, model, thinkingLevel, providerRequestGate })` | 只用公开入口，不自建运行时 | 不 fork/改造 Pi |
| 运行时资产随包发布 | 本仓库实测教训（2026-10-15）：资产必须进构建（`nitro.config.ts` `serverAssets`），dev 读源码、构建态读 `assets:<baseName>` | 同一读法通吃两种形态 | 不假设"源码一定在" |

## 2. 次参照（只在写明场景时使用）

| 场景 | 参照点 | 借什么 | 不借什么 |
|---|---|---|---|
| 安装记录（install receipt）的**文件名** | Homebrew `INSTALL_RECEIPT.json` | **只借用词** `install-receipt.json` | 不借它的机制（Cellar 布局、formula 概念） |
| 依赖/内容锁定概念 | npm `package-lock.json`（Pi 自己也在用：`~/.pi/agent/npm/`） | "锁定 + 漂移检测"的想法（我们记录 sha256 判断用户是否改过） | 不引入 npm 依赖树语义 |

## 3. 明确不参照

- **泛泛的"行业惯例"**：不写具体项目与文件的，不作为依据；
- 与本项目形态差异大的系统（K8s/Helm/Terraform 等）：除非某场景真的需要它已成型的小机制，否则不引；
- 第三方 Agent 框架（LangChain 等）：Life OS 的 Agent 运行时是 Pi，**不引第二套**。

## 4. 使用规则

1. 提出新机制/新命名时，先在本文件找到**对应场景行**；找不到就**先补行**（补行要写明"借什么、不借什么"）；
2. 参照点要**可核**：给出文件路径、命令或实机位置，不写"某某框架一般这么做"；
3. 与 Pi 冲突时，**以 Pi 的公开接口与文档为准**；要偏离必须在本文件写明理由（并登记为决策）。
