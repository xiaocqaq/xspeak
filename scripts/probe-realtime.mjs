/**
 * StepFun 实时语音接口的探测脚本。
 *
 * src/lib/realtime/protocol.mjs 里那两条「和官方文档不一致」的硬约束是实测出来的，
 * 不是文档里写的。上游哪天改了行为，用这个脚本重测一遍就知道，不用靠猜：
 *
 *   1. 服务地址在 /step_plan/v1/realtime 而不是 /v1/realtime
 *   2. 开了 server_vad 之后服务端会丢掉 input_audio_transcription 配置，
 *      拿不到学生原话 —— 教学闭环就断了
 *
 * 判据说明：不能只看 session.updated 的回显。实测手动模式下服务端同样不回显
 * input_audio_transcription，但转写事件照样会来。所以「能不能拿到转写」只能
 * 靠真的喂一段音频进去看结果，这就是默认行为要跑完整回合的原因。
 *
 * 用法：
 *   node scripts/probe-realtime.mjs          # 连通性 + 完整回合（会用掉一点音频额度）
 *   node scripts/probe-realtime.mjs --quick  # 只测连通性，不烧额度
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

// 这个脚本在 Next 之外跑，自己读一遍 .env.local
const envFile = path.resolve(process.cwd(), '.env.local');
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    if (process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].trim().replace(/^["'](.*)["']$/, '$1');
    }
  }
}

const KEY = process.env.STEP_API_KEY?.trim();
if (!KEY) {
  console.error('缺少 STEP_API_KEY，请先在 .env.local 里配置。');
  process.exit(1);
}

// 默认跑完整回合 —— 只测连通性说明不了转写还在不在
const QUICK = process.argv.includes('--quick');
const HTTP_BASE = 'https://api.stepfun.com/step_plan/v1';
const WS_BASE = process.env.STEP_REALTIME_URL?.trim() || 'wss://api.stepfun.com/step_plan/v1/realtime';
const MODEL = 'stepaudio-2.5-realtime';

let seq = 0;
const eid = () => `e${Date.now().toString(36)}${(seq++).toString(36)}`;

/** 开一条上游连接，发一次 session.update，返回服务端的配置回显。 */
function probeSession({ label, withVad }) {
  return new Promise((resolve) => {
    const ws = new WebSocket(`${WS_BASE}?model=${encodeURIComponent(MODEL)}`, {
      headers: { Authorization: `Bearer ${KEY}` },
    });
    const done = (verdict, echo) => {
      try {
        ws.close();
      } catch {
        // 已经断了
      }
      resolve({ label, verdict, echo });
    };
    const timer = setTimeout(() => done('TIMEOUT'), 12_000);

    ws.onopen = () => {
      const session = {
        modalities: ['text', 'audio'],
        instructions: 'probe',
        input_audio_format: 'pcm16',
        output_audio_format: 'pcm16',
        input_audio_transcription: { model: 'stepaudio-2.5-asr' },
      };
      if (withVad) session.turn_detection = { type: 'server_vad', silence_duration_ms: 700 };
      ws.send(JSON.stringify({ event_id: eid(), type: 'session.update', session }));
    };

    ws.onmessage = (ev) => {
      let msg;
      try {
        msg = JSON.parse(String(ev.data));
      } catch {
        return;
      }
      if (msg.type === 'session.updated') {
        clearTimeout(timer);
        done('OK', msg.session ?? {});
      } else if (msg.type === 'error') {
        clearTimeout(timer);
        done(`ERROR ${msg.error?.message ?? ''}`);
      }
    };
    ws.onerror = () => {
      clearTimeout(timer);
      done('CONNECT FAILED');
    };
  });
}

/**
 * 跑一轮完整对话：TTS 合成「学生说话」→ 喂进去 → 看能否拿到转写和语音回复。
 * @param {boolean} withVad 带上 server_vad，用来验证那条硬约束还成不成立
 */
