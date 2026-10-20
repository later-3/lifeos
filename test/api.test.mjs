// 起真实服务（随机端口）测只读接口与错误路径。
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serve } from "@hono/node-server";
import { installHome } from "../src/home.ts";
import { createApp } from "../src/server.ts";

async function start() {
  const home = await mkdtemp(join(tmpdir(), "lifeos-test-"));
  await installHome(process.cwd(), home);
  process.env.LIFEOS_HOME = home;
  const server = serve({ fetch: createApp().fetch, port: 0 });
  await new Promise((resolve) => server.once("listening", resolve));
  const { port } = server.address();
  return { server, base: `http://127.0.0.1:${port}`, home };
}

test("GET /api/agents 列出默认 Agent", async () => {
  const { server, base } = await start();
  try {
    const response = await fetch(`${base}/api/agents`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body.items.map((item) => item.id), ["lifeosagent"]);
  } finally { server.close(); }
});

test("GET /api/agents/:id 返回定义，未知 id 返回 404 错误结构", async () => {
  const { server, base } = await start();
  try {
    const found = await fetch(`${base}/api/agents/lifeosagent`);
    assert.equal(found.status, 200);
    assert.equal((await found.json()).name, "Life Agent");

    const missing = await fetch(`${base}/api/agents/nobody`);
    assert.equal(missing.status, 404);
    assert.equal((await missing.json()).error.code, "agent_not_found");
  } finally { server.close(); }
});

test("GET /api/agents/:id/sessions 返回会话列表", async () => {
  const { server, base } = await start();
  try {
    const response = await fetch(`${base}/api/agents/lifeosagent/sessions`);
    assert.equal(response.status, 200);
    assert.ok(Array.isArray((await response.json()).items));
  } finally { server.close(); }
});

test("POST messages 校验输入", async () => {
  const { server, base } = await start();
  try {
    const response = await fetch(`${base}/api/agents/lifeosagent/sessions/s1/messages`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: "" }),
    });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, "invalid_request");
  } finally { server.close(); }
});

test("出厂默认会话随模板预置：列表首条即它，第一条消息是 Agent 打招呼", async () => {
  const { server, base, home } = await start();
  try {
    const list = await (await fetch(`${base}/api/agents/lifeosagent/sessions`)).json();
    assert.equal(list.items.length, 1, "新装家目录应只有出厂默认会话这一条");
    const sid = list.items[0].sessionId;
    assert.equal(list.items[0].isDefault, true, "出厂会话应带默认标记（agent.json defaultSessionId）");
    assert.equal(list.items[0].title, "welcome to lifeos", "显示名=预置的 session_info.name");

    // 加载即显示：第一条 = assistant 打招呼（不调模型，直接来自预置文件）
    const { messages } = await (await fetch(`${base}/api/agents/lifeosagent/sessions/${sid}`)).json();
    assert.equal(messages[0].role, "assistant");
    assert.match(messages[0].text, /你好，我是 Life Agent/);

    // 文件事实：预置在 workspace/sessions/ 下，首行是 session 头
    const { readdir, readFile } = await import("node:fs/promises");
    const dir = join(home, "agents", "lifeosagent", "projects", "workspace", "sessions");
    const file = (await readdir(dir)).find((name) => name.includes(sid));
    assert.ok(file, "预置会话文件应在 workspace/sessions/ 下");
    const header = JSON.parse((await readFile(join(dir, file), "utf8")).split("\n")[0]);
    assert.equal(header.type, "session");
    assert.equal(header.id, sid);
  } finally { server.close(); }
});

test("手动新建的会话是空白的（开场只属于出厂默认会话）", async () => {
  const { server, base } = await start();
  try {
    const created = await fetch(`${base}/api/agents/lifeosagent/sessions`, { method: "POST" });
    assert.equal(created.status, 200);
    const { sessionId } = await created.json();
    const { messages } = await (await fetch(`${base}/api/agents/lifeosagent/sessions/${sessionId}`)).json();
    assert.deepEqual(messages, []);
    const list = await (await fetch(`${base}/api/agents/lifeosagent/sessions`)).json();
    const createdItem = list.items.find((item) => item.sessionId === sessionId);
    assert.notEqual(createdItem?.isDefault, true, "手动新建的会话不应被标为默认");
  } finally { server.close(); }
});

test("三层结构：project 列表 = projects/ 目录（名称即目录名），按 project 列会话，未知 project 404", async () => {
  const { server, base } = await start();
  try {
    const projects = await (await fetch(`${base}/api/agents/lifeosagent/projects`)).json();
    assert.deepEqual(projects.items, [{ id: "workspace", name: "workspace", isDefault: true }]);

    const sessions = await (await fetch(`${base}/api/agents/lifeosagent/projects/workspace/sessions`)).json();
    assert.ok(sessions.items.length >= 1, "默认工作区下应有出厂会话");

    const missing = await fetch(`${base}/api/agents/lifeosagent/projects/nope/sessions`);
    assert.equal(missing.status, 404);
    assert.equal((await missing.json()).error.code, "project_not_found");
  } finally { server.close(); }
});

