/**
 * 摸清「把学生的语音输入限定成英文」有哪些抓手。
 *
 * 三件事分开测，因为它们的失败方式不一样：
 *   A. session.update 的 input_audio_transcription 能不能带 language: 'en'
 *      —— 上游不认的字段通常静默丢弃，所以不能只看有没有报错，要看后面的转写变化。
 *   B. 喂一段中文语音进去，现在会转写成什么、AI 会怎么答。
 *      测试音频用 TTS 合成（realtime 没法让我自己说话），wav 拿回来再降采样到上行的 16000。
 *   C. 带上 language: 'en' 之后，同一段中文语音的转写会不会变。
 *
 * 用法：node scripts/probe-input-lang.mjs
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { WebSocket } from 'ws';

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

let seq = 0;
const eid = () => `e${Date.now().toString(36)}${(seq++).toString(36)}`;

/* ---------- 造测试音频：TTS 合成中文，再降采样到 16000 ---------- */

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

/** 线性重采样，和前端 downsample 一个思路。 */
function resample16(data, from, to) {
  const n = data.length / 2;
  if (from === to) return Buffer.from(data);
  const outN = Math.floor((n * to) / from);
  const out = Buffer.alloc(outN * 2);
  for (let i = 0; i < outN; i++) {
    const pos = (i * from) / to;
    const i0 = Math.floor(pos), frac = pos - i0;
    const a = data.readInt16LE(Math.min(i0, n - 1) * 2);
    const b = data.readInt16LE(Math.min(i0 + 1, n - 1) * 2);
    out.writeInt16LE(Math.round(a + (b - a) * frac), i * 2);
  }
  return out;
}

async function ttsPcm(text) {
  const res = await fetch(CFG.ttsUrl, {
    method: 'POST',
    headers: { Authorization: `Bearer ${CFG.apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model: CFG.ttsModel, input: text, voice: CFG.defaultVoice, response_format: 'wav' }),
  });
  if (!res.ok) throw new Error(`TTS ${res.status} ${(await res.text()).slice(0, 200)}`);
  const wav = Buffer.from(await res.arrayBuffer());
  const { rate, bits, ch } = parseWav(wav);
  const { data } = parseWav(wav);
  console.log(`  TTS 返回 wav：${rate}Hz ${bits}bit ${ch}ch，${data.length} 字节`);
  if (bits !== 16 || ch !== 1) throw new Error('TTS 不是单声道 16bit，得另想办法');
  return resample16(data, rate, INPUT_SAMPLE_RATE);
}

/* ---------- 跑一轮会话 ---------- */

function runOnce({ label, transcription, spokenPcm }) {
  return new Promise((resolve) => {
    const out = { label, sessionEcho: null, error: null, transcript: null, assistant: '', audioBytes: 0 };
    const ws = new WebSocket(`${CFG.realtimeUrl}?model=${encodeURIComponent(CFG.realtimeModel)}`, {
      headers: { Authorization: `Bearer ${CFG.apiKey}` },
    });
    const timer = setTimeout(() => { try { ws.close(); } catch {} resolve(out); }, 60_000);
    const fin = () => { clearTimeout(timer); try { ws.close(); } catch {} resolve(out); };

    ws.on('open', () => {
      ws.send(JSON.stringify({
        event_id: eid(), type: 'session.update',
        session: {
          modalities: ['text', 'audio'],
          instructions: 'You are a friendly English tutor helping a Chinese learner practice spoken English. Reply in English only, one or two short sentences.',
          voice: CFG.defaultVoice,
          input_audio_format: 'pcm16',
          output_audio_format: 'pcm16',
          input_audio_transcription: transcription,
        },
      }));
    });

    ws.on('message', (raw) => {
      let ev; try { ev = JSON.parse(String(raw)); } catch { return; }
      if (ev.type === 'session.updated') {
        out.sessionEcho = ev.session?.input_audio_transcription ?? '(没回显)';
        // 按 100ms 一片发上去，和前端一样
        const CHUNK = (INPUT_SAMPLE_RATE / 10) * 2;
        for (let i = 0; i < spokenPcm.length; i += CHUNK) {
          ws.send(JSON.stringify({
            event_id: eid(), type: 'input_audio_buffer.append',
            audio: spokenPcm.subarray(i, i + CHUNK).toString('base64'),
          }));
        }
        ws.send(JSON.stringify({ event_id: eid(), type: 'input_audio_buffer.commit' }));
        ws.send(JSON.stringify({ event_id: eid(), type: 'response.create' }));
      }
      if (ev.type === 'conversation.item.input_audio_transcription.completed') out.transcript = ev.transcript;
      if (ev.type === 'response.audio_transcript.delta') out.assistant += String(ev.delta ?? '');
      if (ev.type === 'response.audio.delta') out.audioBytes += Buffer.from(String(ev.delta ?? ''), 'base64').length;
      if (ev.type === 'response.done') fin();
      if (ev.type === 'error') { out.error = ev.error?.message ?? JSON.stringify(ev); fin(); }
    });
    ws.on('error', (e) => { out.error = e.message; fin(); });
  });
}

const ZH = '你好，我今天想聊聊我的工作，可以吗？';
console.log(`合成中文测试音频：「${ZH}」`);
const zhPcm = await ttsPcm(ZH);
writeFileSync('/tmp/probe-zh-16k.pcm', zhPcm);
console.log(`  降采样到 ${INPUT_SAMPLE_RATE}Hz：${zhPcm.length} 字节（${(zhPcm.length / 2 / INPUT_SAMPLE_RATE).toFixed(2)}s）\n`);

const cases = [
  { label: 'B 现状：只给 model', transcription: { model: CFG.asrModel } },
  { label: 'C 加 language: en', transcription: { model: CFG.asrModel, language: 'en' } },
];

for (const c of cases) {
  console.log(`── ${c.label} ──`);
  const r = await runOnce({ ...c, spokenPcm: zhPcm });
  console.log(`  session 回显 input_audio_transcription: ${JSON.stringify(r.sessionEcho)}`);
  console.log(`  学生转写: ${JSON.stringify(r.transcript)}`);
  console.log(`  AI 回复: ${JSON.stringify(r.assistant.slice(0, 200))}`);
  console.log(`  音频 ${r.audioBytes} 字节${r.error ? `\n  错误: ${r.error}` : ''}\n`);
  await new Promise((r2) => setTimeout(r2, 3000)); // 避开连续建连限流
}
