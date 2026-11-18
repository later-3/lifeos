/**
 * 前端事件通道：信封解析与重连退避（Task 0028 · P3）。
 *
 * 这两块是"换传输"里**唯一需要新写逻辑**的地方：
 *  - 信封解析：SSE 的 `event:`/`id:`/`data:` 三件事现在挤在一帧 JSON 里，`seq` 必须被复原，
 *    否则 `routeEvent` 的"快照基线"判断（C119）会失效 —— 表现为"重连后旧终态又把状态改回去"。
 *  - 退避：服务端挂掉时不能无脑锤打（mattermost `websocket.ts:246-258` 的 n² 放大 + jitter）。
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  CHANNEL_BACKOFF_AFTER, CHANNEL_MAX_RETRY_MS, CHANNEL_MIN_RETRY_MS, CHANNEL_JITTER_MS,
  CHANNEL_EVENT_NAMES, isChannelStale, nextBackoff, parseFrame,
} from "../frontend/src/api/event-channel.ts";
import { readFileSync } from "node:fs";

test("T28-17 信封解析：snapshot / ping / 事件 / 坏帧 各归各位", () => {
  assert.deepEqual(parseFrame('{"t":"snapshot","seq":7,"d":{"connectionId":"c1","running":[]}}'),
    { kind: "snapshot", seq: 7, data: { connectionId: "c1", running: [] } });
  assert.deepEqual(parseFrame('{"t":"ping","seq":9,"d":{}}'), { kind: "ping", seq: 9 });
  const event = parseFrame('{"t":"delta","seq":11,"d":{"agentId":"a","sessionId":"s","text":"hi"}}');
  assert.equal(event.kind, "event");
  assert.equal(event.type, "delta");
  assert.equal(event.seq, 11);
  assert.equal(event.data.text, "hi");
  // 坏帧不抛错（一条坏帧不该拆掉整条通道）
  assert.equal(parseFrame("not json").kind, "invalid");
  assert.equal(parseFrame('{"seq":1}').kind, "invalid");
  assert.equal(parseFrame('"str"').kind, "invalid");
});

test("T28-17b 事件缺 seq 时回落 0（下游据 seq<=基线 丢弃，不会被误判为新事件）", () => {
  const frame = parseFrame('{"t":"delta","d":{"text":"x"}}');
  assert.equal(frame.kind, "event");
  assert.equal(frame.seq, 0);
});

test("T28-18 退避：前 7 次固定 3s，之后 n² 放大并封顶 300s（+jitter）", () => {
  const noJitter = () => 0;
  for (let n = 1; n <= CHANNEL_BACKOFF_AFTER; n += 1) {
    assert.equal(nextBackoff(n, noJitter), CHANNEL_MIN_RETRY_MS, `第 ${n} 次应为 3s`);
  }
  assert.equal(nextBackoff(8, noJitter), CHANNEL_MIN_RETRY_MS * 64);
  assert.equal(nextBackoff(10, noJitter), CHANNEL_MIN_RETRY_MS * 100);
  // 封顶
  assert.equal(nextBackoff(1000, noJitter), CHANNEL_MAX_RETRY_MS);
  // jitter 落在 [0, 2000)
  const withHalf = () => 0.5;
  assert.equal(nextBackoff(1, withHalf), CHANNEL_MIN_RETRY_MS + Math.floor(0.5 * CHANNEL_JITTER_MS));
  // 单调不减（同一 random 下）
  let previous = 0;
  for (let n = 1; n <= 30; n += 1) {
    const value = nextBackoff(n, noJitter);
    assert.ok(value >= previous, `第 ${n} 次(${value}) 不应小于上一次(${previous})`);
    previous = value;
  }
});

test("T28-18b 陈旧判定：阈值边界（正好等于阈值即判陈旧）", () => {
  assert.equal(isChannelStale(1000, 1000 + 24_999, 25_000), false);
  assert.equal(isChannelStale(1000, 1000 + 25_000, 25_000), true);
});

test("T28-18c SSE 兼容路径的事件名清单与 App 保持同步（漏一个 = 那条事件在 sse 下静默丢失）", () => {
  const app = readFileSync(new URL("../frontend/src/App.tsx", import.meta.url), "utf8");
  const block = /const STREAM_EVENT_NAMES = \[([\s\S]*?)\] as const;/.exec(app);
  assert.ok(block, "App.tsx 里找不到 STREAM_EVENT_NAMES");
  const fromApp = [...block[1].matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
  const fromChannel = [...CHANNEL_EVENT_NAMES];
  // App 的清单是 channel 清单的子集：channel 多一个 review_open 是允许的差异吗？
  // 不允许 —— 两边都该有（review_open 是回合级事件，App 靠它开检视面板）。
  const missingInApp = fromChannel.filter((name) => !fromApp.includes(name));
  const missingInChannel = fromApp.filter((name) => !fromChannel.includes(name));
  assert.deepEqual(missingInApp, [], `App 缺少事件名：${missingInApp.join(",")}`);
  assert.deepEqual(missingInChannel, [], `channel 缺少事件名：${missingInChannel.join(",")}`);
});
