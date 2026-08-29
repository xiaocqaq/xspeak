/**
 * 学生说英文，转写却回中文 —— 摸清是哪一层的问题。
 *
 * 两种可能，修法完全不同，所以要先分开：
 *   1. 识别模型在做「语音翻译」：听懂了英文，但按中文输出。
 *      → 转写会是那句英文的准确中文意思，字面对得上。
 *   2. 音频太糊，认不出英文，模型按中文猜。
 *      → 转写会是和原句毫无关系的中文。
 *
 * 顺带测三个可能的抓手（都是上游不认就静默丢弃的字段，只能看转写变化来判）：
 *   - input_audio_transcription.prompt：给识别层一句提示词
 *   - input_audio_transcription.language：已知被忽略（probe-input-lang.mjs 实测），
 *     这里再跑一次是为了和英文输入的情况对齐，排除「只对中文输入无效」
 *   - 独立的 /v1/audio/transcriptions 接口：realtime 之外的另一条路，
 *     如果它认 language 而 realtime 不认，说明限制在 realtime 会话层
 *
 * 测试音频用 TTS 合成（脚本里没法自己说话）。这是干净音频，
 * 所以如果连它都被转成中文，问题一定在识别模型，不在麦克风。
 *
 * 用法：node scripts/probe-en-asr.mjs
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------------------------- 造测试音频 ---------------------------- */

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

/** 裸 PCM16 包成 wav，独立 ASR 接口要文件。 */
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

async function ttsPcm(text, voice) {
  const res = await fetch(CFG.ttsUrl, {
    method: 'POST',
    headers: { Authorization: `Bearer ${CFG.apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model: CFG.ttsModel, input: text, voice: voice ?? CFG.defaultVoice, response_format: 'wav' }),
  });
  if (!res.ok) throw new Error(`TTS ${res.status} ${(await res.text()).slice(0, 200)}`);
  const wav = Buffer.from(await res.arrayBuffer());
  const { rate, bits, ch, data } = parseWav(wav);
  if (bits !== 16 || ch !== 1) throw new Error('TTS 不是单声道 16bit');
  return { pcm: resample16(data, rate, INPUT_SAMPLE_RATE), srcRate: rate };
}

/* ---------------------------- realtime 一轮 ---------------------------- */

function runOnce({ label, transcription, spokenPcm, instructions }) {
  return new Promise((resolve) => {
    const out = { label, sessionEcho: null, error: null, transcript: null, assistant: '' };
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
          instructions: instructions
            ?? 'You are a friendly English tutor helping a Chinese learner practice spoken English. Reply in English only, one or two short sentences.',
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
      if (ev.type === 'response.done') fin();
      if (ev.type === 'error') { out.error = ev.error?.message ?? JSON.stringify(ev); fin(); }
    });
    ws.on('error', (e) => { out.error = e.message; fin(); });
  });
}

/* ---------------------------- 独立 ASR 接口 ---------------------------- */

async function httpAsr(pcm, extra) {
  // 注意前缀：/step_plan/v1/audio/transcriptions 是 404，只有平的 /v1/ 通
  const url = 'https://api.stepfun.com/v1/audio/transcriptions';
  const fd = new FormData();
  fd.set('model', CFG.asrModel);
  fd.set('response_format', 'json');
  for (const [k, v] of Object.entries(extra ?? {})) fd.set(k, v);
  fd.set('file', new Blob([toWav(pcm, INPUT_SAMPLE_RATE)], { type: 'audio/wav' }), 'a.wav');
  const res = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${CFG.apiKey}` }, body: fd });
  const text = await res.text();
  if (!res.ok) return `HTTP ${res.status}: ${text.slice(0, 200)}`;
  try { return JSON.parse(text).text; } catch { return text.slice(0, 200); }
}

/* -------------------------------- 跑 -------------------------------- */

const EN = 'I work at a bank in Shanghai and my job is quite busy these days.';
console.log(`合成英文测试音频：「${EN}」`);
// 用英文音色念英文，避免中文音色的口音把识别带偏 —— 两个都试
const { pcm: enPcm } = await ttsPcm(EN);
writeFileSync('/tmp/probe-en-16k.pcm', enPcm);
console.log(`  默认音色，降采样到 ${INPUT_SAMPLE_RATE}Hz：${enPcm.length} 字节（${(enPcm.length / 2 / INPUT_SAMPLE_RATE).toFixed(2)}s）\n`);

console.log('── 独立 ASR 接口（/v1/audio/transcriptions）──');
console.log(`  裸调:            ${JSON.stringify(await httpAsr(enPcm))}`);
await sleep(1500);
console.log(`  language=en:     ${JSON.stringify(await httpAsr(enPcm, { language: 'en' }))}`);
await sleep(1500);
console.log(`  language=english:${JSON.stringify(await httpAsr(enPcm, { language: 'english' }))}`);
await sleep(1500);
console.log(`  prompt 提示英文: ${JSON.stringify(await httpAsr(enPcm, { prompt: 'The audio is in English. Transcribe it in English.' }))}\n`);

const cases = [
  { label: 'A realtime 现状：只给 model', transcription: { model: CFG.asrModel } },
  { label: 'B realtime + language: en', transcription: { model: CFG.asrModel, language: 'en' } },
  {
    label: 'C realtime + prompt 提示英文',
    transcription: { model: CFG.asrModel, prompt: 'The audio is in English. Transcribe it in English.' },
  },
];

for (const c of cases) {
  console.log(`── ${c.label} ──`);
  const r = await runOnce({ ...c, spokenPcm: enPcm });
  console.log(`  session 回显: ${JSON.stringify(r.sessionEcho)}`);
  console.log(`  学生转写: ${JSON.stringify(r.transcript)}`);
  console.log(`  AI 回复: ${JSON.stringify(r.assistant.slice(0, 160))}${r.error ? `\n  错误: ${r.error}` : ''}\n`);
  await sleep(3000); // 避开连续建连限流
}
