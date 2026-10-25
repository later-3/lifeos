// 有界发送（任务 0007 P1）：每个连接按字节积压计数；积压超过上限、或写入失败（连接已断），都视为"过载"。
// 过载不是静默丢弃——总线拿到 false 后会摘除该连接，客户端重连并重新取快照（见 events.ts）。
import type { AgentEvent } from "./events.ts";

export type BoundedSink = {
  /** 投递一条事件。返回 false = 已过载或已关闭，调用方必须摘除该连接。 */
  offer(event: AgentEvent): boolean;
  pendingBytes(): number;
  closed(): boolean;
  close(): void;
};

export function createBoundedSink(options: {
  write: (event: AgentEvent) => Promise<void>;
  limitBytes: number;
}): BoundedSink {
  let pending = 0;
  let closed = false;
  return {
    offer(event) {
      if (closed) return false;
      const size = JSON.stringify(event).length;
      if (pending + size > options.limitBytes) return false;
      pending += size;
      options.write(event).then(
        () => { pending -= size; },
        () => { closed = true; pending -= size; },
      );
      return true;
    },
    pendingBytes: () => pending,
    closed: () => closed,
    close() { closed = true; },
  };
}
