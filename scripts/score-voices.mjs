/**
 * 给音色的「英文清晰度」打分。
 *
 * 背景：这些都是中文音色在念英文，口音偏中式是上游的能力边界。但 25 个音色之间
 * 差别不小，靠人一个个试听费时且主观。这里用一个客观代理指标：
 *
 *   同一批英文句子 → TTS 合成 → 送回 ASR 转写 → 和原文算词错率（WER）
 *
 * 口音重、咬字含糊的音色，转写会更容易错。WER 低不等于「好听」，但和「学生听不听得懂」
 * 强相关 —— 对英语陪练来说这个比好听更要紧。
 *
 * 题目挑的是中文母语者念英文最容易露馅的音：th、r/l、v/w、词尾辅音、连读。
 *
 * 用法：
 *   node scripts/score-voices.mjs            # 给 voice-options.mjs 里所有音色打分
 *   node scripts/score-voices.mjs a b c      # 只测指定的几个
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
    if (process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].trim().replace(/^["'](.*)["']$/, '$1');
    }
  }
}

const { voiceConfig } = await import(path.join(ROOT, 'src/lib/voice/config.mjs'));
const { AI_VOICES } = await import(path.join(ROOT, 'src/lib/voice-options.mjs'));
const CFG = voiceConfig();
if (!CFG.apiKey) {
  console.error('缺少 VOICE_API_KEY / STEP_API_KEY。');
  process.exit(1);
}

/**
 * ASR 的 REST 端点。
 * 注意路径是 /v1/audio/transcriptions，不是 realtime 和 TTS 那个 /step_plan/v1/ 前缀 ——
 * 实测 /step_plan/v1/audio/transcriptions 是 404。
 */
const ASR_URL = (process.env.VOICE_ASR_URL ?? '').trim() || 'https://api.stepfun.com/v1/audio/transcriptions';

// 专挑中文母语者念英文最容易露馅的音
const SENTENCES = [
  'Three thirsty travelers thought about the third floor.',
  'She sells thirty five red and yellow umbrellas.',
  'I would like a very large coffee with vanilla, please.',
];

/**
 * 归一化。连字符要当空格处理：ASR 把 "thirty-five" 转成 "thirty five" 是
 * 书写差异，不是念错，算进 WER 会给所有音色平摊一个假错误，把分数糊平。
 */
const norm = (s) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9\s']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);

/** 词级编辑距离，用来算 WER。 */
function editDistance(a, b) {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1]);
    }
  }
  return dp[a.length][b.length];
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** ASR 接口会 429。退避重试，不然大半的音色会因为限流而没有分数。 */
async function withRetry(label, fn) {
  let delay = 4_000;
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const rateLimited = /429/.test(String(err.message));
      if (!rateLimited || attempt >= 5) throw err;
      await wait(delay);
      delay *= 2;
    }
  }
}

async function tts(voice, input) {
  return withRetry('tts', async () => {
    const res = await fetch(CFG.ttsUrl, {
      method: 'POST',
      headers: { Authorization: `Bearer ${CFG.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: CFG.ttsModel, input, voice, response_format: 'mp3' }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`TTS HTTP ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  });
}

async function asr(mp3) {
  return withRetry('asr', async () => {
    const fd = new FormData();
    fd.append('model', CFG.asrModel);
    fd.append('response_format', 'json');
    fd.append('file', new Blob([mp3], { type: 'audio/mpeg' }), 'a.mp3');
    const res = await fetch(ASR_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${CFG.apiKey}` },
      body: fd,
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`ASR HTTP ${res.status}`);
    return String((await res.json()).text ?? '');
  });
}

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const voices = args.length ? args : AI_VOICES.map((v) => v.id);
const labels = new Map(AI_VOICES.map((v) => [v.id, v.zh]));

console.log(`给 ${voices.length} 个音色打英文清晰度分（每个念 ${SENTENCES.length} 句，转写回来算词错率）\n`);

const rows = [];
for (const voice of voices) {
  let errors = 0;
  let words = 0;
  let bytes = 0;
  const misread = [];
  try {
    for (const s of SENTENCES) {
      const mp3 = await tts(voice, s);
      bytes += mp3.length;
      const back = await asr(mp3);
      await wait(1_200); // 主动限速，比撞上 429 再退避快
      const ref = norm(s);
      const hyp = norm(back);
      const d = editDistance(ref, hyp);
      errors += d;
      words += ref.length;
      if (d > 0) misread.push(back.trim());
    }
    const wer = errors / words;
    rows.push({ voice, wer, bytes, misread });
    console.log(
      `  ${(wer * 100).toFixed(1).padStart(5)}%  ${voice.padEnd(22)} ${labels.get(voice) ?? ''}` +
        (misread.length ? `\n           听成：${misread.slice(0, 2).join(' / ')}` : ''),
    );
  } catch (err) {
    console.log(`  ─────  ${voice.padEnd(22)} 失败：${err.message}`);
  }
}

rows.sort((a, b) => a.wer - b.wer);
console.log('\n— 按英文清晰度排序（词错率越低越清楚）—');
for (const r of rows) {
  const secPerSentence = r.bytes / SENTENCES.length / 4000; // mp3 ~32kbps，粗估时长
  console.log(
    `  ${(r.wer * 100).toFixed(1).padStart(5)}%  ${r.voice.padEnd(22)} ` +
      `${(labels.get(r.voice) ?? '').padEnd(12)} 平均每句约 ${secPerSentence.toFixed(1)}s`,
  );
}
console.log('\n注：WER 低只说明「咬字清楚、机器听得懂」，不等于好听。语速快慢看最后一列。');
