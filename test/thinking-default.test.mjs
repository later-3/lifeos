// 无会话时头部显示"新会话将用的档位"，默认值必须与 Pi 的默认常量一致。
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DEFAULT_PI_THINKING_LEVEL } from "../src/assembly.ts";

test("默认思考档位与 Pi 的 DEFAULT_THINKING_LEVEL 一致（Pi 改了这里会红）", () => {
  const source = readFileSync(new URL("../pi/packages/coding-agent/src/core/defaults.ts", import.meta.url), "utf8");
  const match = /export const DEFAULT_THINKING_LEVEL[^=]*=\s*"([^"]+)"/.exec(source);
  assert.ok(match !== null, "没能从 Pi 的 defaults.ts 里读到 DEFAULT_THINKING_LEVEL");
  assert.equal(DEFAULT_PI_THINKING_LEVEL, match[1], "我们的默认档位必须等于 Pi 的默认值");
});

test("默认档位是合法档位之一", () => {
  const levels = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
  assert.ok(levels.includes(DEFAULT_PI_THINKING_LEVEL));
});
