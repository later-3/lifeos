// T55：排空（任务 0006 A2 的竞态封口）——排空期间拒绝新回合，让正在跑的回合自然结束，再由 supervisor 重启。
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installHome } from "../src/home.ts";
import { startOn } from "./server-harness.mjs";
import { DRAIN_TTL_MS, drainingForMs, expireDrainIfStale, isDraining, setDraining } from "../src/session-runtime.ts";

test("T55 POST /api/runtime/drain 之后，新消息被 503 拒绝（不会在重启瞬间开新回合）；running 计数可读", async () => {
  const home = await mkdtemp(join(tmpdir(), "lifeos-drain-"));
  await installHome(process.cwd(), home);
  const { server, base } = await startOn(home);
  try {
    const before = await fetch(`${base}/api/runtime`).then((r) => r.json());
    assert.ok(Array.isArray(before.running));
    const drained = await fetch(`${base}/api/runtime/drain`, { method: "POST" });
    assert.equal(drained.status, 200);
    const body = await drained.json();
    assert.equal(body.draining, true);
    const sent = await fetch(`${base}/api/agents/lifeosagent/sessions/any/messages`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: "hi" }),
    });
    assert.equal(sent.status, 503, "排空期间不受理新回合");
    assert.equal((await sent.json()).error.code, "backend_draining");
  } finally {
    server.close();
  }
});

// —— 排空超时兜底（2026-10-26 实测：supervisor 请求排空后没重启，draining 一直为 true，
//    所有发送被 503 拒，用户只能手动重启）。排空只能存在"等回合结束 + 重启"这几秒。——

test("T55a 排空状态可查询/可清除，且带诊断时长", () => {
  setDraining(true);
  try {
    assert.equal(isDraining(), true);
    assert.ok(typeof drainingForMs() === "number");
  } finally { setDraining(false); }
  assert.equal(isDraining(), false);
  assert.equal(drainingForMs(), undefined);
});

test("T55b 排空超过 TTL 自动失效：不会把人永久卡在 503", () => {
  setDraining(true);
  try {
    assert.equal(expireDrainIfStale(Date.now() + DRAIN_TTL_MS - 1000), undefined, "未到期不动");
    const expiredFor = expireDrainIfStale(Date.now() + DRAIN_TTL_MS + 1000);
    assert.ok(expiredFor !== undefined && expiredFor > DRAIN_TTL_MS, "到期应返回已排空时长");
    assert.equal(isDraining(), false, "到期后必须恢复受理");
  } finally { setDraining(false); }
});

test("T55c 没有排空时兜底是空操作", () => {
  setDraining(false);
  assert.equal(expireDrainIfStale(Date.now() + DRAIN_TTL_MS * 5), undefined);
});
