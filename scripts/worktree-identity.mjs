#!/usr/bin/env node
// worktree:identity：Task 工作区的提交身份体检与补齐（协议 §3.7「提交与署名」）。
//
//   node scripts/worktree-identity.mjs            # 只报告（默认）
//   node scripts/worktree-identity.mjs --check    # 同上，但有缺口时退出码 1（给门禁用）
//   node scripts/worktree-identity.mjs --fix      # 补齐缺身份的工作区
//   node scripts/worktree-identity.mjs --match coder/lifeos/0020 [--fix]
//     ↑ 只看/只补匹配的工作区（`<agent>/<project>/<NNNN>` 的子串）。
//     为什么需要：一次给 15 个工作区写配置会碰到别人正在用的 Task；只想给自己那个补时用它。
//
// 为什么需要它：身份是 2026-11-16 之后新建工作区时自动写的（`src/task-worktree.ts`），
// 之前建的存量工作区没有身份 → 那里提交的作者会落成用户的全局身份。存量不重写历史（协议 §11），
// 但**能补的是配置**：补上之后新的提交就带名字了。
//
// 只读 `~/.lifeos/agents/*/projects/*/tasks/*/{home,repo}` 与它们的 `.lifeos-worktree.json`；
// `--fix` 只写每个工作区自己的 `config.worktree`（`git config --worktree`），不碰主区。
import { readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { applyWorktreeIdentity, judgeIdentity, readWorktreeIdentity } from "../src/worktree-identity.ts";

const argv = process.argv.slice(2);
const fix = argv.includes("--fix");
const check = argv.includes("--check");
const matchIndex = argv.indexOf("--match");
const match = matchIndex === -1 ? undefined : argv[matchIndex + 1];

const home = join(homedir(), ".lifeos");

/** 扫出所有带 `.lifeos-worktree.json` 的工作区（结构即事实：标记文件在就说明这是工作区）。 */
async function worktreesOf() {
  const found = [];
  const agents = await readdir(join(home, "agents"), { withFileTypes: true }).catch(() => []);
  for (const agent of agents) {
    if (!agent.isDirectory()) continue;
    const projects = await readdir(join(home, "agents", agent.name, "projects"), { withFileTypes: true }).catch(() => []);
    for (const project of projects) {
      if (!project.isDirectory()) continue;
      const tasks = await readdir(join(home, "agents", agent.name, "projects", project.name, "tasks"), { withFileTypes: true }).catch(() => []);
      for (const task of tasks) {
        if (!task.isDirectory()) continue;
        for (const kind of ["home", "repo"]) {
          const path = join(home, "agents", agent.name, "projects", project.name, "tasks", task.name, kind);
          const marker = await readFile(join(path, ".lifeos-worktree.json"), "utf8").catch(() => undefined);
          if (marker === undefined) continue;
          let parsed;
          try { parsed = JSON.parse(marker); } catch { continue; }
          if (typeof parsed?.agentId !== "string") continue;
          found.push({ path, agentId: parsed.agentId, kind, task: `${agent.name}/${project.name}/${parsed.taskId ?? "?"}` });
        }
      }
    }
  }
  return found;
}

const worktrees = (await worktreesOf()).filter((worktree) => match === undefined || worktree.task.includes(match));
if (worktrees.length === 0) {
  console.log(match === undefined
    ? `没有找到任何 Task 工作区（${join(home, "agents", "*", "projects", "*", "tasks", "*")}）。`
    : `没有匹配 ${match} 的工作区（用 --match 时的口径是 <agent>/<project>/<NNNN> 的子串）。`);
  process.exit(0);
}

const rows = [];
for (const worktree of worktrees) {
  const before = await readWorktreeIdentity(worktree.path);
  let judgement = judgeIdentity({ agentId: worktree.agentId, extension: before.extension, ...pick(before) });
  let fixed = false;
  if (fix && judgement.state !== "ok") {
    const applied = await applyWorktreeIdentity({ worktree: worktree.path, agentId: worktree.agentId });
    if (applied.ok) {
      const after = await readWorktreeIdentity(worktree.path);
      judgement = judgeIdentity({ agentId: worktree.agentId, extension: after.extension, ...pick(after) });
      fixed = judgement.state === "ok";
    } else {
      judgement = { state: "wrong", detail: applied.reason };
    }
  }
  rows.push({ ...worktree, judgement, fixed });
}

function pick(read) {
  return {
    ...(read.worktreeName === undefined ? {} : { worktreeName: read.worktreeName }),
    ...(read.worktreeEmail === undefined ? {} : { worktreeEmail: read.worktreeEmail }),
  };
}

const order = { "no-extension": 0, missing: 1, wrong: 2, ok: 3 };
rows.sort((a, b) => order[a.judgement.state] - order[b.judgement.state] || a.task.localeCompare(b.task));

const icon = { ok: "✓", missing: "·", wrong: "!", "no-extension": "!" };
for (const row of rows) {
  const tail = row.fixed ? " → 已补齐" : "";
  console.log(`${icon[row.judgement.state]} ${row.task} ${row.kind.padEnd(4)} ${row.path}`);
  console.log(`    ${row.judgement.detail}${tail}`);
}

const bad = rows.filter((row) => row.judgement.state !== "ok");
console.log("");
console.log(`共 ${rows.length} 个工作区：身份正确 ${rows.length - bad.length}，需处理 ${bad.length}${fix ? `（本次补齐 ${rows.filter((row) => row.fixed).length}）` : ""}。`);
if (bad.length > 0 && !fix) {
  console.log("补齐：node scripts/worktree-identity.mjs --fix（只写工作区自己的 config.worktree，不改历史提交、不碰主区）");
}
// 退出码只给门禁用：`--check` 有缺口就红（人手动跑不带 --check 时看输出即可）。
if (check && bad.length > 0) process.exit(1);