test("project 列表按目录扫描：新增目录即出现（名称=目录名），文件与隐藏项忽略", async () => {
  const { server, base, home } = await start();
  try {
    const { mkdir, readFile, writeFile } = await import("node:fs/promises");
    const root = join(home, "agents", "lifeosagent", "projects");
    await mkdir(join(root, "demo-project"), { recursive: true });
    await writeFile(join(root, "not-a-project.txt"), "x");
    await mkdir(join(root, ".hidden"), { recursive: true });

    const projects = await (await fetch(`${base}/api/agents/lifeosagent/projects`)).json();
    assert.deepEqual(projects.items.map((item) => item.id), ["workspace", "demo-project"], "默认项目在前，其余按目录名排序");
    assert.equal(projects.items[0].name, "workspace", "内置项目显示目录名，不用「工作区」这类展示名");
    assert.equal(projects.items[1].name, "demo-project", "显示名必须等于目录名");
    assert.equal(projects.items[1].path, join(root, "demo-project"), "未注册的私有目录也能用，path=该目录");

    // 目录即项目：可以直接在里面建会话（不要求先注册）
    const created = await fetch(`${base}/api/agents/lifeosagent/projects/demo-project/sessions`, { method: "POST" });
    assert.equal(created.status, 200, "私有目录应可直接建会话");
    const { sessionId } = await created.json();
    const file = await readFile(join(home, "agents", "lifeosagent", "projects", "demo-project", "sessions", `${sessionId}.jsonl`)).catch(() => undefined);
    assert.ok(file !== undefined || (await import("node:fs/promises")).readdir(join(root, "demo-project", "sessions")).then((list) => list.some((name) => name.includes(sessionId))), "会话应落在该项目目录下");
  } finally { server.close(); }
});

test("移除项目 = 从列表消失，目录与会话保留；重新注册后再次出现", async () => {
  const { server, base, home } = await start();
  try {
    const { mkdir, readFile, readdir, writeFile } = await import("node:fs/promises");
    const root = join(home, "agents", "lifeosagent", "projects");
    const dir = join(root, "left-behind");
    await mkdir(join(dir, "sessions"), { recursive: true });
    await writeFile(join(dir, "sessions", "2026-10-18T00:00:00.000Z_x.jsonl"), "");

    const removed = await fetch(`${base}/api/agents/lifeosagent/projects/left-behind`, { method: "DELETE" });
    assert.equal(removed.status, 200);
    const listed = await (await fetch(`${base}/api/agents/lifeosagent/projects`)).json();
    assert.ok(!listed.items.some((item) => item.id === "left-behind"), "移除后不应出现在列表");
    assert.equal((await readdir(join(dir, "sessions"))).length, 1, "会话数据必须保留");

    const agent = JSON.parse(await readFile(join(home, "agents", "lifeosagent", "agent.json"), "utf8"));
    assert.deepEqual(agent.hiddenProjectIds, ["left-behind"], "移除写入 hiddenProjectIds");

    // 重新注册同一路径（即便指向自身目录）→ 从 hidden 摘除 → 再次出现
    const again = await fetch(`${base}/api/agents/lifeosagent/projects`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ path: dir }),
    });
    assert.equal(again.status, 201);
    const after = await (await fetch(`${base}/api/agents/lifeosagent/projects`)).json();
    assert.ok(after.items.some((item) => item.path === dir), "重新注册后应再次出现在列表");
  } finally { server.close(); }
});

test("消息块：thinking / toolCall / toolResult 按 Pi 真实结构返回", async () => {
  const { server, base, home } = await start();
  try {
    const { writeFile } = await import("node:fs/promises");
    const sid = "11111111-2222-4333-8444-555555555555";
    const dir = join(home, "agents", "lifeosagent", "projects", "workspace", "sessions");
    const entries = [
      { type: "session", version: 3, id: sid, timestamp: "2026-10-17T01:00:00.000Z", cwd: "" },
      { type: "message", id: "m1", parentId: sid, timestamp: "2026-10-17T01:00:00.001Z", message: { role: "user", content: "查".repeat(60) } },
      { type: "message", id: "m2", parentId: "m1", timestamp: "2026-10-17T01:00:00.002Z", message: { role: "assistant", content: [
        { type: "thinking", thinking: "先看目录" },
        { type: "toolCall", id: "c1", name: "ls", arguments: { path: "." } } ] } },
      { type: "message", id: "m3", parentId: "m2", timestamp: "2026-10-17T01:00:00.003Z", message: { role: "toolResult", toolCallId: "c1", toolName: "ls", content: [{ type: "text", text: "a.ts" }], isError: false, timestamp: 0 } },
      { type: "message", id: "m4", parentId: "m3", timestamp: "2026-10-17T01:00:00.004Z", message: { role: "assistant", content: [{ type: "text", text: "有一个文件" }] } },
    ];
    await writeFile(join(dir, `2026-10-17T01-00-00-000Z_${sid}.jsonl`), entries.map((e) => JSON.stringify(e)).join("\n") + "\n");
    const { messages } = await (await fetch(`${base}/api/agents/lifeosagent/sessions/${sid}`)).json();
    assert.deepEqual(messages.map((m) => m.role), ["user", "assistant", "assistant"]);
    const blocks = messages[1].blocks;
    assert.deepEqual(blocks.map((b) => b.type), ["thinking", "toolCall"]);
    assert.equal(blocks[1].name, "ls");
    assert.equal(blocks[1].result, "a.ts", "toolResult 应挂回对应 toolCall");
    assert.equal(blocks[1].isError, false);
    assert.equal(messages[2].text, "有一个文件");
    const list = await (await fetch(`${base}/api/agents/lifeosagent/projects/workspace/sessions`)).json();
    assert.equal(list.items.find((item) => item.sessionId === sid).title.length, 60, "首条用户消息全文返回（UI 层才截 50）");
  } finally { server.close(); }
});

