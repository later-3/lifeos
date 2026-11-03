// T-0021 出站代理感知（2026-11-03）。
//
// 为什么这么测：2026-11-02 的诊断犯过一个错——只验证了"代理可达"
// （`node -e 'fetch(...)'` 拿到 401），没验证"**后端进程真的走了代理**"。
// 结果后端一直直连卡死（`-> 104.21.45.58:443 SYN_SENT`），每次请求 10.5 秒超时。
// 所以这里的断言必须落在"实际发生了到代理端口的连接"上，而不是"函数被调用过"。
//
// 另一个教训（本文件第一版）：用 `http://` + `.invalid` 域名测代理，代理收不到请求——
// 明文 HTTP 走的是"绝对 URI 转发"，域名解析在被代理端完成；而 HTTPS 走 CONNECT 隧道，
// 连接目标直接写在请求行里。测代理必须用 HTTPS（这也正是生产场景：模型端点都是 HTTPS）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { setTimeout as sleep } from "node:timers/promises";
import { installProxyIfConfigured, proxyUrlOf, resetProxySetupForTests } from "../src/http-proxy.ts";

/** 起一个假代理，记录收到的 HTTP 请求与 CONNECT 隧道。 */
async function fakeProxy() {
  const seen = [];
  const server = createServer((req, res) => { seen.push(`HTTP ${req.url}`); res.writeHead(502).end(); });
  server.on("connect", (req, socket) => { seen.push(`CONNECT ${req.url}`); socket.end(); });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    port: server.address().port,
    seen,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

/** 临时设置环境变量，返回还原函数。 */
function withEnv(vars) {
  const saved = {};
  for (const [key, value] of Object.entries(vars)) {
    saved[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  return () => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
}

test("T0021-1 代理变量识别：大小写都认，空串与纯空格算没配", () => {
  assert.equal(proxyUrlOf({}), undefined);
  assert.equal(proxyUrlOf({ HTTPS_PROXY: "  " }), undefined);
  assert.equal(proxyUrlOf({ HTTPS_PROXY: "" }), undefined);
  assert.equal(proxyUrlOf({ HTTPS_PROXY: "http://a:1" }), "http://a:1");
  assert.equal(proxyUrlOf({ https_proxy: "http://b:2" }), "http://b:2");
  assert.equal(proxyUrlOf({ ALL_PROXY: "socks5://c:3" }), "socks5://c:3");
  assert.equal(proxyUrlOf({ HTTPS_PROXY: "http://hi:1", http_proxy: "http://lo:2" }), "http://hi:1");
});

test("T0021-2 没有代理变量 → 不安装（连 undici 都不导入）", async () => {
  resetProxySetupForTests();
  const result = await installProxyIfConfigured({});
  assert.deepEqual(result, { installed: false, reason: "no-proxy-env" });
});

test("T0021-3 有代理变量 → 真的走了代理：HTTPS 请求以 CONNECT 打到代理端口", async () => {
  const proxy = await fakeProxy();
  const restore = withEnv({
    HTTPS_PROXY: `http://127.0.0.1:${proxy.port}`,
    HTTP_PROXY: `http://127.0.0.1:${proxy.port}`,
    NO_PROXY: "",
  });
  try {
    resetProxySetupForTests();
    // 显式传 env：测试进程会继承 shell 里的 HTTPS_PROXY（本机真实代理），
    // 不传参会装到那个代理上，测的就不是这里起的假代理了。
    const result = await installProxyIfConfigured({
      HTTPS_PROXY: `http://127.0.0.1:${proxy.port}`,
      HTTP_PROXY: `http://127.0.0.1:${proxy.port}`,
      NO_PROXY: "",
    });
    assert.equal(result.installed, true);

    await fetch("https://definitely-not-a-real-host.invalid/ping").catch(() => undefined);
    await sleep(300);   // CONNECT 是异步到达的

    assert.ok(proxy.seen.some((line) => line.startsWith("CONNECT definitely-not-a-real-host.invalid:443")),
      `代理没有收到 CONNECT → 说明根本没有走代理（收到：${JSON.stringify(proxy.seen)}）`);
  } finally {
    restore();
    await proxy.close();
    resetProxySetupForTests();
  }
});

test("T0021-4 幂等：同一个代理地址重复安装不重复设置", async () => {
  resetProxySetupForTests();
  const first = await installProxyIfConfigured({ HTTPS_PROXY: "http://127.0.0.1:1" });
  const second = await installProxyIfConfigured({ HTTPS_PROXY: "http://127.0.0.1:1" });
  assert.deepEqual(first, second);
  resetProxySetupForTests();
});

test("T0021-5 NO_PROXY 命中时直连（本地地址不被代理接管）", async () => {
  const proxy = await fakeProxy();
  const target = createServer((_req, res) => { res.writeHead(200).end("local-ok"); });
  await new Promise((resolve) => target.listen(0, "127.0.0.1", resolve));
  const targetPort = target.address().port;
  const restore = withEnv({
    HTTP_PROXY: `http://127.0.0.1:${proxy.port}`,
    HTTPS_PROXY: `http://127.0.0.1:${proxy.port}`,
    NO_PROXY: "127.0.0.1,localhost",
  });
  try {
    resetProxySetupForTests();
    await installProxyIfConfigured({
      HTTP_PROXY: `http://127.0.0.1:${proxy.port}`,
      HTTPS_PROXY: `http://127.0.0.1:${proxy.port}`,
      NO_PROXY: "127.0.0.1,localhost",
    });
    const response = await fetch(`http://127.0.0.1:${targetPort}/direct`);
    assert.equal(response.status, 200);
    assert.equal(await response.text(), "local-ok");
    await sleep(200);
    assert.deepEqual(proxy.seen, [], "NO_PROXY 命中的地址不应该经过代理");
  } finally {
    restore();
    await proxy.close();
    await new Promise((resolve) => target.close(resolve));
    resetProxySetupForTests();
  }
});

test("T0021-6 关掉代理（清空变量）后不再安装：行为回到直连", async () => {
  resetProxySetupForTests();
  await installProxyIfConfigured({ HTTPS_PROXY: "http://127.0.0.1:1" });
  resetProxySetupForTests();
  const result = await installProxyIfConfigured({});
  assert.deepEqual(result, { installed: false, reason: "no-proxy-env" });
});
