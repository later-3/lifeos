/**
 * Tracing 事件 → 「函数 → 样本数」的纯函数（Task 0033 · P5）。
 *
 * ## 为什么单独一个文件
 *
 * 第一版把 `summarize()` 写在 `cdp-freeze-recorder.mjs` 里，而那个文件**顶层**有
 * `await record()`。于是验证脚本 `import { summarize }` 一执行，就把录制器也跟着跑起来了
 * —— 实测表现为"验证脚本 300 秒不返回"。纯函数必须与"有顶层副作用的主程序"分开，
 * 否则任何 import 都会继承它的副作用。
 *
 * ## Trace 的两种到达方式
 *
 * - `ProfileChunk`（新版，增量）：`args.data.cpuProfile` 含 nodes/samples；
 * - `Profile`（老格式，一次性）：同上。
 * 两者都摊平成 `id → callFrame`，再按 `samples` 计数。
 *
 * ## 为什么按「函数 + 位置」合并
 *
 * 同一个函数在 V8 里可能有多个 node（内联副本、去优化后的重编译），
 * 不合并就会把一个 60% 的热点拆成十几个 5% 的行，看着像"没有热点"。
 */

export function summarize(events) {
  const nodeById = new Map();
  const sampleCounts = new Map();
  let totalSamples = 0;
  let chunkCount = 0;

  const ingest = (profile) => {
    if (profile === null || typeof profile !== "object") return;
    chunkCount += 1;
    for (const node of profile.nodes ?? []) {
      nodeById.set(node.id, node.callFrame ?? {});
    }
    for (const id of profile.samples ?? []) {
      sampleCounts.set(id, (sampleCounts.get(id) ?? 0) + 1);
      totalSamples += 1;
    }
  };

  for (const event of events) {
    if (event.name === "ProfileChunk" || event.name === "Profile") {
      const data = event.args?.data ?? event.args ?? {};
      ingest(data.cpuProfile ?? data);
    }
  }

  const rows = [];
  for (const [id, count] of sampleCounts) {
    const frame = nodeById.get(id) ?? {};
    rows.push({
      count,
      functionName: frame.functionName === "" || frame.functionName === undefined ? "(anonymous)" : frame.functionName,
      url: frame.url ?? "",
      line: frame.lineNumber,
      column: frame.columnNumber,
    });
  }

  const merged = new Map();
  for (const row of rows) {
    const key = `${row.functionName}\u0000${row.url}\u0000${row.line}:${row.column}`;
    const prev = merged.get(key);
    if (prev === undefined) merged.set(key, { ...row });
    else prev.count += row.count;
  }
  const mergedRows = [...merged.values()].sort((a, b) => b.count - a.count);

  return { totalSamples, chunkCount, nodes: nodeById.size, rows: mergedRows };
}

/** 把分析结果打印成人能读的排行。 */
export function printSummary(summary, limit = 25) {
  console.log(`\n样本总数 ${summary.totalSamples}（chunk ${summary.chunkCount} 个，node ${summary.nodes} 个）`);
  if (summary.totalSamples === 0) {
    console.log("⚠️ 没有样本：可能录制期间页面是空闲的，或分类没开对");
    return;
  }
  console.log("\n按样本数排序（这就是「它在哪个函数里烧 CPU」）：");
  for (const row of summary.rows.slice(0, limit)) {
    const pct = ((row.count / summary.totalSamples) * 100).toFixed(1);
    const where = row.url === "" ? "(native/builtin)" : `${row.url.replace(/^https?:\/\/[^/]+/, "")}:${row.line}:${row.column}`;
    console.log(`  ${String(row.count).padStart(6)}  ${pct.padStart(5)}%  ${row.functionName.padEnd(40)} ${where}`);
  }
}