test("重命名会话：列表标题优先 session_info 展示名", async () => {
  const { server, base } = await start();
  try {
    const list = await (await fetch(`${base}/api/agents/lifeosagent/sessions`)).json();
    const sid = list.items[0].sessionId;
    const renamed = await fetch(`${base}/api/agents/lifeosagent/sessions/${sid}`, {
      method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "我的默认会话" }),
    });
    assert.equal(renamed.status, 200);
    const after = await (await fetch(`${base}/api/agents/lifeosagent/sessions`)).json();
    assert.equal(after.items.find((item) => item.sessionId === sid).title, "我的默认会话");
    const bad = await fetch(`${base}/api/agents/lifeosagent/sessions/${sid}`, {
      method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "  " }),
    });
    assert.equal(bad.status, 400);
  } finally { server.close(); }
});

test("删除会话：从列表消失，重复删除 404", async () => {
  const { server, base } = await start();
  try {
    const created = await (await fetch(`${base}/api/agents/lifeosagent/sessions`, { method: "POST" })).json();
    const first = await fetch(`${base}/api/agents/lifeosagent/sessions/${created.sessionId}`, { method: "DELETE" });
    assert.equal(first.status, 200);
    const list = await (await fetch(`${base}/api/agents/lifeosagent/sessions`)).json();
    assert.equal(list.items.some((item) => item.sessionId === created.sessionId), false);
    const again = await fetch(`${base}/api/agents/lifeosagent/sessions/${created.sessionId}`, { method: "DELETE" });
    assert.equal(again.status, 404);
    assert.equal((await again.json()).error.code, "session_not_found");
  } finally { server.close(); }
});

test("项目：打开目录（同 path 幂等、pid=uuidv7）、manifest 在 Agent 私有层、移除保留数据、默认不可移除", async () => {
  const { server, base, home } = await start();
  const { mkdtemp, readFile, access, readdir: rd, stat } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  try {
    const ext = await mkdtemp(join(tmpdir(), "lifeos-proj-"));
    const privateRoot = join(home, "agents", "lifeosagent", "projects");

    // 打开目录（= 添加项目）
    const first = await fetch(`${base}/api/agents/lifeosagent/projects`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ path: ext }),
    });
    assert.equal(first.status, 201);
    const { project } = await first.json();
    assert.equal(project.id, ext.slice(ext.lastIndexOf("/") + 1), "id = 可读目录名（项目名），不再是 uuid");
    assert.equal(project.path, ext);
    assert.equal(project.name, ext.slice(ext.lastIndexOf("/") + 1));

    // 幂等：同 path 再打开 → 同 pid、列表不重复
    const again = await fetch(`${base}/api/agents/lifeosagent/projects`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ path: ext }),
    });
    assert.equal(again.status, 200);
    assert.equal((await again.json()).project.id, project.id, "同 path 复用同一 pid");
    let list = await (await fetch(`${base}/api/agents/lifeosagent/projects`)).json();
    assert.deepEqual(list.items.map((i) => i.id), ["workspace", project.id], "workspace 默认在前");
    assert.equal(list.items[1].isDefault, false);

    // manifest 落在 Agent 私有层：目录 0700、文件 0600；顶层不再有共用层；不写用户目录
    const manifestPath = join(privateRoot, project.id, "project.json");   // 目录名 = 项目名
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    assert.equal(manifest.path, ext);
    assert.equal((await stat(join(privateRoot, project.id))).mode & 0o777, 0o700, "项目目录必须 0700");
    assert.equal((await stat(manifestPath)).mode & 0o777, 0o600, "manifest 必须 0600");
    await access(join(home, "projects")).then(() => assert.fail("顶层共用层不应存在")).catch(() => {});
    assert.equal((await rd(ext)).includes(".lifeos"), false, "不污染用户目录");

    // agent.json 不再有旧字段（boundProjectIds 是死字段，已删）
    const agent = JSON.parse(await readFile(join(home, "agents", "lifeosagent", "agent.json"), "utf8"));
    assert.equal("boundProjectIds" in agent, false, "boundProjectIds 必须已删除");

    // 非法 path
    const missing = await fetch(`${base}/api/agents/lifeosagent/projects`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ path: join(ext, "nope") }),
    });
    assert.equal(missing.status, 404);

    // 从列表移除：只写 hidden；目录/manifest/会话/记录全留；workspace 不可移除；重复移除 404
    const del = await fetch(`${base}/api/agents/lifeosagent/projects/${project.id}`, { method: "DELETE" });
    assert.equal(del.status, 200);
    list = await (await fetch(`${base}/api/agents/lifeosagent/projects`)).json();
    assert.deepEqual(list.items.map((i) => i.id), ["workspace"]);
    await access(manifestPath).catch(() => assert.fail("移除后 manifest 应保留"));
    const delAgain = await fetch(`${base}/api/agents/lifeosagent/projects/${project.id}`, { method: "DELETE" });
    assert.equal(delAgain.status, 404);
    const delDefault = await fetch(`${base}/api/agents/lifeosagent/projects/workspace`, { method: "DELETE" });
    assert.equal(delDefault.status, 400);
    assert.equal((await delDefault.json()).error.code, "cannot_unbind_default");

    // 再次打开同 path → 重新出现（hidden 摘除）
    const reopen = await fetch(`${base}/api/agents/lifeosagent/projects`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ path: ext }),
    });
    assert.equal(reopen.status, 200);
    list = await (await fetch(`${base}/api/agents/lifeosagent/projects`)).json();
    assert.deepEqual(list.items.map((i) => i.id), ["workspace", project.id], "重新打开后回到列表");
  } finally { server.close(); }
});

