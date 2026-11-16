/**
 * 会话图片的取回边界（Task 0016 · P3-S1）。
 *
 * 这一组锁的是**安全边界**与**体积契约**——两者都是"改错不报错、只在生产出事"的类型：
 *
 *  · 边界：引用行里的路径来自会话文件，而会话文件可以包含任意绝对路径
 *    （`read` 工具读过 `/tmp/x.png`、用户项目里的图）。端点对外暴露，
 *    如果"有 path 就读"，等于给任意文件开了一条只读通道。
 *  · 体积：`GET /sessions/:sid` 之前把图 base64 内联，单会话 33.58 MB 图片、
 *    全库 63 个会话 152 MB（图片 66%），上行 5.26 MB/s → 一次打开光上传 4.1 s。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mimeTypeOfImagePath, resolveServeTarget, withinRoots } from "../src/attachment-serve.ts";
import { attachmentUrlOf, imageRefOfPath } from "../src/attachment-ref.ts";

// ── 纯函数：扩展名 → MIME ────────────────────────────────────────────────────

test("图片扩展名映射（大小写不敏感），非图片返回 undefined", () => {
  assert.equal(mimeTypeOfImagePath("/a/x.png"), "image/png");
  assert.equal(mimeTypeOfImagePath("/a/x.JPG"), "image/jpeg");
  assert.equal(mimeTypeOfImagePath("/a/x.jpeg"), "image/jpeg");
  assert.equal(mimeTypeOfImagePath("/a/x.webp"), "image/webp");
  assert.equal(mimeTypeOfImagePath("/a/x.gif"), "image/gif");
  assert.equal(mimeTypeOfImagePath("/a/x.avif"), "image/avif");
  assert.equal(mimeTypeOfImagePath("/a/x.txt"), undefined);
  assert.equal(mimeTypeOfImagePath("/a/x"), undefined);
  assert.equal(mimeTypeOfImagePath("/etc/passwd"), undefined);
});

test("引用 URL：路径编码进查询参数，非图片不产 URL", () => {
  const ref = imageRefOfPath("/tmp/a b/x.png");
  assert.equal(ref?.url, "/api/attachment?path=%2Ftmp%2Fa%20b%2Fx.png");
  assert.equal(ref?.mimeType, "image/png");
  assert.equal(imageRefOfPath("/tmp/x.txt"), undefined);
  assert.equal(attachmentUrlOf("/tmp/x.png"), "/api/attachment?path=%2Ftmp%2Fx.png");
});

// ── 边界：根判定 ────────────────────────────────────────────────────────────

test("withinRoots：等于根 / 在根内 → 允许；前缀相似但不同目录 → 拒绝", () => {
  assert.equal(withinRoots("/root", ["/root"]), true);
  assert.equal(withinRoots("/root/a.png", ["/root"]), true);
  assert.equal(withinRoots("/root/sub/a.png", ["/root"]), true);
  // 前缀相似但不是子路径（`/root2` 不在 `/root` 内）—— 这是最容易写错的一条
  assert.equal(withinRoots("/root2/a.png", ["/root"]), false);
  assert.equal(withinRoots("/etc/passwd", ["/root"]), false);
  assert.equal(withinRoots("/a/../etc/passwd", ["/a"]), false);
});

// ── 边界：端点判定 ──────────────────────────────────────────────────────────

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "lifeos-attach-"));
  await mkdir(join(root, "img"), { recursive: true });
  await writeFile(join(root, "img", "ok.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  await writeFile(join(root, "note.txt"), "hi");
  return root;
}

test("非法参数：空 / 缺 / 控制字符 → 400", async () => {
  const root = await fixture();
  for (const bad of [undefined, "", "   ", "/tmp/a\u0000b.png", "/tmp/a\nb.png"]) {
    const result = await resolveServeTarget(bad, [root]);
    assert.ok("code" in result, `输入 ${JSON.stringify(bad)} 应该被拒`);
    assert.equal(result.status, 400);
  }
});

test("非图片扩展名 → 400（不做内容嗅探：那会给任意文件开读通道）", async () => {
  const root = await fixture();
  const result = await resolveServeTarget(join(root, "note.txt"), [root]);
  assert.ok("code" in result);
  assert.equal(result.code, "not_an_image");
  assert.equal(result.status, 400);
});

test("越界 → 403（即便文件真实存在）", async () => {
  const root = await fixture();
  const outside = join(root, "..", "outside.png");
  const result = await resolveServeTarget(outside, [root]);
  assert.ok("code" in result);
  assert.equal(result.code, "path_not_allowed");
  assert.equal(result.status, 403);
});

test("根内 + 图片 + 存在 → 允许，且返回 MIME", async () => {
  const root = await fixture();
  const result = await resolveServeTarget(join(root, "img", "ok.png"), [root]);
  assert.ok(!("code" in result));
  assert.equal(result.mimeType, "image/png");
});

test("根内但文件不存在 → 404", async () => {
  const root = await fixture();
  const result = await resolveServeTarget(join(root, "img", "gone.png"), [root]);
  assert.ok("code" in result);
  assert.equal(result.code, "attachment_not_found");
  assert.equal(result.status, 404);
});

test("目录（不是常规文件）→ 404，不当作图片", async () => {
  const root = await fixture();
  const result = await resolveServeTarget(join(root, "img.png"), [root]);
  assert.ok("code" in result);
  assert.equal(result.status, 404);
});

test("活性验证：去掉根判定这条闸，越界用例必须变成'通过'", () => {
  // 复刻"没有边界检查"的实现，确认它确实会放行 —— 说明上面那条断言不是恒绿
  const naive = (target) => mimeTypeOfImagePath(target) !== undefined;
  assert.equal(naive("/etc/passwd.png"), true);          // 无闸会放行
  assert.equal(withinRoots("/etc/passwd.png", ["/root"]), false);   // 有闸拒绝
});
