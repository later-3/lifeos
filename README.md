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
├─ .lifeos/   家目录模板（交互 harness 协议正文等；install = 整树复制到 ~/.lifeos）
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

这四条命令只在**首次安装、切换分支或依赖变化**时需要执行，日常开发无需重复。

> 网络受限时可通过代理安装：
> ```bash
> git config --global http.proxy http://127.0.0.1:<端口>
> npm config set proxy http://127.0.0.1:<端口>
> ```

### 3. 搭建家目录（骨架）

运行时数据都放在家目录。骨架的**唯一事实源是仓库根的 `.lifeos/` 模板**，安装 = 把模板整树复制过去：

```bash
pnpm home:install
```

- 家目录**不存在（或为空）** → 整树复制 + 写 `install-receipt.json`；
- 家目录**已有内容** → 只提醒并退出，**一个字节都不改**（要重装请自行确认并清理后重试）；
- 服务**启动时不执行安装**：只校验家目录存在，不存在就报错并提示先运行 `pnpm home:install`。

执行后家目录结构如下（默认 `~/.lifeos`；结构摘录自 `docs/architecture/foundation.md` §4，以 `.lifeos/` 模板为准）：

```
~/.lifeos/
├─ config/                  模型配置（下一步由你填写；含密钥，永不进 Git）
├─ interaction-harness/     交互 harness：协议正文、指引、飞轮、概念空间、任务模板
├─ agents/lifeosagent/      默认 Agent（agent.json + identity.md + projects/workspace/…，含出厂默认会话）
├─ projects/  runtime/  logs/
└─ install-receipt.json     安装收据
```

> 家目录也可以用 `LIFEOS_HOME` 指定到别处。

### 4. 配置模型

模型配置是**用户自己的配置**，放在家目录，格式与 Pi Agent 一致（上游：`https://github.com/earendil-works/pi`，说明在 `packages/coding-agent/docs/models.md`；本仓库内的同一份在 `pi/packages/coding-agent/docs/models.md`）。

```
~/.lifeos/config/models.json      provider 与模型清单（含 baseUrl 与密钥）
~/.lifeos/config/settings.json    默认 provider / 模型 / 思考级别
```

示例（默认即使用 `settings.json` 里指定的 provider 与模型）：

```json
// models.json
{
  "providers": {
    "my-provider": {
      "baseUrl": "https://<你的服务>/v1",
      "apiKey": "<你的密钥>",
      "models": [{ "id": "<模型 id>", "name": "<显示名>" }]
    }
  }
}
```

```json
// settings.json
{ "defaultProvider": "my-provider", "defaultModel": "<模型 id>", "defaultThinkingLevel": "medium" }
```

### 5. 启动

有两种模式，**做不同的事用不同的模式**：

| 模式 | 什么时候用 | 命令 |
|---|---|---|
| **开发（debug）** | 你在改代码：后端改完自动重启、前端页面热更新 | `pnpm dev:all`（一条命令同时起前后端）<br>也可以分开：`pnpm dev`（后端）+ `pnpm dev:web`（前端） |
| **使用 / 发布（release）** | 你只是想用它：构建一次，之后随时启动 | `pnpm build` → `pnpm start` |

- 开发模式：浏览器打开前端地址（Vite 默认 `http://localhost:5173`），它会把 `/api` 代理到后端
- 发布模式：浏览器打开 `http://127.0.0.1:43120`，后端同时托管前端静态文件
- `pnpm build` 只在**代码变化后**需要重跑；`pnpm start` 随时可用

> 和 C++ 项目的类比：`pnpm build` 相当于 Release 构建（产出可执行产物 `dist/server.mjs` + `frontend/dist`），`pnpm start` 相当于运行它；`pnpm dev:all` 相当于 Debug 下边改边跑、不用手动重新构建。

验证：浏览器里能连续对话；接口可用 `curl http://127.0.0.1:43120/api/agents` 检查。

#### 停止

- 在启动它的终端里按 **Ctrl+C**（开发和发布都一样）
- 或在另一个终端执行：

```bash
pnpm stop              # 结束后端（43120）与前端（5173）
pnpm stop --port=43121 # 结束自定义端口的后端
```

（用 VS Code 调试时，点调试面板的停止按钮即可。）

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
