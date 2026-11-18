#!/usr/bin/env node
/**
 * 编码器：帧/webm → GIF（README）或 MP4（宣传片）。
 *
 * 两条产线的编码参数是**实测**定的，不是拍的：
 *
 * GIF（README）：
 *   文字满屏的界面 ≈ **300KB/秒**（10fps / 1000 宽 / 128 色，实测 11.8s → 3.7MB）
 *   静态页 ≈ 8KB/秒。GitHub 单文件上限 10MB（官方文档）。
 *   定档 10fps / 1000 宽 / 128 色 / bayer:bayer_scale=3，**硬上限 10MB、预警 6MB**。
 *
 *   为什么预警线是 6MB 而不是更小：试过更省的组合，实测数据（同一段 11.8s 素材）——
 *     8fps/900/64色 → 2.24MB（字边明显糊）；8fps/900/96色 → 2.58MB；10fps/900/96色 → 2.96MB；
 *     10fps/1000/128色 → 3.69MB（定档）；改 dither=none 只省 9%（3.37MB，色带更明显）。
 *   **文字界面在 GIF 里省不下来**，硬压只会让截图看不清——而"看清"是这些图存在的唯一理由。
 *   用户明确要求"该用动图的地方别省"，所以按可读性优先，体积守住 GitHub 的 10MB 硬线即可。
 *
 * MP4（宣传片，Task 0023）：
 *   H.264 + yuv420p（兼容）+ 60fps + faststart（边下边播）。
 *   实测：60s 1080p → 1080p60 用 `-preset veryfast -crf 20` 只要 10.2 秒。
 *
 * 时间轴：CDP 帧序列的帧间隔不均匀（p50 9ms / p99 18ms / max 66ms），
 *   用 `-framerate` 固定值会把停顿平均掉 → 动作节奏与真实不同步。
 *   所以按 `meta.json` 的 timestamp 生成 concat 列表（每帧写自己的显示时长）。
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, statSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

/** 从帧目录 + meta.json 生成 concat 列表（按真实帧间隔）。 */
function writeConcatList(framesDir, metaPath, outPath) {
  const meta = JSON.parse(readFileSync(metaPath, "utf8"));
  const ts = meta.map((entry) => entry.ts);
  const lines = [];
  for (let index = 0; index < meta.length; index += 1) {
    const duration = index + 1 < meta.length ? ts[index + 1] - ts[index] : 1 / 93;
    lines.push(`file '${String(meta[index].i).padStart(6, "0")}.jpg'`);
    lines.push(`duration ${duration.toFixed(6)}`);
  }
  // concat demuxer 要求最后一行重复最后一个文件，否则末帧时长会被丢掉
  lines.push(`file '${String(meta[meta.length - 1].i).padStart(6, "0")}.jpg'`);
  writeFileSync(outPath, lines.join("\n") + "\n");
}


/**
 * 判断某个时间点的画面是不是空白（纯色/几乎无内容）。
 *
 * 为什么需要：`recordVideo` 从 context 创建就开始录，页面加载完成前的 1–2 秒是**白屏**。
 * 直接出片会出现"开头一秒什么都没有"，观众第一眼就走了。
 *
 * 判据：解码该帧为 rgb24，统计不同像素值的种类数。空白页只有一两种（背景色 + 抗锯齿边缘），
 * 真实界面有几百种以上。阈值 24 是实测取的值（白屏 1–3 种、真实界面 300+）。
 */
export function isBlankAt(videoPath, seconds) {
  const raw = execFileSync("ffmpeg", [
    "-v", "error", "-ss", seconds.toFixed(3), "-i", videoPath,
    "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-",
  ], { maxBuffer: 64 * 1024 * 1024 });
  const colors = new Set();
  for (let index = 0; index + 2 < raw.length; index += 3) {
    colors.add((raw[index] << 16) | (raw[index + 1] << 8) | raw[index + 2]);
    if (colors.size > 64) return false;   // 早退：已经够丰富了
  }
  return colors.size < 24;
}

