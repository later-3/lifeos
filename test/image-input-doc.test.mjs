import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  IMAGE_MIME_TYPES, MAX_IMAGE_BYTES, MAX_IMAGES_PER_MESSAGE, MAX_SESSION_IMAGE_BYTES,
} from "../src/image-input.ts";
import {
  CLIENT_COMPRESS_THRESHOLD_BYTES, CLIENT_JPEG_QUALITY, CLIENT_MAX_IMAGE_SIDE,
  MAX_IMAGE_BYTES as CLIENT_MAX_IMAGE_BYTES, MAX_IMAGES_PER_MESSAGE as CLIENT_MAX_IMAGES,
} from "../frontend/src/attachments.ts";

const doc = readFileSync(new URL("../.lifeos/projects/lifeos/knowledge/design/image-input.md", import.meta.url), "utf8");

/** 取表格里某一行第 2 列（值列）的原文。 */
function rowValue(label) {
  const line = doc.split("\n").find((candidate) => candidate.startsWith(`| ${label} |`));
  assert.ok(line !== undefined, `文档缺少约束行：${label}`);
  return line.split("|")[1 + 1].trim();
}

test("文档的约束表与后端常量一致", () => {
  assert.equal(rowValue("单张原图上限"), `${MAX_IMAGE_BYTES / (1024 * 1024)}MB`);
  assert.equal(rowValue("单条消息张数"), `${MAX_IMAGES_PER_MESSAGE} 张`);
  assert.equal(rowValue("会话图片总字节预算"), `${MAX_SESSION_IMAGE_BYTES / (1024 * 1024)}MB`);
  assert.equal(rowValue("允许的图片类型"), IMAGE_MIME_TYPES.map((mime) => mime.replace("image/", "")).join("/"));
});

test("文档的约束表与前端常量一致（两侧漂移会失败）", () => {
  assert.equal(CLIENT_MAX_IMAGE_BYTES, MAX_IMAGE_BYTES);
  assert.equal(CLIENT_MAX_IMAGES, MAX_IMAGES_PER_MESSAGE);
  assert.equal(rowValue("客户端压缩阈值"), `超过 ${CLIENT_COMPRESS_THRESHOLD_BYTES / (1024 * 1024)}MB`);
  assert.equal(rowValue("客户端压缩长边"), `${CLIENT_MAX_IMAGE_SIDE}px`);
  assert.equal(rowValue("客户端 JPEG 质量"), String(CLIENT_JPEG_QUALITY));
});

test("文档里出现的每个错误码都在源码中有产出点", () => {
  const source = readFileSync(new URL("../src/image-input.ts", import.meta.url), "utf8")
    + readFileSync(new URL("../src/server.ts", import.meta.url), "utf8");
  const codes = [...doc.matchAll(/^\| `([a-z_]+)` \| \d{3} \|/gm)].map((match) => match[1]);
  assert.ok(codes.length >= 7, `错误码表解析异常：${codes.length} 项`);
  for (const code of codes) {
    assert.ok(source.includes(`"${code}"`), `错误码 ${code} 在源码中不存在`);
  }
});

test("约束行不允许无依据（每行必须有 A/B/C/D 依据级别）", () => {
  const rows = doc.split("\n").filter((line) => line.startsWith("| ") && !line.startsWith("| 约束") && !line.startsWith("| 能力") && !line.startsWith("| code") && !line.startsWith("| ---"));
  const constraintRows = rows.filter((line) => line.includes("`src/") || line.includes("`frontend/") || line.includes("Pi `") || line.includes("不覆盖"));
  assert.ok(constraintRows.length >= 8, `约束行过少：${constraintRows.length}`);
  for (const row of constraintRows) {
    assert.match(row, /\b[ABC]：/, `约束行缺少依据级别：${row.slice(0, 40)}`);
  }
});
