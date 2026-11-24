// 无会话时头部显示"新会话将用的档位"，默认值必须与 Pi 的默认常量一致。
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DEFAULT_PI_THINKING_LEVEL } from "../src/assembly.ts";

/*
 * 读的是 **npm 包里的编译产物**，不是仓内 pi 源码（2026-11-24 pi 从 submodule 改成 npm 依赖 1.6.0）。
 * 为什么仍要读文件而不是 import：`DEFAULT_THINKING_LEVEL` 不在 pi 的 public API（`index.ts` 没导出它），
 * 只能读它的实现文件。文件路径换成 `node_modules` 之后这条断言的性质没变——
 * **Pi 改默认值，这里就红**。
 */
test("默认思考档位与 Pi 的 DEFAULT_THINKING_LEVEL 一致（Pi 改了这里会红）", () => {
  const source = readFileSync(new URL("../node_modules/@earendil-works/pi-coding-agent/dist/core/defaults.js", import.meta.url), "utf8");
  const match = /export const DEFAULT_THINKING_LEVEL[^=]*=\s*"([^"]+)"/.exec(source);
  assert.ok(match !== null, "没能从 Pi 的 defaults.ts 里读到 DEFAULT_THINKING_LEVEL");
  assert.equal(DEFAULT_PI_THINKING_LEVEL, match[1], "我们的默认档位必须等于 Pi 的默认值");
});

test("默认档位是合法档位之一", () => {
  const levels = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
  assert.ok(levels.includes(DEFAULT_PI_THINKING_LEVEL));
});
