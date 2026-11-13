/**
 * 构建版本检查（Task 0013，案例 C216）。
 *
 * 缺陷：Service Worker 对静态资源 cache-first 且缓存 key 恒定，长开的标签页
 * 在服务端更新 bundle 后永远不会感知——"改了代码界面没变"的结构性根源。
 * 这里补的是**感知层**：长开标签页定期对照服务端的构建版本，发现不同就广播事件
 * （VersionBanner 监听并给出"刷新"入口）。
 *
 * 设计：
 * - 当前版本 = `window.__LIFEOS_BUILD__`（vite 插件注入 index.html；dev 无注入 → 轮询不启动，零成本）；
 * - 服务端版本 = `/version.json`（构建期写入 dist，与注入值同源）；
 * - 轮询 URL 带时间戳查询：`version.json` 落在 SW 的 stale-while-revalidate 档，
 *   带新查询串必然 cache miss，绕开"SWR 先回旧缓存"的一轮延迟；
 * - 失败静默（离线/接口不在），下次轮询再试——版本检查不能比页面本身更脆。
 */

/** 当前构建版本；dev/测试外无注入时为 undefined。 */
export function currentBuildId(): string | undefined {
  return (window as { __LIFEOS_BUILD__?: string }).__LIFEOS_BUILD__;
}

/** 轮询间隔（testing 规范 2.11：定义为常量，测试可注入不等待真实时间）。 */
export const VERSION_POLL_INTERVAL_MS = 60_000;

/** 发现新版本时派发的自定义事件名。 */
export const NEW_VERSION_EVENT = "lifeos:new-version";

/**
 * 启动版本轮询。返回停止函数（幂等；main.tsx 只调一次，导出停止是为了可测试）。
 */
export function startVersionCheck(win: Window = window): () => void {
  const current = currentBuildId();
  if (!current) return () => {};
  let timer: number | undefined;
  const check = async () => {
    try {
      const response = await win.fetch(`/version.json?t=${Date.now()}`, { cache: "no-store" });
      if (!response.ok) return;
      const data = (await response.json()) as { buildId?: string };
      if (typeof data.buildId === "string" && data.buildId !== "" && data.buildId !== current) {
        win.dispatchEvent(new CustomEvent(NEW_VERSION_EVENT, { detail: data.buildId }));
      }
    } catch {
      /* 静默：离线或 version.json 不在，下次轮询再试 */
    }
  };
  void check();
  timer = win.setInterval(() => void check(), VERSION_POLL_INTERVAL_MS);
  return () => {
    if (timer !== undefined) win.clearInterval(timer);
  };
}
