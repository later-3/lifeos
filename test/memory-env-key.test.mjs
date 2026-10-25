// models.json 的 apiKey 支持 ${ENV} 引用（Task 0002：models.json 入库、真实 key 只在环境变量）。
// 覆盖：$VAR / ${VAR} 展开、明文透传、缺 env 响亮失败、!command 显式拒绝、memoryRuntimeConfig 集成。
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const { expandEnvValue, memoryRuntimeConfig } = await import("../src/memory/config.ts");

test("展开 ${VAR} 与 $VAR；明文 key 原样返回", () => {
  process.env.MEM_TEST_KEY = "sk-real-value";
  try {
    assert.equal(expandEnvValue("${MEM_TEST_KEY}", "t"), "sk-real-value");
    assert.equal(expandEnvValue("$MEM_TEST_KEY", "t"), "sk-real-value");
    assert.equal(expandEnvValue("prefix-${MEM_TEST_KEY}-suffix", "t"), "prefix-sk-real-value-suffix");
    assert.equal(expandEnvValue("sk-plain-literal-123", "t"), "sk-plain-literal-123");
    assert.equal(expandEnvValue("a$$b", "t"), "a$b");
  } finally {
    delete process.env.MEM_TEST_KEY;
  }
});

test("引用未设置的环境变量 → 显式报错，带变量名", () => {
  assert.throws(() => expandEnvValue("${MEM_MISSING_VAR}", "t"), /MEM_MISSING_VAR/);
  assert.throws(() => expandEnvValue("$MEM_MISSING_VAR", "t"), /MEM_MISSING_VAR/);
});

test("!command 形式 → 显式拒绝（不把字面量发给上游）", () => {
  assert.throws(() => expandEnvValue("!cat /tmp/key", "t"), /!command/);
});

test("memoryRuntimeConfig：LIFEOS_HOME fixture 的 ${ENV} key 被展开", async () => {
  const base = await mkdtemp(join(tmpdir(), "lifeos-mem-env-"));
  const home = join(base, "home");
  await mkdir(join(home, "config"), { recursive: true });
  await writeFile(
    join(home, "config", "models.json"),
    JSON.stringify({
      providers: {
        fixture: {
          baseUrl: "http://127.0.0.1:1/v1",
          apiKey: "${MEM_FIXTURE_KEY}",
          models: [{ id: "fixture-model" }],
        },
      },
    }),
    "utf8",
  );
  const savedHome = process.env.LIFEOS_HOME;
  process.env.LIFEOS_HOME = home;
  process.env.MEM_FIXTURE_KEY = "sk-fixture-real";
  try {
    const config = await memoryRuntimeConfig();
    assert.equal(config.apiKey, "sk-fixture-real");
    assert.equal(config.apiKeyEnvName, "LIFEOS_MEMORY_API_KEY");
    // config.yaml 里仍然只有占位符，不含真实 key
    assert.match(config.yaml, /apiKey: "\$\{LIFEOS_MEMORY_API_KEY\}"/);
    assert.ok(!config.yaml.includes("sk-fixture-real"));
  } finally {
    delete process.env.MEM_FIXTURE_KEY;
    if (savedHome === undefined) delete process.env.LIFEOS_HOME;
    else process.env.LIFEOS_HOME = savedHome;
  }
});

test("memoryRuntimeConfig：缺 env 时响亮失败（带变量名）", async () => {
  const base = await mkdtemp(join(tmpdir(), "lifeos-mem-env-miss-"));
  const home = join(base, "home");
  await mkdir(join(home, "config"), { recursive: true });
  await writeFile(
    join(home, "config", "models.json"),
    JSON.stringify({
      providers: {
        fixture: {
          baseUrl: "http://127.0.0.1:1/v1",
          apiKey: "${MEM_NO_SUCH_KEY}",
          models: [{ id: "fixture-model" }],
        },
      },
    }),
    "utf8",
  );
  const savedHome = process.env.LIFEOS_HOME;
  process.env.LIFEOS_HOME = home;
  try {
    await assert.rejects(memoryRuntimeConfig(), /MEM_NO_SUCH_KEY/);
  } finally {
    if (savedHome === undefined) delete process.env.LIFEOS_HOME;
    else process.env.LIFEOS_HOME = savedHome;
  }
});
