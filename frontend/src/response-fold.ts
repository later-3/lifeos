/**
 * ResponseBar 过程区展开态的**唯一规则**（Task 0008 · P3）—— 纯函数，不碰 DOM、不碰 React。
 *
 * 用户 2026-11-04 定案："只要用户折叠了，那就是一直折叠，展开了一直展开，对于一个 session……
 * 不要一会儿是展开的一会儿是关闭的，没有做状态管理。"
 *
 * 所以规则只有三条，且 `folded` 必须**压过** live —— 这是 P3 之前的老 bug：
 * `live` 会强制展开，用户点了也白点，展开态在流式期间来回跳。
 *
 * 放在独立文件里（而不是组件文件内）的原因：组件文件是 `.tsx`，Node 的类型剥离跑不了，
 * 规则就无法单测。规则与渲染分开，测试锁规则、界面测渲染。
 */
export type ResponseFoldPref = "open" | "folded";

/**
 * @param pref 用户在本 session 点过的偏好（没点过 = undefined）
 * @param live 这一轮是否正在生成
 */
export function processOpenOf(pref: ResponseFoldPref | undefined, live: boolean): boolean {
  if (pref === "open") return true;
  if (pref === "folded") return false;
  return live;
}
