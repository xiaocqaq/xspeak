/**
 * 上行降采样到底毁掉了多少 —— 把前端那段 downsample 原样搬过来喂给识别接口。
 *
 * probe-en-asr.mjs 已经排除了「识别模型在做语音翻译」：干净英文音频，
 * 裸调 / language / prompt 四种打法全部准确转回英文。那问题只能在
 * 「麦克风 → 上游」这段路上。
 *
 * 前端 useVoiceChat.ts 的 downsample() 有两个可疑点：
 *   1. 没有抗混叠滤波。设备一般给 48000，上游要 16000，3 倍抽取会把
 *      8kHz 以上的能量整体折回可听带内。英文的 s / sh / f / th 恰好把
 *      大部分能量放在 4–10kHz —— 折回来就是一片糊在元音上的噪声。
 *   2. 按 ScriptProcessor 的每块 4096 帧独立调用。4096/3 = 1365.33，
 *      每块尾部丢掉零点几个样本、下一块相位从 0 重来，每 85ms 一个小断点。
 *
 * 所以对照四条路，音频内容完全相同，只有重采样方式不同：
 *   A 48k 原样（不降采样，直接让识别接口收 48k）—— 上限参考
 *   B 前端现状：逐块 4096 帧 + 裸线性插值
 *   C 裸线性插值，但整段连续做 —— 单独拆出「分块」这个因素
 *   D 先低通再抽取（加窗 sinc FIR）—— 候选修法
 *
 * B 明显比 C/D 差 → 分块是主因；C 也差而 D 好 → 混叠是主因。
 *
 * 用法：node scripts/probe-resample.mjs
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
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
const { INPUT_SAMPLE_RATE } = await import(path.join(ROOT, 'src/lib/realtime/protocol.mjs'));
const CFG = voiceConfig();
if (!CFG.apiKey) { console.error('缺少 key'); process.exit(1); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 浏览器里最常见的麦克风采样率，也是最坏的抽取比（48000/16000 = 3）。 */
const DEVICE_RATE = 48_000;
/** ScriptProcessor 的块大小，和 useVoiceChat.ts 里 createScriptProcessor(4096,…) 一致。 */
const BLOCK = 4096;

/* ------------------------------ wav / TTS ------------------------------ */

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

function pcmToFloat(data) {
  const n = data.length / 2;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = data.readInt16LE(i * 2) / 0x8000;
  return out;
}

function floatToPcm(f) {
  const out = Buffer.alloc(f.length * 2);
  for (let i = 0; i < f.length; i++) {
    const v = Math.max(-1, Math.min(1, f[i]));
    out.writeInt16LE(Math.round(v * 0x7fff), i * 2);
  }
  return out;
}

