/*
 * Life OS 的轻量壳缓存（Task 0013 重写，案例 C216/C217）：
 * - 缓存 key = `lifeos-shell-<构建版本>`（构建期由 vite 插件注入，key 每次构建必变）；
 *   新构建 → 新 key → activate 清旧 key（下方既有逻辑生效，不再"永不清除"）。
 * - 策略分三档：
 *   ① navigate：network-first（在线必拿新 index.html → 新 bundle 引用；断线才回缓存兜底）；
 *   ② /assets/（文件名带内容 hash，内容不可变）：cache-first —— 正确且高效；
 *   ③ 其余同源 GET（根文件、图标等可能同 URL 变内容的）：stale-while-revalidate
 *      —— 先回缓存不卡屏，同时后台刷新，下次命中即新。
 * - API/SSE 永远走网络（不变）。
 *
 * 实现注意（补测 E2E 抓到的两个坑，C217）：
 * - `cache.put(request, …)` 对 **navigate 模式**的请求会失败（Cache API 限制）——
 *   一律用 `put(request.url, …)`（URL 字符串构造，mode 无关）；
 * - preview/静态响应带 `Vary: Origin`，后续 `caches.match` 会因 Vary 不匹配而 miss——
 *   统一 `ignoreVary: true`（我们对整仓缓存做匹配，Vary 语义无意义）；
 * - put 失败必须可见（console.warn），不静默吞（前端规范 2.9 在 SW 侧的延伸）。
 */
const CACHE = "lifeos-shell-__LIFEOS_SW_BUILD__";
/** 预缓存清单（构建期注入）：install 时尽力预存，首次访问即有完整断线兜底。 */
const PRECACHE = __LIFEOS_PRECACHE__;

self.addEventListener("install", (event) => {
  self.skipWaiting();
  // 尽力预存：任一失败只打警告，不阻塞 install（全部原子addAll会让单文件失败卡死激活）
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      Promise.allSettled(
        PRECACHE.map((url) =>
          fetch(new Request(url, { cache: "no-cache" }))
            .then((response) => {
              if (!response.ok) throw new Error(`HTTP ${response.status}`);
              return putInto(cache, url, response);
            })
            .catch((error) => console.warn("[lifeos-sw] precache 失败", url, String(error))),
        ),
      ).then(() => undefined),
    ),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE && key.startsWith("lifeos-shell-")).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

/** /assets/ 下由 vite 产出的带 hash 文件（index-XXXX.js 等）：内容不可变。 */
function isHashedAsset(pathname) {
  return pathname.startsWith("/assets/") && /-[\w-]{8,}\.(?:js|css|woff2?|png|svg|jpg|webp)$/.test(pathname);
}

/**
 * 写缓存：url 字符串（避开 navigate 模式 put 限制）；response 必须是**同步 clone 好的副本**——
 * `caches.open()` 是异步的，若等到 open 完成才 clone，respondWith 已把原响应 body
 * 消费掉，clone 会抛 "body already used"，put 全部失败（补测 E2E 抓到的真根因）。
 * 失败打印警告，不静默吞（前端规范 2.9 在 SW 侧的延伸）。
 */
function putInto(cache, url, response) {
  return cache.put(url, response)
    .catch((error) => console.warn("[lifeos-sw] cache.put 失败", url, String(error)));
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/") || url.pathname.includes("/events")) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();   // 同步克隆（body 未被消费），open 完成后再写入
            void caches.open(CACHE).then((cache) => putInto(cache, url.pathname, copy));
          }
          return response;
        })
        .catch(async () =>
          (await caches.match(url.pathname, { ignoreVary: true }))
          ?? (await caches.match("/", { ignoreVary: true }))
          ?? Response.error()),
    );
    return;
  }

  if (isHashedAsset(url.pathname)) {
    // 不可变资源：cache-first
    event.respondWith(
      caches.match(request, { ignoreVary: true }).then((cached) => cached ?? fetch(request).then((response) => {
        if (response.ok) {
          const copy = response.clone();   // 同步克隆（body 未被消费），open 完成后再写入
          void caches.open(CACHE).then((cache) => putInto(cache, request.url, copy));
        }
        return response;
      })),
    );
    return;
  }

  // 其余：stale-while-revalidate —— 缓存命中先返回，同时后台更新供下次使用
  event.respondWith(
    caches.match(request, { ignoreVary: true }).then((cached) => {
      const network = fetch(request).then((response) => {
        if (response.ok) {
          const copy = response.clone();   // 同步克隆（body 未被消费），open 完成后再写入
          void caches.open(CACHE).then((cache) => putInto(cache, request.url, copy));
        }
        return response;
      }).catch(() => cached ?? Response.error());
      return cached ?? network;
    }),
  );
});
