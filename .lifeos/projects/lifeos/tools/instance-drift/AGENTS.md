# instance-drift/

主实例（用户正在用的那个）的**构建漂移**检查：前后端产物有没有比进程新。**命令细节在这里，不在规范里**。

## 背景与目的

`specs/development-harness/development-harness.md` §7.4 早就写着「**禁止**在主 worktree 执行 `pnpm build`」，
但这条**没有检查手段**：`dist/` 与 `frontend/dist/` 都在 `.gitignore`（`.gitignore:3`、`:5`），
`git status` 恒为空，所以 §7.4 原来那句「`git status --short` 显示 `src/` 有 `M`/`??` 即为违规」看不到一次 build。

2026-11-16 的代价：当天在主区 build 了 4 次（00:56 / 01:08 / 01:41 / 02:29），
`frontend/dist` 10:29:14 重建，主实例进程 10:01:44 启动 → 用户在浏览器里看到「Life OS 有新版本 刷新」，
并且**后端跑的是旧代码**（进程把旧的 `dist/server.mjs` 加载进内存了）。

这个工具把「有没有人在主区构建」变成一条能测的事实：**进程启动时刻 vs 产物 mtime**。

## 什么时候用

- 用户报告「有新版本」「界面变了但行为不对」「改了没生效」：先跑它，分清是前端新/后端旧还是两个都新；
- 准备在主区做任何事之前，确认当前漂移状态；
- 交付/合并前后各跑一次，作为「没在主区构建」的证据。

只读，不改任何东西，所以什么时候跑都安全。

## 用法

```bash
pnpm instance:drift                       # 默认 43120 + ~/Code/lifeos
node scripts/instance-drift.mjs --port 43120 --root /Users/<user>/Code/lifeos
```

输出四行事实（进程 pid 与启动时刻、两个产物的 mtime）+ 三行结论（判定 / 事实 / 下一步）。

## 判定表

| state | 含义 | 下一步 |
|---|---|---|
| `clean` | 进程晚于全部产物 | 无需处理 |
| `backend-stale` | `dist/server.mjs` 比进程新 | 后端跑旧代码，需要重启（用户定时间窗） |
| `frontend-ahead` | `frontend/dist` 比进程新、后端产物没新 | 浏览器拿到新前端 + 旧后端 → 老标签页弹「有新版本」 |
| `both-ahead` | 两个都比进程新 | §7.4 违规的典型形态：主区被构建过 |
| `unknown` | 端口没进程，或两个产物都读不到 | 不猜：缺什么就说缺什么 |

注意：`unknown` 不是错误（实例没在跑时正常），所以退出码恒为 0；这条检查靠人读结论，不靠退出码。

## 输入输出与副作用

| 项 | 内容 |
|---|---|
| 输入 | `--port`（默认 43120）、`--root`（默认 `~/Code/lifeos`） |
| 输出 | 事实四行 + 结论三行 |
| 写 | **无**。lsof / ps / stat 三个只读探测 |
| 不写 | 不重启、不构建、不改任何文件 |

## 实现与测试

- `scripts/instance-drift-core.mjs`：`instanceDrift()`（纯函数，五种状态）、`pidOnPort` / `processStartOf` / `collectDrift`（采集）；
- `scripts/instance-drift.mjs`：命令行；
- `test/instance-drift.test.mjs`（5 条）：五态各一条 + 两条边界（只缺一个产物）。
