# worktree-identity/

Task 工作区的提交身份体检与补齐（协议 §3.7「提交与署名」）。**命令与步骤细节在这里，不在规范里**（规范每轮注入，细节按需读）。

## 背景与目的

「谁写的这段代码」曾经只靠 Agent 记不记得在 `git commit` 前传 `-c user.name=<自己>`。2026-11-16 实测：

```
git log main --pretty=format:'%an' | sort | uniq -c | sort -rn
    314 later-3                 # 用户的全局身份 ← 绝大多数
     33 frontend-developer     # Agent 自己传了 -c
     31 coder                  # 同上
```

带 Agent 名的提交日期区间正好是 **2026-11-03 ～ 2026-11-10**；改用 Task 工作区（11-12 起）之后一条都没有了。
所以用户看到界面上一个提示条、问「这是谁做的」时，答案只能靠还留着的分支名反查。

2026-11-16 起，**新建**工作区时身份由建工作区的动作自动写入（`src/task-worktree.ts` 调
`src/worktree-identity.ts`），不再依赖 Agent 的记忆。**存量**工作区没有身份，用这个工具体检与补齐。

## 什么时候用

- 接管一个有工作区的旧 Task、准备在里面提交之前：跑 `pnpm worktree:identity`；
- 用户问「这工作区里的提交会不会记错人」：同上，把输出念给它听；
- 确认有缺口、决定补齐：`pnpm worktree:identity:fix`；
- 门禁（人工）：交付前 `pnpm worktree:identity --check`，有缺口退出码为 1。

只改文档、不提交时不用它。

## 用法

```bash
pnpm worktree:identity          # 只报告（默认）
pnpm worktree:identity --check  # 同上，有缺口 → 退出码 1
pnpm worktree:identity:fix      # 补齐缺身份的工作区
```

输出每行一个工作区，四态：

| 标记 | 状态 | 含义 |
|---|---|---|
| `✓` | ok | 提交作者就是这个 Agent |
| `·` | missing | 工作区没设身份 → 提交会落成用户的全局身份 |
| `!` | wrong | 设了但不是这个 Agent（串了） |
| `!` | no-extension | 仓没开 `extensions.worktreeConfig`，工作区无法单独设置身份 |

## 输入输出与副作用

| 项 | 内容 |
|---|---|
| 输入 | 无参数；扫 `~/.lifeos/agents/*/projects/*/tasks/*/{home,repo}` 的 `.lifeos-worktree.json`（结构即事实） |
| 输出 | 每个工作区一行 + 汇总（共 N 个 / 正确 N / 需处理 N） |
| 写（仅 `--fix`） | 每个工作区自己的 `config.worktree`（`git config --worktree user.name/user.email`）+ 仓公共配置一行 `extensions.worktreeConfig=true` |
| 不写 | **不改历史提交**（协议 §11）、不碰主区的 `user.*`、不碰 `~/.lifeos` 的文档 |

## 规则要点

- 身份格式是契约：`user.name = <agentId>`、`user.email = <agentId>@lifeos.local`（本地部分就是 agent id，机器可解析）；
- 身份写在**工作区独占**的 `config.worktree` 里，所以主区（用户自己）的提交身份不受影响；
- 仓公共配置只加 `extensions.worktreeConfig=true` 一行；这是 per-worktree 配置生效的前提，不设它则 `--worktree` 报错；
- 补齐是幂等的，重复跑不会写坏；
- 家目录仓 `~/.lifeos` 早已有该扩展；项目仓（如 `/Users/xulater/Code/lifeos`）由第一次建工作区时自动打开。

## 实现与测试

- `src/worktree-identity.ts`：`identityOf` / `judgeIdentity`（纯函数）/ `applyWorktreeIdentity` / `readWorktreeIdentity`；
- `scripts/worktree-identity.mjs`：命令行（扫描 + 三态输出 + `--fix`）；
- `test/worktree-identity.test.mjs`（6 条）：工作区提交作者 = agentId、主区仍是全局身份、两个 Agent 不串、`judgeIdentity` 四态穷举、幂等、失败要说清怎么做。
- 活性验证（2026-11-16 做过）：把建工作区的身份写入去掉，T1/T3 立刻变红 → 断言不是假绿。
