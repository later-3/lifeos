// 静态产物的两条策略（Task 0008）：**哪些路径是文件、各自缓存多久**。
//
// 为什么单独成纯函数：这两条算错的后果是"页面永久白屏"，而白屏在浏览器里
// 没有任何提示（只有 console 里一行 MIME 报错）。规则必须能被穷举测试。
// 测试：test/static.test.mjs。

/**
 * 带内容 hash 的构建产物：文件名随内容变，所以可以永久缓存。
 *
 * 依据：Vite 把入口产物输出成 `assets/index-<hash>.js`（`frontend/dist/assets/`），
 * hash 变则 URL 变；URL 不变则内容不变 → 缓存不会拿到过期内容。
 */
export const IMMUTABLE_CACHE = "public, max-age=31536000, immutable";

/**
 * 正文决定"加载哪份产物"的文件：必须每次回源校验。
 *
 * `index.html` 里写着当前构建的 asset hash；`sw.js` 决定壳缓存怎么取。这两个一旦被
 * 浏览器长期缓存，重新构建后用户拿到的就是指向**已不存在**的 asset 的旧引用。
 * `no-cache` 不是不缓存，是"用之前必须问一次"（可以带 304，成本几毫秒）。
 */
export const REVALIDATE_CACHE = "no-cache";

/** Vite 的 hash 产物目录：只有这里的文件按 IMMUTABLE 缓存。 */
export function isHashedAsset(path: string): boolean {
  return path.startsWith("/assets/");
}

/**
 * 路径看起来像"一个文件"吗（带扩展名）。
 *
 * 用途：**缺失的文件必须 404，不能回退成 index.html**。
 * 前端没有路径路由（状态全在 query 里），所以只有无扩展名的路径才可能是"页面"。
 * 回退错了的表现：`/assets/index-<旧hash>.js` 返回 index.html（200 text/html），
 * 浏览器按 module script 加载时报
 * "Expected a JavaScript module script but the server responded with a MIME type of text/html"，
 * `#root` 永远是空的，刷新也没用（拿到的还是同一份缓存 HTML）。
 * 实测记录：evidence/ 里 2026-11-05 的 /assets/index-OLDHASH.js → 200 text/html 938 字节。
 */
export function looksLikeFile(path: string): boolean {
  return /\.[A-Za-z0-9]+$/.test(path);
}

/** 某条静态路径的 Cache-Control。 */
export function cacheControlOf(path: string): string {
  return isHashedAsset(path) ? IMMUTABLE_CACHE : REVALIDATE_CACHE;
}
