import assert from "node:assert/strict";
import test from "node:test";
import {
  base64ByteLength, declaredImageSupport, decodeBase64Image, MAX_IMAGE_BYTES,
  MAX_IMAGES_PER_MESSAGE, MAX_SESSION_IMAGE_BYTES, sniffImageMime, validateImages,
} from "../src/image-input.ts";

// 真实文件头 + 少量负载，避免用假数据测出假通过
const png = Buffer.concat([Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]), Buffer.alloc(32, 0)]);
const jpeg = Buffer.concat([Buffer.from([0xff,0xd8,0xff,0xe0]), Buffer.alloc(32, 0)]);
const gif = Buffer.concat([Buffer.from("GIF89a"), Buffer.alloc(32, 0)]);
const webp = Buffer.concat([Buffer.from("RIFF"), Buffer.from([0,0,0,0]), Buffer.from("WEBPVP8 "), Buffer.alloc(16, 0)]);
const bmp = Buffer.concat([Buffer.from("BM"), Buffer.alloc(32, 0)]);
const avif = Buffer.concat([Buffer.from([0,0,0,0x1c]), Buffer.from("ftypavif"), Buffer.alloc(16, 0)]);
const b64 = (buf) => buf.toString("base64");
const image = (buf, mime) => ({ type: "image", data: b64(buf), mimeType: mime });

test("魔数：六种受支持格式按文件头识别", () => {
  assert.equal(sniffImageMime(new Uint8Array(png)), "image/png");
  assert.equal(sniffImageMime(new Uint8Array(jpeg)), "image/jpeg");
  assert.equal(sniffImageMime(new Uint8Array(gif)), "image/gif");
  assert.equal(sniffImageMime(new Uint8Array(webp)), "image/webp");
  assert.equal(sniffImageMime(new Uint8Array(bmp)), "image/bmp");
  assert.equal(sniffImageMime(new Uint8Array(avif)), "image/avif");
  assert.equal(sniffImageMime(new Uint8Array(Buffer.from("<svg></svg>"))), undefined);
});

test("魔数与声明不一致时拒绝（防伪装）", () => {
  const verdict = validateImages([image(png, "image/jpeg")]);
  assert.equal(verdict.ok, false);
  assert.equal(verdict.code, "invalid_image");
  assert.match(verdict.message, /实际格式是 image\/png/);
});

test("非白名单类型拒绝", () => {
  const verdict = validateImages([image(png, "image/tiff")]);
  assert.equal(verdict.ok, false);
  assert.equal(verdict.code, "unsupported_image_type");
});

test("单条消息张数上限", () => {
  const ok = validateImages(Array.from({ length: MAX_IMAGES_PER_MESSAGE }, () => image(png, "image/png")));
  assert.equal(ok.ok, true);
  assert.equal(ok.images.length, MAX_IMAGES_PER_MESSAGE);
  const over = validateImages(Array.from({ length: MAX_IMAGES_PER_MESSAGE + 1 }, () => image(png, "image/png")));
  assert.equal(over.ok, false);
  assert.equal(over.code, "too_many_images");
});

test("单张超限：按 base64 长度先判，再按解码字节判", () => {
  const big = Buffer.concat([png, Buffer.alloc(MAX_IMAGE_BYTES + 8, 0)]);
  const verdict = validateImages([image(big, "image/png")]);
  assert.equal(verdict.ok, false);
  assert.equal(verdict.code, "image_too_large");
  assert.equal(decodeBase64Image(b64(big)), undefined);
});

test("会话字节预算：已有图片字节计入，超出给 422 语义的 code", () => {
  // 预算只剩 1 字节时，任意一张图都会超（数字例子见 docs/design/image-input.md）
  const almostFull = MAX_SESSION_IMAGE_BYTES - 1;
  const verdict = validateImages([image(png, "image/png")], almostFull);
  assert.equal(verdict.ok, false);
  assert.equal(verdict.code, "session_image_budget_exceeded");
  // 反向：预算充足时同一张图通过
  assert.equal(validateImages([image(png, "image/png")], 0).ok, true);
});

test("空数组与缺省都视为没有图片（不报错）", () => {
  assert.deepEqual(validateImages(undefined), { ok: true, images: [] });
  assert.deepEqual(validateImages([]), { ok: true, images: [] });
});

test("非 base64 与空内容拒绝", () => {
  assert.equal(validateImages([{ type: "image", data: "!!!!", mimeType: "image/png" }]).code, "invalid_image");
  assert.equal(validateImages([{ type: "image", data: "", mimeType: "image/png" }]).code, "invalid_image");
});

test("base64ByteLength 与 Buffer 解码字节数一致（含 padding）", () => {
  for (const size of [1, 2, 3, 4, 100, 1001]) {
    const buf = Buffer.alloc(size, 7);
    assert.equal(base64ByteLength(buf.toString("base64")), size);
  }
});

test("能力声明：undefined 表示无法判断（不拦），false 明确拒绝", () => {
  assert.equal(declaredImageSupport(undefined), undefined);
  assert.equal(declaredImageSupport(["text"]), false);
  assert.equal(declaredImageSupport(["text", "image"]), true);
});
