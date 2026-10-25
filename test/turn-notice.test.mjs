// T53：进入会话时的回合提示（任务 0006 B2）——lost 必须有原因，不能只剩"重新发送"按钮。
import { test } from "node:test";
import assert from "node:assert/strict";
import { lostNoticeFor } from "../frontend/src/turn-notice.ts";

test("T53 最近回合 lost → 给出原因与重发引导；done/running/无回合 → 不给提示", async () => {
  const notice = lostNoticeFor({ state: "lost" });
  assert.ok(notice && /未完成|中断/.test(notice.text), notice?.text);
  assert.ok(/重新发送/.test(notice.text));
  assert.equal(lostNoticeFor({ state: "done" }), undefined);
  assert.equal(lostNoticeFor({ state: "running" }), undefined);
  assert.equal(lostNoticeFor(undefined), undefined);
});
