// P1 局部验证：根白名单、列目录、读文件、选择器浏览、越权拦截。
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { serve } from "@hono/node-server";
import { installHome } from "../src/home.ts";
import { createApp } from "../src/server.ts";

async function start() {
  const home = await mkdtemp(join(tmpdir(), "lifeos-fs-"));
  await installHome(process.cwd(), home);
  process.env.LIFEOS_HOME = home;
  const server = serve({ fetch: createApp().fetch, port: 0 });
  await new Promise((resolve) => server.once("listening", resolve));
  const { port } = server.address();
  return { server, base: `http://127.0.0.1:${port}`, home };
}

test("roots：默认含家目录；注册额外根并持久化；非法注册被拒", async () => {
  const { server, base, home } = await start();
  try {
    const initial = await (await fetch(`${base}/api/fs/roots`)).json();
    assert.equal(initial.roots.includes(home), true, "默认根=家目录");

    const external = await mkdtemp(join(tmpdir(), "lifeos-ext-"));
    const registered = await fetch(`${base}/api/fs/roots`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ path: external }),
    });
    assert.equal(registered.status, 201);
    assert.equal((await registered.json()).roots.includes(external), true);
    const persisted = JSON.parse(await readFile(join(home, "config", "file-roots.json"), "utf8"));
    assert.equal(persisted.roots.includes(external), true, "注册根已持久化");

    const missing = await fetch(`${base}/api/fs/roots`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ path: join(external, "nope") }),
    });
    assert.equal(missing.status, 404);
    const filePath = join(external, "a.txt");
    await writeFile(filePath, "x");
    const notDir = await fetch(`${base}/api/fs/roots`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ path: filePath }),
    });
    assert.equal(notDir.status, 400);
  } finally { server.close(); }
});

test("roots 历史：最近使用在前（家目录永远第一），重复打开只提前不重复", async () => {
  const { server, base, home } = await start();
  const { mkdtemp } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  try {
    const a = await mkdtemp(join(tmpdir(), "lifeos-root-a-"));
    const b = await mkdtemp(join(tmpdir(), "lifeos-root-b-"));
    const register = async (path) => (await (await fetch(`${base}/api/fs/roots`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ path }),
    })).json()).roots;
    await register(a);
    let roots = await register(b);
    assert.deepEqual(roots, [home, b, a], "最近打开的排在前面");
    roots = await register(a);
    assert.deepEqual(roots, [home, a, b], "再次打开 a → 提到最前（不重复）");
  } finally { server.close(); }
});

test("tree：根内列目录（目录优先字母序）；../ 越权与未注册根一律 403", async () => {
  const { server, base, home } = await start();
  try {
    const ok = await (await fetch(`${base}/api/fs/tree?path=${encodeURIComponent(home)}`)).json();
    assert.ok(ok.entries.some((e) => e.name === "interaction-harness" && e.isDir));
    assert.ok(ok.entries.some((e) => e.name === "install-receipt.json" && !e.isDir));
    const dirs = ok.entries.filter((e) => e.isDir).map((e) => e.name);
    assert.deepEqual(dirs, [...dirs].sort((a, b) => a.localeCompare(b)), "目录优先且字母序");

    const escape = await fetch(`${base}/api/fs/tree?path=${encodeURIComponent(join(home, "..", "etc"))}`);
    assert.equal(escape.status, 403);
    assert.equal((await escape.json()).error.code, "path_not_allowed");

    const stranger = await mkdtemp(join(tmpdir(), "lifeos-stranger-"));
    const unregistered = await fetch(`${base}/api/fs/tree?path=${encodeURIComponent(stranger)}`);
    assert.equal(unregistered.status, 403, "未注册根不可读");

    const asFile = await fetch(`${base}/api/fs/tree?path=${encodeURIComponent(join(home, "install-receipt.json"))}`);
    assert.equal(asFile.status, 400);
  } finally { server.close(); }
});

test("content：文本读取；二进制识别；超 2MB 截断", async () => {
  const { server, base, home } = await start();
  try {
    const text = await (await fetch(`${base}/api/fs/content?path=${encodeURIComponent(join(home, "interaction-harness", "protocol.md"))}`)).json();
    assert.ok(text.content.includes("交互 harness"));
    assert.equal(text.truncated, false);
    assert.equal(text.isBinary, false);

    const binPath = join(home, "blob.bin");
    await writeFile(binPath, Buffer.from([0x50, 0x4b, 0x00, 0x01, 0x02]));
    const binary = await (await fetch(`${base}/api/fs/content?path=${encodeURIComponent(binPath)}`)).json();
    assert.equal(binary.isBinary, true);
    assert.equal(binary.content, "");

    const bigPath = join(home, "big.txt");
    await writeFile(bigPath, "a".repeat(2 * 1024 * 1024 + 1024));
    const big = await (await fetch(`${base}/api/fs/content?path=${encodeURIComponent(bigPath)}`)).json();
    assert.equal(big.truncated, true);
    assert.ok(big.content.length <= 2 * 1024 * 1024);
  } finally { server.close(); }
});

test("browse：选择器通道——任意路径只列子目录（含未注册），但不读文件", async () => {
  const { server, base } = await start();
  try {
    const stranger = await mkdtemp(join(tmpdir(), "lifeos-pick-"));
    await mkdir(join(stranger, "sub-one"));
    await mkdir(join(stranger, "sub-two"));
    await writeFile(join(stranger, "file.txt"), "x");

    const picked = await (await fetch(`${base}/api/fs/browse?path=${encodeURIComponent(stranger)}`)).json();
    assert.deepEqual(picked.dirs, ["sub-one", "sub-two"], "只列目录、不含文件、字母序");
    assert.equal(picked.parent, dirname(stranger));

    const root = await (await fetch(`${base}/api/fs/browse?path=/`)).json();
    assert.equal(root.parent, null, "根目录无上级");

    const missing = await fetch(`${base}/api/fs/browse?path=${encodeURIComponent(join(stranger, "nope"))}`);
    assert.equal(missing.status, 404);
    const asFile = await fetch(`${base}/api/fs/browse?path=${encodeURIComponent(join(stranger, "file.txt"))}`);
    assert.equal(asFile.status, 400);
  } finally { server.close(); }
});
