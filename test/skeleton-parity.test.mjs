/**
 * 骨架屏尺寸对齐（Task 0015 · S5 门禁）。
 *
 * 刷新跳版的主要来源：骨架高度 ≠ 真实内容高度。
 * 断言：骨架行的每一档尺寸必须出现在真实 primitive 的类名里（不允许自造高度）。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const SK = readFileSync(new URL("../frontend/src/design/skeleton.tsx", import.meta.url), "utf8");
const UI = readFileSync(new URL("../frontend/src/design/ui.tsx", import.meta.url), "utf8");
const APP = readFileSync(new URL("../frontend/src/App.tsx", import.meta.url), "utf8");

test("ListSkeleton 的行高与 Row 一致（h-11 / sm:h-8）", () => {
  assert.ok(/h-11/.test(SK) && /sm:h-8/.test(SK), "ListSkeleton 行高没跟 Row 对齐（Row = h-11 sm:h-8）");
  // Row 侧必须真的用了这两个值，否则对齐是假对齐
  assert.ok(/h-11/.test(UI) && /sm:h-8/.test(UI), "design/ui 的 Row 行高变了——骨架要同步改");
});

test("骨架的间距与列表容器一致（mb-0.5 ≈ space-y-0.5）", () => {
  assert.ok(/mb-0\.5/.test(SK), "骨架行间距不是 2px（列表容器用 space-y-0.5）");
});

test("列表骨架有稳定标识（截图基线/测试可断言）", () => {
  assert.ok(/data-skeleton="list"/.test(SK), "缺 data-skeleton=list");
  assert.ok(/data-skeleton="message"/.test(SK), "缺 data-skeleton=message");
});

test("App 用的是尺寸对齐的骨架（不是通用 Skeleton）", () => {
  assert.ok(/ListSkeleton/.test(APP), "App 还在用通用 Skeleton（尺寸不对齐 → 刷新跳版）");
});

/**
 * Task 0016 · P1-S1：`MessageSkeleton` 从"定义了但没人用"变成会话加载态的宿主。
 * 这一条同时锁两件事：
 *  1. 骨架高度与真实用户气泡对齐（`rounded-bubble` + 字号 content 的 2 行 ≈ h-8 起）；
 *  2. App **确实在用它**——否则加载态会退回空态（P1 的那 1.4 秒问题会复活）。
 *
 * ## 2026-11-18 合并 Task 0019 后的判定更新
 *
 * 0019 把"这一帧画骨架/空态/内容"的判定统一到了 `chatSurfaceOf`（`api/boot-state.ts`），
 * 它**取代**了 0016 的 `viewStateOf`（同一个问题只留一套判定，两处各判一次必然漂）。
 * 所以第 2 条的判据从"App 里有 `viewStateOf`"改成"App 里有 `chatSurfaceOf` +
 * 它的 `loading` 分支渲染 `MessageSkeleton`"——**要求没变**：加载中绝不能落到空态。
 */
test("MessageSkeleton 与真实气泡同族（rounded-bubble），且 App 真的在用它", () => {
  assert.ok(/rounded-bubble/.test(SK), "MessageSkeleton 的圆角没跟真实气泡对齐（rounded-bubble）");
  assert.ok(/data-skeleton="message"/.test(SK), "缺 data-skeleton=message");
  assert.ok(/MessageSkeleton/.test(APP), "App 没有用 MessageSkeleton——会话加载态会退回空态（P1-S1 回归）");
  // 判定函数（0019 起是 chatSurfaceOf；留 viewStateOf 作为旧实现的兼容名）
  assert.ok(/chatSurfaceOf|viewStateOf/.test(APP), "App 没有走表面判定纯函数（加载中可能被判成空会话）");
  // 决定性的一条：loading 分支必须渲染 MessageSkeleton（只 import 不渲染等于没接上）
  assert.ok(/chatSurface === "loading" && <MessageSkeleton/.test(APP),
    "加载分支没有渲染 MessageSkeleton（P1-S1 的 1.4 秒空态会复活）");
});

test("活性验证：骨架高度若改成自造值（h-13），对齐检查必须红", () => {
  const bad = SK.replace(/h-11/g, "h-13");
  assert.ok(!/h-11/.test(bad), "探测规则失效（改高度检测不出来）");
});
