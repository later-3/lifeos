# dev-port/

开发实例的端口分配与登记。**命令与步骤细节在这里，不在规范里**（规范每轮注入，细节按需读）。

## 背景与目的

条文曾经把端口写死成 `43130` / `5174`，于是所有 Agent 照抄同一个号：同一台机器上第二个实例必然撞车，`dev-supervisor` 每秒 `EADDRINUSE` 崩溃重启、日志涨到 91 万行（共享层案例 C160，2026-11-02）。

这个工具把"号从哪里来"从人的记忆变成一次**可登记、可复查**的分配。**权威是活进程探测**（真能 `listen` 才算空闲）；登记表只回答"这个号属于哪个 Task"，不占号。

## 什么时候用

- 要为某个 Task 起一套开发实例（worktree + 独立家目录 + 后端 + 前端）之前：`claim`；
- 想知道现在有哪些实例在跑、占了哪些号：`list`；
- 收工、换 worktree、或任务结束：`release`。

只改文档、只跑测试、不需要起实例时**不用它**。

## 从零起一套实例（四步，订单不能换）

```bash
# 0) 变量：本 Task 的编号与目录（下文用 $T / $W 代表）
T=0016
W="$HOME/.lifeos/agents/<agentId>/projects/<projectId>/tasks/<NNNN-标题>/evidence/worktree"

# 1) worktree 建在该 Task 的 evidence/ 下（协议 §3.7/§12）
git -C /Users/xulater/Code/lifeos worktree add "$W" -b dev/$T-<短名>

# 2) 新 worktree 里没有依赖和子模块：先补齐，否则后端起不来
#    pi/ 是固定 commit 的 submodule；node_modules 是安装产物（不在 git 里）
cd "$W"
git submodule update --init            # 拉 pi/（约 449MB，慢）
pnpm install --prefer-offline          # 装依赖（约 616MB）
#    演练/离线时可以先软链主仓的，确认能跑再补装：
#    ln -s /Users/xulater/Code/lifeos/node_modules node_modules

# 3) 装独立家目录（首次；不复制用户真实会话）
LIFEOS_HOME="$HOME/.lifeos-dev/$T" node --experimental-strip-types src/install.ts

# 4) claim 端口，按输出起两个进程
node scripts/dev-port.mjs claim --task $T --worktree "$W"
LIFEOS_HOME="$HOME/.lifeos-dev/$T" LIFEOS_SUPERVISOR_LOG="/tmp/lifeos-$T.log" \
  node scripts/dev-supervisor.mjs --port=<backend>
VITE_DEV_API=http://127.0.0.1:<backend> pnpm --dir frontend exec vite --port <web>
```

**注意**：`dev-port.mjs` 在 **worktree 里**才有（它是仓库文件）。在别的目录调用时用绝对路径，或先 `cd "$W"`。

## 用法

```bash
# 1) 分配（输出 backend / web，并写进登记表）
node scripts/dev-port.mjs claim --task 0016 --worktree "<本 Task 的 evidence/worktree 绝对路径>"

# 2) 按输出启动（示例里的号是占位，实际用 claim 给你的）
LIFEOS_HOME=~/.lifeos-dev/0016 \
LIFEOS_SUPERVISOR_LOG=/tmp/lifeos-0016.log \
node scripts/dev-supervisor.mjs --port=<backend>

VITE_DEV_API=http://127.0.0.1:<backend> pnpm --dir frontend exec vite --port <web>

# 3) 看现状 / 收工
node scripts/dev-port.mjs list [--prune]
node scripts/dev-port.mjs release --task 0016
```

## 输入输出与副作用

| 项 | 内容 |
|---|---|
| 输入 | `--task NNNN`（必填）、`--worktree <path>`（建议填，`list` 时能看到） |
| 输出 | `claim`：`{backend, web, worktree}`；`list`：Task / 后端 / 前端 / 活动 / worktree 表格 |
| 号段 | 后端 `43130–43199`、前端 `5174–5199`；保留号 `43120` / `5173` **永不分配** |
| 写 | `~/.lifeos/state/dev-ports.json`（原子写：临时文件 + rename） |
| 不写 | 不杀进程、不改代码、不碰主实例数据 |

## 规则要点（与规范一致）

- 同一 Task 重复 `claim` 会**复用**原来那组号（重启后地址不变，便于记）；
- 已被别的 Task 登记、或实际被占用的号会跳过；
- 号段耗尽时**显式报错**，不返回保留号也不越界；
- `list --prune` 清掉"已没有进程在听"的幽灵条目；`release` 只删登记，不杀进程（杀进程用 `pnpm stop --port=`）。

## 兜底：supervisor 启动自检

`dev-supervisor.mjs` 启动时会先自检，任何一条不满足就**打印原因并退出（exit 2）**，不进入重启循环：

- 端口是保留号 `43120`，或端口已被占用（会打印占用者）；
- `LIFEOS_HOME` 指向用户家目录 `~/.lifeos`；
- 在当前主 worktree 里启动；
- 日志用了共享默认路径 `/tmp/lifeos-dev-supervisor.log`。

判定逻辑在 `scripts/dev-supervisor-guard.mjs`（纯函数，有测试）。

## 实现与测试

- `scripts/dev-ports-core.mjs`：分配逻辑（纯函数 + 可注入探测）；
- `scripts/dev-port.mjs`：命令行；
- `scripts/dev-supervisor-guard.mjs`：启动自检；
- `test/dev-port.test.mjs`（10 条）、`test/dev-supervisor-guard.test.mjs`（8 条）。
