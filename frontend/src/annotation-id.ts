// 批注 id 的生成与去重（Task 0008 修复）。
//
// 为什么单独成纯函数：旧实现 `let seq = 0; nextId = () => `a${++seq}`` 的 seq 是
// **模块级**变量，每次刷新页面从 0 重计——刷新后新建的第一条批注永远叫 `a1`，
// 与服务端已有的 `a1`（老批注）撞车。后果链（全部实测过）：
//   · `patch(id)` / `remove(id)` / `setOffset(id)` 都按 id 操作 →
//     拖一张卡另一张跟着动、删一张删两条、钉一张钉两条；
//   · POST "add" 落盘后，重放按 id 去重（agent-host.ts byId）→ 同 id 的新批注
//     **静默覆盖**旧批注，数据永久丢失。
//
// 规则：新 id 必须不与"当前已知的全部 id"相交。时间戳部分保证跨刷新唯一，
// 递增后缀保证同一毫秒内多次创建（脚本/快速操作）也唯一。
// 测试：test/annotation-id.test.mjs。

/**
 * 生成一条批注的 id：`a<n><time>` 形态。
 *
 * `n` 是本会话内的递增序号（可读、排错时能看出先后）；
 * `time` 是 base36 的毫秒时间戳（跨刷新唯一的关键）。
 * 例：`a1m3xy9k2`、`a2m3xy9k3`。
 */
export function nextAnnotationId(seq: number, now: number): string {
  return `a${seq}${Math.max(0, Math.floor(now)).toString(36)}`;
}

/**
 * 在 `taken`（已有 id 集合）之外找一个可用 id：撞了就换时间戳递增重试。
 * 纯函数：不依赖 Date.now()，时间由调用方注入（可测）。
 */
export function uniqueAnnotationId(taken: ReadonlySet<string>, seq: number, now: number): string {
  let id = nextAnnotationId(seq, now);
  let guard = 0;
  while (taken.has(id) && guard < 1000) {
    guard += 1;
    id = nextAnnotationId(seq + guard, now + guard);
  }
  return id;
}
