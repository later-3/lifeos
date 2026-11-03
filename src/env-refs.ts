// 凭据引用的静态解析（Task 0017）。
//
// 为什么需要：`models.json` 里的 key 是引用式 `${AMR_LINK_API_KEY}`，缺变量时 Pi 的错误原文
// 只写"Failed to resolve API key …"，用户看不出**要配哪个变量**。要报出变量名，先得从
// 配置里把它解析出来。
//
// 为什么不复用 Pi 的 `getConfigValueEnvVarNames`：它没从
// `@earendil-works/pi-coding-agent` 的 `dist/index.d.ts` 导出（实测 44 行导出清单里没有），
// 只能自己实现同样的语义。
//
// 语义与 Pi 的 `parseConfigValueTemplate`（pi/.../core/resolve-config-value.ts:39-80）一致：
//   - `"sk-abc"`               → 无引用
//   - `"${A}"`                 → ["A"]
//   - `"${A}${B}"`             → ["A", "B"]
//   - `"prefix-${A}-suffix"`   → ["A"]
//   - `"!op read ..."`         → 命令式，返回 [] 并标记 unsupported（不执行、不猜）
//   - `"$${A}"` / `"$!..."`    → `$$`/`$!` 是转义，不产生引用

/** 一个被引用的环境变量当前的状态。 */
export type EnvRefState =
  /** 有值，且看起来能直接用 */
  | { kind: "ok" }
  /** 变量不存在 */
  | { kind: "missing" }
  /** 存在但是空白（Pi 的 `value.trim().length > 0` 会判为"没有"） */
  | { kind: "empty" }
  /** 有值但格式有问题（带引号/首尾空格/换行）：Pi 判为"有"，发出去会 401 */
  | { kind: "malformed"; reason: "quoted" | "whitespace" | "newline" };

/**
 * 从配置值里取出被 `${VAR}` 引用的变量名（按出现顺序，去重）。
 *
 * 必须按 Pi 的解析器语义逐字符扫（`pi/.../core/resolve-config-value.ts:39-80`），
 * 不能用简单正则：`$$` 与 `$!` 是**转义**，`$${A}` 是字面量 `${A}` 而不是引用。
 *
 * `!` 开头是命令式配置（`!op read op://...`）：返回空数组 —— 我们既不执行命令，
 * 也不假装知道它会产出什么变量。
 */
export function envRefsOf(config: string | undefined): string[] {
  const text = config ?? "";
  if (text.trim().startsWith("!")) return [];
  const names: string[] = [];
  let index = 0;
  while (index < text.length) {
    const dollar = text.indexOf("$", index);
    if (dollar < 0) break;
    const next = text[dollar + 1];
    // `$$` / `$!` 是转义：跳过两个字符，不产生引用
    if (next === "$" || next === "!") { index = dollar + 2; continue; }
    if (next === "{") {
      const end = text.indexOf("}", dollar + 2);
      if (end < 0) { index = dollar + 1; continue; }
      const name = text.slice(dollar + 2, end);
      if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) && !names.includes(name)) names.push(name);
      index = end + 1;
      continue;
    }
    // 裸 `$NAME` 形式 Pi 也当字面量处理（它只认 `${NAME}`），与 Pi 保持一致
    index = dollar + 1;
  }
  return names;
}

/** 这个配置值是不是命令式（`!cmd`）：是的话我们无法静态判断它需要什么。 */
export function isCommandConfigValue(config: string | undefined): boolean {
  return (config ?? "").trim().startsWith("!");
}

/**
 * 判一个环境变量的状态。**只判"能不能直接用"，不判"能不能连上服务"**（那是另一回事）。
 *
 * 为什么要分 `empty` 与 `malformed`：Pi 对值的判定是 `value.trim().length > 0`
 * （pi/packages/ai/src/auth/context.ts:24-30），实测：
 *   ""        → 判为"没有"（checkAuth undefined）
 *   "   "     → 判为"没有"
 *   '"sk-abc"'→ 判为"有"，但取到的 key 带引号 → 401
 *   "  sk-abc  " → 判为"有"，带空格 → 可能 401
 * 三种病三种下一步，混成一句"没配置"用户没法自救。
 */
export function envRefState(env: Record<string, string | undefined>, name: string): EnvRefState {
  const value = env[name];
  if (value === undefined) return { kind: "missing" };
  if (value.trim() === "") return { kind: "empty" };
  if (value.includes("\n") || value.includes("\r")) return { kind: "malformed", reason: "newline" };
  if (value !== value.trim()) return { kind: "malformed", reason: "whitespace" };
  if (/^["']|["']$/.test(value)) return { kind: "malformed", reason: "quoted" };
  return { kind: "ok" };
}

/** 一个配置值里所有引用的状态汇总（给预检与启动体检共用）。 */
export function inspectConfigValue(
  config: string | undefined,
  env: Record<string, string | undefined>,
): { command: boolean; refs: Array<{ name: string; state: EnvRefState }> } {
  if (isCommandConfigValue(config)) return { command: true, refs: [] };
  return {
    command: false,
    refs: envRefsOf(config).map((name) => ({ name, state: envRefState(env, name) })),
  };
}
