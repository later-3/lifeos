// 用户档案（2026-11-02）：你本人的名字与头像，**不是 Agent**。
// 断言集锁住：默认取系统名、坏档案不崩、路径不可逃逸、头像按真实格式判断。
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  MAX_PROFILE_NAME, avatarExists, defaultProfileName, normalizeName, parseProfile,
  readProfile, readProfileAvatar, sniffAvatarMime, storeProfileAvatar, writeProfile,
} from "../src/profile.ts";

const PNG_1PX = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const JPG_1PX = "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==";

async function tempHome() {
  return mkdtemp(join(tmpdir(), "lifeos-profile-"));
}

test("默认名字取系统身份（用户拍板：先用主系统用户名）", async () => {
  const name = await defaultProfileName();
  assert.ok(typeof name === "string" && name.length > 0);
  // 本机应拿到系统全名 "Xu Later"；换机器时至少不能是空串
  assert.notEqual(name.trim(), "");
});

test("名字清洗：压空白、截断、空串不算数", () => {
  assert.equal(normalizeName("  Xu   Later "), "Xu Later");
  assert.equal(normalizeName("   "), undefined);
  assert.equal(normalizeName(123), undefined);
  assert.equal(normalizeName("x".repeat(100)).length, MAX_PROFILE_NAME);
});

test("坏档案回默认名，不抛（档案坏了不能拖垮界面）", async () => {
  const home = await tempHome();
  await mkdir(join(home, "config"), { recursive: true });
  await writeFile(join(home, "config", "profile.json"), "{ 坏 json");
  const profile = await readProfile(home);
  assert.ok(profile.name.length > 0);
  assert.equal(profile.avatar, undefined);
});

test("档案不存在 = 只有默认名", async () => {
  const home = await tempHome();
  const profile = await readProfile(home);
  assert.ok(profile.name.length > 0);
  assert.equal(profile.avatar, undefined);
});

test("头像文件名不许带路径（防 ../ 逃逸出档案目录）", () => {
  const evil = parseProfile({ name: "我", avatar: { kind: "image", file: "../../etc/passwd", revision: 1 } }, "我");
  assert.equal(evil.avatar, undefined, "带路径的头像文件名必须被丢弃");
  const ok = parseProfile({ name: "我", avatar: { kind: "image", file: "avatar-1.png", revision: 1 } }, "我");
  assert.deepEqual(ok.avatar, { kind: "image", file: "avatar-1.png", revision: 1 });
});

test("头像按文件头判真实类型，不信声明", () => {
  const png = Buffer.from(PNG_1PX, "base64");
  const jpg = Buffer.from(JPG_1PX, "base64");
  assert.equal(sniffAvatarMime(new Uint8Array(png)), "image/png");
  assert.equal(sniffAvatarMime(new Uint8Array(jpg)), "image/jpeg");
  assert.equal(sniffAvatarMime(new Uint8Array(Buffer.from("not an image"))), undefined);
});

test("存头像 → 写档案 → 读回，字节一致", async () => {
  const home = await tempHome();
  const avatar = await storeProfileAvatar(home, PNG_1PX);
  assert.ok(avatar !== undefined);
  assert.match(avatar.file, /^avatar-\d+\.png$/, "头像落在用户实体目录，文件名前缀是 avatar-");
  await writeProfile(home, { name: "Xu Later", avatar });
  const profile = await readProfile(home);
  assert.equal(profile.name, "Xu Later");
  assert.deepEqual(profile.avatar, avatar);
  const bytes = await readProfileAvatar(home, profile);
  assert.equal(bytes?.toString("base64"), PNG_1PX, "读回的字节必须与存入的一模一样");
  assert.equal(await avatarExists(home, profile), true);
});

test("不支持的头像格式 → undefined（不静默存垃圾）", async () => {
  const home = await tempHome();
  assert.equal(await storeProfileAvatar(home, Buffer.from("GIF89a").toString("base64")), undefined);
  assert.equal(await storeProfileAvatar(home, ""), undefined);
});

test("换头像会清掉旧的（只删自己命名的文件）", async () => {
  const home = await tempHome();
  const first = await storeProfileAvatar(home, PNG_1PX);
  assert.ok(first !== undefined);
  const profile = await readProfile(home);
  // 同目录放一个不相干文件，必须留着
  const dir = join(home, "users", profile.id);
  await writeFile(join(dir, "notes.txt"), "keep me");
  const second = await storeProfileAvatar(home, JPG_1PX);
  assert.notEqual(first.file, second?.file);
  assert.equal(await readProfileAvatar(home, { ...profile, avatar: first }), undefined, "旧头像应被清理");
  assert.equal(await readFile(join(dir, "notes.txt"), "utf8"), "keep me", "不相干文件不许删");
});

test("档案写盘 0600（含人名，不该给其他用户读）", async () => {
  const home = await tempHome();
  const written = await writeProfile(home, { name: "Xu Later" });
  const { stat } = await import("node:fs/promises");
  const info = await stat(join(home, "users", written.id, "user.json"));
  assert.equal(info.mode & 0o777, 0o600, "user.json 只有自己能读");
});
