import test from "node:test";
import assert from "node:assert/strict";
import { retryRemainingSeconds } from "../frontend/src/working.ts";

test("重试倒计时：逐秒减少，到底夹到 0（不出现负数）", () => {
  assert.equal(retryRemainingSeconds(4000, 0), 4);
  assert.equal(retryRemainingSeconds(4000, 1000), 3);
  assert.equal(retryRemainingSeconds(4000, 3900), 1);
  assert.equal(retryRemainingSeconds(4000, 4000), 0);
  assert.equal(retryRemainingSeconds(4000, 9000), 0, "超过等待时间也不显示负数");
});
