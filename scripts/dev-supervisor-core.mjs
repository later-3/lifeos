// 开发 supervisor 的重启决策（任务 0006 A2）：纯函数，便于穷举测试。
// - 没有源码改动 → 不动；
// - 有改动且没有回合在跑 → 立即重启；
// - 有改动但有回合在跑 → 等待（回合结束后再重启）。
// 为什么必须有这一条：`node --watch` 会无条件杀掉子进程，正在跑的 Pi 回合随之终止（2026-10-25 事故）。
export function decideRestart({ changed, running }) {
  if (!changed) return "none";
  return running > 0 ? "wait" : "restart";
}