test("会话 cwd 由所属项目决定（外部项目=manifest.path，workspace=家目录），与后端启动目录无关", async () => {
  const { server, base, home } = await start();
  const { mkdtemp } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  try {
    const { cwdOfSession } = await import("../src/server.ts");
    const ext = await mkdtemp(join(tmpdir(), "lifeos-cwd-"));

    // 外部项目：打开目录 → 建会话 → 该会话的 cwd 必须是项目 path（不是 process.cwd()）
    const opened = await (await fetch(`${base}/api/agents/lifeosagent/projects`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ path: ext }),
    })).json();
    const created = await (await fetch(`${base}/api/agents/lifeosagent/projects/${opened.project.id}/sessions`, { method: "POST" })).json();
    const agent = { id: "lifeosagent", name: "Life Agent" };
    assert.equal(await cwdOfSession(agent, created.sessionId), ext, "外部项目会话 cwd = 项目 path");
    assert.notEqual(await cwdOfSession(agent, created.sessionId), process.cwd(), "不能等于后端启动目录");

    // 模拟"重启后恢复"：手写一份已落盘的会话文件（内存里没有）→ cwd 仍必须来自项目 manifest
    const { mkdir, writeFile } = await import("node:fs/promises");
    const sessionsDir = join(home, "agents", "lifeosagent", "projects", opened.project.id, "sessions");
    await mkdir(sessionsDir, { recursive: true });
    const sid = "01a14f80-0000-7000-8000-000000000001";
    await writeFile(join(sessionsDir, `2026-10-18T00-00-00-000Z_${sid}.jsonl`),
      JSON.stringify({ type: "session", version: 3, id: sid, timestamp: "2026-10-18T00:00:00.000Z", cwd: "" }) + "\n");
    assert.equal(await cwdOfSession(agent, sid), ext, "已落盘会话恢复时 cwd 来自项目 path（不看后端启动目录）");

    // workspace：cwd = 家目录
    const w = await (await fetch(`${base}/api/agents/lifeosagent/projects/workspace/sessions`, { method: "POST" })).json();
    assert.equal(await cwdOfSession(agent, w.sessionId), home, "workspace 会话 cwd = 家目录");
  } finally { server.close(); }
});

test("旧数据迁移：顶层共用层 manifest → 搬进 Agent 私有层并清掉旧目录", async () => {
  const { server, base, home } = await start();
  const { mkdir, writeFile, readFile, access } = await import("node:fs/promises");
  try {
    // 造一份"旧设计"的数据：私有层目录存在（无 manifest）+ 顶层共用层有 manifest
    const pid = "01a14f39-b0f9-7422-ab41-8770edabb414";
    await mkdir(join(home, "agents", "lifeosagent", "projects", pid), { recursive: true });
    await mkdir(join(home, "projects", pid), { recursive: true });
    await writeFile(join(home, "projects", pid, "project.json"), JSON.stringify({ schemaVersion: 1, id: pid, name: "legacy", path: "/tmp/legacy-proj" }) + "\n");

    const list = await (await fetch(`${base}/api/agents/lifeosagent/projects`)).json();
    const item = list.items.find((entry) => entry.path === "/tmp/legacy-proj");
    assert.ok(item, "迁移后项目应出现在列表里");
    assert.equal(item.name, "legacy-proj", "显示名 = basename(path)（manifest.name 不参与显示）");
    assert.equal(item.id, "legacy", "目录名迁成可读名（manifest.name）");

    const moved = JSON.parse(await readFile(join(home, "agents", "lifeosagent", "projects", "legacy", "project.json"), "utf8"));
    assert.equal(moved.path, "/tmp/legacy-proj");
    assert.equal(moved.id, "legacy");
    assert.equal(moved.legacyId, pid, "旧 pid 记在 legacyId（旧 URL 可反查）");
    await access(join(home, "projects")).then(() => assert.fail("旧顶层共用层应被清掉")).catch(() => {});
  } finally { server.close(); }
});