async function probeFullTurn(withVad = false) {
  const said = 'I very like coffee. Can I have a big one?';
  const res = await fetch(`${HTTP_BASE}/audio/speech`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: 'stepaudio-2.5-tts',
      input: said,
      voice: 'linjiajiejie',
      response_format: 'pcm',
      sample_rate: 16_000,
    }),
  });
  if (!res.ok) return { ok: false, why: `TTS 失败 HTTP ${res.status}` };
  const pcm = Buffer.from(await res.arrayBuffer());
  // 16k mono s16le：32000 字节 = 1 秒。太短说明 TTS 没真的出音频。
  if (pcm.length < 32_000) return { ok: false, why: `TTS 只返回了 ${pcm.length} 字节，不是有效音频` };

  const ws = new WebSocket(`${WS_BASE}?model=${encodeURIComponent(MODEL)}`, {
    headers: { Authorization: `Bearer ${KEY}` },
  });
  const out = { ok: false, transcript: null, replyText: '', audioBytes: 0, why: null };

  await new Promise((resolve) => {
    const timer = setTimeout(resolve, 60_000);
    const finish = () => {
      clearTimeout(timer);
      try {
        ws.close();
      } catch {
        // 已经断了
      }
      resolve();
    };

    ws.onopen = () => {
      const session = {
        modalities: ['text', 'audio'],
        instructions: 'You are a friendly barista. Keep replies to one short sentence.',
        input_audio_format: 'pcm16',
        output_audio_format: 'pcm16',
        input_audio_transcription: { model: 'stepaudio-2.5-asr' },
      };
      if (withVad) session.turn_detection = { type: 'server_vad', silence_duration_ms: 700 };
      ws.send(JSON.stringify({ event_id: eid(), type: 'session.update', session }));
    };

    ws.onmessage = (ev) => {
      let msg;
      try {
        msg = JSON.parse(String(ev.data));
      } catch {
        return;
      }

      if (msg.type === 'session.updated') {
        // 末尾补 1 秒静音，更像真人说完话（VAD 模式也靠这段静音判断说完了）
        const audio = Buffer.concat([pcm, Buffer.alloc(32_000)]);
        const CHUNK = 3200; // 100ms
        for (let i = 0; i < audio.length; i += CHUNK) {
          ws.send(
            JSON.stringify({
              event_id: eid(),
              type: 'input_audio_buffer.append',
              audio: audio.subarray(i, i + CHUNK).toString('base64'),
            }),
          );
        }
        // server_vad 下发 commit 会被上游拒绝（commit when server vad），
        // 由 VAD 自己判断说完并触发回应
        if (!withVad) {
          ws.send(JSON.stringify({ event_id: eid(), type: 'input_audio_buffer.commit' }));
          ws.send(JSON.stringify({ event_id: eid(), type: 'response.create' }));
        }
        return;
      }

      switch (msg.type) {
        case 'conversation.item.input_audio_transcription.completed':
          out.transcript = String(msg.transcript ?? '').trim();
          break;
        case 'response.audio_transcript.delta':
          out.replyText += String(msg.delta ?? '');
          break;
        case 'response.audio.delta':
          out.audioBytes += Buffer.from(String(msg.delta ?? ''), 'base64').length;
          break;
        case 'response.done':
          out.ok = Boolean(out.transcript) && out.audioBytes > 0;
          finish();
          break;
        case 'error':
          out.why = msg.error?.message ?? '上游报错';
          finish();
          break;
      }
    };

    ws.onerror = () => finish();
  });

  return out;
}

console.log(`探测 ${WS_BASE}\n`);

let bad = false;

// 只看连通性。注意不要用 session.updated 的回显来判断转写在不在 ——
// 实测服务端从来不回显 input_audio_transcription，但转写照样能拿到。
// 唯一可靠的判据是真的跑一个回合看有没有收到转写事件。
const conn = await probeSession({ label: '手动模式（不带 turn_detection）', withVad: false });
console.log(`· ${conn.label}`);
console.log(`    连接：${conn.verdict}`);
if (conn.verdict !== 'OK') {
  bad = true;
  console.log('\n✗ 连不上。地址可能变了，先确认 STEP_REALTIME_URL。');
  console.log(bad ? '\n有问题，见上面。' : '\n一切正常。');
  process.exit(1);
}

if (QUICK) {
  console.log('\n（--quick：跳过真实音频回合。转写是否可用没有验证。）');
  console.log('\n一切正常。');
  process.exit(0);
}

// 手动模式跑一个真实回合 —— 这才是「转写还能不能拿到」的唯一判据
console.log('\n· 手动模式完整回合（按住说话 → 松手 commit）');
const manual = await probeFullTurn(false);
if (manual.ok) {
  console.log(`    学生转写：${manual.transcript}`);
  console.log(`    AI 回复：${manual.replyText.trim()}`);
  console.log(`    AI 音频：${Math.round(manual.audioBytes / 1024)} KB`);
} else {
  bad = true;
  console.log(`    失败：${manual.why ?? '没跑完一个回合'}`);
  if (!manual.transcript && manual.audioBytes > 0) {
    console.log('    ⚠ 有语音回复但没有转写 —— 教学闭环会断，纠正和错题本都会失效。');
  }
}

// 再验一次那条硬约束：server_vad 下应该拿不到转写。
// 如果哪天能拿到了，说明上游改了行为，可以换成更自然的自动断句。
console.log('\n· server_vad 完整回合（验证那条硬约束还成不成立）');
const vad = await probeFullTurn(true);
if (vad.transcript) {
  console.log(`    学生转写：${vad.transcript}`);
  console.log('\n※ server_vad 现在也能拿到转写了 —— 上游行为变了。');
  console.log('  可以考虑改用 VAD 自动断句，体验会比「按住说话」更自然。');
  console.log('  见 src/lib/realtime/protocol.mjs 的头注释和 relay.mjs 的 commit 分支。');
} else {
  console.log(`    没拿到转写${vad.why ? `（${vad.why}）` : ''} —— 硬约束仍然成立，继续用手动模式。`);
}

console.log(bad ? '\n有问题，见上面。' : '\n一切正常。');
process.exit(bad ? 1 : 0);