function toWav(pcm, rate) {
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

async function ttsFloat(text) {
  const res = await fetch(CFG.ttsUrl, {
    method: 'POST',
    headers: { Authorization: `Bearer ${CFG.apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model: CFG.ttsModel, input: text, voice: CFG.defaultVoice, response_format: 'wav' }),
  });
  if (!res.ok) throw new Error(`TTS ${res.status} ${(await res.text()).slice(0, 200)}`);
  const { rate, bits, ch, data } = parseWav(Buffer.from(await res.arrayBuffer()));
  if (bits !== 16 || ch !== 1) throw new Error('TTS 不是单声道 16bit');
  return { f: pcmToFloat(data), rate };
}

/* ------------------------------ 重采样几种打法 ------------------------------ */

/** 前端 useVoiceChat.ts 的 downsample()，一字不改地抄过来。 */
function downsample(input, from, to) {
  if (from === to) return input;
  const ratio = from / to;
  const len = Math.floor(input.length / ratio);
  const out = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    const pos = i * ratio;
    const idx = Math.floor(pos);
    const frac = pos - idx;
    const a = input[idx] ?? 0;
    const b = input[idx + 1] ?? a;
    out[i] = a + (b - a) * frac;
  }
  return out;
}

/** 升采样，用来把 TTS 的原生采样率抬到设备常见的 48000。 */
function upTo(input, from, to) {
  if (from === to) return input;
  const len = Math.floor((input.length * to) / from);
  const out = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    const pos = (i * from) / to;
    const idx = Math.floor(pos);
    const frac = pos - idx;
    const a = input[idx] ?? 0;
    const b = input[idx + 1] ?? a;
    out[i] = a + (b - a) * frac;
  }
  return out;
}

/** B：完全复刻线上行为 —— 每 4096 帧一块，各自独立降采样后拼起来。 */
function blockwise(input, from, to, block) {
  const parts = [];
  let total = 0;
  for (let i = 0; i < input.length; i += block) {
    const p = downsample(input.subarray(i, i + block), from, to);
    parts.push(p);
    total += p.length;
  }
  const out = new Float32Array(total);
  let off = 0;
  for (const p of parts) { out.set(p, off); off += p.length; }
  return out;
}

/** 加窗 sinc 低通，截止略低于目标 Nyquist。 */
function lowpassKernel(cutoffHz, rate, taps) {
  const n = taps % 2 ? taps : taps + 1;
  const mid = (n - 1) / 2;
  const fc = cutoffHz / rate; // 归一化截止频率（周期/样本）
  const k = new Float64Array(n);
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const x = i - mid;
    const sinc = x === 0 ? 2 * fc : Math.sin(2 * Math.PI * fc * x) / (Math.PI * x);
    const w = 0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (n - 1)); // Hamming
    k[i] = sinc * w;
    sum += k[i];
  }
  for (let i = 0; i < n; i++) k[i] /= sum; // 直流增益归一
  return k;
}

/** D：先低通再抽取。 */
function filteredDecimate(input, from, to) {
  if (from === to) return input;
  const ratio = from / to;
  const kernel = lowpassKernel(to * 0.45, from, 63); // 16000*0.45 = 7200Hz
  const mid = (kernel.length - 1) / 2;
  const len = Math.floor(input.length / ratio);
  const out = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    const center = Math.round(i * ratio);
    let acc = 0;
    for (let j = 0; j < kernel.length; j++) {
      const idx = center + j - mid;
      if (idx < 0 || idx >= input.length) continue;
      acc += input[idx] * kernel[j];
    }
    out[i] = acc;
  }
  return out;
}

/* ------------------------------ 识别 ------------------------------ */

async function httpAsr(pcm, rate) {
  const url = 'https://api.stepfun.com/v1/audio/transcriptions';
  const fd = new FormData();
  fd.set('model', CFG.asrModel);
  fd.set('response_format', 'json');
  fd.set('file', new Blob([toWav(pcm, rate)], { type: 'audio/wav' }), 'a.wav');
  const res = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${CFG.apiKey}` }, body: fd });
  const text = await res.text();
  if (!res.ok) return `HTTP ${res.status}: ${text.slice(0, 200)}`;
  try { return JSON.parse(text).text; } catch { return text.slice(0, 200); }
}

/* -------------------------------- 跑 -------------------------------- */

// 挑一句摩擦音多的：s / sh / th / f 都在 4kHz 以上，混叠最先毁掉的就是它们
const EN = 'She thinks this fresh fish soup is something special, and she wishes she could finish it.';

const { f: src, rate: srcRate } = await ttsFloat(EN);
console.log(`测试句：「${EN}」`);
console.log(`TTS 原生采样率 ${srcRate}Hz，${(src.length / srcRate).toFixed(2)}s`);

const dev = upTo(src, srcRate, DEVICE_RATE);
console.log(`升到设备常见的 ${DEVICE_RATE}Hz：${dev.length} 样本（抽取比 ${DEVICE_RATE / INPUT_SAMPLE_RATE}）\n`);

const variants = [
  { label: 'A 48k 原样（不降采样，上限参考）', f: dev, rate: DEVICE_RATE },
  { label: 'B 线上现状：逐块 4096 + 裸线性', f: blockwise(dev, DEVICE_RATE, INPUT_SAMPLE_RATE, BLOCK), rate: INPUT_SAMPLE_RATE },
  { label: 'C 裸线性，但整段连续做', f: downsample(dev, DEVICE_RATE, INPUT_SAMPLE_RATE), rate: INPUT_SAMPLE_RATE },
  { label: 'D 先低通再抽取（候选修法）', f: filteredDecimate(dev, DEVICE_RATE, INPUT_SAMPLE_RATE), rate: INPUT_SAMPLE_RATE },
];

for (const v of variants) {
  const pcm = floatToPcm(v.f);
  const file = `/tmp/probe-rs-${v.label[0]}.wav`;
  writeFileSync(file, toWav(pcm, v.rate));
  const t = await httpAsr(pcm, v.rate);
  console.log(`── ${v.label} ──`);
  console.log(`  ${v.f.length} 样本 @ ${v.rate}Hz → ${file}`);
  console.log(`  转写: ${JSON.stringify(t)}\n`);
  await sleep(1500);
}
