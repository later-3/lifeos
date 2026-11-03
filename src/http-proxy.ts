// 出站 HTTP 的代理感知（2026-11-03）。
//
// 为什么需要这个文件：pi-ai 的 openai SDK 用的是 `globalThis.fetch`（见
// `openai/internal/shims.mjs` 的 `getDefaultFetch()`，实现就是 `return fetch`），
// 而 Node 的 `NODE_USE_ENV_PROXY=1` 只让**内置** fetch 的默认 dispatcher 读代理变量。
// openai SDK 走的是内置 undici 的 dispatcher → **不认那个开关**。
// 实测证据（2026-11-03）：后端进程环境里 HTTPS_PROXY/NODE_USE_ENV_PROXY 都在，
// `lsof` 却只有 `-> 104.21.45.58:443 (SYN_SENT)`（直连卡死），一条到代理端口的
// 连接都没有；每次请求正好 10.5 秒超时。
//
// 做法与 Pi CLI 相同（`pi/packages/coding-agent/src/core/http-dispatcher.ts`）：
//   setGlobalDispatcher(new EnvHttpProxyAgent())  —— 换掉全局 dispatcher
//   undici.install()                              —— 把 globalThis.fetch 换成配套的那份
// 第二步不能省：dispatcher 换了但 fetch 还是旧的，两者不配套（解压会出错）。
//
// **只在检测到代理变量时才动**：没有代理时整段跳过，连 undici 都不加载，
// 行为与未改动前完全一致。EnvHttpProxyAgent 本身也是"按环境变量决定"：
// 变量没了就直连，NO_PROXY 命中也直连。

/** 代理变量的名字（大小写两种都认，与 Node/undici 一致）。 */
const PROXY_ENV_KEYS = ["https_proxy", "HTTPS_PROXY", "http_proxy", "HTTP_PROXY", "all_proxy", "ALL_PROXY"] as const;

/** 从环境里取第一个非空的代理地址；没有就返回 undefined。 */
export function proxyUrlOf(env: Record<string, string | undefined> = process.env): string | undefined {
  for (const key of PROXY_ENV_KEYS) {
    const value = env[key]?.trim();
    if (value !== undefined && value !== "") return value;
  }
  return undefined;
}

export type ProxySetupResult =
  | { installed: false; reason: "no-proxy-env" }
  | { installed: true; proxy: string };

/**
 * 需要时把全局 dispatcher 与 fetch 换成代理感知的一对。
 * 幂等：重复调用只装一次。
 */
export async function installProxyIfConfigured(
  env: Record<string, string | undefined> = process.env,
): Promise<ProxySetupResult> {
  const proxy = proxyUrlOf(env);
  if (proxy === undefined) return { installed: false, reason: "no-proxy-env" };
  if (installedWith === proxy) return { installed: true, proxy };

  const undici = await import("undici");
  // 注意：`EnvHttpProxyAgent` 的**构造参数是驼峰**（httpProxy/httpsProxy/noProxy），
  // 它默认也只读 `process.env` 的全大写形式。这里显式传驼峰参数——
  // 否则传进来的 `env`（含小写 `https_proxy`）会被忽略，代理压根装不上。
  const pick = (...keys: string[]): string | undefined => {
    for (const key of keys) {
      const value = env[key]?.trim();
      if (value !== undefined && value !== "") return value;
    }
    return undefined;
  };
  const httpProxy = pick("http_proxy", "HTTP_PROXY", "all_proxy", "ALL_PROXY");
  const httpsProxy = pick("https_proxy", "HTTPS_PROXY", "all_proxy", "ALL_PROXY");
  const noProxy = pick("no_proxy", "NO_PROXY");
  undici.setGlobalDispatcher(new undici.EnvHttpProxyAgent({
    ...(httpProxy !== undefined ? { httpProxy } : {}),
    ...(httpsProxy !== undefined ? { httpsProxy } : {}),
    ...(noProxy !== undefined ? { noProxy } : {}),
  }));
  // 让 fetch 与 dispatcher 用同一份 undici 实现（Pi CLI 同样这么做）。
  undici.install?.();
  installedWith = proxy;
  return { installed: true, proxy };
}

/** 已安装的代理地址（幂等判断用；测试可重置）。 */
let installedWith: string | undefined;

/** 仅供测试：清掉幂等标记。 */
export function resetProxySetupForTests(): void {
  installedWith = undefined;
}
