// 项目目录骨架（协议 §15.3）：AGENTS.md / concept-space.md / sessions / daily / cases / todo /
// memory（agent 的项目记忆）/ tasks（任务根，任务目录按需建）。
// 每个预建子目录都带自己的 AGENTS.md，说明「这里放什么」——目录自解释。
// create-only：已存在的文件绝不覆盖（用户的记录不能被初始化逻辑冲掉）。
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const agentsMd = (name: string, path: string): string => `# 交互 harness · 项目私有层（${name}）

本目录是项目「${name}」在 Agent 侧的私有层（绑定到 \`${path}\`）。**以协议正文为准**：
\`~/.lifeos/interaction-harness/protocol.md\`。

## 这里放什么

- \`sessions/\` 会话（Pi JSONL）
- \`tasks/\` 任务根：任务目录 \`<NNNN>-<标题>/\` **按需创建**；\`task.md\` 是唯一状态源
- \`daily/<日期>.md\` 每日记录（追加，不改写历史）
- \`cases/<日期>.md\` 正例与反例（按日期分文件，编号引用）
- \`todo/\` 一句话待办（不是任务；升级为任务时移到 \`tasks/\`）
- \`memory/\` agent 的项目记忆（私有，MemOS；不进项目仓库）
- \`concept-space.md\` 本项目词索引：先建词条、再用词（协议 §4 自举）

每个子目录都有自己的 \`AGENTS.md\`，先读它再往里面写。

## 边界

- **不往项目仓库目录写我们的数据**；项目自己的规范看 \`${path}/AGENTS.md\`（存在才读）。
- 通用层（协议、飞轮、通用概念、任务类型）在 \`~/.lifeos/interaction-harness/\`。
`;

const conceptMd = (name: string): string => `# 概念空间（${name} 项目层 · 索引）

规则同通用层（协议 §3.2 / §4）：一词一义、先定义再使用、索引与正文分开。
本层只收**本项目特有**的词；通用词在 \`~/.lifeos/interaction-harness/concept-space/\`，不在此重复。

| 编号 | 词 | 一句话 | 正文 |
|---|---|---|---|
`;

const dirNotes: Record<string, string> = {
  sessions: `# sessions/

会话存储（Pi 原生 JSONL），一个会话一个文件。

- 由 Life OS / Pi 写入，**不要手改**；
- 文件里是消息与工具调用记录，不是知识库；
- 会话属于当前 Agent × 当前项目，不会自动共享给别的 Agent。`,
  tasks: `# tasks/

任务根目录。**任务目录按需创建，不预建**：

\`\`\`
tasks/<NNNN>-<标题>/task.md
\`\`\`

- 编号在项目内连续（四位）；中文标题允许；
- \`task.md\` 是唯一状态源（类型 / 类别 / 状态 / 目标 / 必需文档 / 当前指针）；
- 模板在 \`~/.lifeos/interaction-harness/task-types/<type>/\`（development 分 A/B/C，general 只写背景+步骤）；
- 已完成的任务保留，不删除（除非用户明确要求）。`,
  daily: `# daily/

每日记录，一个日期一个文件：\`<YYYY-MM-DD>.md\`。

- 当天**追加**，不改写历史；
- 记录当天做了什么、为什么、遗留什么；
- 属于当前 Agent × 当前项目，不共享给别的 Agent。`,
  cases: `# cases/

正例与反例，一个日期一个文件：\`<YYYY-MM-DD>.md\`。

- 按日期**追加**，编号连续（如 C001），不改写历史；
- 写清「场景 / 做法 / 结果 / 教训」；
- 可复用的结论进飞轮，不在这里重复长文。`,
  todo: `# todo/

一句话级待办。

- 不是任务，不进 prompt，按需读；
- 升级为任务时，用 \`lifeos_task_create\` 建到 \`tasks/<NNNN>-<标题>/\`，然后从这里删掉；
- 不写长文、不写实现细节。`,
  memory: `# memory/

agent 的项目记忆（私有，MemOS 本地存储）。

- 属于当前 Agent × 当前项目，别的 Agent 读不到；
- 由记忆工具读写（\`lifeos_memory_search/record/delete\`），**不要手改数据库文件**；
- 空目录正常：第一次写入时才创建 SQLite。`,
};

async function writeIfMissing(path: string, content: string): Promise<void> {
  await writeFile(path, content, { encoding: "utf8", mode: 0o600, flag: "wx" }).catch(() => { /* 已存在：不覆盖 */ });
}

/** 补齐一个项目目录的骨架（幂等、create-only）。 */
export async function ensureProjectSkeleton(dir: string, input: { name: string; path: string }): Promise<void> {
  for (const [sub, note] of Object.entries(dirNotes)) {
    await mkdir(join(dir, sub), { recursive: true, mode: 0o700 });
    await writeIfMissing(join(dir, sub, "AGENTS.md"), note + "\n");
  }
  await writeIfMissing(join(dir, "AGENTS.md"), agentsMd(input.name, input.path));
  await writeIfMissing(join(dir, "concept-space.md"), conceptMd(input.name));
}
