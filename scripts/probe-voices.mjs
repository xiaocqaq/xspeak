/**
 * 探测 realtime 到底认哪些音色。
 *
 * 为什么要单独一个脚本：官方音色清单有 36 个，但那张表的「支持模型」列只写了
 * stepaudio-2.5-tts / step-tts-2 / step-tts-mini 三个 TTS 模型，从来没提 realtime。
 * 而 realtime 文档正文里只顺口举了四个例子（qingchunshaonv、wenrounansheng、
 * elegantgentle-female、livelybreezy-female）就用「等」字带过去了。两边都不是完整答案，
 * 只能实测。
 *
 * ── 关键手法：一条连接试完所有音色 ──
 *
 * 上一次探测是「一个音色一条连接」，结果连到第 12 个左右就被限流，报出来的
 * 「连接错误」和「音色不认」长得一模一样，整轮数据全废。
 *
 * 这次利用文档里的一句话：voice 只在「模型在本会话中首次以音频响应后」才锁定。
 * 探测全程不喂音频、不发 response.create，所以模型永远不会产出音频，voice 就一直可改 ——
 * 一条连接里连发 N 次 session.update 就能试完 N 个音色，建连次数从 N 降到 1。
 *
 * 判据：每次 session.update 之后等一个事件。
 *   - session.updated 且回显的 voice == 候选值  → 认
 *   - session.updated 但回显的 voice != 候选值  → 静默降级（比明确报错更坑，要单独标出来）
 *   - error                                     → 不认，记下原文
 * 如果出现「voice 改不了」这类锁定错误，说明上面那个前提不成立，脚本会重连再继续，
 * 并在结尾提示这一点。
 *
 * 用法：
 *   node scripts/probe-voices.mjs              # 试官方清单里所有 stepaudio-2.5-tts 音色
 *   node scripts/probe-voices.mjs a b c        # 只试指定的几个 id
 *   node scripts/probe-voices.mjs --tts        # 顺带验一遍试听接口能不能出音频
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const ROOT = path.resolve(HERE, '..');

// 这个脚本在 Next 之外跑，自己读一遍 .env.local
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
  console.error('缺少 VOICE_API_KEY / STEP_API_KEY，请先在 .env.local 里配置。');
  process.exit(1);
}

/**
 * 官方「音频合成最佳实践」里标了支持 stepaudio-2.5-tts 的全部音色。
 * 只列这一档：试听走 stepaudio-2.5-tts，只支持 step-tts-2 / step-tts-mini 的音色
 * 就算 realtime 认，也试听不出来，放进设置页是残废的。
 */
const CANDIDATES = [
  'jingdiannvsheng',
  'linjiajiejie',
  'linjiameimei',
  'qinqienvsheng',
  'zhixingjiejie',
  'shuangkuaijiejie',
  'qingchunshaonv',
  'wenroushunv',
  'tianmeinvsheng',
  'wenrounvsheng',
  'ruanmengnvsheng',
  'youyanvsheng',
  'lengyanyujie',
  'wenjingxuejie',
  'jilingshaonv',
  'yuanqishaonv',
  'elegantgentle-female',
  'livelybreezy-female',
  'wenrounansheng',
  'qingniandaxuesheng',
  'zhengpaiqingnian',
  'ruyananshi',
  'cixingnansheng',
  'boyinnansheng',
  'shenchennanyin',
  'wenrougongzi',
  'yuanqinansheng',
];

const WANT_TTS = process.argv.includes('--tts');
const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const voices = args.length ? args : CANDIDATES;