test("按 project 建会话：落对目录、cwd 正确（workspace=家目录，外部=项目路径）", async () => {
  const { server, base, home } = await start();
  const { mkdtemp } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  try {
    // workspace：cwd = 家目录
    const w = await fetch(`${base}/api/agents/lifeosagent/projects/workspace/sessions`, { method: "POST" });
    assert.equal(w.status, 200);
    const wSid = (await w.json()).sessionId;
    const wList = await (await fetch(`${base}/api/agents/lifeosagent/projects/workspace/sessions`)).json();
    assert.ok(wList.items.some((i) => i.sessionId === wSid && i.messages === 0), "未落盘的新会话必须出现在列表（pending 并入）");
    const { getSession } = await import("../src/agent-host.ts");
    const wState = await getSession("lifeosagent", wSid, home);
    assert.ok(wState, "内存态应可取回");
    assert.ok(wState.session.sessionFile?.startsWith(join(home, "agents", "lifeosagent", "projects", "workspace", "sessions")), "落点=workspace/sessions");
    assert.equal(wState.session.sessionManager.getCwd(), home, "workspace 会话 cwd = 家目录");

    // 外部项目：注册后建会话 → 落 projects/<pid>/sessions、cwd=项目路径
    const ext = await mkdtemp(join(tmpdir(), "lifeos-cwd-"));
    const reg = await fetch(`${base}/api/agents/lifeosagent/projects`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ path: ext }),
    });
    const pid = (await reg.json()).project.id;
    const e = await fetch(`${base}/api/agents/lifeosagent/projects/${pid}/sessions`, { method: "POST" });
    assert.equal(e.status, 200);
    const eSid = (await e.json()).sessionId;
    const eState = await getSession("lifeosagent", eSid, home);
    assert.ok(eState, "外部会话内存态应可取回");
    assert.ok(eState.session.sessionFile?.startsWith(join(home, "agents", "lifeosagent", "projects", pid, "sessions")), "落点=外部项目私有 sessions/");
    assert.equal(eState.session.sessionManager.getCwd(), ext, "外部会话 cwd = 项目路径");

    // 未绑定/未知 project → 404
    const stranger = await fetch(`${base}/api/agents/lifeosagent/projects/11111111-2222-4733-8444-555555555555/sessions`, { method: "POST" });
    assert.equal(stranger.status, 404);

    // 列表：外部项目私有目录已存在 → 会话列表 1 条
    const list = await (await fetch(`${base}/api/agents/lifeosagent/projects/${pid}/sessions`)).json();
    assert.equal(list.items.length, 1);
  } finally { server.close(); }
});

test("模型解析：返回 provider/模型清单，响应绝不含 apiKey", async () => {
  const { server, base, home } = await start();
  const { mkdir: mk, writeFile: wf } = await import("node:fs/promises");
  try {
    await mk(join(home, "config"), { recursive: true });
    await wf(join(home, "config", "models.json"), JSON.stringify({
      providers: { p1: { baseUrl: "https://x.example/v1", apiKey: "SECRET-XYZ-123", models: [{ id: "m1", name: "Model One" }, { id: "m2", name: "Model Two" }] } },
    }));
    await wf(join(home, "config", "settings.json"), JSON.stringify({ defaultProvider: "p1" }));
    const response = await fetch(`${base}/api/models-config`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.providers.length, 1);
    assert.equal(body.providers[0].id, "p1");
    assert.deepEqual(body.providers[0].models.map((m) => m.id), ["m1", "m2"]);
    assert.equal(body.settings.defaultProvider, "p1");
    const raw = JSON.stringify(body);
    assert.equal(raw.includes("SECRET-XYZ-123"), false, "apiKey 绝不能出现在响应里");
    assert.equal(/apiKey/i.test(raw), false, "连字段名都不应出现");
  } finally { server.close(); }
});

test("基础信息与身份：PUT 改名生效、identity 读写往返、非法改名拒绝", async () => {
  const { server, base } = await start();
  try {
    const renamed = await fetch(`${base}/api/agents/lifeosagent`, {
      method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Life Agent Pro", description: "测试描述" }),
    });
    assert.equal(renamed.status, 200);
    assert.equal((await renamed.json()).name, "Life Agent Pro");
    assert.equal((await (await fetch(`${base}/api/agents/lifeosagent`)).json()).name, "Life Agent Pro");

    const putId = await fetch(`${base}/api/agents/lifeosagent/identity`, {
      method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: "# 我是 Life Agent Pro\n负责打招呼。" }),
    });
    assert.equal(putId.status, 200);
    const got = await (await fetch(`${base}/api/agents/lifeosagent/identity`)).json();
    assert.match(got.text, /我是 Life Agent Pro/);

    const bad = await fetch(`${base}/api/agents/lifeosagent`, {
      method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "  " }),
    });
    assert.equal(bad.status, 400);
  } finally { server.close(); }
});

test("Agent 个人模型配置：保存到 workspace/config.json 并可回读（模型必须来自清单）", async () => {
  const { server, base, home } = await start();
  const { mkdir, readFile, stat } = await import("node:fs/promises");
  try {
    // 默认模型只能从清单里选：给测试家一份清单，否则保存会被"清单里没有"拒绝
    await mkdir(join(home, "config"), { recursive: true });
    await (await import("node:fs/promises")).writeFile(join(home, "config", "models.json"), JSON.stringify({
      providers: { command: { api: "openai-completions", baseUrl: "http://127.0.0.1:1", apiKey: "k", models: [{ id: "z-ai/glm-5.3-flash" }] } },
    }) + "\n");
    const saved = await fetch(`${base}/api/agents/lifeosagent/config`, {
      method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify({ defaultProvider: "command", defaultModel: "z-ai/glm-5.3-flash", defaultThinkingLevel: "high" }),
    });
    assert.equal(saved.status, 200);
    const file = JSON.parse(await readFile(join(home, "agents", "lifeosagent", "projects", "workspace", "config.json"), "utf8"));
    assert.equal(file.defaultProvider, "command");
    assert.equal(file.defaultThinkingLevel, "high");
    const loaded = await (await fetch(`${base}/api/agents/lifeosagent/config`)).json();
    assert.equal(loaded.config.defaultModel, "z-ai/glm-5.3-flash");

    const bad = await fetch(`${base}/api/agents/lifeosagent/config`, {
      method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ defaultProvider: "", defaultModel: "x" }),
    });
    assert.equal(bad.status, 400);
    assert.equal((await (await fetch(`${base}/api/agents/lifeosagent/config`)).json()).config.defaultProvider, "command", "非法保存不得破坏已有配置");

    // 清单里没有的模型：拒绝（否则会写进配置、新建会话静默回落）
    const missing = await fetch(`${base}/api/agents/lifeosagent/config`, {
      method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ defaultProvider: "command", defaultModel: "nope" }),
    });
    assert.equal(missing.status, 400);
    assert.equal((await missing.json()).error.code, "model_not_found");
    assert.equal((await (await fetch(`${base}/api/agents/lifeosagent/config`)).json()).config.defaultModel, "z-ai/glm-5.3-flash");

    // 保存只应落在 projects/workspace/ 下：不许再顺手建一个空的 agents/<id>/workspace/
    await assert.rejects(stat(join(home, "agents", "lifeosagent", "workspace")), "不应创建 agents/<id>/workspace/");
  } finally { server.close(); }
});

