# Life OS

life os 是一套 agent 与用户之间长期协作的系统，主要包含两个模块：

1. **交互 harness 协议**：agent 与用户长期协作时共同遵守的规则与资产
2. **agent 工具**：基于交互 harness 协议，提供 agent 与用户之间的协作功能

## 项目结构

```
lifeos/
├─ src/        后端（Node + TypeScript）：HTTP 接口、Agent 会话、Prompt 装配
├─ frontend/   前端（Vite + React）：浏览器界面，构建为纯静态产物
├─ pi/         Pi SDK 源码（git 子模块，直接以源码方式使用）
├─ assets/     随包资产（交互 harness 协议正文等）
├─ docs/       设计文档
└─ test/       后端测试
```

- 前后端分离：后端提供 HTTP 与事件流，前端是纯静态页面
- 运行时数据默认写入家目录 `~/.lifeos`；仓库内只有代码与文档
- 设计文档入口：`docs/architecture/`（目录结构见 `directory-structure.md`，技术底座见 `foundation.md`）

## 快速开始

### 环境要求

- Node.js `>=22.19.0`
- pnpm（用于安装本项目依赖；`npm install -g pnpm` 或 `corepack enable pnpm` 均可）

### 1. 获取代码

```bash
git clone --recurse-submodules <仓库地址>
cd lifeos
```

如果克隆时忘了 `--recurse-submodules`：

```bash
git submodule update --init
```

### 2. 安装依赖

项目有两部分依赖要装：`pi/`（Pi SDK 源码）和项目本身。

```bash
# ① 安装 Pi SDK 自己的依赖（读 pi/package.json，装到 pi/node_modules）
npm --prefix pi ci --ignore-scripts

# ② 首次需要联网准备模型数据（Pi 的构建会校验它）
npm --prefix pi run hydrate:model-data

# ③ 构建 Pi SDK（产出 pi/packages/*/dist，后端 import 的就是它）
npm --prefix pi run build:offline

# ④ 安装本项目依赖（根 package.json 与 frontend/）
pnpm install
```

确认安装成功：

```bash
ls pi/packages/coding-agent/dist      # 应包含 index.js 等文件
ls -l node_modules/@earendil-works    # 三个包指向 pi/packages/*
```

这四条命令只在**首次安装、切换分支或依赖变化**时需要执行，日常开发无需重复；其中 ② 仅在模型数据缺失或过期时需要重跑（也可用 `npm --prefix pi run build` 让它自动刷新后构建，但会联网）。

> 网络受限时可通过代理安装，例如：
> ```bash
> git config --global http.proxy http://127.0.0.1:<端口>
> npm config set proxy http://127.0.0.1:<端口>
> ```

### 3. 运行

**开发模式**

```bash
pnpm dev        # 后端（默认 43120，改代码自动重启）
pnpm dev:web    # 前端（Vite 开发服务，/api 代理到后端）
```

- 前端由 Vite 提供开发服务并代理 `/api`；后端改代码自动重启
- 验证：浏览器打开前端地址即可对话；接口可用 `curl http://127.0.0.1:43120/api/agents`

**发布模式**

```bash
pnpm install --frozen-lockfile   # 按锁文件安装，保证可复现
pnpm build                       # 后端 → dist/server.mjs；前端 → frontend/dist
pnpm start                       # node dist/server.mjs（同时托管前端静态资源）
```

开发与发布使用同一份代码与同一份家目录，区别只在执行哪条命令。

## 默认 Agent

安装后家目录里自带一个默认 Agent（任何一份克隆都会有）：

```
~/.lifeos/agents/lifeosagent/
├─ agent.json     身份定义（id / name / description）
└─ identity.md    身份与人格
```

### 使用你自己的 Agent

当前版本还没有"在界面上创建 Agent"的功能，先手工创建：

```bash
cd ~/.lifeos/agents
cp -r lifeosagent myagent        # 复制一份作为你的 Agent
```

然后改两处：

- `myagent/agent.json`：`id`（小写字母、数字、连字符，不能与已有重复）、`name`、`description`
- `myagent/identity.md`：写你自己的身份与人格

> `id` 一旦确定就不要再改：接口路径、会话归属都按它来。

## 更新 Pi SDK

`pi/` 是指向 `github.com/later-3/pi` 的 git 子模块，跟踪其 `lifeos` 分支。

```bash
git -C pi fetch origin
git -C pi reset --hard origin/lifeos        # 取该分支最新
git add pi && git commit -m "chore: bump pi"  # 父仓库记录新的提交
npm --prefix pi ci --ignore-scripts && npm --prefix pi run build:offline
```

父仓库里记录的提交号即为构建与部署使用的事实版本。

## 常见问题

| 现象 | 处理 |
|---|---|
| `import` 报找不到 `@earendil-works/...` | 依赖未安装或 Pi SDK 未构建，重跑"安装依赖"三步 |
| 拉取或安装缓慢、失败 | 配置代理后重试（见上） |
| 开发端口被占用 | 修改后端默认端口或结束占用进程 |
| 想从零重建依赖 | 删除 `node_modules/`、`pi/node_modules/`、`pi/packages/*/dist` 后重跑安装三步 |
