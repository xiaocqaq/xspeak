/**
 * 测出 realtime 输出音频的真实采样率。
 *
 * 为什么要测：session.update 里只能声明 output_audio_format: 'pcm16'，
 * 这个字段不带采样率 —— 它只说「16 位有符号小端整数」。真实速率得靠约定，
 * 而播放端曾经拿上行的 16000 建 AudioBuffer。如果上游其实给 24000，
 * 同一批采样按 16000 播就会慢 1.5 倍、音调降到原来的三分之二：
 * 女声会变成一个低沉的男声，而且换任何音色都一样低 —— 因为问题不在音色。
 * 结论已写进 protocol.mjs 的 OUTPUT_SAMPLE_RATE。
 *
 * 判据用基频（f0），不用时长：
 * 自相关求出的周期是「多少个采样点」，这个数跟假设的采样率无关。
 * f0 = 采样率 / 周期，所以同一段音频按 16000 和按 24000 会算出两个 f0，
 * 落在成年女声区间（165~255Hz）的那个才是真的。
 *
 * 用法：node scripts/probe-audio-rate.mjs [voiceId]
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
    if (process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].trim().replace(/^["'](.*)["']$/, '$1');
    }
  }
}

const { voiceConfig } = await import(path.join(ROOT, 'src/lib/voice/config.mjs'));
const CFG = voiceConfig();
if (!CFG.apiKey) {
  console.error('缺少 VOICE_API_KEY / STEP_API_KEY。');
  process.exit(1);
}

const VOICE = process.argv[2] || CFG.defaultVoice;
let seq = 0;
const eid = () => `e${Date.now().toString(36)}${(seq++).toString(36)}`;

const chunks = [];

const ws = new WebSocket(`${CFG.realtimeUrl}?model=${encodeURIComponent(CFG.realtimeModel)}`, {
  headers: { Authorization: `Bearer ${CFG.apiKey}` },
});

const done = new Promise((resolve, reject) => {
  const timer = setTimeout(() => resolve('超时收尾'), 45_000);

  ws.on('open', () => {
    ws.send(JSON.stringify({
      event_id: eid(),
      type: 'session.update',
      session: {
        modalities: ['text', 'audio'],
        instructions: 'You are a friendly English tutor. Speak English only.',
        voice: VOICE,
        input_audio_format: 'pcm16',
        output_audio_format: 'pcm16',
      },
    }));
  });

  ws.on('message', (raw) => {
    let ev;
    try { ev = JSON.parse(String(raw)); } catch { return; }

    if (ev.type === 'session.updated') {
      console.log(`会话就绪，回显音色 = ${ev.session?.voice}`);
      // 用一句定长的话，方便顺带核对时长
      ws.send(JSON.stringify({
        event_id: eid(),
        type: 'conversation.item.create',
        item: {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: 'Say exactly this and nothing else: Good morning. How are you today?' }],
        },
      }));
      ws.send(JSON.stringify({ event_id: eid(), type: 'response.create' }));
    }

    if (ev.type === 'response.audio.delta' && ev.delta) {
      chunks.push(Buffer.from(ev.delta, 'base64'));
    }

    if (ev.type === 'response.done' || ev.type === 'response.audio.done') {
      clearTimeout(timer);
      resolve('收齐');
    }

    if (ev.type === 'error') {
      clearTimeout(timer);
      reject(new Error(JSON.stringify(ev.error ?? ev)));
    }
  });

  ws.on('error', (e) => { clearTimeout(timer); reject(e); });
});

let why;
try {
  why = await done;
} catch (e) {
  console.error('探测失败：', e.message);
  ws.close();
  process.exit(1);
}
ws.close();

const pcm = Buffer.concat(chunks);
console.log(`${why}，拿到 ${pcm.length} 字节（${pcm.length / 2} 个采样点）`);
if (pcm.length < 8000) {
  console.error('音频太短，无法判定。');
  process.exit(1);
}

// Int16 → Float
const n = pcm.length / 2;
const f = new Float32Array(n);
for (let i = 0; i < n; i++) f[i] = pcm.readInt16LE(i * 2) / 32768;

/**
 * 自相关求周期（单位：采样点）。
 * 在最响的一段上做，避开开头的静音；候选周期覆盖 60~400Hz 在两种采样率下的范围。
 */
function periodSamples(x) {
  // 找能量最高的 40ms*24 窗口位置（用固定 8192 点窗，两种速率都够长）
  const W = 8192;
  let best = 0, bestE = -1;
  for (let off = 0; off + W < x.length; off += 1024) {
    let e = 0;
    for (let i = off; i < off + W; i++) e += x[i] * x[i];
    if (e > bestE) { bestE = e; best = off; }
  }
  const seg = x.subarray(best, best + W);
  // 去直流
  let mean = 0;
  for (let i = 0; i < seg.length; i++) mean += seg[i];
  mean /= seg.length;

  const minLag = 30;   // 24000/30 = 800Hz 上限，足够宽
  const maxLag = 400;  // 16000/400 = 40Hz 下限
  let bestLag = -1, bestScore = -Infinity;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let num = 0, d1 = 0, d2 = 0;
    for (let i = 0; i + lag < seg.length; i++) {
      const a = seg[i] - mean, b = seg[i + lag] - mean;
      num += a * b; d1 += a * a; d2 += b * b;
    }
    const score = num / (Math.sqrt(d1 * d2) || 1);
    if (score > bestScore) { bestScore = score; bestLag = lag; }
  }
  return { lag: bestLag, score: bestScore, at: best };
}

const { lag, score, at } = periodSamples(f);
console.log(`\n自相关：周期 ${lag} 个采样点（相关度 ${score.toFixed(3)}，窗口起点 ${at}）`);

for (const rate of [16000, 24000]) {
  const f0 = rate / lag;
  const dur = n / rate;
  const verdict = f0 >= 165 && f0 <= 255 ? '← 成年女声区间' : f0 < 165 ? '（男声/偏低）' : '（偏高）';
  console.log(`  按 ${rate}Hz：f0 ≈ ${f0.toFixed(1)}Hz ${verdict}   时长 ${dur.toFixed(2)}s`);
}

/** 存 wav 方便直接听。 */
function wav(rate, data) {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8);
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}
writeFileSync('/tmp/rt-as-16k.wav', wav(16000, pcm));
writeFileSync('/tmp/rt-as-24k.wav', wav(24000, pcm));
console.log('\n已写出 /tmp/rt-as-16k.wav 和 /tmp/rt-as-24k.wav');
