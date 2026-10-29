// 请求体状态条文案（Task 0012 · P5）：字节要能显示出来，且上限未知时不编分母。
import assert from "node:assert/strict";
import test from "node:test";
import { formatPayloadBytes, payloadStatusText } from "../frontend/src/payload-status.ts";

test("formatPayloadBytes：十进制单位（与网关 413 的 3.5 MB 同口径）", () => {
  assert.equal(formatPayloadBytes(950), "950B");
  assert.equal(formatPayloadBytes(42_000), "42KB");
  assert.equal(formatPayloadBytes(2_000_000), "2.0MB");
  assert.equal(formatPayloadBytes(1_950_000), "1.9MB", "toFixed 截断（不虚报）");
  assert.equal(formatPayloadBytes(3_500_000), "3.5MB");
  assert.equal(formatPayloadBytes(0), "0");
  assert.equal(formatPayloadBytes(Number.NaN), "0");
});

test("payloadStatusText：有上限显示 用量/上限；无上限只显示用量；无数据 undefined", () => {
  assert.equal(payloadStatusText({ estimated: 2_000_000, limit: 3_500_000 }), "2.0MB/3.5MB");
  assert.equal(payloadStatusText({ estimated: 2_000_000, limit: null }), "2.0MB");
  assert.equal(payloadStatusText(undefined), undefined);
  assert.equal(payloadStatusText({ estimated: 0, limit: 3_500_000 }), undefined, "还没内容时不占位");
});

test("上限非法（0/NaN）时退化成只显示用量，不显示 0 分母", () => {
  assert.equal(payloadStatusText({ estimated: 1_000_000, limit: 0 }), "1.0MB");
  assert.equal(payloadStatusText({ estimated: 1_000_000, limit: Number.NaN }), "1.0MB");
});
