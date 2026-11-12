// 用户界面偏好：后端持久层的契约（Task 0009 · S4）。
//
// 为什么测这个：2026-11-09 用户问「是否重启就丢了配置」。实测结论是"重启不丢、换环境才丢"，
// 于是把事实源挪到 `~/.lifeos/config/ui.json`。这份文件是**唯一**的落盘位置，
// 所以它的三条纪律必须被锁住：
//   ① 只收 theme / display（列宽、折叠、草稿这些"当前屏幕的临时状态"不许进来）；
//   ② **部分更新**：只传 display 时不许把 theme 重置掉（两个面板各管一半）；
//   ③ 坏 JSON / 不存在 / 不是对象 → 回空对象（界面用默认值），**不许抛**。
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";

import { readUiPrefs, uiPrefsPath, writeUiPrefs } from "../src/ui-prefs.ts";

let home = "";

before(async () => {
  home = await mkdtemp(join(tmpdir(), "lifeos-uiprefs-"));
});

after(async () => {
  const { rm } = await import("node:fs/promises");
  await rm(home, { recursive: true, force: true });
});

test("文件不存在 → 返回空对象（界面各自用默认值补齐）", async () => {
  assert.deepEqual(await readUiPrefs(home), {});
});

test("写入后能读回，且落盘位置是 config/ui.json", async () => {
  const saved = await writeUiPrefs({ theme: { mode: "dark", preset: "cool" }, display: { width: { mode: "limited", value: 720 } } }, home);
  assert.equal(saved.theme.mode, "dark");
  const raw = JSON.parse(await readFile(uiPrefsPath(home), "utf8"));
  assert.equal(raw.theme.mode, "dark");
  assert.equal(raw.display.width.value, 720);
  // 位置固定：一个家目录一份（不是按 agent / 按项目）
  assert.ok(uiPrefsPath(home).endsWith(join("config", "ui.json")));
});

test("部分更新：只给 badges 时，已有 theme 与 display 必须保留（第三键也要进部分更新语义）", async () => {
  await writeUiPrefs({ theme: { mode: "dark", preset: "cool" }, display: { width: { mode: "full" } } });
  const after = await writeUiPrefs({ badges: { speed: 1.5, amplitude: 0.5, strength: "vivid" } });
  assert.deepEqual(after.theme, { mode: "dark", preset: "cool" });
  assert.deepEqual(after.display, { width: { mode: "full" } });
  assert.deepEqual(after.badges, { speed: 1.5, amplitude: 0.5, strength: "vivid" });
});

test("部分更新：只给 display 时，已有 theme 必须保留", async () => {
  await writeUiPrefs({ theme: { mode: "dark" } }, home);
  const after = await writeUiPrefs({ display: { font: { scale: 1.2 } } }, home);
  assert.deepEqual(after.theme, { mode: "dark" }, "只改显示不该重置主题（两个面板各管一半）");
  assert.deepEqual(after.display, { font: { scale: 1.2 } });
});

test("只给 theme 时，已有 display 必须保留", async () => {
  await writeUiPrefs({ display: { font: { scale: 1.4 } } }, home);
  const after = await writeUiPrefs({ theme: { mode: "light" } }, home);
  assert.deepEqual(after.display, { font: { scale: 1.4 } });
});

test("坏 JSON / 不是对象 / 数组 → 一律回空对象，不抛", async () => {
  const { mkdir } = await import("node:fs/promises");
  await mkdir(join(home, "config"), { recursive: true });
  for (const bad of ["{ 这不是 json", "[]", "\"字符串\"", "null", "42"]) {
    await writeFile(uiPrefsPath(home), bad, "utf8");
    assert.deepEqual(await readUiPrefs(home), {}, `坏内容 ${bad} 应回空对象`);
  }
});

test("未知键被忽略（前端将来加字段，旧后端不该把整次保存判为无效）", async () => {
  await writeFile(uiPrefsPath(home), JSON.stringify({ theme: { mode: "dark" }, unknownKey: { a: 1 } }), "utf8");
  const read = await readUiPrefs(home);
  assert.deepEqual(Object.keys(read).sort(), ["theme"], "只保留 theme / display");
  assert.equal(read.unknownKey, undefined);
});

test("写入是原子替换（不留下 .tmp 文件）", async () => {
  await writeUiPrefs({ theme: { mode: "dark" } }, home);
  const { readdir } = await import("node:fs/promises");
  const files = await readdir(join(home, "config"));
  assert.ok(!files.some((name) => name.endsWith(".tmp")), `残留临时文件：${files.join(",")}`);
});


test("selection 键读写（Task 0018）：与 theme/display 互不覆盖", async () => {
  const saved = await writeUiPrefs({ selection: { copyOnSelect: false } }, home);
  assert.deepEqual(saved.selection, { copyOnSelect: false });
  // 部分更新：只写 selection 不动 theme（第 2 条测试写过的 theme 还在）
  const again = await writeUiPrefs({ display: { width: { mode: "limited", value: 720 } } }, home);
  assert.equal(again.selection.copyOnSelect, false);
  assert.ok(again.theme !== undefined, "selection 写入不得重置 theme");
});

test("badges 键读写（白名单回归：曾因 PUT 白名单漏项导致换设备丢失）", async () => {
  const saved = await writeUiPrefs({ badges: { speed: 1.5, strength: "vivid" } }, home);
  assert.deepEqual(saved.badges, { speed: 1.5, strength: "vivid" });
  const raw = JSON.parse(await readFile(uiPrefsPath(home), "utf8"));
  assert.equal(raw.badges.speed, 1.5);
});


test("HTTP PUT /api/ui-prefs：四个键都收（badges/selection 是 0018 补的白名单）+ 无键 400", async () => {
  const { startOn } = await import("./server-harness.mjs");
  const home2 = (await import("node:fs/promises")).mkdtemp;
  const { mkdtemp } = await import("node:fs/promises");
  const base = await mkdtemp(join(tmpdir(), "lifeos-uiprefs-http-"));
  const { server, base: url, home: httpHome } = await startOn(join(base, "home"));
  try {
    // 逐键 PUT：badges 与 selection 必须被白名单收下（此前 badges 静默丢弃）
    for (const [key, value] of [["badges", { strength: "vivid" }], ["selection", { copyOnSelect: false }]]) {
      const response = await fetch(`${url}/api/ui-prefs`, {
        method: "PUT", headers: { "content-type": "application/json" },
        body: JSON.stringify({ [key]: value }),
      });
      assert.equal(response.status, 200, key);
      const saved = (await response.json())[key];
      assert.deepEqual(saved, value, `${key} 应被 PUT 白名单收下`);
    }
    // 无可识别键 → 400 invalid_request
    const bad = await fetch(`${url}/api/ui-prefs`, {
      method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ unknown: 1 }),
    });
    assert.equal(bad.status, 400);
    assert.equal((await bad.json()).error.code, "invalid_request");
    void httpHome;
  } finally { server.close(); }
});
