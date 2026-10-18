import { inflateSync } from "node:zlib";

/**
 * 极简 PNG 解码 + 像素比对（截图基线的容差比较）。
 *
 * 为什么不用字节相等：同一台机器上每次新起 chromium，文字抗锯齿/光栅化会有 1px 级抖动，
 * 字节比较会把"完全一样的设计"判成变化（实测同一页面两次 66457 vs 66460 字节）。
 * 像素比对比字节比较稳，且能给出"变了多少"的可读数字。
 */
function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

export function decodePng(buffer) {
  if (buffer.readUInt32BE(0) !== 0x89504e47) throw new Error("不是 PNG");
  let offset = 8;
  let width = 0, height = 0, colorType = 6, bitDepth = 8;
  const idat = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data.readUInt8(8);
      colorType = data.readUInt8(9);
      if (bitDepth !== 8 || (colorType !== 6 && colorType !== 2)) throw new Error(`不支持的 PNG 格式 bitDepth=${bitDepth} colorType=${colorType}`);
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") {
      break;
    }
    offset += 12 + length;
  }
  const channels = colorType === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const pixels = Buffer.alloc(height * stride);
  let position = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = raw[position];
    position += 1;
    const row = raw.subarray(position, position + stride);
    position += stride;
    const out = pixels.subarray(y * stride, (y + 1) * stride);
    const previous = y === 0 ? null : pixels.subarray((y - 1) * stride, y * stride);
    for (let x = 0; x < stride; x += 1) {
      const left = x >= channels ? out[x - channels] : 0;
      const up = previous === null ? 0 : previous[x];
      const upLeft = previous === null || x < channels ? 0 : previous[x - channels];
      const value = row[x];
      out[x] = filter === 0 ? value
        : filter === 1 ? (value + left) & 0xff
        : filter === 2 ? (value + up) & 0xff
        : filter === 3 ? (value + ((left + up) >> 1)) & 0xff
        : (value + paeth(left, up, upLeft)) & 0xff;
    }
  }
  return { width, height, channels, pixels };
}

/** 返回差异像素占比（0–1）与最大单通道差。 */
export function pixelDiff(before, after, tolerance = 8) {
  const a = decodePng(before);
  const b = decodePng(after);
  if (a.width !== b.width || a.height !== b.height) return { ratio: 1, maxDelta: 255, note: `尺寸不同 ${a.width}×${a.height} vs ${b.width}×${b.height}` };
  let changed = 0;
  let maxDelta = 0;
  for (let index = 0; index < a.pixels.length; index += a.channels) {
    let delta = 0;
    for (let channel = 0; channel < 3; channel += 1) {
      delta = Math.max(delta, Math.abs(a.pixels[index + channel] - b.pixels[index + channel]));
    }
    if (delta > tolerance) changed += 1;
    if (delta > maxDelta) maxDelta = delta;
  }
  return { ratio: changed / (a.width * a.height), maxDelta };
}