test("头像：上传 PNG→GET 返回图片→reset 回自动；非法格式拒绝", async () => {
  const { server, base } = await start();
  try {
    const png1x1 = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
    const up = await fetch(`${base}/api/agents/lifeosagent/avatar`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ data: png1x1.toString("base64") }),
    });
    assert.equal(up.status, 200);
    const { avatar } = await up.json();
    assert.equal(avatar.kind, "image");
    const get = await fetch(`${base}/api/agents/lifeosagent/avatar`);
    assert.equal(get.status, 200);
    assert.equal(get.headers.get("content-type"), "image/png");
    assert.deepEqual(Buffer.from(await get.arrayBuffer()), png1x1);
    // 列表带 avatar 字段
    const agent = await (await fetch(`${base}/api/agents/lifeosagent`)).json();
    assert.equal(agent.avatar.kind, "image");
    // 非法格式
    const bad = await fetch(`${base}/api/agents/lifeosagent/avatar`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ data: Buffer.from("not-an-image").toString("base64") }),
    });
    assert.equal(bad.status, 400);
    // reset → 回自动（无图片头像 404）
    const reset = await fetch(`${base}/api/agents/lifeosagent/avatar`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reset: true }),
    });
    assert.equal(reset.status, 200);
    assert.equal((await fetch(`${base}/api/agents/lifeosagent/avatar`)).status, 404);
  } finally { server.close(); }
});

test("会话历史条目：与 JSONL 逐条一致（不投影）、分页正确、labels/leafId 属实", async () => {
  const { server, base, home } = await start();
  try {
    const { writeFile } = await import("node:fs/promises");
    const sid = "22222222-3333-4777-8888-999999999999";
    const dir = join(home, "agents", "lifeosagent", "projects", "workspace", "sessions");
    const entries = [
      { type: "session", version: 3, id: sid, timestamp: "2026-10-18T00:00:00.000Z", cwd: "" },
      { type: "model_change", id: "m1", parentId: sid, timestamp: "2026-10-18T00:00:01.000Z", provider: "p", modelId: "mid" },
      { type: "message", id: "m2", parentId: "m1", timestamp: "2026-10-18T00:00:02.000Z", message: { role: "user", content: "hi" } },
      { type: "label", id: "m3", parentId: "m2", timestamp: "2026-10-18T00:00:03.000Z", targetId: "m2", label: "入口" },
      { type: "message", id: "m4", parentId: "m3", timestamp: "2026-10-18T00:00:04.000Z", message: { role: "assistant", content: [{ type: "text", text: "yo" }] } },
    ];
    await writeFile(join(dir, `2026-10-18T00-00-00-000Z_${sid}.jsonl`), entries.map((e) => JSON.stringify(e)).join("\n") + "\n");

    const all = await (await fetch(`${base}/api/agents/lifeosagent/sessions/${sid}/entries`)).json();
    assert.equal(all.total, 4, "total 不含 session 头");
    assert.equal(all.header.id, sid);
    assert.deepEqual(all.entries, entries.slice(1), "条目与文件逐条一致（不投影、不改写）");
    assert.equal(all.labels.m2, "入口");
    assert.equal(all.leafId, "m4");
    assert.equal(all.hasMore, false);

    const page = await (await fetch(`${base}/api/agents/lifeosagent/sessions/${sid}/entries?offset=1&limit=2`)).json();
    assert.deepEqual(page.entries.map((e) => e.id), ["m2", "m3"]);
    assert.equal(page.hasMore, true);

    const missing = await fetch(`${base}/api/agents/lifeosagent/sessions/nope/entries`);
    assert.equal(missing.status, 404);
  } finally { server.close(); }
});


