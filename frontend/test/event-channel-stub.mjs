/**
 * 事件通道的浏览器端替身（Task 0028 · P3 后）。
 *
 * 事件通道已经从 SSE 换成 WebSocket（`frontend/src/api/event-channel.ts`），
 * 所以"注入假 EventSource"这类夹具**不再被任何代码读到** —— 这是 `testing.md` 2.15 说的
 * "夹具注入到没人读的地方"：页面照常渲染、断言照常跑，但推的帧全丢，于是变成
 * "页面永远停在初始状态"的假绿/假红（2026-11-18 实测：`stream-stability` 5 条直接红成空数组）。
 *
 * 这里换成**假 WebSocket**：`App` 建连接时被它接住，测试脚本仍用同一个
 * `window.__ssePush(name, data)` 推帧，帧格式在内部包成 `{t, seq, d}`（与服务端信封一致）。
 *
 * 用法：
 * ```js
 * import { EVENT_CHANNEL_STUB } from "./event-channel-stub.mjs";
 * await page.addInitScript(EVENT_CHANNEL_STUB);
 * ...
 * await page.evaluate(([n, d]) => window.__ssePush(n, d), [name, JSON.stringify(data)]);
 * ```
 */
export const EVENT_CHANNEL_STUB = () => {
  window.__ssePush = null;
  window.__wsClosed = 0;
  class FakeWebSocket {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSING = 2;
    static CLOSED = 3;
    constructor(url) {
      this.url = url;
      this.readyState = 0;
      this.listeners = {};
      window.__ssePush = (name, data) => {
        const payload = typeof data === "string" ? JSON.parse(data) : data;
        const seq = typeof payload?.seq === "number" ? payload.seq : (this.__seq = (this.__seq ?? 0) + 1);
        const frame = { t: name, seq, d: payload };
        for (const fn of this.listeners.message ?? []) fn({ data: JSON.stringify(frame) });
      };
      setTimeout(() => {
        this.readyState = 1;
        for (const fn of this.listeners.open ?? []) fn({});
      }, 0);
    }
    addEventListener(name, fn) { (this.listeners[name] ??= []).push(fn); }
    removeEventListener(name, fn) {
      const list = this.listeners[name];
      if (list === undefined) return;
      const at = list.indexOf(fn);
      if (at >= 0) list.splice(at, 1);
    }
    send() { /* 客户端不发有意义的东西 */ }
    close() {
      if (this.readyState === 3) return;
      this.readyState = 3;
      window.__wsClosed += 1;
      for (const fn of this.listeners.close ?? []) fn({ code: 1000 });
    }
  }
  window.WebSocket = FakeWebSocket;
};
