/**
 * 干净英文能准确转写（probe-en-asr.mjs / probe-resample.mjs 已证），
 * 可学生实际用的时候「英文被识别成中文」。差别只能在输入质量上。
 *
 * 这里的问题：stepaudio-2.5-asr 是中文为主的模型。假设是——
 * 输入一旦模糊（片段太短、音量太小、底噪大、被削顶），它没有足够证据判定英文，
 * 就按中文先验去猜，于是吐出一串和原句无关的中文。
 *
 * 逐项复现线上真实会遇到的退化，看转写在哪一档翻成中文：
 *   short   VAD 只要 350ms 就提交，一个词的片段是常态
 *   quiet   笔记本内置麦 + autoGainControl 没跟上，波形很小
 *   noisy   房间底噪、风扇、空调
 *   clipped 离麦太近，削顶
 *   头尾截断 preroll 只有 3 片（约 256ms），开口辅音仍可能吃掉
 *
 * 用法：node scripts/probe-asr-fallback.mjs
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const ROOT = path.resolve(HERE, '..');

const envFile = path.join(ROOT, '.env.local');
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    if (process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim().replace(/^["'](.*)["']$/, '$1');
  }
}

const { voiceConfig } = await import(path.join(ROOT, 'src/lib/voice/config.mjs'));
const { INPUT_SAMPLE_RATE, hasChinese } = await import(path.join(ROOT, 'src/lib/realtime/protocol.mjs'));
const CFG = voiceConfig();
if (!CFG.apiKey) { console.error('缺少 key'); process.exit(1); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------ wav 工具 ------------------------------ */

function parseWav(buf) {
  if (buf.toString('ascii', 0, 4) !== 'RIFF') throw new Error('不是 wav');
  let off = 12, rate = 0, bits = 16, ch = 1, data = null;
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    if (id === 'fmt ') { ch = buf.readUInt16LE(off + 10); rate = buf.readUInt32LE(off + 12); bits = buf.readUInt16LE(off + 22); }
    if (id === 'data') { data = buf.subarray(off + 8, off + 8 + size); break; }
    off += 8 + size + (size % 2);
  }
  if (!data) throw new Error('没有 data 块');
  return { rate, bits, ch, data };
}

function toFloat(data) {
  const n = data.length / 2;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = data.readInt16LE(i * 2) / 0x8000;
  return out;
}

function toWav(f32, rate) {
  const pcm = Buffer.alloc(f32.length * 2);
  for (let i = 0; i < f32.length; i++) {
    const v = Math.max(-1, Math.min(1, f32[i]));
    pcm.writeInt16LE(Math.round(v * 0x7fff), i * 2);
  }
  const head = Buffer.alloc(44);
  head.write('RIFF', 0);
  head.writeUInt32LE(36 + pcm.length, 4);
  head.write('WAVE', 8);
  head.write('fmt ', 12);
  head.writeUInt32LE(16, 16);
  head.writeUInt16LE(1, 20);
  head.writeUInt16LE(1, 22);
  head.writeUInt32LE(rate, 24);
  head.writeUInt32LE(rate * 2, 28);
  head.writeUInt16LE(2, 32);
  head.writeUInt16LE(16, 34);
  head.write('data', 36);
  head.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([head, pcm]);
}

/** 整段连续线性重采样。 */
function resample(input, from, to) {
  if (from === to) return input;
  const outN = Math.floor((input.length * to) / from);
  const out = new Float32Array(outN);
  for (let i = 0; i < outN; i++) {
    const pos = (i * from) / to;
    const i0 = Math.floor(pos), frac = pos - i0;
    const a = input[Math.min(i0, input.length - 1)];
    const b = input[Math.min(i0 + 1, input.length - 1)];
    out[i] = a + (b - a) * frac;
  }
  return out;
}

