# Life OS 目录结构（v2 · 只放现在要用的）

> 原则（用户 2026-10-16 明确）：**只建"这次真的要写的东西"的目录与文件；未来演进到了再建。**
> 参考（Pi / pi-web）只用于**命名风格**，不用来新增我们还没涉及的东西。
> v1、v1.1 是凭空想出来的（`utils/`、`sessions/`、`models/`、`projects/`、`shared/` 等），已作废。

## 0 现在真实存在、且要保留的东西

| 东西 | 说明 |
|---|---|
| `docs/**` | 设计文档（唯一准绳） |
| `assets/interaction-harness/protocol.md` | **交互 harness 协议正文**（随包资产，装到家目录 `~/.lifeos/interaction-harness/protocol.md`） |
| `pi/` | Pi SDK 子模块（依赖） |
| 脚手架 | `package.json`、`tsconfig.json`、`pnpm-workspace.yaml`、`.gitignore`、`.gitmodules`、`README.md`、`AGENTS.md`、`CLAUDE.md`（README/AGENTS/CLAUDE 已于 2026-10-16 按新结构重写，原先引用的是已删的旧世界） |

**磁盘上还有但不进仓库**（务必知道，否则看目录会觉得"对不上"）：

| 磁盘项 | 是什么 |
|---|---|
| `.git/` | 版本库 |
| `.output/` | 线上旧构建产物（Nitro 产物，正在被 launchd 服务使用；切换新架构时替换） |
| `node_modules/` | 依赖安装目录 |

## 1 第一步（基础环境：前后端能跑、能编、能测）要写的代码

就这些目录和文件：

```
lifeos/
├─ src/
│  ├─ main.ts            进程入口：起 HTTP 服务
│  └─ server.ts          Hono 实例 + 路由表（本期只有 GET /api/health）
├─ frontend/
│  ├─ index.html
│  ├─ src/main.tsx       挂载 React 根
│  ├─ src/App.tsx        一个页面：请求 /api/health 并显示结果
│  ├─ package.json       前端自己的依赖（react、vite、tailwind…）
│  └─ vite.config.ts     dev 代理 /api → 后端端口
├─ test/
│  └─ health.test.mjs    后端测试：GET /api/health 返回 {ok:true,service:"lifeos"}
├─ assets/
│  └─ interaction-harness/protocol.md   交互 harness 协议正文（随包资产）
├─ docs/**               设计文档（保留）
└─ pi/                   Pi SDK 子模块（依赖）
```

命令（写在根 `package.json`）：`pnpm dev`（前后端一起起）· `pnpm build` · `pnpm start` · `pnpm test`。

## 2 明确**不建**（现在没有；等对应功能真要写时再建，建时说明用途）

`src/core/` · `src/server/`（子目录）· `src/utils/` · `src/home/` · `src/agents/` · `src/sessions/` · `src/projects/` · `src/models/` · `src/interaction-harness.ts`（写 Prompt 装配时才建）· `shared/` · `scripts/` · `deploy/` · `packages/`

## 3 命名（只写现在用得上的）

- **交互 harness 一律写全**：不单独说 harness；代码/文件用 `interaction-harness`（首字母小写），不写 `harness`。
- 交互 harness 的**注入代码**将在「Prompt 装配」那一步建：`src/interaction-harness.ts`（现在就规划名字，先不建文件）。

- 文件 kebab-case；函数/变量 camelCase；类型/组件 PascalCase。
- HTTP 路径 `/api/<资源>`；Agent 路径段用 **id**（slug，见 `foundation.md` §5.1）。
- 家目录固定名（运行时数据，不进仓库）：`config/`、`interaction-harness/`、`agents/<id>/`、`projects/<id>/`、`workspaces/`、`runtime/`、`logs/`。
