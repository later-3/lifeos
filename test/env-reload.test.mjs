// Task 0017：从 shell 配置文件补 process.env（让"改好 key 不用重启"成立）。
//
// 这条能力的边界必须被测试钉死：只认字面量 export，需要 shell 求值的整行跳过，
// 已有值绝不覆盖。做错任何一条，都会变成"悄悄覆盖掉用户运行时注入的正确值"。
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseShellExports, reloadEnvFromShellConfigs } from "../src/env-reload.ts";

test("parseShellExports：字面量 export 被解析", () => {
  const parsed = parseShellExports([
    "export AMR_LINK_API_KEY=sk-abc123",
    'export WITH_DOUBLE="quoted"',
    "export WITH_SINGLE='single'",
    "  export INDENTED=v  ",
  ].join("\n"));
  assert.equal(parsed.get("AMR_LINK_API_KEY"), "sk-abc123");
  // 引号必须剥掉：实测带引号的 key 会被 Pi 当作有效凭据但发出去 401
  assert.equal(parsed.get("WITH_DOUBLE"), "quoted");
  assert.equal(parsed.get("WITH_SINGLE"), "single");
  assert.equal(parsed.get("INDENTED"), "v");
});

test("parseShellExports：需要 shell 求值的整行跳过（不猜、不执行）", () => {
  const parsed = parseShellExports([
    "export CMD=$(op read op://vault/amr)",
    "export TILDE=`cat file`",
    "export BRACED=${HOME}/x",
    "export BARE=$OTHER_VAR",
  ].join("\n"));
  assert.equal(parsed.size, 0, "四种需要求值的写法都必须跳过");
});

test("parseShellExports：注释、空赋值、非 export 行都不算", () => {
  const parsed = parseShellExports([
    "# export COMMENTED=1",
    "export EMPTY=",
    "export EMPTY2=''",
    "AMR_LINK_API_KEY=not-exported",
    "unrelated line",
    "",
  ].join("\n"));
  assert.equal(parsed.size, 0);
});

test("reloadEnvFromShellConfigs：补缺失的变量", async () => {
  const home = await mkdtemp(join(tmpdir(), "lifeos-env-"));
  try {
    await writeFile(join(home, ".zshenv"), "export AMR_LINK_API_KEY=from-zshenv\n");
    const env = {};
    const filled = await reloadEnvFromShellConfigs(env, home);
    assert.deepEqual(filled, ["AMR_LINK_API_KEY"]);
    assert.equal(env.AMR_LINK_API_KEY, "from-zshenv");
  } finally { await rm(home, { recursive: true, force: true }); }
});

test("reloadEnvFromShellConfigs：已有值绝不覆盖（进程里注入的比文件里的新）", async () => {
  const home = await mkdtemp(join(tmpdir(), "lifeos-env-"));
  try {
    await writeFile(join(home, ".zshenv"), "export AMR_LINK_API_KEY=stale-from-file\n");
    const env = { AMR_LINK_API_KEY: "fresh-from-process" };
    const filled = await reloadEnvFromShellConfigs(env, home);
    assert.deepEqual(filled, [], "不需要补任何东西");
    assert.equal(env.AMR_LINK_API_KEY, "fresh-from-process", "旧文件不能覆盖运行时值");
  } finally { await rm(home, { recursive: true, force: true }); }
});

test("reloadEnvFromShellConfigs：空值算缺失，会被文件补上", async () => {
  const home = await mkdtemp(join(tmpdir(), "lifeos-env-"));
  try {
    await writeFile(join(home, ".zshenv"), "export AMR_LINK_API_KEY=good\n");
    const env = { AMR_LINK_API_KEY: "   " };
    const filled = await reloadEnvFromShellConfigs(env, home);
    assert.deepEqual(filled, ["AMR_LINK_API_KEY"]);
    assert.equal(env.AMR_LINK_API_KEY, "good");
  } finally { await rm(home, { recursive: true, force: true }); }
});

test("reloadEnvFromShellConfigs：.zshenv 先于 .zshrc（每个 zsh 都读的那个更可信）", async () => {
  const home = await mkdtemp(join(tmpdir(), "lifeos-env-"));
  try {
    await writeFile(join(home, ".zshenv"), "export SHARED=from-zshenv\n");
    await writeFile(join(home, ".zshrc"), "export SHARED=from-zshrc\n");
    const env = {};
    await reloadEnvFromShellConfigs(env, home);
    assert.equal(env.SHARED, "from-zshenv", "先读到的赢");
  } finally { await rm(home, { recursive: true, force: true }); }
});

test("reloadEnvFromShellConfigs：文件不存在不抛（缺配置文件是正常情况）", async () => {
  const home = await mkdtemp(join(tmpdir(), "lifeos-env-empty-"));
  try {
    const env = {};
    assert.deepEqual(await reloadEnvFromShellConfigs(env, home), []);
    assert.deepEqual(env, {});
  } finally { await rm(home, { recursive: true, force: true }); }
});
