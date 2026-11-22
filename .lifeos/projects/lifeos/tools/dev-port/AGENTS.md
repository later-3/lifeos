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
#    登记键 = <agent>/<project>/<NNNN>（协议 §3.7：Task ID 只在 Agent×Project 内唯一，
#    两个 Agent 的同号 Task 必须是两组不同的端口）。最省事的说法是只给 worktree：
node scripts/dev-port.mjs claim --worktree "$W"
LIFEOS_HOME="$HOME/.lifeos-dev/$T" LIFEOS_SUPERVISOR_LOG="/tmp/lifeos-$T.log" \
  node scripts/dev-supervisor.mjs --port=<backend>
VITE_DEV_API=http://127.0.0.1:<backend> pnpm --dir frontend exec vite --port <web>
```

> **不用设 `LIFEOS_API`**：supervisor 自 2026-11-13 起（Task 0010 · C216）默认检查
> `--port` 指向的自己那个后端（drain/运行数不再打向 43120 用户实例）。
> 只有当后端不在 `127.0.0.1:<--port>` 时才需要 `LIFEOS_API` 显式指定。

**注意**：`dev-port.mjs` 在 **worktree 里**才有（它是仓库文件）。在别的目录调用时用绝对路径，或先 `cd "$W"`。

## 用法

```bash
# 1) 分配（输出 key / backend / web，并写进登记表）。三种说法等价，选一种：
node scripts/dev-port.mjs claim --worktree "<Task 工作区绝对路径>"          # 自动反推归属（推荐）
node scripts/dev-port.mjs claim --agent coder --project lifeos --task 0032
node scripts/dev-port.mjs claim --key coder/lifeos/0032

# 2) 按输出启动（示例里的号是占位，实际用 claim 给你的）
LIFEOS_HOME=~/.lifeos-dev/0032 \
LIFEOS_SUPERVISOR_LOG=/tmp/lifeos-0032.log \
node scripts/dev-supervisor.mjs --port=<backend>

VITE_DEV_API=http://127.0.0.1:<backend> pnpm --dir frontend exec vite --port <web>

# 3) 看现状 / 收工
node scripts/dev-port.mjs list [--prune]
node scripts/dev-port.mjs release --key coder/lifeos/0032
node scripts/dev-port.mjs release --task 0032      # 登记表里唯一匹配时才释放；多条匹配会报错列候选
```

**只给 `--task` 会被拒绝**（分配时）：Task ID 只在 Agent × Project 内唯一，两个 Agent 的 `0003` 是两件事。
要释放时只给 `--task` 可以，但要求登记表里恰好一条匹配 —— 两个同号 Task 同时存在时报错并列出候选，不替你挑。

## 输入输出与副作用

| 项 | 内容 |
|---|---|
| 输入 | `claim`：`--worktree <path>` 或 `--agent`+`--project`+`--task`，或 `--key <agent>/<project>/<NNNN>`（三者选一，缺项报错不猜） |
| 登记键 | `<agent>/<project>/<NNNN>`（与协议 §3.7 的分支名同构）；存量裸编号键在读取时按 `worktree` 反推迁移，推不出的丢弃 |
| 输出 | `claim`：`{key, agentId, projectId, taskId, backend, web, worktree}`；`list`：Task / Agent / 项目 / 后端 / 前端 / 活动 / worktree 表格 |
| 号段 | 后端 `43130–43199`、前端 `5174–5199`；保留号 `43120` / `5173` **永不分配** |
| 写 | `~/.lifeos/state/dev-ports.json`（原子写：临时文件 + rename；`schemaVersion: 2`） |
| 不写 | 不杀进程、不改代码、不碰主实例数据 |

## 规则要点（与规范一致）

- 同一 Task 重复 `claim` 会**复用**原来那组号（重启后地址不变，便于记）；
- 已被别的 Task 登记、或实际被占用的号会跳过；
- 号段耗尽时**显式报错**，不返回保留号也不越界；
- `list --prune` 清掉"已没有进程在听"的幽灵条目；`release` 只删登记，不杀进程（杀进程用 `pnpm stop --port=`）。

## 常见失败：`pi` submodule 拉不下来（新 worktree 起不来）

**症状**：新 worktree 里 `src/agent-host.ts` 报
`Cannot find module '@earendil-works/pi-coding-agent'`，或后端启动即崩。

**为什么**：`git worktree add` **只检出主仓的树，不初始化 submodule**。新 worktree 的 `pi/` 是一个空目录，
而 `src/**` 里所有 `@earendil-works/pi-*` 都指向 `pi/packages/*/dist/index.js`。实测（2026-11-16，Task 0017）：

```
git worktree add /tmp/test HEAD
ls /tmp/test/pi            →  空目录
git submodule status       →  -90d863f7… pi        ← 前面的 `-` = 未初始化
```

缺的不止源码，一共三样（都是 pi 的 `.gitignore` 内产物，不在任何 commit 里）：

| 缺什么 | 大小 | 为什么不在 |
|---|---|---|
| `pi/` 源码（submodule 内容） | 449 M | submodule 是独立仓，worktree 不拉 |
| `pi/node_modules` | 352 M | `pi/.gitignore:1` |
| `pi/packages/*/dist` | 26 M | `pi/.gitignore:8`（构建产物） |

**正常解法**：`git submodule update --init`（约 449 M，慢）。

**拉不下来时**（代理/网络中断，实测报 `fatal: early EOF` / `fetch-pack: invalid index-pack output`）：
**复用主区已有的对象库**，几秒完成，且 commit 与主区完全一致：

```bash
W="<本 Task 的 worktree>"
REF=/Users/xulater/Code/lifeos          # 主区
cd "$W"
# 1) 只复制对象索引，不复制 blob（248M 对象库 → 几十 KB）
git clone --shared "$REF/.git/modules/pi" pi
git -C pi checkout "$(git -C "$REF/pi" rev-parse HEAD)"    # 与主区同一 commit
# 2) 依赖与构建产物软链到主区（都是 gitignore 内产物，不是源码）
ln -sfn "$REF/pi/node_modules" pi/node_modules
for p in ai agent coding-agent tui chord telemetry codemode mcp durable env; do
  [ -d "$REF/pi/packages/$p/dist" ] && ln -sfn "$REF/pi/packages/$p/dist" "pi/packages/$p/dist"
  [ -d "$REF/pi/packages/$p/node_modules" ] && ln -sfn "$REF/pi/packages/$p/node_modules" "pi/packages/$p/node_modules"
done
# 3) 主仓依赖照装（这一步正常走 pnpm install）
pnpm install --prefer-offline
```

**注意**：`--shared` 创建的 pi 是**独立克隆**（`.git` 指向主区对象库），所以 `pi` 在 worktree 里是
未跟踪目录。合并前确认 **没有把 `pi/` 加进索引**（`git status` 里它应该是 `?? pi/` 之外的正常状态；
如果误 `git add` 了，`git reset HEAD pi` 并删掉 `pi/.git`）。Task 0017 实测踩过一次
（`git add -A` 把 pi 加进了暂存区）。

**别做**：`git checkout -- pi`、`rm -rf pi` 之后再 `git submodule update`（可能又撞网络）。
主区的 `pi/` 是**用户的资产**，不是你的工作区（`development-harness.md` §7.1b 的命令白名单）。

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
