// 主实例的构建漂移判定（协议 §3.7 主区边界；开发规范 §7.4）。
//
// 要守的**行为**：进程比产物新 = 用户看到的就是磁盘上这份构建；
// 产物比进程新 = 前端或后端有改动没生效（两半错版；界面不提示，靠这条检查发现）。
//
// 纯函数穷举：五种状态各一条，外加两条边界（只缺一个产物 / 两个都缺）。
// 不读真实磁盘、不读真实进程（这里是判定，采集在 scripts/instance-drift.mjs）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { instanceDrift } from "../scripts/instance-drift-core.mjs";

const at = (iso) => Date.parse(iso);

test("clean：进程晚于全部产物 → 用户看到的就是磁盘上这份构建", () => {
  const verdict = instanceDrift({
    processStart: at("2026-11-16T10:30:00+08:00"),
    backendArtifact: at("2026-11-16T10:29:14+08:00"),
    frontendArtifact: at("2026-11-16T10:29:23+08:00"),
  });
  assert.equal(verdict.state, "clean");
  assert.equal(verdict.next, "无需处理");
});

test("frontend-ahead：2026-11-16 的真实形态（前端 10:29 构建、进程 10:01 启动）→ 前端新后端旧", () => {
  const verdict = instanceDrift({
    processStart: at("2026-11-16T10:01:44+08:00"),
    backendArtifact: at("2026-11-16T10:29:14+08:00"),
    frontendArtifact: at("2026-11-16T10:29:23+08:00"),
  });
  // 前后端都比进程新 → 更强的那个结论
  assert.equal(verdict.state, "both-ahead");

  // 只有前端比进程新（后端产物没被重建）→ 前端新、后端旧的两半错版
  const onlyFrontend = instanceDrift({
    processStart: at("2026-11-16T10:01:44+08:00"),
    backendArtifact: at("2026-11-16T10:00:00+08:00"),
    frontendArtifact: at("2026-11-16T10:29:23+08:00"),
  });
  assert.equal(onlyFrontend.state, "frontend-ahead");
  assert.match(onlyFrontend.detail, /后端仍是旧代码/);
  assert.match(onlyFrontend.next, /§7\.4/);
});

test("backend-stale：只有后端产物比进程新 → 需要重启才生效", () => {
  const verdict = instanceDrift({
    processStart: at("2026-11-16T10:01:44+08:00"),
    backendArtifact: at("2026-11-16T11:00:00+08:00"),
    frontendArtifact: at("2026-11-16T09:00:00+08:00"),
  });
  assert.equal(verdict.state, "backend-stale");
});

test("unknown：两个产物都读不到 → 不猜（缺什么要说清）", () => {
  const verdict = instanceDrift({ processStart: at("2026-11-16T10:01:44+08:00") });
  assert.equal(verdict.state, "unknown");
  assert.match(verdict.next, /没构建|缺什么|确认/);
});

test("边界：只缺一个产物时仍能判定（缺的那一侧当作未知，不算 ahead）", () => {
  const noBackend = instanceDrift({
    processStart: at("2026-11-16T10:01:44+08:00"),
    frontendArtifact: at("2026-11-16T10:29:23+08:00"),
  });
  assert.equal(noBackend.state, "frontend-ahead");

  const noFrontend = instanceDrift({
    processStart: at("2026-11-16T10:01:44+08:00"),
    backendArtifact: at("2026-11-16T10:29:14+08:00"),
  });
  assert.equal(noFrontend.state, "backend-stale");

  const neitherAhead = instanceDrift({
    processStart: at("2026-11-16T10:30:00+08:00"),
    frontendArtifact: at("2026-11-16T10:29:23+08:00"),
  });
  assert.equal(neitherAhead.state, "clean");
});
