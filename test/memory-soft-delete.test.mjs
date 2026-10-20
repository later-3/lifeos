import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readDeletions, writeDeletions, expiredIds, hiddenIds, SOFT_DELETE_RETENTION_DAYS } from "../src/memory/soft-delete.ts";

test("软删清单：写入/读回、隐藏集合", async () => {
  const root = await mkdtemp(join(tmpdir(), "lifeos-memory-del-"));
  assert.deepEqual(await readDeletions(root), {});
  await writeDeletions(root, { tr_a: "2026-10-01T00:00:00.000Z" });
  const map = await readDeletions(root);
  assert.deepEqual([...hiddenIds(map)], ["tr_a"]);
});

test("保留期：满 30 天之后才 purge（边界当天仍可恢复）", () => {
  const now = Date.parse("2026-10-31T00:00:00.000Z");
  const day = 86400_000;
  const map = {
    old: new Date(now - (SOFT_DELETE_RETENTION_DAYS + 1) * day).toISOString(),
    edge: new Date(now - SOFT_DELETE_RETENTION_DAYS * day).toISOString(),
    fresh: new Date(now - 5 * day).toISOString(),
  };
  assert.deepEqual(expiredIds(map, now), ["old"], "30 天当天不算过期");
  assert.deepEqual(expiredIds(map, now, 1).sort(), ["edge", "fresh", "old"]);
  assert.deepEqual(expiredIds({}, now), []);
});
