# 实体 id 规则

> 角色：架构　类型：约定　状态：**现行**（2026-11-02 起，Task 0015 · T10）
> 实现：`src/segments.ts` `entityId(name, kind)`；测试：`test/identity-rules.test.mjs`。

## 1 一条逻辑，三种性质

每个实体都有**两个**东西：

| 字段 | 用途 | 谁看 |
|---|---|---|
| `id` | 唯一、稳定、只用于内部引用（目录名 / URL 段） | 机器；**不给人看** |
| `name` | 可读的显示名，可改 | 人 |

**id 的形态由「会不会进 URL」决定**，只有两种 `kind`：

| kind | 规则 | 用在哪 | 例子 |
|---|---|---|---|
| `url` | **小写 ASCII slug**（`^[a-z0-9][a-z0-9-]{0,63}$`）；非 ASCII 转不出 → **失败** | Agent / Project / User（`/api/agents/:id`、`/api/agents/:id/projects/:pid`、`users/:id`） | `xu-later`、`home-devices`、`lifeos` |
| `fs` | `sanitizeSegment()`：**允许中文**，去路径分隔符，空白折 `-`，最长 60 | Task 目录名等**不进 URL**的落点 | `0015-Agent-间对话工具升级-…` |

## 2 为什么是这个划分（不是偏好，是代码事实）

- Agent 与 Project 的 id 都进 URL（`src/server.ts` 的 `/api/agents/:id/...`、`.../projects/:pid/...`），
  而前端**不做 `encodeURIComponent`**（`grep` → 0 命中）→ 中文 id 进 URL 必坏；
- Task **没有 URL 端点**（只经工具），所以中文标题可以留在目录名里。
- 实测佐证：家目录里**中文 project 目录 0 个**、**中文 task 目录 39 个**——中文能用的地方，恰恰因为那类 id 不进 URL。

## 3 不再静默生成随机 id（2026-11-02 改动）

旧行为：中文名转不出 slug → `agent-3f9a` / `agent-3909`。**用户明确说过"看不懂"**，而且 id 一旦生成就稳定、改不了。

新行为：`entityId(name, "url")` 返回 `{ ok: false, reason: "needs_ascii_name" }`，调用方必须**明确报错并提示给英文/拼音名**：

- HTTP：`400 needs_ascii_name`（不是 500）；
- 工具：抛错，错误信息含"请给一个英文或拼音名字"。

**推荐的更进一步做法**（未实现，登记在 `todo`）：创建界面把 `id` 做成**可见可改字段**（预填建议）。
现有问题的根源恰恰是"id 全程自动、不可见、不可改"——让用户参与决定，id 就不再是黑盒。

## 4 项目 id 的特殊情况：路径派生

项目 id 来自目录名（`registerGlobalProject`）。当目录名是中文时：

- 不能直接用（会进 URL）→ 用 **稳定但不透明**的 `project-<sha1(path) 前 6 位>`；
- 可读性由 `project.json` 的 `name` 承担，界面显示 `name`；
- **同一路径永远同一个 id**（幂等注册是硬要求，所以不能用随机）。

## 5 显示规则（界面侧）

| 场景 | 显示 | 依据 |
|---|---|---|
| 正常 | `name` | 人只认名字 |
| 重名 / 需澄清 | `name` + 第二行 id | id 才唯一 |
| **没有 name（兜底）** | `id` + **视觉区分**：等宽字体 + `ink-500` + `title` 说明 | 让人一眼知道"这是 id 不是名字" |

具体实现：`frontend/src/App.tsx` 的 `titleOf()` / `isIdFallback()`（会话行）、`groups-panel.tsx` 的 `SessionRow`。

## 6 失效条件

- 若将来给 Task 加 URL 端点（如 `/api/.../tasks/:taskId`），Task 的 `kind` 必须从 `fs` 改成 `url`，**目录名要迁移**。
- 若引入拼音转换（第三方库或自建表），`needs_ascii_name` 的触发面会缩小，但**报错分支必须保留**（拼音也可能转不出）。
