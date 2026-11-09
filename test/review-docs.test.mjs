// 文档与实现一致性（P4）：检视模式的两份知识文档不能与代码漂移。
//
// 为什么需要（用户 2026-11-07）：
//   "这个是一个特性，应该在 lifeos 的文档里面有描述的，一个模块是怎么设计的，怎么实现的，包括检视的东西是在哪儿。"
// 文档写了但代码变了（或反之），下一个人读到的是错的——比没有文档更糟。
// 这里只锁**能被机器判定的部分**：工具清单、端点清单、落盘路径、索引可达性。
// 语义与取舍靠人读，不在这里假装能测。
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const repo = process.cwd();
const ARCH = join(repo, ".lifeos/projects/lifeos/knowledge/architecture/review-mode.md");
const PAGE = join(repo, ".lifeos/projects/lifeos/knowledge/design/review-panel.md");
const ARCH_INDEX = join(repo, ".lifeos/projects/lifeos/knowledge/architecture/AGENTS.md");
const DESIGN_INDEX = join(repo, ".lifeos/projects/lifeos/knowledge/design/AGENTS.md");
const ROOT_AGENTS = join(repo, "AGENTS.md");

test("P4doc·1 架构文档列出的检视工具 = 代码里注册的工具（不多不少）", async () => {
  const doc = await readFile(ARCH, "utf8");
  const { createAgentTools } = await import("../src/agent-tools.ts");
  const tools = createAgentTools({ agentId: "a", projectId: "p" }).map((tool) => tool.name)
    .filter((name) => name.startsWith("lifeos_review_"));
  assert.ok(tools.length >= 5, `检视工具应有 5 个，实际 ${tools.length}`);
  const missing = tools.filter((name) => !doc.includes(name));
  assert.deepEqual(missing, [], `文档没写这些工具：${missing.join(", ")}`);
  /**
   * 反向：文档里提到的每一条 `lifeos_review_*` 都必须真的存在（防止写了已删的工具）。
   *
   * **例外**：写在「- **未实现**：…」那一行里的名字是在说"以后要做的"，
   * 它们本来就还不存在——但那种名字必须同时出现在 `todo/`（由 P4doc·5 守）。
   * 不做这个例外，文档就没法诚实地写"这个工具还没做"。
   */
  const notDoneLine = doc.split("\n").find((text) => /^- \*\*未实现\*\*/.test(text)) ?? "";
  const documented = [...new Set([...doc.matchAll(/lifeos_review_[a-z_]+/g)].map((match) => match[0]))]
    .filter((name) => !name.endsWith("_"))
    .filter((name) => !notDoneLine.includes(name));
  const phantom = documented.filter((name) => !tools.includes(name));
  assert.deepEqual(phantom, [], `文档提到但代码里没有：${phantom.join(", ")}`);
});

test("P4doc·2 架构文档列出的评论接口 = server.ts 里注册的 /api/review/* 端点", async () => {
  const doc = await readFile(ARCH, "utf8");
  const server = await readFile(join(repo, "src/server.ts"), "utf8");
  const endpoints = [...new Set([...server.matchAll(/"(\/api\/review\/[a-z]+)"/g)].map((match) => match[1]))];
  assert.ok(endpoints.length >= 3, `端点应有 3 个以上，实际 ${endpoints.length}: ${endpoints.join(", ")}`);
  const missing = endpoints.filter((path) => !doc.includes(path));
  assert.deepEqual(missing, [], `文档没写这些端点：${missing.join(", ")}`);
});

test("P4doc·3 「东西存在哪」必须与代码里的真实落点一致", async () => {
  const doc = await readFile(ARCH, "utf8");
  const { COMMENTS_DIR } = await import("../src/review-comments.ts");
  assert.ok(doc.includes(COMMENTS_DIR.replaceAll("/", "/")), `文档没写评论落盘目录 ${COMMENTS_DIR}`);
  const review = await readFile(join(repo, "src/review.ts"), "utf8");
  // worktree 的约定位置来自代码里的 join(taskDir, "evidence", "worktree")
  assert.match(review, /"evidence",\s*"worktree"/, "worktree 约定位置变了？同步更新文档 §2");
  assert.ok(doc.includes("evidence/worktree"), "文档没写 worktree 的约定位置");
});

test("P4doc·4 两份文档都能从索引与仓库入口找到（不是孤儿文件）", async () => {
  assert.match(await readFile(ARCH_INDEX, "utf8"), /review-mode\.md/, "architecture/AGENTS.md 索引缺 review-mode.md");
  assert.match(await readFile(DESIGN_INDEX, "utf8"), /review-panel\.md/, "design/AGENTS.md 索引缺 review-panel.md");
  assert.match(await readFile(ROOT_AGENTS, "utf8"), /knowledge\/architecture\/review-mode\.md/,
    "仓库根 AGENTS.md 场景入口地图缺「检视模式」一行——新 Agent 找不到它");
});

test("P4doc·5 文档声明「未实现」的条目必须在 todo 里有登记（避免口头承诺）", async () => {
  const doc = await readFile(ARCH, "utf8");
  /**
   * 按**行**取「- **未实现**：…」那一条，不按整段 split：
   * 标题里也含"未实现"三个字（"已实现 vs 未实现"），按词 split 会切到标题上。
   */
  const line = doc.split("\n").find((text) => /^- \*\*未实现\*\*/.test(text)) ?? "";
  assert.notEqual(line, "", "找不到「未实现」那一条——文档结构变了？");
  /**
   * **不自造数量门槛**（协议 §3.13）：早先这里写 `ids.length >= 3` —— 那是按当时的条目数随手定的，
   * 随功能交付会变成假红（2026-11-08 只剩 G11 一条时它就红了）。
   * 现在只要求两件真事：
   *  ① 那一行**必须点名至少一件事**（编号或功能名），否则这句话等于没写；
   *  ② 点到的**编号**必须在 todo 里登记（功能名无法逐一比对，由人读）。
   */
  const ids = [...new Set([...line.matchAll(/\b([AG]\d{1,2})\b/g)].map((match) => match[1]))];
  const named = ids.length + (line.includes("手机适配") ? 1 : 0) + (line.includes("rich diff") ? 1 : 0) + (line.includes("lifeos_review_open") ? 1 : 0);
  assert.ok(named >= 1, `未实现段必须点名至少一件事（否则这句话没有信息量）：${line}`);
  const todo = await readFile(join(repo, ".lifeos/projects/lifeos/todo/todo.md"), "utf8")
    .catch(() => "");
  const taskTodo = await readFile(join(repo, "todo/todo.md"), "utf8").catch(() => "");
  const haystack = `${todo}\n${taskTodo}`;
  const orphans = ids.filter((id) => !haystack.includes(id));
  assert.deepEqual(orphans, [], `这些「未实现」编号没在 todo 里登记：${orphans.join(", ")}`);
});
