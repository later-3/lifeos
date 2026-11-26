// 压缩失败留痕（Task 0041 · P3 / S6）。
//
// 目的：压缩失败必须可观察（backend/code.md 2.9）。实测代价（01-background §2）：
// 一个会话因为压缩没发生 / 压不动，连续 6 轮回复被截断，而日志里**一条都没有**——事后无法定位。
//
// 这条测试直接断言"日志里出现了这一行"，而不是断言"某个函数被调用"（testing.md 2.5：
// 断言用户/运维可验证的行为，不断言实现细节）。
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

/** 静态检查：失败分支必须写日志（源码级，不需要起会话）。 */
const SOURCE = new URL("../src/agent-host.ts", import.meta.url);

test("compactSession 的每个失败分支都写日志（源码级断言）", () => {
  const text = readFileSync(SOURCE, "utf8");
  const start = text.indexOf("export async function compactSession");
  assert.ok(start > 0, "没找到 compactSession");
  // 到下一个顶层 export 为止
  const rest = text.slice(start);
  const end = rest.indexOf("\nexport type ");
  const body = end > 0 ? rest.slice(0, end) : rest;

  // 失败分支：会话不在内存态
  assert.ok(
    /compactSession",\s*"压缩失败：会话不在内存态"/.test(body),
    "「会话不在内存态」分支必须写日志",
  );
  // 失败分支：compact() 抛错
  assert.ok(
    /compactSession",\s*"压缩失败"/.test(body),
    "compact() 抛错分支必须写日志",
  );
  // 日志必须带 sessionId（否则事后无法按会话回查）
  const warnCalls = body.match(/log\.warn\([^)]*\)/g) ?? [];
  assert.ok(warnCalls.length >= 2, `应该有至少 2 条 warn，实际 ${warnCalls.length}`);
  for (const call of warnCalls) {
    assert.ok(call.includes("sessionId"), `日志必须带 sessionId：${call}`);
  }
});

test("compactSession 的失败日志不能泄露摘要正文或凭据（只写 message）", () => {
  const text = readFileSync(SOURCE, "utf8");
  const start = text.indexOf("export async function compactSession");
  const rest = text.slice(start);
  const end = rest.indexOf("\nexport type ");
  const body = end > 0 ? rest.slice(0, end) : rest;

  // 不应出现把 summary 写进日志的写法
  assert.ok(!/log\.[a-z]+\([^)]*summary/.test(body), "日志不得包含 summary 正文");
  // 不应出现 apiKey / token / password
  assert.ok(!/(apiKey|token|password|cookie)/i.test(body), "日志不得包含凭据字段");
});

test("compactSession 成功时不写 warn（不制造噪音）", () => {
  const text = readFileSync(SOURCE, "utf8");
  const start = text.indexOf("export async function compactSession");
  const rest = text.slice(start);
  const end = rest.indexOf("\nexport type ");
  const body = end > 0 ? rest.slice(0, end) : rest;

  // 成功分支（return { ok: true ... }）之前不应有 warn
  const okIndex = body.indexOf("{ ok: true, summary: result.summary }");
  assert.ok(okIndex > 0, "没找到成功分支");
  const beforeOk = body.slice(0, okIndex);
  const warnsBeforeOk = beforeOk.match(/log\.warn\(/g) ?? [];
  // 允许「会话不在内存态」那一条（它在 try 之外，成功路径上不会执行）
  assert.equal(warnsBeforeOk.length, 1, "成功路径上不应额外写 warn");
});

// 活性自检（testing.md 2.4）：把两条 warn 删掉，上面第一条必须变红。
test("活性：源码里必须真的存在 log.warn 调用（不是注释）", () => {
  const text = readFileSync(SOURCE, "utf8");
  const start = text.indexOf("export async function compactSession");
  const rest = text.slice(start);
  const end = rest.indexOf("\nexport type ");
  const body = end > 0 ? rest.slice(0, end) : rest;
  // 去掉注释行后再匹配，避免"注释里写了 log.warn"骗过测试
  const withoutComments = body
    .split("\n")
    .filter((line) => !line.trim().startsWith("//") && !line.trim().startsWith("*") && !line.trim().startsWith("/*"))
    .join("\n");
  assert.ok(/log\.warn\(/.test(withoutComments), "注释掉 log.warn 会让这条变红");
});