let seq = 0;
const eid = () => `e${Date.now().toString(36)}${(seq++).toString(36)}`;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** 开一条上游连接，等 session.update 生效为止。 */
function connect() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${CFG.realtimeUrl}?model=${encodeURIComponent(CFG.realtimeModel)}`, {
      headers: { Authorization: `Bearer ${CFG.apiKey}` },
    });
    const timer = setTimeout(() => reject(new Error('建连超时')), 15_000);
    ws.onopen = () => {
      clearTimeout(timer);
      resolve(ws);
    };
    ws.onerror = () => {
      clearTimeout(timer);
      reject(new Error('建连失败（可能是限流）'));
    };
  });
}

/**
 * 在已有连接上试一个音色。
 * @returns {Promise<{verdict:'ok'|'downgraded'|'rejected'|'locked'|'timeout', echo?:string, message?:string}>}
 */
function tryVoice(ws, voice) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      ws.onmessage = null;
      resolve({ verdict: 'timeout' });
    }, 12_000);

    ws.onmessage = (ev) => {
      let msg;
      try {
        msg = JSON.parse(String(ev.data));
      } catch {
        return;
      }
      if (msg.type === 'session.updated') {
        clearTimeout(timer);
        ws.onmessage = null;
        const echo = msg.session?.voice;
        resolve({
          verdict: echo === voice ? 'ok' : 'downgraded',
          echo: echo == null ? '(回显里没有 voice)' : String(echo),
        });
      } else if (msg.type === 'error' || msg.error) {
        clearTimeout(timer);
        ws.onmessage = null;
        const message = String(msg.error?.message ?? msg.message ?? '上游报错');
        // 「音频已生成后不能改 voice」这类：说明一条连接试多个音色的前提不成立
        const locked = /modif|change|already|cannot|not allowed/i.test(message) && !/valid/i.test(message);
        resolve({ verdict: locked ? 'locked' : 'rejected', message });
      }
    };

    ws.send(
      JSON.stringify({
        event_id: eid(),
        type: 'session.update',
        session: {
          modalities: ['text', 'audio'],
          instructions: 'probe',
          voice,
          input_audio_format: 'pcm16',
          output_audio_format: 'pcm16',
        },
      }),
    );
  });
}

console.log(`探测 ${CFG.realtimeUrl}（model=${CFG.realtimeModel}）`);
console.log(`候选 ${voices.length} 个，一条连接里连发 session.update\n`);

const results = [];
let ws = await connect();
let reconnects = 0;
let sawLocked = false;

for (const voice of voices) {
  let r = await tryVoice(ws, voice);

  // voice 被锁定 / 连接断了：重连一次再试这个音色，别把上一轮的状态算到它头上
  if (r.verdict === 'locked' || r.verdict === 'timeout' || ws.readyState !== 1) {
    if (r.verdict === 'locked') sawLocked = true;
    try {
      ws.close();
    } catch {
      // 已经断了
    }
    reconnects += 1;
    // 建连有限流，重连之间留够间隔
    await wait(reconnects > 1 ? 20_000 : 3_000);
    try {
      ws = await connect();
    } catch (err) {
      console.log(`\n✗ 重连失败：${err.message}`);
      console.log('  剩下的音色没测完，等几分钟限流恢复后重跑。');
      break;
    }
    r = await tryVoice(ws, voice);
  }

  results.push({ voice, ...r });
  const mark = { ok: '✓', downgraded: '~', rejected: '✗', locked: '?', timeout: '?' }[r.verdict];
  const tail =
    r.verdict === 'downgraded'
      ? ` → 上游回显 ${r.echo}（静默降级）`
      : r.verdict === 'rejected'
        ? ` → ${r.message}`
        : r.verdict === 'timeout'
          ? ' → 没有任何回应'
          : '';
  console.log(`  ${mark} ${voice}${tail}`);
}

try {
  ws.close();
} catch {
  // 已经断了
}

const ok = results.filter((r) => r.verdict === 'ok').map((r) => r.voice);
const downgraded = results.filter((r) => r.verdict === 'downgraded');
const rejected = results.filter((r) => r.verdict === 'rejected');

console.log(`\n认：${ok.length} / 测了 ${results.length}`);
if (rejected.length) console.log(`明确拒绝：${rejected.map((r) => r.voice).join(', ')}`);
if (downgraded.length) {
  console.log(`静默降级：${downgraded.map((r) => `${r.voice}→${r.echo}`).join(', ')}`);
  console.log('  ⚠ 降级的最坑 —— 用户选了听到的却是别的声音，界面上必须挡住这类 id。');
}
if (reconnects) console.log(`（中途重连 ${reconnects} 次）`);
if (sawLocked) {
  console.log('※ 出现过「voice 不可修改」——「一条连接试多个音色」的前提不再成立，');
  console.log('  这轮结果按重连边界打了折，存疑的话改成一个音色一条连接（注意限流）。');
}

console.log('\n可直接贴进 src/lib/voice-options.mjs 的 id 列表：');
console.log(ok.map((v) => `'${v}'`).join(', '));

// 试听走的是 TTS 接口，和 realtime 是两套；顺带验一遍免得设置页里试听全是 502
if (WANT_TTS && ok.length) {
  console.log('\n— 试听接口（TTS）复验 —');
  for (const voice of ok) {
    const res = await fetch(CFG.ttsUrl, {
      method: 'POST',
      headers: { Authorization: `Bearer ${CFG.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: CFG.ttsModel, input: 'Hello there.', voice, response_format: 'mp3' }),
    });
    const bytes = res.ok ? (await res.arrayBuffer()).byteLength : 0;
    console.log(`  ${bytes > 2000 ? '✓' : '✗'} ${voice} ${res.ok ? `${bytes} 字节` : `HTTP ${res.status}`}`);
  }
}