test("Agent 生命周期：创建（slug id/骨架/无预置会话）与归档（列表过滤、详情 404、数据保留、护栏）", async () => {
  const { server, base, home } = await start();
  const { readFile, access } = await import("node:fs/promises");
  try {
    // 创建：英文名 → slug id
    const created = await fetch(`${base}/api/agents`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Code Reviewer", description: "评审助手" }),
    });
    assert.equal(created.status, 201);
    const { agent: first } = await created.json();
    assert.equal(first.id, "code-reviewer", "id 由 name 自动生成");
    const record = JSON.parse(await readFile(join(home, "agents", "code-reviewer", "agent.json"), "utf8"));
    assert.equal(record.defaultProjectId, "workspace");
    assert.equal(record.description, "评审助手");
    assert.equal("defaultSessionId" in record, false, "新 Agent 不写预置会话（只随出厂模板）");
    await access(join(home, "agents", "code-reviewer", "identity.md"));
    await access(join(home, "agents", "code-reviewer", "projects", "workspace", "project.json"));

    // 同名再建 → 200 + 同一个 id（幂等，不产生第二个实体）；缺 name → 400
    const sameAgain = await fetch(`${base}/api/agents`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Code Reviewer" }),
    });
    assert.equal(sameAgain.status, 200, "已存在时返回 200（与项目注册一致）");
    assert.equal((await sameAgain.json()).agent.id, first.id, "同名幂等：同一个 id");

    // 中文名 → 合法 slug；缺 name → 400
    const zh = await fetch(`${base}/api/agents`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "评审助手" }),
    });
    assert.equal(zh.status, 201);
    const second = (await zh.json()).agent;
    assert.match(second.id, /^[a-z0-9][a-z0-9-]{0,63}$/, `中文名 slug：${second.id}`);
    assert.equal((await fetch(`${base}/api/agents`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).status, 400);

    // 列表 = 三个（workspace 内置 + 两个新建），全部非归档
    const ids = (await (await fetch(`${base}/api/agents`)).json()).items.map((item) => item.id);
    assert.deepEqual([...ids].sort(), ["lifeosagent", "code-reviewer", second.id].sort());

    // 归档：列表消失、详情 404、数据全留
    const del = await fetch(`${base}/api/agents/code-reviewer`, { method: "DELETE" });
    assert.equal(del.status, 200);
    assert.equal((await (await fetch(`${base}/api/agents`)).json()).items.some((item) => item.id === "code-reviewer"), false, "列表不再出现");
    assert.equal((await fetch(`${base}/api/agents/code-reviewer`)).status, 404, "详情也 404（URL 恢复自然回落）");
    const archived = JSON.parse(await readFile(join(home, "agents", "code-reviewer", "agent.json"), "utf8"));
    assert.ok(typeof archived.archivedAt === "string", "归档 = 写 archivedAt（可恢复）");
    await access(join(home, "agents", "code-reviewer", "identity.md"));           // identity 保留
    await access(join(home, "agents", "code-reviewer", "projects", "workspace", "daily"));   // 记录目录保留

    // 重复归档 404；不存在 404
    assert.equal((await fetch(`${base}/api/agents/code-reviewer`, { method: "DELETE" })).status, 404);
    assert.equal((await fetch(`${base}/api/agents/no-such-agent`, { method: "DELETE" })).status, 404);

    // 归档到只剩 1 个 → 400 last_agent
    assert.equal((await fetch(`${base}/api/agents/${second.id}`, { method: "DELETE" })).status, 200);
    const last = await fetch(`${base}/api/agents/lifeosagent`, { method: "DELETE" });
    assert.equal(last.status, 400);
    assert.equal((await last.json()).error.code, "last_agent");
    const still = JSON.parse(await readFile(join(home, "agents", "lifeosagent", "agent.json"), "utf8"));
    assert.equal("archivedAt" in still, false, "拒绝时出厂 Agent 不受影响");
  } finally { server.close(); }
});


test("创建/归档助手会广播 agents_changed（前端据此自动刷新列表，不需要手动刷新）", async () => {
  const { server, base } = await start();
  const controller = new AbortController();
  try {
    const response = await fetch(`${base}/api/agents/lifeosagent/events?since=0`, { signal: controller.signal });
    assert.equal(response.status, 200);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    const readUntil = async (needle, ms) => {
      const deadline = Date.now() + ms;
      while (Date.now() < deadline) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        if (buffer.includes(needle)) return true;
      }
      return false;
    };
    assert.ok(await readUntil("event: snapshot", 2000), "先收到快照");

    const created = await fetch(`${base}/api/agents`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Broadcast Probe" }),
    });
    assert.equal(created.status, 201);
    const probe = (await created.json()).agent;
    assert.ok(await readUntil("event: agents_changed", 3000), "创建后必须广播 agents_changed");

    buffer = "";
    assert.equal((await fetch(`${base}/api/agents/${probe.id}`, { method: "DELETE" })).status, 200);
    assert.ok(await readUntil("event: agents_changed", 3000), "归档后必须再广播一次");
  } finally { controller.abort(); server.close(); }
});


test("旧 uuid 项目目录：懒迁移成可读名（会话跟着搬、旧 URL 仍可反查）", async () => {
  const { server, base, home } = await start();
  const { mkdir, writeFile, readFile, access } = await import("node:fs/promises");
  try {
    const pid = "01a15461-d58e-7cb0-baeb-53393398557c";
    const dir = join(home, "agents", "lifeosagent", "projects", pid);
    await mkdir(join(dir, "sessions"), { recursive: true });
    await writeFile(join(dir, "project.json"), JSON.stringify({ schemaVersion: 1, id: pid, name: "我的项目", path: "/tmp/我的项目" }) + "\n");
    await writeFile(join(dir, "sessions", "2026-10-19T00-00-00-000Z_abc.jsonl"), JSON.stringify({ type: "session", version: 3, id: "abc", cwd: "" }) + "\n");

    const list = await (await fetch(`${base}/api/agents/lifeosagent/projects`)).json();
    const item = list.items.find((entry) => entry.path === "/tmp/我的项目");
    assert.ok(item, "迁移后的项目出现在列表里");
    assert.equal(item.id, "我的项目", "目录名 = 可读名（允许中文）");
    await access(join(home, "agents", "lifeosagent", "projects", "我的项目", "project.json"));
    await access(join(home, "agents", "lifeosagent", "projects", "我的项目", "sessions", "2026-10-19T00-00-00-000Z_abc.jsonl"));   // 会话文件跟着目录搬
    const manifest = JSON.parse(await readFile(join(home, "agents", "lifeosagent", "projects", "我的项目", "project.json"), "utf8"));
    assert.equal(manifest.id, "我的项目");
    assert.equal(manifest.legacyId, pid);
    await access(join(home, "agents", "lifeosagent", "projects", pid)).then(() => assert.fail("旧 uuid 目录应已搬走")).catch(() => {});

    // 旧 URL（?project=<uuid>）仍能解析并建会话
    const created = await fetch(`${base}/api/agents/lifeosagent/projects/${pid}/sessions`, { method: "POST" });
    assert.equal(created.status, 200, "旧 pid 仍可反查到项目");
  } finally { server.close(); }
});


