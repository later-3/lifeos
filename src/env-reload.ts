// 从 shell 配置文件里补 `process.env`（Task 0017）。
//
// 为什么需要：环境变量在进程**创建时**从父进程继承一次，之后不再更新。实测真实现场：
// 后端的祖父 shell 起于 2026-10-29，`~/.zshrc` 里那行 `export AMR_LINK_API_KEY=...`
// 是 10-31 才写进去的 —— zsh 只在启动时读一次 rc，所以那个进程永远看不到它。
// `source` 也只对**那个交互 shell 自己**生效，救不了已经跑着的 node。
//
// 所以要"不重启也能生效"，唯一诚实可行的一条路是：**自己去读配置文件**。
//
// 为什么不跑 `zsh -ic`：实测 **7.5 秒/次**（7.92 / 7.46 / 7.48），而且会执行用户
// `.zshrc` 里的全部副作用（conda init、nvm、后台守护进程…）。静态读文件实测
// **0.010–0.035ms**，快 20 万倍且零副作用。
//
// 边界（必须诚实，不能假装能解决全部情况）：
//   - 只认 `export NAME=字面量`；含 `$(...)` / `${...}` / `$VAR` / 反引号的行整行跳过
//     （不猜、不执行命令）。
//   - 只在**另一个终端 export 过、没写进文件**时无能为力 —— 那种情况进程看不见，只能重启。
//
// 另一个必须遵守的规则：只补 `process.env` 里**缺失或为空**的项，已有值绝不覆盖
// （否则一份过期的 rc 会覆盖掉运行时正确注入的值）。

import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * 按 zsh 加载顺序排列。顺序有意义：`.zshenv` 每个 zsh 都读，`.zshrc` 只有**交互式**才读，
 * 所以同一个变量在两处都有时，`.zshenv` 更可能是"真的生效的那个"。
 * 后面的文件只补前面没给的值。
 */
const CONFIG_FILES = [".zshenv", ".zprofile", ".zshrc", ".profile", ".bashrc"] as const;

/** `export NAME=value`：只匹配字面量赋值。 */
const EXPORT_LINE = /^\s*export\s+([A-Za-z_][A-Za-z0-9_]*)=(.*)$/;
/** 需要 shell 求值的写法：整行跳过（不猜、不执行）。 */
const NEEDS_SHELL = /\$\(|`|\$\{|\$[A-Za-z_]/;

/**
 * 从一段 shell 配置文本里抽出可以直接用的 `NAME=value`。
 * 纯函数（无 IO），便于穷举测试。
 */
export function parseShellExports(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    // 注释行（含行首 #）不算；但 `export X=#abc` 这类值里的 # 不算注释，所以只看行首
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    const match = EXPORT_LINE.exec(line);
    if (match === null) continue;
    const name = match[1];
    const raw = (match[2] ?? "").trim();
    if (name === undefined || raw === "") continue;
    if (NEEDS_SHELL.test(raw)) continue;          // 需要求值：跳过
    // 去掉成对的外层引号（Pi 会把引号当成 key 的一部分，实测会 401）
    let value = raw;
    const quote = value[0];
    if ((quote === '"' || quote === "'") && value.endsWith(quote) && value.length >= 2) {
      value = value.slice(1, -1);
    }
    if (value === "") continue;
    out.set(name, value);
  }
  return out;
}

/**
 * 读 shell 配置文件，把缺失的环境变量补进 `env`。返回补了哪些变量名（不含值，便于日志）。
 *
 * @param env 通常传 `process.env`（就地修改）
 * @param home 便于测试注入（默认 `os.homedir()`）
 */
export async function reloadEnvFromShellConfigs(
  env: Record<string, string | undefined> = process.env,
  home: string = homedir(),
): Promise<string[]> {
  const filled: string[] = [];
  for (const file of CONFIG_FILES) {
    const text = await readFile(join(home, file), "utf8").catch(() => undefined);
    if (text === undefined) continue;
    for (const [name, value] of parseShellExports(text)) {
      // 已有值（非空白）不覆盖：进程里注入的比文件里的新
      const current = env[name];
      if (current !== undefined && current.trim() !== "") continue;
      env[name] = value;
      if (!filled.includes(name)) filled.push(name);
    }
  }
  return filled;
}
