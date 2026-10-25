import assert from "node:assert/strict";
import test from "node:test";
import {
  addImage, attachmentSummary, base64ByteLength, formatBytes, MAX_IMAGES_PER_MESSAGE,
  removeImage, scaledSize, shouldCompressImage, toRequestImages, totalImageBytes,
} from "../frontend/src/attachments.ts";

const b64 = (size) => Buffer.alloc(size, 3).toString("base64");
const img = (id, bytes = 100, mimeType = "image/png") => ({ id, data: b64(bytes), mimeType });

test("压缩判定照 pi-web：超过 1MB 才压，GIF 不压", () => {
  assert.equal(shouldCompressImage(1024 * 1024, "image/jpeg"), false);
  assert.equal(shouldCompressImage(1024 * 1024 + 1, "image/jpeg"), true);
  assert.equal(shouldCompressImage(5 * 1024 * 1024, "image/gif"), false);
});

test("缩放只缩不放，长边到 1024，短边等比", () => {
  assert.deepEqual(scaledSize(1600, 900), { width: 1024, height: 576 });
  assert.deepEqual(scaledSize(800, 600), { width: 800, height: 600 });
  assert.deepEqual(scaledSize(0, 0), { width: 0, height: 0 });
  assert.deepEqual(scaledSize(900, 2000), { width: 461, height: 1024 });
});

test("加入图片：校验顺序是类型 → 单张大小 → 张数", () => {
  assert.equal(addImage([], { ...img("1"), mimeType: "image/tiff" }).reason, "unsupported_type");
  assert.equal(addImage([], { id: "x", data: b64(10 * 1024 * 1024 + 1), mimeType: "image/png" }).reason, "too_large");
  const full = Array.from({ length: MAX_IMAGES_PER_MESSAGE }, (_, i) => img(String(i)));
  assert.equal(addImage(full, img("extra")).reason, "too_many");
  // 边界：正好 10 张通过，第 11 张拒绝
  const nine = full.slice(0, MAX_IMAGES_PER_MESSAGE - 1);
  const verdict = addImage(nine, img("last"));
  assert.equal(verdict.ok, true);
  assert.equal(verdict.images.length, MAX_IMAGES_PER_MESSAGE);
});

test("重复添加同一张图不合并（id 区分），删除按 id", () => {
  const a = addImage([], img("a"));
  const b = addImage(a.images, img("b"));
  assert.equal(b.images.length, 2);
  assert.equal(removeImage(b.images, "a").length, 1);
  assert.equal(removeImage(b.images, "a")[0].id, "b");
});

test("字节统计与格式化", () => {
  const images = [img("a", 1000), img("b", 2000)];
  assert.equal(totalImageBytes(images), 3000);
  assert.equal(formatBytes(999), "999B");
  assert.equal(formatBytes(1024), "1KB");
  assert.equal(formatBytes(3.5 * 1024 * 1024), "3.5MB");
  assert.equal(base64ByteLength(b64(12345)), 12345);
});

test("请求形状只含 type/data/mimeType（不把界面字段发给后端）", () => {
  const payload = toRequestImages([img("a", 10)]);
  assert.deepEqual(Object.keys(payload[0]).sort(), ["data", "mimeType", "type"]);
});

test("托盘摘要与张数一致", () => {
  assert.equal(attachmentSummary([]), "");
  assert.match(attachmentSummary([img("a", 1024)]), /^1 张图片 · 1KB$/);
});