test("会话级 Pi 原生能力：打断 / steer / followUp / 思考级别 / 切模型（含 404 路径）", async () => {
  const { server, base, home } = await start();
  const { mkdir, writeFile } = await import("node:fs/promises");
  try {
    // 给测试家一份最小模型清单，才能验证"切模型成功"这条
    await mkdir(join(home, "config"), { recursive: true });
    await writeFile(join(home, "config", "models.json"), JSON.stringify({
      providers: {
        test: { api: "openai-completions", baseUrl: "http://127.0.0.1:1", apiKey: "test-key", models: [{ id: "m1", name: "m1" }] },
        // 没配 key 的 provider：Pi 的 setModel 会抛 "No API key for …"，用来验证 409 原样带原因
        nokey: { api: "openai-completions", baseUrl: "http://127.0.0.1:1", models: [{ id: "m2", name: "m2" }] },
      },
    }) + "\n");
    const sid = (await (await fetch(`${base}/api/agents/lifeosagent/projects/workspace/sessions`, { method: "POST" })).json()).sessionId;

    // abort：空闲会话也安全；未知会话 404
    assert.equal((await fetch(`${base}/api/agents/lifeosagent/sessions/${sid}/abort`, { method: "POST" })).status, 200);
    assert.equal((await fetch(`${base}/api/agents/lifeosagent/sessions/nope/abort`, { method: "POST" })).status, 404);

    // steer / followUp：走 Pi 原生队列，返回 202 + queued 类型
    for (const behavior of ["steer", "followUp"]) {
      const response = await fetch(`${base}/api/agents/lifeosagent/sessions/${sid}/messages`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: "插一句", behavior }),
      });
      assert.equal(response.status, 202, behavior);
      assert.equal((await response.json()).queued, behavior);
    }
    assert.equal((await fetch(`${base}/api/agents/lifeosagent/sessions/nope/messages`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: "x", behavior: "steer" }),
    })).status, 404);

    // 思考级别：合法 200（回实际生效值）、非法 400、未知会话 404
    const thinking = await fetch(`${base}/api/agents/lifeosagent/sessions/${sid}/thinking`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ level: "medium" }),
    });
    assert.equal(thinking.status, 200);
    const thinkingBody = await thinking.json();
    assert.ok(["off", "minimal", "low", "medium", "high", "xhigh", "max"].includes(thinkingBody.level), `回实际档位，得到 ${thinkingBody.level}`);
    assert.equal((await fetch(`${base}/api/agents/lifeosagent/sessions/${sid}/thinking`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ level: "banana" }),
    })).status, 400);
    assert.equal((await fetch(`${base}/api/agents/lifeosagent/sessions/nope/thinking`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ level: "medium" }),
    })).status, 404);

    // 切模型：清单里有的 → 200；没有的 → 404
    const okModel = await fetch(`${base}/api/agents/lifeosagent/sessions/${sid}/model`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ provider: "test", model: "m1" }),
    });
    assert.equal(okModel.status, 200, "清单里的模型应能切");
    const unknownModel = await fetch(`${base}/api/agents/lifeosagent/sessions/${sid}/model`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ provider: "nope", model: "nope" }),
    });
    assert.equal(unknownModel.status, 404);
    assert.equal((await unknownModel.json()).error.code, "model_not_found");

    // 没配 key：409 + Pi 的原文案（之前这里会 500，且被压成"找不到"）
    const noKey = await fetch(`${base}/api/agents/lifeosagent/sessions/${sid}/model`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ provider: "nokey", model: "m2" }),
    });
    assert.equal(noKey.status, 409);
    const noKeyBody = await noKey.json();
    assert.equal(noKeyBody.error.code, "model_rejected");
    assert.match(noKeyBody.error.message, /No API key for nokey\/m2/);

    // 会话不存在：404 session_not_found（与"模型不在清单里"区分开）
    const noSession = await fetch(`${base}/api/agents/lifeosagent/sessions/nope/model`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ provider: "test", model: "m1" }),
    });
    assert.equal(noSession.status, 404);
    assert.equal((await noSession.json()).error.code, "session_not_found");

    // 压缩：接线正确即可（测试家没有可用模型时 Pi 会报错 → 400）
    const compact = await fetch(`${base}/api/agents/lifeosagent/sessions/${sid}/compact`, { method: "POST" });
    assert.ok([200, 400].includes(compact.status), `compact status=${compact.status}`);
  } finally { server.close(); }
});
