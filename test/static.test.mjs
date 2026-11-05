// Task 0008：静态产物策略纯函数（src/static.ts）——哪些路径是文件、缓存多久。
import { test } from "node:test";
import assert from "node:assert/strict";
import { cacheControlOf, IMMUTABLE_CACHE, isHashedAsset, looksLikeFile, REVALIDATE_CACHE } from "../src/static.ts";

test("带 hash 的产物目录按永久缓存：/assets/index-abc123.js", () => {
  assert.equal(isHashedAsset("/assets/index-CIAzUNr9.js"), true);
  assert.equal(cacheControlOf("/assets/index-CIAzUNr9.js"), IMMUTABLE_CACHE);
  assert.equal(cacheControlOf("/assets/index-QyIeWX6_.css"), IMMUTABLE_CACHE);
});

test("入口文件必须回源校验：index.html / sw.js / manifest 不永久缓存", () => {
  // index.html 里写着当前构建的 asset hash；sw.js 决定壳缓存怎么取。缓存住它们 = 白屏。
  for (const path of ["/", "/index.html", "/sw.js", "/manifest.webmanifest", "/icon.svg"]) {
    assert.equal(cacheControlOf(path), REVALIDATE_CACHE, `${path} 必须 no-cache`);
  }
});

test("缺失的文件必须 404：带扩展名的路径不是页面", () => {
  // 回退成 index.html 的表现是 200 text/html 给一个 module script —— #root 永远空。
  assert.equal(looksLikeFile("/assets/index-OLDHASH.js"), true);
  assert.equal(looksLikeFile("/assets/index-QyIeWX6_.css"), true);
  assert.equal(looksLikeFile("/missing.png"), true);
});

test("无扩展名的路径才可能是页面：不 404，交给 index.html", () => {
  assert.equal(looksLikeFile("/"), false);
  assert.equal(looksLikeFile("/some/deep/route"), false);
  assert.equal(looksLikeFile("/session"), false);
});

test("assets 判定只看前缀，不猜文件名格式（换来的是实现不依赖 Vite 的命名细节）", () => {
  assert.equal(isHashedAsset("/assets/anything"), true);
  assert.equal(isHashedAsset("/assetsx/index.js"), false);
  assert.equal(isHashedAsset("/index.html"), false);
});
