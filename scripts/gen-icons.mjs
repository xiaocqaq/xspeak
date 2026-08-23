/**
 * 生成 PWA 图标，零依赖 —— 手写最小 PNG 编码器（zlib 来自 node:zlib）。
 * 图案：暖底 + 圆角方块 + 一个"林"字骨架笔画（用像素矩形拼，不需要字体）。
 *
 * 用法：npm run icons
 */

import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');

const BG = [250, 249, 247];
const CARD = [37, 99, 235]; // brand-600
const INK = [255, 255, 255];

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** rgba: Uint8Array，长度 w*h*4 */
function encodePng(w, h, rgba) {
  const stride = w * 4;
  const raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function makeCanvas(size, bg) {
  const px = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    px[i * 4] = bg[0];
    px[i * 4 + 1] = bg[1];
    px[i * 4 + 2] = bg[2];
    px[i * 4 + 3] = 255;
  }
  return px;
}

function rect(px, size, x0, y0, w, h, color) {
  for (let y = Math.max(0, Math.round(y0)); y < Math.min(size, Math.round(y0 + h)); y++) {
    for (let x = Math.max(0, Math.round(x0)); x < Math.min(size, Math.round(x0 + w)); x++) {
      const i = (y * size + x) * 4;
      px[i] = color[0];
      px[i + 1] = color[1];
      px[i + 2] = color[2];
      px[i + 3] = 255;
    }
  }
}

function roundedRect(px, size, x0, y0, w, h, r, color) {
  for (let y = Math.round(y0); y < Math.round(y0 + h); y++) {
    for (let x = Math.round(x0); x < Math.round(x0 + w); x++) {
      if (x < 0 || y < 0 || x >= size || y >= size) continue;
      const dx = Math.min(x - x0, x0 + w - 1 - x);
      const dy = Math.min(y - y0, y0 + h - 1 - y);
      if (dx < r && dy < r) {
        const d = Math.hypot(r - dx, r - dy);
        if (d > r) continue;
      }
      const i = (y * size + x) * 4;
      px[i] = color[0];
      px[i + 1] = color[1];
      px[i + 2] = color[2];
      px[i + 3] = 255;
    }
  }
}

/** 斜笔画：从 (x1,y1) 到 (x2,y2) 画一条粗线 */
function stroke(px, size, x1, y1, x2, y2, thick, color) {
  const steps = Math.ceil(Math.hypot(x2 - x1, y2 - y1) * 2);
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    rect(px, size, x1 + (x2 - x1) * t - thick / 2, y1 + (y2 - y1) * t - thick / 2, thick, thick, color);
  }
}

/**
 * 画"林"：左右两个"木"。每个木 = 一横 + 一竖 + 左右两撇。
 * 手摆坐标，比引字体依赖省事得多。
 */
function drawLin(px, size, x0, y0, w, h, color) {
  const t = Math.max(2, Math.round(w * 0.055)); // 笔画粗细
  const mu = w * 0.46; // 单个木的宽度
  for (const side of [0, 1]) {
    const bx = x0 + side * (w - mu);
    rect(px, size, bx, y0 + h * 0.28, mu, t, color); // 横
    rect(px, size, bx + mu / 2 - t / 2, y0, t, h, color); // 竖
    stroke(px, size, bx + mu / 2 - t * 0.4, y0 + h * 0.42, bx + t, y0 + h * 0.95, t, color); // 左撇
    stroke(px, size, bx + mu / 2 + t * 0.4, y0 + h * 0.42, bx + mu - t, y0 + h * 0.95, t, color); // 右捺
  }
}

function icon(size, { maskable = false } = {}) {
  const px = makeCanvas(size, maskable ? CARD : BG);
  if (!maskable) {
    const pad = Math.round(size * 0.08);
    roundedRect(px, size, pad, pad, size - pad * 2, size - pad * 2, Math.round(size * 0.22), CARD);
  }
  // maskable 要留 safe zone：内容缩在中间 60%
  const inset = maskable ? size * 0.28 : size * 0.24;
  const w = size - inset * 2;
  drawLin(px, size, inset, inset + w * 0.08, w, w * 0.84, INK);
  return encodePng(size, size, px);
}

mkdirSync(OUT, { recursive: true });
const files = [
  ['icon-192.png', icon(192)],
  ['icon-512.png', icon(512)],
  ['icon-maskable-512.png', icon(512, { maskable: true })],
  ['apple-touch-icon.png', icon(180)],
];
for (const [name, buf] of files) {
  writeFileSync(join(OUT, name), buf);
  console.log(`✓ public/icons/${name}  ${(buf.length / 1024).toFixed(1)} KB`);
}
