// 项目绑定目录的骨架（协议 §15.3）：每个项目目录都应有 AGENTS.md / concept-space.md /
// sessions/ · daily/ · cases/ · todo/（tasks/ 按需建，不预建）。
// create-only：已存在的文件绝不覆盖（用户的记录不能被初始化逻辑冲掉）。
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const agentsMd = (name: string, path: string): string => `# 交互 harness · 项目私有层（${name}）

本目录是项目「${name}」在 Agent 侧的私有层（绑定到 \`${path}\`）。**以协议正文为准**：
\`~/.lifeos/interaction-harness/protocol.md\`。

## 这里放什么

- \`sessions/\` 会话（Pi JSONL）
- \`daily/<日期>.md\` 每日记录（追加，不改写历史）
- \`cases/<日期>.md\` 正例与反例（按日期分文件，编号引用）
- \`todo/\` 一句话待办（不是任务；升级为任务时建 \`tasks/<NNNN>-<标题>/\`）
- \`concept-space.md\` 本项目词索引：先建词条、再用词（协议 §4 自举）
- \`memory/\` agent 的项目记忆（私有，不进项目仓库）

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

async function writeIfMissing(path: string, content: string): Promise<void> {
  await writeFile(path, content, { encoding: "utf8", mode: 0o600, flag: "wx" }).catch(() => { /* 已存在：不覆盖 */ });
}

/** 补齐一个项目绑定目录的骨架（幂等、create-only）。 */
export async function ensureProjectSkeleton(dir: string, input: { name: string; path: string }): Promise<void> {
  for (const sub of ["sessions", "daily", "cases", "todo"]) {
    await mkdir(join(dir, sub), { recursive: true, mode: 0o700 });
  }
  await writeIfMissing(join(dir, "AGENTS.md"), agentsMd(input.name, input.path));
  await writeIfMissing(join(dir, "concept-space.md"), conceptMd(input.name));
}
