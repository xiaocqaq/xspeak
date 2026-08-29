/**
 * 补测两处上一轮没跑完的：截断开头、以及极短的应答词。
 *
 * 为什么单独跑：独立 ASR 接口限 10 RPM，上一轮末尾三档全撞了限流。
 * 这里每次间隔 7s，宁可慢也要拿到结果。
 *
 * 极短应答词是重点。前面测的都是完整长句，信息量足够模型确定语言；
 * 学生实际说的很多是 "Yeah" "Me too" "I see" —— 一两个音节，
 * 中文为主的识别模型在这种输入上最容易按中文猜（"Yeah" → "耶"）。
 * VAD 的 minSpeechMs 是 350ms，这类词刚好在下限附近。
 *
 * 用法：node scripts/probe-asr-short.mjs
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

function parseWav(buf) {
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

/** Int16 buffer → Float32 数组，加工都在浮点域做。 */
function toFloat(data) {
  const n = data.length / 2;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = data.readInt16LE(i * 2) / 32768;
  return out;
}

function toWav(f32, rate) {
  const pcm = Buffer.alloc(f32.length * 2);
  for (let i = 0; i < f32.length; i++) {
    const v = Math.max(-1, Math.min(1, f32[i]));
    pcm.writeInt16LE(Math.round(v * 32767), i * 2);
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

async function ttsFloat(text) {
  const res = await fetch(CFG.ttsUrl, {
    method: 'POST',
    headers: { Authorization: `Bearer ${CFG.apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model: CFG.ttsModel, input: text, voice: CFG.defaultVoice, response_format: 'wav' }),
  });
  if (!res.ok) throw new Error(`TTS ${res.status} ${(await res.text()).slice(0, 200)}`);
  const { rate, data } = parseWav(Buffer.from(await res.arrayBuffer()));
  return { f32: toFloat(data), rate };
}

async function asr(f32, rate) {
  const fd = new FormData();
  fd.set('model', CFG.asrModel);
  fd.set('response_format', 'json');
  fd.set('file', new Blob([toWav(f32, rate)], { type: 'audio/wav' }), 'a.wav');
  const res = await fetch('https://api.stepfun.com/v1/audio/transcriptions', {
    method: 'POST', headers: { Authorization: `Bearer ${CFG.apiKey}` }, body: fd,
  });
  const t = await res.text();
  if (!res.ok) return `HTTP ${res.status}: ${JSON.parse(t)?.error?.message ?? t.slice(0, 120)}`;
  try { return JSON.parse(t).text; } catch { return t.slice(0, 120); }
}

/* -------------------------------- 跑 -------------------------------- */

// 极短应答词：学生实际最常说的那批
const SHORTS = ['Yeah.', 'Me too.', 'I see.', 'Okay, sure.', 'Not really.'];
const LONG = 'I think we should talk about this problem tomorrow morning.';

const rows = [];
async function run(label, f32, rate) {
  const text = await asr(f32, rate);
  const zh = hasChinese(text);
  rows.push({ label, zh, text });
  console.log(`  ${zh ? '★中文' : ' 英文'}  ${label.padEnd(28)} ${JSON.stringify(text)}`);
  await sleep(7000); // 10 RPM，留足余量
}

console.log('── 极短应答词 ──');
for (const s of SHORTS) {
  const { f32, rate } = await ttsFloat(s);
  await run(`${s} (${(f32.length / rate).toFixed(2)}s)`, f32, rate);
}

console.log('\n── 截断开头（VAD 前导没补够时的样子）──');
{
  const { f32, rate } = await ttsFloat(LONG);
  for (const ms of [150, 250, 400]) {
    const cut = f32.subarray(Math.round((rate * ms) / 1000));
    await run(`吃掉开头 ${ms}ms`, cut, rate);
  }
}

const bad = rows.filter((r) => r.zh);
console.log(`\n${rows.length} 档里 ${bad.length} 档转成了中文。`);
if (bad.length) for (const b of bad) console.log(`  ★ ${b.label} → ${JSON.stringify(b.text)}`);
