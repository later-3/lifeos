// T58：运行数据目录也要有说明文件（协议 §5.2）——home:check 不得放过 logs/、state/ 缺说明的情况。
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installHome } from "../src/home.ts";
import { checkHome } from "../src/home-check.ts";

test("T58 logs/ 与 state/ 存在但缺 AGENTS.md → 报错；补上后通过", async () => {
  const home = await mkdtemp(join(tmpdir(), "lifeos-runtime-notes-"));
  await installHome(process.cwd(), home);
  await mkdir(join(home, "logs"), { recursive: true });
  await mkdir(join(home, "state"), { recursive: true });
  const before = await checkHome(home);
  assert.ok(before.errors.some((e) => e.includes("logs/AGENTS.md") || e.includes("logs/")), "缺 logs 说明必须报错: " + before.errors.join(" | "));
  assert.ok(before.errors.some((e) => e.includes("state/")), "缺 state 说明必须报错");
  await writeFile(join(home, "logs", "AGENTS.md"), "# logs\n\n- 背景：运行日志。\n");
  await writeFile(join(home, "state", "AGENTS.md"), "# state\n\n- 背景：运行状态。\n");
  const after = await checkHome(home);
  assert.equal(after.errors.filter((e) => /logs|state/.test(e)).length, 0);
});
