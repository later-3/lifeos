# Life OS

life os 是一套 agent 与用户之间长期协作的系统，主要包含两个模块：
1、交互 harness 协议
2、agent 工具，基于交互 harness 协议，提供 agent 与用户之间的协作功能。

## 项目结构

```
lifeos/
├─ src/        后端（Node + TypeScript）：HTTP 接口、Agent 会话、Prompt 装配
├─ frontend/   前端（Vite + React）：浏览器界面，纯静态产物
├─ pi/         Pi SDK 源码（git 子模块，直接用它，不另外装 npm 包）
├─ assets/     随包资产（交互 harness 协议正文等）
├─ docs/       设计文档
└─ test/       后端测试
```

- 代码只读仓库；**数据只写家目录 `/Users/xulater/.lifeos`**
- 前后端分离：后端提供 HTTP + 事件流，前端是纯静态页面
- 详细设计见 `docs/architecture/`（结构：`directory-structure.md`；底座：`foundation.md`）

## 一、安装依赖（第一次 / 换电脑 / 依赖变了，才需要）

背景：JS 项目的依赖写在 `package.json` 里，由"包管理器"（我们用 `npm` 和 `pnpm`）下载到 `node_modules/`。
我们这里有两块要分别装：`pi/`（Pi SDK 源码）和项目本身。

**所有命令都在项目根目录执行：**

```bash
cd ~/Code/lifeos

# 1) 装 Pi SDK 自己的依赖（读 pi/package.json，装到 pi/node_modules，不是全局安装）
npm --prefix pi ci --ignore-scripts

# 2) 构建 Pi SDK（读 pi/package.json 的 build:offline 脚本，产出 pi/packages/*/dist）
npm --prefix pi run build:offline

# 3) 装本项目的依赖（读根 package.json 与 pnpm-workspace.yaml 里的 frontend）
pnpm install
```

**怎么确认装好了：**

```bash
ls pi/packages/coding-agent/dist      # 应看到 index.js 等文件
ls -l node_modules/@earendil-works    # 三个包应是指向 pi/packages/... 的符号链接
```

- 需要的 Node 版本：>=22.19.0
- 这三条**只在第一次或依赖/Pi 变化时**跑，不是每次改代码都跑
- 网络慢或失败就先开代理：
  ```bash
  git config --global http.proxy http://127.0.0.1:7897
  npm config set proxy http://127.0.0.1:7897
  ```

## 二、编译 & 运行

### 开发（debug）

```bash
pnpm dev
```
- 后端跑在 **43120**（改后端代码自动重启）
- 前端跑在 Vite 的端口（改页面即时刷新）
- 验证：浏览器打开前端地址；或 `curl http://127.0.0.1:43120/api/health`

> 现状：`pnpm dev` 要等 Hello World 落地（`src/main.ts`、`src/server.ts`、`frontend/` 有真实代码）后才有效果；现在这些文件还是占位。

### 发布（release）

```bash
pnpm build     # 后端 → dist/server.mjs；前端 → frontend/dist
pnpm start     # node dist/server.mjs（同时托管前端静态文件）
```
- 发布安装依赖时用：`pnpm install --frozen-lockfile`
- **debug 与 release 的区别只是"跑哪条命令"**，不用环境变量切换；两边数据都在 `~/.lifeos`

## 三、更新 Pi SDK（子模块）

`pi/` 是 git 子模块，指向 `github.com/later-3/pi` 的 **`lifeos`** 分支（等于上游 `earendil-works/pi` 的最新 `main`）。

```bash
cd pi
git fetch origin && git reset --hard origin/lifeos    # 取最新
cd ..
git add pi && git commit -m "更新 pi 到 <sha>"         # 这一步才算把版本钉住
npm --prefix pi ci --ignore-scripts && npm --prefix pi run build:offline   # 重新构建
```

## 四、常见问题

| 现象 | 处理 |
|---|---|
| `import` 报找不到 `@earendil-works/...` | 第一节三条命令没跑完，或 Pi 未构建 |
| 拉取/安装慢或失败 | 先开代理（第一节最后那两条命令），再重试 |
| 端口占用 | 开发默认 43120；线上旧架构用 43110 |
| 想清掉重来 | 删 `node_modules/`、`pi/node_modules/`、`pi/packages/*/dist`，再重跑第一节 |
