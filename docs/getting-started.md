# Getting started · 详细安装与排障

> 角色：文档　类型：上手说明　状态：现行（2026-11-16）
>
> README 只留「前置要求 + 命令」；这里放完整细节：代理、家目录校验、两种运行模式、更新 Pi SDK、常见问题。
> 两份 README（[English](../README.md) / [简体中文](../README.zh-CN.md)）都指向本文。

## 1 环境要求

| 要求 | 说明 |
|---|---|
| Node.js | `>= 22.19.0`（`node --version`）。低于此版本会因为 `--experimental-strip-types` 相关能力缺失而启动失败 |
| pnpm | `npm install -g pnpm`，或 `corepack enable pnpm` |
| 模型服务 | 任意 OpenAI 兼容的 base URL 与密钥（见第 5 节） |

## 2 获取代码

```bash
git clone --recurse-submodules <仓库地址>
cd lifeos
```

`pi/` 是 git 子模块，后端直接以源码方式使用它。克隆时忘了带 `--recurse-submodules`：

```bash
git submodule update --init
```

## 3 安装依赖

分两部分：`pi/`（Pi SDK 源码）和项目本身。

```bash
# ① Pi SDK 自己的依赖（读 pi/package.json，装到 pi/node_modules）
npm --prefix pi ci --ignore-scripts

# ② 首次需要联网准备模型数据（Pi 的构建会校验它）
npm --prefix pi run hydrate:model-data

# ③ 构建 Pi SDK（产出 pi/packages/*/dist，后端 import 的就是它）
npm --prefix pi run build:offline

# ④ 本项目依赖（根 package.json 与 frontend/）
pnpm install
```

这四条只在**首次安装、切换分支或依赖变化**时执行，日常开发无需重复。

### 网络受限时

```bash
git config --global http.proxy http://127.0.0.1:<端口>
npm config set proxy http://127.0.0.1:<端口>
```

## 4 家目录（骨架）

运行时数据都放在家目录。骨架的**唯一事实源是仓库根的 `.lifeos/` 模板**，安装 = 把模板整树复制过去：

```bash
pnpm home:install
```

- 家目录**不存在（或为空）** → 整树复制 + 写 `install-receipt.json`；
- 家目录**已有内容** → 只提醒并退出，**一个字节都不改**（要重装请自行确认并清理后重试）；
- 服务**启动时不执行安装**：只校验家目录存在，不存在就报错并提示先运行 `pnpm home:install`。

```
~/.lifeos/
├─ config/                     模型配置（含密钥，永不进 Git）
├─ interaction-harness/        协议目录：协议正文、说明、协议默认的任务类型模板
├─ projects/
│  ├─ workspace/               共享 workspace（所有 Agent）
│  └─ lifeos/                  LifeOS 项目共享层（设计、规范、知识、待办）
├─ agents/lifeosagent/         默认 Agent：配置、身份、工具、记忆
└─ install-receipt.json        安装收据
```

> 家目录位置可用 `LIFEOS_HOME` 指到别处。

结构校验（只读，不改任何文件）：`pnpm home:check`。

## 5 模型配置

两个文件都在 `~/.lifeos/config/`，格式与 Pi Agent 一致
（上游：<https://github.com/earendil-works/pi>，说明见 `packages/coding-agent/docs/models.md`；仓库内同一份在 `pi/packages/coding-agent/docs/models.md`）。

```jsonc
// models.json
{
  "providers": {
    "my-provider": {
      "baseUrl": "https://<你的服务>/v1",
      "apiKey": "${MY_PROVIDER_KEY}",          // 也支持环境变量引用：${VAR}
      "models": [{ "id": "<模型 id>", "name": "<显示名>" }]
    }
  }
}
```

```jsonc
// settings.json
{ "defaultProvider": "my-provider", "defaultModel": "<模型 id>", "defaultThinkingLevel": "medium" }
```

| 环境变量 | 作用 |
|---|---|
| `LIFEOS_HOME` | 家目录位置，默认 `~/.lifeos` |
| `LIFEOS_API` | 开发 supervisor 检查的后端地址，默认 `http://127.0.0.1:43120` |

## 6 运行

| 模式 | 什么时候用 | 命令 |
|---|---|---|
| **开发** | 改代码：后端改动自动重启（会先等在跑的回合结束）、前端热更新 | `pnpm dev:all`；也可分开 `pnpm dev` + `pnpm dev:web` |
| **使用 / 发布** | 只是想用它：构建一次，之后随时启动 | `pnpm build` → `pnpm start` |

- 开发模式：浏览器打开 Vite 地址（默认 `http://localhost:5173`），它把 `/api` 代理到后端；
- 发布模式：浏览器打开 `http://127.0.0.1:43120`，后端同时托管前端静态文件；
- `pnpm build` 只在**代码变化后**需要重跑。

验证：浏览器里能连续对话；接口用 `curl http://127.0.0.1:43120/api/agents` 检查。

> 和 C++ 项目的类比：`pnpm build` 相当于 Release 构建（产出 `dist/server.mjs` + `frontend/dist`），
> `pnpm start` 相当于运行它；`pnpm dev:all` 相当于 Debug 下边改边跑。

### 停止

- 在启动它的终端按 **Ctrl+C**；
- 或 `pnpm stop`（结束后端 43120 与开发前端 5173）、`pnpm stop --port=43121`（自定义端口）。

## 7 更新 Pi SDK

`pi/` 是 git 子模块，跟踪上游分支。

```bash
git -C pi fetch origin
git -C pi reset --hard origin/<分支>
git add pi && git commit -m "chore: bump pi"    # 父仓库记录新的提交
npm --prefix pi ci --ignore-scripts && npm --prefix pi run build:offline
```

父仓库里记录的提交号即为构建与部署使用的事实版本。

## 8 常见问题

| 现象 | 处理 |
|---|---|
| `import` 报找不到 `@earendil-works/...` | 依赖未安装或 Pi SDK 未构建，重跑第 3 节三步 |
| 拉取或安装缓慢、失败 | 配置代理后重试（第 3 节末） |
| 开发端口被占用 | 改后端默认端口，或结束占用进程（`pnpm stop`） |
| 启动报「家目录不存在」 | 先跑 `pnpm home:install` |
| 想从零重建依赖 | 删 `node_modules/`、`pi/node_modules/`、`pi/packages/*/dist` 后重跑第 3 节 |
| 界面一直是旧版本 | 前端产物与进程错版：重新 `pnpm build` 后重启；长开标签页需要刷新 |