/**
 * 找到第一张**非空白**画面的时间点（从 0 开始按 0.1s 步进探测，最多探 3 秒）。
 * 找不到就返回 0（宁可保留白屏，也不静默截掉内容）。
 */
export function findContentStart(videoPath) {
  for (let seconds = 0; seconds < 3; seconds += 0.1) {
    if (!isBlankAt(videoPath, seconds)) return Number(seconds.toFixed(2));
  }
  return 0;
}

/**
 * 出 GIF。
 * @param {{ webm?: string, framesDir?: string, metaPath?: string, out: string, fps?: number, width?: number, colors?: number }} input
 */
export function encodeGif(input) {
  const { webm, framesDir, metaPath, out, fps = 12, width = 1000, colors = 192, trimStart = 0 } = input;
  mkdirSync(dirname(out), { recursive: true });

  // 输入：webm 直接读；帧序列走 concat（真实时间轴）
  const args = ["-v", "error", "-y"];
  if (trimStart > 0 && webm !== undefined) args.push("-ss", trimStart.toFixed(3));
  if (webm !== undefined) {
    args.push("-i", webm);
  } else {
    const listPath = join(framesDir, "..", "concat.txt");
    writeConcatList(framesDir, metaPath ?? join(framesDir, "..", "meta.json"), listPath);
    args.push("-f", "concat", "-safe", "0", "-i", listPath);
  }

  args.push(
    "-vf",
    [
      `fps=${fps}`,
      `scale=${width}:-2:flags=lanczos`,
      "split[a][b]",
      `[a]palettegen=max_colors=${colors}:stats_mode=diff[p]`,
      "[b][p]paletteuse=dither=bayer:bayer_scale=3",
    ].join(","),
    "-loop", "0",
    out,
  );
  execFileSync("ffmpeg", args, { stdio: "inherit" });

  const bytes = statSync(out).size;
  const mb = bytes / 1024 / 1024;
  if (mb > 10) throw new Error(`GIF 超过 GitHub 单文件上限（${mb.toFixed(2)}MB > 10MB）：${out}`);
  if (mb > 6) console.warn(`⚠ GIF 偏大：${mb.toFixed(2)}MB（预警线 6MB）：${out} —— 先降 fps 再降宽度，别降可读性`);
  return { out, bytes, mb };
}

/**
 * 出 MP4（宣传片）。
 * @param {{ webm?: string, framesDir?: string, metaPath?: string, out: string, fps?: number, width?: number, height?: number, crf?: number, preset?: string }} input
 */
export function encodeMp4(input) {
  const {
    webm, framesDir, metaPath, out,
    fps = 60, width = 1920, height = 1080,
    crf = 20, preset = "veryfast",
  } = input;
  mkdirSync(dirname(out), { recursive: true });

  const args = ["-v", "error", "-y"];
  if (webm !== undefined) {
    args.push("-i", webm);
  } else {
    const listPath = join(framesDir, "..", "concat.txt");
    writeConcatList(framesDir, metaPath ?? join(framesDir, "..", "meta.json"), listPath);
    args.push("-f", "concat", "-safe", "0", "-i", listPath);
  }

  args.push(
    "-vf", `fps=${fps},scale=${width}:${height}:flags=lanczos`,
    "-c:v", "libx264", "-preset", preset, "-crf", String(crf),
    "-pix_fmt", "yuv420p",
    "-movflags", "+faststart",
    out,
  );
  execFileSync("ffmpeg", args, { stdio: "inherit" });
  return { out, bytes: statSync(out).size };
}

/** 静态图：PNG → webp（README 静态图，1440 宽）。cwebp 缺失时退回 ffmpeg。 */
export function encodeWebp(pngPath, outPath, width = 1440) {
  mkdirSync(dirname(outPath), { recursive: true });
  try {
    execFileSync("cwebp", ["-quiet", "-q", "84", "-resize", String(width), "0", pngPath, "-o", outPath]);
  } catch {
    execFileSync("ffmpeg", ["-v", "error", "-y", "-i", pngPath, "-vf", `scale=${width}:-2`, outPath]);
  }
  return { out: outPath, bytes: statSync(outPath).size };
}