async function ttsFloat(text) {
  const res = await fetch(CFG.ttsUrl, {
    method: 'POST',
    headers: { Authorization: `Bearer ${CFG.apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model: CFG.ttsModel, input: text, voice: CFG.defaultVoice, response_format: 'wav' }),
  });
  if (!res.ok) throw new Error(`TTS ${res.status} ${(await res.text()).slice(0, 200)}`);
  const { rate, bits, ch, data } = parseWav(Buffer.from(await res.arrayBuffer()));
  if (bits !== 16 || ch !== 1) throw new Error('TTS 不是单声道 16bit');
  return resample(toFloat(data), rate, INPUT_SAMPLE_RATE);
}

async function asr(f32) {
  const fd = new FormData();
  fd.set('model', CFG.asrModel);
  fd.set('response_format', 'json');
  fd.set('file', new Blob([toWav(f32, INPUT_SAMPLE_RATE)], { type: 'audio/wav' }), 'a.wav');
  const res = await fetch('https://api.stepfun.com/v1/audio/transcriptions', {
    method: 'POST', headers: { Authorization: `Bearer ${CFG.apiKey}` }, body: fd,
  });
  const text = await res.text();
  if (!res.ok) return `HTTP ${res.status}: ${text.slice(0, 160)}`;
  try { return JSON.parse(text).text; } catch { return text.slice(0, 160); }
}

/* ------------------------------ 各档退化 ------------------------------ */

const gain = (f, g) => f.map((v) => v * g);

function addNoise(f, snrDb) {
  let p = 0;
  for (const v of f) p += v * v;
  p /= f.length;
  const np = p / 10 ** (snrDb / 10);
  const amp = Math.sqrt(np * 3); // 均匀噪声方差 = amp²/3
  return f.map((v) => v + (Math.random() * 2 - 1) * amp);
}

const clip = (f, at) => f.map((v) => Math.max(-at, Math.min(at, v)) / at);
const headMs = (f, ms) => f.subarray(0, Math.floor((ms / 1000) * INPUT_SAMPLE_RATE));
/** 砍掉开头 n 毫秒，模拟 preroll 不够、开口辅音被吃 */
const dropHead = (f, ms) => f.subarray(Math.floor((ms / 1000) * INPUT_SAMPLE_RATE));

/* -------------------------------- 跑 -------------------------------- */

const SENT = 'I think we should talk about this problem tomorrow morning.';
const SHORT = 'Yes, I think so.';

console.log(`长句：「${SENT}」`);
console.log(`短句：「${SHORT}」\n`);
const full = await ttsFloat(SENT);
await sleep(1200);
const short = await ttsFloat(SHORT);
console.log(`长句 ${(full.length / INPUT_SAMPLE_RATE).toFixed(2)}s，短句 ${(short.length / INPUT_SAMPLE_RATE).toFixed(2)}s\n`);

const cases = [
  ['基准：长句原样', full],
  ['基准：短句原样', short],
  ['短片段 400ms（VAD 下限附近）', headMs(full, 400)],
  ['短片段 700ms', headMs(full, 700)],
  ['短片段 1200ms', headMs(full, 1200)],
  ['音量 ×0.08（内置麦很小）', gain(full, 0.08)],
  ['音量 ×0.02（几乎听不见）', gain(full, 0.02)],
  ['底噪 SNR 15dB', addNoise(full, 15)],
  ['底噪 SNR 8dB', addNoise(full, 8)],
  ['底噪 SNR 3dB', addNoise(full, 3)],
  ['削顶 0.15（离麦太近）', clip(full, 0.15)],
  ['吃掉开头 250ms', dropHead(full, 250)],
  ['短句 + SNR 8dB', addNoise(short, 8)],
  ['短句 + 音量 ×0.05', gain(short, 0.05)],
];

let zhCount = 0;
for (const [label, audio] of cases) {
  const t = await asr(audio);
  const zh = hasChinese(t);
  if (zh) zhCount++;
  console.log(`${zh ? '【中文】' : '  英文  '} ${label.padEnd(30, ' ')} ${JSON.stringify(t)}`);
  await sleep(1500);
}

console.log(`\n${cases.length} 档里 ${zhCount} 档转成了中文。`);
